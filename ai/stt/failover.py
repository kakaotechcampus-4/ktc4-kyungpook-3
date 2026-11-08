"""Elice 장애 때 GPU 대기 서버로 전사를 넘기고, Elice 가 돌아오면 되돌리고 끈다(#530).

워커 프로세스 안에서 돈다. FailoverStt 는 SttBackend 모양의 감싸개라 recorder 의 hinted 가 Prompted 로 감싸고,
호출마다 길(Elice, GPU, 기다림)을 고른다. 같은 프로세스의 컨트롤러 tick 이 10초마다 상태 기계를 한 번 돌리고
recordings/.worker/gpu-failover.json 에 적는다. 그 파일은 tick 만 쓴다. 사람의 켜기·끄기는 따로 된 요청 파일
gpu-request 로 받는다(python -m capture.worker --gpu, 디스코드 /gpu).

단계
  NORMAL    Elice 로 보낸다. 실제 호출이 연속 6번 실패(SttError.cause 가 service 나 auth)하면 SUSPECT
  SUSPECT   호출을 기다리게 하고 Elice 를 60초 간격으로 확인한다. 3번 연속 실패면 STARTING, 한 번 성공이면 NORMAL
  STARTING  서버가 준비될 때까지 스위치 on 을 tick 마다 보낸다(멱등). 호출은 기다린다. 기다림이 풀린 뒤 서버가 켜지기 전에
            Elice 실제 호출이 성공하면 NORMAL
  ON_GPU    GPU 로 보낸다. 이름·문맥 프롬프트는 싣지 않는다. Elice 는 5분마다 확인한다. 장애마다 처음 넘길 때 포기한 회의를 깨운다.
            사람이 HALTED 나 STARTING 에서 켜면 다음에 넘길 때 한 번 더 깨운다
  STOPPING  스위치 off. 이유가 idle 이고 마지막 Elice 확인이 실패였으면 호출은 기다린다
  PARKED    꺼졌는데 Elice 가 실제 묶음까지 되는지는 모른다. 첫 실제 성공에 NORMAL, 실제 실패 3번이면 바로 켠다
  HALTED    하루 상한, Lambda 누적 상한(spent), 켜기 포기. 스스로 켜지 않는다

기다림은 SUSPECT 에 들어갈 때부터 최대 30분이다. 기다리는 호출은 실패로 끝나지 않으니 batch 의 재시도도,
recovery.attempts 도, retry_runs 도 늘지 않는다. 30분이 지나면 길이 Elice 로 풀려 지금의 재시도·포기 규칙이 돈다.
값과 근거는 이슈 #530 과 deploy/gpu-stt/README.md 에 있다. plan·step·route_of 는 순수 함수다.
"""

from __future__ import annotations

import json
import os
import threading
import time
from collections.abc import Callable
from dataclasses import asdict, dataclass, replace
from datetime import datetime
from enum import StrEnum
from pathlib import Path
from zoneinfo import ZoneInfo

import numpy as np

from stt.backend import SttError

KST = ZoneInfo("Asia/Seoul")
USD_PER_HOUR = 0.647      # GPU 서버 가동 단가(g 계열 한 대, 결정 0039)
KRW_PER_USD = 1400        # 결정 0039 의 가정 환율
COST_NOTE = "GPU 가동분만, 꺼지는 시간 포함, 고정비 제외"


class Mode(StrEnum):
    MANUAL = "manual"   # 사람의 켜기만 켠다. 자동이면 켰을 때 알림만 한다
    AUTO = "auto"


class Phase(StrEnum):
    NORMAL = "normal"
    SUSPECT = "suspect"
    STARTING = "starting"
    ON_GPU = "on_gpu"
    STOPPING = "stopping"
    PARKED = "parked"
    HALTED = "halted"


class Route(StrEnum):
    ELICE = "elice"
    GPU = "gpu"
    HOLD = "hold"


class Io(StrEnum):
    SWITCH_ON = "switch_on"
    SWITCH_OFF = "switch_off"
    CHECK_GPU = "check_gpu"
    CHECK_ELICE = "check_elice"


@dataclass(frozen=True)
class Limits:
    suspect_fails: int = 6          # 실제 Elice 호출 연속 실패 수
    probe_gap_s: float = 60.0       # SUSPECT 의 Elice 확인 간격
    probe_fails: int = 3
    hold_s: float = 1800.0          # 호출을 붙잡는 최대 시간
    boot_s: float = 420.0           # 부팅 뒤 준비 기한. 측정 약 160초의 2.6배
    back_gap_s: float = 300.0       # ON_GPU 의 Elice 확인 간격
    back_oks: int = 3
    parked_fails: int = 3
    idle_s: float = 600.0
    rollover_s: float = 300.0       # 3시간 종료 몇 초 전에 넘기나
    busy_window_s: float = 600.0    # 이 안에 GPU 호출이 있었으면 일이 있다고 본다
    late_boot_s: float = 900.0      # 종료가 이만큼 안 남은 부팅은 버리고 새로 켠다
    start_give_up_s: float = 7200.0
    refused_retry_s: float = 300.0
    switch_retry_s: float = 60.0
    switch_alarm_s: float = 300.0
    stop_alarm_s: float = 1800.0
    gpu_fails: int = 3
    gpu_probe_gap_s: float = 60.0
    day_on_s: float = 6 * 3600.0    # KST 하루 켠 시간
    day_ons: int = 6                # KST 하루 켜기 수
    pause_s: float = 86400.0        # 수동 끄기가 자동 켜기를 멈추는 시간


LIMITS = Limits()


@dataclass(frozen=True)
class ServerView:
    """스위치 응답. EC2 의 이름은 스위치(Lambda)에서 끝난다."""

    state: str                      # off | starting | running | stopping
    launched_at: float | None
    stop_at: float | None
    refused: str | None             # limit | capacity | spent | not_ready | stopping
    used_min: int = 0               # Lambda 장부의 누적 사용 분
    cap_min: int = 0

    @property
    def live(self) -> bool:
        return self.state in ("starting", "running") and self.launched_at is not None


