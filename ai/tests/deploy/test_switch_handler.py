"""GPU 스위치 Lambda 를 가짜 EC2·SSM 으로 돌린다. 실제 AWS 를 부르지 않는다. 계약은 deploy/gpu-stt/switch/handler.py 상단."""
from __future__ import annotations

import base64
import copy
import importlib.util
import json
import sys
from datetime import datetime, timezone
from fnmatch import fnmatchcase
from pathlib import Path

import pytest

HANDLER = Path(__file__).resolve().parents[2] / "deploy" / "gpu-stt" / "switch" / "handler.py"
_spec = importlib.util.spec_from_file_location("gpu_switch_handler", HANDLER)
switch = importlib.util.module_from_spec(_spec)
sys.modules[_spec.name] = switch
_spec.loader.exec_module(switch)

TOKEN = "tok-for-tests"
NOW = 1_793_000_000
HOUR = 3600
LEDGER = "/mm/gpu-stt/ledger"


class AwsError(Exception):
    """botocore ClientError 처럼 response 에 오류 코드를 싣는다."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.response = {"Error": {"Code": code}}


def instance(id_: str, state: str, *, role: str | None = "stt-fallback", launched: int = NOW - HOUR,
             stop_at: int | None = None, ready: str | None = "1") -> dict:
    tags = [{"Key": "Name", "Value": "gpu-stt-fallback"}]
    if role is not None:
        tags.append({"Key": "Role", "Value": role})
    if stop_at is not None:
        tags.append({"Key": "StopAt", "Value": str(stop_at)})
    if ready is not None:
        tags.append({"Key": "Ready", "Value": ready})
    return {"InstanceId": id_, "State": {"Name": state}, "Tags": tags,
            "LaunchTime": datetime.fromtimestamp(launched, tz=timezone.utc)}


class FakeEc2:
    """EC2 처럼 필터 값의 * 와 ? 를 와일드카드로, 태그 값은 대소문자를 가려 맞춘다."""

    def __init__(self, *instances: dict, clock: int = NOW) -> None:
        self.instances = list(instances)
        self.clock = clock
        self.calls: list[tuple] = []
        self.start_error: str | None = None
        self.stop_error: str | None = None
        self.lagging = False

    def _get(self, id_: str) -> dict:
        return next(i for i in self.instances if i["InstanceId"] == id_)

    def describe_instances(self, Filters):
        self.calls.append(("describe",))
        found = []
        for inst in self.instances:
            tags = {t["Key"]: t["Value"] for t in inst["Tags"]}
            ok = True
            for f in Filters:
                if f["Name"].startswith("tag:"):
                    value = tags.get(f["Name"][4:])
                elif f["Name"] == "instance-state-name":
                    value = inst["State"]["Name"]
                else:
                    raise AssertionError(f"모르는 필터 {f['Name']}")
                ok = ok and value is not None and any(fnmatchcase(value, v) for v in f["Values"])
            if ok:
                found.append(copy.deepcopy(inst))
        return {"Reservations": [{"Instances": found}]}

    def create_tags(self, Resources, Tags):
        self.calls.append(("create_tags", tuple(Resources), tuple((t["Key"], t["Value"]) for t in Tags)))
        for id_ in Resources:
            inst = self._get(id_)
            for t in Tags:
                inst["Tags"] = [x for x in inst["Tags"] if x["Key"] != t["Key"]] + [dict(t)]

    def start_instances(self, InstanceIds):
        self.calls.append(("start", tuple(InstanceIds)))
        if self.start_error:
            raise AwsError(self.start_error)
        if self.lagging:
            return
        for id_ in InstanceIds:
            inst = self._get(id_)
            inst["State"]["Name"] = "pending"
            inst["LaunchTime"] = datetime.fromtimestamp(self.clock, tz=timezone.utc)

    def stop_instances(self, InstanceIds):
        self.calls.append(("stop", tuple(InstanceIds)))
        if self.stop_error:
            raise AwsError(self.stop_error)
        for id_ in InstanceIds:
            self._get(id_)["State"]["Name"] = "stopping"

    def changes(self) -> list[tuple]:
        return [c for c in self.calls if c[0] != "describe"]


class FakeSsm:
    def __init__(self, ledger: dict | None = None) -> None:
        self.value = None if ledger is None else json.dumps(ledger)
        self.puts = 0

    def get_parameter(self, Name):
        assert Name == LEDGER
        if self.value is None:
            raise AwsError("ParameterNotFound")
        return {"Parameter": {"Name": Name, "Value": self.value}}

    def put_parameter(self, Name, Value, Type, Overwrite):
        assert Name == LEDGER and Type == "String" and Overwrite is True
        self.value = Value
        self.puts += 1

    @property
    def ledger(self) -> dict:
        return json.loads(self.value)


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setenv("SWITCH_TOKEN", TOKEN)
    monkeypatch.delenv("CAP_MIN", raising=False)


def call(ec2, ssm, action="on", *, now=NOW, token=TOKEN, body=None, b64=False):
    raw = json.dumps({"action": action}) if body is None else body
    event = {"headers": {"authorization": f"Bearer {token}"} if token is not None else {},
             "body": base64.b64encode(raw.encode()).decode() if b64 else raw, "isBase64Encoded": b64}
    r = switch.lambda_handler(event, None, ec2=ec2, ssm=ssm, now=now)
    if r["statusCode"] == 200:
        r["json"] = json.loads(r["body"])
    return r


@pytest.mark.parametrize("token", ["wrong", "", None, TOKEN + "x"])
def test_a_wrong_token_gets_401_with_no_body_and_touches_nothing(token):
    ec2, ssm = FakeEc2(instance("i-0fallback", "stopped")), FakeSsm()
    r = call(ec2, ssm, token=token, body="not json")
    assert r["statusCode"] == 401 and not r.get("body")
    assert ec2.calls == [] and ssm.puts == 0


def test_an_empty_token_in_the_environment_lets_nobody_in(monkeypatch):
    monkeypatch.setenv("SWITCH_TOKEN", "")
    ec2 = FakeEc2(instance("i-0fallback", "stopped"))
    r = call(ec2, FakeSsm(), token="")
    assert r["statusCode"] == 401 and ec2.calls == []


@pytest.mark.parametrize("body", ["not json", json.dumps({"action": "reboot"}), json.dumps(["on"])])
def test_a_bad_request_with_the_right_token_is_400_and_changes_nothing(body):
    ec2 = FakeEc2(instance("i-0fallback", "stopped"))
    r = call(ec2, FakeSsm(), body=body)
    assert r["statusCode"] == 400 and ec2.changes() == []


def test_on_writes_stop_at_three_hours_ahead_before_starting():
    ec2, ssm = FakeEc2(instance("i-0fallback", "stopped", launched=NOW - 10 * HOUR, stop_at=NOW - 7 * HOUR)), FakeSsm()
    r = call(ec2, ssm)
    assert ec2.changes() == [("create_tags", ("i-0fallback",), (("StopAt", str(NOW + 3 * HOUR)),)),
                             ("start", ("i-0fallback",))]
    assert r["json"] == {"state": "starting", "launched_at": NOW, "stop_at": NOW + 3 * HOUR, "refused": None,
                         "used_min": 180, "cap_min": 900}


def test_a_base64_body_from_the_function_url_is_read():
    ec2 = FakeEc2(instance("i-0fallback", "stopped"))
    r = call(ec2, FakeSsm(), action="status", b64=True)
    assert r["json"]["state"] == "off"


@pytest.mark.parametrize("ready", [None, "0", "true"])
def test_on_refuses_a_standby_that_never_finished_setup(ready):
    ec2 = FakeEc2(instance("i-0fallback", "stopped", ready=ready))
    r = call(ec2, FakeSsm())
    assert r["json"]["refused"] == "not_ready" and r["json"]["state"] == "off"
    assert ec2.changes() == []


def test_only_the_exact_role_tag_counts():
    ec2 = FakeEc2(instance("i-0lora", "stopped", role="stt-fallback-lora"),
                  instance("i-0upper", "stopped", role="STT-FALLBACK"),
                  instance("i-0none", "stopped", role=None),
                  instance("i-0fallback", "stopped"),
                  instance("i-0gone", "terminated"))
    call(ec2, FakeSsm())
    assert [c[1] for c in ec2.changes()] == [("i-0fallback",), ("i-0fallback",)]


@pytest.mark.parametrize("instances", [[], [instance("i-0a", "stopped"), instance("i-0b", "running")],
                                       [instance("i-0lora", "running", role="stt-fallback-lora")]])
@pytest.mark.parametrize("action", ["on", "off", "status"])
def test_zero_or_two_standbys_is_an_error_and_nothing_is_touched(instances, action):
    ec2 = FakeEc2(*instances)
    r = call(ec2, FakeSsm(), action=action)
    assert r["statusCode"] == 500 and ec2.changes() == []


def test_on_is_refused_once_the_cap_is_spent():
    ec2, ssm = FakeEc2(instance("i-0fallback", "stopped")), FakeSsm({"used_s": 900 * 60, "closed": [NOW - HOUR]})
    r = call(ec2, ssm)
    assert r["json"]["refused"] == "spent" and r["json"]["used_min"] == 900
    assert ec2.changes() == []


def test_the_cap_comes_from_the_environment(monkeypatch):
    monkeypatch.setenv("CAP_MIN", "60")
    ec2 = FakeEc2(instance("i-0fallback", "stopped"))
    r = call(ec2, FakeSsm({"used_s": 59 * 60, "closed": [NOW - HOUR]}))
    assert r["json"]["refused"] is None and r["json"]["cap_min"] == 60
    ec2 = FakeEc2(instance("i-0fallback", "stopped"))
    r = call(ec2, FakeSsm({"used_s": 60 * 60, "closed": [NOW - HOUR]}))
    assert r["json"]["refused"] == "spent"


def test_the_session_that_spends_the_cap_is_counted_before_the_check():
    ec2 = FakeEc2(instance("i-0fallback", "stopped", launched=NOW - 4 * HOUR, stop_at=NOW - HOUR))
    ssm = FakeSsm({"used_s": 13 * HOUR, "closed": []})
    r = call(ec2, ssm)
    assert r["json"]["refused"] == "spent" and ssm.ledger["used_s"] == 16 * HOUR
    assert ec2.changes() == []


@pytest.mark.parametrize("code, refused", [("VcpuLimitExceeded", "limit"),
                                           ("InsufficientInstanceCapacity", "capacity")])
def test_start_failures_map_to_their_refusal(code, refused):
    ec2 = FakeEc2(instance("i-0fallback", "stopped"))
    ec2.start_error = code
    r = call(ec2, FakeSsm())
    assert r["statusCode"] == 200 and r["json"]["refused"] == refused and r["json"]["state"] == "off"


def test_an_unknown_start_failure_is_not_reported_as_a_refusal():
    ec2 = FakeEc2(instance("i-0fallback", "stopped"))
    ec2.start_error = "UnauthorizedOperation"
    with pytest.raises(AwsError):
        call(ec2, FakeSsm())


def test_on_while_stopping_is_refused_without_starting():
    ec2 = FakeEc2(instance("i-0fallback", "stopping", stop_at=NOW + HOUR))
    r = call(ec2, FakeSsm())
    assert r["json"]["refused"] == "stopping" and r["json"]["state"] == "stopping"
    assert ec2.changes() == []


@pytest.mark.parametrize("ec2_state, state", [("pending", "starting"), ("running", "running")])
def test_on_while_up_changes_nothing_and_reports_the_session(ec2_state, state):
    ec2, ssm = FakeEc2(instance("i-0fallback", ec2_state, launched=NOW - HOUR, stop_at=NOW + 2 * HOUR)), FakeSsm()
    r = call(ec2, ssm)
    assert ec2.changes() == [] and ssm.puts == 0
    assert r["json"] == {"state": state, "launched_at": NOW - HOUR, "stop_at": NOW + 2 * HOUR, "refused": None,
                         "used_min": 0, "cap_min": 900}


def test_off_stops_and_counts_the_session_once_even_if_called_twice():
    ec2 = FakeEc2(instance("i-0fallback", "running", launched=NOW - HOUR, stop_at=NOW + 2 * HOUR))
    ssm = FakeSsm({"used_s": 0, "closed": []})
    r = call(ec2, ssm, action="off")
    assert ec2.changes() == [("stop", ("i-0fallback",))]
    assert r["json"]["state"] == "stopping" and r["json"]["used_min"] == 60
    r = call(ec2, ssm, action="off", now=NOW + 120)
    assert ec2.changes() == [("stop", ("i-0fallback",))]
    assert ssm.ledger == {"used_s": HOUR, "closed": [NOW - HOUR]} and r["json"]["used_min"] == 60


def test_off_counts_no_more_than_up_to_stop_at():
    ec2 = FakeEc2(instance("i-0fallback", "stopped", launched=NOW - 5 * HOUR, stop_at=NOW - 2 * HOUR))
    ssm = FakeSsm({"used_s": 0, "closed": []})
    call(ec2, ssm, action="off")
    assert ec2.changes() == [] and ssm.ledger["used_s"] == 3 * HOUR


def test_on_counts_a_previous_session_nobody_closed():
    ec2 = FakeEc2(instance("i-0fallback", "stopped", launched=NOW - 6 * HOUR, stop_at=NOW - 3 * HOUR))
    ssm = FakeSsm({"used_s": HOUR, "closed": [NOW - 20 * HOUR]})
    r = call(ec2, ssm)
    assert ssm.ledger == {"used_s": 4 * HOUR, "closed": [NOW - 20 * HOUR, NOW - 6 * HOUR]}
    assert r["json"]["used_min"] == 240 and r["json"]["state"] == "starting"


def test_a_missing_ledger_starts_empty():
    ec2, ssm = FakeEc2(instance("i-0fallback", "running", launched=NOW - HOUR, stop_at=NOW + HOUR)), FakeSsm()
    call(ec2, ssm, action="off")
    assert ssm.ledger == {"used_s": HOUR, "closed": [NOW - HOUR]}


def test_the_ledger_keeps_only_the_last_20_sessions():
    old = [NOW - (100 - i) * HOUR for i in range(20)]
    ec2 = FakeEc2(instance("i-0fallback", "running", launched=NOW - HOUR, stop_at=NOW + HOUR))
    ssm = FakeSsm({"used_s": 0, "closed": old})
    call(ec2, ssm, action="off")
    assert ssm.ledger["closed"] == old[1:] + [NOW - HOUR]


def test_status_reports_without_writing():
    ec2 = FakeEc2(instance("i-0fallback", "stopped", launched=NOW - 6 * HOUR, stop_at=NOW - 3 * HOUR))
    ssm = FakeSsm({"used_s": 90 * 60 + 30, "closed": []})
    r = call(ec2, ssm, action="status")
    assert r["json"] == {"state": "off", "launched_at": None, "stop_at": None, "refused": None,
                         "used_min": 90, "cap_min": 900}
    assert ec2.changes() == [] and ssm.puts == 0


def test_a_start_the_next_lookup_does_not_see_yet_still_reads_as_starting():
    ec2 = FakeEc2(instance("i-0fallback", "stopped"))
    ec2.lagging = True
    r = call(ec2, FakeSsm())
    assert r["json"]["state"] == "starting" and r["json"]["stop_at"] == NOW + 3 * HOUR
    assert r["json"]["refused"] is None


def test_off_that_ec2_cannot_do_yet_reports_the_state_without_counting():
    ec2 = FakeEc2(instance("i-0fallback", "pending", launched=NOW - 20, stop_at=NOW + 3 * HOUR))
    ec2.stop_error = "IncorrectInstanceState"
    ssm = FakeSsm({"used_s": 0, "closed": []})
    r = call(ec2, ssm, action="off")
    assert r["statusCode"] == 200 and r["json"]["state"] == "starting" and ssm.puts == 0
