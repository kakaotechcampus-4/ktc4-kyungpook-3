"""봇 안의 자동 복구(capture/discord_adapter.py). 루프와 /recover 가 같이 쓰는 한 바퀴, 재시작 안내, 선점 알림,
세마포어, 루프 태스크의 시작과 정리. 가짜 디스코드 객체와 가짜 BE 를 쓴다. 모델은 안 쓴다."""

import asyncio
import json
import os
import threading
import time
from datetime import datetime, timedelta, timezone

import pytest
import soundfile as sf

from capture import discord_adapter as A
from capture import recorder as R
from shared.schemas import now_iso
from tests.capture.test_discord_adapter import GUILD_ID, TEXT_ID, FakeBot, _manifest, _run, _setup, _tone

T0 = datetime(2026, 9, 26, 3, 0, 0, tzinfo=timezone.utc)


@pytest.fixture
def clock(monkeypatch):
    now = {"t": T0}
    monkeypatch.setattr(R, "utcnow", lambda: now["t"])
    return now


def _meeting(tmp_path, ts, *, status=R.STATUS_SAVED, started_at="2026-09-16T00:00:00Z", **extra):
    """봇이 들고 있지 않은 회의를 디스크에 만든다. 화자 1 의 2초 트랙 하나."""
    rec = tmp_path / "recordings"
    mid = f"{GUILD_ID}_{ts}"
    (rec / mid).mkdir(parents=True)
    sf.write(str(rec / mid / f"1_{ts}.wav"), _tone(2000), 16_000, subtype="PCM_16")
    entries = [] if status == R.STATUS_RECORDING else \
        [{"user_id": "1", "display_name": "민수", "file": f"{mid}/1_{ts}.wav", "duration_sec": 2.0}]
    path, _ = R.write_status(rec, mid, status=status, entries=entries, guild="g", channel="회의방", library_version="x",
                             started_at=started_at, meeting_dir=mid,
                             extra={"guild_id": str(GUILD_ID), "text_channel_id": str(TEXT_ID), "timezone": "Asia/Seoul",
                                    **extra})
    return path


def _status(path):
    return json.loads(path.read_text(encoding="utf-8"))["status"]


def _texts(channel):
    return [t for t, _ in channel.sent]


async def test_recover_waiting_for_the_semaphore_leaves_a_recording_started_meanwhile_alone(tmp_path):
    """#83 의 /recover 는 보유 집합을 세마포어 앞에서 만들고 목록은 세마포어 뒤에서 만들었다.
    기다리는 사이 시작된 녹음은 집합에 없어 녹음 중인 wav 가 전사됐다. 목록을 바퀴 시작에 만들면 안 집는다."""
    cog, guild, vc, channel, ctx = _setup(tmp_path)
    old = _meeting(tmp_path, 500)                                   # 봇이 죽어 남은 회의
    await cog._post_sem.acquire()                                   # 앞 회의의 후처리가 세마포어를 쥐고 있다
    recover = asyncio.create_task(_run(A.RecordingCog.recover_cmd, cog, ctx))
    await asyncio.sleep(0.05)                                       # /recover 가 세마포어 앞에서 기다린다
    await _run(A.RecordingCog.record, cog, ctx)                     # 그 사이 새 녹음
    rec = cog._active[GUILD_ID]
    rec.sink.on_samples(1, _tone(2000), 0)
    await asyncio.sleep(0.3)                                        # 트랙 파일이 생길 시간
    cog._post_sem.release()
    await asyncio.wait_for(recover, 20)
    assert _manifest(tmp_path, rec)["status"] == "recording" and GUILD_ID in cog._active
    assert _status(old) == "transcribed"
    await _run(A.RecordingCog.stop, cog, ctx)
    await asyncio.wait_for(rec.done.wait(), 20)