@dataclass(frozen=True)
class Signals:
    """전사 스레드가 쌓은 것의 사본. FailoverStt 가 주인이고 컨트롤러는 읽기만 한다. 누계는 이 프로세스의 것이다."""

    elice_fails: int = 0            # 장애로 센 실패 누계(service, auth)
    elice_oks: int = 0
    elice_streak: int = 0           # 마지막 성공 뒤 연속 실패
    streak_since: float | None = None
    auth: bool = False              # 연속 실패에 401·402·403 이 섞였다
    gpu_inflight: int = 0
    gpu_fails: int = 0              # GPU 실제 호출을 장애로 센 실패 누계
    gpu_streak: int = 0
    last_gpu_call: float | None = None
    waiting: int = 0


@dataclass(frozen=True)
class FailoverState:
    """recordings/.worker/gpu-failover.json. 컨트롤러 tick 만 쓴다."""

    phase: Phase = Phase.NORMAL
    since: float = 0.0
    why: str = ""
    outage_since: float | None = None   # 이번 장애의 첫 실패. 포기한 회의를 깨울 기준
    woken: float | None = None          # 포기한 회의를 깨운 장애의 outage_since. 같은 장애는 사람이 켤 때만 다시 깨운다
    hold_until: float | None = None
    next_probe_at: float | None = None  # Elice 확인
    probe_fails: int = 0                # SUSPECT 의 연속 확인 실패
    elice_ok: int = 0                   # ON_GPU 의 연속 확인 성공
    next_gpu_probe_at: float | None = None
    retry_at: float | None = None       # 다음 켜기 요청(거절·불통 뒤)
    refused: str | None = None          # 이미 알린 거절. 같은 이유는 한 번만 알린다
    switch_down_since: float | None = None
    boot_failures: int = 0
    discard: float | None = None        # 버릴 부팅의 launched_at. 끄고 새로 켠다(3시간 넘김, 부팅 실패)
    recheck: float | None = None        # 확인이 한 번 실패해 다시 확인하는 서버의 launched_at
    paused_until: float | None = None
    server: ServerView | None = None
    session: tuple[float, float | None] | None = None   # 센 부팅의 (launched_at, stop_at)
    day: str = ""                       # KST 날짜
    day_ons: int = 0
    day_used_s: float = 0.0             # 오늘 닫은 세션의 사용 시간
    mark: Signals = Signals()           # 단계에 들어올 때의 표본. 누계와 견줘 이 단계의 일만 센다. 파일에 쓰지 않는다


@dataclass(frozen=True)
class Facts:
    now: float
    mode: Mode
    signals: Signals
    request: str | None = None          # on | off
    server: ServerView | None = None    # 이번 tick 의 스위치 응답
    switch_error: bool = False
    gpu_ok: bool | None = None          # 이번 tick 의 GPU 확인
    elice_ok: bool | None = None        # 이번 tick 의 Elice 확인


@dataclass(frozen=True)
class Notice:
    text: str
    alert: bool = False                 # 사람이 움직여야 한다. 비공개 운영 채널에 @everyone 을 붙인다


def kst_day(ts: float) -> str:
    return datetime.fromtimestamp(ts, KST).date().isoformat()


def kst_clock(ts: float | None) -> str:
    return datetime.fromtimestamp(ts, KST).strftime("%H:%M") if ts else "?"


def cost_text(minutes: float) -> str:
    usd = minutes / 60 * USD_PER_HOUR
    return f"${usd:.2f}(₩{round(usd * KRW_PER_USD):,})"


def _day_start(ts: float) -> float:
    return datetime.fromtimestamp(ts, KST).replace(hour=0, minute=0, second=0, microsecond=0).timestamp()


def _today_part(session_start: float, now: float) -> float:
    """세션 가운데 오늘(KST) 몫. 자정을 넘긴 세션의 어제 몫을 오늘 상한에 다시 세지 않는다."""
    return max(0.0, now - max(session_start, _day_start(now)))


def today_used_s(s: FailoverState, now: float) -> float:
    return s.day_used_s + (_today_part(s.session[0], now) if s.session else 0.0)


def _time_full(s: FailoverState, now: float, L: Limits) -> bool:
    return today_used_s(s, now) >= L.day_on_s


def _ons_full(s: FailoverState, L: Limits) -> bool:
    return s.day_ons >= L.day_ons


def _new_boot_blocked(s: FailoverState, now: float, L: Limits) -> bool:
    """서버가 켜져 있지 않으면 on 은 새 부팅이다. 하루 상한에 닿았으면 보내지 않는다. 켜진 서버의 on 은 상태 조회라 막지 않는다."""
    live = s.server is not None and s.server.live
    return not live and (_time_full(s, now, L) or _ons_full(s, L))


def _paused(s: FailoverState, now: float) -> bool:
    return s.paused_until is not None and now < s.paused_until


def _fails_here(s: FailoverState, sig: Signals) -> int:
    """이 단계에 들어온 뒤의 연속 실패."""
    return min(sig.elice_streak, sig.elice_fails - s.mark.elice_fails)


def _oks_here(s: FailoverState, sig: Signals) -> int:
    return sig.elice_oks - s.mark.elice_oks


def _gpu_fails_here(s: FailoverState, sig: Signals) -> int:
    return min(sig.gpu_streak, sig.gpu_fails - s.mark.gpu_fails)


def _elice_back_before_on(s: FailoverState, sig: Signals) -> bool:
    """기다림이 풀린 STARTING 에서 Elice 실제 호출이 성공했고, 마지막 스위치 응답이 꺼짐이다. 켜기를 그만둔다.
    스위치가 응답하지 않는 동안은 보낸 on 이 서버를 켰는지 몰라 그만두지 않는다."""
    return (s.hold_until is None and _oks_here(s, sig) > 0 and s.switch_down_since is None
            and s.server is not None and s.server.state == "off")


