"""Deployment activation fixtures never contact a backend or model provider."""

import importlib.util
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest


SCRIPT = Path(__file__).resolve().parents[3] / "deploy" / "enable-summary.py"
SPEC = importlib.util.spec_from_file_location("summary_activation", SCRIPT)
activation = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = activation
SPEC.loader.exec_module(activation)
SECRET = "fixture-secret-DO-NOT-LOG"


class FixtureRuntime(activation.Runtime):
    def __init__(self, root):
        super().__init__(root / "systemd" / "90-summary.conf", root / "proc")
        self.state = {
            "LoadState": "loaded", "UnitFileState": "enabled",
            "ActiveState": "active", "MainPID": "100",
            "ExecMainStartTimestampMonotonic": "1000000",
        }
        self.events = []
        self.global_off = False
        self.missing_key = False
        self.environment_file_override = False
        self.marker = True
        self.marker_timestamp = None
        self.runner = True
        self.same_pid = False
        self.create_process(100, "")

    def create_process(self, pid, selector):
        directory = self.proc / str(pid)
        directory.mkdir(parents=True, exist_ok=True)
        directory.joinpath("cwd").mkdir(exist_ok=True)
        directory.joinpath("cmdline").write_bytes(
            "\0".join([sys.executable, "-m", "capture.worker", ""]).encode()
        )
        directory.joinpath("status").write_text("Uid:\t123 123 123 123\nGid:\t456 456 456 456\nGroups:\t456 789\n")
        environment = {
            "MM_SUMMARY_LLM": selector, "LUNA_API_KEY": SECRET,
            "LUNA_BASE_URL": "https://" + SECRET,
            "BE_BASE_URL": "https://" + SECRET, "BE_SERVICE_TOKEN": SECRET,
        }
        if self.global_off:
            environment["PM_AGENT_LLM"] = "off"
        if self.missing_key:
            del environment["LUNA_API_KEY"]
        directory.joinpath("environ").write_bytes(
            "\0".join(f"{key}={value}" for key, value in environment.items()).encode()
        )

    def command(self, args, **kwargs):
        self.events.append(args)
        if args[:2] == ["systemctl", "show"]:
            return "\n".join(f"{key}={value}" for key, value in self.state.items())
        if args[:2] == ["systemctl", "daemon-reload"]:
            assert self.drop_in.read_text() == activation.CONTENTS
            return ""
        if args[:2] == ["systemctl", "restart"]:
            pid = int(self.state["MainPID"]) + (not self.same_pid)
            self.state["MainPID"] = str(pid)
            self.state["ExecMainStartTimestampMonotonic"] = str(pid * 1000000)
            selector = "" if self.environment_file_override else "luna"
            self.create_process(pid, selector)
            return ""
        if args[0] == "journalctl":
            message = activation.MARKER if self.marker else SECRET
            timestamp = self.marker_timestamp
            if timestamp is None:
                timestamp = self.state["ExecMainStartTimestampMonotonic"]
            return json.dumps({"MESSAGE": SECRET}) + "\n" + json.dumps({
                "MESSAGE": message, "__MONOTONIC_TIMESTAMP": timestamp,
                "__REALTIME_TIMESTAMP": "9999999999999999",
            })
        assert args[:2] == [sys.executable, "-c"]
        assert kwargs["user"] == 123
        assert kwargs["group"] == 456
        assert kwargs["extra_groups"] == (456, 789)
        assert Path(kwargs["cwd"]).is_dir()
        environment = kwargs["env"]
        result = {
            "selector": environment["MM_SUMMARY_LLM"],
            "global_off": environment.get("PM_AGENT_LLM") == "off",
            "luna_key_present": bool(environment.get("LUNA_API_KEY")),
            "luna_url_present": bool(environment.get("LUNA_BASE_URL")),
            "be_url_present": bool(environment.get("BE_BASE_URL")),
            "be_token_present": bool(environment.get("BE_SERVICE_TOKEN")),
            "runner_ready": self.runner,
        }
        return json.dumps(result)

    def pause(self):
        pass


