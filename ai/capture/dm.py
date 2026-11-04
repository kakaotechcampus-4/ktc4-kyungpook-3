"""리마인드 DM (py-cord Cog). PM 이 승인한 메시지를 팀원에게 디스코드 DM 으로 보내고, 팀원이 봇에게 쓴 DM 을 BE 에 넘긴다.

계약은 backend/docs/contracts/backend-ai-contract.md 의 "리마인드 DM" 이다.

  DM_POLL_S 마다     POST /bot/messages/claim           보낼 메시지. 한 메시지는 한 곳에 한 번만 나온다
  보낸 뒤            POST /bot/messages/{id}/result     delivered + 나간 id 들, 또는 failed(dm_blocked|unknown)
  DM 을 받으면       POST /bot/replies                  같은 discord_message_id 는 BE 가 한 번만 저장한다
  DRAFT_POLL_S 마다  POST /bot/drafts/claim → draft_reminder → POST /bot/drafts/{bundle_id}
  REPLY_POLL_S 마다  POST /bot/replies/claim → judge_reply → POST /bot/replies/{message_id}/judgment

한 번만 보내기. claim 이 같은 메시지를 다시 주지 않으므로 봇은 보내기 전에 발송 기록(sent/<message_id>.json)을
outcome 없이 쓰고, 조각이 나갈 때마다 나간 id 를 더해 다시 쓰고, 끝나면 outcome 을 적는다. 재시작 때 outcome 없이
남은 기록은 보내다 죽은 것이라 다시 보내지 않고, 조각이 다 나갔으면 delivered, 아니면 나간 id 만 실어 unknown 으로
보고한다. 보고하지 못한 결과는 기록에 남아 다음 바퀴에 다시 보고한다(늦은 보고는 BE 가 받는다).

답장. DM 은 받는 즉시 큐(replies/<discord_message_id>.json)에 쓰고 넘긴다. 넘기지 못한 것은 다음 바퀴에 디스코드
id 순서(snowflake 라 시간순)로 다시 넘긴다. 디스코드는 봇이 끊긴 동안의 DM 을 다시 주지 않으므로, on_ready 마다
최근 BACKFILL_DAYS 안에 봇이 DM 을 보낸 사람(recipients.json)의 DM 기록을 표시(after_id) 뒤부터 끝까지 읽어 넘긴다.
표시는 기록을 끝까지 읽었을 때만 옮긴다. 발송이나 실시간 DM 이 옮기면 읽지 않은 구간을 건너뛰어 그 답장이 영영 빠진다.
겹쳐 읽은 글은 BE 가 한 번만 저장한다. BE 가 답장이 어느 DM 에 달렸는지 결과 보고로 알기 때문에 메우기 전에 남은
결과부터 보고한다.

답장 판단. 판단할 답장은 BE 에 쌓여 있어(웹 답장은 봇이 보지 못한다) 맡고 보고만 한다. 봇에 남기는 것이 없다. 맡은 뒤
죽거나 보고하지 못하면 BE 가 리스 뒤 attempt 를 올려 다시 맡기고, 앞 attempt 의 늦은 보고는 STALE 로 돌아온다.

DM 글은 message_content 특권 인텐트 없이도 오고, dm_messages 는 Intents.default() 에 이미 있다.
BE 호출은 동기 requests 라 asyncio.to_thread 로 불러 게이트웨이를 막지 않는다. 파일은 FileOutbox 처럼 tmp 에 쓰고
이름을 바꿔 원자적으로 쓴다.
"""

from __future__ import annotations

import asyncio
import hashlib
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
REPLY_POLL_S = 10.0
BACKFILL_DAYS = 7

# 다시 보내도 같은 답이라 기록을 지운다. 그 밖(NETWORK, 5xx, 401)은 남겨 다음 바퀴에 다시
RESULT_SETTLED = {"MESSAGE_RESULT_CONFLICT", "MESSAGE_NOT_FOUND", "INVALID_REQUEST"}
REPLY_DROPPED = {"MEMBER_NOT_FOUND", "INVALID_REQUEST"}
DRAFT_DROPPED = {"DRAFT_STALE", "REMINDER_BUNDLE_NOT_FOUND"}
JUDGMENT_DROPPED = {"REPLY_JUDGMENT_STALE", "REPLY_JUDGMENT_NOT_FOUND"}


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