async def test_a_loop_pass_touches_only_meetings_that_are_due(tmp_path, clock):
    cog, guild, vc, channel, ctx = _setup(tmp_path)
    due = _meeting(tmp_path, 500)
    later = _meeting(tmp_path, 600, recovery={"attempts": 1, "next_at": "2026-09-26T03:01:00+00:00"})
    gave_up = _meeting(tmp_path, 700, recovery={"attempts": 5, "gave_up_at": "2026-09-26T02:00:00+00:00"})
    claimed = _meeting(tmp_path, 800, claimed_by="other:9:b", claimed_at="2026-09-26T02:59:00+00:00")
    held = R.try_lock(claimed)                                      # 다른 프로세스가 처리 중이다
    done = _meeting(tmp_path, 900)
    m = json.loads(done.read_text(encoding="utf-8"))
    m.update(status="handed_off", stages={"transcribed": "x", "extracted": "x", "handed_off": "x"})
    R.save_manifest(done, m)
    await _run(A.RecordingCog.record, cog, ctx)                     # 녹음 중인 회의
    rec = cog._active[GUILD_ID]
    rec.sink.on_samples(1, _tone(2000), 0)
    await asyncio.sleep(0.3)
    results, busy = await cog._recover_pass()
    held.release()
    assert [r["session"] for r in results] == [f"{GUILD_ID}_500"]
    assert [_status(p) for p in (due, later, gave_up, claimed, done)] == \
        ["transcribed", "saved", "saved", "saved", "handed_off"]
    assert _manifest(tmp_path, rec)["status"] == "recording"
    await _run(A.RecordingCog.stop, cog, ctx)
    await asyncio.wait_for(rec.done.wait(), 20)


async def test_the_loop_processes_each_meeting_inside_the_post_processing_semaphore(tmp_path, monkeypatch):
    cog, guild, vc, channel, ctx = _setup(tmp_path)
    _meeting(tmp_path, 500)
    _meeting(tmp_path, 600)
    seen = []
    real = R.process_session

    def guarded(*args, **kwargs):
        seen.append(cog._post_sem.locked())
        return real(*args, **kwargs)

    monkeypatch.setattr(R, "process_session", guarded)
    await cog._recover_pass()
    assert seen == [True, True] and cog._post_sem._value == 1


async def test_recover_skips_a_meeting_the_loop_is_processing_and_says_so(tmp_path, monkeypatch):
    cog, guild, vc, channel, ctx = _setup(tmp_path)
    _meeting(tmp_path, 500)
    started = asyncio.Event()
    release = threading.Event()
    real = R.process_session
    calls = []
    loop = asyncio.get_running_loop()

    def slow(*args, **kwargs):
        calls.append(args[1]["session"])
        loop.call_soon_threadsafe(started.set)
        release.wait(5)
        return real(*args, **kwargs)

    monkeypatch.setattr(R, "process_session", slow)
    loop_pass = asyncio.create_task(cog._recover_pass())            # 루프의 한 바퀴가 이 회의를 잡고 도는 중
    await asyncio.wait_for(started.wait(), 5)
    await _run(A.RecordingCog.recover_cmd, cog, ctx)
    release.set()
    await asyncio.wait_for(loop_pass, 20)
    assert calls == [f"{GUILD_ID}_500"]
    busy = [t for t in _texts(channel) if "자동 복구가 지금 처리 중" in t]
    assert len(busy) == 1 and f"{GUILD_ID}_500" in busy[0]
    assert not any(t.startswith("마저 처리할 녹음이 없습니다") for t in _texts(channel))


async def test_recover_skips_a_meeting_another_process_holds_and_says_who_and_for_how_long(tmp_path, clock):
    cog, guild, vc, channel, ctx = _setup(tmp_path)
    path = _meeting(tmp_path, 500, claimed_by="other:9:b", claimed_at="2026-09-26T02:50:00+00:00")
    held = R.try_lock(path)                                         # 02:50 부터 다른 프로세스가 처리 중
    await _run(A.RecordingCog.recover_cmd, cog, ctx)
    held.release()
    texts = _texts(channel)
    assert len(texts) == 1 and "other:9:b" in texts[0] and "10분째" in texts[0]
    assert _status(path) == "saved"


def _minutes_ago(n):
    return (datetime.now(timezone.utc) - timedelta(minutes=n)).replace(microsecond=0).isoformat()


