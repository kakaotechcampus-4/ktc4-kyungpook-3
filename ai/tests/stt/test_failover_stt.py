"""FailoverStt 감싸개와 tick. 바꿀 수 있는 시계, FakeSwitch, 응답을 고르는 전사기로 장애 하나를 처음부터 끝까지 돈다."""

import os
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


def test_status_shows_the_mode_after_the_first_quiet_tick(tmp_path):
    fo, *_ , clock, _ = make(tmp_path, mode=Mode.MANUAL)
    fo.tick()
    assert fo.phase is Phase.NORMAL
    assert "돈 적이 없습니다" not in status_text(tmp_path, clock())
    assert read_state_file(tmp_path) is not None


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


class ShortOnlyElice(FakeBackend):
    """확인 합성음에는 답하고 실제 묶음에는 늘 실패하는 Elice."""

    def transcribe(self, samples, sample_rate, prompt=None):
        if samples is PROBE:
            return super().transcribe(samples, sample_rate, prompt)
        raise SttError("STT service", cause="service")


@pytest.mark.parametrize("mode", [Mode.AUTO, Mode.MANUAL])
def test_elice_that_answers_only_the_probe_is_suspected_once_then_started(tmp_path, mode):
    fo, _, gpu, switch, clock, notes = make(tmp_path, mode=mode)
    fo._elice = ShortOnlyElice("elice")
    for _ in range(LIMITS.suspect_fails):
        call(fo)
    ticks(fo, clock, 120)
    assert fo.phase is Phase.NORMAL and fo.state.outage_since is not None
    for _ in range(3 if mode is Mode.MANUAL else 1):
        for _ in range(LIMITS.suspect_fails):
            call(fo)
        ticks(fo, clock, 600, until=lambda: fo.phase is Phase.ON_GPU)
    assert sum(n.text.startswith("⏳") for n in notes) == 1
    if mode is Mode.AUTO:
        assert fo.phase is Phase.ON_GPU and switch.starts == 1
    else:
        assert fo.phase is Phase.NORMAL and switch.calls == []
        assert sum("자동 모드였으면" in n.text for n in notes) == 1


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


def test_three_failed_gpu_calls_then_a_good_check_go_back_to_gpu_only_on_a_rebooted_server(tmp_path):
    """확인 호출 성공은 실제 호출의 연속 실패를 지우지 않는다. 같은 서버로는 돌아가지 않고 다시 켠 서버로 넘긴 뒤 일 없음으로 끈다."""
    fo, elice, gpu, switch, clock, notes = make(tmp_path)
    to_gpu(fo, elice, switch, clock)
    first = switch.launched_at
    gpu.mode = "service"
    assert [call(fo) for _ in range(3)] == ["service"] * 3
    gpu.mode = "ok"
    n0, launches = len(notes), []
    assert ticks(fo, clock, 3600, until=lambda: fo.phase is Phase.ON_GPU and not launches.append(switch.launched_at))
    assert launches[0] != first
    assert ticks(fo, clock, 3600, until=lambda: fo.phase is Phase.PARKED)
    assert switch.starts == 2 and switch.state == "off"
    assert len(notes) - n0 == 3                           # 응답 없음, 다시 넘김, 끔


def test_a_gpu_that_passes_checks_but_fails_every_real_call_reboots_once_then_halts(tmp_path):
    """확인 호출은 되고 실제 호출만 503 인 서버. tick 마다 넘김과 응답 없음을 오가며 알리지 않는다."""
    fo, elice, gpu, switch, clock, notes = make(tmp_path)
    to_gpu(fo, elice, switch, clock)
    n0 = len(notes)
    for _ in range(360):
        if fo.phase is Phase.ON_GPU:
            gpu.mode = "service"
            assert [call(fo) for _ in range(3)] == ["service"] * 3
            gpu.mode = "ok"
        clock.advance(10)
        fo.tick()
    assert (fo.phase, fo.state.why) == (Phase.HALTED, "boot")
    assert switch.starts == 2 and switch.state == "off"
    assert sum(n.alert for n in notes[n0:]) == 1 and len(notes) - n0 <= 5


