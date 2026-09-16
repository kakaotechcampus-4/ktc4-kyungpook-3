"""클립 단위 CER. 실시간 경로가 STT 에 보내는 모양 그대로 잰다.

화자별 wav 를 우리 에너지 VAD 로 발화 클립으로 자르고, 클립마다 따로 전사한 뒤 시간순으로
이어 정답과 비교한다. 트랙 통째 전사(stt/transcribe.py + stt/eval/eval.py)와 같은 모델이라도
값이 다르다 — 클립은 앞뒤 문맥이 없다. 두 값을 나란히 두는 것이 이 스크립트의 목적이다.

기본은 로컬 faster-whisper 라 무과금이다. --stt elice 는 --yes 없이는 견적만 찍고 끝난다.

사용 (ai/ 안에서):
  .venv/bin/python -m stt.eval.clip_cer --tracks "<화자별 wav 디렉토리>" --truth truth_by_speaker.json
  .venv/bin/python -m stt.eval.clip_cer --tracks "<...>" --truth "<...>" --stt elice --yes

--truth 는 {화자이름: 정답문} JSON 이고 wav 파일명(확장자 뺀 것)이 화자이름이어야 한다.
정답 파일은 팀원 발화 내용이라 레포에 없다.
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import numpy as np
import soundfile as sf

from stt.eval.eval import score
from stt.vad import StreamingVAD

SR = 16_000


def cut(audio: np.ndarray, sr: int):
    v = StreamingVAD(speaker_id="x", sample_rate=sr)
    n = sr * 20 // 1000
    out = []
    for i in range(0, len(audio) - n + 1, n):
        out += v.feed(audio[i:i + n], i * 1000 // sr)
    return out + v.flush()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--tracks", type=Path, required=True, help="화자별 wav 디렉토리 (파일명 = 화자이름)")
    ap.add_argument("--truth", type=Path, required=True, help="{화자이름: 정답문} JSON")
    ap.add_argument("--stt", choices=["local", "elice"], default="local")
    ap.add_argument("--model", default="large-v3-turbo", help="--stt local 일 때 faster-whisper 모델")
    ap.add_argument("--yes", action="store_true", help="유료 실행을 승인한다")
    args = ap.parse_args()

    truth = json.load(open(args.truth, encoding="utf-8"))
    items = []
    for p in sorted(args.tracks.expanduser().glob("*.wav")):
        if p.stem not in truth:
            continue
        audio, sr = sf.read(str(p), dtype="float32")
        if audio.ndim > 1:
            audio = audio.mean(axis=1)
        if sr != SR:
            raise SystemExit(f"{p.name}: {sr}Hz. 16000Hz 로 맞춰 주세요")
        items.append((p.stem, cut(audio, sr), truth[p.stem]))
    if not items:
        raise SystemExit("정답이 있는 wav 가 없다")

    audio_s = sum((u.end_ms - u.start_ms) / 1000 for _, utts, _ in items for u in utts)
    if args.stt == "elice":
        from shared.config import settings
        from stt.elice import EliceStt, whisper_krw
        settings()
        print(f"클립 {sum(len(u) for _, u, _ in items)}개 · 합계 {audio_s:.0f}초 · 예상 {whisper_krw(audio_s):.0f}원 "
              f"(최소 과금 단위 미확인)")
        if not args.yes:
            print("유료 실행이다. 승인하려면 --yes 를 붙여 다시 실행한다.")
            return
        backend = EliceStt()

        def tx(pcm):
            return backend.transcribe(pcm, SR).text
    else:
        from faster_whisper import WhisperModel
        model = WhisperModel(args.model, device="cpu", compute_type="int8")

        def tx(pcm):
            segs, _ = model.transcribe(pcm, language="ko", beam_size=5, vad_filter=False)
            return " ".join(s.text.strip() for s in segs)

    t0 = time.monotonic()
    rows = []
    for name, utts, ref in items:
        text = " ".join(tx(u.pcm) for u in utts)
        cer = score(ref, text)["cer_nospace"] * 100
        rows.append((name, len(utts), len(ref), cer))
        print(f"{name:<8} 클립 {len(utts):2d}개  CER {cer:5.2f}%", flush=True)
    total = sum(r[2] for r in rows)
    print(f"\n문자 가중 평균 CER {sum(r[3] * r[2] for r in rows) / total:5.2f}%  "
          f"({len(rows)}명, {total}자, {args.stt}) · {time.monotonic() - t0:.0f}초")


if __name__ == "__main__":
    main()