async def test_an_interrupted_recording_gets_one_restart_notice_in_its_own_channel(tmp_path):
    cog, guild, vc, channel, ctx = _setup(tmp_path)
    cut = _meeting(tmp_path, 500, status=R.STATUS_RECORDING, started_at=_minutes_ago(30))   # 봇이 뜨기 전에 시작돼 끊겼다
    ours = _meeting(tmp_path, 600, status=R.STATUS_RECORDING, started_at=now_iso())   # 이 봇이 시작했다가 트랙을 닫다 죽었다
    await cog._recover_pass()
    await cog._recover_pass()
    notices = [t for t in _texts(channel) if t == A.RESUME_NOTICE]
    assert len(notices) == 1 and _texts(channel)[0] == A.RESUME_NOTICE      # 처리 결과보다 먼저
    assert _status(cut) == "transcribed" and _status(ours) == "transcribed"


async def test_two_passes_listing_the_same_interrupted_recording_post_one_notice(tmp_path):
    """루프가 재시작 안내를 올리고 세마포어를 기다리는 사이 /recover 가 같은 회의를 목록에 올린다."""
    cog, guild, vc, channel, ctx = _setup(tmp_path)
    _meeting(tmp_path, 500, status=R.STATUS_RECORDING, started_at=_minutes_ago(30))
    await cog._post_sem.acquire()
    loop_pass = asyncio.create_task(cog._recover_pass())
    await asyncio.sleep(0.05)                                       # 안내를 올리고 세마포어 앞에서 기다린다
    hand = asyncio.create_task(_run(A.RecordingCog.recover_cmd, cog, ctx))
    await asyncio.sleep(0.05)
    cog._post_sem.release()
    await asyncio.wait_for(asyncio.gather(loop_pass, hand), 20)
    assert _texts(channel).count(A.RESUME_NOTICE) == 1


async def test_an_old_cut_is_processed_without_a_restart_notice(tmp_path):
    """봇이 오래 꺼져 있다 뜨면 회의는 이미 끝났다. "이어서 기록하려면" 안내는 마지막 트랙 쓰기가 한 시간 안일 때만."""
    cog, guild, vc, channel, ctx = _setup(tmp_path)
    old = _meeting(tmp_path, 500, status=R.STATUS_RECORDING, started_at=_minutes_ago(300))
    stale = time.time() - 3 * 3600
    for wav in (tmp_path / "recordings" / f"{GUILD_ID}_500").glob("*.wav"):
        os.utime(wav, (stale, stale))                               # 마지막으로 쓴 것이 세 시간 전
    await cog._recover_pass()
    assert A.RESUME_NOTICE not in _texts(channel) and _status(old) == "transcribed"


async def test_the_loop_leaves_manifests_without_a_guild_alone(tmp_path):
    """서버가 적히지 않은 옛 매니페스트는 서버별 /recover 가 집지 못하던 것이다. 모든 서버를 보는 루프도 집지 않는다."""
    cog, guild, vc, channel, ctx = _setup(tmp_path)
    path = _meeting(tmp_path, 500)
    m = json.loads(path.read_text(encoding="utf-8"))
    for key in ("guild_id", "text_channel_id", "status", "meeting_dir", "started_at", "timezone"):
        m.pop(key)
    R.save_manifest(path, m)
    assert R.pending_sessions(tmp_path / "recordings") == [path]    # 전제: 목록에는 보인다
    results, _ = await cog._recover_pass()
    assert results == [] and "stages" not in json.loads(path.read_text(encoding="utf-8"))


async def test_a_cog_added_after_the_bot_is_ready_starts_the_loop_itself(tmp_path):
    """봇 쪽이 on_ready 뒤에 Cog 를 붙이면 이 Cog 는 on_ready 를 못 받는다. 붙는 순간 루프를 띄운다."""
    cog, *_ = _setup(tmp_path)

    class ReadyBot(FakeBot):
        def is_ready(self):
            return True

    late = A.RecordingCog(ReadyBot(cog.bot._guild), recordings_dir=tmp_path / "recordings",
                          transcripts_dir=tmp_path / "transcripts", stt_factory=cog._stt_factory,
                          gate_factory=lambda: None, extractor_factory=lambda: None, handoff_factory=lambda: None)
    task = late._recovery_task
    assert task is not None and not task.done()
    late.cog_unload()
    await asyncio.wait([task], timeout=1)


