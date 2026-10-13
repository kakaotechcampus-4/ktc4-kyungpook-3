"""채팅 폴링 검증 스크립트 — 채널의 최근 메시지를 한 번 읽어 판단 파이프라인(judge/pipeline.py)에 넣는다.

음성 회의의 전사록 자리에 채팅을 넣어 보는 실험용이다. 정식 진입점이 아니다. BE 에는 인계하지 않는다.
유사 task 검색은 eval_pipeline 처럼 --tasks 의 task 목록을 실제 임베딩으로 검색해 흉내 낸다. 없으면 후보 없음.

봇 메시지(음성 테스트 때 올린 회의록 등)와 본문 없는 메시지는 뺀다. 게이트웨이에 붙지 않고 REST 로만 읽는다.
Discord 개발자 포털에서 Message Content Intent 를 켜야 본문이 온다. 꺼져 있으면 본문이 빈 문자열로 와서 멈춘다.

실행 (ai/ 디렉토리 안에서):
    python -m capture.chat_poll --minutes 60
    python -m capture.chat_poll --minutes 60 --tasks judge/golden_set_pipeline/meeting_01.json
봇 토큰은 .env 의 CHAT_POLL_BOT_TOKEN, 채널은 --channel 또는 DISCORD_CHANNEL_ID. 결과는 runs/chat_poll_<시각>.json
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from dataclasses import asdict
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from shared.config import RUNS_DIR, settings
from shared.schemas import Transcript, TranscriptSegment

# (작성자 이름, 봇 여부, 보낸 시각, 본문)
Message = tuple[str, bool, datetime, str]


def to_transcript(messages: list[Message]) -> Transcript:
    """사람이 쓴 본문 있는 메시지만 시간순 전사록으로. start 는 첫 메시지 기준 초다."""
    kept = sorted((m for m in messages if not m[1] and m[3].strip()), key=lambda m: m[2])
    if not kept:
        return Transcript(segments=[], source="chat")
    t0 = kept[0][2]
    segments = []
    for seq, (name, _, at, text) in enumerate(kept, start=1):
        start = (at - t0).total_seconds()
        segments.append(TranscriptSegment(speaker=name, start=start, end=start, text=text.strip(), seq=seq))
    return Transcript(segments=segments, source="chat")


async def fetch_messages(token: str, channel_id: int, after: datetime) -> list[Message]:
    import discord

    client = discord.Client(intents=discord.Intents.none())
    await client.login(token)
    try:
        channel = await client.fetch_channel(channel_id)
        return [(m.author.display_name, m.author.bot, m.created_at, m.content)
                async for m in channel.history(after=after, oldest_first=True, limit=None)]
    finally:
        await client.close()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--channel", help="채널 ID. 없으면 DISCORD_CHANNEL_ID")
    parser.add_argument("--minutes", type=int, default=60, help="최근 몇 분의 메시지를 읽을지")
    parser.add_argument("--tasks", help='기존 task 목록 JSON ({"tasks": [...]}, golden_set_pipeline 형식)')
    args = parser.parse_args()

    cfg = settings()
    channel = args.channel or cfg.discord_channel_id
    if not cfg.chat_poll_bot_token or not channel:
        print("CHAT_POLL_BOT_TOKEN 과 채널 ID(--channel 또는 DISCORD_CHANNEL_ID)가 필요합니다.", file=sys.stderr)
        return 1

    after = datetime.now(timezone.utc) - timedelta(minutes=args.minutes)
    messages = asyncio.run(fetch_messages(cfg.chat_poll_bot_token, int(channel), after))
    humans = [m for m in messages if not m[1]]
    print(f"[chat] 메시지 {len(messages)}개 (사람 {len(humans)}개)")
    if humans and not any(m[3].strip() for m in humans):
        print("사람 메시지 본문이 전부 비어 있습니다. 개발자 포털에서 Message Content Intent 를 켜세요.", file=sys.stderr)
        return 1

    transcript = to_transcript(messages)
    if not transcript.segments:
        print("판단할 메시지가 없습니다.")
        return 0
    for s in transcript.segments:
        print(f"  {s.seq:>3} {s.speaker}: {s.text}")

    from judge.eval_pipeline import EmbeddingCandidates
    from judge.pipeline import run

    tasks = json.loads(open(args.tasks, encoding="utf-8").read())["tasks"] if args.tasks else []
    today = datetime.now(ZoneInfo(cfg.meeting_timezone)).date()
    out = run(transcript, workspace_id="chat_poll", today=today, candidates=EmbeddingCandidates(tasks))

    print(f"\n[items {len(out.items)}건]")
    for i in out.items:
        print(f"  {i['action']:<6} target={i['target_task_id']} category={i['category']} title={i['task_title']!r} "
              f"due={i['due_date']} status={i['status']} assignee={i['assignee_raw']!r}\n         {i['doc_text']}")
    print(f"[failures {len(out.failures)}건]")
    for f in out.failures:
        print(f"  {f.stage}: {f.finding_text!r} — {f.reason}")

    RUNS_DIR.mkdir(parents=True, exist_ok=True)
    path = RUNS_DIR / f"chat_poll_{datetime.now():%Y%m%d_%H%M%S}.json"
    path.write_text(json.dumps({"transcript": transcript.to_dict(), "items": out.items,
                                "failures": [asdict(f) for f in out.failures], "dropped": out.dropped},
                               ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"결과 저장: {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
