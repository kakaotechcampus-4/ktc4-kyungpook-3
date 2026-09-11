import asyncio
import threading

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


@pytest.mark.asyncio
async def test_submit_from_worker_thread_is_delivered():
    """Session.on_line 은 워커 스레드에서 불린다. submit() 이 내부에서 loop.time()
    (또는 asyncio.get_event_loop().time())을 부르면, 자기 루프가 없는 진짜
    threading.Thread 에서는 RuntimeError 로 죽는다 — time.monotonic() 하나로
    통일해야 이 경로가 산다. 실제 스레드로 확인한다 (같은 코루틴 안에서 부르면
    이 문제가 드러나지 않는다)."""
    ch = FakeChannel()
    p = Publisher(ch.send, ch.edit, coalesce_s=0)
    task = asyncio.create_task(p.run())
    await asyncio.sleep(0.02)  # run() 이 유휴 대기(wait_for)에 들어갈 시간

    t = threading.Thread(target=p.submit, args=(line(turn="t1", text="워커에서"),))
    t.start()
    t.join()

    await _wait_until(lambda: bool(ch.sent), timeout=0.5)
    p.stop()
    await asyncio.wait_for(task, timeout=1.0)
    assert ch.sent and "워커에서" in ch.sent[-1]


@pytest.mark.asyncio
async def test_submit_after_run_returned_does_not_raise(capsys):
    """루프가 열려 있어도 run() 이 이미 끝났으면 깨울 대상이 없다. submit() 은
    예외를 올리지 않고 로그로만 남긴다 — 줄이 조용히 사라지지 않았다는 뜻이다."""
    ch = FakeChannel()
    p = Publisher(ch.send, ch.edit, coalesce_s=0)
    task = asyncio.create_task(p.run())
    await asyncio.sleep(0.01)
    p.stop()
    await asyncio.wait_for(task, timeout=1.0)

    p.submit(line(turn="t9", text="너무 늦게 옴"))  # 예외 없이 끝나야 한다

    out = capsys.readouterr().out
    assert "t9" in out


@pytest.mark.asyncio
async def test_stop_deadline_bounds_drain_and_reports_leftovers(capsys):
    """burst=1 이면 첫 턴만 즉시 나가고 나머지는 매번 refill_per_s 만큼 기다려야
    한다. 짧은 시한을 주면 다 못 올리고 run() 이 그 시한 안에 돌아와야 하고,
    남은 턴은 로그로 남아야 한다 (내용이 아니라 turn_id 와 개수만)."""
    ch = FakeChannel()
    p = Publisher(ch.send, ch.edit, burst=1, refill_per_s=1.0, coalesce_s=0)
    task = asyncio.create_task(p.run())
    for i in range(4):
        p.submit(line(turn=f"t{i}", speaker=f"s{i}", text=f"m{i}"))
    await asyncio.sleep(0.02)  # 버스트 토큰으로 t0 하나는 이미 나갔을 시간

    loop = asyncio.get_running_loop()
    t0 = loop.time()
    p.stop(deadline_s=0.3)
    await asyncio.wait_for(task, timeout=1.0)
    elapsed = loop.time() - t0

    assert elapsed < 0.5   # 시한(0.3) + 여유
    sent_indices = {i for i in range(4) if any(f"m{i}" in s for s in ch.sent)}
    missing = [f"t{i}" for i in range(4) if i not in sent_indices]
    assert missing, "burst=1 이면 4건이 다 나갈 수 없다"
    out = capsys.readouterr().out
    assert str(len(missing)) in out
    for turn_id in missing:
        assert turn_id in out


def test_render_turn_caps_discord_message_length():
    long_lines = [line(seq=i, text="가" * 300) for i in range(10)]
    out = render_turn(long_lines)
    assert len(out) <= 2000
    assert out.endswith("…")


# ----------------------------------------------------------------- 지연 계측
@pytest.mark.asyncio
async def test_publish_time_includes_the_token_bucket_wait():
    """버킷이 비어 기다린 시간도 게시 지연이다. 그 줄은 그만큼 늦게 화면에 뜬다.

    두 줄을 같이 본다. 뒤 줄만 보면 상수를 더해도 통과하고, 앞 줄만 보면 대기를
    빼먹어도 통과한다.
    """
    ch = FakeChannel()
    p = Publisher(ch.send, ch.edit, burst=1, refill_per_s=5.0, coalesce_s=0)
    task = asyncio.create_task(p.run())
    first = line(turn="t1", speaker="s1", text="먼저")
    second = line(turn="t2", speaker="s2", text="나중")
    p.submit(first)
    p.submit(second)
    await _wait_until(lambda: len(ch.sent) >= 2)
    p.stop()
    await asyncio.wait_for(task, timeout=1.0)

    assert first.publish_s < 0.1
    assert second.publish_s >= 0.15   # 토큰 하나가 다시 차는 데 0.2초


@pytest.mark.asyncio
async def test_publish_time_is_kept_from_the_first_send_not_a_later_edit():
    """한 턴이 여러 번 나가도 각 줄의 값은 그 줄이 처음 화면에 뜬 때까지다."""
    ch = FakeChannel()
    p = Publisher(ch.send, ch.edit, coalesce_s=0)
    task = asyncio.create_task(p.run())
    first = line(turn="t1", seq=1, text="첫 발화")
    p.submit(first)
    await _wait_until(lambda: len(ch.sent) >= 1)
    at_send = first.publish_s
    await asyncio.sleep(0.25)

    later = line(turn="t1", seq=2, text="이어서")
    p.submit(later)
    await _wait_until(lambda: len(ch.edits) >= 1)
    p.stop()
    await asyncio.wait_for(task, timeout=1.0)

    assert at_send is not None and first.publish_s == at_send
    # 턴이 아니라 줄 기준이다. 턴의 첫 submit 부터 재면 0.25초를 넘는다.
    assert later.publish_s is not None and later.publish_s < 0.2


@pytest.mark.asyncio
async def test_a_line_arriving_during_a_send_is_not_counted_as_published():
    """전송이 시작된 뒤 도착한 줄은 그 본문에 없다. 같이 게시된 것으로 세면
    아직 화면에 없는 줄의 지연이 실제보다 짧게 잡힌다."""
    started = asyncio.Event()
    release = asyncio.Event()
    allow_edit = asyncio.Event()

    class GatedChannel(FakeChannel):
        async def send(self, text):
            started.set()
            await release.wait()
            return await super().send(text)

        async def edit(self, message_id, text):
            # 뒤따르는 편집을 잡아 둔다. 풀어 두면 전송 완료와 편집 완료 사이가
            # 폴링 간격보다 짧아, 아래 확인이 편집까지 끝난 뒤를 보게 된다.
            await allow_edit.wait()
            return await super().edit(message_id, text)

    ch = GatedChannel()
    p = Publisher(ch.send, ch.edit, coalesce_s=0)
    task = asyncio.create_task(p.run())
    first = line(turn="t1", seq=1, text="첫 발화")
    p.submit(first)
    await asyncio.wait_for(started.wait(), timeout=1.0)

    during = line(turn="t1", seq=2, text="전송 중 도착")
    p.submit(during)
    release.set()
    await _wait_until(lambda: len(ch.sent) >= 1)

    assert first.publish_s is not None
    assert during.publish_s is None

    allow_edit.set()
    await _wait_until(lambda: len(ch.edits) >= 1)
    p.stop()
    await asyncio.wait_for(task, timeout=1.0)
    assert during.publish_s is not None
