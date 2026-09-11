"""회의 한 건의 전사 파이프라인.

스레드 세 겹으로 가른다. feed() 는 수신 스레드에서 불리므로 VAD 까지만 하고
20ms 안에 돌아와야 한다. 여기서 무거운 일을 하면 패킷을 흘린다.

큐를 둘로 나눈다. 확정본은 회의록 자체라 버리면 안 되고, 부분 전사는 "말하는 중"
표시라 늦으면 의미가 없어 버려도 된다. STT 가 밀리면 부분 전사가 먼저 희생된다.
"""

from __future__ import annotations

import queue
import threading
import time
from dataclasses import dataclass

import numpy as np

from stt.backend import SttBackend, SttError, confirmed_prefix
from stt.turns import DEFAULT_GAP_MS, TurnTracker
from stt.vad import StreamingVAD, Utterance

PARTIAL_AFTER_MS = 6_000   # 이만큼 이어지면 부분 전사를 시작한다
PARTIAL_EVERY_MS = 2_000   # 그 뒤 이 간격으로 갱신한다


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
        partial_stt: SttBackend | None = None,
        on_line=None,
        workers: int = 3,
        retries: int = 3,
        turn_gap_ms: int = DEFAULT_GAP_MS,
        partial_after_ms: int = PARTIAL_AFTER_MS,
        partial_every_ms: int = PARTIAL_EVERY_MS,
    ) -> None:
        self.final_stt = final_stt
        self.partial_stt = partial_stt
        self.on_line = on_line or (lambda line: None)
        self.retries = retries
        self.partial_after_ms = partial_after_ms
        self.partial_every_ms = partial_every_ms

        self._vads: dict[str, StreamingVAD] = {}
        self._names: dict[str, str] = {}
        self._turns = TurnTracker(gap_ms=turn_gap_ms)
        self._lock = threading.Lock()
        self._last_partial_ms: dict[str, int] = {}
        # 진행 중인 발화가 속한 턴. 부분 전사가 확정본과 같은 메시지를 타야 한다.
        self._turn_in_flight: dict[str, str] = {}
        # LocalAgreement 상태. 확정 텍스트와 직전 가설, 잘라낸 지점
        self._partial_state: dict[str, dict] = {}

        self._final_q: queue.Queue = queue.Queue()
        self._partial_q: queue.Queue = queue.Queue(maxsize=1)
        self._stop = threading.Event()
        self._threads = [
            threading.Thread(target=self._final_worker, daemon=True) for _ in range(workers)
        ]
        if partial_stt is not None:
            self._threads.append(threading.Thread(target=self._partial_worker, daemon=True))
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
            pending = vad.pending_ms
            start = vad.pending_start_ms

        for u in done:
            self._final_q.put(u)
            # 발화가 끝났다. 부분 전사 상태를 비운다.
            self._last_partial_ms.pop(speaker_id, None)
            self._partial_state.pop(speaker_id, None)

        if self.partial_stt is None:
            return
        if pending < self.partial_after_ms:
            return
        last = self._last_partial_ms.get(speaker_id, 0)
        if pending - last < self.partial_every_ms:
            return
        self._last_partial_ms[speaker_id] = pending

        with self._lock:
            # pending_pcm 은 진행 중인 프레임을 매번 이어 붙인다. 패킷마다 읽으면 25초
            # 발화에서 40만 샘플을 초당 50번 복사해 수신 스레드의 20ms 를 넘긴다.
            # 그래서 부분 전사를 실제로 넣을 때만, 여기서 한 번만 읽는다.
            pcm = vad.pending_pcm.copy()
            # 진행 중 발화의 턴을 미리 잡아 둔다. 확정본이 같은 메시지를 편집해야 한다.
            if speaker_id not in self._turn_in_flight:
                self._turn_in_flight[speaker_id] = self._turns.assign(speaker_id, start, start)
        # 부분 전사 큐는 한 칸이다. 밀리면 옛 것을 버리고 최신 것만 남긴다.
        try:
            self._partial_q.get_nowait()
        except queue.Empty:
            pass
        try:
            self._partial_q.put_nowait((speaker_id, pcm, start))
        except queue.Full:
            pass

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

    def _partial_worker(self) -> None:
        """LocalAgreement-2. 연속 두 가설이 일치하는 단어 접두사만 확정하고,
        확정 지점 뒤부터만 다음 회차에 다시 돌린다. 재전사 길이에 상한이 생기고
        절단점이 항상 단어 끝이라 경계에서 단어가 깨지지 않는다.
        """
        while not self._stop.is_set():
            try:
                speaker_id, pcm, start_ms = self._partial_q.get(timeout=0.1)
            except queue.Empty:
                continue
            try:
                st = self._partial_state.setdefault(
                    speaker_id, {"confirmed": "", "prev": [], "trim_s": 0.0}
                )
                offset = int(st["trim_s"] * 16_000)
                tail = pcm[offset:]
                if tail.size == 0:
                    continue
                r = self.partial_stt.transcribe(tail, 16_000)
                newly = confirmed_prefix(st["prev"], r.words)
                st["prev"] = r.words
                if newly:
                    st["confirmed"] = (st["confirmed"] + " " + " ".join(w.text for w in newly)).strip()
                    st["trim_s"] += newly[-1].end_s
                    st["prev"] = []
                # 확정분 + 아직 미확정인 꼬리를 함께 보여준다.
                # 단어 타임스탬프가 없는 백엔드는 확정할 접두사도 꼬리도 못 만든다.
                # 그 경우 빈 줄 대신 통째 텍스트를 쓴다.
                tail_text = " ".join(w.text for w in r.words[len(newly):]) if r.words else r.text
                text = (st["confirmed"] + " " + tail_text).strip()
            except Exception:
                continue  # 부분 전사 실패는 조용히 넘긴다. 최종본이 온다.
            finally:
                self._partial_q.task_done()

            with self._lock:
                name = self._names.get(speaker_id, speaker_id)
                turn = self._turn_in_flight.get(speaker_id)
            if turn is None:
                continue  # 발화가 이미 확정됐다. 부분 전사는 버린다
            self.on_line(Line(speaker_id, name, turn, 0, start_ms,
                              start_ms + len(pcm) * 1000 // 16_000, text, final=False))

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
            # 부분 전사가 잡아 둔 턴이 있으면 그 메시지를 이어서 쓴다.
            turn = self._turn_in_flight.pop(u.speaker_id, None)
            if turn is None:
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
        while not self._final_q.empty() and time.monotonic() < deadline:
            time.sleep(0.05)
        self._stop.set()
        for t in self._threads:
            t.join(timeout=1.0)
        return time.monotonic() - t0
