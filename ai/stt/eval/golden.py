"""골든셋을 회의 시계 위에 정렬한 리플레이 세션으로 만들고, 배치 전사를 채점한다.

골든셋(meeting-01/02)은 화자별 트랙이 각자 0초에서 시작해 회의 순서를 복원할 수 없다
(meta.json known_issues). 대본 순서(truth_utterances.json 의 seq)대로 각 화자의 발화 덩어리를
한 시간축에 놓아 정렬본을 만든다. **목소리는 진짜지만 시간축은 합성이다.** 순서·시각 지표는
"합성 순서 대비" 로 읽어야 하고, 실제 회의 순서 복원 능력은 실제 녹음으로만 잴 수 있다.

    python -m stt.eval.golden align  --golden <meeting-01> --out <meeting-01-aligned>
    python -m stt.eval.golden score  --session <aligned> --mode chunk --backend local
    python -m stt.eval.golden matrix --session <aligned> [--elice --yes]

score 가 내는 것 (멘토 2차 리뷰의 비교 지표):
  CER(화자별·문자 가중), 전사 시간 p50/p95/max, 벽시계, 호출 수, 보낸 오디오 초, 비용(Elice),
  유실률(정답 발화 중 텍스트가 0인 것 + 게이트 거름 + 실패), 순서 정합(턴 화자열 편집거리,
  인접 쌍 뒤바뀜), 시작 시각 절대 오차, 삽입률(환각 대용), track 모드의 무음 자리 단어 수,
  CPU 초, 최대 RSS.
"""

from __future__ import annotations

import argparse
import difflib
import json
import resource
import shutil
import sys
import time
from datetime import date
from pathlib import Path

import numpy as np
import soundfile as sf

from stt import batch as B
from stt.eval.eval import score as cer_score
from stt.speech_gate import SpeechGate
from stt.eval.sysinfo import peak_rss_bytes

SR = 16_000
RUN_GAP_S = 3.0        # 한 화자 안에서 이만큼 비면 다른 발화 덩어리로 본다
PLACE_GAP_S = 1.0      # 정렬본에서 발화 덩어리 사이에 두는 침묵


# ────────────────────────────────────────────────────────────── align
def _runs(utts, gap_s: float):
    runs, cur = [], []
    for u in utts:
        if cur and u.start_ms - cur[-1].end_ms > gap_s * 1000:
            runs.append(cur)
            cur = []
        cur.append(u)
    if cur:
        runs.append(cur)
    return runs


