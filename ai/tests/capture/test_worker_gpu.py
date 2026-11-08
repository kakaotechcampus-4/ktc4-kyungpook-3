"""워커의 GPU 전환 연결(#530). 가짜 전사 서버 두 대(HTTPS, 자체 서명)와 FakeSwitch, 바꿀 수 있는 시계로 회의를 끝까지 돌린다.
실제 Elice, AWS, 디스코드는 부르지 않는다."""

import asyncio
import json
from datetime import datetime, timedelta, timezone

import pytest

from capture import recorder as R
from capture import worker as W
from stt import batch as B
from stt.elice import EliceStt, SttEndpoint
from stt.failover import FailoverStt, Mode, Notice, Phase, read_state_file
from tests.capture.test_recorder import _session
from tests.stt.failover_fakes import PROBE, Clock, FakeSwitch
from tests.stt.fake_servers import FakeStt, cert_pair

GPU_ENV = {"MM_GPU_FAILOVER": "auto", "MM_STT_BACKEND": "elice", "ELICE_STT_BASE_URL": "https://elice.example/x",
           "GPU_STT_BASE_URL": "https://gpu.example", "GPU_STT_API_KEY": "g", "GPU_SWITCH_URL": "https://switch.example",
           "GPU_SWITCH_TOKEN": "s"}


@pytest.fixture
def servers(tmp_path):
    cert, key = cert_pair(tmp_path)
    elice, gpu = FakeStt(cert, key), FakeStt(cert, key, text="지피유")
    yield elice, gpu, cert
    elice.close()
    gpu.close()


@pytest.fixture(autouse=True)
def _quick_retries(monkeypatch):
    monkeypatch.setattr(B, "RETRY_WAIT_S", 0.0)


def _failover(tmp_path, servers, clock, *, mode=Mode.AUTO, notes=None):
    elice_srv, gpu_srv, cert = servers
    elice = EliceStt(endpoint=SttEndpoint(elice_srv.url, "e", str(cert)), timeout=5)
    gpu = EliceStt(endpoint=SttEndpoint(gpu_srv.url, "g", str(cert)), timeout=5)
    switch = FakeSwitch(clock)
    fo = FailoverStt(elice, gpu, switch=switch, mode=mode, state_dir=tmp_path / "recordings" / ".worker",
                     notify=(notes if notes is not None else []).append, clock=clock, probe=(PROBE, 16_000),
                     wait_poll_s=0.01)
    return fo, switch


def _worker(tmp_path, fo):
    return W.Worker(tmp_path / "recordings", transcripts_dir=tmp_path / "transcripts", failover=fo,
                    gate_factory=lambda: None, extractor_factory=lambda: None, handoff_factory=lambda: None,
                    intake_factory=lambda: None, interval_s=3600.0, debug=False, notifier=_Box())


class _Box:
    def __init__(self):
        self.sent = []

    def send(self, channel_id, text, file=None):
        self.sent.append((channel_id, text))
        return True


async def _drive(fo, clock, task, *, every=10.0, limit=2000):
    """회의 바퀴가 도는 동안 컨트롤러를 시계와 함께 돌린다."""
    for _ in range(limit):
        if task.done():
            break
        clock.advance(every)
        await asyncio.to_thread(fo.tick)
        await asyncio.sleep(0.01)
    return await task


def _manifest(path):
    return json.loads(path.read_text(encoding="utf-8"))


def _lines(tmp_path, m):
    return [json.loads(x) for x in (tmp_path / "recordings" / m["meeting_dir"] / "transcript.jsonl")
            .read_text(encoding="utf-8").splitlines() if x.strip()]


def test_without_the_flag_the_worker_is_what_it_was(tmp_path, monkeypatch):
    for k, v in GPU_ENV.items():
        monkeypatch.setenv(k, v)
    for off in (None, "off", ""):
        if off is None:
            monkeypatch.delenv("MM_GPU_FAILOVER")
        else:
            monkeypatch.setenv("MM_GPU_FAILOVER", off)
        worker = W.Worker(tmp_path / "recordings", transcripts_dir=tmp_path / "transcripts",
                          extractor_factory=lambda: None, handoff_factory=lambda: None, debug=False)
        assert worker._failover is None and worker._stt_factory is R.backend_from_env
        worker._beat()
        assert "failover" not in W.read_heartbeat(tmp_path / "recordings")


