"""GPU 전환 상태 기계의 순수 함수. step 은 전이표의 줄마다, plan 은 I/O 표의 줄마다, route_of 는 길 표의 줄마다 하나다."""

from dataclasses import replace

import pytest

from stt.failover import (LIMITS, Facts, FailoverState, Io, Mode, Phase, Route, ServerView, Signals, kst_day, plan,
                          route_of, step)

T0 = 1_800_000_000.0          # 2027-01-15 17:20 KST
L = LIMITS
LAUNCH = T0 - 600.0
RUNNING = ServerView(state="running", launched_at=LAUNCH, stop_at=LAUNCH + 3 * 3600, refused=None, used_min=70,
                     cap_min=900)
OFF = ServerView(state="off", launched_at=None, stop_at=None, refused=None, used_min=80, cap_min=900)
STARTING_VIEW = replace(RUNNING, state="starting")


def sig(**kw) -> Signals:
    return Signals(**{**dict(elice_fails=0, elice_oks=0, elice_streak=0, streak_since=None, auth=False,
                             gpu_inflight=0, gpu_streak=0, last_gpu_call=None, waiting=0), **kw})


def st(phase: Phase, **kw) -> FailoverState:
    return FailoverState(**{**dict(phase=phase, since=T0, day=kst_day(T0)), **kw})


def facts(now=T0 + 10, **kw) -> Facts:
    signals = kw.pop("signals", {})
    return Facts(**{**dict(now=now, mode=Mode.AUTO, signals=sig(**signals), request=None, server=None,
                           switch_error=False, gpu_ok=None, elice_ok=None), **kw})


def run(state, f):
    new, notices = step(state, f, L)
    return new, notices


ON_GPU = dict(server=RUNNING, session=(LAUNCH, LAUNCH + 3 * 3600), day_ons=1, next_probe_at=T0 + 300,
              next_gpu_probe_at=T0 + 60)
FULL_TIME = dict(day_used_s=6 * 3600.0)
FULL_ONS = dict(day_ons=6)