def _enter(s: FailoverState, phase: Phase, why: str, f: Facts, **kw) -> FailoverState:
    fresh = dict(phase=phase, why=why, since=f.now, mark=f.signals, probe_fails=0,
                 elice_ok=0, next_probe_at=None, next_gpu_probe_at=None, retry_at=None, refused=None,
                 switch_down_since=None, recheck=None)
    if phase in (Phase.NORMAL, Phase.PARKED, Phase.HALTED, Phase.ON_GPU):
        fresh["hold_until"] = None
    if phase is Phase.NORMAL:
        fresh["outage_since"] = None
        fresh["boot_failures"] = 0          # 다시 켜기는 장애 하나에 한 번이다
    return replace(s, **{**fresh, **kw})


def _account(s: FailoverState, view: ServerView | None, now: float) -> tuple[FailoverState, float | None]:
    """KST 날짜를 넘기고 스위치 응답으로 세션을 열고 닫는다. 닫은 세션의 사용 초를 함께 돌려준다.

    사용 시간은 부팅의 launched_at 부터 꺼짐을 본 때까지다. 상태 파일에 적지 않고 서버 값에서 다시 만들어서
    켜기와 저장 사이에 워커가 죽어도 잃지 않는다. 자정을 넘긴 세션은 날마다 그날의 몫만 센다. 켜기 수는 켠 날에 센다.
    """
    if s.day != kst_day(now):
        s = replace(s, day=kst_day(now), day_ons=0, day_used_s=0.0)
    if view is None:
        return s, None
    closed = None
    if s.session and (view.state == "off" or (view.live and view.launched_at != s.session[0])):
        closed = max(0.0, now - s.session[0])
        s = replace(s, day_used_s=s.day_used_s + _today_part(s.session[0], now), session=None)
    if view.live and s.session is None:
        s = replace(s, session=(view.launched_at, view.stop_at), day_ons=s.day_ons + 1)
    return replace(s, server=view), closed


def _start(s: FailoverState, f: Facts, L: Limits, why: str, out: list[Notice], *,
           hold_until: float | None = None) -> FailoverState:
    """켜기로 간다. 하루 상한에 닿았으면 HALTED. 서버가 꺼진 단계에서만 부른다."""
    if _time_full(s, f.now, L) or _ons_full(s, L):
        out.append(Notice(f"⛔ 오늘 GPU 상한(켠 시간 {L.day_on_s / 3600:.0f}시간, 켜기 {L.day_ons}번)에 닿아 켜지 않습니다. "
                          "KST 날짜가 바뀌면 다시 켤 수 있습니다.", alert=True))
        return _enter(s, Phase.HALTED, "day_cap", f)
    outage = s.outage_since or f.signals.streak_since or f.now
    hold = hold_until if hold_until is not None else f.now + L.hold_s
    who = "수동 요청으로" if why == "manual" else "Elice 전사가 계속 실패해"
    out.append(Notice(f"⚠️ {who} GPU 서버를 켭니다. 약 3분 걸리고 그동안 전사는 기다립니다"
                      f"({kst_clock(hold)} 까지).", alert=True))
    return _enter(s, Phase.STARTING, why, f, hold_until=hold, outage_since=outage)


def _would_start(s: FailoverState, f: Facts, out: list[Notice]) -> FailoverState:
    out.append(Notice("⚠️ Elice 전사가 계속 실패합니다. 자동 모드였으면 GPU 서버를 켰습니다. "
                      "켜려면 운영 채널에서 `/gpu on` 을 실행해 주세요.", alert=True))
    # 장애는 끝나지 않았다. 사람이 켜면 이 장애의 처음부터 포기한 회의를 깨운다(그사이 성공 한 번이나 재시작이 있어도)
    return _enter(s, Phase.NORMAL, "would_start", f, outage_since=s.outage_since, boot_failures=s.boot_failures)


def _auto_start(s: FailoverState, f: Facts, L: Limits, out: list[Notice], **kw) -> FailoverState:
    if f.mode is Mode.MANUAL:
        return _would_start(s, f, out)
    return _start(s, f, L, "elice_down", out, **kw)


def _stopping(s: FailoverState, f: Facts, why: str, out: list[Notice], **kw) -> FailoverState:
    kw.setdefault("hold_until", None)
    return _enter(s, Phase.STOPPING, why, f, **kw)


def _idle_stop(s: FailoverState, f: Facts, L: Limits, out: list[Notice]) -> FailoverState:
    """일 없음 끄기. 마지막 Elice 확인이 실패였을 때만 꺼지는 동안 호출을 기다리게 하고, 다 꺼졌을 때 기다리는 호출이 있으면
    다시 켠다. 확인이 성공이었으면 호출은 Elice 로 가고 꺼진 뒤 PARKED 가 실제 결과로 정한다."""
    return _stopping(s, f, "idle", out, hold_until=f.now + L.hold_s if s.elice_ok == 0 else None)


def _paused_by_hand(s: FailoverState, f: Facts, L: Limits, out: list[Notice]) -> FailoverState:
    out.append(Notice(f"⏸ 수동 끄기. 자동 켜기를 {kst_clock(f.now + L.pause_s)}(내일) 까지 멈춥니다."))
    return replace(s, paused_until=f.now + L.pause_s)


def _normal(s, f, L, out, closed):
    sig = f.signals
    if f.request == "off":
        return _paused_by_hand(s, f, L, out)
    if f.request == "on":
        return _start(s, f, L, "manual", out)
    if s.why == "would_start" and _oks_here(s, sig) > 0:
        s = replace(s, why="")
    if s.outage_since is not None and _oks_here(s, sig) >= L.back_oks and sig.elice_streak == 0:
        s = replace(s, outage_since=None, boot_failures=0)      # 알린 장애가 끝났다
    # 알린 뒤 다시 붙잡지 않는 것은 manual 의 규칙이다. 장애 중 auto 로 바꿔 다시 띄운 워커는 상태 파일에 그 표시가 남아 있다
    announced = s.why == "would_start" and f.mode is Mode.MANUAL
    if not announced and not _paused(s, f.now) and _fails_here(s, sig) >= L.suspect_fails:
        out.append(Notice(f"⏳ Elice 전사가 연속 {sig.elice_streak}번 실패했습니다"
                          f"{'(키·크레딧 거절 포함)' if sig.auth else ''}. 전사를 잠시 멈추고 Elice 를 확인합니다."))
        return _enter(s, Phase.SUSPECT, "elice_down", f, hold_until=f.now + L.hold_s, next_probe_at=f.now,
                      outage_since=s.outage_since or sig.streak_since or f.now)
    return s