def align(golden: Path, out: Path) -> Path:
    truth = json.loads((golden / "truth_utterances.json").read_text(encoding="utf-8"))
    audio_dir = golden / "audio"
    tracks = {p.stem: B.load_track(p) for p in sorted(audio_dir.glob("*.wav"))}

    # 화자별 발화 덩어리. 대본에서 그 화자가 몇 번 말하는지에 맞춰 덩어리를 나눈다.
    per_speaker_runs: dict[str, list] = {}
    for name, audio in tracks.items():
        utts = B.cut(audio, name)
        runs = _runs(utts, RUN_GAP_S)
        want = sum(1 for t in truth if t["speaker"] == name)
        while len(runs) > want > 0:            # 덩어리가 대본보다 많으면 뒤에서 합친다
            last = runs.pop()
            runs[-1] = runs[-1] + last
        while 0 < len(runs) < want:            # 적으면 가장 큰 내부 공백에서 쪼갠다
            best = None                        # (gap_ms, run_idx, split_idx)
            for ri, run in enumerate(runs):
                for k in range(1, len(run)):
                    g = run[k].start_ms - run[k - 1].end_ms
                    if best is None or g > best[0]:
                        best = (g, ri, k)
            if best is None:
                break
            _, ri, k = best
            runs[ri:ri + 1] = [runs[ri][:k], runs[ri][k:]]
        per_speaker_runs[name] = runs

    # 대본 순서대로 배치
    cursor = PLACE_GAP_S
    placed = []
    used: dict[str, int] = {}
    for t in truth:
        name = t["speaker"]
        idx = used.get(name, 0)
        runs = per_speaker_runs.get(name, [])
        if idx >= len(runs):
            placed.append({**t, "start": None, "end": None, "note": "이 화자에게 남은 발화 덩어리가 없다"})
            continue
        run = runs[idx]
        used[name] = idx + 1
        src_s, src_e = run[0].start_ms / 1000, run[-1].end_ms / 1000
        placed.append({**t, "start": round(cursor, 3), "end": round(cursor + (src_e - src_s), 3),
                       "src_start": src_s, "src_end": src_e})
        cursor += (src_e - src_s) + PLACE_GAP_S

    total = int((cursor + PLACE_GAP_S) * SR)
    out.mkdir(parents=True, exist_ok=True)
    for name, audio in tracks.items():
        canvas = np.zeros(total, dtype=np.float32)
        for p in placed:
            if p["speaker"] != name or p["start"] is None:
                continue
            a, b = int(p["src_start"] * SR), int(p["src_end"] * SR)
            dst = int(p["start"] * SR)
            seg = audio[a:b]
            canvas[dst:dst + len(seg)] = seg
        sf.write(str(out / f"{name}.wav"), canvas, SR, subtype="PCM_16")

    (out / "truth_aligned.json").write_text(json.dumps(placed, ensure_ascii=False, indent=1), encoding="utf-8")
    shutil.copy(golden / "truth_by_speaker.json", out / "truth_by_speaker.json")
    meta = json.loads((golden / "meta.json").read_text(encoding="utf-8"))
    meta.update({
        "name": f"{meta.get('name', golden.name)}-aligned",
        "derived_from": golden.name,
        "timeline": "합성. 대본(truth_utterances.json) 순서대로 발화 덩어리를 놓고 사이에 1.0초 침묵. "
                    "목소리는 원본 그대로. 순서·시각 지표는 이 합성 순서 대비다.",
        "created": date.today().isoformat(),
    })
    (out / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"정렬본: {out}  길이 {total / SR:.1f}초  발화 {sum(1 for p in placed if p['start'] is not None)}/{len(placed)}")
    for p in placed:
        s = "-" if p["start"] is None else f"{p['start']:6.1f}~{p['end']:6.1f}"
        print(f"  seq{p['seq']} {p['speaker']:<5} {s}  {p['text'][:28]}…")
    return out


# ────────────────────────────────────────────────────────────── score
def _speaker_turns(seq):
    out = []
    for s in seq:
        if not out or out[-1] != s:
            out.append(s)
    return out


def _edits(a: list[str], b: list[str]) -> int:
    n = 0
    for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(a=a, b=b, autojunk=False).get_opcodes():
        if tag != "equal":
            n += max(i2 - i1, j2 - j1)
    return n


