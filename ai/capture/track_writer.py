"""화자별 오디오를 파일로 남긴다.

tracks/<화자>.wav 는 회의 전체 길이의 연속 트랙이다. 말 안 한 구간은 무음으로 채운다.
골든셋 재측정(VAD 파라미터나 STT 모델을 바꿔 처음부터 다시 돌리는 것)에 필요하고,
이게 없으면 녹음 세션을 다시 해야 한다. 메모리에 쌓지 않고 파일에 바로 흘린다. 60분 5인이면 float32로 1GB가 넘는다.
"""

from __future__ import annotations

import queue
import threading
from pathlib import Path

import numpy as np
import soundfile as sf

# offset_ms 는 도착 시각(monotonic)이라 뛰지 않는다. 그래도 상한을 하나 두는 것은 값이
# 깨졌을 때 락을 쥔 채 수 GB 를 쓰지 않으려는 것뿐이다. 회의 한 판을 넘는 길이로 잡는다.
# 60초였을 때는 1분 넘게 조용한 정상 화자의 트랙이 앞으로 당겨져 시간축이 어긋났다.
MAX_GAP_MS = 4 * 60 * 60 * 1000


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


class TrackPool:
    """화자별 wav 를 전용 스레드에서 쓴다.

    sink.write 는 이벤트 루프에서 돌기 때문에 (voice/state.py:189-198) 거기서 파일 IO 를 하면
    하트비트와 슬래시 응답이 같이 밀린다. sink 는 큐에 넣기만 하고 TrackWriter 인스턴스는
    이 스레드만 만진다.

    큐는 유한하다. 무한 큐는 쓰기가 막히는 순간 그대로 메모리다 (16k float32 = 화자당 초당
    64KB). 넘치면 버리고 dropped 로 센다.
    """

    QUEUE_MAX = 4096  # 20ms 패킷 기준 약 80초분

    def __init__(self, out_dir: Path, ts: int) -> None:
        self.out_dir = out_dir
        self.ts = ts
        self.dropped = 0
        self._q: queue.Queue = queue.Queue(maxsize=self.QUEUE_MAX)
        self._writers: dict[int, TrackWriter] = {}
        self._thread = threading.Thread(target=self._run, name="track-writer", daemon=True)
        self._thread.start()

    def submit(self, uid: int, samples, offset_ms: int) -> None:
        """StreamingSink.on_samples 훅. 이벤트 루프에서 불린다. 절대 막히면 안 된다."""
        try:
            self._q.put_nowait((uid, samples, offset_ms))
        except queue.Full:
            self.dropped += 1

    def _run(self) -> None:
        while True:
            item = self._q.get()
            if item is None:
                return
            uid, samples, offset_ms = item
            try:
                w = self._writers.get(uid)
                if w is None:
                    w = self._writers[uid] = TrackWriter(self.out_dir / f"{uid}_{self.ts}.wav")
                w.write_at(samples, offset_ms)
            except Exception as e:
                # 트랙 하나가 깨져도 회의를 끝내는 것이 먼저다. 건수는 close() 가 보고한다.
                print(f"[track] uid={uid} 쓰기 실패: {type(e).__name__}: {e}", flush=True)

    def close(self) -> list[dict]:
        """센티넬을 넣고 스레드를 기다린 뒤 매니페스트 항목을 만든다. 파일 IO 라 스레드에서 부른다.

        display_name 은 자리만 만들어 둔다. 값은 호출자가 guild.get_member 로 채운다.
        """
        try:
            self._q.put(None, timeout=5)
        except queue.Full:
            pass  # 스레드가 이미 죽었다. 아래 join 이 바로 돌아오고 파일은 여기서 닫는다
        self._thread.join(timeout=10)
        entries: list[dict] = []
        for uid, w in sorted(self._writers.items()):
            dur = w.close()
            if dur <= 0:
                continue
            entries.append({
                "user_id": str(uid),
                "display_name": str(uid),
                "file": f"{self.out_dir.name}/{uid}_{self.ts}.wav",
                "duration_sec": round(dur, 2),
            })
        return entries
