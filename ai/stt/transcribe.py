"""회의 녹음 전사. recordings/*.wav → transcripts/*.json (+ .txt).

인터페이스 (ai/ 디렉토리 안에서 실행)
  python -m stt.transcribe --audio recordings/{user_id}_{ts}.wav --model large-v3-turbo
  python -m stt.transcribe                      # recordings/ 전체
  python -m stt.transcribe --model small,medium # 모델 비교
  python -m stt.transcribe --session 1788526909 # 세션 하나만 → transcripts/session_{ts}.transcript.json 도 생성
  python -m stt.transcribe --backend elice --yes  # API. 예상 비용을 먼저 찍고 --yes 없으면 안 돈다

전사 방식 (--mode)
  chunk  기본. 트랙을 VAD 로 발화 클립으로 자르고, 같은 화자의 클립을 침묵 빼고 28초 안으로 이어
         한 번에 전사한 뒤 단어 시각으로 클립에 되돌린다. 무음은 모델에 안 들어간다.
  clip   클립 하나씩 전사. 실시간 경로가 보내던 단위와 같다.
  track  트랙 통째 (로컬 전용). 반복 환각을 누르는 옵션을 켜고, 무음 자리의 단어는 버린다.
  whole  예전 방식 그대로. 트랙 통째를 옵션 없이 넣는다. 비교용으로 남긴다.
         네 모드의 차이와 측정치는 decision_log/0008.
  본체는 stt/batch.py 다. 여기서는 같은 출력 파일 형식으로 감싼다. 모델 호출은 SttBackend 뒤에
  있어서 이 파일은 faster-whisper 에 직접 의존하지 않는다.

출력 (파일당, 모델당)
  transcripts/{wav_stem}__{model}.json   {"speaker": user_id, "segments": [{speaker,start,end,text}], "text", 처리시간 메타}
  transcripts/{wav_stem}__{model}.txt
  transcripts/session_{ts}.transcript.json  세션의 모든 화자 세그먼트를 시간순으로 합친 shared.schemas.Transcript
  timing_summary.md                       처리 시간 누적 기록 (transcripts/*.json 전체 재스캔)

segments 의 start/end 는 회의 기준 초다. 화자별 트랙이 같은 회의 시계 위에 쓰여 있어서(패킷이 안 온
구간은 0) 파일 안의 위치가 곧 회의 시각이고, 화자를 섞어 start 로 정렬하면 회의록이 된다.
화자 분리는 파일명(user_id)이 담당하므로 diarization 모델이 없습니다. Discord 캡처의 핵심 이점.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import wave
from pathlib import Path

from shared.config import AI_ROOT, RECORDINGS_DIR, TRANSCRIPTS_DIR

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


# ───────────────────────────────────────────────────────────── 배치 전사 (stt/batch.py 위임)
def transcribe_session_batch(wavs: list[Path], names: dict[str, str], backend, *, mode: str,
                             model_name: str, gate=None, workers: int = 1,
                             lines_out: list | None = None) -> tuple[dict[Path, dict], dict]:
    """한 세션의 트랙들을 stt.batch 로 전사해 파일당 결과 dict 를 돌려준다.

    한 세션을 한 번에 넣는 이유는 순번(seq)이 회의 전체 기준이기 때문이다. 결과 dict 의 모양은
    transcribe_file 과 같아서 이후 build_session_transcript / timing_summary 가 그대로 돈다.
    돌려주는 두 번째 값은 세션 통계(호출 수, 보낸 오디오, p50/p95, 걸러진 클립 수 등)다.
    """
    from stt import batch as B

    tracks = []
    for wav in wavs:
        uid, _ = parse_wav_stem(wav.stem)
        tracks.append(B.Track(speaker_id=uid, speaker_name=names.get(uid, uid), path=wav))
    lines, stats = B.run(tracks, backend, mode=mode, gate=gate, workers=workers)
    if lines_out is not None:
        lines_out.extend(lines)   # 회의록(md/jsonl)을 쓰려는 호출자용

    results: dict[Path, dict] = {}
    for tr in tracks:
        mine = [ln for ln in lines if ln.speaker_id == tr.speaker_id]
        # seq 는 회의 전체 순번이다. JudgeFinding.seq 가 이 값으로 근거 발화를 가리킨다
        segments = [
            {"speaker": tr.speaker_id, "start": round(ln.start_ms / 1000, 2), "end": round(ln.end_ms / 1000, 2),
             "text": ln.text, "seq": ln.seq}
            for ln in mine if ln.text
        ]
        elapsed = stats.by_speaker_s.get(tr.speaker_id, 0.0)
        duration = wav_duration_sec(tr.path)
        sec_per_min = (elapsed / duration * 60.0) if duration > 0 else None
        results[tr.path] = {
            "audio_file": tr.path.name,
            "audio_path": str(tr.path),
            "audio_duration_sec": round(duration, 2),
            "model": model_name,
            "device": "api" if model_name == "elice" else "cpu",
            "compute_type": getattr(backend, "compute_type", "-"),
            "language": getattr(backend, "language", "ko"),
            "mode": mode,
            "backend": getattr(backend, "name", type(backend).__name__),
            "transcribe_sec": round(elapsed, 2),
            "sec_per_audio_min": round(sec_per_min, 2) if sec_per_min is not None else None,
            "speaker_id": tr.speaker_id,
            "speaker": tr.speaker_name,
            "clips": len(mine),
            "failed": sum(1 for ln in mine if ln.error),
            "text": " ".join(seg["text"] for seg in segments).strip(),
            "segments": segments,
        }
    return results, stats.summary()


def run_session(wavs: list[Path], names: dict[str, str], backend, *, mode: str = "chunk",
                model_name: str, gate=None, workers: int = 1, out_dir: Path) -> dict:
    """한 세션을 전사해 파일당 json/txt, 세션 통계, 병합 Transcript 까지 쓴다.

    돌려주는 dict: results(파일당 결과), summary(통계), lines(회의록용 Line), transcript_json(경로).
    봇 녹음기(capture/recorder.py)와 이 파일의 main 이 같은 함수를 쓴다.
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    lines: list = []
    results, summary = transcribe_session_batch(wavs, names, backend, mode=mode, model_name=model_name,
                                                gate=gate, workers=workers, lines_out=lines)
    session = parse_wav_stem(wavs[0].stem)[1] if wavs else ""
    for w, result in results.items():
        _save(result, out_dir / f"{w.stem}__{model_name}")
    (out_dir / f"session_{session}__{model_name}.batch.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    merged = build_session_transcript(out_dir, session, model_name)
    return {"results": results, "summary": summary, "lines": lines, "transcript_json": merged, "session": session}


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
    ap = argparse.ArgumentParser(description="화자별 wav 를 전사해 한 시간축의 회의록으로 합친다")
    ap.add_argument("inputs", nargs="*", help="wav 파일 또는 디렉토리 (기본: recordings/)")
    ap.add_argument("--audio", action="append", default=[], help="전사할 wav (여러 번 지정 가능)")
    ap.add_argument("--session", help="특정 세션(ts)만 처리")
    ap.add_argument("--model", "--models", dest="models", default="large-v3-turbo",
                    help="쉼표 구분: tiny,base,small,medium,large-v3,large-v3-turbo (기본 large-v3-turbo)")
    ap.add_argument("--mode", choices=["chunk", "clip", "track", "whole"], default="chunk",
                    help="chunk: 화자별 클립 묶음 (기본) / clip: 클립 하나씩 / track: 트랙 통째 / whole: 예전 방식")
    ap.add_argument("--backend", choices=["local", "elice"], default="local",
                    help="elice 는 API. 예상 비용을 찍고 --yes 가 있어야 돈다. whole 모드는 local 만")
    ap.add_argument("--no-gate", action="store_true", help="말 필터(실로 VAD)를 끈다")
    ap.add_argument("--workers", type=int, default=None, help="동시 호출 수. 기본: elice 3, local 1")
    ap.add_argument("--yes", action="store_true", help="유료 실행을 승인한다")
    ap.add_argument("--compute-type", default="int8")
    ap.add_argument("--language", default="ko")
    ap.add_argument("--beam-size", type=int, default=5, help="로컬 빔 폭. 1 이면 빠르고 5 가 정확하다")
    ap.add_argument("--out", default=str(TRANSCRIPTS_DIR))
    ap.add_argument("--overwrite", action="store_true")
    ap.add_argument("--no-timing-summary", action="store_true")
    args = ap.parse_args()

    wavs = collect_wavs(args.inputs + args.audio, args.session)
    if not wavs:
        print("전사할 wav 가 없습니다. 먼저 봇으로 녹음하거나 --audio 로 경로를 지정하세요.", file=sys.stderr)
        return 1
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    names = load_manifests(RECORDINGS_DIR)
    for wav in wavs:   # recordings/ 바로 아래든 recordings/<회의>/ 아래든 매니페스트를 찾는다
        names.update(load_manifests(wav.parent.parent))
        names.update(load_manifests(wav.parent))
    models = ["elice"] if args.backend == "elice" else [m.strip() for m in args.models.split(",") if m.strip()]
    by_session: dict[str, list[Path]] = {}
    for w in wavs:
        by_session.setdefault(parse_wav_stem(w.stem)[1], []).append(w)

    if args.backend == "elice" and not args.yes:
        from stt.elice import whisper_krw
        total = sum(wav_duration_sec(w) for w in wavs)
        ratio = 1.0 if args.mode == "track" else 0.7   # 클립·묶음은 무음을 안 보낸다. 상한으로 잡는다
        print(f"트랙 {len(wavs)}개 · 오디오 {total / 60:.1f}분 · 예상 상한 약 {whisper_krw(total * ratio):.0f}원 "
              f"(mode={args.mode}). 승인하려면 --yes.")
        return 0

    rows: list[dict] = []
    for model_name in models:
        backend = _make_backend(args.backend, model_name, args)
        gate = None if args.no_gate else _make_gate()
        workers = args.workers if args.workers is not None else _default_workers(args.backend)
        print(f"\n=== {backend.name} · mode={args.mode} · workers={workers} · gate={'off' if gate is None else 'on'} ===")

        for ts, session_wavs in sorted(by_session.items()):
            stems = {w: out_dir / f"{w.stem}__{model_name}" for w in session_wavs}
            done = all(s.with_suffix(".json").exists() for s in stems.values())
            if done and not args.overwrite:
                for w, stem in stems.items():
                    result = json.loads(stem.with_suffix(".json").read_text(encoding="utf-8"))
                    print(f"[skip] {w.name} ({result.get('speaker', '?')}) 이미 전사됨 → {stem.name}.json")
                    rows.append(_row(result, w, model_name))
                continue

            print(f"[run ] 세션 {ts} 트랙 {len(session_wavs)}개 ...", flush=True)
            run = run_session(session_wavs, names, backend, mode=args.mode, model_name=model_name,
                              gate=gate, workers=workers, out_dir=out_dir)
            summary = run["summary"]
            for w, result in run["results"].items():
                rows.append(_row(result, w, model_name))
                print(f"       {w.name} ({result['speaker']}) 줄 {result['clips']} · 실패 {result['failed']} · "
                      f"{result['transcribe_sec']}s (오디오 {result['audio_duration_sec']}s)")
            print(f"       호출 {summary['calls']} · 보낸 오디오 {summary['audio_sent_s']}s / 트랙 {summary['track_s']}s · "
                  f"p50 {summary['transcribe_p50_s']}s p95 {summary['transcribe_p95_s']}s · 거름 {summary['gated']}")
            if run["transcript_json"]:
                print(f"[merge] 세션 {ts} → {run['transcript_json'].name}")

    print("\n=== 처리 시간 요약 (기준: 오디오 1분당 30초 이내) ===")
    for r in rows:
        pm = r["per_min"]
        verdict = "-" if pm is None else ("PASS" if pm <= MAX_SEC_PER_AUDIO_MIN else "FAIL")
        print(f"{r['speaker'][:13]:<14}{r['file'][:33]:<34}{r['model']:<16}{r['audio']:>10.1f}{r['elapsed']:>10.1f}"
              f"{('-' if pm is None else f'{pm:.1f}'):>10}  {verdict}")
    print(f"\n결과 저장: {out_dir}")
    if not args.no_timing_summary:
        timing_rows = collect_timing_rows(out_dir)
        write_timing_summary(timing_rows, TIMING_SUMMARY_PATH)
        print(f"누적 처리 시간 기록: {TIMING_SUMMARY_PATH} ({len(timing_rows)}건)")
    return 0


def _make_backend(kind: str, model_name: str, args):
    from stt import batch as B
    if kind == "elice":
        return B.make_backend("elice", "", args.mode)
    from stt.local import LocalStt
    be = B.make_backend("local", model_name, args.mode, beam=args.beam_size)
    be.compute_type = args.compute_type
    be.language = args.language
    return be


def _default_workers(kind: str) -> int:
    from stt import batch as B
    return B.default_workers(kind)


def _make_gate():
    from stt.speech_gate import SpeechGate
    return SpeechGate()


def _save(result: dict, stem: Path) -> None:
    stem.with_suffix(".json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    stem.with_suffix(".txt").write_text(result["text"] + "\n", encoding="utf-8")


def _row(result: dict, wav: Path, model_name: str) -> dict:
    uid, _ = parse_wav_stem(wav.stem)
    return {"speaker": result.get("speaker", uid), "file": wav.name, "model": model_name,
            "audio": result["audio_duration_sec"], "elapsed": result["transcribe_sec"],
            "per_min": result.get("sec_per_audio_min")}


if __name__ == "__main__":
    sys.exit(main())