def score(session: Path, mode: str, backend_kind: str, model: str, gate_on: bool, workers: int | None,
          yes: bool, *, beam: int = 5, cond: bool | None = None, hst: float | None = None,
          preprocess: str | None = None, pack_turns: bool = True, merge: bool = True,
          tag: str = "", out_dir: Path | None = None) -> dict | None:
    """정렬본 하나를 한 설정으로 전사해 지표를 JSON 으로 남긴다.

    preprocess: "highpass" 면 100~7500Hz 대역 제한을 트랙에 건다 (0007 의 필터).
    tag: 결과 파일 이름에 붙는 꼬리표. 같은 모드의 변형을 구분한다.
    """
    truth_by = json.loads((session / "truth_by_speaker.json").read_text(encoding="utf-8"))
    aligned = json.loads((session / "truth_aligned.json").read_text(encoding="utf-8"))
    tracks = [t for t in B.discover(session) if t.speaker_id in truth_by]

    if backend_kind == "elice" and not yes:
        from stt.elice import whisper_krw
    from stt.eval.eval import SCORING_VERSION
        est = sum(sum(u.duration_s for u in B.cut(B.load_track(t.path), t.speaker_id)) for t in tracks)
        print(f"Elice {mode}: 발화 합 {est:.0f}초 · 예상 약 {whisper_krw(est):.0f}원. --yes 로 승인.")
        return None
    backend = B.make_backend(backend_kind, model, mode, beam=beam, cond=cond, hst=hst)
    gate = SpeechGate() if gate_on else None
    w = workers if workers is not None else B.default_workers(backend_kind)
    pre = None
    if preprocess == "highpass":
        from stt.eval.noise_filter_bench import bandlimit
        pre = lambda audio, sr: bandlimit(audio, sr)  # noqa: E731

    ru0 = resource.getrusage(resource.RUSAGE_SELF)
    lines, stats = B.run(tracks, backend, mode=mode, gate=gate, workers=w, pack_turns=pack_turns,
                         merge=merge, preprocess=pre)
    ru1 = resource.getrusage(resource.RUSAGE_SELF)
    cpu_s = (ru1.ru_utime + ru1.ru_stime) - (ru0.ru_utime + ru0.ru_stime)

    # CER: 화자별 · 문자 가중
    per = {}
    for name, ref in truth_by.items():
        hyp = " ".join(ln.text for ln in sorted(lines, key=lambda x: x.start_ms) if ln.speaker_id == name and ln.text)
        s = cer_score(ref, hyp)
        per[name] = {"cer": s["cer_nospace"], "ins": s.get("ins", 0), "ref_words": s.get("ref_words", 0),
                     "chars": len(ref), "hyp": hyp}
    tot = sum(v["chars"] for v in per.values())
    cer = sum(v["cer"] * v["chars"] for v in per.values() if v["cer"] is not None) / tot
    ins_rate = sum(v["ins"] for v in per.values()) / max(1, sum(v["ref_words"] for v in per.values()))

    # 유실: 정답 발화 구간 안에 텍스트가 하나도 없는 것
    lost = 0
    start_err = []
    for t in aligned:
        if t["start"] is None:
            continue
        inside = [ln for ln in lines if ln.speaker_id == t["speaker"]
                  and ln.start_ms / 1000 < t["end"] + 0.5 and ln.end_ms / 1000 > t["start"] - 0.5 and ln.text]
        if not inside:
            lost += 1
        else:
            start_err.append(abs(min(ln.start_ms for ln in inside) / 1000 - t["start"]))
    n_truth = sum(1 for t in aligned if t["start"] is not None)

    # 순서: 턴 화자열 비교
    truth_turns = _speaker_turns([t["speaker"] for t in aligned if t["start"] is not None])
    hyp_turns = _speaker_turns([ln.speaker_id for ln in lines if ln.text])
    order_edits = _edits(truth_turns, hyp_turns)

    from stt.elice import whisper_krw
    krw = round(whisper_krw(stats.audio_sent_s), 1) if backend_kind == "elice" else 0.0
    meeting_h = (stats.track_s / max(1, stats.tracks)) / 3600
    out = {
        "session": session.name, "mode": mode, "backend": stats.backend, "gate": gate_on,
        "beam": beam, "cond": cond, "hst": hst, "preprocess": preprocess, "pack_turns": pack_turns,
        "merge": merge, "workers": w, "tag": tag, "scoring_version": SCORING_VERSION,
        "krw_per_meeting_hour": round(krw / meeting_h, 1) if meeting_h > 0 else None,
        "cpu_s_per_speech_s": round(cpu_s / stats.speech_s, 3) if stats.speech_s > 0 else None,
        "wall_per_meeting_s": round(stats.wall_s / meeting_h / 3600, 3) if meeting_h > 0 else None,
        "cer": round(cer, 4), "cer_by_speaker": {k: round(v["cer"], 4) for k, v in per.items()},
        "insertion_rate": round(ins_rate, 4),
        "lost_utterances": f"{lost}/{n_truth}", "gated": stats.gated, "failed": stats.failed,
        "order_edits": order_edits, "turns_truth": len(truth_turns), "turns_hyp": len(hyp_turns),
        "start_abs_err_mean_s": round(float(np.mean(start_err)), 2) if start_err else None,
        "start_abs_err_max_s": round(float(np.max(start_err)), 2) if start_err else None,
        "krw": krw,
        "cpu_s": round(cpu_s, 1), "peak_rss_gb": round(peak_rss_bytes(ru1) / 1e9, 2),
        **{k: v for k, v in stats.summary().items() if k not in ("mode", "backend")},
    }
    stem = f"score_{mode}_{backend_kind}{'' if backend_kind == 'elice' else '-' + model}{'-' + tag if tag else ''}"
    path = (out_dir or session) / f"{stem}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({**out, "hyp_by_speaker": {k: v["hyp"] for k, v in per.items()}},
                               ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps(out, ensure_ascii=False))
    return out


