"""봇의 재시작 안내 루프와 회의 잠금(capture/discord_adapter.py). 안내, 루프 태스크의 시작과 정리, 같은 초의 녹음,
녹음 중 잠금. 처리는 워커가 하므로 여기서는 하지 않는다(tests/capture/test_worker.py). 가짜 디스코드 객체를 쓴다."""

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


def _minutes_ago(n):
    return (datetime.now(timezone.utc) - timedelta(minutes=n)).replace(microsecond=0).isoformat()


async def test_an_interrupted_recording_gets_one_restart_notice_in_its_own_channel(tmp_path):
    """봇은 안내만 한다. 녹음된 부분의 처리는 워커가 한다."""
    cog, guild, vc, channel, ctx = _setup(tmp_path)
    cut = _meeting(tmp_path, 500, status=R.STATUS_RECORDING, started_at=_minutes_ago(30))   # 봇이 뜨기 전에 시작돼 끊겼다
    ours = _meeting(tmp_path, 600, status=R.STATUS_RECORDING, started_at=now_iso())   # 이 봇이 시작했다가 트랙을 닫다 죽었다
    await cog._tick()
    await cog._tick()
    assert _texts(channel) == [A.RESUME_NOTICE]
    assert _status(cut) == "recording" and _status(ours) == "recording"


async def test_an_old_cut_gets_no_restart_notice(tmp_path):
    """봇이 오래 꺼져 있다 뜨면 회의는 이미 끝났다. "이어서 기록하려면" 안내는 마지막 트랙 쓰기가 한 시간 안일 때만."""
    cog, guild, vc, channel, ctx = _setup(tmp_path)
    _meeting(tmp_path, 500, status=R.STATUS_RECORDING, started_at=_minutes_ago(300))
    stale = time.time() - 3 * 3600
    for wav in (tmp_path / "recordings" / f"{GUILD_ID}_500").glob("*.wav"):
        os.utime(wav, (stale, stale))                               # 마지막으로 쓴 것이 세 시간 전
    await cog._tick()
    assert _texts(channel) == []


async def test_a_cog_added_after_the_bot_is_ready_starts_the_loop_itself(tmp_path):
    """봇 쪽이 on_ready 뒤에 Cog 를 붙이면 이 Cog 는 on_ready 를 못 받는다. 붙는 순간 루프를 띄운다."""
    cog, *_ = _setup(tmp_path)

    class ReadyBot(FakeBot):
        def is_ready(self):
            return True

    late = A.RecordingCog(ReadyBot(cog.bot._guild), recordings_dir=tmp_path / "recordings",
                          handoff_factory=lambda: None)
    tasks = [late._recovery_task, late._outbox_task]
    assert all(t is not None and not t.done() for t in tasks)
    late.cog_unload()
    await asyncio.wait(tasks, timeout=1)


async def test_on_ready_starts_one_loop_that_runs_at_once_and_cog_unload_cancels_it(tmp_path, monkeypatch):
    cog, *_ = _setup(tmp_path)
    cog._recovery_interval_s = 10
    passes = []

    async def counting_tick():
        passes.append(1)

    monkeypatch.setattr(cog, "_tick", counting_tick)
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

    async def flaky_tick():
        passes.append(1)
        if len(passes) == 1:
            raise RuntimeError("깨진 매니페스트")

    monkeypatch.setattr(cog, "_tick", flaky_tick)
    await cog.on_ready()
    await asyncio.sleep(0.1)
    task = cog._recovery_task
    assert len(passes) >= 2 and not task.done()
    cog.cog_unload()
    await asyncio.wait([task], timeout=1)


async def test_a_recording_started_in_the_same_second_gets_its_own_meeting(tmp_path, monkeypatch):
    """회의 ID 는 초 단위다. 앞 회의를 저장하는 중에 같은 초에 새 녹음을 시작하면 앞 회의의 매니페스트를 덮어썼다."""
    cog, guild, vc, channel, ctx = _setup(tmp_path)
    monkeypatch.setattr(A.time, "time", lambda: 1_790_000_000.0)    # 두 /record 가 같은 초에 온다
    started = asyncio.Event()
    release = threading.Event()
    loop = asyncio.get_running_loop()
    await _run(A.RecordingCog.record, cog, ctx)
    first = cog._active[GUILD_ID]
    real_close = first.pool.close

    def slow_close():
        loop.call_soon_threadsafe(started.set)
        release.wait(5)
        return real_close()

    first.pool.close = slow_close
    first.sink.on_samples(1, _tone(2000), 0)
    await _run(A.RecordingCog.stop, cog, ctx)
    await asyncio.wait_for(started.wait(), 5)                       # 앞 회의를 저장하는 중
    await _run(A.RecordingCog.record, cog, ctx)
    second = cog._active[GUILD_ID]
    assert second.meeting_id != first.meeting_id
    assert _manifest(tmp_path, first)["status"] == "recording"      # 앞 회의의 기록이 그대로다
    release.set()
    await asyncio.wait_for(first.done.wait(), 20)
    assert _manifest(tmp_path, first)["status"] == "saved"
    await _run(A.RecordingCog.stop, cog, ctx)
    await asyncio.wait_for(second.done.wait(), 20)


def _path_of(tmp_path, rec):
    return R.manifest_path(tmp_path / "recordings", rec.meeting_id)


async def test_record_takes_the_meeting_lock_before_writing_the_recording_manifest(tmp_path, monkeypatch):
    """워커는 봇 메모리를 못 본다. 녹음 중인 회의는 잠금으로 막아야 하고, 잠금 없는 recording 은 끊긴 녹음으로 읽힌다."""
    cog, guild, vc, channel, ctx = _setup(tmp_path)
    seen = []
    real = A.write_status

    def watching(recordings_dir, session, *, status, **kw):
        if status == R.STATUS_RECORDING:
            seen.append(R.is_locked(R.manifest_path(recordings_dir, session)))
        return real(recordings_dir, session, status=status, **kw)

    monkeypatch.setattr(A, "write_status", watching)
    await _run(A.RecordingCog.record, cog, ctx)
    rec = cog._active[GUILD_ID]
    assert seen and all(seen)                                        # recording 을 쓸 때마다 이미 잠금을 쥐고 있었다
    assert R.Claims(owner="worker").acquire(_path_of(tmp_path, rec)) is None      # 워커 자리에서 못 집는다
    await _run(A.RecordingCog.stop, cog, ctx)
    await asyncio.wait_for(rec.done.wait(), 20)