def test_an_injected_stt_factory_never_builds_failover_from_the_environment(tmp_path, monkeypatch):
    for k, v in GPU_ENV.items():
        monkeypatch.setenv(k, v)
    worker = W.Worker(tmp_path / "recordings", stt_factory=lambda: (None, "echo", 1), extractor_factory=lambda: None,
                      handoff_factory=lambda: None, debug=False)
    assert worker._failover is None


@pytest.mark.parametrize("change, missing", [
    ({"MM_GPU_FAILOVER": "sometimes"}, "MM_GPU_FAILOVER"),
    ({"MM_STT_BACKEND": "local"}, "MM_STT_BACKEND"),
    ({"GPU_STT_API_KEY": ""}, "GPU_STT_API_KEY"),
    ({"GPU_SWITCH_TOKEN": ""}, "GPU_SWITCH_TOKEN"),
    ({"GPU_STT_BASE_URL": "https://elice.example/x/"}, "GPU_STT_BASE_URL"),
    ({"GPU_STT_BASE_URL": "http://gpu.example"}, "GPU_STT_BASE_URL"),
    ({"GPU_SWITCH_URL": "http://switch.example"}, "GPU_SWITCH_URL"),
    ({"GPU_STT_CA_BUNDLE": "/no/such/gpu-ca.pem"}, "GPU_STT_CA_BUNDLE"),
])
def test_a_bad_setting_turns_failover_off_and_names_only_the_setting(tmp_path, monkeypatch, capsys, change, missing):
    for k, v in {**GPU_ENV, **change}.items():
        monkeypatch.setenv(k, v)
    assert W.failover_from_env(tmp_path, notifier=_Box()) is None
    out = capsys.readouterr().out
    assert missing in out and "https://gpu.example" not in out


@pytest.mark.parametrize("mode", ["manual", "auto", "AUTO "])
def test_the_flag_builds_failover_with_explicit_gpu_settings(tmp_path, monkeypatch, mode):
    ca = tmp_path / "gpu-ca.pem"
    ca.write_text("x")
    for k, v in {**GPU_ENV, "MM_GPU_FAILOVER": mode, "GPU_STT_CA_BUNDLE": str(ca)}.items():
        monkeypatch.setenv(k, v)
    fo = W.failover_from_env(tmp_path, notifier=_Box())
    assert fo.mode is Mode(mode.strip().lower())
    assert fo._gpu.endpoint == SttEndpoint("https://gpu.example", "g", str(ca))
    assert fo._elice.endpoint is None                    # Elice 는 지금처럼 환경 변수를 읽는다
    assert fo.state_dir == tmp_path / ".worker"


async def test_a_meeting_during_the_switch_waits_for_the_gpu_and_is_not_counted_as_a_failure(tmp_path, servers):
    elice_srv, gpu_srv, _ = servers
    rec, path, _ = _session(tmp_path)
    m = _manifest(path)
    m["hint_names"] = ["김민수", "이서연"]
    R.save_manifest(path, m)
    clock = Clock()
    fo, switch = _failover(tmp_path, servers, clock)
    elice_srv.mode = "503"
    for _ in range(6):
        with pytest.raises(Exception):
            fo.transcribe(PROBE, 16_000)
    fo.tick()
    assert fo.phase is Phase.SUSPECT
    worker = _worker(tmp_path, fo)
    elice_before = elice_srv.calls
    results, _ = await _drive(fo, clock, asyncio.create_task(worker.run_pass()))
    m = _manifest(path)
    assert fo.phase is Phase.ON_GPU
    assert "recovery" not in m and m.get("retry_runs", 0) == 0
    assert R.STATUS_TRANSCRIBED in m["stages"] and not m.get("failed_units")
    assert all(ln["text"] == "지피유" for ln in _lines(tmp_path, m))
    assert gpu_srv.forms() and all("prompt" not in f for f in gpu_srv.forms())
    assert elice_srv.calls - elice_before == 3          # 확인 호출만 Elice 로 갔다


