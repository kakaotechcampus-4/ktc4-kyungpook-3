"""gpu-stt.sh 를 가짜 aws 로 돌린다. 실제 AWS 도, 네트워크도, 실제 secrets 폴더도 쓰지 않는다."""
from __future__ import annotations

import os
import shutil
import stat
import subprocess
import time
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[2] / "deploy" / "gpu-stt" / "gpu-stt.sh"
PROD_IP = "203.0.113.10"
EIP = "198.51.100.7"
LAUNCHED = "2026-11-05T07:00:00+00:00"
STOP_AT = "1793872800"                 # 2026-11-05 10:00 UTC
ROLE_FILTER = "Name=tag:Role,Values=stt-fallback"

pytestmark = pytest.mark.skipif(not (shutil.which("bash") and shutil.which("openssl")),
                                reason="bash 와 openssl 이 있어야 돈다")

# 태그 필터가 정확하지 않으면 다른 탭의 인스턴스(i-0lora)를 돌려준다. 실수가 곧바로 잘못된 종료로 드러나게 한다
FAKE_AWS = r"""#!/bin/bash
d=$FAKE_AWS_DIR
printf '%s\n' "$*" >>"$d/calls"
env | grep '^AWS_' >"$d/env"
for a in "$@"; do
  case $a in file://*) cp "${a#file://}" "$d/user-data"; printf '%s\n' "${a#file://}" >"$d/user-data-path" ;; esac
done

describe_instances() {
  case " $* " in
    *"Values=g*"*)
      case "$*" in
        *InstanceId,*) printf 'i-0lora\tg4dn.xlarge\tgpu-stt-lora-pilot\n' ;;
        *) printf 'g4dn.xlarge\tg4dn.xlarge\tg5.xlarge\n' ;;
      esac
      return ;;
    *" Name=tag:Role,Values=stt-fallback "*) ;;
    *) echo i-0lora; return ;;
  esac
  want=$(printf '%s\n' "$@" | sed -n 's/^Name=instance-state-name,Values=//p')
  [ -f "$d/instances" ] || return 0
  while read -r id state launched at ready; do
    case ",$want," in
      *",$state,"*)
        case "$*" in
          *State.Name*) printf '%s\t%s\t%s\t%s\t%s\n' "$id" "$state" "$launched" "$at" "${ready:-None}" ;;
          *) echo "$id" ;;
        esac ;;
    esac
  done <"$d/instances"
}

describe_addresses() {
  [ -f "$d/address" ] || return 0
  case "$*" in
    *InstanceId*) printf '%s\ti-0fallback\n' "$(cut -f2 "$d/address")" ;;
    *) cat "$d/address" ;;
  esac
}

describe_groups() {
  case "$*" in
    *--filters*) cat "$d/sg" 2>/dev/null || true ;;
    *to_string*) cat "$d/rules" 2>/dev/null || true ;;
    *) cat "$d/perms" 2>/dev/null || echo '[]' ;;
  esac
}

set_state() {
  [ -f "$d/instances" ] || return 0
  awk -v from="$1" -v to="$2" '$2 == from { $2 = to } { print }' "$d/instances" >"$d/instances.new"
  mv "$d/instances.new" "$d/instances"
}

case $2 in
  describe-instances) describe_instances "$@" ;;
  describe-addresses) describe_addresses "$@" ;;
  describe-security-groups) describe_groups "$@" ;;
  create-security-group) echo sg-0fallback | tee "$d/sg" ;;
  allocate-address) printf 'eipalloc-0fallback\t198.51.100.7\n' | tee "$d/address" ;;
  run-instances)
    if [ -f "$d/vcpu_limit" ]; then
      echo 'An error occurred (VcpuLimitExceeded) when calling the RunInstances operation' >&2
      exit 254
    fi
    printf 'i-0fresh running 2026-11-05T07:00:00+00:00 1793872800\n' >"$d/instances"
    echo i-0fresh ;;
  start-instances)
    if [ -f "$d/vcpu_limit" ]; then
      echo 'An error occurred (VcpuLimitExceeded) when calling the StartInstances operation' >&2
      exit 254
    fi
    if [ -f "$d/no_capacity" ]; then
      echo 'An error occurred (InsufficientInstanceCapacity) when calling the StartInstances operation' >&2
      exit 254
    fi
    set_state stopped running ;;
  stop-instances) [ -f "$d/stuck" ] || set_state running stopped ;;
  wait)
    if [ "$3" = instance-stopped ]; then
      [ ! -e "$(cat "$d/user-data-path" 2>/dev/null)" ] || touch "$d/key-file-outlived-launch"
      if [ -f "$d/wait_error" ]; then
        echo 'Could not connect to the endpoint URL' >&2
        exit 255
      fi
      if [ -f "$d/stuck" ]; then
        echo 'Waiter InstanceStopped failed: Max attempts exceeded' >&2
        exit 255
      fi
      set_state running stopped
    fi ;;
  create-tags)
    case "$*" in
      *Key=Ready,Value=1*)
        awk '{ print $1, $2, $3, $4, 1 }' "$d/instances" >"$d/instances.new"
        mv "$d/instances.new" "$d/instances" ;;
    esac ;;
  terminate-instances) [ -f "$d/stuck" ] || rm -f "$d/instances" ;;
  authorize-security-group-ingress) printf '%s\n' "$*" >"$d/authorized" ;;
  release-address) rm -f "$d/address" ;;
esac
exit 0
"""


