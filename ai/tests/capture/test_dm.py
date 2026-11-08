"""리마인드 DM Cog. 가짜 봇·유저·메시지와 봇 경로만 흉내 낸 BE 로 발송, 결과 보고, DM 창 안내, 초안을 본다."""

import asyncio
import json
import threading
from types import SimpleNamespace

import discord
import pytest
import requests

from capture import dm as D
from capture.handoff import BeClient
from tests.capture.fake_be import _err, _ok

USER_ID = 4242
BOT_ID = 1000
WEB_URL = "https://app.example.com"
LINK_NOTICE = f"여기로 보낸 글은 전달되지 않아요.\n웹에서 답장해 주세요.\n{WEB_URL}"
PLAIN_NOTICE = "여기로 보낸 글은 전달되지 않아요.\n웹사이트에서 답장해 주세요."


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
        self.reply_claims: list[dict] = []
        self.fail: dict[str, list] = {}
        self.down = False
        self.web_url: str | None = WEB_URL

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
            return _ok(200, {"items": items, "total": len(items), "web_url": self.web_url})
        if path == "/bot/drafts/claim":
            items = self.draft_claims.pop(0) if self.draft_claims else []
            return _ok(200, {"items": items, "total": len(items)})
        if path.startswith("/bot/messages/") and path.endswith("/result"):
            return _ok(200, None)
        if path == "/bot/replies/claim":
            return _ok(200, {"item": self.reply_claims.pop(0) if self.reply_claims else None})
        if path.startswith("/bot/replies/") and path.endswith("/judgment"):
            return _ok(200, None)
        if path.startswith("/bot/drafts/"):
            return _ok(200, {"bundle_id": path.split("/")[3]})
        return _err(404, "NOT_FOUND")

    def sent(self, prefix):
        return [(p, b) for p, b in self.calls if p.startswith(prefix)]


class FakeAuthor:
    def __init__(self, uid, bot=False):
        self.id, self.bot = uid, bot


class FakeChannel:
    def __init__(self, fail=None):
        self.sent: list[str] = []
        self.fail = fail

    async def send(self, text):
        await asyncio.sleep(0)                             # 실제 전송처럼 다음 글에 차례를 넘긴다
        if self.fail is not None:
            raise self.fail
        self.sent.append(text)


class FakeMsg:
    def __init__(self, author, *, guild=None, channel=None):
        self.author, self.guild = author, guild
        self.channel = channel or FakeChannel()


class FakeUser:
    """send 는 나간 글에 1 부터 이어지는 id 를 준다. fail 은 몇 번째 send(0부터)에서 낼 예외."""

    def __init__(self, uid=USER_ID, *, fail=None, on_send=None):
        self.id = uid
        self.sent: list[str] = []
        self.send_kwargs: list[dict] = []
        self.fail = fail or {}
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


def _cog(tmp_path, bot, be=None, *, drafter=lambda item: None, judger=None):
    be = be or BotBe()
    cog = D.DmCog(bot, be=BeClient("http://be", session=be), recordings_dir=tmp_path, drafter=drafter, judger=judger)
    return cog, be


def _item(mid="msg-1", body="재환님, API 명세서 마감이 11/14(토)이라 한번 여쭤봐요.", uid=USER_ID):
    return {"message_id": mid, "workspace_id": "ws", "member_id": "mem", "discord_user_id": str(uid), "body": body,
            "scheduled_at": "2026-11-04T00:00:00+00:00"}


def _sent_dir(tmp_path):
    return tmp_path / ".bot" / "dm" / "sent"


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


# ─────────────────────────────────────────────────────────── DM 창 안내
class Clock:
    def __init__(self, monkeypatch, at=1_000_000.0):
        self.at = at
        monkeypatch.setattr(D, "_now", lambda: self.at)


async def test_a_dm_gets_the_web_notice_and_never_reaches_be(tmp_path):
    cog, be = _cog(tmp_path, FakeBot())
    await cog.run_round()
    before = list(be.calls)
    msg = FakeMsg(FakeAuthor(USER_ID))
    await cog.on_message(msg)
    assert msg.channel.sent == [LINK_NOTICE]
    assert be.calls == before