def _suspect(s, f, L, out, closed):
    if f.request == "off":
        s = _paused_by_hand(s, f, L, out)
        return _enter(s, Phase.NORMAL, "manual", f)
    if f.request == "on":
        return _start(s, f, L, "manual", out, hold_until=s.hold_until)
    if f.elice_ok is True or _oks_here(s, f.signals) > 0:
        out.append(Notice("✅ Elice 가 응답합니다. 전사를 이어 갑니다."))
        return _enter(s, Phase.NORMAL, "elice_ok", f)
    if f.elice_ok is False:
        if s.probe_fails + 1 >= L.probe_fails:
            return _auto_start(s, f, L, out, hold_until=s.hold_until)
        return replace(s, probe_fails=s.probe_fails + 1, next_probe_at=f.now + L.probe_gap_s)
    return s


def _starting(s, f, L, out, closed):
    v = f.server
    if f.request == "off":
        s = _paused_by_hand(s, f, L, out)
        return _stopping(s, f, "manual", out)
    if f.request == "on":
        s = replace(s, woken=None)      # 기다림이 풀린 사이 포기한 회의가 있을 수 있다. 사람이 켜면 넘길 때 다시 깨운다
    if v is not None and v.refused == "spent":
        out.append(Notice("⛔ GPU 사용 시간이 Lambda 누적 상한에 닿아 켜지 못했습니다. 관리자가 상한을 올려야 합니다.",
                          alert=True))
        return _stopping(s, f, "spent", out)
    if v is not None and v.refused == "not_ready":
        out.append(Notice("⛔ GPU 서버가 준비 표시(Ready)가 없어 켜지 못했습니다. 담당자가 setup 을 마쳐야 합니다.",
                          alert=True))
        return _stopping(s, f, "start_failed", out)
    if f.now - s.since > L.start_give_up_s:
        out.append(Notice(f"⛔ {L.start_give_up_s / 3600:.0f}시간 동안 GPU 서버를 켜지 못해 멈춥니다.", alert=True))
        return _stopping(s, f, "start_failed", out)
    if _time_full(s, f.now, L) or _new_boot_blocked(s, f.now, L):
        out.append(Notice("⛔ 오늘 GPU 상한에 닿아 켜기를 멈춥니다.", alert=True))
        return _stopping(s, f, "day_cap", out)
    server = s.server
    rechecking = s.recheck is not None and server is not None and server.launched_at == s.recheck
    if f.gpu_ok is True:
        if not rechecking:      # 확인이 띄엄띄엄 실패하는 서버에서 같은 서버로 돌아올 때마다 알리지 않는다
            out.append(Notice(f"✅ GPU 서버로 전사를 넘겼습니다. 종료 예정 {kst_clock(server.stop_at if server else None)}. "
                              "이름 힌트 없이 전사합니다."))
        return _enter(s, Phase.ON_GPU, s.why, f, discard=None, woken=s.outage_since or f.now,
                      next_probe_at=f.now + L.back_gap_s, next_gpu_probe_at=f.now + L.gpu_probe_gap_s)
    if f.gpu_ok is False and rechecking:
        return _lost(s, f, L, out, s.recheck)
    if f.gpu_ok is False and server and server.launched_at and f.now - server.launched_at > L.boot_s:
        if s.boot_failures + 1 >= 2:
            return _boot_halt(s, f, out)
        out.append(Notice(f"⚠️ GPU 서버가 부팅 뒤 {L.boot_s / 60:.0f}분이 지나도 응답하지 않아 한 번 끄고 다시 켭니다. "
                          "이번 장애에서 다시 켜기는 이 한 번입니다.", alert=True))
        s = replace(s, boot_failures=s.boot_failures + 1, discard=server.launched_at)
    if s.discard is not None and server is not None and (not server.live or server.launched_at != s.discard):
        s = replace(s, discard=None)
    if (s.discard is None and server is not None and server.state == "running" and server.stop_at
            and server.stop_at - f.now <= L.late_boot_s):
        s = replace(s, discard=server.launched_at)
    if v is not None and v.refused in ("limit", "capacity"):
        if s.refused != v.refused:
            what = "GPU vCPU 한도" if v.refused == "limit" else "AWS 용량 부족"
            out.append(Notice(f"⚠️ GPU 서버를 켜지 못했습니다: {what}. {L.refused_retry_s / 60:.0f}분마다 다시 켭니다.",
                              alert=True))
        s = replace(s, retry_at=f.now + L.refused_retry_s, refused=v.refused)
    if f.switch_error:
        down = s.switch_down_since or f.now
        if f.now - down >= L.switch_alarm_s and s.refused != "switch":
            out.append(Notice(f"⚠️ GPU 스위치가 {int((f.now - down) // 60)}분째 응답하지 않습니다.", alert=True))
            s = replace(s, refused="switch")
        s = replace(s, retry_at=f.now + L.switch_retry_s, switch_down_since=down)
    elif v is not None:
        s = replace(s, switch_down_since=None)
    if _elice_back_before_on(s, f.signals):
        out.append(Notice("✅ 서버가 켜지기 전에 Elice 실제 전사가 성공해 GPU 서버 켜기를 그만둡니다. 평소대로 돌아갑니다."))
        return _enter(s, Phase.NORMAL, "elice_ok", f)
    if s.hold_until is not None and f.now >= s.hold_until:
        out.append(Notice("⚠️ 기다림 상한이 지나 기다리던 전사를 Elice 로 보냅니다. 켜기는 계속하고, "
                          "서버가 켜지기 전에 Elice 전사가 성공하면 켜기를 그만둡니다."))
        s = replace(s, hold_until=None)
    return s


def _boot_halt(s: FailoverState, f: Facts, out: list[Notice]) -> FailoverState:
    out.append(Notice("⛔ 이번 장애에서 GPU 서버가 두 번째로 응답하지 않습니다. 끄고 멈춥니다. 담당자 확인이 필요합니다.",
                      alert=True))
    return _stopping(s, f, "boot", out, boot_failures=s.boot_failures + 1)


