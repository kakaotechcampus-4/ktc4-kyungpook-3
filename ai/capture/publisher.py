"""전사 줄을 텍스트 채널에 올린다.

한 메시지에 한 화자의 한 턴을 담는다. 같은 턴에 확정 발화가 더 오면 새 메시지가
아니라 편집이고, 본문은 그 턴의 확정 줄 전부를 seq 순으로 이은 것이다.
최신 줄 하나만 남기면 게시가 밀리는 동안 앞 발화가 화면에서 사라진다.

디스코드는 채널당 5초 창에 5요청이다. 같은 모양의 토큰 버킷을 둔다.
버스트는 즉시 나가고 평균만 초당 1건으로 묶인다.

실패는 버리지 않는다. 라이브러리가 429 재시도를 소진해 예외를 올리면
그 턴을 되돌리고 백오프 후 다시 시도한다.

submit() 은 다른 스레드에서 불러도 안전하다. 루프가 있다고 가정하지 않고
await 도 하지 않는다 (Session.on_line 이 워커 스레드에서 불린다). 그래서 내부
시계는 loop.time() 이 아니라 time.monotonic() 하나로 통일한다 — submit() 쪽에서
루프를 요구하면 워커 스레드에서 예외가 난다. 실제 배선에서는 Discord 레이어가
loop.call_soon_threadsafe(publisher.submit, line) 으로 넘기므로 submit() 본문은
그때는 루프 스레드에서 실행되지만, 그 가정 없이도 깨지지 않게 짠다.
"""

from __future__ import annotations

import asyncio
import time

from stt.session import Line

DEFAULT_BACKOFF_S = (1.0, 2.0, 4.0, 8.0, 16.0)


def format_line(line: Line) -> str:
    total = line.start_ms // 1000
    return f"`[{total // 60:02d}:{total % 60:02d}]` **{line.speaker_name}** {line.text}"


def render_turn(lines: list[Line]) -> str:
    """턴의 확정 줄 전부를 한 메시지 본문으로. 머리는 첫 줄의 시각과 이름."""
    ordered = sorted(lines, key=lambda ln: ln.seq)
    head = ordered[0]
    body = " ".join(ln.text for ln in ordered if ln.text)
    total = head.start_ms // 1000
    return f"`[{total // 60:02d}:{total % 60:02d}]` **{head.speaker_name}** {body}"


class Publisher:
    def __init__(
        self,
        send,
        edit,
        burst: int = 5,
        refill_per_s: float = 1.0,
        coalesce_s: float = 0.3,
        max_retries: int = 5,
        backoff_s: tuple[float, ...] = DEFAULT_BACKOFF_S,
    ) -> None:
        self.send = send
        self.edit = edit
        self.burst = max(1, burst)
        self.refill_per_s = refill_per_s
        self.coalesce_s = coalesce_s
        self.max_retries = max_retries
        self.backoff_s = backoff_s

        self._lines_of: dict[str, list[Line]] = {}    # turn_id -> 확정 줄 전부
        self._message_of: dict[str, int] = {}         # turn_id -> message_id
        self._dirty: list[str] = []                    # 게시가 필요한 턴, 처음 본 순서
        self._dirty_at: dict[str, float] = {}          # 마지막 submit 시각
        self._not_before: dict[str, float] = {}        # 백오프 해제 시각
        self._attempts: dict[str, int] = {}
        self._tokens = float(self.burst)
        self._refilled_at: float | None = None
        self._stop = False
        self._wake = asyncio.Event()
        self._loop: asyncio.AbstractEventLoop | None = None  # run() 이 시작돼야 안다

    # ------------------------------------------------------------ 입력
    def submit(self, line: Line) -> None:
        self._lines_of.setdefault(line.turn_id, []).append(line)
        self._mark_dirty(line.turn_id)

    def stop(self) -> None:
        self._stop = True
        self._wake.set()

    def _mark_dirty(self, turn_id: str) -> None:
        if turn_id not in self._dirty:
            self._dirty.append(turn_id)
        self._dirty_at[turn_id] = time.monotonic()
        self._wake_loop()

    def _wake_loop(self) -> None:
        """run() 이 아직 시작 전이면 깨울 루프가 없다 — run() 의 0.1초 폴백이 대신 잡는다."""
        if self._loop is not None:
            self._loop.call_soon_threadsafe(self._wake.set)

    # ------------------------------------------------------------ 토큰 버킷
    def _refill(self, now: float) -> None:
        if self._refilled_at is None:
            self._refilled_at = now
            return
        self._tokens = min(float(self.burst), self._tokens + (now - self._refilled_at) * self.refill_per_s)
        self._refilled_at = now

    async def _take_token(self) -> None:
        while True:
            self._refill(time.monotonic())
            if self._tokens >= 1.0:
                self._tokens -= 1.0
                return
            need = (1.0 - self._tokens) / self.refill_per_s if self.refill_per_s > 0 else 0.05
            await asyncio.sleep(max(0.01, need))

    # ------------------------------------------------------------ 루프
    def _ready_turn(self, now: float) -> tuple[str | None, float]:
        """지금 게시할 턴과, 없으면 다음 후보까지 남은 시간."""
        soonest = 0.1
        for turn_id in self._dirty:
            wait_c = 0.0 if self._stop else self.coalesce_s - (now - self._dirty_at.get(turn_id, now))
            wait_b = self._not_before.get(turn_id, 0.0) - now
            wait = max(wait_c, wait_b)
            if wait <= 0:
                return turn_id, 0.0
            soonest = min(soonest, wait)
        return None, soonest

    async def run(self) -> None:
        self._loop = asyncio.get_running_loop()
        while True:
            if not self._dirty:
                if self._stop:
                    return
                self._wake.clear()
                try:
                    await asyncio.wait_for(self._wake.wait(), timeout=0.1)
                except asyncio.TimeoutError:
                    pass
                continue
            turn_id, wait = self._ready_turn(time.monotonic())
            if turn_id is None:
                await asyncio.sleep(wait)
                continue
            self._dirty.remove(turn_id)
            await self._take_token()
            await self._publish(turn_id)

    async def _publish(self, turn_id: str) -> None:
        lines = self._lines_of.get(turn_id)
        if not lines:
            return
        text = render_turn(lines)
        msg_id = self._message_of.get(turn_id)
        try:
            if msg_id is None:
                self._message_of[turn_id] = await self.send(text)
            else:
                await self.edit(msg_id, text)
            self._attempts.pop(turn_id, None)
            self._not_before.pop(turn_id, None)
        except Exception as e:
            n = self._attempts.get(turn_id, 0) + 1
            self._attempts[turn_id] = n
            if n > self.max_retries:
                # 회의록 파일에는 이미 있다. 화면 게시만 포기하고 흔적을 남긴다.
                print(f"[publish] 턴 {turn_id} 게시 포기 ({n - 1}회 실패): {type(e).__name__}", flush=True)
                return
            delay = self.backoff_s[min(n - 1, len(self.backoff_s) - 1)]
            self._not_before[turn_id] = time.monotonic() + delay
            if turn_id not in self._dirty:
                self._dirty.append(turn_id)
            self._wake.set()
