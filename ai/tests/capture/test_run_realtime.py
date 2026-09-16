"""실행기 배선. 우리 Cog 만 붙는지, 명령이 네 개로 뜨는지."""

import types

import pytest

import capture.run_realtime as runner


@pytest.fixture
def no_guild(monkeypatch):
    """.env 에 무엇이 들어 있든 테스트가 같게 돌게 한다. 값은 읽지도 찍지도 않는다."""
    monkeypatch.setattr(runner, "S", types.SimpleNamespace(
        discord_bot_token="x", discord_guild_id=""))


async def test_build_bot_attaches_only_the_realtime_cog(no_guild, capsys):
    bot = runner.build_bot()

    assert list(bot.cogs) == ["RealtimeCog"]
    names = sorted(c.name for c in bot.pending_application_commands)
    assert names == ["live", "live-join", "live-stop", "selftest"]
    assert "DISCORD_GUILD_ID 가 비어 있다" in capsys.readouterr().err


async def test_build_bot_does_not_ask_for_message_content(no_guild):
    """특권 인텐트를 안 쓰면서 켜면 포털 미설정 시 봇이 기동 즉시 죽는다."""
    assert runner.build_bot().intents.message_content is False


async def test_on_session_saved_prints_the_transcript_path(capsys):
    payload = {"meeting_id": "42_1700", "speakers": [{"user_id": "7"}]}
    await runner.on_session_saved(payload, "recordings/42_1700/transcript.jsonl")

    out = capsys.readouterr().out
    assert "42_1700" in out
    assert "transcript.jsonl" in out

