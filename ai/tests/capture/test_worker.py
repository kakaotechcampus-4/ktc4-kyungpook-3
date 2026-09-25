"""후처리 워커(capture/worker.py). 디스코드를 모르고, 봇과 같은 복구 한 바퀴로 끝나지 않은 회의를 처리해 BE 로 넘긴다.
모델은 안 쓴다. import 와 종료 신호는 하위 프로세스를 실제로 띄워 본다."""

import asyncio
import json
import signal
import subprocess
import sys
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

from capture import handoff as H
from capture import recorder as R
from capture import worker as W
from tests.capture.fake_be import FakeBe
from tests.capture.test_recorder import EchoStt, _extractor, _session

AI_DIR = Path(__file__).resolve().parents[2]


def _worker(tmp_path, *, handoff=None, extractor=None, interval_s=3600.0, poll_s=0.02):
    return W.Worker(tmp_path / "recordings", transcripts_dir=tmp_path / "transcripts",
                    stt_factory=lambda: (EchoStt(), "echo", 1), gate_factory=lambda: None,
                    extractor_factory=lambda: extractor, handoff_factory=lambda: handoff,
                    interval_s=interval_s, poll_s=poll_s)


def _status(path):
    return json.loads(path.read_text(encoding="utf-8"))["status"]


def _edit(path, **fields):
    m = json.loads(path.read_text(encoding="utf-8"))
    m.update(fields)
    R.save_manifest(path, m)


def test_the_worker_does_not_import_discord():
    code = ("import sys\nimport capture.worker\n"
            "print(sorted(m for m in sys.modules if m == 'discord' or m.startswith('discord.') "
            "or m == 'capture.discord_adapter'))\n")
    out = subprocess.run([sys.executable, "-c", code], cwd=AI_DIR, capture_output=True, text=True, timeout=120)
    assert out.returncode == 0, out.stderr
    assert out.stdout.strip() == "[]"


async def test_a_worker_pass_processes_only_due_meetings_and_hands_them_to_be(tmp_path):
    rec, due, _ = _session(tmp_path, ts=500)
    _, later, _ = _session(tmp_path, ts=600)
    soon = (datetime.now(timezone.utc) + timedelta(hours=1)).replace(microsecond=0).isoformat()
    _edit(later, status="failed", failed_stage="extract", recovery={"attempts": 1, "next_at": soon})
    _, gave_up, _ = _session(tmp_path, ts=700)
    _edit(gave_up, status="failed", failed_stage="extract",
          recovery={"attempts": 5, "gave_up_at": "2026-09-26T00:00:00+00:00", "failed_stage": "extract"})
    _, recording, _ = _session(tmp_path, ts=800, status=R.STATUS_RECORDING)
    held = R.try_lock(recording)                                   # 봇이 녹음 중이다
    _, old, _ = _session(tmp_path, ts=900)
    m = json.loads(old.read_text(encoding="utf-8"))
    m.pop("guild_id")
    R.save_manifest(old, m)                                        # 서버가 적히지 않은 옛 매니페스트
    fake = FakeBe()
    worker = _worker(tmp_path, extractor=_extractor({}), handoff=H.Handoff(H.BeClient("http://be", session=fake), "ws-1"))
    results, busy = await worker.run_pass()
    held.release()
    assert [r["session"] for r in results] == ["77_500"] and _status(due) == "handed_off"
    assert [_status(p) for p in (later, gave_up, recording, old)] == ["failed", "failed", "recording", "saved"]
    assert list(fake.extractions) == ["m1"]                        # 결과는 BE 로 갔다


def _slow_process(monkeypatch, started, release, seen=None):
    real = R.process_session

    def slow(*args, **kwargs):
        if seen is not None:
            seen.append(args[1]["session"])
        started.set()
        release.wait(5)
        return real(*args, **kwargs)

    monkeypatch.setattr(R, "process_session", slow)


async def test_a_stop_signal_takes_no_new_meeting_but_finishes_the_current_one(tmp_path, monkeypatch):
    rec, first, _ = _session(tmp_path, ts=500)
    _, second, _ = _session(tmp_path, ts=600)
    started, release = threading.Event(), threading.Event()
    _slow_process(monkeypatch, started, release)
    worker = _worker(tmp_path)
    task = asyncio.create_task(worker.run())
    await asyncio.to_thread(started.wait, 5)                       # 첫 회의를 처리하는 중
    worker.stop()
    release.set()
    await asyncio.wait_for(task, 20)
    assert _status(first) == "transcribed" and _status(second) == "saved"


