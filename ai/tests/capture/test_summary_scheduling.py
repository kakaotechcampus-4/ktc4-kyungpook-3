import asyncio
import threading

from capture.handoff import BeClient
from capture.summary_sweep import SummaryRunner
from capture.worker import Worker
from llm import FakeLLM
from tests.capture.fake_be import FakeBe


async def test_blocked_summary_does_not_prevent_the_next_worker_pass(tmp_path, monkeypatch):
    entered = threading.Event()
    release = threading.Event()
    next_pass = asyncio.Event()
    draining_heartbeat = asyncio.Event()
    fake = FakeBe()
    fake.add_summary("m1")

    class BlockedLLM(FakeLLM):
        def generate_json_once(self, prompt, *, timeout_s, reasoning_effort="medium"):
            entered.set()
            assert release.wait(20)
            return super().generate_json_once(prompt, timeout_s=timeout_s, reasoning_effort=reasoning_effort)

    runner = SummaryRunner(BeClient("http://be", session=fake, service_token="svc-token"),
                           BlockedLLM([{"overview": "summary", "key_points": []}]))
    worker = Worker(tmp_path / "recordings", transcripts_dir=tmp_path / "transcripts", summary_factory=lambda: runner,
                    handoff_factory=lambda: None, intake_factory=lambda: None, notifier=object(), debug=False,
                    interval_s=0.01, poll_s=0.001)
    passes = 0

    async def run_pass(**kwargs):
        nonlocal passes
        passes += 1
        if passes > 1:
            next_pass.set()
        return [], []

    monkeypatch.setattr(worker, "run_pass", run_pass)
    original_beat = worker._beat

    def beat(state="running"):
        original_beat(state)
        if worker._stopping and state == "running":
            draining_heartbeat.set()

    monkeypatch.setattr(worker, "_beat", beat)
    running = asyncio.create_task(worker.run())
    try:
        assert await asyncio.to_thread(entered.wait, 2)
        await asyncio.wait_for(next_pass.wait(), 5)
        assert not release.is_set()
        assert len([call for call in fake.calls if call[1] == "/summaries/claim"]) == 1
        worker.stop()
        await asyncio.wait_for(draining_heartbeat.wait(), 5)
        assert not running.done()
    finally:
        worker.stop()
        release.set()
        await asyncio.wait_for(running, 3)
    assert fake.summaries["m1"]["saved"]["overview"] == "summary"