def test_off_to_on_installs_restarts_and_checks_actual_new_process(tmp_path, capsys):
    runtime = FixtureRuntime(tmp_path)
    assert activation.activate(runtime) == 0
    assert runtime.drop_in.read_text() == activation.CONTENTS
    assert runtime.process(101).env["MM_SUMMARY_LLM"] == "luna"
    assert ["systemctl", "daemon-reload"] in runtime.events
    assert ["systemctl", "restart", activation.UNIT] in runtime.events
    assert any("_PID=101" in event for event in runtime.events)
    output = capsys.readouterr().out
    assert "status=on selector=luna pid=101" in output
    assert SECRET not in output


def test_repeat_converges_without_rewriting_drop_in(tmp_path, capsys):
    runtime = FixtureRuntime(tmp_path)
    assert activation.activate(runtime) == 0
    modified = runtime.drop_in.stat().st_mtime_ns
    assert activation.activate(runtime) == 0
    assert runtime.drop_in.stat().st_mtime_ns == modified
    assert runtime.process(102).env["MM_SUMMARY_LLM"] == "luna"
    assert SECRET not in capsys.readouterr().out


@pytest.mark.parametrize("field,value,reason", [
    ("LoadState", "not-found", "worker-unit-missing"),
    ("ActiveState", "inactive", "worker-unit-inactive"),
])
def test_absent_and_inactive_workers_are_not_started(tmp_path, capsys, field, value, reason):
    runtime = FixtureRuntime(tmp_path)
    runtime.state[field] = value
    assert activation.activate(runtime) == 3
    assert not runtime.drop_in.exists()
    assert all(event[:2] != ["systemctl", "restart"] for event in runtime.events)
    assert reason in capsys.readouterr().out


def test_active_disabled_worker_keeps_existing_restart_policy(tmp_path, capsys):
    runtime = FixtureRuntime(tmp_path)
    runtime.state["UnitFileState"] = "disabled"
    assert activation.activate(runtime) == 0
    assert "boot_enabled=false" in capsys.readouterr().out


def test_inactive_disabled_worker_is_not_started(tmp_path):
    runtime = FixtureRuntime(tmp_path)
    runtime.state.update(UnitFileState="disabled", ActiveState="inactive")
    assert activation.activate(runtime) == 3
    assert not runtime.drop_in.exists()


@pytest.mark.parametrize("setting,reason", [
    ("global_off", "global-llm-off"),
    ("missing_key", "required-settings-missing"),
    ("runner", "runner-not-ready"),
])
def test_preflight_reports_config_blockers_without_mutation(tmp_path, capsys, setting, reason):
    runtime = FixtureRuntime(tmp_path)
    setattr(runtime, setting, setting != "runner")
    runtime.create_process(100, "")
    with pytest.raises(activation.ActivationError, match=reason):
        activation.activate(runtime)
    assert not runtime.drop_in.exists()
    assert SECRET not in capsys.readouterr().out


def test_environment_file_conflict_is_read_from_real_process(tmp_path, capsys):
    runtime = FixtureRuntime(tmp_path)
    runtime.environment_file_override = True
    with pytest.raises(activation.ActivationError, match="effective-selector-conflict"):
        activation.activate(runtime)
    output = capsys.readouterr().out
    assert '"selector": ""' in output
    assert "status=on" not in output
    assert SECRET not in output


@pytest.mark.parametrize("setting", ["marker", "same_pid"])
def test_probe_alone_and_unchanged_pid_do_not_prove_on(tmp_path, capsys, setting):
    runtime = FixtureRuntime(tmp_path)
    setattr(runtime, setting, setting == "same_pid")
    with pytest.raises(activation.ActivationError, match="new-worker-ready-marker-missing"):
        activation.activate(runtime)
    assert "status=on" not in capsys.readouterr().out