class Aws:
    """가짜 aws 의 상태와 호출 기록."""

    def __init__(self, tmp_path: Path) -> None:
        self.dir = tmp_path / "fake"
        self.dir.mkdir()
        fake_bin = tmp_path / "bin"
        fake_bin.mkdir()
        (fake_bin / "aws").write_text(FAKE_AWS)
        (fake_bin / "aws").chmod(0o755)
        self.secrets = tmp_path / "secrets"
        self.secrets.mkdir()
        (self.secrets / "aws-personal-credentials").write_text("[personal]\n")
        self.state = self.secrets / "gpu-stt"
        self.env = {**os.environ, "PATH": f"{fake_bin}{os.pathsep}{os.environ['PATH']}", "FAKE_AWS_DIR": str(self.dir),
                    "GPU_STT_SECRETS": str(self.secrets), "HOME": str(tmp_path), "TZ": "UTC"}
        # 실제 aws 가 불리면 GPU 가 켜진다. 대역이 먼저 잡히는지 돌리기 전에 못 박는다
        assert shutil.which("aws", path=self.env["PATH"]) == str(fake_bin / "aws")

    def run(self, *args: str, **extra_env: str) -> subprocess.CompletedProcess:
        return subprocess.run(["bash", str(SCRIPT), *args], env={**self.env, **extra_env}, capture_output=True,
                              text=True, timeout=60)

    def ok(self, *args: str, **extra_env: str) -> str:
        r = self.run(*args, **extra_env)
        assert r.returncode == 0, r.stderr
        return r.stdout

    def set_instances(self, *rows: str) -> None:
        (self.dir / "instances").write_text("".join(f"{r}\n" for r in rows))

    def calls(self, action: str | None = None) -> list[str]:
        path = self.dir / "calls"
        lines = path.read_text().splitlines() if path.exists() else []
        return [c for c in lines if action is None or c.startswith(f"ec2 {action}")]

    def forget_calls(self) -> None:
        (self.dir / "calls").unlink()

    def user_data(self) -> str:
        return (self.dir / "user-data").read_text()


@pytest.fixture
def aws(tmp_path):
    return Aws(tmp_path)


def standby(aws, state: str = "stopped") -> None:
    """setup 으로 대기 서버를 만든 뒤 호출 기록을 비운다."""
    aws.ok("setup", PROD_IP)
    aws.set_instances(f"i-0fallback {state} {LAUNCHED} {STOP_AT} 1")
    aws.forget_calls()


def test_off_stops_only_what_the_exact_tag_lookup_returned(aws):
    standby(aws, "running")
    aws.ok("off")
    assert [c.split("--instance-ids ")[1] for c in aws.calls("stop-instances")] == ["i-0fallback"]
    assert all(ROLE_FILTER in c for c in aws.calls("describe-instances"))
    assert aws.calls("terminate-instances") == []


def test_off_says_it_takes_400_seconds_and_blocks_on(aws):
    standby(aws, "running")
    out = aws.ok("off")
    assert "약 400초" in out and "on" in out


