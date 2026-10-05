"""정렬본 회의 여러 개를 화자별로 번갈아 이어 붙여 목표 길이의 합성 회의를 만든다.

긴 회의(10·30·60분)의 처리 시간과 메모리를 같은 조건으로 다시 재기 위해서다. 같은 음성을 반복하므로
정확도 지표로 쓰지 않는다.

  모든 소스에 있는 화자만 쓴다. 파일 이름(stem)이 화자다
  소스를 m01, m02, m01, ... 순서로 놓고 반복 사이에 gap_s 초 무음을 넣는다. 3초 이하면 턴이 합쳐진다
  한 반복은 화자마다 같은 길이다. 소스 안에서 짧은 트랙은 가장 긴 트랙에 맞춰 무음을 채운다
  누적 길이가 목표 이상이 되면 멈춘다. 마지막 반복을 자르지 않는다(문장 중간을 자르지 않기 위해)

60분 6인이면 트랙 하나가 int16 으로 약 115MB, float32 로 약 230MB 다. 화자마다 소스 트랙만 읽어 두고
반복을 파일에 바로 써서 회의 전체를 메모리에 들지 않는다.

실행 (ai/ 안에서):
  .venv/bin/python -m stt.eval.capacity.synth --source <m01-aligned> --source <m02-aligned> --out <폴더> [--minutes 60 --gap 5]
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import soundfile as sf

TIMELINE = "합성. 정렬본을 반복해 이어 붙임. 정확도 지표로 쓰지 않는다"


def build_long_meeting(sources: list[Path], out_dir: Path, target_s: float = 3600, gap_s: float = 5.0) -> dict:
    sources = [Path(s) for s in sources]
    speakers = sorted(set.intersection(*({p.stem for p in s.glob("*.wav")} for s in sources)))
    if not speakers:
        raise ValueError(f"모든 소스에 있는 화자가 없다: {[s.name for s in sources]}")
    info = [{spk: sf.info(str(s / f"{spk}.wav")) for spk in speakers} for s in sources]
    fmts = {(i.samplerate, i.channels) for per in info for i in per.values()}
    if len(fmts) > 1:
        raise ValueError(f"소스끼리 샘플레이트·채널이 다르다: {sorted(fmts)}")
    (sr, ch), = fmts

    # 길이는 샘플 단위 정수로 센다. 멈춤 판단과 meta 의 track_s 가 실제로 쓴 샘플 수와 맞게 하려고
    seg = [max(i.frames for i in per.values()) for per in info]
    gap_n = round(gap_s * sr)
    order, total = [], 0
    while True:
        k = len(order) % len(sources)
        order.append(k)
        total += seg[k]
        if total >= target_s * sr:
            break
        total += gap_n

    out_dir.mkdir(parents=True, exist_ok=True)
    for spk in speakers:
        clips = [sf.read(str(s / f"{spk}.wav"), dtype="int16", always_2d=True)[0] for s in sources]
        with sf.SoundFile(str(out_dir / f"{spk}.wav"), "w", sr, ch, subtype="PCM_16") as f:
            for n, k in enumerate(order):
                if n:
                    f.write(np.zeros((gap_n, ch), dtype=np.int16))
                f.write(clips[k])
                f.write(np.zeros((seg[k] - len(clips[k]), ch), dtype=np.int16))

    meta = {
        "kind": "synthetic-loop",
        "sources": [s.name for s in sources],
        "repeats": len(order),
        "gap_s": gap_s,
        "target_s": target_s,
        "track_s": total / sr,
        "sample_rate": sr,
        "timeline": TIMELINE,
    }
    (out_dir / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    return meta


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", type=Path, action="append", required=True, help="정렬본 회의 폴더. 순서대로 번갈아 쓴다")
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--minutes", type=float, default=60)
    ap.add_argument("--gap", type=float, default=5.0, help="반복 사이 무음(초)")
    args = ap.parse_args(argv)
    meta = build_long_meeting(args.source, args.out, target_s=args.minutes * 60, gap_s=args.gap)
    print(json.dumps(meta, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