def test_a_gpu_whose_checks_fail_now_and_then_keeps_the_same_server_quietly(tmp_path):
    """실제 호출은 늘 되고 확인이 하나 걸러 한 번 실패하는 서버. 다시 켜거나 멈추지 않고, 오갈 때마다 알리지 않는다."""
    woken = []
    fo, elice, gpu, switch, clock, notes = make(tmp_path, on_gpu=woken.append)
    to_gpu(fo, elice, switch, clock)
    n0, checks, blips = len(notes), 0, 0
    for _ in range(360):
        if fo.phase is Phase.ON_GPU:
            assert call(fo) == "안녕하세요"
        clock.advance(10)
        if fo.phase is Phase.ON_GPU and clock() >= fo.state.next_gpu_probe_at:
            checks += 1
            gpu.mode = "service" if checks % 2 else "ok"
            blips += checks % 2
        fo.tick()
        gpu.mode = "ok"
    assert blips >= 10
    assert fo.phase in (Phase.ON_GPU, Phase.STARTING) and fo.state.boot_failures == 0
    assert switch.starts == 1 and len(woken) == 1
    assert notes[n0:] == []


@pytest.mark.parametrize("mode", [Mode.AUTO, Mode.MANUAL])
def test_an_idle_turn_off_while_elice_answers_sends_calls_to_elice_and_does_not_restart(tmp_path, mode):
    """리허설처럼 Elice 가 멀쩡할 때 /gpu on 한 서버가 일 없음으로 꺼진다. 그사이 온 호출로 다시 켜거나 장애라고 알리지 않는다."""
    fo, elice, gpu, switch, clock, notes = make(tmp_path, mode=mode)
    request(tmp_path, "on")
    assert ticks(fo, clock, 600, until=lambda: fo.phase is Phase.ON_GPU)
    assert ticks(fo, clock, LIMITS.idle_s + 30, until=lambda: fo.phase is Phase.STOPPING)
    assert route_of(fo.state, clock()) is Route.ELICE
    assert call(fo) == "안녕하세요"
    assert ticks(fo, clock, 1200, until=lambda: fo.phase is Phase.PARKED)
    assert switch.starts == 1
    assert not any("계속 실패" in n.text for n in notes)


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


def test_elice_succeeding_after_the_hold_while_the_server_is_still_off_stops_the_start(tmp_path):
    """용량 부족으로 켜기가 미뤄지는 동안 기다림이 풀려 Elice 실제 호출이 성공한다. 용량이 풀려도 켜지 않는다."""
    fo, elice, gpu, switch, clock, notes = make(tmp_path)
    switch.refuse = "capacity"
    fail_elice(fo, elice, 6)
    fo.tick()
    assert ticks(fo, clock, 300, until=lambda: fo.phase is Phase.STARTING)
    ticks(fo, clock, LIMITS.hold_s + 60)
    assert fo.phase is Phase.STARTING and route_of(fo.state, clock()) is Route.ELICE
    elice.mode = "ok"
    assert call(fo, prompt="동우님.") == "안녕하세요"
    fo.tick()
    assert (fo.phase, fo.state.why) == (Phase.NORMAL, "elice_ok")
    assert "켜기를 그만둡니다" in notes[-1].text
    switch.refuse = None
    ticks(fo, clock, 900)
    assert switch.starts == 0 and elice.prompts[-1] == "동우님."


def test_elice_succeeding_after_the_hold_while_the_server_boots_keeps_the_start(tmp_path):
    fo, elice, gpu, switch, clock, notes = make(tmp_path)
    switch.boot_s = LIMITS.hold_s + 600                # 기다림이 풀린 뒤에도 켜는 중이다
    fail_elice(fo, elice, 6)
    fo.tick()
    assert ticks(fo, clock, LIMITS.hold_s + 300, until=lambda: fo.state.hold_until is None)
    assert switch.state == "starting"
    elice.mode = "ok"
    call(fo)
    assert ticks(fo, clock, 900, until=lambda: fo.phase is Phase.ON_GPU)
    assert switch.starts == 1


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


@pytest.mark.parametrize("variant", ["gpu_lost", "boot"])
def test_a_reboot_on_the_sixth_session_is_not_a_seventh_start(tmp_path, variant):
    fo, elice, gpu, switch, clock, notes = make(tmp_path)
    for _ in range(LIMITS.day_ons - 1):
        request(tmp_path, "on")
        assert ticks(fo, clock, 600, until=lambda: fo.phase is Phase.ON_GPU)
        request(tmp_path, "off")
        assert ticks(fo, clock, 900, until=lambda: fo.phase is Phase.NORMAL)
    if variant == "boot":
        gpu.mode = "service"                       # 여섯 번째 부팅이 준비되지 않는다
    request(tmp_path, "on")
    if variant == "gpu_lost":
        assert ticks(fo, clock, 600, until=lambda: fo.phase is Phase.ON_GPU)
        gpu.mode = "service"                       # 넘긴 뒤 응답을 멈춘다
    assert ticks(fo, clock, 3600, until=lambda: fo.phase is Phase.HALTED)
    assert (fo.state.why, switch.starts) == ("day_cap", LIMITS.day_ons)


