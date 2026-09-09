"""Phase 0 — faster-whisper 전사. recordings/*.wav → transcripts/*.json (+ .txt).

계획서 인터페이스 (ai/ 디렉토리 안에서 실행)
  python stt/transcribe.py --audio recordings/{user_id}_{ts}.wav --model small
  python stt/transcribe.py                      # recordings/ 전체
  python stt/transcribe.py --model small,medium # 모델 비교
  python stt/transcribe.py --session 1788526909 # 세션 하나만 → transcripts/session_{ts}.transcript.json 도 생성

출력 (파일당, 모델당)
  transcripts/{wav_stem}__{model}.json   {"speaker": user_id, "segments": [{speaker,start,end,text}], "text", 처리시간 메타}
  transcripts/{wav_stem}__{model}.txt
  transcripts/session_{ts}.transcript.json  세션의 모든 화자 세그먼트를 시간순으로 합친 shared.schemas.Transcript
  timing_summary.md                       처리 시간 누적 기록 (transcripts/*.json 전체 재스캔)

화자 분리는 파일명(user_id)이 담당하므로 diarization 모델이 없습니다 — Discord 캡처의 핵심 이점.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import wave
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # ai/ 자체를 sys.path 에 추가

from shared.config import AI_ROOT, RECORDINGS_DIR, TRANSCRIPTS_DIR  # noqa: E402

TIMING_SUMMARY_PATH = AI_ROOT / "timing_summary.md"
MAX_SEC_PER_AUDIO_MIN = 30.0  # 통과 기준: 오디오 1분당 전사 30초 이내


def wav_duration_sec(path: Path) -> float:
    try:
        with wave.open(str(path), "rb") as w:
            rate = w.getframerate()
            return w.getnframes() / rate if rate else 0.0
    except wave.Error:
        return 0.0


def parse_wav_stem(stem: str) -> tuple[str, str]:
    """'{user_id}_{ts}' → (user_id, ts)"""
    user_id, _, ts = stem.partition("_")
    return user_id, ts


def parse_transcript_stem(stem: str) -> tuple[str, str, str]:
    """'{user_id}_{ts}__{model}' → (user_id, ts, model)"""
    base, _, model = stem.partition("__")
    user_id, ts = parse_wav_stem(base)
    return user_id, ts, model or "?"


def load_manifests(recordings_dir: Path) -> dict[str, str]:
    """user_id → display_name (session_*.json 에서 수집)."""
    names: dict[str, str] = {}
    for mp in recordings_dir.glob("session_*.json"):
        try:
            data = json.loads(mp.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        for sp in data.get("speakers", []):
            names[str(sp.get("user_id"))] = sp.get("display_name") or str(sp.get("user_id"))
    return names


def collect_wavs(inputs: list[str], session: str | None) -> list[Path]:
    paths: list[Path] = []
    for item in inputs or [str(RECORDINGS_DIR)]:
        p = Path(item)
        if p.is_dir():
            paths.extend(sorted(p.glob("*.wav")))
        elif p.is_file() and p.suffix.lower() == ".wav":
            paths.append(p)
        else:
            print(f"[skip] wav 가 아니거나 존재하지 않음: {p}", file=sys.stderr)
    if session:
        paths = [p for p in paths if parse_wav_stem(p.stem)[1] == session]
    seen: set[Path] = set()
    unique: list[Path] = []
    for p in paths:
        rp = p.resolve()
        if rp not in seen:
            seen.add(rp)
            unique.append(p)
    return unique


def transcribe_file(model, wav: Path, *, model_name: str, device: str, compute_type: str,
                    language: str, beam_size: int, vad: bool) -> dict:
    user_id, _ = parse_wav_stem(wav.stem)
    t0 = time.perf_counter()
    segments_iter, info = model.transcribe(str(wav), language=language, beam_size=beam_size, vad_filter=vad)
    segments = [
        {"speaker": user_id, "start": round(s.start, 2), "end": round(s.end, 2), "text": s.text.strip()}
        for s in segments_iter
    ]
    elapsed = time.perf_counter() - t0
    duration = wav_duration_sec(wav) or float(getattr(info, "duration", 0.0) or 0.0)
    sec_per_min = (elapsed / duration * 60.0) if duration > 0 else None
    text = " ".join(seg["text"] for seg in segments if seg["text"]).strip()
    return {
        "audio_file": wav.name,
        "audio_path": str(wav),
        "audio_duration_sec": round(duration, 2),
        "model": model_name,
        "device": device,
        "compute_type": compute_type,
        "language": language,
        "beam_size": beam_size,
        "vad_filter": vad,
        "transcribe_sec": round(elapsed, 2),
        "sec_per_audio_min": round(sec_per_min, 2) if sec_per_min is not None else None,
        "language_probability": round(float(getattr(info, "language_probability", 0.0) or 0.0), 3),
        "speaker_id": user_id,
        "text": text,
        "segments": segments,
    }


def build_session_transcript(out_dir: Path, session: str, model_name: str) -> Path | None:
    """세션의 화자별 결과를 시간순으로 합쳐 Transcript(JSON) 하나로 만듭니다 (Phase 2/3 입력)."""
    segs: list[dict] = []
    speakers: dict[str, str] = {}
    for jp in sorted(out_dir.glob(f"*_{session}__{model_name}.json")):
        d = json.loads(jp.read_text(encoding="utf-8"))
        segs.extend(d.get("segments", []))
        speakers[d.get("speaker_id", "?")] = d.get("speaker", d.get("speaker_id", "?"))
    if not segs:
        return None
    segs.sort(key=lambda s: (s["start"], s["end"]))
    out = out_dir / f"session_{session}.transcript.json"
    out.write_text(
        json.dumps({"source": "meeting", "session": session, "model": model_name,
                    "speakers": speakers, "segments": segs}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return out


# ───────────────────────────────────────────────────────────── 처리시간 누적 기록
def collect_timing_rows(out_dir: Path) -> list[dict]:
    rows: list[dict] = []
    for jp in sorted(out_dir.glob("*__*.json")):
        try:
            d = json.loads(jp.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        _, ts, model = parse_transcript_stem(jp.stem)
        rows.append({
            "session": ts, "speaker": d.get("speaker", "?"), "file": d.get("audio_file", jp.stem),
            "model": d.get("model", model), "device": d.get("device", "?"), "compute_type": d.get("compute_type", "?"),
            "audio": d.get("audio_duration_sec"), "elapsed": d.get("transcribe_sec"), "per_min": d.get("sec_per_audio_min"),
        })
    rows.sort(key=lambda r: (r["session"], r["speaker"], r["model"]))
    return rows


def write_timing_summary(rows: list[dict], path: Path) -> None:
    L = ["# 전사 처리 시간 누적 기록\n",
         f"`stt/transcribe.py` 실행마다 `transcripts/*.json` 전체를 다시 스캔해 자동 생성됩니다 (총 {len(rows)}건).\n",
         "기준: 오디오 1분당 전사 시간 30초 이내.\n", "## 세션별 상세\n",
         "| 세션 | 화자 | 파일 | 모델 | 디바이스 | 오디오(s) | 전사(s) | 1분당(s) | 판정 |", "|---|---|---|---|---|---|---|---|---|"]
    for r in rows:
        pm = r["per_min"]
        verdict = "-" if pm is None else ("PASS" if pm <= MAX_SEC_PER_AUDIO_MIN else "FAIL")
        f = lambda v: "-" if v is None else f"{v:.1f}"  # noqa: E731
        device = r["device"] if r["device"] == "?" else f"{r['device']}/{r['compute_type']}"
        L.append(f"| {r['session']} | {r['speaker']} | {r['file']} | {r['model']} | {device} | {f(r['audio'])} | {f(r['elapsed'])} | {f(pm)} | {verdict} |")
    if not rows:
        L.append("| (아직 전사 결과 없음) | | | | | | | | |")
    L += ["\n## 모델별 집계\n", "| 모델 | 건수 | 평균 1분당(s) | 최대 1분당(s) | 통과율 |", "|---|---|---|---|---|"]
    by_model: dict[str, list[float]] = {}
    for r in rows:
        if r["per_min"] is not None:
            by_model.setdefault(r["model"], []).append(r["per_min"])
    for model, vals in sorted(by_model.items()):
        pass_rate = sum(1 for v in vals if v <= MAX_SEC_PER_AUDIO_MIN) / len(vals) * 100
        L.append(f"| {model} | {len(vals)} | {sum(vals)/len(vals):.1f} | {max(vals):.1f} | {pass_rate:.0f}% |")
    if not by_model:
        L.append("| (집계할 데이터 없음) | | | | |")
    path.write_text("\n".join(L) + "\n", encoding="utf-8")


def main() -> int:
    ap = argparse.ArgumentParser(description="faster-whisper 로 화자별 wav 전사")
    ap.add_argument("inputs", nargs="*", help="wav 파일 또는 디렉토리 (기본: recordings/)")
    ap.add_argument("--audio", action="append", default=[], help="전사할 wav (여러 번 지정 가능)")
    ap.add_argument("--session", help="특정 세션(ts)만 처리")
    ap.add_argument("--model", "--models", dest="models", default="small",
                    help="쉼표 구분: tiny,base,small,medium,large-v3 (기본 small)")
    ap.add_argument("--device", default="cpu")
    ap.add_argument("--compute-type", default="int8")
    ap.add_argument("--language", default="ko")
    ap.add_argument("--beam-size", type=int, default=5)
    ap.add_argument("--vad", action="store_true", help="Silero VAD 로 무음 제거 (침묵 긴 트랙의 환각 방지)")
    ap.add_argument("--out", default=str(TRANSCRIPTS_DIR))
    ap.add_argument("--overwrite", action="store_true")
    ap.add_argument("--no-timing-summary", action="store_true")
    args = ap.parse_args()

    try:
        from faster_whisper import WhisperModel
    except ImportError:
        print("faster-whisper 가 없습니다:  pip install faster-whisper", file=sys.stderr)
        return 1

    wavs = collect_wavs(args.inputs + args.audio, args.session)
    if not wavs:
        print("전사할 wav 가 없습니다. 먼저 봇으로 녹음하거나 --audio 로 경로를 지정하세요.", file=sys.stderr)
        return 1

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    names = load_manifests(RECORDINGS_DIR)
    models = [m.strip() for m in args.models.split(",") if m.strip()]
    sessions = {parse_wav_stem(w.stem)[1] for w in wavs}

    rows: list[dict] = []
    for model_name in models:
        print(f"\n=== 모델 로드: {model_name} ({args.device}, {args.compute_type}) ===")
        t0 = time.perf_counter()
        model = WhisperModel(model_name, device=args.device, compute_type=args.compute_type)
        print(f"    로드 {time.perf_counter() - t0:.1f}s")

        for wav in wavs:
            stem = f"{wav.stem}__{model_name}"
            json_path, txt_path = out_dir / f"{stem}.json", out_dir / f"{stem}.txt"
            user_id, _ = parse_wav_stem(wav.stem)
            speaker = names.get(user_id, user_id)
            if json_path.exists() and not args.overwrite:
                result = json.loads(json_path.read_text(encoding="utf-8"))
                print(f"[skip] {wav.name} ({speaker}) 이미 전사됨 → {json_path.name}")
            else:
                print(f"[run ] {wav.name} ({speaker}) ...", end="", flush=True)
                result = transcribe_file(model, wav, model_name=model_name, device=args.device,
                                         compute_type=args.compute_type, language=args.language,
                                         beam_size=args.beam_size, vad=args.vad)
                result["speaker"] = speaker
                json_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
                txt_path.write_text(result["text"] + "\n", encoding="utf-8")
                print(f" {result['transcribe_sec']}s (오디오 {result['audio_duration_sec']}s)")
                print("       " + result["text"][:80] + ("…" if len(result["text"]) > 80 else ""))
            rows.append({"speaker": result.get("speaker", speaker), "file": wav.name, "model": model_name,
                         "audio": result["audio_duration_sec"], "elapsed": result["transcribe_sec"],
                         "per_min": result.get("sec_per_audio_min")})

        for ts in sorted(sessions):
            merged = build_session_transcript(out_dir, ts, model_name)
            if merged:
                print(f"[merge] 세션 {ts} → {merged.name}")

    print("\n=== 처리 시간 요약 (기준: 오디오 1분당 30초 이내) ===")
    for r in rows:
        pm = r["per_min"]
        verdict = "-" if pm is None else ("PASS" if pm <= MAX_SEC_PER_AUDIO_MIN else "FAIL")
        print(f"{r['speaker'][:13]:<14}{r['file'][:33]:<34}{r['model']:<10}{r['audio']:>10.1f}{r['elapsed']:>10.1f}"
              f"{('-' if pm is None else f'{pm:.1f}'):>10}  {verdict}")
    print(f"\n결과 저장: {out_dir}")
    if not args.no_timing_summary:
        timing_rows = collect_timing_rows(out_dir)
        write_timing_summary(timing_rows, TIMING_SUMMARY_PATH)
        print(f"누적 처리 시간 기록: {TIMING_SUMMARY_PATH} ({len(timing_rows)}건)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
