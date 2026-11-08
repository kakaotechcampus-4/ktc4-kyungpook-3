"""FailoverStt 감싸개와 tick. 바꿀 수 있는 시계, FakeSwitch, 응답을 고르는 전사기로 장애 하나를 처음부터 끝까지 돈다."""

import threading
import time

import numpy as np
import pytest

from stt.backend import Prompted, SttError
from stt.failover import (LIMITS, FailoverStt, Mode, Phase, Route, read_state_file, request, route_of, status_text)
from tests.stt.failover_fakes import PROBE, Clock, FakeBackend, FakeSwitch

LONG = np.zeros(16_000 * 3, dtype=np.float32)
SHORT = np.zeros(16_000, dtype=np.float32)


def make(tmp_path, clock=None, *, mode=Mode.AUTO, on_gpu=None):
    clock = clock or Clock()
    elice, gpu = FakeBackend("elice"), FakeBackend("gpu")
    switch = FakeSwitch(clock)
    notes = []
    fo = FailoverStt(elice, gpu, switch=switch, mode=mode, state_dir=tmp_path, notify=notes.append, on_gpu=on_gpu,
                     clock=clock, probe=(PROBE, 16_000), wait_poll_s=0.005)
    return fo, elice, gpu, switch, clock, notes


def call(fo, samples=LONG, prompt=None):
    try:
        return fo.transcribe(samples, 16_000, prompt=prompt).text
    except SttError as e:
        return e.cause


def fail_elice(fo, elice, n, cause="service"):
    elice.mode = cause
    return [call(fo) for _ in range(n)]


def ticks(fo, clock, seconds, every=10.0, until=None):
    end = clock.t + seconds
    while clock.t < end:
        clock.advance(every)
        fo.tick()
        if until is not None and until():
            return True
    return False


def in_thread(fn):
    out = {}
    t = threading.Thread(target=lambda: out.setdefault("r", fn()), daemon=True)
    t.start()
    return t, out


def to_gpu(fo, elice, switch, clock):
    """장애 하나: 실패 6번 → 확인 3번 실패 → 켜기 → GPU."""
    fail_elice(fo, elice, 6)
    fo.tick()
    assert fo.phase is Phase.SUSPECT
    assert ticks(fo, clock, 600, until=lambda: fo.phase is Phase.ON_GPU)


def test_it_looks_like_the_elice_backend(tmp_path):
    fo, *_ = make(tmp_path)
    assert fo.name == "elice/whisper-large-v3" and fo.accepts_prompt and not fo.gives_word_times
    assert not hasattr(fo, "takes_context")
    backend, model, workers = fo.stt_factory()
    assert (backend, model, workers) == (fo, "elice", 6)


def test_gpu_calls_carry_no_prompt_and_elice_calls_keep_it(tmp_path):
    """이름 프롬프트와 짧은 묶음의 문맥 프롬프트가 둘 다 Prompted 를 지나 감싸개에 온다. GPU 로는 싣지 않는다."""
    fo, elice, gpu, switch, clock, _ = make(tmp_path)
    hinted = Prompted(fo, "동우님, 동우, 김동우.", min_s=1.5)
    hinted.transcribe(LONG, 16_000)
    hinted.transcribe(SHORT, 16_000, context="앞 줄")
    assert elice.prompts == ["동우님, 동우, 김동우.", "앞 줄"]
    to_gpu(fo, elice, switch, clock)
    gpu.prompts.clear()
    hinted.transcribe(LONG, 16_000)
    hinted.transcribe(SHORT, 16_000, context="앞 줄")
    assert gpu.prompts == [None, None]


@pytest.mark.parametrize("cause, counts", [("service", True), ("auth", True), ("request", False), ("config", False)])
def test_only_service_and_auth_failures_are_outage_samples(tmp_path, cause, counts):
    fo, elice, *_ = make(tmp_path)
    fail_elice(fo, elice, 10, cause)
    assert (fo.signals().elice_streak == 10) is counts
    fo.tick()
    assert (fo.phase is Phase.SUSPECT) is counts