# (이름, 시작 상태, 사실, 기대하는 단계, 기대하는 이유, 더 볼 칸)
ROWS = [
    # NORMAL
    ("normal: 실패 5번은 그대로", st(Phase.NORMAL), facts(signals=dict(elice_fails=5, elice_streak=5)),
     Phase.NORMAL, "", {}),
    ("normal: 연속 실패 6번이면 hold", st(Phase.NORMAL),
     facts(signals=dict(elice_fails=6, elice_streak=6, streak_since=T0 - 50)),
     Phase.SUSPECT, "elice_down", {"hold_until": T0 + 10 + L.hold_s, "outage_since": T0 - 50, "next_probe_at": T0 + 10}),
    ("normal: 단계 전의 실패는 세지 않는다", st(Phase.NORMAL, mark=(4, 0)),
     facts(signals=dict(elice_fails=8, elice_streak=8)), Phase.NORMAL, "", {}),
    ("normal: 멈춤이면 hold 하지 않는다", st(Phase.NORMAL, paused_until=T0 + 100),
     facts(signals=dict(elice_fails=6, elice_streak=6)), Phase.NORMAL, "", {}),
    ("normal: manual 모드도 확인은 한다", st(Phase.NORMAL),
     facts(mode=Mode.MANUAL, signals=dict(elice_fails=6, elice_streak=6)), Phase.SUSPECT, "elice_down", {}),
    ("normal: 켰을 것을 알린 뒤에는 다시 확인하지 않는다", st(Phase.NORMAL, why="would_start"),
     facts(mode=Mode.MANUAL, signals=dict(elice_fails=6, elice_streak=6)), Phase.NORMAL, "would_start", {}),
    ("normal: 알린 뒤 Elice 가 성공하면 다시 센다", st(Phase.NORMAL, why="would_start"),
     facts(mode=Mode.MANUAL, signals=dict(elice_oks=1)), Phase.NORMAL, "", {}),
    ("normal: 수동 켜기", st(Phase.NORMAL), facts(request="on"), Phase.STARTING, "manual",
     {"hold_until": T0 + 10 + L.hold_s}),
    ("normal: 수동 켜기, 하루 켜기 수 상한", st(Phase.NORMAL, **FULL_ONS), facts(request="on"),
     Phase.HALTED, "day_cap", {}),
    ("normal: 수동 끄기는 24시간 멈춘다", st(Phase.NORMAL), facts(request="off"), Phase.NORMAL, "",
     {"paused_until": T0 + 10 + L.pause_s}),
    # SUSPECT
    ("suspect: 확인 실패 한 번은 그대로", st(Phase.SUSPECT, why="elice_down", hold_until=T0 + 1800),
     facts(elice_ok=False), Phase.SUSPECT, "elice_down", {"probe_fails": 1, "next_probe_at": T0 + 10 + L.probe_gap_s}),
    ("suspect: 확인 실패 3번이면 켠다", st(Phase.SUSPECT, why="elice_down", hold_until=T0 + 1800, probe_fails=2),
     facts(elice_ok=False), Phase.STARTING, "elice_down", {"hold_until": T0 + 1800}),
    ("suspect: manual 모드는 켜지 않고 알린다", st(Phase.SUSPECT, why="elice_down", hold_until=T0 + 1800, probe_fails=2),
     facts(mode=Mode.MANUAL, elice_ok=False), Phase.NORMAL, "would_start", {"hold_until": None}),
    ("suspect: 확인 성공이면 돌아간다", st(Phase.SUSPECT, why="elice_down", hold_until=T0 + 1800, probe_fails=2),
     facts(elice_ok=True), Phase.NORMAL, "elice_ok", {"hold_until": None}),
    ("suspect: 실제 호출이 성공해도 돌아간다", st(Phase.SUSPECT, why="elice_down", hold_until=T0 + 1800),
     facts(signals=dict(elice_oks=1)), Phase.NORMAL, "elice_ok", {}),
    ("suspect: 확인 실패 3번, 하루 시간 상한", st(Phase.SUSPECT, why="elice_down", hold_until=T0 + 1800, probe_fails=2,
                                       **FULL_TIME),
     facts(elice_ok=False), Phase.HALTED, "day_cap", {}),
    ("suspect: 수동 끄기", st(Phase.SUSPECT, why="elice_down", hold_until=T0 + 1800), facts(request="off"),
     Phase.NORMAL, "manual", {"paused_until": T0 + 10 + L.pause_s, "hold_until": None}),
    ("suspect: 수동 켜기", st(Phase.SUSPECT, why="elice_down", hold_until=T0 + 1800), facts(request="on"),
     Phase.STARTING, "manual", {"hold_until": T0 + 1800}),
    # STARTING
    ("starting: 수동 끄기", st(Phase.STARTING, why="elice_down", hold_until=T0 + 1800), facts(request="off"),
     Phase.STOPPING, "manual", {"paused_until": T0 + 10 + L.pause_s, "hold_until": None}),
    ("starting: spent 거절", st(Phase.STARTING, why="elice_down"), facts(server=replace(OFF, refused="spent")),
     Phase.STOPPING, "spent", {}),
    ("starting: not_ready 거절", st(Phase.STARTING, why="elice_down"), facts(server=replace(OFF, refused="not_ready")),
     Phase.STOPPING, "start_failed", {}),
    ("starting: 2시간 넘게 못 켬", st(Phase.STARTING, why="elice_down"), facts(now=T0 + L.start_give_up_s + 1),
     Phase.STOPPING, "start_failed", {}),
    ("starting: 하루 시간 상한", st(Phase.STARTING, why="elice_down", **FULL_TIME), facts(server=STARTING_VIEW),
     Phase.STOPPING, "day_cap", {}),
    ("starting: GPU 확인 성공", st(Phase.STARTING, why="elice_down", server=RUNNING, hold_until=T0 + 1800),
     facts(server=RUNNING, gpu_ok=True), Phase.ON_GPU, "elice_down",
     {"hold_until": None, "elice_ok": 0, "next_probe_at": T0 + 10 + L.back_gap_s}),
    ("starting: 부팅 420초 안의 확인 실패는 기다린다", st(Phase.STARTING, why="elice_down", server=RUNNING),
     facts(now=LAUNCH + 400, server=RUNNING, gpu_ok=False), Phase.STARTING, "elice_down",
     {"boot_failures": 0, "discard": None}),
    ("starting: 부팅 420초 넘은 확인 실패는 끄고 다시", st(Phase.STARTING, why="elice_down", server=RUNNING),
     facts(now=LAUNCH + 421, server=RUNNING, gpu_ok=False), Phase.STARTING, "elice_down",
     {"boot_failures": 1, "discard": LAUNCH}),
    ("starting: 두 번째 부팅 실패면 끄고 멈춘다", st(Phase.STARTING, why="elice_down", server=RUNNING, boot_failures=1),
     facts(now=LAUNCH + 421, server=RUNNING, gpu_ok=False), Phase.STOPPING, "boot", {}),
    ("starting: 꺼짐을 보면 버릴 부팅이 끝났다", st(Phase.STARTING, why="rollover", server=RUNNING, discard=LAUNCH),
     facts(server=OFF), Phase.STARTING, "rollover", {"discard": None}),
    ("starting: 새 부팅이 보이면 버릴 부팅이 끝났다", st(Phase.STARTING, why="rollover", server=RUNNING, discard=LAUNCH),
     facts(server=replace(STARTING_VIEW, launched_at=T0)), Phase.STARTING, "rollover", {"discard": None}),
    ("starting: 종료 15분 안의 부팅은 버린다", st(Phase.STARTING, why="elice_down", since=LAUNCH + 3 * 3600 - 1000),
     facts(now=LAUNCH + 3 * 3600 - 800, server=RUNNING), Phase.STARTING, "elice_down", {"discard": LAUNCH}),
    ("starting: vCPU 한도 거절은 5분 뒤", st(Phase.STARTING, why="elice_down"), facts(server=replace(OFF, refused="limit")),
     Phase.STARTING, "elice_down", {"retry_at": T0 + 10 + L.refused_retry_s, "refused": "limit"}),
    ("starting: 용량 거절은 5분 뒤", st(Phase.STARTING, why="elice_down"),
     facts(server=replace(OFF, refused="capacity")), Phase.STARTING, "elice_down", {"refused": "capacity"}),
    ("starting: 스위치 불통은 60초 뒤", st(Phase.STARTING, why="elice_down"), facts(switch_error=True),
     Phase.STARTING, "elice_down", {"retry_at": T0 + 10 + L.switch_retry_s, "switch_down_since": T0 + 10}),
    ("starting: 기다림 상한이 지나면 길을 푼다", st(Phase.STARTING, why="elice_down", hold_until=T0 + 5),
     facts(), Phase.STARTING, "elice_down", {"hold_until": None}),
    # ON_GPU
    ("on_gpu: 수동 끄기", st(Phase.ON_GPU, why="elice_down", **ON_GPU), facts(request="off"),
     Phase.STOPPING, "manual", {"paused_until": T0 + 10 + L.pause_s}),
    ("on_gpu: 하루 시간 상한", st(Phase.ON_GPU, why="elice_down", **ON_GPU),
     facts(now=LAUNCH + 6 * 3600, signals=dict(last_gpu_call=LAUNCH + 6 * 3600)), Phase.STOPPING, "day_cap", {}),
    ("on_gpu: Elice 확인 2번 성공은 그대로", st(Phase.ON_GPU, why="elice_down", elice_ok=1, **ON_GPU),
     facts(elice_ok=True, signals=dict(last_gpu_call=T0)), Phase.ON_GPU, "elice_down",
     {"elice_ok": 2, "next_probe_at": T0 + 10 + L.back_gap_s}),
    ("on_gpu: Elice 확인 3번 연속이면 되돌린다", st(Phase.ON_GPU, why="elice_down", elice_ok=2, **ON_GPU),
     facts(elice_ok=True, signals=dict(last_gpu_call=T0)), Phase.STOPPING, "elice_back", {}),
    ("on_gpu: 성공 2번 뒤 실패면 처음부터", st(Phase.ON_GPU, why="elice_down", elice_ok=2, **ON_GPU),
     facts(elice_ok=False, signals=dict(last_gpu_call=T0)), Phase.ON_GPU, "elice_down", {"elice_ok": 0}),
    ("on_gpu: 종료 5분 전, 일이 있으면 끄고 다시", st(Phase.ON_GPU, why="elice_down", **ON_GPU),
     facts(now=LAUNCH + 3 * 3600 - 200, signals=dict(last_gpu_call=LAUNCH + 3 * 3600 - 300)),
     Phase.STARTING, "rollover", {"discard": LAUNCH, "hold_until": LAUNCH + 3 * 3600 - 200 + L.hold_s}),
    ("on_gpu: 종료 5분 전, 일이 없으면 끈다", st(Phase.ON_GPU, why="elice_down", **ON_GPU),
     facts(now=LAUNCH + 3 * 3600 - 200, signals=dict(last_gpu_call=LAUNCH + 3 * 3600 - 1000)),
     Phase.STOPPING, "idle", {}),
    ("on_gpu: 종료 5분 전, 켜기 수 상한이면 다시 켜지 않는다", st(Phase.ON_GPU, why="elice_down", **{**ON_GPU, **FULL_ONS}),
     facts(now=LAUNCH + 3 * 3600 - 200, signals=dict(gpu_inflight=1)), Phase.STOPPING, "day_cap", {}),
    ("on_gpu: GPU 확인 실패", st(Phase.ON_GPU, why="elice_down", **ON_GPU),
     facts(gpu_ok=False, signals=dict(last_gpu_call=T0)), Phase.STARTING, "gpu_lost", {"hold_until": T0 + 10 + L.hold_s}),
    ("on_gpu: GPU 실제 호출 3번 연속 실패", st(Phase.ON_GPU, why="elice_down", **ON_GPU),
     facts(signals=dict(gpu_streak=3, last_gpu_call=T0)), Phase.STARTING, "gpu_lost", {}),
    ("on_gpu: GPU 호출 10분 없음", st(Phase.ON_GPU, why="elice_down", **ON_GPU),
     facts(now=T0 + 700, signals=dict(last_gpu_call=T0 + 50)), Phase.STOPPING, "idle", {"hold_until": T0 + 700 + L.hold_s}),
    ("on_gpu: 진행 중인 호출이 있으면 일 없음이 아니다", st(Phase.ON_GPU, why="elice_down", **ON_GPU),
     facts(now=T0 + 700, signals=dict(last_gpu_call=T0 + 50, gpu_inflight=1)), Phase.ON_GPU, "elice_down", {}),
    ("on_gpu: 호출이 한 번도 없어도 단계 시작부터 10분", st(Phase.ON_GPU, why="manual", **ON_GPU),
     facts(now=T0 + 599), Phase.ON_GPU, "manual", {}),
    # STOPPING
    ("stopping: 꺼짐, 수동", st(Phase.STOPPING, why="manual", session=(LAUNCH, None), day_ons=1), facts(server=OFF),
     Phase.NORMAL, "manual", {"session": None, "day_used_s": 610.0}),
    ("stopping: 꺼짐, Elice 복귀", st(Phase.STOPPING, why="elice_back"), facts(server=OFF), Phase.PARKED, "elice_back", {}),
    ("stopping: 꺼짐, 일 없음, 기다리는 호출 없음", st(Phase.STOPPING, why="idle"), facts(server=OFF),
     Phase.PARKED, "idle", {}),
    ("stopping: 꺼짐, 일 없음, 기다리는 호출 있음", st(Phase.STOPPING, why="idle", hold_until=T0 + 900),
     facts(server=OFF, signals=dict(waiting=2)), Phase.STARTING, "elice_down", {"hold_until": T0 + 900}),
    ("stopping: 꺼짐, 일 없음, manual 모드는 다시 켜지 않는다", st(Phase.STOPPING, why="idle", hold_until=T0 + 900),
     facts(mode=Mode.MANUAL, server=OFF, signals=dict(waiting=2)), Phase.NORMAL, "would_start", {}),
    *[(f"stopping: 꺼짐, {why}", st(Phase.STOPPING, why=why), facts(server=OFF), Phase.HALTED, why, {})
      for why in ("day_cap", "spent", "boot", "start_failed")],
    ("stopping: 아직 꺼지는 중", st(Phase.STOPPING, why="idle"), facts(server=replace(RUNNING, state="stopping")),
     Phase.STOPPING, "idle", {}),
    ("stopping: 수동 끄기는 수동이 된다", st(Phase.STOPPING, why="idle", hold_until=T0 + 900), facts(request="off"),
     Phase.STOPPING, "manual", {"hold_until": None, "paused_until": T0 + 10 + L.pause_s}),
    # PARKED
    ("parked: 실제 성공이면 평소로", st(Phase.PARKED, why="elice_back"), facts(signals=dict(elice_oks=1)),
     Phase.NORMAL, "elice_ok", {}),
    ("parked: 실제 실패 2번은 그대로", st(Phase.PARKED, why="elice_back"),
     facts(signals=dict(elice_fails=2, elice_streak=2)), Phase.PARKED, "elice_back", {}),
    ("parked: 실제 실패 3번이면 바로 켠다", st(Phase.PARKED, why="elice_back"),
     facts(signals=dict(elice_fails=3, elice_streak=3, streak_since=T0 + 1)), Phase.STARTING, "elice_down",
     {"outage_since": T0 + 1, "hold_until": T0 + 10 + L.hold_s}),
    ("parked: 실제 실패 3번, manual 모드", st(Phase.PARKED, why="elice_back"),
     facts(mode=Mode.MANUAL, signals=dict(elice_fails=3, elice_streak=3)), Phase.NORMAL, "would_start", {}),
    ("parked: 실제 실패 3번, 켜기 수 상한", st(Phase.PARKED, why="elice_back", **FULL_ONS),
     facts(signals=dict(elice_fails=3, elice_streak=3)), Phase.HALTED, "day_cap", {}),
    ("parked: 수동 켜기", st(Phase.PARKED, why="idle"), facts(request="on"), Phase.STARTING, "manual", {}),
    ("parked: 수동 끄기", st(Phase.PARKED, why="idle"), facts(request="off"), Phase.NORMAL, "manual",
     {"paused_until": T0 + 10 + L.pause_s}),
    # HALTED
    ("halted: 하루 상한은 날짜가 바뀌면 풀린다", st(Phase.HALTED, why="day_cap", **FULL_ONS), facts(now=T0 + 86400),
     Phase.PARKED, "day_cap", {"day_ons": 0}),
    ("halted: 하루 상한은 같은 날 수동 켜기를 거절한다", st(Phase.HALTED, why="day_cap", **FULL_ONS), facts(request="on"),
     Phase.HALTED, "day_cap", {}),
    *[(f"halted: {why} 뒤 수동 켜기", st(Phase.HALTED, why=why, boot_failures=2), facts(request="on"),
       Phase.STARTING, "manual", {"boot_failures": 0}) for why in ("boot", "start_failed", "spent")],
    ("halted: 부팅 실패는 날짜로 풀리지 않는다", st(Phase.HALTED, why="boot"), facts(now=T0 + 86400),
     Phase.HALTED, "boot", {}),
    ("halted: 수동 끄기", st(Phase.HALTED, why="boot"), facts(request="off"), Phase.HALTED, "boot",
     {"paused_until": T0 + 10 + L.pause_s}),
]


