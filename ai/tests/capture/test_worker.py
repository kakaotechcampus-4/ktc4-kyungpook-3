"""후처리 워커(capture/worker.py). 디스코드를 모르고, 봇과 같은 복구 한 바퀴로 끝나지 않은 회의를 처리해 BE 로 넘긴다.
모델은 안 쓴다. import 와 종료 신호는 하위 프로세스를 실제로 띄워 본다."""

import asyncio
import json
import os
import re
import signal
import subprocess
import sys
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

from capture import handoff as H
from capture import ops_record as O
from capture import recorder as R
from capture import worker as W
from tests.capture.fake_be import FakeBe
from tests.capture.test_recorder import EchoStt, _extractor, _session

AI_DIR = Path(__file__).resolve().parents[2]


def _worker(tmp_path, *, handoff=None, extractor=None, interval_s=3600.0, poll_s=0.02, notifier=None, debug=False):
    return W.Worker(tmp_path / "recordings", transcripts_dir=tmp_path / "transcripts",
                    stt_factory=lambda: (EchoStt(), "echo", 1), gate_factory=lambda: None,
                    extractor_factory=lambda: extractor, handoff_factory=lambda: handoff,
                    interval_s=interval_s, poll_s=poll_s, notifier=notifier, debug=debug)


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
    worker = _worker(tmp_path, extractor=_extractor({}), handoff=H.Handoff(H.BeClient("http://be", session=fake, service_token="svc-token")))
    results, busy = await worker.run_pass()
    held.release()
    assert [r["session"] for r in results] == ["77_500"] and _status(due) == "handed_off"
    assert [_status(p) for p in (later, gave_up, recording, old)] == ["failed", "failed", "recording", "saved"]
    assert list(fake.extractions) == ["m1"]                        # 결과는 BE 로 갔다


async def test_the_log_line_ends_with_time_wait_and_memory(tmp_path, monkeypatch, capsys):
    """워커 모드는 채널에 결과를 올리지 않는다. 처리 기록 한 줄은 로그 끝에 남긴다."""
    monkeypatch.setattr(O, "read_rss", lambda: 2_000_000_000)
    rec, path, _ = _session(tmp_path, ts=500)
    await _worker(tmp_path).run_pass()
    line = next(ln for ln in capsys.readouterr().out.splitlines() if ln.startswith("[worker] 세션 77_500"))
    assert re.search(r" 처리 \d+(\.\d+)?초 대기 \d+(\.\d+)?초 최대 메모리 1907MB$", line), line


async def test_a_worker_leaves_a_meeting_of_an_unconnected_server_untranscribed(tmp_path):
    """연결 없는 서버의 회의를 워커는 전사하지 않는다(#199). 웹에서 연결하면 다음 바퀴에 처음부터 처리한다."""
    rec, path, _ = _session(tmp_path, ts=500)
    m = json.loads(path.read_text(encoding="utf-8"))
    m.pop("workspace_id")
    R.save_manifest(path, m)
    fake = FakeBe()
    worker = _worker(tmp_path, extractor=_extractor({}),
                     handoff=H.Handoff(H.BeClient("http://be", session=fake, service_token="svc-token")))
    await worker.run_pass()
    saved = json.loads(path.read_text(encoding="utf-8"))
    assert saved["status"] == "saved" and "transcribed" not in saved.get("stages", {}) and saved["workspace_wait"]
    fake.guilds = {"77": "ws-1"}
    _edit(path, workspace_wait="2026-01-01T00:00:00+00:00")       # 마지막으로 물은 지 1분이 지났다
    await worker.run_pass()
    assert _status(path) == "handed_off" and list(fake.extractions) == ["m1"]


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
    """전사 한 건이 17분 걸려도 봇의 저장 알림이 "워커가 응답이 없습니다" 라고 하면 안 된다."""
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
    """--retry 가 깨우면 그 서버의 회의를 포기한 것까지 바로 돈다(manual)."""
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


# ------------------------------------------------------------------ 봇. 저장까지만 하고 처리는 워커가 한다
import pytest  # noqa: E402

