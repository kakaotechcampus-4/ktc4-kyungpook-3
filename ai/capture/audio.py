"""디스코드 PCM 을 STT 가 먹는 모양으로 바꾼다.

디스코드는 48kHz 스테레오 int16 을 준다. Whisper 계열은 16kHz 모노 float32 를 쓴다.
데시메이션 전에 3샘플 박스 평균을 걸어 에일리어싱을 줄인다. 음성 대역에는 이걸로 충분하다.
"""

from __future__ import annotations

import io

import numpy as np

TARGET_SR = 16_000
DECIM = 3  # 48000 / 16000


def pcm_to_mono16k(data: bytes) -> np.ndarray:
    if not data:
        return np.zeros(0, dtype=np.float32)
    # 패킷이 잘려 오는 경우가 있다. int16 스테레오이므로 4바이트 배수로 맞춘다.
    usable = (len(data) // 4) * 4
    if usable == 0:
        return np.zeros(0, dtype=np.float32)
    pcm = np.frombuffer(data[:usable], dtype="<i2")
    mono = pcm.reshape(-1, 2).mean(axis=1).astype(np.float32) / 32768.0
    n = (len(mono) // DECIM) * DECIM
    if n == 0:
        return np.zeros(0, dtype=np.float32)
    return mono[:n].reshape(-1, DECIM).mean(axis=1)


def to_wav_bytes(samples: np.ndarray, sample_rate: int = TARGET_SR) -> bytes:
    """메모리 상의 WAV. 임시 파일을 만들지 않는다."""
    import soundfile as sf

    buf = io.BytesIO()
    sf.write(buf, np.clip(samples, -1.0, 1.0), sample_rate, format="WAV", subtype="PCM_16")
    return buf.getvalue()