def test_five_failures_do_not_hold(tmp_path):
    fo, elice, *_ = make(tmp_path)
    fail_elice(fo, elice, 5)
    fo.tick()
    assert fo.phase is Phase.NORMAL


def test_a_request_error_does_not_break_the_streak_and_a_success_does(tmp_path):
    fo, elice, *_ = make(tmp_path)
    fail_elice(fo, elice, 3)
    fail_elice(fo, elice, 4, "request")
    assert fo.signals().elice_streak == 3
    elice.mode = "ok"
    call(fo)
    fail_elice(fo, elice, 5)
    fo.tick()
    assert fo.phase is Phase.NORMAL


def test_a_probe_success_ends_the_suspicion_without_starting(tmp_path):
    fo, elice, gpu, switch, clock, _ = make(tmp_path)
    fail_elice(fo, elice, 6)
    fo.tick()
    elice.mode = "ok"
    ticks(fo, clock, 300)
    assert fo.phase is Phase.NORMAL and switch.calls == []


def test_an_empty_probe_answer_is_not_a_success(tmp_path):
    fo, elice, gpu, switch, clock, _ = make(tmp_path)
    fail_elice(fo, elice, 6)
    fo.tick()
    elice.mode = "empty"
    assert ticks(fo, clock, 300, until=lambda: fo.phase is Phase.STARTING)


def test_a_held_call_waits_and_goes_to_gpu_once_the_server_answers(tmp_path):
    fo, elice, gpu, switch, clock, notes = make(tmp_path)
    fail_elice(fo, elice, 6)
    fo.tick()
    before = elice.calls
    t, out = in_thread(lambda: call(fo, prompt="동우님."))
    time.sleep(0.05)
    assert t.is_alive() and fo.signals().waiting == 1
    gpu.mode = "service"                                    # 부팅 중에는 GPU 확인이 실패한다
    ticks(fo, clock, 400, until=lambda: switch.state == "running")
    assert fo.phase is Phase.STARTING and t.is_alive()
    gpu.mode = "ok"
    ticks(fo, clock, 60, until=lambda: fo.phase is Phase.ON_GPU)
    t.join(2)
    assert out["r"] == "안녕하세요"
    assert gpu.prompts[-1] is None
    assert elice.calls - before == 3                     # 확인 호출 3번만 Elice 로 갔다
    assert any("GPU 서버로 전사를 넘겼습니다" in n.text for n in notes)


def test_the_hold_gives_up_after_thirty_minutes_and_the_call_fails_as_before(tmp_path):
    fo, elice, gpu, switch, clock, _ = make(tmp_path)
    switch.refuse = "capacity"
    fail_elice(fo, elice, 6)
    fo.tick()
    t, out = in_thread(lambda: call(fo))
    ticks(fo, clock, LIMITS.hold_s - 60)
    time.sleep(0.05)
    assert t.is_alive() and fo.phase is Phase.STARTING
    ticks(fo, clock, 120)
    t.join(2)
    assert out["r"] == "service"


def test_elice_coming_back_moves_calls_back_then_turns_off_and_parks(tmp_path):
    fo, elice, gpu, switch, clock, notes = make(tmp_path)
    to_gpu(fo, elice, switch, clock)
    elice.mode = "ok"
    for _ in range(40):                                # GPU 일이 이어져 일 없음 끄기가 먼저 오지 않는다
        call(fo)
        if ticks(fo, clock, 60, until=lambda: fo.phase is Phase.STOPPING):
            break
    assert fo.phase is Phase.STOPPING and fo.state.why == "elice_back"
    assert route_of(fo.state, clock()) is Route.ELICE
    assert ticks(fo, clock, 600, until=lambda: fo.phase is Phase.PARKED)
    assert switch.state == "off"
    assert any("껐습니다(Elice 복귀)" in n.text for n in notes)
    call(fo)
    fo.tick()
    assert fo.phase is Phase.NORMAL