def test_other_service_command_is_not_mistaken_for_worker(tmp_path):
    runtime = FixtureRuntime(tmp_path)
    (runtime.proc / "100" / "cmdline").write_bytes(b"/python\0-m\0capture.run_recorder\0")
    with pytest.raises(activation.ActivationError, match="worker-command-unsupported"):
        activation.activate(runtime)
    assert not runtime.drop_in.exists()


@pytest.mark.parametrize("arguments", [
    ["-u", "-m", "capture.worker"],
    ["-m", "capture.worker", "--interval", "5"],
    ["-u", "-m", "capture.worker", "--recordings", SECRET, "--transcripts=" + SECRET, "--interval=5.5"],
])
def test_supported_worker_arguments_keep_actual_activation_checks(tmp_path, capsys, arguments):
    runtime = FixtureRuntime(tmp_path)
    original = runtime.create_process

    def create_process(pid, selector):
        original(pid, selector)
        (runtime.proc / str(pid) / "cmdline").write_bytes(
            "\0".join([sys.executable, *arguments, ""]).encode()
        )

    runtime.create_process = create_process
    create_process(100, "")
    assert activation.activate(runtime) == 0
    assert runtime.process(101).python == sys.executable
    assert runtime.process(101).uid == 123
    assert any("_PID=101" in event for event in runtime.events)
    output = capsys.readouterr().out
    assert "status=on selector=luna pid=101" in output
    assert SECRET not in output


@pytest.mark.parametrize("arguments", [
    ["-u", "-m", "capture.run_recorder"],
    ["-u", "-u", "-m", "capture.worker"],
    ["-m", "capture.worker", "--retry", SECRET],
    ["-m", "capture.worker", "--interval", SECRET],
    ["-m", "capture.worker", "--interval=" + SECRET],
    ["-m", "capture.worker", "--recordings"],
    ["-m", "capture.worker", "--unknown=" + SECRET],
    ["-m", "capture.worker", "--help"],
])
def test_unsupported_worker_arguments_do_not_log_values_or_activate(tmp_path, capsys, arguments):
    runtime = FixtureRuntime(tmp_path)
    interpreter = tmp_path / SECRET / "python"
    (runtime.proc / "100" / "cmdline").write_bytes(
        "\0".join([str(interpreter), *arguments, ""]).encode()
    )
    with pytest.raises(activation.ActivationError, match="worker-command-unsupported"):
        activation.activate(runtime)
    output = capsys.readouterr()
    assert "worker_command_shape=" in output.out
    assert SECRET not in output.out + output.err
    assert str(interpreter) not in output.out + output.err
    assert "status=on" not in output.out
    assert not runtime.drop_in.exists()


def test_launcher_is_diagnosed_without_executing_or_logging_its_arguments(tmp_path, capsys):
    runtime = FixtureRuntime(tmp_path)
    command = [str(tmp_path / SECRET / "uv"), "run", sys.executable, "-u", "-m", "capture.worker", SECRET]
    (runtime.proc / "100" / "cmdline").write_bytes("\0".join([*command, ""]).encode())
    with pytest.raises(activation.ActivationError, match="worker-command-unsupported"):
        activation.activate(runtime)
    output = capsys.readouterr()
    assert '"executable": "uv"' in output.out
    assert '"unknown_arguments": 1' in output.out
    assert SECRET not in output.out + output.err
    assert sys.executable not in output.out + output.err
    assert not runtime.drop_in.exists()


def test_relative_interpreter_does_not_activate_worker(tmp_path, capsys):
    runtime = FixtureRuntime(tmp_path)
    (runtime.proc / "100" / "cmdline").write_bytes(b"python\0-u\0-m\0capture.worker\0")
    with pytest.raises(activation.ActivationError, match="worker-command-unsupported"):
        activation.activate(runtime)
    output = capsys.readouterr().out
    assert '"argv0_absolute": false' in output
    assert "status=on" not in output
    assert not runtime.drop_in.exists()