from capture import discord_adapter as A  # noqa: E402
from tests.capture import test_discord_adapter as T  # noqa: E402
from tests.capture.test_recovery_loop import _meeting  # noqa: E402


def _beat(tmp_path, *, age_s, interval_s=10.0, state="running", current=None):
    R.save_manifest(tmp_path / "recordings" / ".worker" / "heartbeat.json",
                    {"state": state, "pid": 1, "host": "h", "at": "x", "at_ts": time.time() - age_s,
                     "interval_s": interval_s, "current": current, "started_at": "x"})


async def _save_one(cog, ctx):
    await T._run(A.RecordingCog.record, cog, ctx)
    rec = cog._active[T.GUILD_ID]
    rec.sink.on_samples(1, T._tone(2000), 0)
    await T._run(A.RecordingCog.stop, cog, ctx)
    await asyncio.wait_for(rec.done.wait(), 20)
    return rec


async def test_stop_saves_only_and_says_how_many_meetings_are_ahead(tmp_path):
    cog, guild, vc, channel, ctx = T._setup(tmp_path)
    _meeting(tmp_path, 100)
    _meeting(tmp_path, 200)
    _meeting(tmp_path, 300, recovery={"attempts": 5, "gave_up_at": "2026-09-26T00:00:00+00:00"})   # 포기. 차례가 없다
    _beat(tmp_path, age_s=5)
    rec = await _save_one(cog, ctx)
    path = R.manifest_path(tmp_path / "recordings", rec.meeting_id)
    assert _status(path) == "saved" and R.is_locked(path) is False
    saved = [t for t, _ in channel.sent if "녹음을 저장했습니다" in t]
    assert len(saved) == 1 and "앞에 2건" in saved[0] and "⚠️" not in saved[0]      # 워커가 살아 있으면 경고가 없다
    assert not any(t.startswith("📝") for t, _ in channel.sent)                    # 전사는 워커 몫이다


async def test_stop_warns_when_the_worker_is_quiet_stopped_or_missing(tmp_path):
    """/recover 가 없어서 워커가 죽은 것을 알 자리는 저장 알림뿐이다. 그대로 두면 처리 알림을 하염없이 기다린다."""
    cog, guild, vc, channel, ctx = T._setup(tmp_path)
    _beat(tmp_path, age_s=600)                                     # 10분째 조용하다
    await _save_one(cog, ctx)
    assert "워커가 10분째 응답이 없습니다" in channel.sent[-1][0]
    _beat(tmp_path, age_s=1, state="stopped")
    await _save_one(cog, ctx)
    assert "워커가 멈춰 있습니다" in channel.sent[-1][0]
    (tmp_path / "recordings" / ".worker" / "heartbeat.json").unlink()
    await _save_one(cog, ctx)
    assert "워커 신호가 없습니다" in channel.sent[-1][0]


async def test_the_bot_releases_the_lock_only_after_saved_is_written(tmp_path):
    """먼저 놓으면 워커가 잠금 없는 recording 을 끊긴 녹음으로 읽고 녹음 중인 트랙을 집을 수 있다."""
    cog, guild, vc, channel, ctx = T._setup(tmp_path)
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


async def test_the_bot_loop_posts_restart_notices_but_never_processes(tmp_path):
    cog, guild, vc, channel, ctx = T._setup(tmp_path)
    waiting = _meeting(tmp_path, 500)
    cut = _meeting(tmp_path, 600, status=R.STATUS_RECORDING,
                   started_at=(datetime.now(timezone.utc) - timedelta(minutes=30)).replace(microsecond=0).isoformat())
    await cog._tick()
    assert [t for t, _ in channel.sent] == [A.RESUME_NOTICE]
    assert _status(waiting) == "saved" and _status(cut) == "recording"      # 처리는 워커 몫이다


