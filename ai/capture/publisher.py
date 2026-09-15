"""전사 줄을 텍스트 채널에 올린다.

한 메시지에 한 화자의 한 턴을 담는다. 같은 턴에 확정 발화가 더 오면 새 메시지가
아니라 편집이고, 본문은 그 턴의 확정 줄 전부를 seq 순으로 이은 것이다.
최신 줄 하나만 남기면 게시가 밀리는 동안 앞 발화가 화면에서 사라진다.

디스코드는 채널당 5초 창에 5요청이다. 같은 모양의 토큰 버킷을 둔다.
버스트는 즉시 나가고 평균만 초당 1건으로 묶인다.

실패는 버리지 않는다. 라이브러리가 429 재시도를 소진해 예외를 올리면
그 턴을 되돌리고 백오프 후 다시 시도한다.

submit() 은 await 하지 않고, 자기 안(줄 누적·dirty 표시)에서는 루프를 요구하지
않는다 — 내부 시계를 loop.time() 이 아니라 time.monotonic() 으로 통일해서
Session.on_line 이 부르는 워커 스레드에서 불려도 이 부분은 죽지 않는다.
게시 루프를 깨우는 부분만 loop.call_soon_threadsafe 를 쓰는데, 루프가 이미
닫혔거나 run() 이 이미 끝났으면 그 시도를 건너뛰고 로그만 남긴다 — 예외를
올리지 않는다. 이 두 경로는 test_submit_from_worker_thread_is_delivered,
test_submit_after_run_returned_does_not_raise 로 확인했다.
"""

from __future__ import annotations

import asyncio
import time

from stt.session import Line

DEFAULT_BACKOFF_S = (1.0, 2.0, 4.0, 8.0, 16.0)
DISCORD_SAFE_CHARS = 1990  # 2000자 한도에서 여유를 둔다


def format_line(line: Line) -> str:
    total = line.start_ms // 1000
    return f"`[{total // 60:02d}:{total % 60:02d}]` **{line.speaker_name}** {line.text}"


def _truncate_body(body: str, texts: list[str], budget: int) -> str:
    """예산 안에서 통째로 들어가는 발화까지만 남긴다. 발화 하나가 이미 예산을
    넘으면 그 안에서 마지막 공백까지만 잘라 단어 중간을 피한다."""
    if len(body) <= budget:
        return body
    kept: list[str] = []
    length = 0
    for t in texts:
        add = len(t) if not kept else len(t) + 1
        if length + add > budget:
            break
        kept.append(t)
        length += add
    if kept:
        return " ".join(kept)
    cut = texts[0][:budget]
    sp = cut.rfind(" ")
    return cut[:sp] if sp > 0 else cut