def test_a_server_that_keeps_dying_after_boot_is_rebooted_once_per_outage(tmp_path):
    """부팅 뒤 8분만 답하는 서버. 넘긴 뒤의 응답 없음도 부팅 실패로 쌓여 다시 켜기는 장애 하나에 한 번이다."""
    fo, elice, gpu, switch, clock, notes = make(tmp_path)

    def flaky():
        gpu.mode = "ok" if switch.launched_at is not None and clock() - switch.launched_at < 480 else "service"

    gpu.on_call = flaky
    fail_elice(fo, elice, 6)
    fo.tick()
    assert ticks(fo, clock, 6 * 3600, until=lambda: fo.phase is Phase.HALTED)
    assert (fo.state.why, switch.starts) == ("boot", 2)


def test_the_daily_time_cap_turns_the_server_off(tmp_path):
    fo, elice, gpu, switch, clock, notes = make(tmp_path)
    fo._limits = LIMITS.__class__(day_on_s=1800, idle_s=4 * 3600)
    elice.mode = "service"
    request(tmp_path, "on")
    ticks(fo, clock, 600, until=lambda: fo.phase is Phase.ON_GPU)
    assert ticks(fo, clock, 2400, until=lambda: fo.phase is Phase.HALTED)
    assert fo.state.why == "day_cap" and switch.state == "off"


def test_a_day_cap_hit_just_before_midnight_does_not_block_the_next_day(tmp_path):
    """23:28 KST 에 켜 23:58 에 하루 시간 상한(줄인 값 30분)에 닿고, 꺼짐은 00:05 에 본다. 새 날의 몫은 5분뿐이다."""
    from stt.failover import kst_day

    fo, elice, gpu, switch, clock, notes = make(tmp_path, Clock(1_799_936_880.0))
    fo._limits = LIMITS.__class__(day_on_s=1800, idle_s=4 * 3600)
    day0 = kst_day(clock())
    elice.mode = "service"
    request(tmp_path, "on")
    assert ticks(fo, clock, 600, until=lambda: fo.phase is Phase.ON_GPU)
    assert ticks(fo, clock, 3600, until=lambda: fo.phase is Phase.STOPPING)
    assert kst_day(clock()) == day0
    assert ticks(fo, clock, 1200, until=lambda: fo.phase is Phase.HALTED)
    assert kst_day(clock()) != day0
    ticks(fo, clock, 3 * 3600)
    request(tmp_path, "on")
    fo.tick()
    assert fo.phase is Phase.STARTING and switch.starts == 1


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


@pytest.mark.parametrize("between", ["one success", "restart"])
def test_a_manual_on_after_the_would_start_alert_wakes_from_the_outage_start(tmp_path, between):
    """manual 은 호출을 붙잡지 않아 회의가 실제로 포기된다. 알린 뒤 사람이 켜면 그 장애의 처음부터 깨워야 한다."""
    seen = []
    fo, elice, gpu, switch, clock, notes = make(tmp_path, mode=Mode.MANUAL, on_gpu=seen.append)
    t0 = clock()
    fail_elice(fo, elice, 6)
    fo.tick()
    ticks(fo, clock, 600)
    assert fo.state.why == "would_start"
    if between == "one success":
        elice.mode = "ok"
        call(fo)
    else:
        fo = FailoverStt(elice, gpu, switch=switch, mode=Mode.MANUAL, state_dir=tmp_path, notify=notes.append,
                         on_gpu=seen.append, clock=clock, probe=(PROBE, 16_000), wait_poll_s=0.005)
    fail_elice(fo, elice, 2)
    ticks(fo, clock, 300)
    request(tmp_path, "on")
    assert ticks(fo, clock, 600, until=lambda: fo.phase is Phase.ON_GPU)
    assert seen == [t0]


def test_switching_manual_to_auto_during_an_outage_starts_the_gpu(tmp_path):
    """README 의 auto 로 바꾸기를 장애 중에 하면 상태 파일의 would_start 가 남는다. 그 막음은 manual 의 것이다."""
    seen = []
    fo, elice, gpu, switch, clock, notes = make(tmp_path, mode=Mode.MANUAL)
    t0 = clock()
    fail_elice(fo, elice, 6)
    fo.tick()
    ticks(fo, clock, 600)
    assert fo.state.why == "would_start"
    auto = FailoverStt(elice, gpu, switch=switch, mode=Mode.AUTO, state_dir=tmp_path, notify=notes.append,
                       on_gpu=seen.append, clock=clock, probe=(PROBE, 16_000), wait_poll_s=0.005)
    fail_elice(auto, elice, 10)
    assert ticks(auto, clock, 600, until=lambda: auto.phase is Phase.ON_GPU)
    assert switch.starts == 1 and seen == [t0]