@pytest.mark.parametrize("name, state, f, phase, why, fields", ROWS, ids=[r[0] for r in ROWS])
def test_step_follows_the_transition_table(name, state, f, phase, why, fields):
    new, _ = run(state, f)
    assert (new.phase, new.why) == (phase, why)
    for k, v in fields.items():
        assert getattr(new, k) == v, k


def _text(notices):
    return "\n".join(n.text for n in notices)


@pytest.mark.parametrize("state, f", [
    (st(Phase.SUSPECT, why="elice_down", hold_until=T0 + 1800, probe_fails=2), facts(elice_ok=False)),
    (st(Phase.SUSPECT, why="elice_down", hold_until=T0 + 1800, probe_fails=2), facts(mode=Mode.MANUAL, elice_ok=False)),
    (st(Phase.NORMAL), facts(request="on")),
    (st(Phase.STARTING, why="elice_down"), facts(server=replace(OFF, refused="limit"))),
    (st(Phase.STARTING, why="elice_down"), facts(server=replace(OFF, refused="capacity"))),
    (st(Phase.STARTING, why="elice_down"), facts(server=replace(OFF, refused="not_ready"))),
    (st(Phase.STARTING, why="elice_down"), facts(server=replace(OFF, refused="spent"))),
    (st(Phase.STARTING, why="elice_down", server=RUNNING, boot_failures=1),
     facts(now=LAUNCH + 421, server=RUNNING, gpu_ok=False)),
    (st(Phase.STARTING, why="elice_down", server=RUNNING), facts(now=LAUNCH + 421, server=RUNNING, gpu_ok=False)),
    (st(Phase.ON_GPU, why="elice_down", **ON_GPU), facts(now=LAUNCH + 6 * 3600, signals=dict(last_gpu_call=LAUNCH))),
    (st(Phase.PARKED, why="elice_back", **FULL_ONS), facts(signals=dict(elice_fails=3, elice_streak=3))),
], ids=["auto start", "would start", "manual start", "limit", "capacity", "not_ready", "spent", "boot halt",
        "boot retry", "day cap while on", "day cap at start"])