def _lost(s: FailoverState, f: Facts, L: Limits, out: list[Notice], launched: float | None) -> FailoverState:
    """넘긴 서버가 응답하지 않는다. 장애 하나에 한 번만 끄고 다시 켜고, 두 번째면 끄고 멈춘다."""
    if s.boot_failures + 1 >= 2:
        return _boot_halt(s, f, out)
    out.append(Notice("⚠️ GPU 서버가 응답하지 않아 한 번 끄고 다시 켭니다. 그동안 전사는 기다립니다. "
                      "이번 장애에서 다시 켜기는 이 한 번입니다."))
    # 확인은 되고 실제 호출만 실패하는 서버가 있다. 같은 서버로 돌아가면 tick 마다 오가니 다시 켠 서버로만 넘긴다
    return _enter(s, Phase.STARTING, "gpu_lost", f, hold_until=s.hold_until or f.now + L.hold_s, discard=launched,
                  boot_failures=s.boot_failures + 1)


def _on_gpu(s, f, L, out, closed):
    sig = f.signals
    if f.request == "off":
        s = _paused_by_hand(s, f, L, out)
        return _stopping(s, f, "manual", out)
    if _time_full(s, f.now, L):
        out.append(Notice("⛔ 오늘 GPU 켠 시간 상한에 닿아 서버를 끕니다. 전사는 Elice 로 돌아갑니다.", alert=True))
        return _stopping(s, f, "day_cap", out)
    if f.elice_ok is True:
        if s.elice_ok + 1 >= L.back_oks:
            out.append(Notice(f"✅ Elice 가 돌아왔습니다(확인 {L.back_oks}번 연속 성공). 전사를 되돌리고 GPU 서버를 끕니다."))
            return _stopping(s, f, "elice_back", out)
        s = replace(s, elice_ok=s.elice_ok + 1, next_probe_at=f.now + L.back_gap_s)
    elif f.elice_ok is False:
        s = replace(s, elice_ok=0, next_probe_at=f.now + L.back_gap_s)
    stop_at = s.session[1] if s.session else (s.server.stop_at if s.server else None)
    busy = sig.gpu_inflight > 0 or (sig.last_gpu_call is not None and f.now - sig.last_gpu_call <= L.busy_window_s)
    if stop_at is not None and stop_at - f.now <= L.rollover_s:
        if not busy:
            return _idle_stop(s, f, L, out)
        if _ons_full(s, L):
            out.append(Notice("⛔ 3시간 종료가 다가오는데 오늘 켜기 수 상한이라 다시 켜지 않습니다.", alert=True))
            return _stopping(s, f, "day_cap", out)
        out.append(Notice("🔁 GPU 서버의 3시간 종료가 다가와 끄고 다시 켭니다. 그동안 전사는 기다립니다."))
        return _enter(s, Phase.STARTING, "rollover", f, discard=s.session[0] if s.session else None,
                      hold_until=f.now + L.hold_s)
    lost = s.session[0] if s.session else (s.server.launched_at if s.server else None)
    if _gpu_fails_here(s, sig) >= L.gpu_fails:
        return _lost(s, f, L, out, lost)
    if f.gpu_ok is False:
        # 확인 한 번은 쌓인 호출 뒤에 밀리거나 네트워크가 잠깐 끊겨도 실패한다. 서버를 버리지 않고 기다리게 한 채 다시 확인한다
        return _enter(s, Phase.STARTING, "gpu_lost", f, hold_until=f.now + L.hold_s, recheck=lost)
    if f.gpu_ok is True:
        s = replace(s, next_gpu_probe_at=f.now + L.gpu_probe_gap_s)
    last = max(sig.last_gpu_call or 0.0, s.since)
    if sig.gpu_inflight == 0 and f.now - last >= L.idle_s:
        return _idle_stop(s, f, L, out)
    return s


STOP_REASON = {"manual": "수동 끄기", "elice_back": "Elice 복귀", "idle": "일 없음", "day_cap": "하루 상한",
               "spent": "누적 상한", "boot": "부팅 실패", "start_failed": "켜기 실패"}


def _stopping_step(s, f, L, out, closed):
    if f.request == "off" and s.why != "manual":
        s = _paused_by_hand(s, f, L, out)
        s = replace(s, why="manual", hold_until=None)
    if f.server is None or f.server.state != "off":
        if f.now - s.since > L.stop_alarm_s and s.refused != "slow":
            out.append(Notice(f"⚠️ GPU 서버가 {int((f.now - s.since) // 60)}분째 꺼지지 않습니다."))
            s = replace(s, refused="slow")
        return s
    if closed is not None:
        v = f.server
        out.append(Notice(f"🛑 GPU 서버를 껐습니다({STOP_REASON.get(s.why, s.why)}). 이번 {closed / 60:.0f}분 "
                          f"{cost_text(closed / 60)}, 누적 {v.used_min / 60:.1f}/{v.cap_min / 60:.0f}시간 "
                          f"{cost_text(v.used_min)}, 오늘 켠 횟수 {s.day_ons}/{L.day_ons}.\n{COST_NOTE}"))
    if s.why == "manual":
        return _enter(s, Phase.NORMAL, "manual", f)
    if s.why == "elice_back":
        return _enter(s, Phase.PARKED, "elice_back", f)
    if s.why == "idle":
        if f.signals.waiting > 0:
            return _auto_start(s, f, L, out, hold_until=s.hold_until)
        return _enter(s, Phase.PARKED, "idle", f)
    return _enter(s, Phase.HALTED, s.why, f)


def _parked(s, f, L, out, closed):
    sig = f.signals
    if f.request == "on":
        return _start(s, f, L, "manual", out)
    if f.request == "off":
        s = _paused_by_hand(s, f, L, out)
        return _enter(s, Phase.NORMAL, "manual", f)
    if _oks_here(s, sig) > 0:
        out.append(Notice("✅ Elice 실제 전사가 성공했습니다. 평소대로 돌아갑니다."))
        return _enter(s, Phase.NORMAL, "elice_ok", f)
    if _fails_here(s, sig) >= L.parked_fails:
        if _paused(s, f.now):
            return _enter(s, Phase.NORMAL, "manual", f)
        return _auto_start(replace(s, outage_since=sig.streak_since, boot_failures=0), f, L, out)
    return s