async def test_the_web_url_of_an_empty_claim_is_used(tmp_path):
    cog, be = _cog(tmp_path, FakeBot())
    be.web_url = "https://other.example.com"
    await cog.run_round()
    msg = FakeMsg(FakeAuthor(USER_ID))
    await cog.on_message(msg)
    assert msg.channel.sent == ["여기로 보낸 글은 전달되지 않아요.\n웹에서 답장해 주세요.\nhttps://other.example.com"]


async def test_before_any_claim_the_notice_has_no_link(tmp_path):
    cog, _ = _cog(tmp_path, FakeBot())
    msg = FakeMsg(FakeAuthor(USER_ID))
    await cog.on_message(msg)
    assert msg.channel.sent == [PLAIN_NOTICE]


async def test_a_null_web_url_never_prints_none(tmp_path):
    cog, be = _cog(tmp_path, FakeBot())
    await cog.run_round()
    be.web_url = None
    await cog.run_round()
    msg = FakeMsg(FakeAuthor(USER_ID))
    await cog.on_message(msg)
    assert msg.channel.sent == [PLAIN_NOTICE]


async def test_a_failed_claim_keeps_the_last_web_url(tmp_path):
    cog, be = _cog(tmp_path, FakeBot())
    await cog.run_round()
    be.fail["/bot/messages/claim"] = [_err(500, "HTTP_500")]
    await cog.run_round()
    msg = FakeMsg(FakeAuthor(USER_ID))
    await cog.on_message(msg)
    assert msg.channel.sent == [LINK_NOTICE]


async def test_a_failed_notice_does_not_use_up_the_hour(tmp_path):
    cog, _ = _cog(tmp_path, FakeBot())
    await cog.on_message(FakeMsg(FakeAuthor(USER_ID), channel=FakeChannel(fail=RuntimeError("503"))))
    msg = FakeMsg(FakeAuthor(USER_ID))
    await cog.on_message(msg)
    assert len(msg.channel.sent) == 1


async def test_a_second_dm_within_the_hour_gets_no_notice_and_after_the_hour_gets_one(tmp_path, monkeypatch):
    clock = Clock(monkeypatch)
    cog, _ = _cog(tmp_path, FakeBot())
    channel = FakeChannel()
    await cog.on_message(FakeMsg(FakeAuthor(USER_ID), channel=channel))
    clock.at += 3599
    await cog.on_message(FakeMsg(FakeAuthor(USER_ID), channel=channel))
    assert len(channel.sent) == 1
    clock.at += 1
    await cog.on_message(FakeMsg(FakeAuthor(USER_ID), channel=channel))
    assert len(channel.sent) == 2


async def test_each_person_has_their_own_hour(tmp_path, monkeypatch):
    Clock(monkeypatch)
    cog, _ = _cog(tmp_path, FakeBot())
    channel = FakeChannel()
    await cog.on_message(FakeMsg(FakeAuthor(USER_ID), channel=channel))
    await cog.on_message(FakeMsg(FakeAuthor(77), channel=channel))
    assert len(channel.sent) == 2


async def test_two_quick_dms_get_one_notice(tmp_path, monkeypatch):
    Clock(monkeypatch)
    cog, _ = _cog(tmp_path, FakeBot())
    channel = FakeChannel()
    await asyncio.gather(*[cog.on_message(FakeMsg(FakeAuthor(USER_ID), channel=channel)) for _ in range(2)])
    assert len(channel.sent) == 1


async def test_the_hour_survives_a_restart_and_expired_people_are_pruned(tmp_path, monkeypatch):
    clock = Clock(monkeypatch)
    cog, _ = _cog(tmp_path, FakeBot())
    await cog.on_message(FakeMsg(FakeAuthor(77)))
    clock.at += 1800
    await cog.on_message(FakeMsg(FakeAuthor(USER_ID)))
    restarted, _ = _cog(tmp_path, FakeBot())
    again = FakeMsg(FakeAuthor(USER_ID))
    await restarted.on_message(again)
    assert again.channel.sent == []

    clock.at += 1800
    await restarted.on_message(FakeMsg(FakeAuthor(88)))
    (state,) = (tmp_path / ".bot" / "dm").glob("*.json")
    assert set(json.loads(state.read_text(encoding="utf-8"))) == {str(USER_ID), "88"}


