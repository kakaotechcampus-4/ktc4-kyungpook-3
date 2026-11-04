"""채팅 폴링 검증 스크립트 — 채널의 최근 메시지를 한 번 읽어 봇·워커와 같은 판단 경로(capture/judge_path.py)에 넣는다.

음성 회의의 전사록 자리에 채팅을 넣어 보는 실험용이다. 정식 진입점이 아니다. BE 에는 인계하지 않는다.
유사 task 검색은 eval_pipeline 처럼 --tasks 의 task 목록을 실제 임베딩으로 검색해 흉내 낸다. 없으면 후보 없음.

화자는 음성 회의와 같이 작성자 uid 로 둔다(전사 계약). 판단은 음성과 같은 추출기(capture/judge_path.py)로 돌려서
LLM 에는 이름을 보이고 결과의 evidence_speaker 는 uid 로 돌려받는다. 그래야 BE 가 1인칭 담당자를 uid 로 찾는다.

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
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from shared.config import RUNS_DIR, settings
from shared.schemas import Transcript, TranscriptSegment

# (작성자 uid, 작성자 이름, 봇 여부, 보낸 시각, 본문). 리액션도 누른 사람의 메시지 한 줄로 담는다
Message = tuple[str, str, bool, datetime, str]


def clean_text(content: str, mentions: dict[int, str]) -> str:
    """LLM 이 읽을 본문. 사용자 멘션 <@id> 를 @이름 으로, 줄바꿈을 공백으로 바꾼다.

    줄바꿈이 남으면 1단계가 번호 매긴 한 줄이 여러 줄로 보인다.
    """
    # ponytail: 역할(<@&id>)·채널(<#id>) 멘션은 그대로 둔다. 쓰이면 m.role_mentions·channel_mentions 로 같이 바꾼다
    for uid, name in mentions.items():
        content = content.replace(f"<@{uid}>", f"@{name}").replace(f"<@!{uid}>", f"@{name}")
    return " ".join(content.split())


def to_transcript(messages: list[Message]) -> tuple[Transcript, dict[str, str]]:
    """사람이 쓴 본문 있는 메시지만 시간순 전사록으로. start 는 첫 메시지 기준 초다.

    speaker 는 작성자 uid 다. 표시 이름은 {uid: 이름} 으로 따로 돌려준다(음성 매니페스트의 speakers 와 같은 구실).
    리액션 줄은 원래 메시지와 시각이 같고 목록에서 바로 뒤에 있다. 정렬이 안정적이라 그 자리를 지킨다.
    """
    kept = sorted((m for m in messages if not m[2] and m[4].strip()), key=lambda m: m[3])
    if not kept:
        return Transcript(segments=[], source="chat"), {}
    t0 = kept[0][3]
    segments, names = [], {}
    for seq, (uid, name, _, at, text) in enumerate(kept, start=1):
        start = (at - t0).total_seconds()
        segments.append(TranscriptSegment(speaker=uid, start=start, end=start, text=text.strip(), seq=seq))
        names[uid] = name
    return Transcript(segments=segments, source="chat"), names


async def fetch_messages(token: str, channel_id: int, after: datetime) -> list[Message]:
    import discord

    client = discord.Client(intents=discord.Intents.none())
    await client.login(token)
    try:
        channel = await client.fetch_channel(channel_id)
        out: list[Message] = []
        async for m in channel.history(after=after, oldest_first=True, limit=None):
            text = clean_text(m.content, {u.id: u.display_name for u in m.mentions})
            out.append((str(m.author.id), m.author.display_name, m.author.bot, m.created_at, text))
            if m.author.bot or not text:
                continue  # 빠지는 메시지에 단 리액션은 가리킬 말이 없다
            # 리액션은 누른 시각을 주지 않아 원래 메시지 바로 뒤에 둔다. "네 그렇게 해요" 처럼 합의로 읽힌다
            for r in m.reactions:
                emoji = r.emoji if isinstance(r.emoji, str) else f":{r.emoji.name}:"
                async for u in r.users():
                    out.append((str(u.id), u.display_name, u.bot, m.created_at, f"{emoji} (위 메시지에 반응)"))
        return out
    finally:
        await client.close()


def judge_chat(transcript: Transcript, names: dict[str, str], today, candidates, *, run=None, cfg=None):
    """봇·워커와 같은 판단 경로(capture.judge_path)로 판단한다. (JudgeOutput, []) 또는 (None, 빠진 설정 이름).

    유사 검색은 BE 대신 candidates 로 끼우므로 BE 설정은 보지 않는다. names 는 to_transcript 의 {uid: 이름} 이다.
    등록할 항목 없이 판단 실패만 남으면 judge_path.JudgeAllFailed 가 난다.
    """
    from capture import judge_path

    extract = judge_path.build_extractor(run=run, candidates=candidates, cfg=cfg)
    if extract is None:
        return None, judge_path.missing_settings(cfg, run=run, candidates=candidates)
    return extract(transcript, names, today, workspace_id="chat_poll"), []


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
    humans = [m for m in messages if not m[2]]
    print(f"[chat] 메시지 {len(messages)}개 (사람 {len(humans)}개)")
    if humans and not any(m[4].strip() for m in humans):
        print("사람 메시지 본문이 전부 비어 있습니다. 개발자 포털에서 Message Content Intent 를 켜세요.", file=sys.stderr)
        return 1

    transcript, names = to_transcript(messages)
    if not transcript.segments:
        print("판단할 메시지가 없습니다.")
        return 0
    for s in transcript.segments:
        print(f"  {s.seq:>3} {names.get(s.speaker, s.speaker)}: {s.text}")

    from capture.judge_path import JudgeAllFailed
    from judge.eval_pipeline import EmbeddingCandidates

    tasks = json.loads(open(args.tasks, encoding="utf-8").read())["tasks"] if args.tasks else []
    today = datetime.now(ZoneInfo(cfg.meeting_timezone)).date()
    try:
        out, missing = judge_chat(transcript, names, today, EmbeddingCandidates(tasks), cfg=cfg)
    except JudgeAllFailed as e:
        print(f"판단 실패: {e}", file=sys.stderr)
        return 1
    if out is None:
        print(f"판단 경로 설정이 없습니다: {', '.join(missing)}", file=sys.stderr)
        return 1

    print(f"\n[items {len(out.items)}건]")
    for i in out.items:
        print(f"  {i['action']:<6} target={i['target_task_id']} category={i['category']} title={i['task_title']!r} "
              f"due={i['due_date']} status={i['status']} assignee={i['assignee_raw']!r}\n         {i['doc_text']}")
    print(f"[failures {len(out.failures)}건]")
    for f in out.failures:
        print(f"  {f['stage']}: {f['text']!r} — {f['reason']}")

    RUNS_DIR.mkdir(parents=True, exist_ok=True)
    path = RUNS_DIR / f"chat_poll_{datetime.now():%Y%m%d_%H%M%S}.json"
    path.write_text(json.dumps({"transcript": transcript.to_dict(), "speaker_names": names, "items": out.items,
                                "failures": out.failures, "dropped": out.dropped},
                               ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"결과 저장: {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
