"""switch.sh 를 가짜 aws 로 돌린다. 실제 AWS 도, 실제 secrets 폴더도 쓰지 않는다."""
from __future__ import annotations

import json
import os
import shutil
import stat
import subprocess
import zipfile
from pathlib import Path

import pytest

DEPLOY = Path(__file__).resolve().parents[2] / "deploy" / "gpu-stt"
SCRIPT = DEPLOY / "switch.sh"
ACCOUNT = "123456789012"
URL = "https://abc123.lambda-url.ap-northeast-2.on.aws/"
LAUNCHED = "2026-11-06T07:00:00+00:00"
LAUNCHED_EPOCH = 1793948400

pytestmark = pytest.mark.skipif(not (shutil.which("bash") and shutil.which("openssl") and shutil.which("zip")),
                                reason="bash, openssl, zip 이 있어야 돈다")

# create-function 과 update-function-configuration 은 실제 aws 처럼 환경 변수를 그대로 출력한다.
# 스크립트가 출력을 버리지 않으면 토큰이 화면에 나온다
FAKE_AWS = r"""#!/bin/bash
d=$FAKE_AWS_DIR
printf '%s\n' "$*" >>"$d/calls"
env | grep '^AWS_' >"$d/env"
if [ "$1 $2" = "$(cat "$d/fail_next" 2>/dev/null)" ]; then
  rm -f "$d/fail_next"
  echo 'Could not connect to the endpoint URL' >&2
  exit 255
fi
for a in "$@"; do
  case $a in
    file://*) cp "${a#file://}" "$d/env-file"; printf '%s\n' "${a#file://}" >"$d/env-file-path" ;;
    fileb://*) cp "${a#fileb://}" "$d/code.zip" ;;
  esac
done
arg() {
  local want=$1
  shift
  while [ $# -gt 0 ]; do
    [ "$1" = "$want" ] && { printf '%s' "$2"; return; }
    shift
  done
}
missing() {
  echo "An error occurred ($1) when calling the $2 operation: not found" >&2
  exit 254
}
token_from_env_file() {
  sed -n 's/.*"SWITCH_TOKEN": *"\([^"]*\)".*/\1/p' "$d/env-file"
}
case "$1 $2" in
  "ec2 describe-instances") cat "$d/instances" 2>/dev/null || true ;;
  "ssm get-parameter") [ -f "$d/ledger" ] || missing ParameterNotFound GetParameter; cat "$d/ledger" ;;
  "ssm put-parameter") arg --value "$@" >"$d/ledger" ;;
  "iam get-role") [ -f "$d/role" ] || missing NoSuchEntity GetRole; echo "arn:aws:iam::123456789012:role/mm-gpu-switch" ;;
  "iam create-role") arg --assume-role-policy-document "$@" >"$d/role"; echo '{"Role": {"Arn": "arn:aws:iam::123456789012:role/mm-gpu-switch"}}' ;;
  "iam put-role-policy") arg --policy-document "$@" >"$d/policy" ;;
  "lambda get-function") [ -f "$d/function" ] || missing ResourceNotFoundException GetFunction ;;
  "lambda get-function-configuration") cat "$d/function" ;;
  "lambda create-function")
    n=$(cat "$d/assume_fail" 2>/dev/null || echo 0)
    if [ "$n" -gt 0 ]; then
      echo $((n - 1)) >"$d/assume_fail"
      echo 'An error occurred (InvalidParameterValueException) when calling the CreateFunction operation: The role defined for the function cannot be assumed by Lambda.' >&2
      exit 254
    fi
    token_from_env_file >"$d/function"
    cat "$d/env-file" ;;
  "lambda update-function-configuration") token_from_env_file >"$d/function"; cat "$d/env-file" ;;
  "lambda get-function-url-config") [ -f "$d/url" ] || missing ResourceNotFoundException GetFunctionUrlConfig; cat "$d/url" ;;
  "lambda create-function-url-config") echo "https://abc123.lambda-url.ap-northeast-2.on.aws/" | tee "$d/url" ;;
  "lambda get-policy")
    [ -f "$d/permissions" ] || missing ResourceNotFoundException GetPolicy
    printf '{"Version":"2012-10-17","Statement":[%s]}\n' "$(paste -sd, "$d/permissions")" ;;
  "lambda add-permission") printf '{"Sid":"%s"}\n' "$(arg --statement-id "$@")" >>"$d/permissions" ;;
esac
exit 0
"""


