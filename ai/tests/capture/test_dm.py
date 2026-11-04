"""리마인드 DM Cog. 가짜 봇·유저·메시지와 봇 경로만 흉내 낸 BE 로 발송, 결과 보고, 답장 넘기기, 메우기, 초안을 본다."""

import asyncio
import json
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import discord
import pytest
import requests

from capture import dm as D
from capture.handoff import BeClient
from tests.capture.fake_be import _err, _ok

USER_ID = 4242
BOT_ID = 1000


def _forbidden():
    return discord.Forbidden(SimpleNamespace(status=403, reason="Forbidden"), "Cannot send messages to this user")


def _not_found():
    return discord.NotFound(SimpleNamespace(status=404, reason="Not Found"), "Unknown User")


class BotBe:
    """BE 의 봇 메시지 경로(backend/app/api/bot_messages.py)를 흉내 낸다. requests.Session 자리에 넣는다.

    claims 는 claim 이 차례로 줄 묶음, fail 은 경로 접두어 → 그 경로가 낼 응답 목록(앞에서부터 한 번씩 쓴다)이다.
    """

    def __init__(self):
        self.calls: list[tuple[str, dict | None]] = []
        self.claims: list[list[dict]] = []
        self.draft_claims: list[list[dict]] = []
        self.fail: dict[str, list] = {}
        self.down = False

    def request(self, method, url, json=None, timeout=None, headers=None):
        path = url.split("/api/v1", 1)[1]
        if self.down:
            raise requests.ConnectionError("BE 가 꺼져 있다")
        self.calls.append((path, json))
        for prefix, queue in self.fail.items():
            if path.startswith(prefix) and queue:
                return queue.pop(0)
        if path == "/bot/messages/claim":
            items = self.claims.pop(0) if self.claims else []
            return _ok(200, {"items": items, "total": len(items)})
        if path == "/bot/drafts/claim":
            items = self.draft_claims.pop(0) if self.draft_claims else []
            return _ok(200, {"items": items, "total": len(items)})
        if path.startswith("/bot/messages/") and path.endswith("/result"):
            return _ok(200, None)
        if path == "/bot/replies":
            return _ok(201, {"message_id": "m", "thread_id": "t", "workspace_id": "w", "member_id": "u"})
        if path.startswith("/bot/drafts/"):
            return _ok(200, {"bundle_id": path.split("/")[3]})
        return _err(404, "NOT_FOUND")

    def sent(self, prefix):
        return [(p, b) for p, b in self.calls if p.startswith(prefix)]


class FakeAuthor:
    def __init__(self, uid, bot=False):
        self.id, self.bot = uid, bot


class FakeMsg:
    def __init__(self, mid, author, content="", *, guild=None, reply_to=None, created_at=None):
        self.id, self.author, self.content, self.guild = mid, author, content, guild
        self.reference = SimpleNamespace(message_id=reply_to) if reply_to else None
        self.created_at = created_at or datetime(2026, 11, 4, 0, 0, tzinfo=timezone.utc)


class FakeDmChannel:
    def __init__(self, messages=()):
        self.messages = list(messages)
        self.reads = []

    def history(self, *, limit=100, after=None, oldest_first=None, **_):
        self.reads.append({"after": after.id if after else None, "limit": limit, "oldest_first": oldest_first})
        picked = [m for m in sorted(self.messages, key=lambda m: m.id) if after is None or m.id > after.id][:limit]

        async def gen():
            for m in picked:
                yield m
        return gen()


class FakeUser:
    """send 는 나간 글에 1 부터 이어지는 id 를 준다. fail 은 몇 번째 send(0부터)에서 낼 예외."""

    def __init__(self, uid=USER_ID, *, fail=None, history=(), on_send=None):
        self.id = uid
        self.sent: list[str] = []
        self.send_kwargs: list[dict] = []
        self.fail = fail or {}
        self.dm_channel = FakeDmChannel(history)
        self.on_send = on_send
        self.next_id = 5000

    async def send(self, text, **kwargs):
        self.send_kwargs.append(kwargs)
        if self.on_send:
            self.on_send(text)
        n = len(self.sent)
        if n in self.fail:
            exc = self.fail.pop(n)
            raise exc
        self.sent.append(text)
        self.next_id += 1
        return SimpleNamespace(id=self.next_id)

    async def create_dm(self):
        return self.dm_channel


