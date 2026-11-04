"""리마인드 DM (py-cord Cog). PM 이 승인한 메시지를 팀원에게 디스코드 DM 으로 보내고, 팀원이 봇에게 쓴 DM 을 BE 에 넘긴다.

계약은 backend/docs/contracts/backend-ai-contract.md 의 "리마인드 DM" 이다.

  DM_POLL_S 마다     POST /bot/messages/claim           보낼 메시지. 한 메시지는 한 곳에 한 번만 나온다
  보낸 뒤            POST /bot/messages/{id}/result     delivered + 나간 id 들, 또는 failed(dm_blocked|unknown)
  DM 을 받으면       POST /bot/replies                  같은 discord_message_id 는 BE 가 한 번만 저장한다
  DRAFT_POLL_S 마다  POST /bot/drafts/claim → draft_reminder → POST /bot/drafts/{bundle_id}

한 번만 보내기. claim 이 같은 메시지를 다시 주지 않으므로 봇은 보내기 전에 발송 기록(sent/<message_id>.json)을
outcome 없이 쓰고, 조각이 나갈 때마다 나간 id 를 더해 다시 쓰고, 끝나면 outcome 을 적는다. 재시작 때 outcome 없이
남은 기록은 보내다 죽은 것이라 다시 보내지 않고, 조각이 다 나갔으면 delivered, 아니면 나간 id 만 실어 unknown 으로
보고한다. 보고하지 못한 결과는 기록에 남아 다음 바퀴에 다시 보고한다(늦은 보고는 BE 가 받는다).

답장. DM 은 받는 즉시 큐(replies/<discord_message_id>.json)에 쓰고 넘긴다. 넘기지 못한 것은 다음 바퀴에 디스코드
id 순서(snowflake 라 시간순)로 다시 넘긴다. 디스코드는 봇이 꺼진 동안의 DM 을 다시 주지 않으므로, 프로세스가 뜰 때
한 번 최근 BACKFILL_DAYS 안에 봇이 DM 을 보낸 사람(recipients.json)마다 마지막으로 넘긴 글 뒤의 DM 기록을 읽어
넘긴다. 메우기는 첫 발송보다 먼저 한다. 새 DM 이 그 사람의 표시(after_id)를 꺼진 동안의 답장 뒤로 옮기기 때문이다.

DM 글은 message_content 특권 인텐트 없이도 오고, dm_messages 는 Intents.default() 에 이미 있다.
BE 호출은 동기 requests 라 asyncio.to_thread 로 불러 게이트웨이를 막지 않는다. 파일은 FileOutbox 처럼 tmp 에 쓰고
이름을 바꿔 원자적으로 쓴다.
"""

from __future__ import annotations

import asyncio
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import discord

from capture.handoff import BeClient, BeError
from capture.notify import MESSAGE_MAX
from draft.reminder_draft import draft_reminder
from shared.config import RECORDINGS_DIR
from shared.schemas import now_iso

DM_POLL_S = 5.0
DRAFT_POLL_S = 30.0
BACKFILL_DAYS = 7
BACKFILL_LIMIT = 200

# 다시 보내도 같은 답이라 기록을 지운다. 그 밖(NETWORK, 5xx, 401)은 남겨 다음 바퀴에 다시
RESULT_SETTLED = {"MESSAGE_RESULT_CONFLICT", "MESSAGE_NOT_FOUND", "INVALID_REQUEST"}
REPLY_DROPPED = {"MEMBER_NOT_FOUND", "INVALID_REQUEST"}
DRAFT_DROPPED = {"DRAFT_STALE", "REMINDER_BUNDLE_NOT_FOUND"}


def split_body(body: str, limit: int = MESSAGE_MAX) -> list[str]:
    """limit 자 이하 조각들. 마지막 줄바꿈, 없으면 마지막 공백, 그것도 없으면 limit 에서 자른다.

    자른 자리의 공백은 앞 조각 끝에 남아 이어 붙이면 원문과 같다. 디스코드가 공백뿐인 글을 거절하므로 그런
    자리에서는 자르지 않고, 경계를 넘는 긴 공백 끝에 공백뿐인 조각이 생기면 버린다.
    """
    parts = []
    while len(body) > limit:
        window = body[:limit]
        cut = next((i + 1 for i in (window.rfind("\n"), window.rfind(" ")) if i >= 0 and window[:i + 1].strip()),
                   limit)
        parts.append(body[:cut])
        body = body[cut:]
    parts.append(body)
    return [p for p in parts if p.strip()] if len(parts) > 1 else parts


