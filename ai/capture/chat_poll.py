"""채팅 폴링 — 하루 한 번(systemd timer) 채널의 새 메시지를 읽어 BE 에 채팅 회의 하나로 넘긴다.

이어 읽는 자리는 BE 가 정한다. GET /workspaces/{id}/chat-cursor 가 BE 가 이미 가진 마지막 채팅 메시지 시각을 주고,
그 뒤 메시지만 읽는다(없으면 now - chat_poll_initial_hours). 한 번에 chat_poll_max_days 까지만 따라잡는다.

  1 BE 가 준 워크스페이스로 커서 조회   2 커서 뒤 사람 메시지 읽기   3 그 앞 메시지를 참고 문맥으로 읽기(판단만, 저장 안 함)
  4 POST /meetings(source=chat, started_at=첫 새 메시지)   5 end   6 sources(새 메시지만)   7 판단   8 POST /extractions

메시지마다 end = start 로 보낸다. BE 의 커서는 started_at + 가장 늦은 발화 끝이라 마지막 새 메시지 시각과 정확히 같아지고,
다음 실행이 거기서 이어 읽는다. 같은 메시지를 두 번 읽지 않으므로 제안이 중복되지 않는다. 회의를 만든 뒤 실패하면 fail 로
닫는다. failed 회의는 커서에 들지 않아 다음 실행이 같은 구간을 다시 읽는다.

화자는 음성 회의와 같이 작성자 uid, 판단은 같은 추출기(capture/judge_path.py)다. 봇 메시지와 본문 없는 메시지는 뺀다.
게이트웨이에 붙지 않고 REST 로만 읽는다. 개발자 포털에서 Message Content Intent 를 켜야 본문이 온다.

실행 (ai/ 디렉토리 안에서):
    python -m capture.chat_poll [--workspace ID] [--dry-run]
봇 토큰은 DISCORD_BOT_TOKEN(음성 봇과 같다). 읽을 채널은 BE 가 알려 준다(GET /bot/chat-channels, 워크스페이스마다 하나).
--workspace 는 그 워크스페이스만. --dry-run 은 BE 에 쓰지 않고 판단만 해 runs/ 에 저장한다.
워크스페이스 하나가 실패해도 나머지는 돌고 종료 코드는 1 이다. 봇이 채널을 읽을 수 없으면(403·404) 경고하고 건너뛴다(종료 코드 0).
주의: 동시에 두 번 돌리면 제안이 중복된다. 서버에서 손으로 돌릴 때는 `systemctl start mm-chat-poll.service` 를 쓴다(유닛의 flock 이 타이머 실행과 겹치지 않게 막는다).
실행마다 runs/chat_poll_attempt_<워크스페이스>.json 에 시도를 남기고 성공하면 지운다(_begin_attempt).
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time
from datetime import date, datetime, timedelta, timezone
from typing import Protocol
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


def _kept(messages: list[Message]) -> list[Message]:
    # 리액션 줄은 원래 메시지와 시각이 같고 목록에서 바로 뒤에 있다. 정렬이 안정적이라 그 자리를 지킨다
    return sorted((m for m in messages if not m[2] and m[4].strip()), key=lambda m: m[3])


def to_transcript(messages: list[Message]) -> tuple[Transcript, dict[str, str]]:
    """사람이 쓴 본문 있는 메시지만 시간순 전사록으로. start 는 첫 메시지 기준 초다.

    speaker 는 작성자 uid 다. 표시 이름은 {uid: 이름} 으로 따로 돌려준다(음성 매니페스트의 speakers 와 같은 구실).
    """
    kept = _kept(messages)
    if not kept:
        return Transcript(segments=[], source="chat"), {}
    t0 = kept[0][3]
    segments, names = [], {}
    for seq, (uid, name, _, at, text) in enumerate(kept, start=1):
        start = (at - t0).total_seconds()
        segments.append(TranscriptSegment(speaker=uid, start=start, end=start, text=text.strip(), seq=seq))
        names[uid] = name
    return Transcript(segments=segments, source="chat"), names


def message_dates(messages: list[Message], tz: str) -> dict[int, date]:
    """to_transcript 의 seq → 그 메시지를 쓴 날(tz 기준). "내일" 같은 상대 날짜는 메시지 작성일로 푼다."""
    zone = ZoneInfo(tz)
    return {seq: m[3].astimezone(zone).date() for seq, m in enumerate(_kept(messages), start=1)}


class ChannelUnreadable(Exception):
    """봇이 채널을 읽을 수 없다(디스코드 403·404). 설정 문제라 그 워크스페이스만 건너뛴다."""


class ChannelReader(Protocol):
    def read(self, after: datetime, before: datetime) -> list[Message]:
        """after 이후 before 까지(리액션 포함), 오래된 것부터."""

    def read_before(self, before: datetime, limit: int) -> list[Message]:
        """before 앞의 사람 메시지 최대 limit 개, 오래된 것부터. 리액션은 없다."""


class DiscordReader:
    """REST 로 채널을 읽는다. 로그인은 한 번이고 세 메서드가 나눠 쓴다. close() 로 닫는다."""

    def __init__(self, token: str, channel_id: int) -> None:
        self._token, self._channel_id = token, channel_id
        self._loop = asyncio.new_event_loop()
        self._client = None
        self._channel = None

    def _run(self, coro):
        import discord

        try:
            return self._loop.run_until_complete(coro)
        except (discord.Forbidden, discord.NotFound) as e:
            raise ChannelUnreadable(f"{type(e).__name__}: {e}") from e

    async def _channel_(self):
        if self._channel is None:
            import discord

            self._client = discord.Client(intents=discord.Intents.none())
            await self._client.login(self._token)
            self._channel = await self._client.fetch_channel(self._channel_id)
        return self._channel

    def close(self) -> None:
        if self._client is not None:
            self._run(self._client.close())
        self._loop.close()

    def read(self, after: datetime, before: datetime) -> list[Message]:
        async def go():
            channel = await self._channel_()
            out: list[Message] = []
            async for m in channel.history(after=after, before=before, oldest_first=True, limit=None):
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

        return self._run(go())

    def read_before(self, before: datetime, limit: int) -> list[Message]:
        async def go():
            channel = await self._channel_()
            out: list[Message] = []
            async for m in channel.history(before=before, limit=limit):
                text = clean_text(m.content, {u.id: u.display_name for u in m.mentions})
                if not m.author.bot and text:
                    out.append((str(m.author.id), m.author.display_name, False, m.created_at, text))
            return out[::-1]

        return self._run(go())


def _attempt_path(workspace_id: str):
    return RUNS_DIR / f"chat_poll_attempt_{workspace_id}.json"


def _begin_attempt(workspace_id: str, cursor: datetime | None, after: datetime) -> datetime:
    """이번 실행을 시도로 남기고 읽기 시작 시각을 돌려준다. 성공하면 _end_attempt 가 지운다.

    실패한 회의는 커서에 들지 않아 같은 구간을 다시 읽는다. 매번 실패하는 구간이면 수집이 멈추므로, 같은 커서에서 두 번째
    시도부터 경고한다. 시작할 때 남기므로 시간 제한으로 죽어 except 를 못 탄 실행도 센다.
    커서가 없을 때(첫 실행) 실패하면 다음 실행의 now - initial_hours 가 그 구간을 건너뛰므로 지난 시작점부터 읽는다.
    ponytail: 기록은 이 서버의 runs/ 에만 있다. 서버를 옮기거나 runs/ 를 지우면 센 횟수와 첫 실행 시작점을 잃는다.
    """
    path = _attempt_path(workspace_id)
    try:
        prev = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        prev = None
    key = cursor.isoformat() if cursor else None
    count = 1
    if isinstance(prev, dict) and prev.get("cursor") == key:
        count = int(prev.get("count", 0)) + 1
        if cursor is None and prev.get("after"):
            after = min(after, datetime.fromisoformat(prev["after"]))
    if count >= 2:
        print(f"[chat] ws={workspace_id} 경고: 같은 구간(커서 {key or '없음'}, {after:%Y-%m-%d %H:%M} 이후)에서 {count}번째 시도입니다. "
              f"지난 {count - 1}번은 끝나지 못했습니다(failed 채팅 회의·journal 을 확인하세요).", file=sys.stderr)
    RUNS_DIR.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"cursor": key, "after": after.isoformat(), "count": count}), encoding="utf-8")
    return after


def _end_attempt(workspace_id: str) -> None:
    _attempt_path(workspace_id).unlink(missing_ok=True)


def poll(reader: ChannelReader, client, extract, *, workspace_id: str, now: datetime, cfg, dry_run: bool = False) -> int:
    """한 번 돈다. 종료 코드를 돌려준다(0 정상·읽을 것 없음, 1 실패)."""
    from capture.handoff import clean_item
    from capture.judge_path import JudgeAllFailed

    ws = workspace_id
    cursor = client.chat_cursor(ws)
    after = cursor or now - timedelta(hours=cfg.chat_poll_initial_hours)
    if not dry_run:
        after = _begin_attempt(ws, cursor, after)
    # 커서 뒤 ~ now 를 다 읽고 첫 사람 메시지부터 max_days 까지만 보낸다. 나머지는 커서가 나아간 다음 실행이 읽는다.
    # 읽는 구간을 먼저 자르면 그 안에 메시지가 없을 때 커서가 못 나아가 같은 빈 구간에서 영원히 멈춘다.
    # 이미 BE 에 있는 시각(커서 이하)과 now 이후는 뺀다. 리액션 줄도 원래 메시지 시각이라 같이 빠진다
    messages = [m for m in reader.read(after, now) if after < m[3] < now]
    kept0 = _kept(messages)
    if kept0:
        limit = kept0[0][3] + timedelta(days=cfg.chat_poll_max_days)   # 발화 offset 은 BE 가 14일까지만 받는다
        messages = [m for m in messages if m[3] <= limit]
    humans = [m for m in messages if not m[2]]
    if humans and not any(m[4].strip() for m in humans):
        print("사람 메시지 본문이 전부 비어 있습니다. 개발자 포털에서 Message Content Intent 를 켜세요.", file=sys.stderr)
        return 1
    transcript, names = to_transcript(messages)
    if not transcript.segments:
        print("새 메시지가 없습니다.")
        if not dry_run:
            _end_attempt(ws)
        return 0
    kept = _kept(messages)
    first_at = kept[0][3]
    tz = ZoneInfo(cfg.meeting_timezone)
    dates = message_dates(messages, cfg.meeting_timezone)
    today = kept[-1][3].astimezone(tz).date()
    print(f"[chat] ws={ws} 새 메시지 {len(transcript.segments)}개 ({after:%Y-%m-%d %H:%M} 이후)")

    ctx_messages = reader.read_before(first_at, cfg.chat_poll_context_messages)
    # 한 줄로 접는다. 여러 줄 메시지가 번호 매긴 프롬프트 줄처럼 보이면 안 된다(reader 가 이미 접었어도 한 번 더 지킨다)
    context, ctx_names = to_transcript([(*m[:4], clean_text(m[4], {})) for m in ctx_messages])
    # 참고 문맥은 판단에만 쓴다. 저장(sources)에는 새 메시지만 간다
    all_names = {**ctx_names, **names}
    extra = {"context": context} if context.segments else {}

    def run_extract():
        return extract(transcript, all_names, today, workspace_id=ws, dates=dates, **extra)

    if dry_run:
        try:
            out = run_extract()
        except JudgeAllFailed as e:
            print(f"판단 실패: {e}", file=sys.stderr)
            return 1
        print(f"[items {len(out.items)}건]")
        for i in out.items:
            print(f"  {str(i.get('action')):<6} title={i.get('task_title')!r} due={i.get('due_date')}")
        RUNS_DIR.mkdir(parents=True, exist_ok=True)
        path = RUNS_DIR / f"chat_poll_{datetime.now():%Y%m%d_%H%M%S}.json"
        path.write_text(json.dumps({"transcript": transcript.to_dict(), "speaker_names": all_names,
                                    "context": context.to_dict(), "items": out.items, "failures": out.failures,
                                    "dropped": out.dropped}, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"결과 저장: {path}")
        return 0

    title = "채팅 " + first_at.astimezone(tz).strftime("%Y-%m-%d")
    meeting_id = client.create_meeting(ws, title=title, source="chat", started_at=first_at)["meeting_id"]
    stage = "sources"
    try:
        client.end_meeting(meeting_id)
        client.create_sources(meeting_id, transcript.to_dict(), names)
        stage = "extract"
        out = run_extract()
        stage = "handoff"
        client.create_extraction(meeting_id, ws, transcript_path=None, model_name=None,
                                 items=[clean_item(i) for i in out.items])
    except Exception as e:  # noqa: BLE001 - 어느 단계든 회의를 failed 로 닫고 1 로 끝낸다
        print(f"[chat] ws={ws} {stage} 실패: {type(e).__name__}: {e}", file=sys.stderr)
        try:
            client.fail_meeting(meeting_id, stage)
        except Exception as e2:  # noqa: BLE001
            print(f"[chat] ws={ws} 실패 통보도 실패: {e2}", file=sys.stderr)
        return 1
    _end_attempt(ws)
    print(f"[chat] ws={ws} 회의 {meeting_id} 등록, 항목 {len(out.items)}건, 판단 못 한 것 {len(out.failures)}건")
    return 0


def poll_all(channels: list[dict], open_reader, client, extract, *, now: datetime, cfg, dry_run: bool = False,
             only: str | None = None) -> int:
    """BE 가 준 채널마다 워크스페이스별로 poll 한다. 하나가 실패해도 나머지는 돌고, 실패가 있으면 1."""
    if only is not None:
        channels = [c for c in channels if c.get("workspace_id") == only]
        if not channels:
            print(f"[chat] 워크스페이스 {only} 는 채팅 채널 목록에 없습니다.", file=sys.stderr)
            return 1
    rc = 0
    for c in channels:
        ws, started = c.get("workspace_id"), time.monotonic()
        try:
            ws, channel_id = c["workspace_id"], c["channel_id"]
            reader = open_reader(int(channel_id))
            try:
                if poll(reader, client, extract, workspace_id=ws, now=now, cfg=cfg, dry_run=dry_run):
                    rc = 1
            finally:
                if hasattr(reader, "close"):
                    reader.close()
        except ChannelUnreadable as e:
            print(f"[chat] ws={ws} 채널 {c.get('channel_id')} 을 읽을 수 없어 건너뜁니다: {e}", file=sys.stderr)
        except Exception as e:  # noqa: BLE001 - 한 워크스페이스의 실패가 나머지를 막지 않는다
            print(f"[chat] ws={ws} 실패: {type(e).__name__}: {e}", file=sys.stderr)
            rc = 1
        print(f"[chat] ws={ws} {time.monotonic() - started:.1f}초")
    return rc


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--workspace", help="이 워크스페이스 ID 만 돈다. 없으면 BE 가 알려 준 전부")
    parser.add_argument("--dry-run", action="store_true", help="BE 에 쓰지 않고 판단만 해 runs/ 에 저장")
    args = parser.parse_args()

    cfg = settings()
    if not cfg.discord_bot_token:
        print("DISCORD_BOT_TOKEN 이 필요합니다.", file=sys.stderr)
        return 1
    if not cfg.be_base_url or not cfg.be_service_token:
        print("BE_BASE_URL 과 BE_SERVICE_TOKEN 이 필요합니다.", file=sys.stderr)
        return 1

    from capture import judge_path
    from capture.handoff import BeClient

    client = BeClient(cfg.be_base_url, service_token=cfg.be_service_token)
    extract = judge_path.build_extractor(candidates=client, cfg=cfg)
    if extract is None:
        print(f"판단 경로 설정이 없습니다: {', '.join(judge_path.missing_settings(cfg, candidates=client))}",
              file=sys.stderr)
        return 1
    from capture.handoff import BeError

    try:
        channels = client.chat_channels()
    except BeError as e:
        print(f"채팅 채널 목록을 못 받았습니다: {e}", file=sys.stderr)
        return 1
    return poll_all(channels, lambda cid: DiscordReader(cfg.discord_bot_token, cid), client, extract,
                    now=datetime.now(timezone.utc), cfg=cfg, dry_run=args.dry_run, only=args.workspace)


if __name__ == "__main__":
    sys.exit(main())