async def test_the_switch_in_the_middle_of_a_meeting_and_the_retry_path(tmp_path, servers):
    """앞 호출은 Elice(이름 있음), 실패한 구간의 재전사는 GPU(이름 없음). 회의록은 하나로 끝난다."""
    elice_srv, gpu_srv, _ = servers
    rec, path, _ = _session(tmp_path)
    m = _manifest(path)
    m["hint_names"] = ["김민수", "이서연"]
    R.save_manifest(path, m)
    clock = Clock()
    fo, switch = _failover(tmp_path, servers, clock)
    worker = _worker(tmp_path, fo)
    elice_srv.script, elice_srv.mode = ["ok"], "503"
    await worker.run_pass()
    m = _manifest(path)
    assert m["status"] == R.STATUS_PARTIAL and m["recovery"]["attempts"] == 1
    for _ in range(6):
        with pytest.raises(Exception):
            fo.transcribe(PROBE, 16_000)
    fo.tick()
    assert fo.phase is Phase.SUSPECT
    for _ in range(100):
        clock.advance(10)
        fo.tick()
        if fo.phase is Phase.ON_GPU:
            break
    assert fo.phase is Phase.ON_GPU
    await worker.run_pass(guild_id="77", manual=True)
    m = _manifest(path)
    assert R.STATUS_TRANSCRIBED in m["stages"] and not m.get("failed_units") and m["retry_runs"] == 1
    elice_prompts = [f.get("prompt") for f in elice_srv.forms()]
    assert elice_prompts[0] and "민수" in elice_prompts[0][0]
    assert gpu_srv.forms() and all("prompt" not in f for f in gpu_srv.forms())
    texts = [ln["text"] for ln in _lines(tmp_path, m)]
    assert texts.count("안녕하세요") == 1 and set(texts) == {"안녕하세요", "지피유"}


def _gave_up(tmp_path, ts, guild, *, at, stage="stt", source=None):
    _, path, _ = _session(tmp_path, ts=ts, guild=guild)
    m = _manifest(path)
    m.update(status=R.STATUS_FAILED, failed_stage=stage, guild="서버" + guild,
             recovery={"attempts": 5, "gave_up_at": at.isoformat(), "failed_stage": stage})
    if source:
        m["source"] = source
    R.save_manifest(path, m)


def test_entering_gpu_wakes_servers_whose_meetings_gave_up_during_this_outage_only(tmp_path):
    since = datetime(2026, 11, 8, 3, 0, tzinfo=timezone.utc)
    _gave_up(tmp_path, 1, "10", at=since + timedelta(minutes=20))                 # 이번 장애, 전사
    _gave_up(tmp_path, 2, "20", at=since + timedelta(minutes=20))                 # 이번 장애지만
    _gave_up(tmp_path, 3, "20", at=since - timedelta(days=2), stage="extract")    # 장애 전에 포기한 회의가 있다
    _gave_up(tmp_path, 4, "30", at=since + timedelta(minutes=20), stage="extract")   # 전사 단계가 아니다
    _gave_up(tmp_path, 5, "40", at=since - timedelta(hours=1))                    # 장애 전
    notes = []
    W.wake_abandoned(tmp_path / "recordings", since.timestamp(), notes.append)
    wakes = sorted(p.name for p in (tmp_path / "recordings" / ".worker").glob("wake-*"))
    assert wakes == ["wake-10"]
    text = "\n".join(n.text for n in notes)
    assert "서버10" in text and "서버20" in text and "--retry 20" in text
    assert not any(n.alert for n in notes)              # 멘션은 켜기 시작, 켜기 실패, 상한에만 붙인다


def test_nothing_to_wake_says_nothing(tmp_path):
    notes = []
    W.wake_abandoned(tmp_path / "recordings", 0.0, notes.append)
    assert notes == []


