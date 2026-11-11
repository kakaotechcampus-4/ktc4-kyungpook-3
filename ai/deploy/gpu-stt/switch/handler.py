"""GPU 전사 대기 서버의 켜기·끄기·상태만 하는 스위치. 개인 AWS 의 Lambda 함수 URL 로 운영 워커가 부른다.

운영 서버에 개인 키를 두지 않으려고 만들었다. 이 함수의 역할은 Role=stt-fallback 인스턴스의 start, stop,
StopAt 태그와 장부 파라미터 하나만 건드릴 수 있다. 만드는 법은 ../switch.sh 다.

    POST <함수 URL>   Authorization: Bearer <토큰>   {"action": "on" | "off" | "status"}
    200 {"state": "off"|"starting"|"running"|"stopping", "launched_at": int|null, "stop_at": int|null,
         "refused": null|"limit"|"capacity"|"spent"|"not_ready"|"stopping", "used_min": int, "cap_min": int}
    400 action 이 틀림, 401 토큰이 틀림(본문 없음), 500 Role=stt-fallback 인스턴스가 정확히 1대가 아님

on 은 StopAt=now+3시간을 쓴 뒤 start 하고, 누적 사용이 CAP_MIN 분 이상이면 spent 로 거절한다. 세션은
launched_at 으로 장부에 한 번만 더한다. 워커 쪽 클라이언트는 ai/stt/gpu_switch.py 다.
"""
from __future__ import annotations

import base64
import hmac
import json
import os
import time
from dataclasses import dataclass

LEDGER = "/mm/gpu-stt/ledger"
SESSION_S = 3 * 3600
KEEP_CLOSED = 20
STATES = {"pending": "starting", "running": "running", "stopping": "stopping", "stopped": "off"}
REFUSED_START = {"VcpuLimitExceeded": "limit", "InsufficientInstanceCapacity": "capacity"}


@dataclass
class Instance:
    id: str
    state: str
    launched_at: int | None
    stop_at: int | None
    ready: bool


@dataclass
class Ledger:
    used_s: float
    closed: list[int]


def _code(error: Exception) -> str | None:
    return (getattr(error, "response", None) or {}).get("Error", {}).get("Code")


def _respond(status: int, body: dict | None = None) -> dict:
    if body is None:
        return {"statusCode": status}
    return {"statusCode": status, "headers": {"content-type": "application/json"}, "body": json.dumps(body)}


def _standby(ec2) -> Instance | None:
    # 필터 값의 * 는 와일드카드다. 정확한 값만 넘겨 다른 작업의 gpu-stt-* 인스턴스를 잡지 않는다.
    # 지운 인스턴스는 한 시간쯤 terminated 로 보여서 상태로 거르지 않으면 destroy 뒤 setup 이 2대로 보인다
    found = [i for r in ec2.describe_instances(Filters=[
        {"Name": "tag:Role", "Values": ["stt-fallback"]},
        {"Name": "instance-state-name", "Values": list(STATES)},
    ])["Reservations"] for i in r["Instances"]]
    if len(found) != 1:
        return None
    raw = found[0]
    tags = {t["Key"]: t["Value"] for t in raw.get("Tags", [])}
    stop_at = tags.get("StopAt", "")
    return Instance(id=raw["InstanceId"], state=raw["State"]["Name"], launched_at=int(raw["LaunchTime"].timestamp()),
                    stop_at=int(stop_at) if stop_at.isdigit() else None, ready=tags.get("Ready") == "1")


def _load(ssm) -> Ledger:
    try:
        value = json.loads(ssm.get_parameter(Name=LEDGER)["Parameter"]["Value"])
    except Exception as e:
        if _code(e) != "ParameterNotFound":
            raise
        return Ledger(0.0, [])
    return Ledger(float(value["used_s"]), [int(x) for x in value["closed"]])


def _save(ssm, ledger: Ledger) -> None:
    ssm.put_parameter(Name=LEDGER, Value=json.dumps({"used_s": ledger.used_s, "closed": ledger.closed}),
                      Type="String", Overwrite=True)


def _settle(ledger: Ledger, inst: Instance, now: int) -> bool:
    """세션 하나를 장부에 한 번만 더한다. 실제로 꺼진 시각을 모르니 StopAt 까지로 본다(넘치게 센다)."""
    if inst.launched_at in ledger.closed:
        return False
    end = now if inst.stop_at is None else min(now, inst.stop_at)
    ledger.used_s += max(0, end - inst.launched_at)
    ledger.closed = (ledger.closed + [inst.launched_at])[-KEEP_CLOSED:]
    return True