def _nonce(message_id: str, part: int) -> str:
    """디스코드 nonce 는 25자까지다. py-cord 가 5xx 뒤 같은 요청을 다시 보내도 enforce_nonce 면 글이 하나만 생긴다."""
    return hashlib.sha256(f"{message_id}:{part}".encode()).hexdigest()[:25]


def _result_body(rec: dict) -> dict:
    return {**rec["outcome"], "discord_message_ids": rec["parts_sent"]}


def _is_final(e: BeError, codes: set[str]) -> bool:
    """BE 의 영구 거절인지. 없는 경로의 404 도 INVALID_REQUEST 라서, 그 코드는 400 일 때만 거절로 읽는다."""
    return e.code in codes and (e.code != "INVALID_REQUEST" or e.status == 400)


class DmCog(discord.Cog):
    def __init__(self, bot: discord.Bot, *, be: BeClient, recordings_dir: Path = RECORDINGS_DIR, drafter=None,
                 judger=None):
        """be 는 서비스 토큰을 가진 BeClient. drafter(item) 는 초안 본문이나 None 이고 기본은 draft_reminder 다.

        judger(item) 는 판단 본문을 돌려주고 전체 실패는 예외다. None 이면 답장 판단 루프를 띄우지 않는다.
        """
        self.bot = bot
        self.be = be
        self.dir = Path(recordings_dir) / ".bot" / "dm"
        self._drafter = drafter or draft_reminder
        self._judger = judger
        self._send_task: asyncio.Task | None = None
        self._draft_task: asyncio.Task | None = None
        self._reply_task: asyncio.Task | None = None
        self._started = False
        if bot.is_ready():
            try:
                self.start_loops()
            except RuntimeError:                             # 이벤트 루프 밖에서 붙였다. 다음 on_ready 에 뜬다
                pass

    # ------------------------------------------------------------------ 루프
    @discord.Cog.listener()
    async def on_ready(self) -> None:
        first = not self._started                       # 첫 번은 발송 루프가 startup 으로 메운다
        self.start_loops()
        if not first:
            await self._catch_up()

    def start_loops(self) -> None:
        """발송, 초안, 답장 판단 루프. on_ready 가 재연결로 다시 와도 하나씩만 돈다."""
        loop = asyncio.get_running_loop()
        if self._send_task is None or self._send_task.done():
            self._send_task = loop.create_task(self._send_loop())
        if self._draft_task is None or self._draft_task.done():
            self._draft_task = loop.create_task(self._draft_loop())
        if self._judger is not None and (self._reply_task is None or self._reply_task.done()):
            self._reply_task = loop.create_task(self._reply_loop())

    def cog_unload(self) -> None:
        for task in (self._send_task, self._draft_task, self._reply_task):
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

    async def _reply_loop(self) -> None:
        while True:
            try:
                await self.reply_round()
            except Exception as e:  # noqa: BLE001
                print(f"[dm] 답장 판단 바퀴 예외: {type(e).__name__}: {e}", flush=True)
            await asyncio.sleep(REPLY_POLL_S)

    async def startup(self) -> None:
        """프로세스에 한 번. 보내다 죽은 기록의 결과를 정하고 끊긴 동안 온 답장을 메운다."""
        for path in sorted((self.dir / "sent").glob("*.json")):
            rec = _read_json(path, None)
            if rec is None or rec.get("outcome") is not None:
                continue
            done = rec["parts_sent"] and len(rec["parts_sent"]) == rec.get("parts_total")
            rec["outcome"] = {"status": "delivered"} if done else {"status": "failed", "failure_reason": "unknown"}
            _write_json(path, rec)
        await self._catch_up()

    async def _catch_up(self) -> None:
        for path in sorted((self.dir / "sent").glob("*.json")):
            await self._report(path)
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
            await self._report(*await self._deliver(item))

    # ------------------------------------------------------------------ 발송
    async def _call(self, method: str, path: str, body: dict | None = None):
        return await asyncio.to_thread(self.be._call, method, path, body)

    def _save(self, path: Path, rec: dict) -> None:
        """DM 이 이미 나간 뒤의 기록. 쓰기가 실패해도 결과를 바꾸지 않는다(디스크가 찬 경우)."""
        try:
            _write_json(path, rec)
        except OSError as e:
            print(f"[dm] {rec['message_id']} 발송 기록을 쓰지 못했다: {e}", flush=True)

    async def _deliver(self, item: dict) -> tuple[Path, dict]:
        uid = str(item["discord_user_id"])
        parts = split_body(item["body"])
        path = self.dir / "sent" / f"{item['message_id']}.json"
        rec = {"message_id": item["message_id"], "discord_user_id": uid, "parts_total": len(parts),
               "parts_sent": [], "outcome": None}
        try:
            _write_json(path, rec)
            user = self.bot.get_user(int(uid)) or await self.bot.fetch_user(int(uid))
            for i, chunk in enumerate(parts):
                sent = await user.send(chunk, nonce=_nonce(item["message_id"], i), enforce_nonce=True)
                rec["parts_sent"].append(str(sent.id))
                self._save(path, rec)
                try:
                    self._note_dm(uid, sent.id)
                except OSError as e:
                    print(f"[dm] {uid} 메우기 대상을 쓰지 못했다: {e}", flush=True)
            rec["outcome"] = {"status": "delivered"}
        except discord.Forbidden:
            rec["outcome"] = {"status": "failed", "failure_reason": "dm_blocked"}
        except Exception as e:  # noqa: BLE001 - NotFound, HTTPException, 연결 오류 모두 unknown 이다
            print(f"[dm] {item['message_id']} 발송 실패: {type(e).__name__}: {e}", flush=True)
            rec["outcome"] = {"status": "failed", "failure_reason": "unknown"}
        self._save(path, rec)
        return path, rec

    async def _report(self, path: Path, rec: dict | None = None) -> None:
        """rec 을 주지 않으면 파일에서 읽는다. 방금 보낸 것은 파일을 못 썼어도 메모리의 결과로 보고한다."""
        rec = rec or _read_json(path, None)
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
        _write_json(self.dir / "replies" / f"{message.id}.json", {
            "discord_user_id": str(message.author.id), "discord_message_id": str(message.id), "body": message.content or "",
            "sent_at": message.created_at.isoformat(),
            "reply_to_discord_message_id": str(ref.message_id) if ref and ref.message_id else None,
        })

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

    def _note_dm(self, uid: str, message_id) -> None:
        """메우기 대상에 올린다. 표시의 시작값은 그 사람에게 처음 보낸 DM 이다."""
        path = self.dir / "recipients.json"
        recipients = _read_json(path, {})
        entry = recipients.setdefault(uid, {"after_id": str(message_id)})
        entry["last_dm_at"] = now_iso()
        _write_json(path, recipients)

    def _read_up_to(self, uid: str, message_id) -> None:
        path = self.dir / "recipients.json"
        recipients = _read_json(path, {})
        recipients[uid]["after_id"] = str(max(int(recipients[uid]["after_id"]), int(message_id)))
        _write_json(path, recipients)

    async def _backfill(self) -> None:
        since = datetime.now(timezone.utc) - timedelta(days=BACKFILL_DAYS)
        for uid, entry in _read_json(self.dir / "recipients.json", {}).items():
            if datetime.fromisoformat(entry["last_dm_at"]) < since:
                continue
            try:
                user = self.bot.get_user(int(uid)) or await self.bot.fetch_user(int(uid))
                channel = user.dm_channel or await user.create_dm()
                last = None
                async for m in channel.history(after=discord.Object(int(entry["after_id"])), oldest_first=True,
                                               limit=None):
                    if not m.author.bot:
                        self._queue_reply(m)
                    last = m.id
                if last is not None:
                    self._read_up_to(uid, last)
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

    # ------------------------------------------------------------------ 답장 판단
    async def reply_round(self) -> None:
        """맡길 답장이 없을 때까지 한 통씩 판단해 보고한다. 판단 실패도 보고해야 PM 에게 바로 알림이 간다."""
        while True:
            try:
                item = (await self._call("POST", "/bot/replies/claim"))["item"]
            except BeError as e:
                print(f"[dm] 판단할 답장을 가져오지 못했다: {e}", flush=True)
                return
            if item is None:
                return
            try:
                body = await asyncio.to_thread(self._judger, item)
            except Exception as e:  # noqa: BLE001 - 어떤 실패든 PM 에게 알려야 한다. 종류만 남겨 답장 글이 나가지 않게 한다
                print(f"[dm] 답장 {item['message_id']} 판단 실패: {type(e).__name__}", flush=True)
                body = {"attempt": item["attempt"], "failure_reason": type(e).__name__, "model_name": None,
                        "changes": []}
            try:
                await self._call("POST", f"/bot/replies/{item['message_id']}/judgment", body)
            except BeError as e:
                if e.code not in JUDGMENT_DROPPED:
                    print(f"[dm] 답장 {item['message_id']} 판단을 넣지 못했다, 리스 뒤 다시: {e}", flush=True)