class Aws:
    def __init__(self, tmp_path: Path) -> None:
        self.dir = tmp_path / "fake"
        self.dir.mkdir()
        fake_bin = tmp_path / "bin"
        fake_bin.mkdir()
        (fake_bin / "aws").write_text(FAKE_AWS)
        # 역할 전파를 기다리는 재시도가 테스트를 늦추지 않게 한다
        (fake_bin / "sleep").write_text("#!/bin/bash\n")
        for name in ("aws", "sleep"):
            (fake_bin / name).chmod(0o755)
        self.secrets = tmp_path / "secrets"
        self.state = self.secrets / "gpu-stt"
        self.env = {**os.environ, "PATH": f"{fake_bin}{os.pathsep}{os.environ['PATH']}", "FAKE_AWS_DIR": str(self.dir),
                    "GPU_STT_SECRETS": str(self.secrets), "HOME": str(tmp_path), "TZ": "UTC", "AWS_PROFILE": "admin"}
        assert shutil.which("aws", path=self.env["PATH"]) == str(fake_bin / "aws")
        self.standby("stopped")

    def standby(self, *states: str) -> None:
        (self.dir / "instances").write_text("".join(f"{s}\t{LAUNCHED}\n" for s in states))

    def run(self, *args: str, **extra_env: str) -> subprocess.CompletedProcess:
        env = {**self.env, **extra_env}
        return subprocess.run(["bash", str(SCRIPT), *args], env={k: v for k, v in env.items() if v is not None},
                              capture_output=True, text=True, timeout=60)

    def ok(self, *args: str) -> str:
        r = self.run(*args)
        assert r.returncode == 0, r.stderr
        return r.stdout

    def calls(self, prefix: str | None = None) -> list[str]:
        path = self.dir / "calls"
        lines = path.read_text().splitlines() if path.exists() else []
        return [c for c in lines if prefix is None or c.startswith(prefix)]

    def forget_calls(self) -> None:
        (self.dir / "calls").unlink()

    def token(self) -> str:
        return (self.state / "switch.token").read_text().strip()


@pytest.fixture
def aws(tmp_path):
    return Aws(tmp_path)


def mutations(aws) -> list[str]:
    reads = ("describe-", "get-", "wait ")
    return [c for c in aws.calls() if not c.split(" ", 1)[1].startswith(reads)]


def test_setup_without_a_chosen_profile_touches_nothing(aws):
    r = aws.run("setup", AWS_PROFILE=None)
    assert r.returncode != 0 and "AWS_PROFILE" in r.stderr
    assert aws.calls() == []


@pytest.mark.parametrize("args", [(), ("deploy",), ("setup", "x")])
def test_bad_arguments_touch_nothing(aws, args):
    assert aws.run(*args).returncode != 0
    assert aws.calls() == []


def test_the_chosen_profile_is_used_and_stray_keys_are_dropped(aws):
    aws.ok("setup")
    r = aws.run("setup", AWS_ACCESS_KEY_ID="other-account", AWS_SESSION_TOKEN="other")
    assert r.returncode == 0
    env = dict(line.split("=", 1) for line in (aws.dir / "env").read_text().splitlines())
    assert env["AWS_PROFILE"] == "admin" and env["AWS_REGION"] == "ap-northeast-2"
    assert "AWS_ACCESS_KEY_ID" not in env and "AWS_SESSION_TOKEN" not in env