class FakeBot:
    def __init__(self, users=(), *, cached=True):
        self.users = {u.id: u for u in users}
        self.cached = cached
        self.user = FakeAuthor(BOT_ID, bot=True)
        self.fetched: list[int] = []

    def is_ready(self):
        return False

    def get_user(self, uid):
        return self.users.get(uid) if self.cached else None

    async def fetch_user(self, uid):
        self.fetched.append(uid)
        if uid not in self.users:
            raise _not_found()
        return self.users[uid]


def _cog(tmp_path, bot, be=None, *, drafter=lambda item: None):
    be = be or BotBe()
    cog = D.DmCog(bot, be=BeClient("http://be", session=be), recordings_dir=tmp_path, drafter=drafter)
    return cog, be


def _item(mid="msg-1", body="재환님, API 명세서 마감이 11/14(토)이라 한번 여쭤봐요.", uid=USER_ID):
    return {"message_id": mid, "workspace_id": "ws", "member_id": "mem", "discord_user_id": str(uid), "body": body,
            "scheduled_at": "2026-11-04T00:00:00+00:00"}


def _sent_dir(tmp_path):
    return tmp_path / ".bot" / "dm" / "sent"


def _replies_dir(tmp_path):
    return tmp_path / ".bot" / "dm" / "replies"


def _recipients(tmp_path):
    return json.loads((tmp_path / ".bot" / "dm" / "recipients.json").read_text(encoding="utf-8"))


# ─────────────────────────────────────────────────────────── split_body
def test_a_short_body_is_one_part():
    assert D.split_body("안녕하세요") == ["안녕하세요"]
    assert D.split_body("가" * 2000) == ["가" * 2000]


def test_a_long_body_is_cut_at_the_last_newline_and_rejoins_to_the_original():
    body = ("가" * 1500 + "\n") + ("나" * 1000 + "\n") + "다" * 300
    parts = D.split_body(body)
    assert "".join(parts) == body
    assert all(0 < len(p) <= 2000 for p in parts)
    assert parts[0] == "가" * 1500 + "\n"


def test_without_a_newline_it_cuts_at_the_last_space_and_then_at_the_limit():
    spaced = "가" * 1990 + " " + "나" * 50
    assert D.split_body(spaced) == ["가" * 1990 + " ", "나" * 50]
    solid = "가" * 4500
    assert D.split_body(solid) == ["가" * 2000, "가" * 2000, "가" * 500]


def test_no_part_is_only_whitespace():
    leading = "\n" + "가" * 2500                       # 맨 앞 줄바꿈에서 자르면 빈 조각이 나간다
    parts = D.split_body(leading)
    assert "".join(parts) == leading and all(p.strip() for p in parts)
    trailing = "가" * 1990 + " " * 30                  # 경계를 넘는 공백 끝자락은 보내지 않는다
    assert all(p.strip() for p in D.split_body(trailing))
    assert "".join(D.split_body(trailing)).strip() == trailing.strip()


# ─────────────────────────────────────────────────────────── 발송과 결과 보고
async def test_a_claimed_message_is_recorded_before_it_is_sent_and_reported_delivered(tmp_path):
    seen = []

    def check_record(_text):
        rec = json.loads((_sent_dir(tmp_path) / "msg-1.json").read_text(encoding="utf-8"))
        seen.append(rec["outcome"])

    user = FakeUser(on_send=check_record)
    cog, be = _cog(tmp_path, FakeBot([user]))
    be.claims.append([_item()])
    await cog.run_round()
    assert seen == [None]
    assert user.sent == [_item()["body"]]
    assert be.sent("/bot/messages/msg-1/result") == [
        ("/bot/messages/msg-1/result", {"status": "delivered", "discord_message_ids": ["5001"]})]
    assert not list(_sent_dir(tmp_path).glob("*.json"))