@pytest.mark.parametrize("timestamp", ["1", "100999999", "", "invalid", -1, True, [], {}])
def test_old_or_invalid_marker_does_not_prove_current_worker_ready(tmp_path, capsys, timestamp):
    runtime = FixtureRuntime(tmp_path)
    runtime.marker_timestamp = timestamp
    with pytest.raises(activation.ActivationError, match="new-worker-ready-marker-missing"):
        activation.activate(runtime)
    output = capsys.readouterr().out
    assert "status=on" not in output
    assert SECRET not in output


@pytest.mark.parametrize("timestamp", ["101000000", "101000001"])
def test_marker_at_or_after_current_process_start_proves_ready(tmp_path, timestamp):
    runtime = FixtureRuntime(tmp_path)
    runtime.marker_timestamp = timestamp
    assert activation.activate(runtime) == 0


def test_marker_without_monotonic_timestamp_does_not_prove_ready(tmp_path, capsys):
    runtime = FixtureRuntime(tmp_path)
    original = runtime.command

    def command(args, **kwargs):
        if args[0] == "journalctl":
            return json.dumps({"MESSAGE": activation.MARKER})
        return original(args, **kwargs)

    runtime.command = command
    with pytest.raises(activation.ActivationError, match="new-worker-ready-marker-missing"):
        activation.activate(runtime)
    assert "status=on" not in capsys.readouterr().out


@pytest.mark.parametrize("started", [None, "", "0", "-1", "invalid"])
def test_missing_or_invalid_process_start_does_not_prove_ready(tmp_path, capsys, started):
    runtime = FixtureRuntime(tmp_path)
    original = runtime.command

    def command(args, **kwargs):
        raw = original(args, **kwargs)
        if args[:2] == ["systemctl", "restart"]:
            if started is None:
                runtime.state.pop("ExecMainStartTimestampMonotonic")
            else:
                runtime.state["ExecMainStartTimestampMonotonic"] = started
        return raw

    runtime.command = command
    with pytest.raises(activation.ActivationError, match="worker-start-time-unavailable"):
        activation.activate(runtime)
    assert "status=on" not in capsys.readouterr().out


def test_same_pid_restarted_after_probe_cannot_be_reported_on(tmp_path, capsys):
    runtime = FixtureRuntime(tmp_path)
    original = runtime.command

    def command(args, **kwargs):
        raw = original(args, **kwargs)
        if args[0] == "journalctl":
            runtime.state["ExecMainStartTimestampMonotonic"] = "102000000"
        return raw

    runtime.command = command
    with pytest.raises(activation.ActivationError, match="worker-pid-changed-during-probe"):
        activation.activate(runtime)
    assert "status=on" not in capsys.readouterr().out


def test_same_pid_new_start_during_polling_rechecks_actual_profile(tmp_path, capsys):
    runtime = FixtureRuntime(tmp_path)
    runtime.marker = False

    def pause():
        runtime.state["ExecMainStartTimestampMonotonic"] = "102000000"
        runtime.create_process(101, "terra")
        runtime.marker = True

    runtime.pause = pause
    with pytest.raises(activation.ActivationError, match="effective-selector-conflict"):
        activation.activate(runtime)
    assert "status=on" not in capsys.readouterr().out


def test_probe_rejects_unfiltered_result(tmp_path, capsys):
    runtime = FixtureRuntime(tmp_path)
    runtime.command = lambda *args, **kwargs: json.dumps({"secret": SECRET})
    process = runtime.process(100)
    with pytest.raises(activation.ActivationError, match="probe-unavailable"):
        runtime.probe(process)
    assert SECRET not in capsys.readouterr().out


def test_command_errors_do_not_expose_subprocess_output(monkeypatch):
    def fail(*args, **kwargs):
        raise subprocess.CalledProcessError(1, [SECRET], output=SECRET, stderr=SECRET)
    monkeypatch.setattr(subprocess, "run", fail)
    with pytest.raises(activation.ActivationError) as caught:
        activation.Runtime().command(["systemctl", "show"])
    assert str(caught.value) == "command-failed"