async def test_the_restart_notice_goes_out_even_after_the_worker_took_the_meeting(tmp_path):
    """봇이 다시 뜨기 전에 워커가 끊긴 녹음을 먼저 집어 recording 이 아니게 됐다. 안내는 그래도 한 번 나간다.
    끊긴 지 오래된 회의에는 안내하지 않는다."""
    cog, guild, vc, channel, ctx = T._setup(tmp_path)
    ago = (datetime.now(timezone.utc) - timedelta(minutes=30)).replace(microsecond=0).isoformat()
    cut = _meeting(tmp_path, 600, status=R.STATUS_RECORDING, started_at=ago)
    old = _meeting(tmp_path, 700, status=R.STATUS_RECORDING, started_at=ago)
    stale = time.time() - 3 * 3600
    for wav in (tmp_path / "recordings" / f"{T.GUILD_ID}_700").glob("*.wav"):
        os.utime(wav, (stale, stale))
    R.recover(tmp_path / "recordings", backend=EchoStt(), model_name="echo", workers=1,
              transcripts_dir=tmp_path / "transcripts")                 # 워커가 먼저 처리했다
    assert _status(cut) == "transcribed" and _status(old) == "transcribed"
    await cog._tick()
    await cog._tick()
    assert [t for t, _ in channel.sent] == [A.RESUME_NOTICE]


BACKEND_MODULES = ("stt.batch", "stt.local", "stt.elice", "stt.transcribe", "faster_whisper", "ctranslate2", "openai")


def test_the_bot_never_imports_a_transcription_backend(tmp_path):
    """모델(약 2.5GB)이 봇 프로세스에 올라오지 않는다. 기본 설정 그대로 /record, /stop, 루프 한 번, 우편함 한 번을 돈다."""
    code = f"""
import asyncio, sys
from pathlib import Path
from capture import discord_adapter as A
from tests.capture import test_discord_adapter as T

async def main():
    tmp = Path({str(tmp_path)!r})
    vc = T.FakeVC(T.FakeVoiceChannel())
    guild = T.FakeGuild({{1: T.FakeMember(1, "민수")}}, vc)
    channel = T.FakeTextChannel()
    cog = A.RecordingCog(T.FakeBot(guild, channels=[channel]), recordings_dir=tmp / "recordings")
    ctx = T.FakeCtx(guild, vc, channel)
    await T._run(A.RecordingCog.record, cog, ctx)
    rec = cog._active[guild.id]
    rec.sink.on_samples(1, T._tone(2000), 0)
    await T._run(A.RecordingCog.stop, cog, ctx)
    await asyncio.wait_for(rec.done.wait(), 20)
    await cog._tick()
    await cog._drain_outbox()
    assert any("녹음을 저장했습니다" in t for t, _ in channel.sent), channel.sent

asyncio.run(main())
print(sorted(m for m in sys.modules if m in {BACKEND_MODULES!r} or m.split(".")[0] in {BACKEND_MODULES!r}))
"""
    out = subprocess.run([sys.executable, "-c", code], cwd=AI_DIR, capture_output=True, text=True, timeout=120)
    assert out.returncode == 0, out.stderr[-2000:]
    assert out.stdout.strip().splitlines()[-1] == "[]"


def test_the_worker_catches_stop_signals_where_the_loop_cannot(monkeypatch):
    """윈도의 이벤트 루프에는 add_signal_handler 가 없다(NotImplementedError). 그때는 signal.signal 로 건다."""
    class WindowsLoop:
        def __init__(self):
            self.soon = []

        def add_signal_handler(self, sig, handler):
            raise NotImplementedError

        def call_soon_threadsafe(self, fn):
            self.soon.append(fn)

    registered = {}
    monkeypatch.setattr(W.signal, "signal", lambda sig, handler: registered.__setitem__(sig, handler))
    loop, stopped = WindowsLoop(), []
    W._on_stop_signals(loop, lambda: stopped.append(True))
    assert set(registered) == {W.signal.SIGTERM, W.signal.SIGINT}
    registered[W.signal.SIGINT](W.signal.SIGINT, None)                       # Ctrl+C
    loop.soon[0]()
    assert stopped == [True]


# ------------------------------------------------------------------ 판단 경로
def test_an_unknown_extract_path_fails_at_start(tmp_path, monkeypatch):
    """오타 하나로 말없이 옛 추출기가 돌면 다른 모양의 결과가 BE 로 간다. 추출을 하는 워커가 시작할 때 멈춘다."""
    monkeypatch.setenv("MM_EXTRACT_PATH", "jugde")
    with pytest.raises(ValueError):
        _worker(tmp_path)
    monkeypatch.setenv("MM_EXTRACT_PATH", "judge")
    assert _worker(tmp_path) is not None