async def test_a_long_body_goes_out_in_parts_and_the_result_carries_every_id(tmp_path):
    user = FakeUser()
    cog, be = _cog(tmp_path, FakeBot([user]))
    body = "가" * 1500 + "\n" + "나" * 1500
    be.claims.append([_item(body=body)])
    await cog.run_round()
    assert "".join(user.sent) == body and len(user.sent) == 2
    assert be.sent("/bot/messages/")[-1][1] == {"status": "delivered", "discord_message_ids": ["5001", "5002"]}


async def test_a_user_who_blocks_dms_is_reported_dm_blocked(tmp_path):
    user = FakeUser(fail={0: _forbidden()})
    cog, be = _cog(tmp_path, FakeBot([user]))
    be.claims.append([_item()])
    await cog.run_round()
    assert be.sent("/bot/messages/msg-1/result")[0][1] == {
        "status": "failed", "failure_reason": "dm_blocked", "discord_message_ids": []}


async def test_any_other_failure_is_reported_unknown(tmp_path):
    user = FakeUser(fail={0: RuntimeError("연결이 끊겼다")})
    cog, be = _cog(tmp_path, FakeBot([user]))
    be.claims.append([_item("msg-1"), _item("msg-2", uid=999)])     # 999 는 없는 계정이라 fetch_user 가 NotFound
    await cog.run_round()
    results = {p: b for p, b in be.sent("/bot/messages/") if p.endswith("/result")}
    unknown = {"status": "failed", "failure_reason": "unknown", "discord_message_ids": []}
    assert results == {"/bot/messages/msg-1/result": unknown, "/bot/messages/msg-2/result": unknown}


async def test_an_uncached_user_is_fetched(tmp_path):
    user = FakeUser()
    bot = FakeBot([user], cached=False)
    cog, be = _cog(tmp_path, bot)
    be.claims.append([_item()])
    await cog.run_round()
    assert bot.fetched == [USER_ID] and len(user.sent) == 1


async def test_a_failure_on_the_second_part_reports_only_the_part_that_went_out(tmp_path):
    user = FakeUser(fail={1: RuntimeError("두 번째 조각 실패")})
    cog, be = _cog(tmp_path, FakeBot([user]))
    be.claims.append([_item(body="가" * 1500 + "\n" + "나" * 1500)])
    await cog.run_round()
    assert be.sent("/bot/messages/")[-1][1] == {
        "status": "failed", "failure_reason": "unknown", "discord_message_ids": ["5001"]}


async def test_a_result_that_cannot_be_reported_is_kept_and_reported_again_next_round(tmp_path):
    user = FakeUser()
    cog, be = _cog(tmp_path, FakeBot([user]))
    be.claims.append([_item()])
    be.fail["/bot/messages/msg-1/result"] = [_err(503, "HTTP_503")]
    await cog.run_round()
    assert len(list(_sent_dir(tmp_path).glob("*.json"))) == 1
    be.down = True
    await cog.run_round()                                  # 연결 오류도 남긴다. claim 도 못 해서 보내지 않는다
    assert len(list(_sent_dir(tmp_path).glob("*.json"))) == 1
    be.down = False
    await cog.run_round()
    reports = be.sent("/bot/messages/msg-1/result")
    assert [b for _, b in reports] == [{"status": "delivered", "discord_message_ids": ["5001"]}] * 2
    assert not list(_sent_dir(tmp_path).glob("*.json"))
    assert len(user.sent) == 1


async def test_a_conflicting_or_missing_message_is_dropped_from_the_record(tmp_path):
    user = FakeUser()
    cog, be = _cog(tmp_path, FakeBot([user]))
    be.claims.append([_item("msg-1"), _item("msg-2")])
    be.fail["/bot/messages/msg-1/result"] = [_err(409, "MESSAGE_RESULT_CONFLICT")]
    be.fail["/bot/messages/msg-2/result"] = [_err(404, "MESSAGE_NOT_FOUND")]
    await cog.run_round()
    assert not list(_sent_dir(tmp_path).glob("*.json"))


async def test_a_claim_failure_sends_nothing_that_round(tmp_path):
    user = FakeUser()
    cog, be = _cog(tmp_path, FakeBot([user]))
    be.fail["/bot/messages/claim"] = [_err(401, "UNAUTHENTICATED")]
    be.claims.append([_item()])
    await cog.run_round()
    assert user.sent == []