def test_two_good_probes_then_a_bad_one_stay_on_gpu(tmp_path):
    fo, elice, gpu, switch, clock, _ = make(tmp_path)
    to_gpu(fo, elice, switch, clock)
    elice.mode = "ok"
    for _ in range(10):
        call(fo)                                       # GPU 로 가서 일 없음 끄기를 막는다
        ticks(fo, clock, 60)
    assert fo.state.elice_ok == 2
    elice.mode = "service"
    for _ in range(15):
        call(fo)
        ticks(fo, clock, 60)
    assert fo.phase is Phase.ON_GPU and fo.state.elice_ok == 0


def test_the_turn_off_waits_for_gpu_calls_in_flight(tmp_path):
    fo, elice, gpu, switch, clock, _ = make(tmp_path)
    to_gpu(fo, elice, switch, clock)
    gpu.gate = threading.Event()
    t, out = in_thread(lambda: call(fo))
    time.sleep(0.05)
    request(tmp_path, "off")
    ticks(fo, clock, 60)
    assert fo.phase is Phase.STOPPING and "off" not in switch.calls
    gpu.gate.set()
    t.join(2)
    ticks(fo, clock, 20)
    assert "off" in switch.calls


def test_parked_restarts_after_three_real_failures(tmp_path):
    fo, elice, gpu, switch, clock, _ = make(tmp_path)
    to_gpu(fo, elice, switch, clock)
    elice.mode = "ok"
    for _ in range(40):
        call(fo)
        if ticks(fo, clock, 60, until=lambda: fo.phase is Phase.PARKED):
            break
    assert fo.phase is Phase.PARKED
    fail_elice(fo, elice, 3)
    fo.tick()
    assert (fo.phase, fo.state.why) == (Phase.STARTING, "elice_down")


def test_no_gpu_work_for_ten_minutes_turns_it_off(tmp_path):
    fo, elice, gpu, switch, clock, notes = make(tmp_path)
    to_gpu(fo, elice, switch, clock)
    assert ticks(fo, clock, LIMITS.idle_s + 30, until=lambda: fo.phase is Phase.STOPPING)
    assert fo.state.why == "idle"
    assert ticks(fo, clock, 600, until=lambda: fo.phase is Phase.PARKED)
    text = next(n.text for n in notes if "껐습니다(일 없음)" in n.text)
    assert "오늘 켠 횟수 1/6" in text and "GPU 가동분만, 꺼지는 시간 포함, 고정비 제외" in text


def test_a_call_during_the_idle_turn_off_waits_and_the_server_comes_back(tmp_path):
    fo, elice, gpu, switch, clock, _ = make(tmp_path)
    to_gpu(fo, elice, switch, clock)
    ticks(fo, clock, LIMITS.idle_s + 30, until=lambda: fo.phase is Phase.STOPPING)
    t, out = in_thread(lambda: call(fo))
    time.sleep(0.05)
    assert t.is_alive()
    assert ticks(fo, clock, 1200, until=lambda: fo.phase is Phase.ON_GPU)
    t.join(2)
    assert out["r"] == "안녕하세요" and switch.starts == 2


def test_near_the_three_hour_end_with_work_it_turns_off_and_on_again(tmp_path):
    fo, elice, gpu, switch, clock, _ = make(tmp_path)
    to_gpu(fo, elice, switch, clock)
    first = switch.launched_at
    while switch.stop_at - clock() > LIMITS.rollover_s + 60:
        call(fo)                                       # 일이 계속 있다
        ticks(fo, clock, 60)
        assert fo.phase is Phase.ON_GPU
    call(fo)
    assert ticks(fo, clock, 120, until=lambda: fo.phase is Phase.STARTING)
    assert fo.state.why == "rollover" and route_of(fo.state, clock()) is Route.HOLD
    assert ticks(fo, clock, 1200, until=lambda: fo.phase is Phase.ON_GPU)
    assert switch.launched_at != first and switch.calls.count("off") >= 1