async def test_a_worker_pass_hands_judge_items_to_be(tmp_path):
    """워커 모드에서도 같은 추출기가 돈다. 판단 항목이 그대로 BE 로 간다."""
    from capture.judge_path import JudgeOutput

    rec, path, _ = _session(tmp_path, ts=500)
    item = T._judge_item("결제 환불 기능 구현")
    fake = FakeBe()
    worker = _worker(tmp_path, extractor=lambda transcript, names, today, workspace_id=None: JudgeOutput(items=[item]),
                     handoff=H.Handoff(H.BeClient("http://be", session=fake, service_token="svc-token")))
    results, busy = await worker.run_pass()
    assert _status(path) == "handed_off" and results[0]["items"] == [item] and busy == []
    assert fake.extractions["m1"]["items"] == [item]


async def test_the_worker_log_says_why_a_meeting_failed_and_what_was_left_unjudged(tmp_path, monkeypatch, capsys):
    """워커 모드는 채널에 결과를 올리지 않는다. 판단하지 못한 finding 과 실패 이유가 로그에도 없으면 매니페스트를 열어야 안다."""
    from capture.judge_path import JudgeOutput

    monkeypatch.setattr(R, "EXTRACT_RETRY_MAX", 1)
    rec, path, _ = _session(tmp_path, ts=500)
    item = T._judge_item("결제 환불 기능 구현")
    unjudged = [{"stage": "judge", "text": "로그인 마감을 미루기로 함", "reason": "Terra 응답을 파싱하지 못했습니다."}]
    fake = FakeBe()
    worker = _worker(tmp_path, extractor=lambda transcript, names, today, workspace_id=None: JudgeOutput(items=[item], failures=unjudged),
                     handoff=H.Handoff(H.BeClient("http://be", session=fake, service_token="svc-token")))
    await worker.run_pass()
    first = capsys.readouterr().out
    assert "failed" in first and "ExtractIncomplete" in first and "발화 1개를 판단하지 못했다" in first
    await worker.run_pass(guild_id="77", manual=True)         # 다음 시도. 상한(1회)에 닿아 남긴 채 인계한다
    second = capsys.readouterr().out
    assert "handed_off" in second and "판단하지 못한 발화 1건" in second and _status(path) == "handed_off"


async def test_the_worker_log_says_how_many_lines_were_saved(tmp_path, capsys):
    """워커 모드는 채널에 올리지 않는다. 회의록이 BE 에 갔는지가 로그에라도 있어야 한다."""
    _session(tmp_path, ts=500)
    fake = FakeBe()
    with_token = H.Handoff(H.BeClient("http://be", session=fake, service_token="svc-token"))
    await _worker(tmp_path, extractor=_extractor({}), handoff=with_token).run_pass()
    assert "회의록 저장 3줄" in capsys.readouterr().out and sorted(fake.sources["m1"]) == [1, 2, 3]


# ── 채널 알림(capture/notify.py). 워커가 쓰고 봇이 올린다 ─────────────────────────────────────────────────

class Notes:
    def __init__(self):
        self.sent = []

    def send(self, channel_id, text, file=None):
        self.sent.append((channel_id, text))
        return True


async def test_the_worker_tells_the_meetings_channel_each_stage_it_finished(tmp_path):
    rec, path, _ = _session(tmp_path, ts=500)
    notes = Notes()
    worker = _worker(tmp_path, extractor=_extractor({}), notifier=notes,
                     handoff=H.Handoff(H.BeClient("http://be", session=FakeBe(), service_token="svc-token")))
    await worker.run_pass()
    assert [t.split(" ", 1)[0] for _, t in notes.sent] == ["⏳", "📝", "🗂", "📋", "📨"]
    assert {c for c, _ in notes.sent} == {"900"}