def _leftover(tmp_path, mid, parts_sent, parts_total):
    d = _sent_dir(tmp_path)
    d.mkdir(parents=True, exist_ok=True)
    (d / f"{mid}.json").write_text(json.dumps({
        "message_id": mid, "discord_user_id": str(USER_ID), "parts_total": parts_total, "parts_sent": parts_sent,
        "outcome": None}), encoding="utf-8")


async def test_after_a_restart_a_message_caught_mid_send_is_not_sent_again(tmp_path):
    _leftover(tmp_path, "none-out", [], 1)
    _leftover(tmp_path, "half-out", ["7001"], 2)
    _leftover(tmp_path, "all-out", ["7002", "7003"], 2)
    user = FakeUser()
    cog, be = _cog(tmp_path, FakeBot([user]))
    await cog.startup()
    await cog.run_round()
    assert user.sent == []
    results = {p.split("/")[3]: b for p, b in be.sent("/bot/messages/") if p.endswith("/result")}
    assert results == {
        "none-out": {"status": "failed", "failure_reason": "unknown", "discord_message_ids": []},
        "half-out": {"status": "failed", "failure_reason": "unknown", "discord_message_ids": ["7001"]},
        "all-out": {"status": "delivered", "discord_message_ids": ["7002", "7003"]},
    }
    assert not list(_sent_dir(tmp_path).glob("*.json"))


async def test_a_sent_dm_marks_the_recipient_for_backfill(tmp_path):
    user = FakeUser()
    cog, be = _cog(tmp_path, FakeBot([user]))
    be.claims.append([_item()])
    await cog.run_round()
    r = _recipients(tmp_path)[str(USER_ID)]
    assert r["after_id"] == "5001"
    assert datetime.fromisoformat(r["last_dm_at"]).tzinfo is not None


# ─────────────────────────────────────────────────────────── 답장
async def test_a_dm_reply_is_handed_to_be_with_its_reply_target_and_a_timezone(tmp_path):
    cog, be = _cog(tmp_path, FakeBot())
    created = datetime(2026, 11, 4, 0, 30, tzinfo=timezone.utc)
    await cog.on_message(FakeMsg(9001, FakeAuthor(USER_ID), "거의 다 했어요", reply_to=5001, created_at=created))
    await cog.on_message(FakeMsg(9002, FakeAuthor(USER_ID), ""))          # 첨부만 있는 글
    bodies = [b for _, b in be.sent("/bot/replies")]
    assert bodies[0] == {"discord_user_id": str(USER_ID), "discord_message_id": "9001", "body": "거의 다 했어요",
                         "sent_at": "2026-11-04T00:30:00+00:00", "reply_to_discord_message_id": "5001"}
    assert bodies[1]["body"] == "" and bodies[1]["reply_to_discord_message_id"] is None
    assert datetime.fromisoformat(bodies[1]["sent_at"]).tzinfo is not None
    assert not list(_replies_dir(tmp_path).glob("*.json"))


async def test_the_bot_itself_other_bots_and_server_channels_are_ignored(tmp_path):
    cog, be = _cog(tmp_path, FakeBot())
    await cog.on_message(FakeMsg(9001, FakeAuthor(BOT_ID, bot=True), "리마인드"))
    await cog.on_message(FakeMsg(9002, FakeAuthor(77, bot=True), "다른 봇"))
    await cog.on_message(FakeMsg(9003, FakeAuthor(USER_ID), "서버 글", guild=SimpleNamespace(id=1)))
    assert be.sent("/bot/replies") == []
    assert not _replies_dir(tmp_path).exists() or not list(_replies_dir(tmp_path).glob("*.json"))


async def test_an_unknown_member_is_dropped_and_server_or_network_errors_are_kept(tmp_path):
    cog, be = _cog(tmp_path, FakeBot())
    be.fail["/bot/replies"] = [_err(404, "MEMBER_NOT_FOUND"), _err(500, "HTTP_500")]
    await cog.on_message(FakeMsg(9001, FakeAuthor(USER_ID), "누구세요"))
    assert not list(_replies_dir(tmp_path).glob("*.json"))
    await cog.on_message(FakeMsg(9002, FakeAuthor(USER_ID), "두 번째"))
    assert [p.stem for p in _replies_dir(tmp_path).glob("*.json")] == ["9002"]
    be.down = True
    await cog.run_round()
    assert [p.stem for p in _replies_dir(tmp_path).glob("*.json")] == ["9002"]
    be.down = False
    await cog.run_round()
    assert not list(_replies_dir(tmp_path).glob("*.json"))
    assert [b["discord_message_id"] for _, b in be.sent("/bot/replies")] == ["9001", "9002", "9002"]