def test_starts_failures_and_caps_are_alerts(state, f):
    _, notices = run(state, f)
    assert notices and any(n.alert for n in notices), _text(notices)


@pytest.mark.parametrize("state, f", [
    (st(Phase.STARTING, why="elice_down", server=RUNNING, hold_until=T0 + 1800), facts(server=RUNNING, gpu_ok=True)),
    (st(Phase.ON_GPU, why="elice_down", elice_ok=2, **ON_GPU), facts(elice_ok=True, signals=dict(last_gpu_call=T0))),
    (st(Phase.STOPPING, why="idle", session=(LAUNCH, None), day_ons=1), facts(server=OFF)),
    (st(Phase.STOPPING, why="elice_back", session=(LAUNCH, None), day_ons=1), facts(server=OFF)),
], ids=["on gpu", "elice back", "off idle", "off back"])
def test_progress_notices_are_not_alerts(state, f):
    _, notices = run(state, f)
    assert notices and not any(n.alert for n in notices), _text(notices)


def test_the_same_refusal_is_announced_once():
    state = st(Phase.STARTING, why="elice_down")
    state, first = run(state, facts(server=replace(OFF, refused="limit")))
    _, second = run(state, facts(now=T0 + 400, server=replace(OFF, refused="limit")))
    assert first and not second


