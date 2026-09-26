"""실시간 전사 Cog 를 띄우는 비교 실행기 (AI 파트 개발용). 운영 봇이 아니다.

운영 봇은 RecordingCog 하나만 붙인다. 지금은 capture/run_recorder.py 가 띄운다. 이 실행기는 회의 중
전사를 배치와 비교할 때만 따로 띄우고, 운영 봇에 RealtimeCog 를 붙이지 않는다. 이 폴더를 남긴 이유와
유지 범위는 capture/realtime/__init__.py 에 있다. 봇 계정은 길드마다 음성 연결을 하나만 가지므로 두
실행기가 같은 서버에서 동시에 녹음하지 않게 한다. 두 Cog 모두 MESSAGE CONTENT 인텐트를 요구하지 않는다.

실행 (ai/ 디렉토리 안에서):  python -m capture.realtime.run

아래 절차는 2026-09-12 에 실제 서버에서 끝까지 돌렸다. 그때 명령 이름은 /record /stop 이었고 지금
이름(/live /live-stop)으로는 아직 다시 돌리지 않았다 (decision_log/0006). 어디서 막히는지는 /selftest 가
단계별로 알려 준다.

한 번만 하는 준비
-----------------
포털 설정과 초대 링크는 코드에서 고칠 수 없어서 사람이 손으로 확인해야 한다.

1. 개발자 포털 → 해당 앱 → Bot → Privileged Gateway Intents 에서 SERVER MEMBERS 를 켠다.
   코드가 요청한 특권 인텐트를 포털에서 안 켜 두면 봇이 기동하자마자 죽는다. MESSAGE CONTENT 는
   이 실행기가 요청하지 않으므로 포털에서도 켜지 않는다. 확인은 토글이 켜진 색인지 눈으로 본다.

2. 초대 링크의 scopes 에 bot 과 applications.commands 를 둘 다 넣는다. 빠지면 슬래시 명령
   자체가 서버에 안 뜬다. 확인은 실제로 쓴 링크에 scope=bot%20applications.commands (또는
   bot+applications.commands) 가 들어 있는지 문자열을 읽는다. 이미 bot 만으로 초대한 서버라면
   새 링크로 다시 초대한다. 재초대만으로 스코프가 갱신된다.

3. 봇 역할에 음성 채널의 채널 보기·연결, 텍스트 채널의 채널 보기·메시지 보내기를 준다.
   말하기(Speak) 는 수신 전용이라 필요 없고, 링크 첨부와 메시지 기록 보기도 지금 코드에는
   필요 없다. 확인은 음성·텍스트 채널의 "채널 권한 보기" 에서 봇 계정 기준 최종 권한을 본다.

4. ai/.env 에 DISCORD_BOT_TOKEN 과 ELICE_API_KEY 를 넣는다. 값은 화면에 출력하지 않는다.
   DISCORD_GUILD_ID 에 서버 ID 를 채우면 슬래시 명령이 몇 초 안에 그 서버에 뜬다. 여러
   서버에서 쓰려면 비운다 — 글로벌 등록이라 반영까지 최대 1시간 걸린다. DISCORD_CHANNEL_ID 는
   이 Cog 가 쓰지 않는다. 확인은 봇을 띄운 뒤 서버에서 / 를 쳐서 live, live-join, live-stop,
   selftest 네 개가 보이는지 본다.

매번 하는 것
------------
    python -m capture.realtime.run

프로세스 하나가 초대된 서버 전부를 담당한다. 무음 원인을 쫓을 때는 LOG_LEVEL=DEBUG 를 붙인다.
패킷이 버려지는 로그가 DEBUG 라 기본 설정에서는 안 보인다.

음성 채널에 들어간 다음, 전사를 올릴 텍스트 채널에서 명령을 친다.

1. /live-join  으로 봇을 음성 채널에 넣는다
2. /selftest   어디까지 되는지 본다. 기본 실행은 유료 호출이 없다. 수신 프로브는 "연결돼
   있고 녹음 중이 아닌" 상태를 요구하므로 1번 다음이 그 자리다. STT 왕복까지 보려면
   stt: True 를 붙이는데, 1초짜리 오디오로 Elice API 를 실제로 한 번 부른다. ₩6/60초 기준
   약 0.1원이고, 최소 과금 단위를 확인하지 못해서 실제 청구는 이보다 클 수 있다
3. /live       전사를 시작한다. 줄은 명령을 친 채널에 올라간다
4. 말한다
5. /live-stop  회의록 경로와 수신 요약이 올라오고 봇이 음성 채널에서 나간다

서버당 회의는 하나다. 회의가 도는 중에 다른 방에서 /live 나 /live-join 을 치면 거부한다.
봇 계정 하나가 길드당 음성 연결을 하나만 가질 수 있어서다. 같은 이유로, 동료의 /record 가
연결을 쥐고 있으면 위 명령이 전부 거부하고 무엇이 돌고 있는지를 답에 적는다.

산출물은 recordings/{guild_id}_{ts}/ 아래 transcript.md, transcript.jsonl, latency.jsonl,
화자별 wav 이고 매니페스트는 recordings/session_{ts}.json 이다. 녹음한 wav 를 오프라인으로
다시 전사할 때는 디렉토리를 직접 준다. 기본 수집이 하위 디렉토리를 보지 않는다.

    python -m stt.transcribe --audio recordings/<meeting_id>

막히면 /selftest 출력을 그대로 가져온다.
"""

from __future__ import annotations

import logging
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))  # ai/ 자체를 sys.path 에 추가

import discord  # noqa: E402

from capture.realtime.adapter import RealtimeCog, required_intents  # noqa: E402
from shared.config import settings  # noqa: E402

S = settings()


async def on_session_saved(payload: dict, jsonl_path: Path) -> None:
    """회의록 저장 직후 불린다. 비교 실행이라 경로만 찍는다. BE 인계는 운영 경로(capture/handoff.py)에만 있다."""
    print(f"[realtime] 회의 {payload['meeting_id']} 저장됨 "
          f"(화자 {len(payload['speakers'])}명). 회의록: {jsonl_path}")


def build_bot() -> discord.Bot:
    if not S.discord_guild_id:
        print("[warn] DISCORD_GUILD_ID 가 비어 있다. 슬래시 명령이 글로벌로 등록되고 "
              "반영까지 최대 1시간 걸린다. 한 서버에서 바로 확인하려면 .env 에 길드 ID 를 "
              "채운다. 여러 서버에서 쓰려면 비운 게 맞다.", file=sys.stderr)
    bot = discord.Bot(
        intents=required_intents(),
        debug_guilds=[int(S.discord_guild_id)] if S.discord_guild_id else None,
    )
    bot.add_cog(RealtimeCog(bot, on_session_saved=on_session_saved))

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
        print("DISCORD_BOT_TOKEN 이 없습니다. .env.example 을 .env 로 복사해 채워 주세요.",
              file=sys.stderr)
        return 1
    build_bot().run(S.discord_bot_token)
    return 0


if __name__ == "__main__":
    sys.exit(main())