async def test_queued_replies_go_out_in_the_order_they_were_written(tmp_path):
    cog, be = _cog(tmp_path, FakeBot())
    be.down = True
    for mid in (10_000, 9_000, 200_000):
        await cog.on_message(FakeMsg(mid, FakeAuthor(USER_ID), str(mid)))
    be.down = False
    await cog.run_round()
    assert [b["discord_message_id"] for _, b in be.sent("/bot/replies")] == ["9000", "10000", "200000"]


# ─────────────────────────────────────────────────────────── 메우기
def _recipients_file(tmp_path, entries):
    d = tmp_path / ".bot" / "dm"
    d.mkdir(parents=True, exist_ok=True)
    (d / "recipients.json").write_text(json.dumps(entries), encoding="utf-8")


async def test_backfill_hands_over_replies_written_while_the_bot_was_down(tmp_path):
    now = datetime.now(timezone.utc)
    recent = FakeUser(USER_ID, history=[FakeMsg(6000, FakeAuthor(USER_ID), "예전 글"),
                                        FakeMsg(6001, FakeAuthor(BOT_ID, bot=True), "리마인드"),
                                        FakeMsg(6002, FakeAuthor(USER_ID), "꺼진 동안 쓴 답")])
    stale = FakeUser(31, history=[FakeMsg(6100, FakeAuthor(31), "오래된 사람")])
    _recipients_file(tmp_path, {
        str(USER_ID): {"last_dm_at": (now - timedelta(days=1)).isoformat(), "after_id": "6000"},
        "31": {"last_dm_at": (now - timedelta(days=8)).isoformat(), "after_id": "6099"},
    })
    cog, be = _cog(tmp_path, FakeBot([recent, stale]))
    await cog.startup()
    assert [b["discord_message_id"] for _, b in be.sent("/bot/replies")] == ["6002"]
    assert recent.dm_channel.reads == [{"after": 6000, "limit": None, "oldest_first": True}]
    assert stale.dm_channel.reads == []
    assert _recipients(tmp_path)[str(USER_ID)]["after_id"] == "6002"


async def test_a_new_dm_does_not_move_the_mark_past_unread_history(tmp_path):
    now = datetime.now(timezone.utc)
    user = FakeUser(USER_ID, history=[FakeMsg(6002, FakeAuthor(USER_ID), "꺼진 동안 쓴 답")])
    user.next_id = 8000
    _recipients_file(tmp_path, {str(USER_ID): {"last_dm_at": now.isoformat(), "after_id": "6000"}})
    cog, be = _cog(tmp_path, FakeBot([user]))
    be.claims.append([_item()])
    await cog.run_round()
    assert _recipients(tmp_path)[str(USER_ID)]["after_id"] == "6000"


async def test_the_running_bot_backfills_before_its_first_send(tmp_path, monkeypatch):
    monkeypatch.setattr(D, "DM_POLL_S", 3600.0)
    monkeypatch.setattr(D, "DRAFT_POLL_S", 3600.0)
    user = FakeUser(USER_ID, history=[FakeMsg(6002, FakeAuthor(USER_ID), "꺼진 동안 쓴 답")])
    user.next_id = 8000
    _recipients_file(tmp_path, {str(USER_ID): {"last_dm_at": datetime.now(timezone.utc).isoformat(),
                                               "after_id": "6000"}})
    cog, be = _cog(tmp_path, FakeBot([user]))
    be.claims.append([_item()])
    await cog.on_ready()
    for _ in range(200):
        if be.sent("/bot/messages/msg-1/result"):
            break
        await asyncio.sleep(0.01)
    cog.cog_unload()
    assert [b["discord_message_id"] for _, b in be.sent("/bot/replies")] == ["6002"]
    assert _recipients(tmp_path)[str(USER_ID)]["after_id"] == "6002"