async def test_a_failed_rate_file_write_still_sends_the_notice(tmp_path, monkeypatch, capsys):
    disk = Disk(monkeypatch)
    disk.full = lambda path: True
    cog, _ = _cog(tmp_path, FakeBot())
    msg = FakeMsg(FakeAuthor(USER_ID))
    await cog.on_message(msg)
    assert msg.channel.sent == [PLAIN_NOTICE]
    assert str(USER_ID) in capsys.readouterr().out


async def test_a_failed_send_is_logged_and_does_not_raise(tmp_path, capsys):
    cog, _ = _cog(tmp_path, FakeBot())
    await cog.on_message(FakeMsg(FakeAuthor(USER_ID), channel=FakeChannel(fail=_forbidden())))
    assert str(USER_ID) in capsys.readouterr().out


async def test_the_bot_itself_other_bots_and_server_channels_are_ignored(tmp_path):
    cog, be = _cog(tmp_path, FakeBot())
    channel = FakeChannel()
    await cog.on_message(FakeMsg(FakeAuthor(BOT_ID, bot=True), channel=channel))
    await cog.on_message(FakeMsg(FakeAuthor(77, bot=True), channel=channel))
    await cog.on_message(FakeMsg(FakeAuthor(USER_ID), guild=SimpleNamespace(id=1), channel=channel))
    assert channel.sent == [] and be.calls == []


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


# ─────────────────────────────────────────────────────────── 답장 판단


def _claimed(mid="reply-1", attempt=1, text="API 명세서 다 했어요"):
    return {"message_id": mid, "attempt": attempt, "workspace_id": "ws", "member_name": "재환", "reply_date": "2026-11-04",
            "lines": [{"sender": "member", "text": text}], "candidates": []}


def _judged(item):
    return {"attempt": item["attempt"], "failure_reason": None, "model_name": "m", "changes": []}


def _judgments(be):
    return [(p.split("/")[3], b) for p, b in be.sent("/bot/replies/") if p.endswith("/judgment")]


async def test_a_claimed_reply_is_judged_and_its_body_is_posted(tmp_path):
    seen = []
    cog, be = _cog(tmp_path, FakeBot(), judger=lambda item: seen.append(item) or _judged(item))
    item = _claimed(attempt=3)
    be.reply_claims = [item]
    await cog.reply_round()
    assert seen == [item]
    assert _judgments(be) == [("reply-1", _judged(item))]


async def test_nothing_to_claim_judges_nothing(tmp_path):
    cog, be = _cog(tmp_path, FakeBot(), judger=lambda item: pytest.fail("맡은 답장이 없다"))
    await cog.reply_round()
    assert len(be.sent("/bot/replies/claim")) == 1
    assert _judgments(be) == []


async def test_a_round_keeps_claiming_until_nothing_is_left(tmp_path):
    cog, be = _cog(tmp_path, FakeBot(), judger=_judged)
    be.reply_claims = [_claimed("a"), _claimed("b")]
    await cog.reply_round()
    assert [mid for mid, _ in _judgments(be)] == ["a", "b"]


async def test_a_judger_failure_is_reported_by_kind_only(tmp_path):
    def boom(item):
        raise RuntimeError(f"못 읽음: {item['lines'][0]['text']}")

    cog, be = _cog(tmp_path, FakeBot(), judger=boom)
    be.reply_claims = [_claimed(attempt=2)]
    await cog.reply_round()
    assert _judgments(be) == [("reply-1", {"attempt": 2, "failure_reason": "RuntimeError", "model_name": None,
                                           "changes": []})]


@pytest.mark.parametrize("code, status", [("REPLY_JUDGMENT_STALE", 409), ("REPLY_JUDGMENT_NOT_FOUND", 404)])
async def test_a_judgment_be_no_longer_wants_is_dropped(tmp_path, capsys, code, status):
    cog, be = _cog(tmp_path, FakeBot(), judger=_judged)
    be.reply_claims = [_claimed("a"), _claimed("b")]
    be.fail = {"/bot/replies/a/judgment": [_err(status, code)]}
    await cog.reply_round()
    assert [mid for mid, _ in _judgments(be)] == ["a", "b"]
    assert code not in capsys.readouterr().out


async def test_a_judgment_that_cannot_be_posted_is_left_to_the_lease(tmp_path, capsys):
    # 봇은 다시 보내지 않는다. 리스가 끝나면 BE 가 다음 attempt 로 다시 맡긴다
    cog, be = _cog(tmp_path, FakeBot(), judger=_judged)
    be.reply_claims = [_claimed()]
    be.fail = {"/bot/replies/reply-1/judgment": [_err(500, "HTTP_500")]}
    await cog.reply_round()
    assert len(_judgments(be)) == 1
    assert "reply-1" in capsys.readouterr().out