def test_probe_constructor_reads_dotenv_without_network_or_claim(tmp_path):
    shared = tmp_path / "shared"
    capture = tmp_path / "capture"
    shared.mkdir()
    capture.mkdir()
    shared.joinpath("__init__.py").write_text("")
    capture.joinpath("__init__.py").write_text("")
    config = SCRIPT.parent.parent / "ai" / "shared" / "config.py"
    shared.joinpath("config.py").write_text(config.read_text(encoding="utf-8"), encoding="utf-8")
    tmp_path.joinpath(".env").write_text(
        f"MM_SUMMARY_LLM=terra\nLUNA_API_KEY={SECRET}\nLUNA_BASE_URL=https://{SECRET}\n"
        f"BE_BASE_URL=https://{SECRET}\nBE_SERVICE_TOKEN={SECRET}\n"
    )
    capture.joinpath("summary_sweep.py").write_text(
        "def summary_from_env():\n    return object()\n"
        "def run_once():\n    raise RuntimeError('must never claim')\n"
    )
    result = subprocess.run(
        [sys.executable, "-c", activation.PROBE], cwd=tmp_path,
        env={"MM_SUMMARY_LLM": "luna"}, capture_output=True, text=True, check=True,
    )
    parsed = json.loads(result.stdout)
    assert parsed["selector"] == "luna"
    assert parsed["runner_ready"]
    assert parsed["luna_key_present"] and parsed["be_token_present"]
    assert SECRET not in result.stdout + result.stderr


@pytest.mark.parametrize("part,result", [("deploy", 0), ("deploy", 3), ("deploy", 1), ("ai", 0)])
def test_deploy_entrypoint_activation_and_success_sha(tmp_path, part, result):
    bash = shutil.which("bash")
    if os.name == "nt":
        bash = "C:/Program Files/Git/bin/bash.exe" if Path("C:/Program Files/Git/bin/bash.exe").exists() else None
    if not bash:
        pytest.skip("bash is required for the deployment entrypoint fixture")
    repo = tmp_path / "repo"
    repo.mkdir()
    repo.joinpath(".git").mkdir()
    state = repo / ".git" / "mm-deployed-sha"
    state.write_text("old-success\n")
    original = SCRIPT.with_name("ec2-deploy.sh").read_text(encoding="utf-8")
    script = tmp_path / "deploy.sh"
    script.write_text(
        original.replace("REPO=/opt/mm", "REPO='" + repo.as_posix() + "'")
        .replace('LOG="$HOME/mm-deploy.log"', "LOG='" + (tmp_path / "deploy.log").as_posix() + "'"),
        encoding="utf-8", newline="\n",
    )
    fixture = tmp_path / "fixture.sh"
    fixture.write_text('''
git() {
  case "$1" in
    rev-parse) echo new-commit ;;
    cat-file) return 0 ;;
    diff)
      [ "$2" = --quiet ] && return 0
      case "${@: -1}" in
        "$CHANGED_PART/") echo "$CHANGED_PART/runtime.py" ;;
      esac ;;
  esac
}
sudo() {
  if [ "$1" = python3 ] && [ "$2" = deploy/enable-summary.py ]; then
    echo "fixture activation result=$ACTIVATION_RESULT"
    return "$ACTIVATION_RESULT"
  fi
  echo "unexpected sudo invocation" >&2
  return 99
}
systemctl() { return 1; }
flock() { return 0; }
''', encoding="utf-8", newline="\n")
    environment = os.environ.copy()
    environment.update(BASH_ENV=fixture.as_posix(), CHANGED_PART=part, ACTIVATION_RESULT=str(result))
    completed = subprocess.run(
        [bash, str(script), "old-checkout", "changed"], env=environment,
        capture_output=True, text=True, encoding="utf-8", timeout=30,
    )
    assert f"fixture activation result={result}" in completed.stdout
    assert completed.returncode == (1 if result == 1 else 0)
    assert state.read_text().strip() == ("new-commit" if result == 0 else "old-success")
    assert "unexpected sudo" not in completed.stderr