def test_near_the_three_hour_end_without_work_it_only_turns_off(tmp_path):
    fo, elice, gpu, switch, clock, _ = make(tmp_path)
    fo._limits = LIMITS.__class__(idle_s=4 * 3600)     # 일 없음 끄기가 먼저 오지 않게 한다
    to_gpu(fo, elice, switch, clock)
    clock.advance(switch.stop_at - clock() - LIMITS.rollover_s - 5)
    assert ticks(fo, clock, 60, until=lambda: fo.phase is Phase.STOPPING)
    assert fo.state.why == "idle"


@pytest.mark.parametrize("refusal", ["limit", "capacity"])
def test_a_refused_start_retries_every_five_minutes_and_says_so_once(tmp_path, refusal):
    fo, elice, gpu, switch, clock, notes = make(tmp_path)
    switch.refuse = refusal
    fail_elice(fo, elice, 6)
    fo.tick()
    ticks(fo, clock, 200, until=lambda: fo.phase is Phase.STARTING)
    n0 = len(switch.calls)
    ticks(fo, clock, 900)
    assert len(switch.calls) - n0 in (3, 4)
    assert sum("켜지 못했습니다" in n.text for n in notes) == 1
    switch.refuse = None
    assert ticks(fo, clock, 900, until=lambda: fo.phase is Phase.ON_GPU)


def test_a_server_without_ready_halts(tmp_path):
    fo, elice, gpu, switch, clock, notes = make(tmp_path)
    switch.refuse = "not_ready"
    fail_elice(fo, elice, 6)
    fo.tick()
    assert ticks(fo, clock, 300, until=lambda: fo.phase is Phase.HALTED)
    assert fo.state.why == "start_failed" and any(n.alert for n in notes)


def test_a_server_that_never_answers_is_rebooted_once_then_halted(tmp_path):
    fo, elice, gpu, switch, clock, notes = make(tmp_path)
    gpu.mode = "service"
    fail_elice(fo, elice, 6)
    fo.tick()
    assert ticks(fo, clock, 3600, until=lambda: fo.phase is Phase.HALTED)
    assert fo.state.why == "boot" and switch.starts == 2 and switch.state in ("stopping", "off")


def test_an_unreachable_switch_keeps_trying(tmp_path):
    fo, elice, gpu, switch, clock, notes = make(tmp_path)
    switch.down = True
    fail_elice(fo, elice, 6)
    fo.tick()
    ticks(fo, clock, 600)
    assert fo.phase is Phase.STARTING
    switch.down = False
    assert ticks(fo, clock, 600, until=lambda: fo.phase is Phase.ON_GPU)


def test_the_daily_on_count_cap_halts_until_the_kst_day_changes(tmp_path):
    fo, elice, gpu, switch, clock, notes = make(tmp_path)
    for _ in range(LIMITS.day_ons):
        request(tmp_path, "on")
        assert ticks(fo, clock, 600, until=lambda: fo.phase is Phase.ON_GPU)
        request(tmp_path, "off")
        assert ticks(fo, clock, 900, until=lambda: fo.phase is Phase.NORMAL)
    request(tmp_path, "on")
    fo.tick()
    assert (fo.phase, fo.state.why) == (Phase.HALTED, "day_cap")
    assert switch.starts == LIMITS.day_ons
    clock.advance(86400)
    fo.tick()
    assert fo.phase is Phase.PARKED


def test_the_daily_time_cap_turns_the_server_off(tmp_path):
    fo, elice, gpu, switch, clock, notes = make(tmp_path)
    fo._limits = LIMITS.__class__(day_on_s=1800, idle_s=4 * 3600)
    elice.mode = "service"
    request(tmp_path, "on")
    ticks(fo, clock, 600, until=lambda: fo.phase is Phase.ON_GPU)
    assert ticks(fo, clock, 2400, until=lambda: fo.phase is Phase.HALTED)
    assert fo.state.why == "day_cap" and switch.state == "off"