async def test_a_judgment_be_rejects_is_reported_as_failed_with_the_same_attempt(tmp_path):
    cog, be = _cog(tmp_path, FakeBot(), judger=_judged)
    be.reply_claims = [_claimed(attempt=2)]
    be.fail = {"/bot/replies/reply-1/judgment": [_err(400, "INVALID_REQUEST")]}
    await cog.reply_round()
    assert _judgments(be)[-1] == ("reply-1", {"attempt": 2, "failure_reason": "INVALID_REQUEST", "model_name": None,
                                              "changes": []})
    assert len(_judgments(be)) == 2


async def test_a_rejected_failure_report_is_not_sent_again(tmp_path):
    def boom(item):
        raise RuntimeError("x")

    cog, be = _cog(tmp_path, FakeBot(), judger=boom)
    be.reply_claims = [_claimed()]
    be.fail = {"/bot/replies/reply-1/judgment": [_err(400, "INVALID_REQUEST")]}
    await cog.reply_round()
    assert len(_judgments(be)) == 1


async def test_a_claim_failure_ends_the_round(tmp_path, capsys):
    cog, be = _cog(tmp_path, FakeBot(), judger=lambda item: pytest.fail("맡은 답장이 없다"))
    be.fail = {"/bot/replies/claim": [_err(500, "HTTP_500")]}
    await cog.reply_round()
    assert len(be.sent("/bot/replies/claim")) == 1
    assert "답장" in capsys.readouterr().out


async def test_a_bot_that_dies_mid_judgment_leaves_nothing_and_the_new_attempt_goes_out(tmp_path):
    release = threading.Event()

    def stuck(item):
        release.wait(5)
        return _judged(item)

    first, be = _cog(tmp_path, FakeBot(), judger=stuck)
    be.reply_claims = [_claimed(attempt=1)]
    dying = asyncio.create_task(first.reply_round())
    while not be.sent("/bot/replies/claim"):
        await asyncio.sleep(0.01)
    dying.cancel()
    await asyncio.gather(dying, return_exceptions=True)
    release.set()
    assert _judgments(be) == []

    be.reply_claims = [_claimed(attempt=2)]
    second, _ = _cog(tmp_path, FakeBot(), be, judger=_judged)
    await second.reply_round()
    assert [b["attempt"] for _, b in _judgments(be)] == [2]


async def test_the_reply_loop_starts_once_only_with_a_judger_and_stops_on_unload(tmp_path, monkeypatch):
    for name in ("DM_POLL_S", "DRAFT_POLL_S", "REPLY_POLL_S"):
        monkeypatch.setattr(D, name, 3600.0)
    cog, be = _cog(tmp_path, FakeBot(), judger=_judged)
    await cog.on_ready()
    task = cog._reply_task
    await cog.on_ready()
    assert cog._reply_task is task
    for _ in range(200):
        if be.sent("/bot/replies/claim"):
            break
        await asyncio.sleep(0.01)
    assert be.sent("/bot/replies/claim")
    cog.cog_unload()
    await asyncio.gather(task, return_exceptions=True)
    assert task.cancelled()


async def test_without_a_judger_the_reply_loop_does_not_start(tmp_path, monkeypatch):
    for name in ("DM_POLL_S", "DRAFT_POLL_S"):
        monkeypatch.setattr(D, name, 3600.0)
    cog, be = _cog(tmp_path, FakeBot())
    await cog.on_ready()
    assert cog._reply_task is None
    cog.cog_unload()


async def test_a_round_that_raises_does_not_stop_the_reply_loop(tmp_path, monkeypatch):
    monkeypatch.setattr(D, "REPLY_POLL_S", 0.0)
    cog, _ = _cog(tmp_path, FakeBot(), judger=_judged)
    rounds = []

    async def round_():
        rounds.append(1)
        if len(rounds) == 1:
            raise KeyError("item")
        raise asyncio.CancelledError

    cog.reply_round = round_
    with pytest.raises(asyncio.CancelledError):
        await cog._reply_loop()
    assert len(rounds) == 2