def test_off_with_the_standby_already_stopped_is_a_quiet_success(aws):
    standby(aws)
    aws.ok("off")
    assert aws.calls("stop-instances") == []


def test_off_waits_for_a_stop_already_under_way(aws):
    standby(aws, "stopping")
    (aws.dir / "stuck").touch()
    r = aws.run("off")
    assert r.returncode != 0 and "i-0fallback" in r.stderr
    assert aws.calls("stop-instances") == []


def test_off_fails_and_names_what_is_still_alive(aws):
    standby(aws, "running")
    (aws.dir / "stuck").touch()
    r = aws.run("off")
    assert r.returncode != 0 and "i-0fallback" in r.stderr


def test_off_keeps_the_elastic_ip(aws):
    standby(aws, "running")
    aws.ok("off")
    assert aws.calls("release-address") == []


def test_on_starts_the_stopped_standby_after_writing_when_to_stop(aws):
    standby(aws)
    before = int(time.time())
    aws.ok("on", "--hours", "5")
    assert aws.calls("run-instances") == []
    assert [c.split("--instance-ids ")[1] for c in aws.calls("start-instances")] == ["i-0fallback"]
    calls = aws.calls()
    tag = next(c for c in calls if c.startswith("ec2 create-tags"))
    assert calls.index(tag) < calls.index(aws.calls("start-instances")[0])
    assert "--resources i-0fallback" in tag
    stop_at = int(tag.split("Key=StopAt,Value=")[1].split()[0])
    assert before + 5 * 3600 <= stop_at <= int(time.time()) + 5 * 3600
    assert "i-0fallback" in aws.calls("associate-address")[0] and "eipalloc-0fallback" in aws.calls("associate-address")[0]


def test_on_reuses_a_running_instance_without_changing_its_stop_time(aws):
    standby(aws, "running")
    out = aws.ok("on", "--hours", "5")
    assert aws.calls("start-instances") == [] and aws.calls("create-tags") == []
    assert "i-0fallback" in aws.calls("associate-address")[0]
    assert "i-0fallback" in out and "--hours" in out


def test_on_during_a_stop_says_when_to_try_again(aws):
    standby(aws, "stopping")
    r = aws.run("on")
    assert r.returncode != 0 and "약 400초" in r.stderr
    assert aws.calls("start-instances") == []


@pytest.mark.parametrize("instances", ["", f"i-0old shutting-down {LAUNCHED} {STOP_AT}"])
def test_on_without_a_standby_asks_for_setup_and_launches_nothing(aws, instances):
    aws.ok("setup", PROD_IP)
    aws.set_instances(*([instances] if instances else []))
    aws.forget_calls()
    r = aws.run("on")
    assert r.returncode != 0 and "setup" in r.stderr
    assert aws.calls("run-instances") == [] and aws.calls("start-instances") == []


def test_setup_leaves_a_tagged_standby_stopped_with_the_ip_attached(aws):
    out = aws.ok("setup", PROD_IP)
    run = aws.calls("run-instances")[0]
    assert "--instance-initiated-shutdown-behavior stop" in run
    assert "InstanceMetadataTags=enabled" in run
    assert "VolumeInitializationRate=300" in run and "DeleteOnTermination=true" in run
    assert "--instance-type g4dn.xlarge" in run and "--security-group-ids sg-0fallback" in run
    for resource in ("instance", "volume"):
        spec = next(w for w in run.split() if w.startswith(f"ResourceType={resource},"))
        assert "{Key=Role,Value=stt-fallback}" in spec and "{Key=Name,Value=gpu-stt-fallback}" in spec
    assert "i-0fresh" in aws.calls("associate-address")[0]
    assert (aws.dir / "instances").read_text().split()[1] == "stopped"
    assert "i-0fresh" in out
    assert "--resources i-0fresh --tags Key=Ready,Value=1" in aws.calls("create-tags")[0]


def test_setup_says_so_when_the_standby_does_not_stop(aws):
    (aws.dir / "stuck").touch()
    r = aws.run("setup", PROD_IP)
    assert r.returncode != 0 and "destroy" in r.stderr


def test_setup_with_a_standby_does_not_launch_another(aws):
    standby(aws)
    aws.ok("setup", PROD_IP)
    assert aws.calls("run-instances") == []


