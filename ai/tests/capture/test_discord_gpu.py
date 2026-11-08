"""디스코드 /gpu on|off|status. 비공개 운영 채널(MM_OPS_CHANNEL_ID)에서 친 명령만 받는다. 채널 ID 가 비면 아무도 못 쓴다.
봇은 요청 파일만 쓰고 상태 파일을 읽는다."""

import json
import time

import discord
import pytest

from capture import discord_adapter as A
from stt.failover import FailoverState, Mode, Phase, _dump
from tests.capture.test_discord_adapter import FakeCtx, _setup

OPS = 4242


class Channel:
    def __init__(self, cid):
        self.id = cid


def _ctx(tmp_path, *, channel=OPS):
    cog, guild, vc, _, _ = _setup(tmp_path)
    ctx = FakeCtx(guild, vc, Channel(channel))
    ctx.ephemeral = []
    respond = ctx.respond

    async def respond_tracking(text, ephemeral=False):
        ctx.ephemeral.append(ephemeral)
        await respond(text, ephemeral=ephemeral)

    ctx.respond = respond_tracking
    return cog, ctx


@pytest.fixture(autouse=True)
def _ops(monkeypatch):
    monkeypatch.setenv("MM_OPS_CHANNEL_ID", str(OPS))


def _worker_beat(tmp_path, **kw):
    d = tmp_path / "recordings" / ".worker"
    d.mkdir(parents=True, exist_ok=True)
    (d / "heartbeat.json").write_text(json.dumps({"state": "running", "at_ts": time.time(), "interval_s": 10, **kw}))


def _request(tmp_path):
    p = tmp_path / "recordings" / ".worker" / "gpu-request"
    return p.read_text() if p.exists() else None


@pytest.mark.parametrize("verb", ["on", "off"])
async def test_a_command_in_the_ops_channel_leaves_a_request(tmp_path, verb):
    cog, ctx = _ctx(tmp_path)
    _worker_beat(tmp_path, failover="manual:normal")
    await _run_gpu(cog, ctx, verb)
    assert _request(tmp_path) == verb
    assert "요청" in ctx.responses[-1] and ctx.ephemeral[-1] is False


async def test_a_command_for_a_worker_without_failover_leaves_no_request(tmp_path):
    cog, ctx = _ctx(tmp_path)
    _worker_beat(tmp_path)
    await _run_gpu(cog, ctx, "on")
    assert _request(tmp_path) is None
    assert "남기지 않았습니다" in ctx.responses[-1] and "MM_GPU_FAILOVER" in ctx.responses[-1]


async def test_status_reads_the_state_file(tmp_path):
    cog, ctx = _ctx(tmp_path)
    d = tmp_path / "recordings" / ".worker"
    d.mkdir(parents=True)
    (d / "gpu-failover.json").write_text(_dump(FailoverState(phase=Phase.ON_GPU, since=1.0, why="elice_down"),
                                               Mode.AUTO, 1.0))
    await _run_gpu(cog, ctx, "status")
    assert "단계 on_gpu" in ctx.responses[-1] and _request(tmp_path) is None


async def test_another_channel_is_turned_away_without_a_request(tmp_path):
    cog, ctx = _ctx(tmp_path, channel=999)
    await _run_gpu(cog, ctx, "on")
    assert _request(tmp_path) is None and ctx.ephemeral[-1] is True


async def test_without_an_ops_channel_nobody_can_use_it(tmp_path, monkeypatch):
    monkeypatch.setenv("MM_OPS_CHANNEL_ID", "")
    cog, ctx = _ctx(tmp_path)
    await _run_gpu(cog, ctx, "on")
    assert _request(tmp_path) is None and ctx.ephemeral[-1] is True


async def test_the_command_is_registered_with_three_choices(tmp_path):
    bot = discord.Bot()
    bot.add_cog(A.RecordingCog(bot, recordings_dir=tmp_path / "recordings"))
    cmd = next(c for c in bot.pending_application_commands if c.name == "gpu")
    assert [(o.name, [ch.name for ch in o.choices]) for o in cmd.options] == [("action", ["on", "off", "status"])]


async def _run_gpu(cog, ctx, verb):
    return await A.RecordingCog.gpu.callback(cog, ctx, verb)
