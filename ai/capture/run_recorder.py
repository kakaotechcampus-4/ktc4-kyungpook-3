"""Phase 0 검증용 봇 실행 스크립트 (AI 파트 개발용).

정식 봇 프로세스는 BE 의 be/bot/main.py 가 소유합니다. 이 스크립트는 BE 가 준비되기 전에
녹음/STT 검증을 돌리기 위한 최소 실행기이며, BE 는 아래 build_bot() 과 같은 방식으로 RecordingCog 를 붙이면 됩니다.

실행 (ai/ 디렉토리 안에서):  python capture/run_recorder.py
"""

from __future__ import annotations

import logging
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # ai/ 자체를 sys.path 에 추가

import discord  # noqa: E402

from capture.discord_adapter import RecordingCog, required_intents  # noqa: E402
from shared.config import settings  # noqa: E402

S = settings()


async def on_session_saved(manifest: dict, manifest_path: Path) -> None:
    """저장 직후 후처리 자리. 지금은 다음 명령만 안내 (BE 는 여기서 전사·파이프라인을 이어 붙임)."""
    print(f"[recorder] 세션 {manifest['session']} 저장됨 ({len(manifest['speakers'])}명). "
          f"다음: python stt/transcribe.py --session {manifest['session']}")


def build_bot() -> discord.Bot:
    if not S.discord_guild_id:
        print("[warn] DISCORD_GUILD_ID 가 비어 있다. 슬래시 명령이 글로벌로 등록되고 "
              "반영까지 최대 1시간 걸린다. 한 서버에서 바로 확인하려면 .env 에 길드 ID 를 "
              "채운다. 여러 서버에서 쓰려면 비운 게 맞다.", file=sys.stderr)
    bot = discord.Bot(
        intents=required_intents(),
        debug_guilds=[int(S.discord_guild_id)] if S.discord_guild_id else None,
    )
    bot.add_cog(RecordingCog(bot, on_session_saved=on_session_saved))

    @bot.event
    async def on_ready() -> None:
        print(f"[ready] {bot.user} (id={bot.user.id})  py-cord {discord.__version__}")

    return bot


def main() -> int:
    # 무음의 가장 흔한 원인인 "버린 패킷" 로그가 DEBUG 라 기본 설정에서는 안 보인다
    # (voice/receive/reader.py:252-256).
    if os.environ.get("LOG_LEVEL", "").upper() == "DEBUG":
        logging.basicConfig(level=logging.INFO)
        logging.getLogger("discord.voice").setLevel(logging.DEBUG)
    if not S.discord_bot_token:
        print("DISCORD_BOT_TOKEN 이 없습니다. .env.example 을 .env 로 복사해 채워 주세요.", file=sys.stderr)
        return 1
    build_bot().run(S.discord_bot_token)
    return 0


if __name__ == "__main__":
    sys.exit(main())