def test_setup_keeps_refusing_a_new_certificate_while_the_standby_has_the_old_one(aws):
    standby(aws)
    before = {n: (aws.state / n).read_text() for n in ("cert.pem", "key.pem", "env")}
    (aws.dir / "address").write_text("eipalloc-0other\t198.51.100.8\n")
    for _ in range(2):
        r = aws.run("setup", PROD_IP)
        assert r.returncode != 0 and "destroy" in r.stderr
    assert aws.calls("run-instances") == []
    assert before == {n: (aws.state / n).read_text() for n in before}


def test_setup_refuses_a_new_api_key_while_the_standby_has_the_old_one(aws):
    standby(aws)
    (aws.state / "api.key").unlink()
    r = aws.run("setup", PROD_IP)
    assert r.returncode != 0 and "destroy" in r.stderr
    assert not (aws.state / "api.key").exists()


def test_destroy_terminates_only_the_exact_tag_and_keeps_the_ip(aws):
    standby(aws)
    aws.ok("destroy")
    assert [c.split("--instance-ids ")[1] for c in aws.calls("terminate-instances")] == ["i-0fallback"]
    assert all(ROLE_FILTER in c for c in aws.calls("describe-instances"))
    assert aws.calls("release-address") == []


def test_destroy_can_release_the_ip_found_by_its_tag(aws):
    standby(aws)
    out = aws.ok("destroy", "--release-ip")
    assert [c.split()[-1] for c in aws.calls("release-address")] == ["eipalloc-0fallback"]
    assert any(ROLE_FILTER in c for c in aws.calls("describe-addresses"))
    assert "고정 IP" in out


def test_destroy_keeps_the_ip_when_the_server_will_not_go(aws):
    standby(aws)
    (aws.dir / "stuck").touch()
    assert aws.run("destroy", "--release-ip").returncode != 0
    assert aws.calls("release-address") == []


def test_destroy_fails_and_names_what_is_still_alive(aws):
    standby(aws)
    (aws.dir / "stuck").touch()
    r = aws.run("destroy")
    assert r.returncode != 0 and "i-0fallback" in r.stderr


def test_on_says_how_to_check_health_from_production(aws):
    standby(aws)
    printed = aws.ok("on")
    assert f"--cacert /etc/mm/gpu-stt-ca.pem https://{EIP}:8000/health" in printed
    assert "-w '%{http_code}\\n'" in printed


def test_user_data_starts_the_timer_before_anything_else(aws):
    aws.ok("setup", PROD_IP)
    assert aws.user_data().splitlines()[:2] == ["#!/bin/bash", "shutdown -h +60"]


class Boot:
    """user-data 를 실제 경로만 임시 폴더로 바꿔 돌린다. 따옴표가 깨지면 인자가 달라진다."""

    def __init__(self, aws, tmp_path) -> None:
        self.aws, self.tmp = aws, tmp_path
        self.root = tmp_path / "opt-m"
        (self.root / "vllm-env" / "bin").mkdir(parents=True)
        self.per_boot_dir = tmp_path / "per-boot"
        self.per_boot_dir.mkdir()
        self.argv = tmp_path / "vllm-argv"
        vllm = self.root / "vllm-env" / "bin" / "vllm"
        vllm.write_text(f'#!/bin/bash\nprintf \'%s\\n\' "HF_HOME=$HF_HOME" "$@" >"{self.argv}.tmp"\nmv "{self.argv}.tmp" "{self.argv}"\n')
        vllm.chmod(0o755)
        self.shutdown_log = tmp_path / "shutdown-log"
        self.stop_at = tmp_path / "stop-at"
        fake_bin = tmp_path / "bin"
        (fake_bin / "shutdown").write_text(f'#!/bin/bash\necho "$*" >>"{self.shutdown_log}"\n')
        (fake_bin / "curl").write_text(
            "#!/bin/bash\n"
            'case "$*" in\n'
            "  *api/token*) echo token ;;\n"
            f'  *tags/instance/StopAt*) cat "{self.stop_at}" ;;\n'
            "  *health*) echo 200 ;;\n"
            "esac\n")
        for name in ("shutdown", "curl"):
            (fake_bin / name).chmod(0o755)

    def localised(self, text: str) -> str:
        return (text.replace("/opt/m", str(self.root)).replace("/var/log/vllm.log", str(self.tmp / "vllm.log"))
                .replace("/var/lib/cloud/scripts/per-boot", str(self.per_boot_dir)))

    def first_boot(self) -> None:
        script = self.tmp / "user-data.sh"
        script.write_text(self.localised(self.aws.user_data()))
        self.stop_at.write_text(str(int(time.time()) + 3600))
        subprocess.run(["bash", str(script)], env=self.aws.env, check=True, timeout=30)
        self.wait_for_server()

    def later_boot(self) -> None:
        self.argv.unlink(missing_ok=True)
        self.shutdown_log.unlink(missing_ok=True)
        script = next(self.per_boot_dir.iterdir())
        assert os.access(script, os.X_OK)
        subprocess.run([str(script)], env=self.aws.env, check=True, timeout=30)
        self.wait_for_server()

    def wait_for_server(self) -> None:
        deadline = time.monotonic() + 10
        while not self.argv.exists() and time.monotonic() < deadline:
            time.sleep(0.05)

    def shutdowns(self) -> list[str]:
        return self.shutdown_log.read_text().splitlines()