async def test_backfill_keeps_going_when_one_person_fails(tmp_path):
    now = datetime.now(timezone.utc).isoformat()
    ok = FakeUser(USER_ID, history=[FakeMsg(6002, FakeAuthor(USER_ID), "답")])
    _recipients_file(tmp_path, {"999": {"last_dm_at": now, "after_id": "1"},
                                str(USER_ID): {"last_dm_at": now, "after_id": "6000"}})
    cog, be = _cog(tmp_path, FakeBot([ok], cached=False))
    await cog.startup()
    assert [b["discord_message_id"] for _, b in be.sent("/bot/replies")] == ["6002"]


async def test_the_loops_start_once_and_stop_on_unload(tmp_path, monkeypatch):
    monkeypatch.setattr(D, "DM_POLL_S", 3600.0)
    monkeypatch.setattr(D, "DRAFT_POLL_S", 3600.0)
    cog, be = _cog(tmp_path, FakeBot())
    await cog.on_ready()
    first = (cog._send_task, cog._draft_task)
    await cog.on_ready()                                   # 재연결로 다시 와도 하나만 돈다
    assert (cog._send_task, cog._draft_task) == first
    for _ in range(200):
        if be.sent("/bot/messages/claim") and be.sent("/bot/drafts/claim"):
            break
        await asyncio.sleep(0.01)
    assert be.sent("/bot/messages/claim") and be.sent("/bot/drafts/claim")
    cog.cog_unload()
    await asyncio.gather(*first, return_exceptions=True)
    assert all(t.cancelled() for t in first)


# ─────────────────────────────────────────────────────────── 초안
def _bundle(bid, version=1):
    return {"bundle_id": bid, "draft_version": version, "workspace_id": "ws", "recipient_name": "재환",
            "scheduled_at": "2026-11-05T00:00:00+00:00", "tasks": [], "style_examples": [], "fallback_body": "규칙 문구"}


async def test_draft_worker_writes_the_draft_or_null_and_moves_past_stale_bundles(tmp_path):
    drafts = {"b1": "재환님, 어디까지 됐는지 알려 주세요!", "b2": None, "b3": "늦은 초안"}
    cog, be = _cog(tmp_path, FakeBot(), drafter=lambda item: drafts[item["bundle_id"]])
    be.draft_claims.append([_bundle("b3", 2), _bundle("b1", 3), _bundle("b2", 1)])
    be.fail["/bot/drafts/b3"] = [_err(409, "DRAFT_STALE")]
    await cog.draft_round()
    posted = {p: b for p, b in be.sent("/bot/drafts/") if p != "/bot/drafts/claim"}
    assert posted == {"/bot/drafts/b3": {"draft_version": 2, "body": "늦은 초안"},
                      "/bot/drafts/b1": {"draft_version": 3, "body": "재환님, 어디까지 됐는지 알려 주세요!"},
                      "/bot/drafts/b2": {"draft_version": 1, "body": None}}


async def test_a_drafter_that_raises_posts_null(tmp_path):
    def boom(item):
        raise ValueError("잘못된 마감일")

    cog, be = _cog(tmp_path, FakeBot(), drafter=boom)
    be.draft_claims.append([_bundle("b1")])
    await cog.draft_round()
    assert be.sent("/bot/drafts/b1") == [("/bot/drafts/b1", {"draft_version": 1, "body": None})]


# ─────────────────────────────────────────────────────────── 없는 경로의 404
def _route_missing():
    """BE 는 없는 경로에도 INVALID_REQUEST 를 준다. 봇이 BE 보다 먼저 올라가거나 BE 가 되돌아가면 받는 응답이다."""
    return _err(404, "INVALID_REQUEST")


async def test_a_result_survives_a_404_from_a_route_the_be_does_not_have_yet(tmp_path):
    user = FakeUser()
    cog, be = _cog(tmp_path, FakeBot([user]))
    be.fail["/bot/messages/msg-1/result"] = [_route_missing()]
    be.claims.append([_item()])
    await cog.run_round()
    assert list(_sent_dir(tmp_path).glob("*.json"))
    await cog.run_round()
    assert len(be.sent("/bot/messages/msg-1/result")) == 2
    assert not list(_sent_dir(tmp_path).glob("*.json"))


