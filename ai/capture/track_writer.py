"""화자별 오디오를 파일로 남긴다.

tracks/<화자>.wav 는 회의 전체 길이의 연속 트랙이다. 말 안 한 구간은 무음으로 채운다.
골든셋 재측정(VAD 파라미터나 STT 모델을 바꿔 처음부터 다시 돌리는 것)에 필요하고,
이게 없으면 녹음 세션을 다시 해야 한다. 메모리에 쌓지 않고 파일에 바로 흘린다 —
60분 5인이면 float32로 1GB가 넘는다.
"""

from __future__ import annotations

import threading
from pathlib import Path

import numpy as np
import soundfile as sf

# RTP 기준점이 어긋나면 offset_ms 가 몇 시간까지 튈 수 있는데 그대로 믿으면
# 락을 쥔 채 수 GB를 쓴다. 회의 중 이만큼 조용한 구간은 정상이 아니므로
# 채우지 않고 세어서 드러낸다.
MAX_GAP_MS = 60_000


class TrackWriter:
    """한 화자의 연속 트랙. 도착 시각을 기준으로 배치하고 빈 구간은 무음으로 채운다.

    디스코드는 말하지 않는 동안 패킷을 보내지 않을 수 있다. 받은 것만 이어붙이면
    시간축이 어긋나므로, 경과 시각을 기준으로 위치를 잡는다.
    """

    def __init__(self, path: Path, sample_rate: int = 16_000):
        path.parent.mkdir(parents=True, exist_ok=True)
        self._f = sf.SoundFile(
            str(path), mode="w", samplerate=sample_rate, channels=1, subtype="PCM_16"
        )
        self.sr = sample_rate
        self.written = 0          # 지금까지 쓴 샘플 수
        self.oversized_gaps = 0   # 상한을 넘은 offset_ms 건수
        self.backwards = 0        # 과거를 가리킨 offset_ms 건수
        self._lock = threading.Lock()

    def write_at(self, samples: np.ndarray, offset_ms: int) -> None:
        """offset_ms 위치에 쓴다. 그 앞이 비어 있으면 무음으로 메운다."""
        want = int(self.sr * offset_ms / 1000)
        max_gap = int(self.sr * MAX_GAP_MS / 1000)
        with self._lock:
            if self._f.closed:
                return
            gap = want - self.written
            if gap > max_gap:
                # 시각이 튀었다. 메우지 않고 이어붙인다. 세션 끝에 건수를 보고한다.
                self.oversized_gaps += 1
                gap = 0
            if gap > 0:
                # 한 번에 큰 배열을 만들지 않도록 나눠 쓴다
                chunk = self.sr  # 1초
                while gap > 0:
                    n = min(gap, chunk)
                    self._f.write(np.zeros(n, dtype=np.float32))
                    self.written += n
                    gap -= n
            elif gap < 0:
                # 이미 지나간 위치. 겹치면 순서가 꼬이므로 그냥 이어붙인다
                self.backwards += 1
            self._f.write(np.clip(samples, -1.0, 1.0))
            self.written += len(samples)

    def close(self) -> float:
        with self._lock:
            if self._f.closed:
                return self.written / self.sr
            self._f.close()
        return self.written / self.sr