@pytest.fixture
def boot(aws, tmp_path):
    aws.ok("setup", PROD_IP)
    return Boot(aws, tmp_path)


def test_first_boot_arranges_files_and_server_then_stops_once_healthy(boot):
    boot.first_boot()
    for name in ("cert.pem", "key.pem", "api.key"):
        written = boot.root / f"fallback-{name}"
        assert written.read_text() == (boot.aws.state / name).read_text()
        assert stat.S_IMODE(written.stat().st_mode) == 0o600
    argv = boot.argv.read_text().splitlines()
    assert argv[:3] == [f"HF_HOME={boot.root}/hf", "serve", "openai/whisper-large-v3"]
    pairs = dict(zip(argv[3:], argv[4:]))
    assert pairs["--host"] == "0.0.0.0" and pairs["--port"] == "8000"
    assert pairs["--served-model-name"] == "openai/whisper-large-v3" and pairs["--dtype"] == "float16"
    assert pairs["--gpu-memory-utilization"] == "0.6" and pairs["--limit-mm-per-prompt"] == '{"audio":1}'
    assert pairs["--api-key"] == (boot.aws.state / "api.key").read_text().strip()
    assert pairs["--ssl-keyfile"] == f"{boot.root}/fallback-key.pem"
    assert pairs["--ssl-certfile"] == f"{boot.root}/fallback-cert.pem"
    shutdowns = boot.shutdowns()
    assert shutdowns[0] == "-h +60" and shutdowns[-1] == "-h now"


def test_later_boots_start_the_server_again_and_stop_at_the_tagged_time(boot):
    boot.first_boot()
    boot.stop_at.write_text(str(int(time.time()) + 5 * 3600))
    boot.later_boot()
    assert boot.argv.exists()
    shutdowns = boot.shutdowns()
    assert shutdowns[0] == "-h +180"
    minutes = int(shutdowns[-1].split("+")[1])
    assert 299 <= minutes <= 301


@pytest.mark.parametrize("tag", ["", "not-a-number", "1"])
def test_later_boots_keep_the_default_timer_when_the_tag_is_unusable(boot, tag):
    boot.first_boot()
    boot.stop_at.write_text(tag)
    boot.later_boot()
    assert boot.argv.exists()
    assert boot.shutdowns() == ["-h +180"]


def test_vcpu_limit_explains_in_korean_and_names_what_is_running(aws):
    standby(aws)
    (aws.dir / "vcpu_limit").touch()
    r = aws.run("on")
    assert r.returncode != 0
    assert "vCPU 한도 8" in r.stderr and "gpu-stt-lora-pilot" in r.stderr
    assert aws.calls("associate-address") == []


def test_setup_explains_the_vcpu_limit_too(aws):
    (aws.dir / "vcpu_limit").touch()
    r = aws.run("setup", PROD_IP)
    assert r.returncode != 0 and "vCPU 한도 8" in r.stderr


def test_a_failed_start_shows_the_aws_error(aws):
    standby(aws)
    (aws.dir / "no_capacity").touch()
    r = aws.run("on")
    assert r.returncode != 0 and "InsufficientInstanceCapacity" in r.stderr
    assert aws.calls("associate-address") == []