async def test_a_reply_survives_a_404_from_a_route_the_be_does_not_have_yet(tmp_path):
    cog, be = _cog(tmp_path, FakeBot())
    be.fail["/bot/replies"] = [_route_missing()]
    await cog.on_message(FakeMsg(6002, FakeAuthor(USER_ID), "답"))
    assert list(_replies_dir(tmp_path).glob("*.json"))
    await cog.run_round()
    assert len(be.sent("/bot/replies")) == 2
    assert not list(_replies_dir(tmp_path).glob("*.json"))


# ─────────────────────────────────────────────────────────── 메우기 표시는 읽은 데까지만
def _posted(be):
    return [b["discord_message_id"] for _, b in be.sent("/bot/replies")]


async def test_a_second_ready_reads_what_was_written_while_the_session_was_lost(tmp_path, monkeypatch):
    monkeypatch.setattr(D, "DM_POLL_S", 3600.0)
    monkeypatch.setattr(D, "DRAFT_POLL_S", 3600.0)
    user = FakeUser(USER_ID)
    cog, be = _cog(tmp_path, FakeBot([user]))
    be.claims.append([_item()])
    await cog.on_ready()
    for _ in range(200):
        if be.sent("/bot/messages/msg-1/result"):
            break
        await asyncio.sleep(0.01)
    user.dm_channel.messages.append(FakeMsg(6002, FakeAuthor(USER_ID), "끊긴 동안 쓴 답"))
    await cog.on_ready()                                   # 재식별. 게이트웨이는 이 글을 다시 주지 않는다
    cog.cog_unload()
    assert _posted(be) == ["6002"]


async def test_a_live_dm_before_the_backfill_does_not_hide_the_older_reply(tmp_path):
    user = FakeUser(USER_ID, history=[FakeMsg(6002, FakeAuthor(USER_ID), "꺼진 동안 쓴 답"),
                                      FakeMsg(6003, FakeAuthor(USER_ID), "READY 직후 쓴 답")])
    _recipients_file(tmp_path, {str(USER_ID): {"last_dm_at": datetime.now(timezone.utc).isoformat(),
                                               "after_id": "6000"}})
    cog, be = _cog(tmp_path, FakeBot([user]))
    await cog.on_message(FakeMsg(6003, FakeAuthor(USER_ID), "READY 직후 쓴 답"))
    await cog.startup()
    assert "6002" in _posted(be)


async def test_a_failed_backfill_keeps_the_mark_for_the_next_one(tmp_path):
    class Down(FakeDmChannel):
        def history(self, **kw):
            async def boom():
                raise discord.HTTPException(SimpleNamespace(status=503, reason="down"), "upstream")
                yield
            return boom()

    user = FakeUser(USER_ID)
    user.dm_channel = Down([FakeMsg(6002, FakeAuthor(USER_ID), "꺼진 동안 쓴 답")])
    user.next_id = 8000
    _recipients_file(tmp_path, {str(USER_ID): {"last_dm_at": datetime.now(timezone.utc).isoformat(),
                                               "after_id": "6000"}})
    cog, be = _cog(tmp_path, FakeBot([user]))
    await cog.startup()
    be.claims.append([_item()])
    await cog.run_round()
    assert _recipients(tmp_path)[str(USER_ID)]["after_id"] == "6000"

    user.dm_channel = FakeDmChannel(user.dm_channel.messages)
    cog2, _ = _cog(tmp_path, FakeBot([user]), be)
    await cog2.startup()
    assert "6002" in _posted(be)


async def test_a_reply_that_could_not_be_queued_comes_back_with_the_backfill(tmp_path, monkeypatch):
    _recipients_file(tmp_path, {str(USER_ID): {"last_dm_at": datetime.now(timezone.utc).isoformat(),
                                               "after_id": "6000"}})
    real = D._write_json
    full = {"on": True}

    def write(path, obj):
        if full["on"] and path.parent.name == "replies":
            raise OSError("No space left on device")
        real(path, obj)

    monkeypatch.setattr(D, "_write_json", write)
    user = FakeUser(USER_ID)
    cog, be = _cog(tmp_path, FakeBot([user]))
    first = FakeMsg(6002, FakeAuthor(USER_ID), "디스크가 찼을 때 쓴 답")
    user.dm_channel.messages.append(first)
    with pytest.raises(OSError):
        await cog.on_message(first)
    full["on"] = False
    second = FakeMsg(6003, FakeAuthor(USER_ID), "비운 뒤 쓴 답")
    user.dm_channel.messages.append(second)
    await cog.on_message(second)
    cog2, _ = _cog(tmp_path, FakeBot([user]), be)
    await cog2.startup()
    assert "6002" in _posted(be)