def _halted(s, f, L, out, closed):
    if f.request == "off":
        return _paused_by_hand(s, f, L, out)
    # 상한에 닿은 날이 아니라 오늘의 몫으로 본다. 자정 직전에 닿고 꺼짐을 자정 뒤에 본 HALTED 도 새 날에는 풀린다
    if s.why == "day_cap" and not (_time_full(s, f.now, L) or _ons_full(s, L)):
        out.append(Notice("ℹ️ 날짜가 바뀌어 하루 GPU 상한이 풀렸습니다."))
        return _enter(s, Phase.PARKED, "day_cap", f)
    if f.request == "on":
        if s.why == "day_cap":
            out.append(Notice("⛔ 오늘 GPU 상한에 닿아 켜지 않습니다. KST 날짜가 바뀌면 다시 켤 수 있습니다."))
            return s
        # 멈춘 동안 Elice 로 간 전사가 포기됐을 수 있다. 넘길 때 이번 장애를 다시 깨운다
        return _start(replace(s, boot_failures=0, woken=None), f, L, "manual", out)
    return s


_STEPS = {Phase.NORMAL: _normal, Phase.SUSPECT: _suspect, Phase.STARTING: _starting, Phase.ON_GPU: _on_gpu,
          Phase.STOPPING: _stopping_step, Phase.PARKED: _parked, Phase.HALTED: _halted}


def step(s: FailoverState, f: Facts, L: Limits = LIMITS) -> tuple[FailoverState, list[Notice]]:
    """tick 한 번의 전이. 순수 함수다. 단계마다 위에서부터 보고 단계를 바꾸는 첫 줄에서 멈춘다."""
    s, closed = _account(s, f.server, f.now)
    out: list[Notice] = []
    return _STEPS[s.phase](s, f, L, out, closed), out


def plan(s: FailoverState, sig: Signals, now: float, L: Limits = LIMITS) -> frozenset[Io]:
    """이번 tick 에 할 I/O. 순수 함수다. 스위치 on·off 는 멱등이라 상태 조회를 겸한다."""
    io: set[Io] = set()
    if s.phase is Phase.SUSPECT and (s.next_probe_at is None or now >= s.next_probe_at):
        io.add(Io.CHECK_ELICE)
    elif s.phase is Phase.STARTING:
        server = s.server
        if s.discard is not None and server is not None and server.live and server.launched_at == s.discard:
            io.add(Io.SWITCH_OFF)
        else:
            if ((s.retry_at is None or now >= s.retry_at) and not _new_boot_blocked(s, now, L)
                    and not _elice_back_before_on(s, sig)):
                io.add(Io.SWITCH_ON)
            if server is not None and server.state == "running":
                io.add(Io.CHECK_GPU)
    elif s.phase is Phase.ON_GPU:
        if s.next_gpu_probe_at is None or now >= s.next_gpu_probe_at:
            io.add(Io.CHECK_GPU)
        if s.next_probe_at is None or now >= s.next_probe_at:
            io.add(Io.CHECK_ELICE)
    elif s.phase is Phase.STOPPING and sig.gpu_inflight == 0:
        io.add(Io.SWITCH_OFF)
    return frozenset(io)


def route_of(s: FailoverState, now: float) -> Route:
    """전사 호출이 갈 곳. 기다림은 hold_until 까지다."""
    if s.phase is Phase.ON_GPU:
        return Route.GPU
    holds = s.phase in (Phase.SUSPECT, Phase.STARTING) or (s.phase is Phase.STOPPING and s.why == "idle")
    if holds and s.hold_until is not None and now < s.hold_until:
        return Route.HOLD
    return Route.ELICE


# ─────────────────────────────────────────────────────────────── 파일
STATE_FILE = "gpu-failover.json"
REQUEST_FILE = "gpu-request"
REQUESTS = ("on", "off")
REQUEST_MAX_AGE_S = 600.0   # 이보다 오래 남은 요청은 버린다. 받을 워커가 없던 요청이 며칠 뒤 서버를 켜거나 자동 켜기를 멈추지 않게


def _atomic_write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    tmp.write_text(text, encoding="utf-8")
    tmp.replace(path)


def request(state_dir: Path, verb: str) -> Path:
    """사람의 켜기·끄기. 떠 있는 워커의 다음 tick 이 읽고 지운다. 나중 요청이 앞 요청을 덮는다."""
    if verb not in REQUESTS:
        raise ValueError(f"모르는 요청: {verb}")
    path = Path(state_dir) / REQUEST_FILE
    _atomic_write(path, verb)
    return path


def _identity(path: Path) -> tuple[int, int]:
    st = path.stat()
    return st.st_ino, st.st_mtime_ns


def _unlink_if_same(path: Path, seen: tuple[int, int] | None) -> None:
    try:
        if seen is not None and _identity(path) == seen:
            path.unlink()
    except OSError:
        pass


