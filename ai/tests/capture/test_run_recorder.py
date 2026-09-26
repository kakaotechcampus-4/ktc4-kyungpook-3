"""개발용 실행기. ai/ 안에서 `python -m capture.run_recorder` 로 돌고, import 가 sys.path 를 건드리지 않는다."""

import importlib
import os
import subprocess
import sys
from pathlib import Path

AI_ROOT = Path(__file__).resolve().parents[2]


def test_import_leaves_sys_path_alone(monkeypatch):
    monkeypatch.setattr(sys, "path", list(sys.path))      # 실패해도 다른 테스트에 번지지 않게 사본으로
    monkeypatch.delitem(sys.modules, "capture.run_recorder", raising=False)
    before = list(sys.path)
    importlib.import_module("capture.run_recorder")
    assert sys.path == before


def test_runs_as_module_from_ai_root_and_stops_without_token():
    env = {k: v for k, v in os.environ.items() if k != "PYTHONPATH"}
    env["DISCORD_BOT_TOKEN"] = ""                            # .env 에 진짜 토큰이 있어도 봇을 띄우지 않는다
    done = subprocess.run([sys.executable, "-m", "capture.run_recorder"], cwd=AI_ROOT, env=env,
                          capture_output=True, text=True, timeout=120)
    assert done.returncode == 1, done.stderr
    assert "DISCORD_BOT_TOKEN" in done.stderr