def test_elice_succeeding_again_after_the_would_start_alert_ends_that_outage(tmp_path):
    seen = []
    fo, elice, gpu, switch, clock, notes = make(tmp_path, mode=Mode.MANUAL, on_gpu=seen.append)
    t0 = clock()
    fail_elice(fo, elice, 6)
    fo.tick()
    ticks(fo, clock, 600)
    elice.mode = "ok"
    for _ in range(LIMITS.back_oks):
        call(fo)
    fo.tick()
    assert fo.state.outage_since is None
    clock.advance(3600)
    request(tmp_path, "on")
    assert ticks(fo, clock, 600, until=lambda: fo.phase is Phase.ON_GPU)
    assert seen[0] > t0 + 3600


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


def test_a_failing_state_write_still_moves_on_and_writes_once_the_disk_frees(tmp_path, monkeypatch, capsys):
    """스위치는 이미 불렸다. 파일을 못 썼다고 단계를 멈추면 tick 마다 on 을 다시 보내고 알림도 끊긴다."""
    import stt.failover as failover

    fo, elice, gpu, switch, clock, notes = make(tmp_path)
    fail_elice(fo, elice, 6)
    fo.tick()
    assert ticks(fo, clock, 300, until=lambda: fo.phase is Phase.STARTING)
    write = failover._atomic_write

    def disk_full(path, text):
        raise OSError(28, "No space left on device")

    monkeypatch.setattr(failover, "_atomic_write", disk_full)
    n0 = len(notes)
    assert ticks(fo, clock, 3 * 3600, until=lambda: fo.phase is Phase.PARKED)
    assert switch.starts == 1 and switch.state == "off" and len(notes) > n0
    assert "상태 파일을 쓰지 못했다" in capsys.readouterr().out
    monkeypatch.setattr(failover, "_atomic_write", write)
    fo.tick()
    assert read_state_file(tmp_path)["phase"] == "parked"


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


def test_the_wake_hook_runs_once_per_outage_not_per_entry_into_gpu(tmp_path):
    """깨운 재처리가 다시 실패해 포기한 회의를 GPU 확인 한 번 실패나 3시간 넘김 때마다 다시 돌리지 않는다."""
    seen = []
    fo, elice, gpu, switch, clock, notes = make(tmp_path, on_gpu=seen.append)
    t0 = clock()
    to_gpu(fo, elice, switch, clock)
    gpu.mode = "service"
    assert ticks(fo, clock, 120, until=lambda: fo.phase is Phase.STARTING)
    gpu.mode = "ok"
    assert ticks(fo, clock, 1200, until=lambda: fo.phase is Phase.ON_GPU)
    while switch.stop_at - clock() > LIMITS.rollover_s + 60:
        call(fo)
        ticks(fo, clock, 60)
    call(fo)
    assert ticks(fo, clock, 120, until=lambda: fo.state.why == "rollover")
    assert ticks(fo, clock, 1200, until=lambda: fo.phase is Phase.ON_GPU)
    assert seen == [t0]
    elice.mode = "ok"
    for _ in range(40):
        call(fo)
        if ticks(fo, clock, 60, until=lambda: fo.phase is Phase.PARKED):
            break
    t1 = clock()
    fail_elice(fo, elice, 3)
    fo.tick()
    assert ticks(fo, clock, 600, until=lambda: fo.phase is Phase.ON_GPU)
    assert seen == [t0, t1]                        # 되돌린 뒤의 새 장애는 다시 깨운다


def test_a_manual_on_after_halting_wakes_the_same_outage_again(tmp_path):
    """HALTED 동안 Elice 로 간 전사가 포기된다. 사람이 켜서 다시 넘기면 그 회의도 깨워야 한다."""
    seen = []
    fo, elice, gpu, switch, clock, _ = make(tmp_path, on_gpu=seen.append)
    t0 = clock()
    to_gpu(fo, elice, switch, clock)
    gpu.mode = "service"
    assert ticks(fo, clock, 3600, until=lambda: fo.phase is Phase.HALTED)
    assert fo.state.why == "boot" and seen == [t0]
    gpu.mode = "ok"
    request(tmp_path, "on")
    assert ticks(fo, clock, 900, until=lambda: fo.phase is Phase.ON_GPU)
    assert seen == [t0, t0]


