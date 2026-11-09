"""deploy/ec2-deploy.sh 의 채팅 폴링 유닛 갱신(#599)을 가짜 명령으로 돌려 본다.

git·sudo·systemctl·flock 을 BASH_ENV 로 바꿔 끼워, 어떤 명령을 부르는지만 본다. 실제 systemd 동작은 재지 않는다.
"""
import os
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
SCRIPT = ROOT / "deploy" / "ec2-deploy.sh"

FIXTURE = r'''
git() {
  case "$1" in
    rev-parse) echo new-commit ;;
    cat-file) return 0 ;;
    diff)
      if [ "$2" = --quiet ]; then
        case "$*" in
          *mm-chat-poll*) [ "$UNITS_CHANGED" = 1 ] && return 1 ;;
        esac
        return 0
      fi
      case "${@: -1}" in
        ai/) echo ai/runtime.py ;;
      esac ;;
  esac
}
# 실제 서버처럼 동작한다: 없는 디렉터리에는 tee·install 이 실패한다. FAIL_SUDO 는 "install -m" 처럼 앞 두 낱말이 같은 호출을 실패시킨다
sudo() {
  echo "sudo $*" >> "$CALLS"
  if [ -n "$FAIL_SUDO" ] && [ "$1 $2" = "$FAIL_SUDO" ]; then
    echo "sudo: $FAIL_SUDO 실패" >&2
    return 1
  fi
  case "$1" in
    mkdir) shift; mkdir "$@" ;;
    install)
      dest="${@: -1}"
      [ -d "$dest" ] || { echo "install: $dest: 디렉터리가 아니다" >&2; return 1; }
      cp "${@:4:$#-4}" "$dest" ;;
    tee)
      [ -d "$(dirname "$2")" ] || { echo "tee: $2: 디렉터리가 없다" >&2; return 1; }
      cat > "$2" ;;
  esac
  return 0
}
systemctl() {
  echo "systemctl $*" >> "$CALLS"
  case "$*" in
    "is-active -q mm-chat-poll.timer") [ "$TIMER_ACTIVE" = 1 ] ;;
    "show -p User --value mm-worker") echo ubuntu ;;
    *) return 1 ;;
  esac
}
flock() { return 0; }
# mode=all 은 세 파트를 모두 올리므로 빌드·설치 명령도 바꿔 끼운다
docker() { return 0; }
npm() { return 0; }
curl() { return 0; }
uv() { return 0; }
'''


def _bash() -> str | None:
    if os.name == "nt":
        git_bash = Path("C:/Program Files/Git/bin/bash.exe")
        return str(git_bash) if git_bash.exists() else None
    return shutil.which("bash")


def _run(
    tmp_path: Path, *, installed: bool, units_changed: bool, timer_active: bool = True, mode: str = "changed",
    fail_sudo: str = "",
):
    bash = _bash()
    if not bash:
        pytest.skip("bash 가 있어야 배포 스크립트를 돌린다")
    repo = tmp_path / "repo"
    (repo / ".git").mkdir(parents=True)
    (repo / ".git" / "mm-deployed-sha").write_text("old-success\n")
    units = repo / "ai" / "deploy" / "systemd"
    units.mkdir(parents=True)
    (units / "mm-chat-poll.service").write_text("new service\n")
    (units / "mm-chat-poll.timer").write_text("new timer\n")
    systemd = tmp_path / "systemd"
    systemd.mkdir(exist_ok=True)
    if installed:
        (systemd / "mm-chat-poll.timer").write_text("old timer\n")
    calls = tmp_path / "calls.log"
    calls.write_text("")
    script = tmp_path / "deploy.sh"
    original = SCRIPT.read_text(encoding="utf-8")
    patched = (
        original.replace("REPO=/opt/mm", f"REPO='{repo.as_posix()}'")
        .replace('LOG="$HOME/mm-deploy.log"', f"LOG='{(tmp_path / 'deploy.log').as_posix()}'")
        .replace("SYSTEMD_DIR=/etc/systemd/system", f"SYSTEMD_DIR='{systemd.as_posix()}'")
    )
    assert patched.count(systemd.as_posix()) == 1, "스크립트에 SYSTEMD_DIR=/etc/systemd/system 줄이 있어야 한다"
    script.write_text(patched, encoding="utf-8", newline="\n")
    fixture = tmp_path / "fixture.sh"
    fixture.write_text(FIXTURE, encoding="utf-8", newline="\n")
    env = os.environ.copy()
    env.update(
        BASH_ENV=fixture.as_posix(), CALLS=calls.as_posix(),
        UNITS_CHANGED="1" if units_changed else "0", TIMER_ACTIVE="1" if timer_active else "0",
        FAIL_SUDO=fail_sudo,
    )
    done = subprocess.run(
        [bash, str(script), "old-checkout", mode], env=env,
        capture_output=True, text=True, encoding="utf-8", timeout=60,
    )
    return done, calls.read_text(encoding="utf-8"), systemd, repo