def test_setup_builds_the_switch_with_a_token_only_in_secrets(aws):
    aws.ok("setup")
    token = aws.token()
    assert len(token) == 64 and int(token, 16) >= 0
    assert stat.S_IMODE((aws.state / "switch.token").stat().st_mode) == 0o600
    assert (aws.state / "switch-url").read_text().strip() == URL
    assert (aws.dir / "function").read_text().strip() == token
    assert not Path((aws.dir / "env-file-path").read_text().strip()).exists()
    create = aws.calls("lambda create-function ")[0]
    for part in ("--runtime python3.12", "--handler handler.lambda_handler", "--role arn:aws:iam::", "--timeout 30"):
        assert part in create
    with zipfile.ZipFile(aws.dir / "code.zip") as z:
        assert z.namelist() == ["handler.py"]
        assert z.read("handler.py") == (DEPLOY / "switch" / "handler.py").read_bytes()


def test_the_role_can_only_start_stop_and_tag_the_standby_and_touch_one_parameter(aws):
    aws.ok("setup")
    trust = json.loads((aws.dir / "role").read_text())
    assert trust["Statement"] == [{"Effect": "Allow", "Principal": {"Service": "lambda.amazonaws.com"},
                                   "Action": "sts:AssumeRole"}]
    policy = json.loads((aws.dir / "policy").read_text())
    by_action = {json.dumps(s["Action"]): s for s in policy["Statement"]}
    assert set(by_action) == {'"ec2:DescribeInstances"', '["ec2:StartInstances", "ec2:StopInstances"]',
                              '"ec2:CreateTags"', '["ssm:GetParameter", "ssm:PutParameter"]',
                              '"logs:CreateLogGroup"', '["logs:CreateLogStream", "logs:PutLogEvents"]'}
    assert all(s["Effect"] == "Allow" for s in policy["Statement"])
    assert by_action['"ec2:DescribeInstances"']["Resource"] == "*"
    role_tag = {"StringEquals": {"aws:ResourceTag/Role": "stt-fallback"}}
    assert by_action['["ec2:StartInstances", "ec2:StopInstances"]']["Condition"] == role_tag
    assert by_action['"ec2:CreateTags"']["Condition"] == {
        **role_tag, "ForAllValues:StringEquals": {"aws:TagKeys": ["StopAt"]}, "Null": {"aws:TagKeys": "false"}}
    assert by_action['["ssm:GetParameter", "ssm:PutParameter"]']["Resource"] == \
        "arn:aws:ssm:ap-northeast-2:*:parameter/mm/gpu-stt/ledger"
    group = "arn:aws:logs:ap-northeast-2:*:log-group:/aws/lambda/mm-gpu-switch"
    assert by_action['"logs:CreateLogGroup"']["Resource"] == group
    assert by_action['["logs:CreateLogStream", "logs:PutLogEvents"]']["Resource"] == group + ":*"


def test_concurrency_is_one_before_the_url_exists(aws):
    aws.ok("setup")
    calls = aws.calls()
    concurrency = next(i for i, c in enumerate(calls) if c.startswith("lambda put-function-concurrency"))
    url = next(i for i, c in enumerate(calls) if c.startswith("lambda create-function-url-config"))
    assert concurrency < url and "--reserved-concurrent-executions 1" in calls[concurrency]
    assert "--auth-type NONE" in calls[url]


def test_the_url_is_open_to_anyone_and_the_token_does_the_checking(aws):
    aws.ok("setup")
    adds = aws.calls("lambda add-permission")
    assert len(adds) == 2
    url_perm = next(c for c in adds if "--action lambda:InvokeFunctionUrl" in c)
    invoke_perm = next(c for c in adds if "--action lambda:InvokeFunction " in c)
    assert "--principal *" in url_perm and "--function-url-auth-type NONE" in url_perm
    assert "--principal *" in invoke_perm and "--invoked-via-function-url" in invoke_perm