def matrix(session: Path, model: str, elice: bool, yes: bool) -> None:
    rows = []
    for kind, mode in [("local", "clip"), ("local", "chunk"), ("local", "track")] + \
                      ([("elice", "clip"), ("elice", "chunk")] if elice else []):
        r = score(session, mode, kind, model, True, None, yes)
        if r:
            rows.append(r)
    print("\n| 백엔드 | 모드 | CER | 유실 | 순서편집 | 시작오차 평균 | p50 | p95 | 호출 | 보낸 초 | 원 | CPU초 | RSS |")
    print("|---|---|---|---|---|---|---|---|---|---|---|---|---|")
    for r in rows:
        print(f"| {r['backend']} | {r['mode']} | {r['cer'] * 100:.2f}% | {r['lost_utterances']} | {r['order_edits']} | "
              f"{r['start_abs_err_mean_s']} | {r['transcribe_p50_s']} | {r['transcribe_p95_s']} | {r['calls']} | "
              f"{r['audio_sent_s']} | {r['krw']} | {r['cpu_s']} | {r['peak_rss_gb']}GB |")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("align"); a.add_argument("--golden", type=Path, required=True); a.add_argument("--out", type=Path, required=True)
    s = sub.add_parser("score"); s.add_argument("--session", type=Path, required=True)
    s.add_argument("--mode", choices=["clip", "chunk", "track", "whole"], default="chunk")
    s.add_argument("--backend", choices=["local", "elice"], default="local")
    s.add_argument("--model", default="large-v3-turbo"); s.add_argument("--no-gate", action="store_true")
    s.add_argument("--workers", type=int); s.add_argument("--yes", action="store_true")
    s.add_argument("--beam", type=int, default=5)
    s.add_argument("--cond", choices=["on", "off"], default=None, help="condition_on_previous_text 를 강제로")
    s.add_argument("--hst", type=float, default=None, help="hallucination_silence_threshold 를 강제로 (0 은 끔)")
    s.add_argument("--preprocess", choices=["highpass"], default=None)
    s.add_argument("--no-pack-turns", action="store_true", help="턴마다 묶음 하나")
    s.add_argument("--no-merge", action="store_true", help="턴 병합 없이 클립 단위 줄")
    s.add_argument("--tag", default=""); s.add_argument("--out-dir", type=Path, default=None)
    m = sub.add_parser("matrix"); m.add_argument("--session", type=Path, required=True)
    m.add_argument("--model", default="large-v3-turbo"); m.add_argument("--elice", action="store_true"); m.add_argument("--yes", action="store_true")
    args = ap.parse_args(argv)
    if args.cmd == "align":
        align(args.golden.expanduser(), args.out.expanduser())
    elif args.cmd == "score":
        hst = args.hst
        score(args.session.expanduser(), args.mode, args.backend, args.model, not args.no_gate, args.workers, args.yes,
              beam=args.beam, cond=None if args.cond is None else args.cond == "on", hst=hst,
              preprocess=args.preprocess, pack_turns=not args.no_pack_turns, merge=not args.no_merge,
              tag=args.tag, out_dir=args.out_dir)
    else:
        matrix(args.session.expanduser(), args.model, args.elice, args.yes)
    return 0


if __name__ == "__main__":
    sys.exit(main())