def read_state_file(state_dir: Path) -> dict | None:
    try:
        return json.loads((Path(state_dir) / STATE_FILE).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _dump(s: FailoverState, mode: Mode, now: float) -> str:
    d = asdict(s)
    d.pop("mark")
    d["phase"] = s.phase.value
    d["mode"] = mode.value
    d["saved_at"] = now
    return json.dumps(d, ensure_ascii=False, indent=1)


def _load(state_dir: Path, now: float) -> FailoverState:
    """다시 뜬 워커가 이어 간다. 표본 누계는 프로세스와 함께 사라지므로 mark 는 0 부터다. ON_GPU 는 단계 시작을
    지금으로 두어 다시 뜨자마자 일 없음으로 끄지 않는다. 깨진 파일은 NORMAL 이고 켜진 서버는 StopAt 이 끈다."""
    fresh = FailoverState(phase=Phase.NORMAL, since=now, day=kst_day(now))
    path = Path(state_dir) / STATE_FILE
    if not path.exists():
        return fresh
    try:
        d = json.loads(path.read_text(encoding="utf-8"))
        d.pop("mode", None)
        d.pop("saved_at", None)
        d["phase"] = Phase(d["phase"])
        d["server"] = ServerView(**d["server"]) if d.get("server") else None
        d["session"] = tuple(d["session"]) if d.get("session") else None
        s = FailoverState(**d)
    except (OSError, ValueError, TypeError, KeyError) as e:
        print(f"[failover] 상태 파일을 읽지 못해 NORMAL 로 시작한다: {type(e).__name__}", flush=True)
        return fresh
    return replace(s, since=now) if s.phase is Phase.ON_GPU else s


def status_text(state_dir: Path, now: float | None = None, limits: Limits = LIMITS) -> str:
    """--gpu status 와 디스코드 /gpu status 의 답. 상태 파일만 읽는다."""
    now = time.time() if now is None else now
    d = read_state_file(state_dir)
    if d is None:
        return "GPU 전환 상태가 없습니다. 워커가 MM_GPU_FAILOVER 를 켜고 돈 적이 없습니다."
    s = _load(state_dir, now)
    lines = [f"GPU 전환: {d.get('mode')}, 단계 {s.phase.value} ({int((now - float(d.get('since') or now)) // 60)}분째"
             f"{', 이유 ' + s.why if s.why else ''})"]
    v = s.server
    if v is not None:
        lines.append(f"서버: {v.state}" + (f", 종료 예정 {kst_clock(v.stop_at)} KST" if v.live else ""))
    ons = s.day_ons if s.day == kst_day(now) else 0
    used = today_used_s(s, now) if s.day == kst_day(now) else 0.0
    total = (f", 누적 {v.used_min / 60:.1f}/{v.cap_min / 60:.0f}시간 {cost_text(v.used_min)}" if v is not None else "")
    lines.append(f"오늘 켠 횟수 {ons}/{limits.day_ons}, 오늘 {used / 3600:.1f}/{limits.day_on_s / 3600:.0f}시간{total}")
    if s.paused_until and now < s.paused_until:
        lines.append(f"자동 켜기 멈춤: {datetime.fromtimestamp(s.paused_until, KST):%m-%d %H:%M} KST 까지")
    if s.hold_until and now < s.hold_until and s.phase in (Phase.SUSPECT, Phase.STARTING, Phase.STOPPING):
        lines.append(f"전사 기다림: {kst_clock(s.hold_until)} 까지")
    return "\n".join(lines)


# ─────────────────────────────────────────────────────────────── 감싸개
# 확인 호출의 음성. 사람 목소리가 아니라 espeak-ng 1.52.0 으로 만든 합성음이다(레포가 공개다). 다시 만드는 법:
#   espeak-ng -v ko -s 140 -w raw.wav "하나 둘 셋." && ffmpeg -i raw.wav -ac 1 -ar 16000 -sample_fmt s16 probe.wav
# 로컬 faster-whisper large-v3 가 프롬프트 없이 " 하나 둘 셋" 으로 읽었다(2026-11-08). 1.57초, Elice 단가로 한 번 약 ₩0.16
PROBE_WAV = Path(__file__).with_name("probe.wav")
_OUTAGE = ("service", "auth")


def _probe_audio() -> tuple[np.ndarray, int]:
    import soundfile as sf

    samples, sr = sf.read(str(PROBE_WAV), dtype="float32")
    return samples, sr


class FailoverStt:
    """SttBackend 모양. 호출마다 route_of 로 길을 고른다. name·accepts_prompt 는 Elice 와 같게 둬 회의록과
    batch.json 의 모델 이름이 그대로다. takes_context 는 두지 않는다. 두면 이름 없는 회의에도 batch 가 context= 로 부른다.

    표본(Signals)은 전사 스레드들이 락 안에서 더하고, 상태는 tick 만 바꾼다. 상태가 바뀌면 notify_all 로 기다리는
    호출을 깨운다. 기다림은 wait_poll_s 마다 주입된 시계로 다시 본다.
    """

    name = "elice/whisper-large-v3"
    accepts_prompt = True
    gives_word_times = False
    language = "ko"

    def __init__(self, elice, gpu, *, switch, mode: Mode, state_dir: Path, notify: Callable[[Notice], None],
                 on_gpu: Callable[[float], None] | None = None, limits: Limits = LIMITS,
                 clock: Callable[[], float] = time.time, probe: tuple[np.ndarray, int] | None = None,
                 wait_poll_s: float = 1.0) -> None:
        self._elice, self._gpu, self._switch = elice, gpu, switch
        self.mode = mode
        self.state_dir = Path(state_dir)
        self._notify, self._on_gpu = notify, on_gpu
        self._limits = limits
        self._clock = clock
        self._probe = probe
        self._wait_poll_s = wait_poll_s
        self._cond = threading.Condition()
        self._tick_lock = threading.Lock()
        self._sig = Signals()
        self.state = _load(self.state_dir, clock())
        self._written = False

    @property
    def phase(self) -> Phase:
        return self.state.phase

    def stt_factory(self) -> tuple["FailoverStt", str, int]:
        from stt.batch import default_workers
        return self, "elice", default_workers("elice")

    def signals(self) -> Signals:
        with self._cond:
            return self._sig

    def _add(self, **kw) -> None:
        with self._cond:
            self._sig = replace(self._sig, **kw)

    # 전사 스레드 ───────────────────────────────────────────────
    def transcribe(self, samples: np.ndarray, sample_rate: int, prompt: str | None = None):
        route = self._wait_route()
        if route is Route.GPU:
            return self._gpu_call(samples, sample_rate)
        return self._elice_call(samples, sample_rate, prompt)

    def _wait_route(self) -> Route:
        with self._cond:
            route = route_of(self.state, self._clock())
            if route is not Route.HOLD:
                return route
            self._sig = replace(self._sig, waiting=self._sig.waiting + 1)
            try:
                while route is Route.HOLD:
                    self._cond.wait(self._wait_poll_s)
                    route = route_of(self.state, self._clock())
                return route
            finally:
                self._sig = replace(self._sig, waiting=self._sig.waiting - 1)

    def _gpu_call(self, samples, sample_rate):
        with self._cond:
            self._sig = replace(self._sig, gpu_inflight=self._sig.gpu_inflight + 1, last_gpu_call=self._clock())
        ok = False
        try:
            # 이름·문맥 프롬프트를 싣지 않는다. GPU 서버에서 프롬프트가 구간을 비웠다(2026-11-07 재현, 무프롬프트 CER 은 Elice 와 같다)
            r = self._gpu.transcribe(samples, sample_rate)
            ok = True
            return r
        except SttError as e:
            if e.cause not in _OUTAGE:
                ok = None
            raise
        finally:
            with self._cond:
                sig = self._sig
                streak = {True: 0, False: sig.gpu_streak + 1, None: sig.gpu_streak}[ok]
                self._sig = replace(sig, gpu_inflight=sig.gpu_inflight - 1, last_gpu_call=self._clock(),
                                    gpu_fails=sig.gpu_fails + (ok is False), gpu_streak=streak)

    def _elice_call(self, samples, sample_rate, prompt):
        try:
            r = self._elice.transcribe(samples, sample_rate, prompt=prompt)
        except SttError as e:
            if e.cause in _OUTAGE:
                with self._cond:
                    sig = self._sig
                    self._sig = replace(sig, elice_fails=sig.elice_fails + 1, elice_streak=sig.elice_streak + 1,
                                        streak_since=sig.streak_since or self._clock(),
                                        auth=sig.auth or e.cause == "auth")
            raise
        with self._cond:
            self._sig = replace(self._sig, elice_oks=self._sig.elice_oks + 1, elice_streak=0, streak_since=None,
                                auth=False)
        return r

    # 컨트롤러 ─────────────────────────────────────────────────
    def tick(self) -> None:
        """컨트롤러 한 번. 요청 파일 → plan → I/O → step → 저장 → 깨우기 → 알림. 예외는 로그만 남긴다.
        컨트롤러가 죽어도 전사는 지금 길로 계속 간다."""
        with self._tick_lock:
            try:
                self._tick()
            except Exception as e:  # noqa: BLE001 - tick 이 깨져도 워커와 전사는 계속 돈다
                print(f"[failover] tick 실패: {type(e).__name__}: {e}", flush=True)

    def _tick(self) -> None:
        L = self._limits
        s = self.state
        req_path = self.state_dir / REQUEST_FILE
        req, seen = None, None
        try:
            seen = _identity(req_path)
            req = req_path.read_text(encoding="utf-8").strip() or None
        except OSError:
            pass
        age = time.time() - seen[1] / 1e9 if seen else 0.0   # 파일 시각은 벽시계라 주입한 시계와 견주지 않는다
        if req is not None and age > REQUEST_MAX_AGE_S:
            print(f"[failover] {int(age // 60)}분 지난 요청 {req} 을 버린다", flush=True)
            _unlink_if_same(req_path, seen)
            req = None
        if req == "on" and s.phase is Phase.STOPPING:
            req = None                  # 끄는 중의 켜기는 파일에 두고 꺼진 뒤의 단계가 읽는다
        elif req is not None and req not in REQUESTS:
            _unlink_if_same(req_path, seen)
            req = None
        ios = plan(s, self.signals(), self._clock(), L)
        server, switch_error = None, False
        action = "off" if Io.SWITCH_OFF in ios else "on" if Io.SWITCH_ON in ios else None
        if action:
            from stt.gpu_switch import SwitchError
            try:
                server = self._switch.call(action)
            except SwitchError as e:
                switch_error = True
                print(f"[failover] 스위치 {action} 실패: {e}", flush=True)
        gpu_ok = self._check(self._gpu) if Io.CHECK_GPU in ios else None
        elice_ok = self._check(self._elice) if Io.CHECK_ELICE in ios else None
        now = self._clock()
        new, notices = step(s, Facts(now=now, mode=self.mode, signals=self.signals(), request=req, server=server,
                                     switch_error=switch_error, gpu_ok=gpu_ok, elice_ok=elice_ok), L)
        # 바뀌지 않아도 첫 tick 에는 쓴다. 없으면 배포 직후 status 가 워커가 돈 적이 없다고 답한다
        if new != s or not self._written:
            try:
                _atomic_write(self.state_dir / STATE_FILE, _dump(new, self.mode, now))
                self._written = True
            except OSError as e:
                # 스위치는 이미 불렸으니 단계는 메모리에서 넘긴다. 못 쓴 파일은 다음 tick 이 다시 쓴다
                self._written = False
                print(f"[failover] 상태 파일을 쓰지 못했다: {type(e).__name__}: {e}", flush=True)
        if req is not None:
            # 확인 호출 동안(최대 30초씩) 새 요청이 같은 이름으로 들어왔을 수 있다. 읽은 그 파일만 지운다
            _unlink_if_same(req_path, seen)
        with self._cond:
            self.state = new
            self._cond.notify_all()
        if new.phase is not s.phase:
            print(f"[failover] {s.phase.value} → {new.phase.value} ({new.why})", flush=True)
        for n in notices:
            print(f"[failover] {n.text}", flush=True)
            try:
                self._notify(n)
            except Exception as e:  # noqa: BLE001 - 알림이 실패해도 전환은 간다
                print(f"[failover] 알림 실패: {type(e).__name__}: {e}", flush=True)
        if new.woken is not None and new.woken != s.woken and self._on_gpu is not None:
            self._on_gpu(new.woken)

    def _check(self, backend) -> bool:
        """확인 호출. 고정 합성음을 프롬프트 없이 보내 글자가 돌아와야 성공이다. 표본에는 넣지 않는다."""
        if self._probe is None:
            self._probe = _probe_audio()
        samples, sr = self._probe
        try:
            return bool(backend.transcribe(samples, sr).text.strip())
        except Exception as e:  # noqa: BLE001 - 어떤 실패든 확인 실패다
            print(f"[failover] 확인 실패({getattr(backend, 'name', '?')}): {type(e).__name__}: {e}", flush=True)
            return False