async def test_a_restart_reports_results_before_it_hands_over_backfilled_replies(tmp_path):
    """팀원이 어느 DM 에 답했는지는 BE 가 결과 보고로 안다. 답장이 먼저 가면 다른 워크스페이스 대화에 들어간다."""
    d = _sent_dir(tmp_path)
    d.mkdir(parents=True)
    (d / "msg-a.json").write_text(json.dumps({
        "message_id": "msg-a", "discord_user_id": str(USER_ID), "parts_total": 1, "parts_sent": ["5001"],
        "outcome": {"status": "delivered"}}), encoding="utf-8")
    _recipients_file(tmp_path, {str(USER_ID): {"last_dm_at": datetime.now(timezone.utc).isoformat(),
                                               "after_id": "5001"}})
    user = FakeUser(USER_ID, history=[FakeMsg(6002, FakeAuthor(USER_ID), "A 건 답이에요", reply_to=5001)])
    cog, be = _cog(tmp_path, FakeBot([user]))
    await cog.startup()
    assert [p for p, _ in be.calls] == ["/bot/messages/msg-a/result", "/bot/replies"]


# ─────────────────────────────────────────────────────────── 디스코드 쪽 중복 막기
async def test_each_part_carries_its_own_nonce_so_an_http_retry_does_not_send_it_twice(tmp_path):
    user = FakeUser()
    cog, be = _cog(tmp_path, FakeBot([user]))
    be.claims.append([_item(body="가" * 2500)])
    await cog.run_round()
    assert all(k["enforce_nonce"] is True for k in user.send_kwargs)
    nonces = [k["nonce"] for k in user.send_kwargs]
    assert len(nonces) == 2 and len(set(nonces)) == 2
    assert all(len(n) <= 25 for n in nonces)             # 디스코드 nonce 는 25자까지
    assert nonces[0] == D._nonce("msg-1", 0)


# ─────────────────────────────────────────────────────────── 디스크가 찼을 때
class Disk:
    def __init__(self, monkeypatch):
        self.real = D._write_json
        self.full = lambda path: False
        monkeypatch.setattr(D, "_write_json", self)

    def __call__(self, path, obj):
        if self.full(path):
            raise OSError("No space left on device")
        self.real(path, obj)


async def test_a_sent_dm_stays_delivered_when_the_recipient_file_cannot_be_written(tmp_path, monkeypatch):
    disk = Disk(monkeypatch)
    disk.full = lambda p: p.name == "recipients.json"
    user = FakeUser()
    cog, be = _cog(tmp_path, FakeBot([user]))
    be.claims.append([_item()])
    await cog.run_round()
    assert be.sent("/bot/messages/msg-1/result")[0][1] == {"status": "delivered", "discord_message_ids": ["5001"]}


async def test_a_full_disk_mid_batch_reports_what_went_out_and_keeps_the_batch_going(tmp_path, monkeypatch):
    disk = Disk(monkeypatch)
    user = FakeUser()

    def fill_disk(_text):
        disk.full = lambda p: True

    user.on_send = fill_disk
    cog, be = _cog(tmp_path, FakeBot([user]))
    be.claims.append([_item("msg-1", "첫 메시지"), _item("msg-2", "둘째 메시지")])
    await cog.run_round()
    assert be.sent("/bot/messages/msg-1/result")[0][1] == {"status": "delivered", "discord_message_ids": ["5001"]}
    # 기록을 못 쓰면 보내지 않는다. 기록 없이 나간 DM 은 재시작하면 알 길이 없다
    assert user.sent == ["첫 메시지"]
    assert be.sent("/bot/messages/msg-2/result")[0][1] == {
        "status": "failed", "failure_reason": "unknown", "discord_message_ids": []}