def render_turn(lines: list[Line]) -> str:
    """턴의 확정 줄 전부를 한 메시지 본문으로. 머리는 첫 줄의 시각과 이름.

    디스코드 메시지 한도(2000자)를 넘으면 잘라 "…" 를 붙인다. 발화 경계에서
    자르는 게 먼저고, 발화 하나가 이미 넘으면 그 안에서 단어 경계로 자른다.
    """
    ordered = sorted(lines, key=lambda ln: ln.seq)
    head = ordered[0]
    total = head.start_ms // 1000
    prefix = f"`[{total // 60:02d}:{total % 60:02d}]` **{head.speaker_name}** "
    texts = [ln.text for ln in ordered if ln.text]
    body = " ".join(texts)
    if len(prefix) + len(body) > DISCORD_SAFE_CHARS:
        ellipsis = "…"
        budget = DISCORD_SAFE_CHARS - len(prefix) - len(ellipsis)
        body = _truncate_body(body, texts, budget) + ellipsis
    return prefix + body


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
        self._stop_deadline: float | None = None
        self._wake = asyncio.Event()
        self._loop: asyncio.AbstractEventLoop | None = None  # run() 이 시작돼야 안다
        self._running = False  # run() 의 while 문 안에 있는 동안만 True

    # ------------------------------------------------------------ 입력
    def submit(self, line: Line) -> None:
        """넘어온 시각을 줄에 직접 적는다. 게시가 끝나면 그 차이가 publish_s 다.

        나란한 리스트에 따로 쌓으면 안 된다 — submit 은 워커 스레드 셋에서 동시에
        불리고, 줄과 시각을 두 번에 나눠 append 하면 그 둘이 어긋나 같은 턴의
        publish_s 가 통째로 다른 줄의 것이 된다.
        """
        line.submitted_at = time.monotonic()
        self._lines_of.setdefault(line.turn_id, []).append(line)
        self._mark_dirty(line.turn_id)

    def stop(self, deadline_s: float = 8.0) -> None:
        """지금부터 deadline_s 안에 다 못 올리면 남은 턴은 포기하고 run() 이 돌아온다.

        백오프를 기다리던 턴도 이번 한 번은 남은 사다리를 건너뛰고 바로 시도한다 —
        재시도 자체를 없애는 게 아니라, 종료 마감 안에서 마지막 기회를 준다.
        """
        self._stop = True
        self._stop_deadline = time.monotonic() + deadline_s
        self._not_before.clear()
        self._wake.set()

    def _mark_dirty(self, turn_id: str) -> None:
        if turn_id not in self._dirty:
            self._dirty.append(turn_id)
        self._dirty_at[turn_id] = time.monotonic()
        self._wake_loop(turn_id)

    def _wake_loop(self, turn_id: str) -> None:
        """run() 이 아직 시작 전이면 깨울 루프가 없다 — run() 의 0.1초 폴백이 대신 잡는다.

        루프가 닫혔거나 run() 이 이미 끝난 뒤라면 call_soon_threadsafe 가
        RuntimeError 를 올린다. 그 예외가 submit() 밖으로 새면 Session._final_worker
        가 "on_line 예외"로만 삼켜 게시가 안 됐다는 사실 자체가 사라지므로,
        여기서 잡아 로그만 남긴다. 그동안 줄 자체는 _lines_of 에 남아 있다.
        """
        if self._loop is None:
            return
        if self._loop.is_closed() or not self._running:
            print(f"[publish] 턴 {turn_id} 을 게시 루프로 못 넘긴다 (루프 종료됨)", flush=True)
            return
        self._loop.call_soon_threadsafe(self._wake.set)

    # ------------------------------------------------------------ 토큰 버킷
    def _refill(self, now: float) -> None:
        if self._refilled_at is None:
            self._refilled_at = now
            return
        self._tokens = min(float(self.burst), self._tokens + (now - self._refilled_at) * self.refill_per_s)
        self._refilled_at = now

    async def _take_token(self) -> bool:
        """토큰을 받으면 True. 종료 시한 안에 못 받으면 False — 버킷을 건너뛰지 않는다.

        디스코드 한도 자체를 우회하면 429 를 부른다. 대신 한 번에 최대 0.1초씩만
        자서 self._stop_deadline 을 자주 다시 본다 — refill_per_s 가 느리면 한 번의
        sleep 이 시한을 통째로 넘길 수 있어서다.
        """
        while True:
            self._refill(time.monotonic())
            if self._tokens >= 1.0:
                self._tokens -= 1.0
                return True
            now = time.monotonic()
            if self._stop_deadline is not None and now >= self._stop_deadline:
                return False
            need = (1.0 - self._tokens) / self.refill_per_s if self.refill_per_s > 0 else 0.05
            sleep_for = max(0.01, min(need, 0.1))
            if self._stop_deadline is not None:
                sleep_for = min(sleep_for, max(0.0, self._stop_deadline - now))
            await asyncio.sleep(sleep_for)

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
        self._running = True
        try:
            while True:
                if self._stop_deadline is not None and time.monotonic() >= self._stop_deadline:
                    if self._dirty:
                        print(
                            f"[publish] 종료 시한을 넘겨 {len(self._dirty)}건 미게시: {self._dirty}",
                            flush=True,
                        )
                    return
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
                if not await self._take_token():
                    if turn_id not in self._dirty:
                        self._dirty.append(turn_id)
                    continue
                await self._publish(turn_id)
        finally:
            self._running = False

    def _note_published(self, lines: list[Line], done: float) -> None:
        """줄이 처음 화면에 뜬 때까지만 남긴다. 같은 턴을 다시 편집해도 덮지 않는다."""
        for ln in lines:
            if ln.publish_s is None and ln.submitted_at is not None:
                ln.publish_s = done - ln.submitted_at

    async def _publish(self, turn_id: str) -> None:
        lines = self._lines_of.get(turn_id)
        if not lines:
            return
        text = render_turn(lines)
        # await 사이에 워커 스레드가 같은 턴에 줄을 더 붙일 수 있다. 그 줄은 이번
        # 본문에 없으므로 여기서 게시된 것으로 세지 않는다.
        sent = list(lines)
        msg_id = self._message_of.get(turn_id)
        try:
            if msg_id is None:
                self._message_of[turn_id] = await self.send(text)
            else:
                await self.edit(msg_id, text)
            self._note_published(sent, time.monotonic())
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
