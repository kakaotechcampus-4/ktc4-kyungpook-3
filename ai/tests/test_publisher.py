import asyncio

import pytest

from stt.session import Line
from capture.publisher import Publisher, format_line, render_turn


def line(speaker="kim", name="김환", turn="t1", seq=1, start=24_000, end=27_000,
         text="안녕하세요", final=True):
    return Line(speaker, name, turn, seq, start, end, text, final)


def test_format_shows_meeting_clock():
    assert format_line(line(start=24_000, name="김환", text="안녕")) == "`[00:24]` **김환** 안녕"


def test_format_handles_over_an_hour():
    assert format_line(line(start=3_725_000, name="A", text="x")).startswith("`[62:05]`")


def test_render_turn_joins_finals_in_seq_order():
    out = render_turn([line(seq=2, text="두 번째"), line(seq=1, text="첫 번째")])
    assert out.endswith("첫 번째 두 번째")


class FakeChannel:
    def __init__(self, fail_first=0):
        self.sent = []
        self.edits = []
        self._n = 0
        self._fail = fail_first

    async def send(self, text):
        if self._fail:
            self._fail -= 1
            raise RuntimeError("429")
        self._n += 1
        self.sent.append(text)
        return self._n

    async def edit(self, message_id, text):
        self.edits.append((message_id, text))

    def shown(self):
        """화면에 마지막으로 남은 본문."""
        return self.edits[-1][1] if self.edits else self.sent[-1]


async def drive(p, submits, wait=0.05):
    task = asyncio.create_task(p.run())
    for ln, gap in submits:
        p.submit(ln)
        await asyncio.sleep(gap)
    await asyncio.sleep(wait)
    p.stop()
    await task


@pytest.mark.asyncio
async def test_same_turn_edits_instead_of_sending():
    ch = FakeChannel()
    p = Publisher(ch.send, ch.edit, coalesce_s=0)
    await drive(p, [(line(turn="t1", seq=1, text="그래서 제가"), 0.05),
                    (line(turn="t1", seq=2, text="이번 주에"), 0.05)])
    assert len(ch.sent) == 1
    assert ch.shown().endswith("그래서 제가 이번 주에")


@pytest.mark.asyncio
async def test_different_turn_sends_new_message():
    ch = FakeChannel()
    p = Publisher(ch.send, ch.edit, coalesce_s=0)
    await drive(p, [(line(turn="t1", text="A 말"), 0.05),
                    (line(turn="t2", speaker="yoo", name="유재환", text="B 말"), 0.05)])
    assert len(ch.sent) == 2


@pytest.mark.asyncio
async def test_two_finals_in_same_turn_before_publish_both_survive():
    """게시 전에 같은 턴 확정 2건이 연달아 오면 둘 다 본문에 남아야 한다. 최신 하나만 남기면 U1 이 사라진다."""
    ch = FakeChannel()
    p = Publisher(ch.send, ch.edit, coalesce_s=0.2)
    await drive(p, [(line(turn="t1", seq=1, text="U1"), 0.0),
                    (line(turn="t1", seq=2, text="U2"), 0.0)], wait=0.4)
    assert "U1" in ch.shown() and "U2" in ch.shown()
    assert ch.shown().index("U1") < ch.shown().index("U2")


@pytest.mark.asyncio
async def test_burst_within_bucket_is_not_delayed():
    """토큰 5개면 5건은 기다리지 않고 나간다."""
    ch = FakeChannel()
    p = Publisher(ch.send, ch.edit, burst=5, refill_per_s=1.0, coalesce_s=0)
    loop = asyncio.get_running_loop()
    t0 = loop.time()
    await drive(p, [(line(turn=f"t{i}", speaker=f"s{i}", text=f"m{i}"), 0.0) for i in range(5)], wait=0.1)
    assert len(ch.sent) == 5
    assert loop.time() - t0 < 0.5


async def _wait_until(predicate, timeout=5.0, interval=0.005):
    """predicate() 가 참이 될 때까지 짧게 폴링한다. timeout 안에 안 되면 그대로
    asyncio.TimeoutError 로 실패한다 — 고정 sleep 으로 재는 대신 실제 완료
    시점을 잡고, 무한 대기로 테스트가 멈추는 것도 막는다."""
    async def poll():
        while not predicate():
            await asyncio.sleep(interval)
    await asyncio.wait_for(poll(), timeout=timeout)


@pytest.mark.asyncio
async def test_sixth_in_burst_waits_for_refill():
    """drive() 의 고정 wait 로 재면 0.3초 자체가 하한(0.09)을 항상 넘겨, 토큰
    버킷을 완전히 없애도 통과해 버린다 (실사례: FakeChannel 이 즉시 응답해도
    구분이 안 됨). 그래서 고정 대기가 아니라 3번째 전송이 실제로 끝나는
    시점으로 잰다."""
    ch = FakeChannel()
    p = Publisher(ch.send, ch.edit, burst=2, refill_per_s=10.0, coalesce_s=0)
    loop = asyncio.get_running_loop()
    task = asyncio.create_task(p.run())
    t0 = loop.time()
    for i in range(3):
        p.submit(line(turn=f"t{i}", speaker=f"s{i}", text=f"m{i}"))
    await _wait_until(lambda: len(ch.sent) >= 3)
    elapsed = loop.time() - t0
    p.stop()
    await asyncio.wait_for(task, timeout=1.0)
    assert elapsed >= 0.09


@pytest.mark.asyncio
async def test_send_failure_is_retried_not_dropped():
    ch = FakeChannel(fail_first=1)
    p = Publisher(ch.send, ch.edit, coalesce_s=0, backoff_s=(0.05,))
    await drive(p, [(line(turn="t1", text="살아남아야 함"), 0.0)], wait=0.3)
    assert ch.sent and "살아남아야 함" in ch.sent[-1]


@pytest.mark.asyncio
async def test_stop_flushes_without_waiting_for_coalesce():
    ch = FakeChannel()
    p = Publisher(ch.send, ch.edit, coalesce_s=5.0)
    task = asyncio.create_task(p.run())
    p.submit(line(turn="t1", text="즉시"))
    await asyncio.sleep(0.02)
    p.stop()
    await asyncio.wait_for(task, timeout=1.0)
    assert ch.sent and "즉시" in ch.sent[-1]