def test_on_before_setup_stops_without_starting(aws):
    r = aws.run("on")
    assert r.returncode != 0 and "setup" in r.stderr
    assert aws.calls("start-instances") == []


@pytest.mark.parametrize("args", [("on", "--hours", "0"), ("on", "--hours", "x"), ("on", "3"), ("setup",),
                                  ("setup", "not-an-ip"), ("setup", "203.0.113.310"), ("setup", PROD_IP, "--help"), ("off", "--help"),
                                  ("destroy", "--help"), ("destroy", "--release-ip", "x"), ("status", "--help"), ("reboot",), ()])
def test_bad_arguments_change_nothing(aws, args):
    r = aws.run(*args)
    assert r.returncode != 0
    assert [c for c in aws.calls() if " describe-" not in f" {c}"] == []


def test_on_stops_before_starting_when_the_fixed_ip_is_gone(aws):
    standby(aws)
    (aws.dir / "address").unlink()
    r = aws.run("on")
    assert r.returncode != 0
    assert "setup" in r.stderr
    assert aws.calls("start-instances") == []


def test_no_secret_reaches_the_terminal(aws):
    outputs = [aws.run("setup", PROD_IP)]
    outputs += [aws.run("on"), aws.run("status"), aws.run("off"), aws.run("destroy")]
    api_key = (aws.state / "api.key").read_text().strip()
    pem_body = "".join((aws.state / "key.pem").read_text().splitlines()[1:-1])
    assert api_key in aws.user_data() and (aws.state / "key.pem").read_text() in aws.user_data()
    for r in outputs:
        printed = (r.stdout + r.stderr).replace("\n", "")
        assert api_key not in printed and pem_body[:40] not in printed


def test_setup_keeps_secrets_private(aws):
    aws.ok("setup", PROD_IP)
    for name in ("cert.pem", "key.pem", "api.key", "env"):
        assert stat.S_IMODE((aws.state / name).stat().st_mode) == 0o600


def test_setup_opens_only_the_production_server(aws):
    aws.ok("setup", PROD_IP)
    authorized = (aws.dir / "authorized").read_text()
    assert "--protocol tcp --port 8000" in authorized and f"--cidr {PROD_IP}/32" in authorized


def test_setup_twice_changes_nothing(aws):
    standby(aws)
    (aws.dir / "rules").write_text(f"tcp 8000 8000 {PROD_IP}/32\n")
    before = {n: (aws.state / n).read_text() for n in ("cert.pem", "key.pem", "api.key", "env")}
    aws.ok("setup", PROD_IP)
    changed = [c for c in aws.calls() if not c.startswith("ec2 describe-")]
    assert changed == []
    assert before == {n: (aws.state / n).read_text() for n in before}


def test_setup_with_a_new_production_ip_replaces_the_rule(aws):
    aws.ok("setup", PROD_IP)
    (aws.dir / "rules").write_text(f"tcp 8000 8000 {PROD_IP}/32\n")
    (aws.dir / "perms").write_text('[{"IpProtocol": "tcp"}]\n')
    new_ip = "203.0.113.20"
    cert = (aws.state / "cert.pem").read_text()
    aws.ok("setup", new_ip)
    assert len(aws.calls("revoke-security-group-ingress")) == 1
    assert f"--cidr {new_ip}/32" in (aws.dir / "authorized").read_text()
    assert f"PROD_IP={new_ip}" in (aws.state / "env").read_text().splitlines()
    assert (aws.state / "cert.pem").read_text() == cert


def test_setup_regenerates_the_cert_when_the_ip_changes_but_keeps_the_api_key(aws):
    aws.ok("setup", PROD_IP)
    api_key = (aws.state / "api.key").read_text()
    new_eip = "198.51.100.8"
    (aws.dir / "address").write_text(f"eipalloc-0other\t{new_eip}\n")
    aws.set_instances()
    out = aws.ok("setup", PROD_IP)
    text = subprocess.run(["openssl", "x509", "-in", str(aws.state / "cert.pem"), "-noout", "-text"],
                          capture_output=True, text=True, check=True).stdout
    assert f"IP Address:{new_eip}" in text and "/etc/mm/gpu-stt-ca.pem" in out
    assert (aws.state / "api.key").read_text() == api_key
    assert f"EIP={new_eip}" in (aws.state / "env").read_text().splitlines()


