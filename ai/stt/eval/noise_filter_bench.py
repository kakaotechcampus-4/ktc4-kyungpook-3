"""전사 앞에 노이즈 필터를 두면 CER 이 달라지나. 로컬 faster-whisper, 무과금.

조건 셋을 같은 오디오에 건다.
  원본        그대로
  대역제한     100~7500Hz 밖을 FFT 로 지운다 (ffmpeg highpass/lowpass 에 해당)
  스펙트럼게이트  조용한 프레임 10% 의 스펙트럼을 소음 프로필로 삼아 그 아래를 지운다 (ffmpeg afftdn 에 해당)

ffmpeg 없이 numpy 로 만든 것이라 블로그나 문서의 필터와 값이 같지는 않다. 필터가 오디오를
실제로 얼마나 바꿨는지(에너지 비율)도 같이 찍는다. 0.000% 면 뺄 소음이 없었던 것이다.

로컬 위스퍼는 기본 설정에서 결과가 실행마다 흔들린다 (temperature 폴백이 샘플링을 쓴다).
필터 효과를 재려면 --temperature 0 으로 고정하거나 --repeat 로 여러 번 돌려 편차를 본다.

사용 (ai/ 안에서):
  .venv/bin/python -m stt.eval.noise_filter_bench --tracks "<화자별 wav 디렉토리>" --truth truth_by_speaker.json
  .venv/bin/python -m stt.eval.noise_filter_bench --pairs 녹음.wav=정답.txt --temperature 0 --repeat 3

--truth 는 {화자이름: 정답문} JSON 이고 wav 파일명(확장자 뺀 것)이 화자이름이어야 한다.
정답 파일은 팀원 발화 내용이라 레포에 없다.
"""

from __future__ import annotations

import argparse
import json
import statistics
import time
from pathlib import Path

import numpy as np
import soundfile as sf

from stt.eval.eval import score


def bandlimit(x: np.ndarray, sr: int, lo: float = 100.0, hi: float = 7500.0) -> np.ndarray:
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / sr)
    X[(f < lo) | (f > hi)] = 0
    return np.fft.irfft(X, n=len(x)).astype(np.float32)


def spectral_gate(x: np.ndarray, sr: int, n: int = 512, hop: int = 128, k: float = 1.5) -> np.ndarray:
    win = np.hanning(n).astype(np.float32)
    pad = np.concatenate([np.zeros(n - hop, np.float32), x.astype(np.float32), np.zeros(n, np.float32)])
    frames = np.lib.stride_tricks.sliding_window_view(pad, n)[::hop] * win
    S = np.fft.rfft(frames, axis=1)
    mag = np.abs(S)
    energy = mag.sum(axis=1)
    quiet = mag[energy <= np.quantile(energy, 0.10)]
    thr = quiet.mean(axis=0) + k * quiet.std(axis=0)
    mask = (mag > thr).astype(np.float32)
    ker = np.ones(3, np.float32) / 3
    mask = np.apply_along_axis(lambda m: np.convolve(m, ker, "same"), 0, mask)
    mask = np.apply_along_axis(lambda m: np.convolve(m, ker, "same"), 1, mask)
    out = np.fft.irfft(S * mask, n=n, axis=1) * win
    y = np.zeros(len(pad), np.float32)
    wsum = np.zeros(len(pad), np.float32)
    for i in range(len(frames)):
        y[i * hop:i * hop + n] += out[i]
        wsum[i * hop:i * hop + n] += win * win
    y = y / np.maximum(wsum, 1e-6)
    return y[n - hop:n - hop + len(x)].astype(np.float32)


CONDITIONS = {"원본": lambda x, sr: x, "대역제한": bandlimit, "스펙트럼게이트": spectral_gate}


def changed_energy(x: np.ndarray, y: np.ndarray) -> float:
    d = y - x
    return float(np.sum(d * d) / max(np.sum(x * x), 1e-12) * 100)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--tracks", type=Path, help="화자별 wav 디렉토리 (파일명 = 화자이름)")
    ap.add_argument("--truth", type=Path, help="{화자이름: 정답문} JSON")
    ap.add_argument("--pairs", nargs="*", default=[], help="wav=정답.txt 쌍")
    ap.add_argument("--model", default="large-v3-turbo")
    ap.add_argument("--temperature", type=float, default=None,
                    help="0 이면 결정적. 안 주면 faster-whisper 기본(폴백 샘플링)")
    ap.add_argument("--repeat", type=int, default=1)
    args = ap.parse_args()

    items: list[tuple[str, Path, str]] = []
    if args.tracks:
        truth = json.load(open(args.truth, encoding="utf-8"))
        for p in sorted(args.tracks.expanduser().glob("*.wav")):
            if p.stem in truth:
                items.append((p.stem, p, truth[p.stem]))
    for pair in args.pairs:
        wav, txt = pair.split("=", 1)
        items.append((Path(wav).stem, Path(wav), Path(txt).read_text(encoding="utf-8").strip()))
    if not items:
        raise SystemExit("입력이 없다. --tracks/--truth 또는 --pairs 를 준다")

    from faster_whisper import WhisperModel
    model = WhisperModel(args.model, device="cpu", compute_type="int8")
    kw = {} if args.temperature is None else {"temperature": args.temperature}

    def tx(x: np.ndarray) -> tuple[str, float]:
        t = time.monotonic()
        segs, _ = model.transcribe(x, language="ko", beam_size=5, vad_filter=False, **kw)
        return " ".join(s.text.strip() for s in segs), time.monotonic() - t

    print(f"모델 {args.model} · temperature {'기본(폴백)' if args.temperature is None else args.temperature} "
          f"· 반복 {args.repeat}")
    print(f"{'파일':<14}{'길이':>7}  " + "  ".join(f"{c:>12}" for c in CONDITIONS) + "   (에너지 변화)")
    totals = {c: [] for c in CONDITIONS}
    for name, p, ref in items:
        x, sr = sf.read(str(p), dtype="float32")
        if x.ndim > 1:
            x = x.mean(axis=1)
        if sr != 16_000:
            raise SystemExit(f"{p.name}: {sr}Hz. 16000Hz 로 맞춰 주세요")
        cells, changes = [], []
        for cname, fn in CONDITIONS.items():
            y = fn(x, sr)
            changes.append(changed_energy(x, y))
            cers = []
            for _ in range(args.repeat):
                hyp, _took = tx(y)
                cers.append(score(ref, hyp)["cer_nospace"] * 100)
            totals[cname].append((statistics.mean(cers), len(ref)))
            if args.repeat > 1:
                cells.append(f"{statistics.mean(cers):5.2f}±{statistics.pstdev(cers):4.2f}%")
            else:
                cells.append(f"{cers[0]:11.2f}%")
        print(f"{name:<14}{len(x) / sr:6.1f}초  " + "  ".join(f"{c:>12}" for c in cells)
              + "   (" + " / ".join(f"{v:.2f}%" for v in changes) + ")", flush=True)

    print("\n문자 가중 평균 CER")
    for cname, rows in totals.items():
        n = sum(w for _, w in rows)
        print(f"  {cname:<8} {sum(c * w for c, w in rows) / n:5.2f}%  ({len(rows)}건, {n}자)")


if __name__ == "__main__":
    main()