def test_the_lambda_running_total_cap_halts(tmp_path):
    fo, elice, gpu, switch, clock, notes = make(tmp_path)
    switch.used_s = switch.cap_min * 60
    request(tmp_path, "on")
    assert ticks(fo, clock, 120, until=lambda: fo.phase is Phase.HALTED)
    assert fo.state.why == "spent" and any(n.alert and "누적 상한" in n.text for n in notes)


def test_manual_mode_holds_briefly_says_it_would_start_and_does_not(tmp_path):
    fo, elice, gpu, switch, clock, notes = make(tmp_path, mode=Mode.MANUAL)
    fail_elice(fo, elice, 6)
    fo.tick()
    ticks(fo, clock, 600)
    fail_elice(fo, elice, 20)
    ticks(fo, clock, 600)
    assert fo.phase is Phase.NORMAL and switch.calls == []
    assert sum("자동 모드였으면" in n.text for n in notes) == 1


def test_a_manual_on_request_starts_and_a_manual_off_pauses_auto_start(tmp_path):
    fo, elice, gpu, switch, clock, notes = make(tmp_path)
    request(tmp_path, "on")
    assert ticks(fo, clock, 600, until=lambda: fo.phase is Phase.ON_GPU)
    request(tmp_path, "off")
    assert ticks(fo, clock, 900, until=lambda: fo.phase is Phase.NORMAL)
    assert switch.state == "off"
    fail_elice(fo, elice, 12)
    ticks(fo, clock, 300)
    assert fo.phase is Phase.NORMAL
    clock.advance(LIMITS.pause_s)
    fail_elice(fo, elice, 6)
    fo.tick()
    assert fo.phase is Phase.SUSPECT


def test_a_manual_off_while_retrying_a_refused_start_does_not_start_later(tmp_path):
    fo, elice, gpu, switch, clock, _ = make(tmp_path)
    switch.refuse = "limit"
    request(tmp_path, "on")
    ticks(fo, clock, 60)
    request(tmp_path, "off")
    switch.refuse = None
    ticks(fo, clock, 900)
    assert fo.phase is Phase.NORMAL and switch.starts == 0


def test_an_on_request_during_turn_off_waits_for_the_off(tmp_path):
    fo, elice, gpu, switch, clock, _ = make(tmp_path)
    request(tmp_path, "on")
    ticks(fo, clock, 600, until=lambda: fo.phase is Phase.ON_GPU)
    ticks(fo, clock, LIMITS.idle_s + 30, until=lambda: fo.phase is Phase.STOPPING)
    request(tmp_path, "on")
    assert ticks(fo, clock, 1800, until=lambda: fo.phase is Phase.ON_GPU)
    assert switch.starts == 2


def test_the_state_file_is_written_by_tick_and_a_restarted_worker_carries_on(tmp_path):
    fo, elice, gpu, switch, clock, _ = make(tmp_path)
    fail_elice(fo, elice, 6)
    assert not (tmp_path / "gpu-failover.json").exists()      # 전사 스레드는 쓰지 않는다
    fo.tick()
    ticks(fo, clock, 200, until=lambda: fo.phase is Phase.STARTING)
    ticks(fo, clock, 20)
    saved = read_state_file(tmp_path)
    assert saved["phase"] == "starting" and saved["mode"] == "auto"

    again = FailoverStt(elice, gpu, switch=switch, mode=Mode.AUTO, state_dir=tmp_path, notify=lambda n: None,
                        clock=clock, probe=(PROBE, 16_000), wait_poll_s=0.005)
    assert again.phase is Phase.STARTING and route_of(again.state, clock()) is Route.HOLD
    assert ticks(again, clock, 600, until=lambda: again.phase is Phase.ON_GPU)
    assert switch.starts == 1 and again.state.day_ons == 1

    third = FailoverStt(elice, gpu, switch=switch, mode=Mode.AUTO, state_dir=tmp_path, notify=lambda n: None,
                        clock=clock, probe=(PROBE, 16_000), wait_poll_s=0.005)
    third.tick()
    assert third.phase is Phase.ON_GPU                         # 다시 뜨자마자 일 없음으로 끄지 않는다