def test_the_switch_being_down_is_announced_after_five_minutes_once():
    state = st(Phase.STARTING, why="elice_down")
    said = []
    for t in range(0, 900, 60):
        state, notices = run(state, facts(now=T0 + t, switch_error=True))
        said += [(t, n) for n in notices]
    assert [t for t, _ in said] == [300] and said[0][1].alert


@pytest.mark.parametrize("why", ["manual", "elice_back", "idle", "day_cap"])
def test_turning_off_reports_session_and_running_cost(why):
    state = st(Phase.STOPPING, why=why, session=(LAUNCH, None), day_ons=2)
    _, notices = run(state, facts(now=LAUNCH + 3600, server=replace(OFF, used_min=126, cap_min=900)))
    text = _text(notices)
    assert "60분 $0.65(₩906)" in text
    assert "누적 2.1/15시간 $1.36(₩1,902)" in text
    assert "오늘 켠 횟수 2/6" in text
    assert text.rstrip().endswith("GPU 가동분만, 꺼지는 시간 포함, 고정비 제외")


def test_a_session_is_counted_once_per_launch():
    state = st(Phase.STARTING, why="elice_down")
    state, _ = run(state, facts(server=STARTING_VIEW))
    state, _ = run(state, facts(now=T0 + 20, server=RUNNING))
    assert state.day_ons == 1 and state.session == (LAUNCH, LAUNCH + 3 * 3600)
    state, _ = run(state, facts(now=T0 + 30, server=replace(STARTING_VIEW, launched_at=T0 + 25)))
    assert state.day_ons == 2 and state.day_used_s == pytest.approx(T0 + 30 - LAUNCH)


