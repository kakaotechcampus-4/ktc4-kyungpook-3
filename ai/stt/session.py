"""회의 한 건의 전사 파이프라인.

스레드 두 겹으로 가른다. feed() 는 수신 스레드에서 불리므로 VAD 까지만 하고
20ms 안에 돌아와야 한다. 여기서 무거운 일을 하면 패킷을 흘린다.

큐는 하나다. 확정된 발화가 여기 쌓이고 워커가 발화당 API 를 한 번 부른다.
확정본은 회의록 자체라 밀려도 버리지 않는다.
"""

from __future__ import annotations

import queue
import threading
import time
from dataclasses import dataclass

import numpy as np

from stt.backend import SttBackend, SttError
from stt.turns import DEFAULT_GAP_MS, TurnTracker
from stt.vad import StreamingVAD, Utterance


@dataclass
class Line:
    speaker_id: str
    speaker_name: str
    turn_id: str
    seq: int
    start_ms: int
    end_ms: int
    text: str
    final: bool


class Session:
    """on_line 콜백은 항상 워커 스레드에서 불린다. 호출한 쪽의 스레드나 asyncio 루프가 아니다.

    그래서 asyncio 나 스레드 안전하지 않은 상태를 건드리는 콜백은 직접 처리하지 말고
    loop.call_soon_threadsafe() 같은 수단으로 자기 루프에 넘겨야 한다.
    """

    def __init__(
        self,
        final_stt: SttBackend,
        on_line=None,
        workers: int = 3,
        retries: int = 3,
        turn_gap_ms: int = DEFAULT_GAP_MS,
    ) -> None:
        self.final_stt = final_stt
        self.on_line = on_line or (lambda line: None)
        self.retries = retries

        self._vads: dict[str, StreamingVAD] = {}
        self._names: dict[str, str] = {}
        self._turns = TurnTracker(gap_ms=turn_gap_ms)
        self._lock = threading.Lock()

        self._final_q: queue.Queue = queue.Queue()
        self._stop = threading.Event()
        self._threads = [
            threading.Thread(target=self._final_worker, daemon=True) for _ in range(workers)
        ]
        for t in self._threads:
            t.start()

    # ------------------------------------------------------------ 수신 스레드
    def feed(self, speaker_id: str, speaker_name: str, samples: np.ndarray, offset_ms: int) -> None:
        with self._lock:
            self._names[speaker_id] = speaker_name
            vad = self._vads.get(speaker_id)
            if vad is None:
                vad = self._vads[speaker_id] = StreamingVAD(speaker_id=speaker_id)
            done = vad.feed(samples, offset_ms)

        for u in done:
            self._final_q.put(u)

    def flush_speaker(self, speaker_id: str) -> None:
        """퇴장 시 그 화자의 진행 중 발화를 확정한다. 마지막 발언이 사라지지 않게."""
        with self._lock:
            vad = self._vads.get(speaker_id)
            done = vad.flush() if vad else []
        for u in done:
            self._final_q.put(u)

    # ------------------------------------------------------------ 워커
    def _final_worker(self) -> None:
        while not self._stop.is_set():
            try:
                u: Utterance = self._final_q.get(timeout=0.1)
            except queue.Empty:
                continue
            try:
                self._emit(u, self._transcribe_final(u), final=True)
            finally:
                self._final_q.task_done()

    def _transcribe_final(self, u: Utterance) -> str:
        for attempt in range(self.retries):
            try:
                return self.final_stt.transcribe(u.pcm, u.sample_rate).text
            except (SttError, Exception):
                if attempt == self.retries - 1:
                    # 발화를 버리지 않는다. 오디오는 트랙에 남아 있으니 나중에 다시 돌릴 수 있다.
                    return "[전사 실패]"
                time.sleep(0.5 * (attempt + 1))
        return "[전사 실패]"

    def _emit(self, u: Utterance, text: str, final: bool) -> None:
        # TurnTracker 는 자체 잠금이 없다. assign/note_post 를 잠금 밖에서 부르면
        # 수신 스레드의 feed() 와 워커가 같은 dict 를 동시에 건드린다.
        with self._lock:
            name = self._names.get(u.speaker_id, u.speaker_id)
            turn = self._turns.assign(u.speaker_id, u.start_ms, u.end_ms)
            self._turns.note_post(u.speaker_id)
        # 콜백은 느릴 수 있고 이벤트 루프로 넘기기도 한다. 잠금을 놓고 부른다.
        self.on_line(Line(u.speaker_id, name, turn, u.seq, u.start_ms, u.end_ms, text, final))

    # ------------------------------------------------------------ 종료
    def close(self, timeout_s: float = 10.0) -> float:
        """진행 중이던 발화를 전부 확정하고 워커를 멈춘다. 걸린 초를 돌려준다.

        줄의 소유자는 on_line 콜백이다. 여기서는 모으지 않는다.
        """
        t0 = time.monotonic()
        with self._lock:
            vads = list(self._vads.values())
        for v in vads:
            for u in v.flush():
                self._final_q.put(u)

        deadline = t0 + timeout_s
        # empty() 는 워커가 항목을 꺼낸 순간 참이 된다. 전사가 끝난 순간이 아니다.
        # 워커가 finally 에서 task_done() 을 부르므로 unfinished_tasks 는 꺼낸 항목의
        # 처리까지 끝나야 0 이 된다. 즉시 돌아오는 백엔드에서는 차이가 없지만, 한 번에
        # 수 초가 걸리는 백엔드에서는 이 차이가 마지막 발언 하나를 통째로 날린다.
        while self._final_q.unfinished_tasks and time.monotonic() < deadline:
            time.sleep(0.05)
        self._stop.set()
        for t in self._threads:
            # 고정 1초로 기다리면 그보다 느린 전사가 끝나기 전에 돌아간다. 남은 예산을
            # 넘기되, 스레드마다 다시 재서 close() 전체가 시한을 넘지 않게 한다.
            t.join(timeout=max(0.1, deadline - time.monotonic()))
        return time.monotonic() - t0
