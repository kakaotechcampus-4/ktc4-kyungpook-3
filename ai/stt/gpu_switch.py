"""GPU 대기 서버의 켜기·끄기 스위치(개인 AWS 의 Lambda 함수 URL) 클라이언트.

  POST <GPU_SWITCH_URL>   Authorization: Bearer <GPU_SWITCH_TOKEN>
  요청 {"action": "on" | "off" | "status"}
  200  {"state", "launched_at", "stop_at", "refused", "used_min", "cap_min"}   401 토큰 틀림

운영 서버에는 이 URL 과 토큰만 둔다. 개인 AWS 키를 두지 않는다. 계약은 .work/design.md 의 확정 절과
deploy/gpu-stt/ 의 Lambda 가 같이 따른다. 응답은 ServerView 로 바꾸고 모르는 모양은 SwitchError 다.
"""

from __future__ import annotations

import requests

from stt.failover import ServerView

STATES = {"off", "starting", "running", "stopping"}
REFUSALS = {None, "limit", "capacity", "spent", "not_ready", "stopping"}


class SwitchError(RuntimeError):
    pass


class GpuSwitch:
    def __init__(self, url: str, token: str, *, timeout: float = 15.0, ca_bundle: str | None = None) -> None:
        self.url = url
        self.token = token
        self.timeout = timeout
        self.ca_bundle = ca_bundle      # 테스트의 자체 서명 서버용. 운영의 함수 URL 은 공인 인증서다

    def call(self, action: str) -> ServerView:
        if not self.url.startswith("https://"):
            raise SwitchError("GPU_SWITCH_URL 은 https:// 로 시작해야 합니다.")
        try:
            r = requests.post(self.url, json={"action": action}, timeout=self.timeout,
                              headers={"Authorization": f"Bearer {self.token}"}, verify=self.ca_bundle or True)
        except requests.RequestException as e:
            # 예외 이름만 싣는다. 메시지에 헤더가 붙으면 토큰이 로그로 나간다
            raise SwitchError(f"스위치 요청 실패: {type(e).__name__}") from e
        if r.status_code != 200:
            raise SwitchError(f"스위치 {r.status_code}")
        try:
            j = r.json()
            view = ServerView(state=j["state"], launched_at=_ts(j.get("launched_at")), stop_at=_ts(j.get("stop_at")),
                              refused=j.get("refused"), used_min=int(j.get("used_min") or 0),
                              cap_min=int(j.get("cap_min") or 0))
        except (ValueError, KeyError, TypeError, AttributeError) as e:
            raise SwitchError("스위치 응답을 읽지 못함") from e
        if view.state not in STATES or view.refused not in REFUSALS:
            raise SwitchError("스위치 응답을 읽지 못함")
        return view


def _ts(v) -> float | None:
    return None if v is None else float(v)