async def test_passes_over_a_meeting_that_does_not_move_say_nothing(tmp_path):
    """설정이 없어 전사에서 멈춘 회의를 워커는 바퀴마다 다시 집는다. 처음 처리 뒤로는 채널이 조용하다."""
    rec, path, _ = _session(tmp_path, ts=500)
    notes = Notes()
    worker = _worker(tmp_path, notifier=notes)
    await worker.run_pass()
    first = list(notes.sent)
    assert [t.split(" ", 1)[0] for _, t in first][:2] == ["⏳", "📝"] and any("건너뛴 단계" in t for _, t in first)
    for _ in range(3):
        await worker.run_pass()
    assert notes.sent == first


async def test_a_meeting_whose_be_token_is_refused_says_start_and_why_once(tmp_path):
    """서비스 토큰이 거절되면(401) 워커는 전사도 하지 않고 그 회의를 바퀴마다 다시 집는다. 처리 시작과 건너뛴 이유는
    한 번만 말한다. 바퀴마다 "처리를 시작합니다" 가 10초 간격으로 쌓이면 안 된다."""
    rec, path, _ = _session(tmp_path, ts=500)
    _edit(path, workspace_id=None)

    class Refused:
        def workspace(self, meta):
            raise H.BeError("UNAUTHENTICATED", "토큰 거절", status=401)

    notes = Notes()
    worker = _worker(tmp_path, handoff=Refused(), notifier=notes)
    for _ in range(3):
        await worker.run_pass()
    texts = [t for _, t in notes.sent]
    assert texts.count("⏳ 회의 처리를 시작합니다.") == 1 and len(texts) == 2
    assert "BE 서비스 토큰 거절" in texts[1] and "전사" in texts[1]


async def test_the_debug_report_ends_with_the_processing_line(tmp_path):
    rec, path, _ = _session(tmp_path, ts=500)
    notes = Notes()
    await _worker(tmp_path, notifier=notes, debug=True).run_pass()
    assert notes.sent[-1][1].startswith("⏱ 처리")


async def test_by_default_the_worker_writes_its_notes_to_the_outbox_for_the_bot(tmp_path, monkeypatch):
    monkeypatch.delenv("MM_DEBUG_REPORT", raising=False)
    rec, path, _ = _session(tmp_path, ts=500)
    worker = W.Worker(tmp_path / "recordings", transcripts_dir=tmp_path / "transcripts",
                      stt_factory=lambda: (EchoStt(), "echo", 1), gate_factory=lambda: None,
                      extractor_factory=lambda: None, handoff_factory=lambda: None, interval_s=3600.0)
    await worker.run_pass()
    notes = sorted((tmp_path / "recordings" / ".worker" / "outbox").glob("*.json"))
    texts = [json.loads(p.read_text(encoding="utf-8"))["text"] for p in notes]
    assert texts[0] == "⏳ 회의 처리를 시작합니다." and texts[1].startswith("📝 전사를 마쳤습니다")


async def test_a_nudge_from_the_bot_starts_the_next_pass_without_waiting(tmp_path):
    """봇이 녹음을 저장하면 워커를 찔러 바로 처리하게 한다. 주기(여기서는 1시간)를 기다리지 않는다."""
    worker = _worker(tmp_path)
    W.request_nudge(tmp_path / "recordings")
    t0 = time.monotonic()
    await asyncio.wait_for(worker._nap(), 2)
    assert time.monotonic() - t0 < 1.0


def test_retry_asks_the_running_worker_and_says_whether_it_is_alive(tmp_path):
    """/recover 를 없애고 포기한 회의는 서버에서 python -m capture.worker --retry <서버ID> 로 다시 돌린다.
    --retry 는 떠 있는 워커를 깨우기만 한다. 직접 돌리면 워커와 두 프로세스가 같이 전사해 한 번에 한 회의가 깨진다."""
    rec = tmp_path / "recordings"
    _beat(tmp_path, age_s=2)
    said = W.retry(rec, "77")
    assert (rec / ".worker" / "wake-77").exists() and "워커가 곧" in said
    (rec / ".worker" / "heartbeat.json").unlink()
    assert "워커 신호가 없습니다" in W.retry(rec, "77")
