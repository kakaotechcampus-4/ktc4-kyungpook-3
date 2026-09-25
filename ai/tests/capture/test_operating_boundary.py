"""운영 봇의 경계. 운영 Cog 는 RecordingCog 하나이고 실시간 폴더에 기대지 않는다 (decision_log/0014).

실시간 경로(capture/realtime, stt/realtime)는 비교 실행과 회귀 근거로 남겨 둔 것이라, 지우기로
정하면 폴더째 지울 수 있어야 한다. 그 전제를 여기서 지킨다.
"""

import subprocess
import sys
import types
from pathlib import Path

AI_ROOT = Path(__file__).resolve().parents[2]


async def test_the_operating_runner_attaches_only_the_recording_cog(monkeypatch):
    """봇 계정은 길드마다 음성 연결이 하나라 녹음기 둘이 같이 받을 수 없다. 운영 실행기는 하나만 붙인다."""
    import capture.run_recorder as runner

    monkeypatch.setattr(runner, "S", types.SimpleNamespace(discord_bot_token="x", discord_guild_id=""))
    assert list(runner.build_bot().cogs) == ["RecordingCog"]


def test_the_operating_bot_loads_nothing_from_the_realtime_folders():
    """운영 Cog 와 실행기를 새 프로세스에서 import 하고 실린 모듈을 본다.

    같은 프로세스에서는 다른 테스트가 실시간 모듈을 이미 올려 두었을 수 있어 따로 띄운다.
    """
    code = ("import sys, capture.discord_adapter, capture.run_recorder; "
            "print(sorted(m for m in sys.modules "
            "if m.split('.')[:2] in (['capture', 'realtime'], ['stt', 'realtime'])))")
    r = subprocess.run([sys.executable, "-c", code], cwd=AI_ROOT, capture_output=True, text=True, timeout=120)
    assert r.returncode == 0, r.stderr
    assert r.stdout.strip() == "[]"
