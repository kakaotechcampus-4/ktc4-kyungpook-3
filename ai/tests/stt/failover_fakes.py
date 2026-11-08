"""GPU 전환 테스트의 대역. 바꿀 수 있는 시계, 단계별 지연을 흉내 내는 스위치, 응답을 고르는 전사기."""

from __future__ import annotations

import threading

import numpy as np

from stt.backend import SttError, SttResult
from stt.failover import ServerView
from stt.gpu_switch import SwitchError

PROBE = np.zeros(32_000, dtype=np.float32)


class Clock:
    def __init__(self, t: float = 1_800_000_000.0) -> None:
        self.t = t

    def __call__(self) -> float:
        return self.t

    def advance(self, s: float) -> None:
        self.t += s


class FakeSwitch:
    """Lambda 계약을 흉내 낸다. 켜기 boot_s 초 뒤 running, 끄기 stop_s 초 뒤 off. used_min 은 끈 세션을 더한다."""

    def __init__(self, clock: Clock, *, boot_s: float = 160.0, stop_s: float = 400.0, cap_min: int = 900) -> None:
        self.clock = clock
        self.boot_s, self.stop_s, self.cap_min = boot_s, stop_s, cap_min
        self.state = "off"
        self.launched_at: float | None = None
        self.stop_at: float | None = None
        self.stopping_since: float | None = None
        self.used_s = 0.0
        self.refuse: str | None = None     # 다음 on 들을 거절할 이유
        self.down = False                  # 스위치 불통
        self.calls: list[str] = []
        self.starts = 0

    def _settle(self) -> None:
        now = self.clock()
        if self.state == "starting" and now - self.launched_at >= self.boot_s:
            self.state = "running"
        if self.state == "stopping" and now - self.stopping_since >= self.stop_s:
            self.state, self.launched_at, self.stop_at = "off", None, None

    def view(self, refused=None) -> ServerView:
        return ServerView(state=self.state, launched_at=self.launched_at, stop_at=self.stop_at, refused=refused,
                          used_min=int(self.used_s // 60), cap_min=self.cap_min)

    def call(self, action: str) -> ServerView:
        self.calls.append(action)
        if self.down:
            raise SwitchError("스위치 요청 실패: ConnectionError")
        self._settle()
        now = self.clock()
        if action == "on":
            if self.state == "stopping":
                return self.view("stopping")
            if self.state == "off":
                if self.used_s >= self.cap_min * 60:
                    return self.view("spent")
                if self.refuse:
                    return self.view(self.refuse)
                self.state, self.launched_at, self.stop_at = "starting", now, now + 3 * 3600
                self.starts += 1
        elif action == "off" and self.state in ("starting", "running"):
            self.used_s += min(now, self.stop_at) - self.launched_at
            self.state, self.stopping_since = "stopping", now
        return self.view()


class FakeBackend:
    """SttBackend 대역. mode 가 ok 면 글자를 돌려주고, 아니면 그 cause 의 SttError. 받은 prompt 를 남긴다."""

    def __init__(self, name: str, text: str = "안녕하세요") -> None:
        self.name = name
        self.text = text
        self.mode = "ok"
        self.prompts: list[str | None] = []
        self.gate: threading.Event | None = None    # 있으면 호출이 이것을 기다린다(진행 중 호출)
        self._lock = threading.Lock()

    def transcribe(self, samples, sample_rate, prompt=None) -> SttResult:
        with self._lock:
            self.prompts.append(prompt)
        if self.gate is not None:
            self.gate.wait(5)
        if self.mode == "ok":
            return SttResult(text=self.text)
        if self.mode == "empty":
            return SttResult(text="")
        raise SttError(f"STT {self.mode}", cause=self.mode)

    @property
    def calls(self) -> int:
        return len(self.prompts)