async def test_the_heartbeat_stays_fresh_while_a_long_meeting_is_processed(tmp_path, monkeypatch):
    """전사 한 건이 17분 걸려도 봇의 /recover 가 "워커가 응답이 없습니다" 라고 하면 안 된다."""
    rec, path, _ = _session(tmp_path, ts=500)
    started, release = threading.Event(), threading.Event()
    _slow_process(monkeypatch, started, release)
    worker = _worker(tmp_path, interval_s=0.05)
    task = asyncio.create_task(worker.run())
    await asyncio.to_thread(started.wait, 5)
    first = W.read_heartbeat(tmp_path / "recordings")
    await asyncio.sleep(0.3)
    second = W.read_heartbeat(tmp_path / "recordings")
    worker.stop()
    release.set()
    await asyncio.wait_for(task, 20)
    assert second["at_ts"] > first["at_ts"] and second["current"] == "77_500"
    assert W.read_heartbeat(tmp_path / "recordings")["state"] == "stopped"


async def test_a_wake_request_runs_a_manual_pass_for_that_server_at_once(tmp_path):
    """봇의 /recover 가 깨우면 그 서버의 회의를 사람이 친 /recover 처럼(포기한 회의까지) 바로 돈다."""
    rec, gave_up, _ = _session(tmp_path, ts=500)
    _edit(gave_up, status="failed", failed_stage="stt",
          recovery={"attempts": 5, "gave_up_at": "2026-09-26T00:00:00+00:00", "failed_stage": "stt"})
    worker = _worker(tmp_path)                                     # 다음 바퀴는 한 시간 뒤
    task = asyncio.create_task(worker.run())
    await asyncio.sleep(0.2)
    assert _status(gave_up) == "failed"                            # 루프 바퀴는 포기한 회의를 건드리지 않는다
    W.request_wake(tmp_path / "recordings", "77")
    deadline = time.monotonic() + 10
    while _status(gave_up) == "failed" and time.monotonic() < deadline:
        await asyncio.sleep(0.05)
    worker.stop()
    await asyncio.wait_for(task, 20)
    assert _status(gave_up) == "transcribed"
    assert list((tmp_path / "recordings" / ".worker").glob("wake-*")) == []