async def test_on_ready_starts_one_loop_that_runs_at_once_and_cog_unload_cancels_it(tmp_path, monkeypatch):
    cog, *_ = _setup(tmp_path)
    cog._recovery_interval_s = 10
    passes = []

    async def counting_pass(**kwargs):
        passes.append(kwargs)
        return [], []

    monkeypatch.setattr(cog, "_recover_pass", counting_pass)
    await cog.on_ready()
    task = cog._recovery_task
    await cog.on_ready()                                            # 재연결로 on_ready 가 다시 와도
    await asyncio.sleep(0.05)
    assert cog._recovery_task is task and len(passes) == 1          # 첫 바퀴는 바로, 태스크는 하나
    cog.cog_unload()
    await asyncio.wait([task], timeout=1)
    assert task.cancelled()


async def test_an_interval_of_zero_keeps_the_loop_off(tmp_path):
    cog, *_ = _setup(tmp_path)
    cog._recovery_interval_s = 0
    await cog.on_ready()
    assert cog._recovery_task is None


async def test_the_loop_keeps_going_after_a_pass_raises(tmp_path, monkeypatch):
    cog, *_ = _setup(tmp_path)
    cog._recovery_interval_s = 0.01
    passes = []

    async def flaky_pass(**kwargs):
        passes.append(kwargs)
        if len(passes) == 1:
            raise RuntimeError("깨진 매니페스트")
        return [], []

    monkeypatch.setattr(cog, "_recover_pass", flaky_pass)
    await cog.on_ready()
    await asyncio.sleep(0.1)
    task = cog._recovery_task
    assert len(passes) >= 2 and not task.done()
    cog.cog_unload()
    await asyncio.wait([task], timeout=1)


def _dying(transcript, names, today):
    raise RuntimeError("LLM 죽음")


async def _start_idle_loop(cog):
    """루프를 띄우고 빈 첫 바퀴가 끝나기를 기다린다. 다음 바퀴는 한 시간 뒤라 테스트가 부르는 바퀴와 겹치지 않는다."""
    cog._recovery_interval_s = 3600
    await cog.on_ready()
    await asyncio.sleep(0.05)
    return cog._recovery_task


async def test_the_loop_posts_moves_and_give_ups_but_not_a_scheduled_retry(tmp_path, clock, monkeypatch):
    monkeypatch.setattr(R, "RECOVERY_MAX_ATTEMPTS", 3)
    cog, guild, vc, channel, ctx = _setup(tmp_path, extractor=_dying)
    task = await _start_idle_loop(cog)
    _meeting(tmp_path, 500)
    posted = []
    for _ in range(3):
        before = len(channel.sent)
        await cog._recover_pass()
        posted.append(_texts(channel)[before:])
        clock["t"] += timedelta(hours=1)
    first, second, third = posted
    assert first[0] == f"세션 `{GUILD_ID}_500`" and any("자동으로 다시 시도합니다" in t for t in first)   # 전사가 끝났다
    assert second == []                                                                              # 예약된 재시도의 실패
    assert any("자동 재시도를 멈췄습니다" in t for t in third)                                          # 포기
    cog.cog_unload()
    await asyncio.wait([task], timeout=1)


async def _failure_after_stop(cog, ctx, channel):
    await _run(A.RecordingCog.record, cog, ctx)
    rec = cog._active[GUILD_ID]
    rec.sink.on_samples(1, _tone(2000), 0)
    await _run(A.RecordingCog.stop, cog, ctx)
    await asyncio.wait_for(rec.done.wait(), 20)
    return [t for t in _texts(channel) if t.startswith("⚠️ 할일 추출 실패")]


async def test_a_failure_after_stop_says_the_retry_is_automatic(tmp_path):
    cog, guild, vc, channel, ctx = _setup(tmp_path, extractor=_dying)
    task = await _start_idle_loop(cog)
    failure = await _failure_after_stop(cog, ctx, channel)
    assert len(failure) == 1 and "1분 뒤 이 단계부터 자동으로 다시 시도합니다" in failure[0]
    cog.cog_unload()
    await asyncio.wait([task], timeout=1)


async def test_a_failure_after_stop_points_to_recover_when_the_loop_is_not_running(tmp_path):
    """루프가 안 떠 있으면(주기 0, 또는 on_ready 전) 자동으로 다시 한다고 말하지 않는다."""
    cog, guild, vc, channel, ctx = _setup(tmp_path, extractor=_dying)
    failure = await _failure_after_stop(cog, ctx, channel)
    assert len(failure) == 1 and "`/recover` 로 이 단계부터 다시 시도하세요" in failure[0]