def test_the_kst_day_rolls_over_the_counters():
    state = st(Phase.NORMAL, day_ons=5, day_used_s=100.0)
    state, _ = run(state, facts(now=T0 + 86400))
    assert (state.day, state.day_ons, state.day_used_s) == (kst_day(T0 + 86400), 0, 0.0)


# plan: (단계와 상태, 신호, 시각, 기대하는 I/O)
PLANS = [
    ("normal 은 부르지 않는다", st(Phase.NORMAL), sig(), T0, set()),
    ("parked 는 부르지 않는다", st(Phase.PARKED), sig(), T0, set()),
    ("halted 는 부르지 않는다", st(Phase.HALTED), sig(), T0, set()),
    ("suspect 확인 때", st(Phase.SUSPECT, next_probe_at=T0), sig(), T0, {Io.CHECK_ELICE}),
    ("suspect 확인 전", st(Phase.SUSPECT, next_probe_at=T0 + 30), sig(), T0, set()),
    ("starting 은 켠다", st(Phase.STARTING), sig(), T0, {Io.SWITCH_ON}),
    ("starting 은 재시도 시각 전에는 켜지 않는다", st(Phase.STARTING, retry_at=T0 + 5), sig(), T0, set()),
    ("starting, 켜짐이면 GPU 확인도", st(Phase.STARTING, server=RUNNING), sig(), T0, {Io.SWITCH_ON, Io.CHECK_GPU}),
    ("starting, 켜는 중이면 확인하지 않는다", st(Phase.STARTING, server=STARTING_VIEW), sig(), T0, {Io.SWITCH_ON}),
    ("starting, 버릴 부팅은 끈다", st(Phase.STARTING, server=RUNNING, discard=LAUNCH), sig(), T0, {Io.SWITCH_OFF}),
    ("starting, 켜기 수 상한이면 새로 켜지 않는다", st(Phase.STARTING, server=OFF, **FULL_ONS), sig(), T0, set()),
    ("on_gpu 확인 때", st(Phase.ON_GPU, next_probe_at=T0, next_gpu_probe_at=T0), sig(), T0,
     {Io.CHECK_GPU, Io.CHECK_ELICE}),
    ("on_gpu 확인 전", st(Phase.ON_GPU, next_probe_at=T0 + 1, next_gpu_probe_at=T0 + 1), sig(), T0, set()),
    ("stopping 은 끈다", st(Phase.STOPPING), sig(), T0, {Io.SWITCH_OFF}),
    ("stopping 은 진행 중인 GPU 호출을 기다린다", st(Phase.STOPPING), sig(gpu_inflight=1), T0, set()),
]