def test_installed_and_units_changed_updates_units_and_rearms_timer(tmp_path):
    done, calls, systemd, repo = _run(tmp_path, installed=True, units_changed=True)

    assert done.returncode == 0, done.stderr
    assert (
        "sudo install -m 0644 ai/deploy/systemd/mm-chat-poll.service ai/deploy/systemd/mm-chat-poll.timer "
        f"{systemd.as_posix()}/"
    ) in calls
    # 유닛이 목적지에 실제로 놓였다
    assert (systemd / "mm-chat-poll.service").read_text().strip() == "new service"
    assert (systemd / "mm-chat-poll.timer").read_text().strip() == "new timer"
    # drop-in 디렉터리는 스크립트가 만들어야 한다. 스텁의 tee 는 없는 디렉터리에서 실패한다
    assert f"sudo mkdir -p {systemd.as_posix()}/mm-chat-poll.service.d" in calls
    assert f"sudo tee {systemd.as_posix()}/mm-chat-poll.service.d/10-user.conf" in calls
    drop_in = systemd / "mm-chat-poll.service.d" / "10-user.conf"
    assert drop_in.read_text() == "[Service]\nUser=ubuntu\n"
    assert "sudo systemctl daemon-reload" in calls
    assert "sudo systemctl restart mm-chat-poll.timer" in calls
    # 실행 중인 폴링을 끊지 않는다
    assert "restart mm-chat-poll.service" not in calls
    assert "systemctl enable" not in calls
    assert (repo / ".git" / "mm-deployed-sha").read_text().strip() == "new-commit"


def test_existing_drop_in_is_kept(tmp_path):
    systemd = tmp_path / "systemd" / "mm-chat-poll.service.d"
    systemd.mkdir(parents=True)
    (systemd / "10-user.conf").write_text("[Service]\nUser=someone\n")

    done, calls, _, _ = _run(tmp_path, installed=True, units_changed=True)

    assert done.returncode == 0, done.stderr
    assert "sudo tee" not in calls
    assert (systemd / "10-user.conf").read_text() == "[Service]\nUser=someone\n"


def test_inactive_timer_is_not_started(tmp_path):
    done, calls, _, _ = _run(tmp_path, installed=True, units_changed=True, timer_active=False)

    assert done.returncode == 0, done.stderr
    assert "sudo systemctl daemon-reload" in calls
    assert "restart mm-chat-poll.timer" not in calls
    assert "start mm-chat-poll" not in calls
    assert "systemctl enable" not in calls


def test_installed_but_units_unchanged_does_nothing(tmp_path):
    done, calls, _, _ = _run(tmp_path, installed=True, units_changed=False)

    assert done.returncode == 0, done.stderr
    assert "mm-chat-poll" not in calls
    assert "daemon-reload" not in calls


def test_not_installed_only_warns_and_completes(tmp_path):
    done, calls, systemd, repo = _run(tmp_path, installed=False, units_changed=True)

    assert done.returncode == 0, done.stderr
    assert "::warning::mm-chat-poll.timer 가 설치되지 않았다" in done.stdout
    assert "mm-chat-poll" not in calls
    assert "daemon-reload" not in calls
    assert not (systemd / "mm-chat-poll.timer").exists()
    assert (repo / ".git" / "mm-deployed-sha").read_text().strip() == "new-commit"


def test_mode_all_updates_units_even_when_unchanged(tmp_path):
    done, calls, _, _ = _run(tmp_path, installed=True, units_changed=False, mode="all")

    assert done.returncode == 0, done.stderr
    assert "sudo install -m 0644 ai/deploy/systemd/mm-chat-poll.service ai/deploy/systemd/mm-chat-poll.timer" in calls
    assert "sudo systemctl daemon-reload" in calls
    assert "sudo systemctl restart mm-chat-poll.timer" in calls


@pytest.mark.parametrize("failing", ["install -m", "systemctl daemon-reload", "systemctl restart"])
def test_failed_unit_update_fails_deploy_and_keeps_base_commit(tmp_path, failing):
    done, calls, _, repo = _run(tmp_path, installed=True, units_changed=True, fail_sudo=failing)

    assert done.returncode != 0
    assert f"sudo {failing}" in calls
    # 기준 커밋을 올리지 않아 다음 배포가 같은 구간을 다시 비교한다
    assert (repo / ".git" / "mm-deployed-sha").read_text().strip() == "old-success"