def _write_json(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.tmp")
    tmp.write_text(json.dumps(obj, ensure_ascii=False), encoding="utf-8")
    tmp.replace(path)


def _read_json(path: Path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return default


def _result_body(rec: dict) -> dict:
    return {**rec["outcome"], "discord_message_ids": rec["parts_sent"]}


def _is_final(e: BeError, codes: set[str]) -> bool:
    """BE 의 영구 거절인지. 없는 경로의 404 도 INVALID_REQUEST 라서, 그 코드는 400 일 때만 거절로 읽는다."""
    return e.code in codes and (e.code != "INVALID_REQUEST" or e.status == 400)


class DmCog(discord.Cog):
    def __init__(self, bot: discord.Bot, *, be: BeClient, recordings_dir: Path = RECORDINGS_DIR, drafter=None):
        """be 는 서비스 토큰을 가진 BeClient. drafter(item) 는 초안 본문이나 None 이고 기본은 draft_reminder 다."""
        self.bot = bot
        self.be = be
        self.dir = Path(recordings_dir) / ".bot" / "dm"
        self._drafter = drafter or draft_reminder
        self._send_task: asyncio.Task | None = None
        self._draft_task: asyncio.Task | None = None
        self._started = False
        if bot.is_ready():
            try:
                self.start_loops()
            except RuntimeError:                             # 이벤트 루프 밖에서 붙였다. 다음 on_ready 에 뜬다
                pass

    # ------------------------------------------------------------------ 루프
    @discord.Cog.listener()
    async def on_ready(self) -> None:
        self.start_loops()

    def start_loops(self) -> None:
        """발송 루프와 초안 루프. on_ready 가 재연결로 다시 와도 하나씩만 돈다."""
        loop = asyncio.get_running_loop()
        if self._send_task is None or self._send_task.done():
            self._send_task = loop.create_task(self._send_loop())
        if self._draft_task is None or self._draft_task.done():
            self._draft_task = loop.create_task(self._draft_loop())

    def cog_unload(self) -> None:
        for task in (self._send_task, self._draft_task):
            if task is not None:
                task.cancel()

    async def _send_loop(self) -> None:
        if not self._started:
            self._started = True
            try:
                await self.startup()
            except Exception as e:  # noqa: BLE001
                print(f"[dm] 시작 정리 예외: {type(e).__name__}: {e}", flush=True)
        while True:
            try:
                await self.run_round()
            except Exception as e:  # noqa: BLE001 - 한 바퀴의 실패가 발송을 멈추면 안 된다
                print(f"[dm] 발송 바퀴 예외: {type(e).__name__}: {e}", flush=True)
            await asyncio.sleep(DM_POLL_S)

    async def _draft_loop(self) -> None:
        while True:
            try:
                await self.draft_round()
            except Exception as e:  # noqa: BLE001
                print(f"[dm] 초안 바퀴 예외: {type(e).__name__}: {e}", flush=True)
            await asyncio.sleep(DRAFT_POLL_S)

    async def startup(self) -> None:
        """프로세스에 한 번. 보내다 죽은 기록의 결과를 정하고, 꺼진 동안 온 답장을 메운다."""
        for path in sorted((self.dir / "sent").glob("*.json")):
            rec = _read_json(path, None)
            if rec is None or rec.get("outcome") is not None:
                continue
            done = rec["parts_sent"] and len(rec["parts_sent"]) == rec.get("parts_total")
            rec["outcome"] = {"status": "delivered"} if done else {"status": "failed", "failure_reason": "unknown"}
            _write_json(path, rec)
        await self._backfill()

    async def run_round(self) -> None:
        """남은 결과 보고 → 남은 답장 넘기기 → claim 한 메시지 보내고 보고."""
        for path in sorted((self.dir / "sent").glob("*.json")):
            await self._report(path)
        await self._flush_replies()
        try:
            data = await self._call("POST", "/bot/messages/claim")
        except BeError as e:
            print(f"[dm] 보낼 메시지를 가져오지 못했다: {e}", flush=True)
            return
        for item in data.get("items") or []:
            await self._report(await self._deliver(item))

    # ------------------------------------------------------------------ 발송
    async def _call(self, method: str, path: str, body: dict | None = None):
        return await asyncio.to_thread(self.be._call, method, path, body)

    async def _deliver(self, item: dict) -> Path:
        uid = str(item["discord_user_id"])
        parts = split_body(item["body"])
        path = self.dir / "sent" / f"{item['message_id']}.json"
        rec = {"message_id": item["message_id"], "discord_user_id": uid, "parts_total": len(parts),
               "parts_sent": [], "outcome": None}
        _write_json(path, rec)
        try:
            user = self.bot.get_user(int(uid)) or await self.bot.fetch_user(int(uid))
            for chunk in parts:
                sent = await user.send(chunk)
                rec["parts_sent"].append(str(sent.id))
                _write_json(path, rec)
                self._mark(uid, sent.id, dm=True)
            rec["outcome"] = {"status": "delivered"}
        except discord.Forbidden:
            rec["outcome"] = {"status": "failed", "failure_reason": "dm_blocked"}
        except Exception as e:  # noqa: BLE001 - NotFound, HTTPException, 연결 오류 모두 unknown 이다
            print(f"[dm] {item['message_id']} 발송 실패: {type(e).__name__}: {e}", flush=True)
            rec["outcome"] = {"status": "failed", "failure_reason": "unknown"}
        _write_json(path, rec)
        return path

    async def _report(self, path: Path) -> None:
        rec = _read_json(path, None)
        if rec is None or rec.get("outcome") is None:
            return
        try:
            await self._call("POST", f"/bot/messages/{rec['message_id']}/result", _result_body(rec))
        except BeError as e:
            if not _is_final(e, RESULT_SETTLED):
                print(f"[dm] {rec['message_id']} 결과 보고 실패, 다음 바퀴에 다시: {e}", flush=True)
                return
            if e.code != "MESSAGE_RESULT_CONFLICT":
                print(f"[dm] {rec['message_id']} 결과를 BE 가 받지 않아 버린다: {e}", flush=True)
        path.unlink(missing_ok=True)

    # ------------------------------------------------------------------ 답장
    @discord.Cog.listener()
    async def on_message(self, message) -> None:
        if message.guild is not None or message.author.bot:
            return
        self._queue_reply(message)
        await self._flush_replies()

    def _queue_reply(self, message) -> None:
        ref = getattr(message, "reference", None)
        uid = str(message.author.id)
        _write_json(self.dir / "replies" / f"{message.id}.json", {
            "discord_user_id": uid, "discord_message_id": str(message.id), "body": message.content or "",
            "sent_at": message.created_at.isoformat(),
            "reply_to_discord_message_id": str(ref.message_id) if ref and ref.message_id else None,
        })
        self._mark(uid, message.id)

    async def _flush_replies(self) -> None:
        for path in sorted((self.dir / "replies").glob("*.json"), key=lambda p: int(p.stem)):
            body = _read_json(path, None)
            if body is None:
                path.unlink(missing_ok=True)
                continue
            try:
                await self._call("POST", "/bot/replies", body)
            except BeError as e:
                if not _is_final(e, REPLY_DROPPED):
                    print(f"[dm] 답장 {path.stem} 넘기기 실패, 다음 바퀴에 다시: {e}", flush=True)
                    return
                print(f"[dm] 답장 {path.stem} 을 BE 가 받지 않아 버린다: {e}", flush=True)
            path.unlink(missing_ok=True)

    def _mark(self, uid: str, message_id, *, dm: bool = False) -> None:
        """메우기 표시. 봇이 DM 을 보냈으면 그 사람을 기록에 올리고, 답장은 이미 있는 사람의 표시만 앞으로 옮긴다."""
        path = self.dir / "recipients.json"
        recipients = _read_json(path, {})
        entry = recipients.get(uid)
        if entry is None and not dm:
            return
        entry = entry or {"after_id": "0"}
        entry["after_id"] = str(max(int(entry["after_id"]), int(message_id)))
        if dm:
            entry["last_dm_at"] = now_iso()
        recipients[uid] = entry
        _write_json(path, recipients)

    async def _backfill(self) -> None:
        since = datetime.now(timezone.utc) - timedelta(days=BACKFILL_DAYS)
        for uid, entry in _read_json(self.dir / "recipients.json", {}).items():
            if datetime.fromisoformat(entry["last_dm_at"]) < since:
                continue
            try:
                user = self.bot.get_user(int(uid)) or await self.bot.fetch_user(int(uid))
                channel = user.dm_channel or await user.create_dm()
                async for m in channel.history(after=discord.Object(int(entry["after_id"])), oldest_first=True,
                                               limit=BACKFILL_LIMIT):
                    if not m.author.bot:
                        self._queue_reply(m)
            except Exception as e:  # noqa: BLE001 - 한 사람의 실패가 다른 사람의 메우기를 막지 않는다
                print(f"[dm] {uid} DM 기록을 읽지 못했다: {type(e).__name__}: {e}", flush=True)
        await self._flush_replies()

    # ------------------------------------------------------------------ 초안
    async def draft_round(self) -> None:
        """초안이 필요한 묶음마다 draft_reminder 로 쓰고 넣는다. 못 썼으면 null 이라 규칙 문구가 나간다."""
        try:
            data = await self._call("POST", "/bot/drafts/claim")
        except BeError as e:
            print(f"[dm] 초안 묶음을 가져오지 못했다: {e}", flush=True)
            return
        for item in data.get("items") or []:
            try:
                body = await asyncio.to_thread(self._drafter, item)
            except Exception as e:  # noqa: BLE001 - 다시 가져가 다시 부르지 않게 규칙 문구로 끝낸다
                print(f"[dm] 묶음 {item['bundle_id']} 초안 예외: {type(e).__name__}: {e}", flush=True)
                body = None
            try:
                await self._call("POST", f"/bot/drafts/{item['bundle_id']}",
                                 {"draft_version": item["draft_version"], "body": body})
            except BeError as e:
                if e.code not in DRAFT_DROPPED:
                    print(f"[dm] 묶음 {item['bundle_id']} 초안을 넣지 못했다: {e}", flush=True)