@pytest.mark.parametrize("manual_on, wakes", [(False, 1), (True, 2)])
def test_a_hold_that_runs_out_during_a_rollover_wakes_again_only_on_a_manual_on(tmp_path, manual_on, wakes):
    """3시간 넘김의 다시 켜기가 용량 부족으로 30분을 넘기면 전사가 Elice 로 가 포기될 수 있다. 사람이 켤 때만 다시 깨운다."""
    seen = []
    fo, elice, gpu, switch, clock, _ = make(tmp_path, on_gpu=seen.append)
    t0 = clock()
    to_gpu(fo, elice, switch, clock)
    while switch.stop_at - clock() > LIMITS.rollover_s + 60:
        call(fo)
        ticks(fo, clock, 60)
    call(fo)
    assert ticks(fo, clock, 120, until=lambda: fo.state.why == "rollover")
    switch.refuse = "capacity"
    assert ticks(fo, clock, LIMITS.hold_s + 120, until=lambda: fo.state.hold_until is None)
    assert fo.phase is Phase.STARTING and switch.state == "off"
    if manual_on:
        request(tmp_path, "on")
        fo.tick()
    switch.refuse = None
    assert ticks(fo, clock, 900, until=lambda: fo.phase is Phase.ON_GPU)
    assert seen == [t0] * wakes


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


@pytest.mark.parametrize("age_min, starts", [(11, 0), (9, 1)])
def test_a_request_older_than_ten_minutes_is_dropped(tmp_path, capsys, age_min, starts):
    """전환이 꺼졌거나 멈춘 워커에 남은 요청이 며칠 뒤 서버를 켜지 않는다. 파일 시각은 벽시계다."""
    fo, elice, gpu, switch, clock, notes = make(tmp_path)
    path = request(tmp_path, "on")
    old = time.time() - age_min * 60
    os.utime(path, (old, old))
    fo.tick()
    fo.tick()
    assert switch.starts == starts
    assert path.exists() is False
    assert ("지난 요청" in capsys.readouterr().out) is (starts == 0)
    dropped = [n for n in notes if "분 지난 요청을 버렸습니다" in n.text]
    assert [("11분 지난" in n.text, n.alert) for n in dropped] == ([(True, False)] if starts == 0 else [])


def _age_like_the_wall_clock(path, written_at, clock):
    """파일 시각은 벽시계다. 가짜 시계로 지난 만큼 되돌린다."""
    if path.exists():
        old = time.time() - (clock() - written_at)
        os.utime(path, (old, old))


def test_an_on_request_left_during_a_slow_turn_off_is_kept_past_ten_minutes(tmp_path):
    """꺼지는 데 10분을 넘긴 서버. 끄는 중에 친 /gpu on 은 버리지 않고 꺼진 뒤에 켠다."""
    fo, elice, gpu, switch, clock, notes = make(tmp_path)
    switch.stop_s = 700
    request(tmp_path, "on")
    assert ticks(fo, clock, 600, until=lambda: fo.phase is Phase.ON_GPU)
    request(tmp_path, "off")
    assert ticks(fo, clock, 60, until=lambda: fo.phase is Phase.STOPPING)
    path, written_at, n0 = request(tmp_path, "on"), clock(), len(notes)
    assert ticks(fo, clock, 900, until=lambda: _age_like_the_wall_clock(path, written_at, clock)
                 or fo.phase is not Phase.STOPPING)
    assert clock() - written_at > 600
    assert ticks(fo, clock, 60, until=lambda: _age_like_the_wall_clock(path, written_at, clock)
                 or switch.starts == 2)
    assert fo.phase is Phase.STARTING and not path.exists()
    assert not any("지난 요청" in n.text for n in notes[n0:])


def test_a_stale_on_request_first_seen_during_a_turn_off_is_still_dropped(tmp_path):
    """끄는 중에 처음 본 요청이 이미 10분을 넘겼으면 버린다(끄는 중에 다시 뜬 워커가 찾은 며칠 전 요청). 나이를 보지 않는 것은 끄는 중에 미뤄 둔 그 파일뿐이다."""
    fo, elice, gpu, switch, clock, notes = make(tmp_path)
    request(tmp_path, "on")
    assert ticks(fo, clock, 600, until=lambda: fo.phase is Phase.ON_GPU)
    request(tmp_path, "off")
    assert ticks(fo, clock, 60, until=lambda: fo.phase is Phase.STOPPING)
    path = request(tmp_path, "on")
    old = time.time() - 11 * 60
    os.utime(path, (old, old))
    ticks(fo, clock, 900)
    assert not path.exists() and switch.starts == 1 and fo.phase is Phase.NORMAL
    assert any("11분 지난 요청을 버렸습니다" in n.text for n in notes)


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