@pytest.mark.parametrize("name, state, signals, now, ios", PLANS, ids=[p[0] for p in PLANS])
def test_plan_follows_the_io_table(name, state, signals, now, ios):
    assert plan(state, signals, now, L) == frozenset(ios)


ROUTES = [
    (st(Phase.NORMAL), T0, Route.ELICE),
    (st(Phase.SUSPECT, hold_until=T0 + 1), T0, Route.HOLD),
    (st(Phase.SUSPECT, hold_until=T0), T0, Route.ELICE),
    (st(Phase.STARTING, hold_until=T0 + 1), T0, Route.HOLD),
    (st(Phase.STARTING, hold_until=None), T0, Route.ELICE),
    (st(Phase.ON_GPU), T0, Route.GPU),
    (st(Phase.STOPPING, why="idle", hold_until=T0 + 1), T0, Route.HOLD),
    (st(Phase.STOPPING, why="elice_back", hold_until=T0 + 1), T0, Route.ELICE),
    (st(Phase.STOPPING, why="manual"), T0, Route.ELICE),
    (st(Phase.PARKED), T0, Route.ELICE),
    (st(Phase.HALTED), T0, Route.ELICE),
]


@pytest.mark.parametrize("state, now, route", ROUTES, ids=[f"{r[0].phase}-{r[0].why}-{r[2]}" for r in ROUTES])
def test_route_follows_the_route_table(state, now, route):
    assert route_of(state, now) == route


def test_starting_keeps_trying_on_while_the_hold_and_give_up_clocks_run():
    """STARTING 에서 on 이 tick 마다 나가도 GPU 확인, 기다림 상한, 2시간 포기가 막히지 않는다."""
    state = st(Phase.STARTING, why="elice_down", hold_until=T0 + 1800)
    t = T0
    while state.phase is Phase.STARTING and t < T0 + 3 * 3600:
        assert Io.SWITCH_ON in plan(state, sig(), t, L) or state.retry_at
        state, _ = run(state, facts(now=t, server=replace(OFF, refused="capacity")))
        t += 10
    assert state.hold_until is None
    assert (state.phase, state.why) == (Phase.STOPPING, "start_failed")