@pytest.mark.parametrize("state, closed", [("stopped", [LAUNCHED_EPOCH]), ("running", [])])
def test_the_ledger_starts_empty_without_charging_the_setup_boot(aws, state, closed):
    aws.standby(state)
    aws.ok("setup")
    assert json.loads((aws.dir / "ledger").read_text()) == {"used_s": 0, "closed": closed}


def test_setup_twice_keeps_the_token_and_creates_nothing(aws):
    aws.ok("setup")
    token = aws.token()
    aws.forget_calls()
    aws.ok("setup")
    assert aws.token() == token
    assert [c.split(" ", 2)[:2] for c in mutations(aws)] == [["iam", "put-role-policy"],
                                                            ["lambda", "put-function-concurrency"]]


def test_setup_keeps_an_existing_ledger(aws):
    (aws.dir / "ledger").write_text('{"used_s": 3600, "closed": [1]}')
    aws.ok("setup")
    assert aws.calls("ssm put-parameter") == []


def test_a_lost_token_is_replaced_in_the_function_too(aws):
    aws.ok("setup")
    old = aws.token()
    (aws.state / "switch.token").unlink()
    aws.ok("setup")
    assert aws.token() != old and (aws.dir / "function").read_text().strip() == aws.token()
    assert len(aws.calls("lambda update-function-configuration")) == 1


def test_setup_waits_out_role_propagation(aws):
    (aws.dir / "assume_fail").write_text("2")
    aws.ok("setup")
    assert len(aws.calls("lambda create-function ")) == 3


def test_other_create_failures_stop_setup_before_the_url(aws):
    (aws.dir / "assume_fail").write_text("99")
    r = aws.run("setup")
    assert r.returncode != 0 and "cannot be assumed" in r.stderr
    assert aws.calls("lambda create-function-url-config") == []


@pytest.mark.parametrize("lookup, create", [("ssm get-parameter", "ssm put-parameter"),
                                            ("iam get-role", "iam create-role"),
                                            ("lambda get-function", "lambda create-function")])
def test_a_failed_lookup_does_not_look_like_a_missing_resource(aws, lookup, create):
    (aws.dir / "fail_next").write_text(lookup)
    r = aws.run("setup")
    assert r.returncode != 0 and "Could not connect" in r.stderr
    assert aws.calls(create) == []


@pytest.mark.parametrize("states", [(), ("stopped", "running")])
def test_setup_needs_exactly_one_standby_in_this_account(aws, states):
    aws.standby(*states)
    r = aws.run("setup")
    assert r.returncode != 0 and "gpu-stt.sh setup" in r.stderr
    assert mutations(aws) == []
    assert not (aws.state / "switch.token").exists()


def test_no_secret_or_account_id_reaches_the_terminal(aws):
    def check(r):
        assert r.returncode == 0, r.stderr
        printed = r.stdout + r.stderr
        assert aws.token() not in printed and ACCOUNT not in printed and URL not in printed

    check(aws.run("setup"))
    check(aws.run("update"))
    (aws.state / "switch.token").unlink()
    check(aws.run("setup"))


def test_no_account_id_is_written_to_a_file(aws):
    aws.ok("setup")
    assert ACCOUNT not in (aws.dir / "policy").read_text()
    for path in aws.state.rglob("*"):
        assert ACCOUNT not in path.read_text()


def test_update_uploads_only_the_code(aws):
    aws.ok("setup")
    aws.forget_calls()
    aws.ok("update")
    assert [c.split(" ", 2)[:2] for c in mutations(aws)] == [["lambda", "update-function-code"]]
    with zipfile.ZipFile(aws.dir / "code.zip") as z:
        assert z.read("handler.py") == (DEPLOY / "switch" / "handler.py").read_bytes()


def test_update_before_setup_asks_for_setup(aws):
    r = aws.run("update")
    assert r.returncode != 0 and "setup" in r.stderr
    assert mutations(aws) == []
