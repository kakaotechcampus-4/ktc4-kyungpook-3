"""화자별 wav 트랙을 하나의 m4a 로 섞는다(#659). 웹에서 회의 원문을 다시 들을 때 쓰는 녹음이다.

TrackWriter 가 쓰는 트랙은 모두 16kHz 모노 PCM_16 이고 회의 시작을 샘플 0 으로 맞춰 둔 것이다(공백은 무음으로 채움).
그래서 트랙을 샘플 0 에 맞춰 더하면 발화 시각(Source.start_ms)이 섞은 녹음의 위치와 같다. 다른 형식이면 시각이
어긋나므로 ValueError 로 막는다. 더한 값이 1.0 을 넘으면 가장 큰 값이 CEILING 이 되게 줄여 찢어지지 않게 한다.
인코딩은 PyAV 에 들어 있는 aac 를 쓴다. 시스템 ffmpeg 에 기대지 않는다.

discord 이름은 여기 없다. 경로 목록만 받는다.
"""

from __future__ import annotations

from pathlib import Path

import av
import numpy as np
import soundfile as sf

SAMPLE_RATE = 16000
BIT_RATE = 32000
CEILING = 0.95            # 더한 값이 1.0 을 넘으면 최댓값이 이 값이 되게 줄인다. aac 가 되살릴 때 조금 넘치는 몫을 남긴다
BLOCK = SAMPLE_RATE * 10   # 한 번에 읽는 샘플 수. 긴 회의도 메모리에 통째로 올리지 않는다


def _open_all(tracks: list[Path]) -> list[sf.SoundFile]:
    files: list[sf.SoundFile] = []
    try:
        for t in tracks:
            f = sf.SoundFile(str(t))
            files.append(f)
            if f.samplerate != SAMPLE_RATE or f.channels != 1:
                raise ValueError(f"트랙이 16kHz 모노가 아니다: {Path(t).name} ({f.samplerate}Hz, {f.channels}ch)")
        return files
    except BaseException:
        for f in files:
            f.close()
        raise


def _blocks(files: list[sf.SoundFile], length: int):
    """트랙을 샘플 0 에 맞춰 더한 블록을 앞에서부터 돌려준다. 짧은 트랙은 0 으로 채운다."""
    for f in files:
        f.seek(0)
    done = 0
    while done < length:
        n = min(BLOCK, length - done)
        mix = np.zeros(n, dtype=np.float32)
        for f in files:
            x = f.read(n, dtype="float32", always_2d=False)
            mix[:len(x)] += x
        yield mix
        done += n


def mix_to_m4a(tracks: list[Path], dest: Path) -> int:
    """tracks 를 하나의 m4a(aac, 16kHz 모노, 32kbps)로 섞어 dest 에 쓰고 바이트 수를 돌려준다.

    dest 옆 .part 에 쓴 뒤 바꿔치기해서 쓰다 끊긴 파일이 dest 로 남지 않는다. 트랙이 없거나 형식이 다르면 ValueError."""
    if not tracks:
        raise ValueError("섞을 트랙이 없다")
    dest = Path(dest)
    part = dest.with_suffix(".part")
    files = _open_all([Path(t) for t in tracks])
    try:
        length = max(f.frames for f in files)
        peak = max((float(np.max(np.abs(b))) for b in _blocks(files, length)), default=0.0)
        scale = CEILING / peak if peak > 1.0 else 1.0
        try:
            with av.open(str(part), mode="w", format="mp4", options={"movflags": "+faststart"}) as out:
                stream = out.add_stream("aac", rate=SAMPLE_RATE, layout="mono")
                stream.bit_rate = BIT_RATE
                pts = 0
                for block in _blocks(files, length):
                    frame = av.AudioFrame.from_ndarray((block * scale).reshape(1, -1), format="flt", layout="mono")
                    frame.sample_rate = SAMPLE_RATE
                    frame.pts = pts
                    pts += len(block)
                    out.mux(stream.encode(frame))
                out.mux(stream.encode(None))
            part.replace(dest)
        except BaseException:
            part.unlink(missing_ok=True)
            raise
    finally:
        for f in files:
            f.close()
    return dest.stat().st_size