def _view(inst: Instance, ledger: Ledger, cap_min: int, refused: str | None = None) -> dict:
    off = inst.state == "stopped"
    return {"state": STATES[inst.state], "launched_at": None if off else inst.launched_at,
            "stop_at": None if off else inst.stop_at, "refused": refused,
            "used_min": int(ledger.used_s // 60), "cap_min": cap_min}


def _on(ec2, ssm, inst: Instance, ledger: Ledger, now: int, cap_min: int) -> dict:
    if inst.state in ("pending", "running"):
        return _view(inst, ledger, cap_min)
    if _settle(ledger, inst, now):
        _save(ssm, ledger)
    if inst.state == "stopping":
        return _view(inst, ledger, cap_min, "stopping")
    if not inst.ready:
        return _view(inst, ledger, cap_min, "not_ready")
    if ledger.used_s >= cap_min * 60:
        return _view(inst, ledger, cap_min, "spent")
    # 부팅 스크립트가 이 태그로 종료 시각을 정한다. start 뒤에 쓰면 옛 값을 읽을 수 있다
    ec2.create_tags(Resources=[inst.id], Tags=[{"Key": "StopAt", "Value": str(now + SESSION_S)}])
    try:
        ec2.start_instances(InstanceIds=[inst.id])
    except Exception as e:
        if _code(e) not in REFUSED_START:
            raise
        return _view(inst, ledger, cap_min, REFUSED_START[_code(e)])
    fresh = _standby(ec2)
    # 바로 다음 조회가 아직 stopped 를 돌려줄 수 있다. 그대로 내면 켜기가 조용히 실패한 것처럼 보인다.
    # 켠 시각은 아직 모르니 비운다. 지어 내면 다음 응답의 실제 LaunchTime 과 달라 워커가 부팅 한 번을 두 번 센다
    if fresh is None or fresh.state not in ("pending", "running"):
        fresh = Instance(inst.id, "pending", None, now + SESSION_S, inst.ready)
    return _view(fresh, ledger, cap_min)


def _off(ec2, ssm, inst: Instance, ledger: Ledger, now: int, cap_min: int) -> dict:
    # stop 을 먼저 한다. 장부 쓰기가 실패하면 다음 호출이 더하지만, 장부를 먼저 닫고 stop 이 실패하면 덜 센다
    if inst.state in ("pending", "running"):
        try:
            ec2.stop_instances(InstanceIds=[inst.id])
        except Exception as e:
            # 막 켠 pending 은 끌 수 없을 수 있다. 지금 상태를 돌려주면 부른 쪽이 잠시 뒤 다시 부른다
            if _code(e) != "IncorrectInstanceState":
                raise
            return _view(inst, ledger, cap_min)
        inst = _standby(ec2) or inst
    if _settle(ledger, inst, now):
        _save(ssm, ledger)
    return _view(inst, ledger, cap_min)


ACTIONS = {"on": _on, "off": _off, "status": lambda ec2, ssm, inst, ledger, now, cap_min: _view(inst, ledger, cap_min)}


def _authorized(event: dict, token: str) -> bool:
    # 환경 변수가 비면 "Bearer " 만 보낸 요청이 통과하지 않게 먼저 막는다
    if not token:
        return False
    given = (event.get("headers") or {}).get("authorization", "")
    return hmac.compare_digest(given.encode(), f"Bearer {token}".encode())


def _action(event: dict) -> str | None:
    body = event.get("body") or ""
    try:
        if event.get("isBase64Encoded"):
            body = base64.b64decode(body).decode()
        action = json.loads(body).get("action")
    except (ValueError, AttributeError):
        return None
    return action if action in ACTIONS else None


def lambda_handler(event, context, *, ec2=None, ssm=None, now=None):
    if not _authorized(event, os.environ.get("SWITCH_TOKEN", "")):
        return _respond(401)
    action = _action(event)
    if action is None:
        return _respond(400, {"error": "action 은 on, off, status 중 하나"})
    if ec2 is None or ssm is None:
        import boto3

        ec2, ssm = boto3.client("ec2"), boto3.client("ssm")
    inst = _standby(ec2)
    if inst is None:
        return _respond(500, {"error": "Role=stt-fallback 인스턴스가 정확히 1대가 아니다"})
    now = int(time.time() if now is None else now)
    cap_min = int(os.environ.get("CAP_MIN", "900"))
    return _respond(200, ACTIONS[action](ec2, ssm, inst, _load(ssm), now, cap_min))