def test_the_worker_process_exits_cleanly_on_sigterm(tmp_path):
    rec = tmp_path / "recordings"
    child = subprocess.Popen([sys.executable, "-m", "capture.worker", "--recordings", str(rec),
                              "--transcripts", str(tmp_path / "transcripts"), "--interval", "0.2"],
                             cwd=AI_DIR, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        deadline = time.monotonic() + 60
        while W.read_heartbeat(rec) is None and time.monotonic() < deadline and child.poll() is None:
            time.sleep(0.05)
        assert W.read_heartbeat(rec) is not None, child.stderr.read() if child.poll() is not None else "심박 없음"
        child.send_signal(signal.SIGTERM)
        assert child.wait(timeout=30) == 0
    finally:
        if child.poll() is None:
            child.kill()
            child.wait(timeout=10)
    assert W.read_heartbeat(rec)["state"] == "stopped"


# ------------------------------------------------------------------ 워커 모드의 봇
import pytest  # noqa: E402

from capture import discord_adapter as A  # noqa: E402
from tests.capture import test_discord_adapter as T  # noqa: E402
from tests.capture.test_recovery_loop import _meeting  # noqa: E402


def _no_stt():
    raise AssertionError("워커 모드의 봇은 전사 백엔드를 부르면 안 된다")


def _worker_cog(tmp_path):
    cog, guild, vc, channel, ctx = T._setup(tmp_path)
    return A.RecordingCog(cog.bot, recordings_dir=tmp_path / "recordings", transcripts_dir=tmp_path / "transcripts",
                          stt_factory=_no_stt, gate_factory=lambda: None, extractor_factory=lambda: None,
                          handoff_factory=lambda: None, mode="worker"), guild, vc, channel, ctx


def test_an_unknown_pipeline_mode_fails_at_start(tmp_path):
    """오타 하나로 봇 모드가 되면 4GB 서버에 모델(약 2.5GB)이 올라간다."""
    cog, *_ = T._setup(tmp_path)
    with pytest.raises(ValueError):
        A.RecordingCog(cog.bot, recordings_dir=tmp_path / "recordings", mode="wroker")


async def test_worker_mode_stop_saves_only_and_says_how_many_meetings_are_ahead(tmp_path):
    cog, guild, vc, channel, ctx = _worker_cog(tmp_path)
    _meeting(tmp_path, 100)
    _meeting(tmp_path, 200)
    _meeting(tmp_path, 300, recovery={"attempts": 5, "gave_up_at": "2026-09-26T00:00:00+00:00"})   # 포기. 차례가 없다
    await T._run(A.RecordingCog.record, cog, ctx)
    rec = cog._active[T.GUILD_ID]
    rec.sink.on_samples(1, T._tone(2000), 0)
    await T._run(A.RecordingCog.stop, cog, ctx)
    await asyncio.wait_for(rec.done.wait(), 20)
    path = R.manifest_path(tmp_path / "recordings", rec.meeting_id)
    assert _status(path) == "saved" and R.is_locked(path) is False
    saved = [t for t, _ in channel.sent if "녹음을 저장했습니다" in t]
    assert len(saved) == 1 and "웹에서 확인" in saved[0] and "앞에 2건" in saved[0]
    assert not any(t.startswith("📝 회의록") for t, _ in channel.sent)


async def test_worker_mode_releases_the_lock_only_after_saved_is_written(tmp_path):
    """먼저 놓으면 워커가 잠금 없는 recording 을 끊긴 녹음으로 읽고 녹음 중인 트랙을 집을 수 있다."""
    cog, guild, vc, channel, ctx = _worker_cog(tmp_path)
    await T._run(A.RecordingCog.record, cog, ctx)
    rec = cog._active[T.GUILD_ID]
    path = R.manifest_path(tmp_path / "recordings", rec.meeting_id)
    seen = []
    real_release = rec.lock.release

    def watching():
        seen.append(_status(path))
        real_release()

    rec.lock.release = watching
    rec.sink.on_samples(1, T._tone(2000), 0)
    await T._run(A.RecordingCog.stop, cog, ctx)
    await asyncio.wait_for(rec.done.wait(), 20)
    assert seen and seen[0] == "saved"


async def test_worker_mode_loop_posts_restart_notices_but_never_processes(tmp_path):
    cog, guild, vc, channel, ctx = _worker_cog(tmp_path)
    waiting = _meeting(tmp_path, 500)
    cut = _meeting(tmp_path, 600, status=R.STATUS_RECORDING,
                   started_at=(datetime.now(timezone.utc) - timedelta(minutes=30)).replace(microsecond=0).isoformat())
    await cog._tick()
    assert [t for t, _ in channel.sent] == [A.RESUME_NOTICE]
    assert _status(waiting) == "saved" and _status(cut) == "recording"      # 처리는 워커 몫이다


def _beat(tmp_path, *, age_s, interval_s=10.0, state="running", current=None):
    R.save_manifest(tmp_path / "recordings" / ".worker" / "heartbeat.json",
                    {"state": state, "pid": 1, "host": "h", "at": "x", "at_ts": time.time() - age_s,
                     "interval_s": interval_s, "current": current, "started_at": "x"})


async def test_worker_mode_recover_wakes_the_worker_and_reports_the_queue_and_a_live_worker(tmp_path):
    cog, guild, vc, channel, ctx = _worker_cog(tmp_path)
    first = _meeting(tmp_path, 100)
    second = _meeting(tmp_path, 200)
    busy = _meeting(tmp_path, 300, claimed_by="host:7:w", claimed_at=(datetime.now(timezone.utc) - timedelta(minutes=4))
                    .replace(microsecond=0).isoformat())
    held = R.try_lock(busy)                                        # 워커가 처리 중이다
    _beat(tmp_path, age_s=5, current=f"{T.GUILD_ID}_300")
    await T._run(A.RecordingCog.recover_cmd, cog, ctx)
    held.release()
    assert (tmp_path / "recordings" / ".worker" / f"wake-{T.GUILD_ID}").exists()
    text = "\n".join(t for t, _ in channel.sent)
    assert "대기 2건" in text and "처리 중 1건" in text and f"{T.GUILD_ID}_300" in text and "4분째" in text
    assert "마지막 신호" in text and "응답이 없습니다" not in text
    assert [_status(p) for p in (first, second, busy)] == ["saved", "saved", "saved"]      # 봇은 처리하지 않는다


async def test_worker_mode_recover_says_when_the_worker_is_quiet_or_missing(tmp_path):
    cog, guild, vc, channel, ctx = _worker_cog(tmp_path)
    _beat(tmp_path, age_s=600)                                     # 10분째 조용하다
    await T._run(A.RecordingCog.recover_cmd, cog, ctx)
    assert "워커가 10분째 응답이 없습니다" in channel.sent[-1][0]
    (tmp_path / "recordings" / ".worker" / "heartbeat.json").unlink()
    await T._run(A.RecordingCog.recover_cmd, cog, ctx)
    assert "워커 신호가 없습니다" in channel.sent[-1][0]