@pytest.mark.parametrize("alert, expected", [(True, "@everyone ⛔ 상한"), (False, "⛔ 상한")])
def test_ops_notices_go_to_the_ops_channel_and_only_alerts_ring_everyone(monkeypatch, alert, expected):
    monkeypatch.setenv("MM_OPS_CHANNEL_ID", "4242")
    box = _Box()
    W.ops_notifier(box)(Notice("⛔ 상한", alert=alert))
    assert box.sent == [("4242", expected)]


def test_without_an_ops_channel_notices_stay_in_the_log(monkeypatch):
    monkeypatch.delenv("MM_OPS_CHANNEL_ID", raising=False)
    box = _Box()
    W.ops_notifier(box)(Notice("x", alert=True))
    assert box.sent == []


async def test_the_worker_runs_the_controller_and_shows_it_in_the_heartbeat(tmp_path):
    ticks = []

    class Stub:
        mode = Mode.AUTO
        phase = Phase.NORMAL

        def tick(self):
            ticks.append(1)

        def stt_factory(self):
            return None, "elice", 6

    worker = W.Worker(tmp_path / "recordings", transcripts_dir=tmp_path / "transcripts", failover=Stub(),
                      gate_factory=lambda: None, extractor_factory=lambda: None, handoff_factory=lambda: None,
                      intake_factory=lambda: None, interval_s=0.05, poll_s=0.01, debug=False, notifier=_Box())
    task = asyncio.create_task(worker.run())
    await asyncio.sleep(0.3)
    hb = W.read_heartbeat(tmp_path / "recordings")
    worker.stop()
    await task
    assert len(ticks) >= 2
    assert hb["failover"] == "auto:normal"


def _heartbeat(rec, **kw):
    R.save_manifest(rec / ".worker" / "heartbeat.json",
                    {"state": "running", "at_ts": __import__("time").time(), "interval_s": 10, **kw})


def test_gpu_on_and_off_leave_a_request_for_the_running_worker(tmp_path, capsys):
    rec = tmp_path / "recordings"
    _heartbeat(rec, failover="manual:normal")
    assert W.main(["--recordings", str(rec), "--gpu", "on"]) == 0
    assert (rec / ".worker" / "gpu-request").read_text() == "on"
    assert "요청" in capsys.readouterr().out
    W.main(["--recordings", str(rec), "--gpu", "off"])
    assert (rec / ".worker" / "gpu-request").read_text() == "off"


def test_gpu_status_reads_the_state_file(tmp_path, servers):
    clock = Clock()
    fo, switch = _failover(tmp_path, servers, clock)
    fo.tick()
    from stt.failover import request
    request(tmp_path / "recordings" / ".worker", "on")
    fo.tick()
    assert read_state_file(tmp_path / "recordings" / ".worker")["phase"] == "starting"
    text = W.gpu(tmp_path / "recordings", "status")
    assert "단계 starting" in text


def test_gpu_says_when_the_running_worker_has_failover_off(tmp_path):
    rec = tmp_path / "recordings"
    _heartbeat(rec)
    assert "MM_GPU_FAILOVER" in W.gpu(rec, "on")
    assert "MM_GPU_FAILOVER" in W.gpu(rec, "status")


@pytest.mark.parametrize("beat", [{}, None], ids=["failover off", "no worker"])
@pytest.mark.parametrize("verb", ["on", "off"])
def test_gpu_leaves_no_request_without_a_failover_worker(tmp_path, beat, verb):
    """남은 요청은 며칠 뒤 전환을 켠 워커가 읽는다. 받을 워커가 없으면 쓰지 않는다."""
    rec = tmp_path / "recordings"
    if beat is not None:
        _heartbeat(rec, **beat)
    text = W.gpu(rec, verb)
    assert "남기지 않았습니다" in text and "MM_GPU_FAILOVER" in text
    assert not (rec / ".worker" / "gpu-request").exists()


def test_gpu_leaves_a_request_for_a_stopped_failover_worker(tmp_path):
    rec = tmp_path / "recordings"
    _heartbeat(rec, state="stopped", failover="auto:normal")
    assert "요청을 남겼습니다" in W.gpu(rec, "on")
    assert (rec / ".worker" / "gpu-request").read_text() == "on"