def test_a_broken_state_file_starts_normal(tmp_path, capsys):
    (tmp_path / "gpu-failover.json").write_text("{not json")
    fo, *_ = make(tmp_path)
    assert fo.phase is Phase.NORMAL
    assert "[failover]" in capsys.readouterr().out


def test_six_threads_counting_together_lose_nothing(tmp_path):
    fo, elice, *_ = make(tmp_path)
    elice.mode = "service"
    threads = [threading.Thread(target=lambda: [call(fo) for _ in range(200)]) for _ in range(6)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    s = fo.signals()
    assert (s.elice_fails, s.elice_streak) == (1200, 1200)


def test_entering_gpu_calls_the_wake_hook_with_the_outage_start(tmp_path):
    seen = []
    fo, elice, gpu, switch, clock, _ = make(tmp_path, on_gpu=seen.append)
    t0 = clock()
    to_gpu(fo, elice, switch, clock)
    assert seen == [t0]


def test_status_text_shows_phase_counts_and_running_cost(tmp_path):
    fo, elice, gpu, switch, clock, _ = make(tmp_path)
    switch.used_s = 126 * 60
    request(tmp_path, "on")
    ticks(fo, clock, 600, until=lambda: fo.phase is Phase.ON_GPU)
    text = status_text(tmp_path, now=clock())
    assert "단계 on_gpu" in text and "auto" in text
    assert "오늘 켠 횟수 1/6" in text
    assert "누적 2.1/15시간 $1.36(₩1,902)" in text


def test_status_text_without_a_state_file(tmp_path):
    assert "상태가 없습니다" in status_text(tmp_path, now=0)


def test_a_request_is_written_whole(tmp_path):
    request(tmp_path, "on")
    assert (tmp_path / "gpu-request").read_text() == "on"
    assert not list(tmp_path.glob("*.tmp"))
    with pytest.raises(ValueError):
        request(tmp_path, "reboot")


def test_a_tick_that_breaks_is_logged_and_the_route_stays(tmp_path, capsys):
    fo, elice, gpu, switch, clock, _ = make(tmp_path)
    request(tmp_path, "on")
    fo.tick()
    request(tmp_path, "off")
    switch.call = lambda action: 1 / 0
    fo.tick()
    assert "[failover] tick 실패" in capsys.readouterr().out
    assert fo.phase is Phase.STARTING
    assert (tmp_path / "gpu-request").read_text() == "off"       # 처리하지 못한 요청은 남는다


def test_the_probe_is_a_short_generated_mono_clip():
    from stt.failover import _probe_audio

    samples, sr = _probe_audio()
    assert sr == 16_000 and samples.ndim == 1 and 1.0 <= len(samples) / sr <= 3.0
    assert float(abs(samples).max()) > 0.05


def test_a_request_written_while_a_tick_runs_is_not_lost(tmp_path):
    """tick 은 요청을 읽고 확인 호출(최대 30초씩)을 한 뒤에 지운다. 그 사이에 온 요청을 지우면 안 된다."""
    fo, elice, gpu, switch, clock, _ = make(tmp_path)
    to_gpu(fo, elice, switch, clock)
    request(tmp_path, "on")                            # ON_GPU 에서는 할 일이 없는 요청
    clock.advance(LIMITS.gpu_probe_gap_s)
    gpu.on_call = lambda: request(tmp_path, "off")
    fo.tick()
    gpu.on_call = None
    assert (tmp_path / "gpu-request").read_text() == "off"
    fo.tick()
    assert (fo.phase, fo.state.why) == (Phase.STOPPING, "manual")
