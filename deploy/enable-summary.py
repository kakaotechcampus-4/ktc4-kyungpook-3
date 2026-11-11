#!/usr/bin/env python3
"""Install the fixed summary selector and verify the actual running worker."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path

UNIT = "mm-worker.service"
DROP_IN = Path("/etc/systemd/system/mm-worker.service.d/90-summary.conf")
CONTENTS = "[Service]\nEnvironment=MM_SUMMARY_LLM=luna\n"
MARKER = "[summary] runner ready model=luna"
PROBE = r'''
import contextlib, io, json, os
result = {}
try:
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        from shared.config import env
        from capture.summary_sweep import summary_from_env
        selector = env("MM_SUMMARY_LLM")
        mode = env("PM_AGENT_LLM").lower()
        result = {
            "selector": selector if selector in ("", "luna", "terra") else "unsupported",
            "global_off": mode == "off",
            "luna_key_present": bool(env("LUNA_API_KEY")),
            "luna_url_present": bool(env("LUNA_BASE_URL")),
            "be_url_present": bool(env("BE_BASE_URL")),
            "be_token_present": bool(env("BE_SERVICE_TOKEN")),
        }
        result["runner_ready"] = summary_from_env() is not None
except Exception:
    result["runner_ready"] = False
print(json.dumps(result, sort_keys=True))
'''
PROBE_KEYS = {
    "selector", "global_off", "luna_key_present", "luna_url_present",
    "be_url_present", "be_token_present", "runner_ready",
}


class ActivationError(Exception):
    pass


class WorkerArguments(argparse.ArgumentParser):
    def error(self, message):
        raise ValueError from None


def worker_command_supported(argv: list[str]) -> bool:
    if not argv or not Path(argv[0]).is_absolute():
        return False
    arguments = argv[1:]
    if arguments[:1] == ["-u"]:
        arguments = arguments[1:]
    if arguments[:2] != ["-m", "capture.worker"]:
        return False
    parser = WorkerArguments(add_help=False, allow_abbrev=False, exit_on_error=False)
    parser.add_argument("--recordings")
    parser.add_argument("--transcripts")
    parser.add_argument("--interval", type=float)
    try:
        parser.parse_args(arguments[2:])
    except (argparse.ArgumentError, ValueError):
        return False
    return True


def worker_command_shape(argv: list[str]) -> dict:
    launchers = {"uv", "flock", "bash", "sh"}
    labels = {
        "-u": "unbuffered", "-m": "module", "capture.worker": "worker",
        "--recordings": "recordings_option", "--transcripts": "transcripts_option",
        "--interval": "interval_option", "--retry": "retry_option", "run": "run",
    }

    def label(argument):
        name = Path(argument).name.lower()
        if name in {"python", "python3", "python3.12", "python.exe"}:
            return "absolute_python" if Path(argument).is_absolute() else "python"
        return labels.get(argument.split("=", 1)[0], "redacted")

    executable = Path(argv[0]).name.lower() if argv else ""
    executable_label = executable if executable in launchers else label(argv[0]) if argv else "redacted"
    arguments = [label(argument) for argument in argv[1:]]
    return {"argc": len(argv), "argv0_absolute": bool(argv) and Path(argv[0]).is_absolute(),
            "executable": executable_label, "arguments": arguments,
            "unknown_arguments": arguments.count("redacted")}


@dataclass(frozen=True)
class Process:
    pid: int
    python: str
    cwd: str
    env: dict[str, str]
    uid: int
    gid: int
    groups: tuple[int, ...]


class Runtime:
    def __init__(self, drop_in: Path = DROP_IN, proc: Path = Path("/proc")):
        self.drop_in = drop_in
        self.proc = proc

    def command(self, args: list[str], **kwargs) -> str:
        try:
            result = subprocess.run(args, capture_output=True, text=True, check=True, **kwargs)
        except (OSError, subprocess.SubprocessError):
            raise ActivationError("command-failed") from None
        return result.stdout

    def unit(self) -> dict[str, str]:
        raw = self.command([
            "systemctl", "show", UNIT, "--no-pager",
            "--property=LoadState,ActiveState,UnitFileState,MainPID,ExecMainStartTimestampMonotonic",
        ])
        return dict(line.split("=", 1) for line in raw.splitlines() if "=" in line)

    def process(self, pid: int) -> Process:
        directory = self.proc / str(pid)
        try:
            argv = directory.joinpath("cmdline").read_bytes().decode().rstrip("\0").split("\0")
            print("summary worker_command_shape=" + json.dumps(worker_command_shape(argv), sort_keys=True))
            if not worker_command_supported(argv):
                raise ActivationError("worker-command-unsupported")
            status = dict(line.split(":", 1) for line in directory.joinpath("status").read_text().splitlines() if ":" in line)
            uid = int(status["Uid"].split()[1])
            gid = int(status["Gid"].split()[1])
            groups = tuple(map(int, status["Groups"].split()))
            environment = dict(
                item.split("=", 1) for item in directory.joinpath("environ").read_bytes().decode().split("\0") if "=" in item
            )
            cwd = str(directory.joinpath("cwd").resolve(strict=True))
            return Process(pid, argv[0], cwd, environment, uid, gid, groups)
        except (OSError, ValueError, KeyError, UnicodeError):
            raise ActivationError("worker-process-unreadable") from None

    def probe(self, process: Process, *, planned: bool = False) -> dict:
        environment = process.env.copy()
        if planned:
            environment["MM_SUMMARY_LLM"] = "luna"
        raw = self.command(
            [process.python, "-c", PROBE], cwd=process.cwd, env=environment,
            user=process.uid, group=process.gid, extra_groups=process.groups, timeout=60,
        )
        try:
            result = json.loads(raw)
            if set(result) != PROBE_KEYS or result["selector"] not in ("", "luna", "terra", "unsupported"):
                raise ValueError
            if any(type(value) is not bool for key, value in result.items() if key != "selector"):
                raise ValueError
            return result
        except (ValueError, TypeError):
            raise ActivationError("probe-unavailable") from None

    def install(self) -> None:
        self.drop_in.parent.mkdir(parents=True, exist_ok=True)
        if self.drop_in.exists() and self.drop_in.read_text() == CONTENTS:
            return
        temporary = self.drop_in.with_suffix(".tmp")
        temporary.write_text(CONTENTS)
        temporary.chmod(0o644)
        temporary.replace(self.drop_in)

    def restart(self) -> None:
        self.command(["systemctl", "daemon-reload"])
        self.command(["systemctl", "restart", UNIT], timeout=1500)

    def ready_marker(self, pid: int, started_us: int) -> bool:
        raw = self.command([
            "journalctl", "--unit", UNIT, "_PID=" + str(pid), "-b", "--no-pager",
            "--output=json", "--lines=200",
        ])
        for line in raw.splitlines():
            try:
                entry = json.loads(line)
                timestamp = entry.get("__MONOTONIC_TIMESTAMP", "")
                if (entry.get("MESSAGE") == MARKER and isinstance(timestamp, str)
                        and timestamp.isascii() and timestamp.isdecimal() and int(timestamp) >= started_us):
                    return True
            except (ValueError, AttributeError):
                continue
        return False

    def pause(self) -> None:
        time.sleep(1)


def verify_probe(result: dict, *, planned: bool = False) -> None:
    stage = "planned" if planned else "actual"
    print("summary probe stage=" + stage + " " + json.dumps(result, sort_keys=True))
    if result["selector"] != "luna":
        raise ActivationError("effective-selector-conflict")
    if result["global_off"]:
        raise ActivationError("global-llm-off")
    if not all(result[key] for key in ("luna_key_present", "luna_url_present", "be_url_present", "be_token_present")):
        raise ActivationError("required-settings-missing")
    if not result["runner_ready"]:
        raise ActivationError("runner-not-ready")


def activate(runtime: Runtime) -> int:
    state = runtime.unit()
    if state.get("LoadState") != "loaded":
        print("summary status=not-on reason=worker-unit-missing")
        return 3
    if state.get("ActiveState") != "active":
        print("summary status=not-on reason=worker-unit-inactive")
        return 3
    boot_enabled = state.get("UnitFileState") in ("enabled", "enabled-runtime")
    print("summary worker_active=true boot_enabled=" + str(boot_enabled).lower())
    old_pid = int(state.get("MainPID", "0"))
    if old_pid <= 0:
        raise ActivationError("worker-pid-missing")
    verify_probe(runtime.probe(runtime.process(old_pid), planned=True), planned=True)
    runtime.install()
    runtime.restart()
    for _ in range(30):
        state = runtime.unit()
        pid = int(state.get("MainPID", "0"))
        if state.get("ActiveState") == "active" and pid > 0 and pid != old_pid:
            started = state.get("ExecMainStartTimestampMonotonic", "")
            if not started.isascii() or not started.isdecimal() or int(started) <= 0:
                raise ActivationError("worker-start-time-unavailable")
            started_us = int(started)
            if runtime.ready_marker(pid, started_us):
                verify_probe(runtime.probe(runtime.process(pid)))
                final = runtime.unit()
                if (final.get("MainPID") != str(pid) or final.get("ActiveState") != "active"
                        or final.get("ExecMainStartTimestampMonotonic") != str(started_us)):
                    raise ActivationError("worker-pid-changed-during-probe")
                print(f"summary status=on selector=luna pid={pid} new_pid=true runner_ready=true startup_marker=true")
                return 0
        runtime.pause()
    raise ActivationError("new-worker-ready-marker-missing")


def main() -> int:
    if len(sys.argv) != 1 or os.geteuid() != 0:
        print("summary status=not-on reason=fixed-root-command-required")
        return 1
    try:
        return activate(Runtime())
    except (ActivationError, OSError, ValueError) as error:
        # External error strings can contain credentials, command arguments, or URLs.
        reason = str(error) if isinstance(error, ActivationError) else "activation-failed"
        print("summary status=not-on reason=" + reason)
        return 1


if __name__ == "__main__":
    sys.exit(main())