def test_status_shows_instance_terminate_time_ip_and_other_gpu_types(aws):
    aws.ok("setup", PROD_IP)
    aws.set_instances(f"i-0fallback running {LAUNCHED} {STOP_AT}")
    out = aws.ok("status")
    assert "i-0fallback running" in out and LAUNCHED in out
    assert "2026-11-05 10:00" in out
    assert f"고정 IP {EIP} 연결: i-0fallback" in out
    lines = {" ".join(line.split()) for line in out.splitlines()}
    assert "2 g4dn.xlarge" in lines and "1 g5.xlarge" in lines
    assert "gpu-stt-lora-pilot" not in out and "i-0lora" not in out


def test_status_shows_a_stopped_standby_without_a_stale_stop_time(aws):
    standby(aws)
    out = aws.ok("status")
    assert "i-0fallback stopped 꺼 둠" in out
    assert "2026-11-05 10:00" not in out


def test_status_warns_that_a_stopping_server_cannot_be_started_yet(aws):
    standby(aws, "stopping")
    assert "약 400초" in aws.ok("status")


def test_status_with_nothing_on_says_zero(aws):
    assert "인스턴스 0대" in aws.ok("status")


def test_script_uses_the_personal_profile_and_drops_keys_from_the_shell(aws):
    aws.ok("status", AWS_ACCESS_KEY_ID="other-account", AWS_SESSION_TOKEN="other-token")
    env = dict(line.split("=", 1) for line in (aws.dir / "env").read_text().splitlines())
    assert env["AWS_SHARED_CREDENTIALS_FILE"] == f"{aws.secrets}/aws-personal-credentials"
    assert env["AWS_CONFIG_FILE"] == "/dev/null" and env["AWS_PROFILE"] == "personal"
    assert env["AWS_REGION"] == "ap-northeast-2"
    assert "AWS_ACCESS_KEY_ID" not in env and "AWS_SESSION_TOKEN" not in env


def test_setup_removes_the_key_file_before_waiting_for_first_boot(aws):
    aws.ok("setup", PROD_IP)
    assert not (aws.dir / "key-file-outlived-launch").exists()


@pytest.mark.parametrize("state", ["running", "stopped"])
def test_on_refuses_a_standby_that_never_finished_first_boot(aws, state):
    aws.ok("setup", PROD_IP)
    aws.set_instances(f"i-0half {state} {LAUNCHED} {STOP_AT}")
    aws.forget_calls()
    r = aws.run("on")
    assert r.returncode != 0 and "destroy" in r.stderr and "setup" in r.stderr
    assert aws.calls("start-instances") == []


def test_setup_resumes_waiting_for_a_first_boot_still_running(aws):
    aws.ok("setup", PROD_IP)
    aws.set_instances(f"i-0half running {LAUNCHED} {STOP_AT}")
    aws.forget_calls()
    aws.ok("setup", PROD_IP)
    assert aws.calls("run-instances") == []
    assert "--resources i-0half --tags Key=Ready,Value=1" in aws.calls("create-tags")[0]


def test_setup_refuses_a_stopped_standby_that_never_finished_first_boot(aws):
    aws.ok("setup", PROD_IP)
    aws.set_instances(f"i-0half stopped {LAUNCHED} {STOP_AT}")
    aws.forget_calls()
    r = aws.run("setup", PROD_IP)
    assert r.returncode != 0 and "destroy" in r.stderr
    assert aws.calls("create-tags") == [] and aws.calls("run-instances") == []


def test_setup_shows_a_wait_error_and_does_not_tell_to_destroy(aws):
    (aws.dir / "wait_error").touch()
    r = aws.run("setup", PROD_IP)
    assert r.returncode != 0
    assert "Could not connect" in r.stderr and "destroy" not in r.stderr
    assert len([c for c in aws.calls() if c.startswith("ec2 wait instance-stopped")]) == 1
    assert aws.calls("create-tags") == []


def test_missing_credentials_file_stops_before_any_aws_call(aws):
    (aws.secrets / "aws-personal-credentials").unlink()
    r = aws.run("off")
    assert r.returncode != 0 and aws.calls() == []
