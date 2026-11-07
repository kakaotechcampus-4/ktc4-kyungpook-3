"""대화 신호 웹소켓(#520). 실제 경로로 소켓을 열고 실제 글 경로로 신호를 낸다.

받지 말아야 할 사람은 기다리지 않는다. 뒤이어 그 사람이 받을 신호를 내고, 그것이 첫 프레임인지 본다.
sqlite 는 StaticPool 이라 소켓 세션과 mdb 가 연결 하나를 나눠 쓰고, 소켓 세션을 닫으면 그 연결이 롤백된다. 그래서 소켓을
열기 전과 검사가 도는 동안에는 mdb 를 커밋해 둔다.
"""
import asyncio
import re
import signal
import threading
import time
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.websockets import WebSocket
from sqlalchemy.orm import sessionmaker
from starlette.websockets import WebSocketDisconnect

from app.api import message_socket
from app.models import Member, ReminderBundle, ThreadMessage, User, Workspace
from app.services import messages as svc
from app.services import password_reset, sessions, thread_signals
from tests.api.test_member_messages import _discord, _report, _send, _thread
from tests.api.test_messages_api import P, _bundles_url, _claim, _create, _sent_message, client

ORIGIN = {"origin": "https://testserver"}
BOT_DRAFT = "규칙 말고 AI 가 쓴 초안"


@pytest.fixture(autouse=True)
def _socket_sessions(mdb, monkeypatch):
    # 소켓은 mdb 를 빌리지 않고 자기 세션을 연다. 운영의 SessionLocal 과 같다.
    monkeypatch.setattr(message_socket, "SessionLocal", sessionmaker(bind=mdb.get_bind(), autoflush=False))


@pytest.fixture(autouse=True)
def _hub_is_clean():
    assert not thread_signals._connections
    yield
    thread_signals._connections.clear()


@pytest.fixture(autouse=True)
def _no_hang():
    """프레임이 안 오면 receive 가 끝나지 않는다. 신호가 빠지는 회귀가 CI 를 멈추지 않고 실패하게 한다."""
    def fail(*_):
        raise TimeoutError("소켓을 기다리다 시간이 지났다")

    previous = signal.signal(signal.SIGALRM, fail)
    signal.alarm(20)
    yield
    signal.alarm(0)
    signal.signal(signal.SIGALRM, previous)


def _url(workspace_id):
    return f"{P}/workspaces/{workspace_id}/messages/ws"


def _socket(seed, token="pm", *, headers=ORIGIN):
    return client(token).websocket_connect(_url(seed["ws"]), headers=headers)


def _frame(thread_id):
    return {"type": "thread_updated", "thread_id": thread_id}


def _reply_as_owner(db, seed, who="alice", body="네"):
    thread = svc.get_or_create_thread(db, seed["ws"], seed[who].member_id)
    message = svc.add_web_reply(db, thread, body=body, now=datetime.now(timezone.utc))
    db.commit()
    return message


def _other_workspace(db):
    """outsider 가 PM 인 공간 B 와 그 대화 하나."""
    workspace = Workspace(name="B")
    db.add(workspace)
    db.flush()
    outsider = db.query(User).filter(User.email == "outsider@example.com").one()
    member = Member(workspace_id=workspace.workspace_id, user_id=outsider.user_id, display_name="밖", role="pm")
    db.add(member)
    db.flush()
    thread = svc.get_or_create_thread(db, workspace.workspace_id, member.member_id)
    db.commit()
    return {"ws": workspace.workspace_id, "pm": member, "thread": thread.thread_id}


class Listener:
    """소켓 없이 허브에 붙는 연결. 자기 이벤트 루프를 스레드에 두고, 쌓인 신호를 그 루프에서 꺼내 본다."""

    def __init__(self, member_id, *, expires_at=None):
        self.loop = asyncio.new_event_loop()
        self.thread = threading.Thread(target=self.loop.run_forever, daemon=True)
        self.thread.start()
        self.conn = thread_signals.Connection(
            workspace_id="w", member_id=member_id, session_token="t",
            expires_at=expires_at or datetime.now(timezone.utc) + timedelta(days=1), loop=self.loop,
        )
        thread_signals.register(self.conn)

    def signals(self):
        async def take():
            found = []
            while not self.conn.outbox.empty():
                found.append(self.conn.outbox.get_nowait())
            return found

        return asyncio.run_coroutine_threadsafe(take(), self.loop).result(5)

    def stop(self):
        self.loop.call_soon_threadsafe(self.loop.stop)
        self.thread.join(5)
        self.loop.close()


@pytest.fixture
def listen():
    made = []

    def start(member_id, **kwargs):
        made.append(Listener(member_id, **kwargs))
        return made[-1]

    yield start
    for listener in made:
        listener.stop()


# 누가 받는가

def test_thread_owner_and_pm_receive_and_another_member_does_not(mdb, mseed):
    alice_thread, bob_thread = _thread(mdb, mseed), _thread(mdb, mseed, "bob")
    with _socket(mseed, "pm") as pm, _socket(mseed, "alice") as alice, _socket(mseed, "bob") as bob:
        assert _send(client("pm"), mseed, alice_thread).status_code == 201
        assert pm.receive_json() == _frame(alice_thread)
        assert alice.receive_json() == _frame(alice_thread)

        assert _send(client("pm"), mseed, bob_thread).status_code == 201
        assert bob.receive_json() == _frame(bob_thread)


def test_author_is_included_so_other_tabs_update(mdb, mseed):
    tid = _thread(mdb, mseed)
    with _socket(mseed, "alice") as first_tab, _socket(mseed, "alice") as second_tab, _socket(mseed, "pm") as pm:
        assert _send(client("alice"), mseed, tid).status_code == 201
        assert first_tab.receive_json() == _frame(tid)
        assert second_tab.receive_json() == _frame(tid)
        assert pm.receive_json() == _frame(tid)


def test_other_workspace_receives_nothing(mdb, mseed):
    tid = _thread(mdb, mseed)
    other = _other_workspace(mdb)
    with _socket(other, "outsider") as outsider:
        assert _send(client("pm"), mseed, tid).status_code == 201
        svc.add_web_reply(mdb, svc.get_or_create_thread(mdb, other["ws"], other["pm"].member_id),
                          body="네", now=datetime.now(timezone.utc))
        mdb.commit()
        assert outsider.receive_json() == _frame(other["thread"])


def test_demoted_pm_gets_the_right_signals_without_reconnecting(mdb, mseed):
    mseed["bob"].role = "pm"
    mdb.commit()
    alice_thread, bob_thread = _thread(mdb, mseed), _thread(mdb, mseed, "bob")
    with _socket(mseed, "bob") as bob:
        _reply_as_owner(mdb, mseed)
        assert bob.receive_json() == _frame(alice_thread)

        mseed["bob"].role = "member"
        mdb.commit()
        _reply_as_owner(mdb, mseed)
        _reply_as_owner(mdb, mseed, "bob")
        assert bob.receive_json() == _frame(bob_thread)


# 어떤 일이 신호인가

def test_discord_reply_signals_and_a_duplicate_sends_nothing_new(mdb, mseed):
    tid = _thread(mdb, mseed)
    with _socket(mseed, "pm") as pm:
        _discord("1001")
        assert pm.receive_json() == _frame(tid)

        again = client(service=True).post(f"{P}/bot/replies", json={
            "discord_user_id": "d_alice", "discord_message_id": "1001", "body": "네",
            "sent_at": datetime.now(timezone.utc).isoformat(),
        })
        assert again.status_code == 200, again.text
        bob_thread = _reply_as_owner(mdb, mseed, "bob").thread_id
        assert pm.receive_json() == _frame(bob_thread)


def test_reminder_dispatch_and_result_report_signal_once_each(mdb, mseed):
    tid = _thread(mdb, mseed)
    _sent_message(mdb, mseed)
    with _socket(mseed, "pm") as pm, _socket(mseed, "alice") as alice:
        (item,) = _claim()
        assert pm.receive_json() == _frame(tid)
        assert alice.receive_json() == _frame(tid)

        _report(item, "2001")
        assert pm.receive_json() == _frame(tid)

        _report(item, "2001")
        bob_thread = _reply_as_owner(mdb, mseed, "bob").thread_id
        assert pm.receive_json() == _frame(bob_thread)


def test_late_report_of_the_same_failure_is_not_a_change(mdb, mseed):
    _thread(mdb, mseed)
    _sent_message(mdb, mseed)
    (item,) = _claim()
    message = mdb.get(ThreadMessage, item["message_id"])
    message.dm_status, message.dm_failure_reason = "failed", "unknown"
    mdb.commit()
    with _socket(mseed, "pm") as pm:
        r = client(service=True).post(
            f"{P}/bot/messages/{item['message_id']}/result",
            json={"status": "failed", "failure_reason": "unknown", "discord_message_ids": []},
        )
        assert r.status_code == 200, r.text
        bob_thread = _reply_as_owner(mdb, mseed, "bob").thread_id
        assert pm.receive_json() == _frame(bob_thread)


def test_bundle_edit_and_ai_draft_do_not_signal(mdb, mseed):
    pm_client = client("pm")
    bid = _create(pm_client, mseed, note=None)["bundle"]["bundle_id"]
    with _socket(mseed, "pm") as pm:
        assert client(service=True).post(f"{P}/bot/drafts/claim").status_code == 200
        version = mdb.get(ReminderBundle, bid).draft_version
        mdb.commit()
        r = client(service=True).post(f"{P}/bot/drafts/{bid}", json={"draft_version": version, "body": BOT_DRAFT})
        assert r.status_code == 200, r.text
        assert pm_client.patch(_bundles_url(mseed, bid), json={"body": "고친 문구"}).status_code == 200

        bob_thread = _reply_as_owner(mdb, mseed, "bob").thread_id
        assert pm.receive_json() == _frame(bob_thread)


# 커밋과 신호

def test_signal_is_sent_only_after_commit(mdb, mseed, listen):
    listener = listen(mseed["pm"].member_id)
    thread = svc.get_or_create_thread(mdb, mseed["ws"], mseed["alice"].member_id)
    tid = thread.thread_id
    mdb.commit()

    svc.add_web_reply(mdb, thread, body="네", now=datetime.now(timezone.utc))
    mdb.flush()
    assert listener.signals() == []

    mdb.commit()
    assert listener.signals() == [tid]


def test_rollback_sends_nothing_even_after_a_later_commit(mdb, mseed, listen):
    listener = listen(mseed["pm"].member_id)
    thread = svc.get_or_create_thread(mdb, mseed["ws"], mseed["alice"].member_id)
    mdb.commit()

    svc.add_web_reply(mdb, thread, body="네", now=datetime.now(timezone.utc))
    mdb.rollback()
    assert listener.signals() == []

    bob_thread = _reply_as_owner(mdb, mseed, "bob").thread_id
    assert listener.signals() == [bob_thread]


def test_pm_message_signals_once_on_the_outer_commit_only(mdb, mseed, listen):
    """notify 의 SAVEPOINT 해제는 커밋이 아니다."""
    listener = listen(mseed["alice"].member_id)
    thread = svc.get_or_create_thread(mdb, mseed["ws"], mseed["alice"].member_id)
    tid = thread.thread_id
    mdb.commit()

    svc.add_pm_message(mdb, thread, author=mseed["pm"], body="자료요", now=datetime.now(timezone.utc))
    assert listener.signals() == []

    mdb.commit()
    assert listener.signals() == [tid]


def test_rolled_back_savepoint_keeps_the_signal_of_the_outer_commit(mdb, mseed, listen):
    """알림 중복 경합처럼 안쪽 SAVEPOINT 만 되돌아가도 글은 커밋된다."""
    listener = listen(mseed["pm"].member_id)
    thread = svc.get_or_create_thread(mdb, mseed["ws"], mseed["alice"].member_id)
    tid = thread.thread_id
    mdb.commit()

    svc.add_web_reply(mdb, thread, body="네", now=datetime.now(timezone.utc))
    with pytest.raises(ValueError), mdb.begin_nested():
        raise ValueError
    mdb.commit()

    assert listener.signals() == [tid]


def test_one_transaction_signals_each_thread_once(mdb, mseed, listen):
    listener = listen(mseed["pm"].member_id)
    thread = svc.get_or_create_thread(mdb, mseed["ws"], mseed["alice"].member_id)
    tid = thread.thread_id
    mdb.commit()

    for body in ("하나", "둘"):
        svc.add_web_reply(mdb, thread, body=body, now=datetime.now(timezone.utc))
    mdb.commit()

    assert listener.signals() == [tid]


def test_expired_connection_gets_no_signal(mdb, mseed, listen):
    listener = listen(mseed["pm"].member_id, expires_at=datetime.now(timezone.utc) - timedelta(seconds=1))
    _reply_as_owner(mdb, mseed)
    assert listener.signals() == []


def test_commit_on_a_plain_thread_reaches_a_socket(mdb, mseed):
    """스케줄러는 이벤트 루프가 없는 스레드에서 커밋한다."""
    tid = _thread(mdb, mseed)
    worker_session = sessionmaker(bind=mdb.get_bind(), autoflush=False)
    wid, member_id = mseed["ws"], mseed["alice"].member_id

    def work():
        with worker_session() as db:
            svc.add_web_reply(db, svc.get_or_create_thread(db, wid, member_id), body="네",
                              now=datetime.now(timezone.utc))
            db.commit()

    with _socket(mseed, "pm") as pm:
        thread = threading.Thread(target=work)
        thread.start()
        thread.join(10)
        assert pm.receive_json() == _frame(tid)


# 연결 거절

def test_no_cookie_closes_with_4401(mdb, mseed):
    with client().websocket_connect(_url(mseed["ws"]), headers=ORIGIN) as ws:
        with pytest.raises(WebSocketDisconnect) as closed:
            ws.receive_json()
    assert closed.value.code == 4401


def test_unknown_token_closes_with_4401(mdb, mseed):
    with client("nobody").websocket_connect(_url(mseed["ws"]), headers=ORIGIN) as ws:
        with pytest.raises(WebSocketDisconnect) as closed:
            ws.receive_json()
    assert closed.value.code == 4401


def test_expired_session_closes_with_4401(mdb, mseed):
    row = sessions.find_session(mdb, "pm-token")
    row.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
    mdb.commit()
    with _socket(mseed, "pm") as ws:
        with pytest.raises(WebSocketDisconnect) as closed:
            ws.receive_json()
    assert closed.value.code == 4401


def test_deleted_session_closes_with_4401(mdb, mseed):
    mdb.delete(sessions.find_session(mdb, "pm-token"))
    mdb.commit()
    with _socket(mseed, "pm") as ws:
        with pytest.raises(WebSocketDisconnect) as closed:
            ws.receive_json()
    assert closed.value.code == 4401


def test_non_member_closes_with_4403(mdb, mseed):
    with _socket(mseed, "outsider") as ws:
        with pytest.raises(WebSocketDisconnect) as closed:
            ws.receive_json()
    assert closed.value.code == 4403


def test_refused_connections_leave_nothing_in_the_hub(mdb, mseed):
    for token in ("nobody", "outsider"):
        with _socket(mseed, token) as ws:
            with pytest.raises(WebSocketDisconnect):
                ws.receive_json()
    assert not thread_signals._connections


@pytest.mark.parametrize("headers", [
    {},
    {"origin": "https://evil.example.com"},
    {"origin": "https://testserver:8443"},
    {"origin": "https://testserver.evil.example.com"},
    {"origin": "null"},
    {"origin": "http://["},
], ids=["missing", "foreign", "other-port", "suffix", "null", "malformed"])
def test_bad_origin_is_rejected_before_accept(mdb, mseed, headers):
    """accept 전에 닫으므로 소켓이 열리지 않는다. 쿠키가 유효해도 같다."""
    with pytest.raises(WebSocketDisconnect):
        with _socket(mseed, "pm", headers=headers):
            pytest.fail("소켓이 열렸다")


@pytest.mark.parametrize("origin", ["http://testserver", "https://TestServer"], ids=["scheme", "case"])
def test_origin_compares_host_only(mdb, mseed, origin):
    tid = _thread(mdb, mseed)
    with _socket(mseed, "pm", headers={"origin": origin}) as pm:
        _reply_as_owner(mdb, mseed)
        assert pm.receive_json() == _frame(tid)


def test_client_frames_are_ignored(mdb, mseed):
    tid = _thread(mdb, mseed)
    with _socket(mseed, "pm") as pm:
        pm.send_text("아무 글")
        pm.send_bytes(b"\x00")
        _reply_as_owner(mdb, mseed)
        assert pm.receive_json() == _frame(tid)


# 열린 소켓의 재검사

@pytest.fixture
def fast_revalidate(monkeypatch):
    monkeypatch.setattr(message_socket, "REVALIDATE_SECONDS", 0.3)


def _closes_with(ws):
    with pytest.raises(WebSocketDisconnect) as closed:
        ws.receive_json()
    return closed.value.code


def test_logout_closes_the_open_socket(mdb, mseed, fast_revalidate):
    with _socket(mseed, "pm") as pm:
        assert client("pm").post(f"{P}/auth/logout").status_code == 200
        assert _closes_with(pm) == 4401
    assert not thread_signals._connections


def test_password_reset_closes_the_open_socket(mdb, mseed, fast_revalidate):
    now = datetime.now(timezone.utc)
    mail = password_reset.request_reset(mdb, "pm@example.com", now=now, base_url="https://testserver")
    raw = re.search(r"token=([\w-]+)", mail.text).group(1)
    mdb.commit()
    with _socket(mseed, "pm") as pm:
        password_reset.confirm_reset(mdb, raw, "new-password-1234", now=now)
        mdb.commit()
        assert _closes_with(pm) == 4401


def test_session_expiring_while_open_closes_the_socket(mdb, mseed, fast_revalidate):
    with _socket(mseed, "pm") as pm:
        sessions.find_session(mdb, "pm-token").expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        mdb.commit()
        assert _closes_with(pm) == 4401


def test_leaving_the_workspace_closes_the_open_socket_with_4403(mdb, mseed, fast_revalidate):
    with _socket(mseed, "bob") as bob:
        mseed["bob"].is_deleted = True
        mdb.commit()
        assert _closes_with(bob) == 4403


def test_session_that_stays_valid_keeps_the_socket_open_across_checks(mdb, mseed, monkeypatch):
    tid = _thread(mdb, mseed)
    monkeypatch.setattr(message_socket, "REVALIDATE_SECONDS", 0.01)
    checks, settled = [], threading.Event()
    original = message_socket._authorize

    def counted(*args):
        result = original(*args)
        checks.append(result)
        if len(checks) == 4:
            # 이후로는 검사가 돌지 않으니 아래 커밋이 sqlite 의 공유 연결에서 롤백과 겹치지 않는다.
            monkeypatch.setattr(message_socket, "REVALIDATE_SECONDS", 3600)
            settled.set()
        return result

    monkeypatch.setattr(message_socket, "_authorize", counted)
    with _socket(mseed, "pm") as pm:
        assert settled.wait(5)
        _reply_as_owner(mdb, mseed)
        assert pm.receive_json() == _frame(tid)


# 메모리와 실패

def test_closed_socket_leaves_the_hub(mdb, mseed):
    with _socket(mseed, "pm"):
        assert len(thread_signals._connections[mseed["pm"].member_id]) == 1
    assert not thread_signals._connections


def test_abrupt_disconnect_leaves_the_hub(mdb, mseed):
    with _socket(mseed, "pm") as pm:
        pm.send({"type": "websocket.disconnect", "code": 1006})
        for _ in range(100):
            if not thread_signals._connections:
                break
            time.sleep(0.01)
    assert not thread_signals._connections


def test_one_of_two_tabs_closing_keeps_the_other(mdb, mseed):
    tid = _thread(mdb, mseed)
    with _socket(mseed, "pm") as stays:
        with _socket(mseed, "pm"):
            pass
        _reply_as_owner(mdb, mseed)
        assert stays.receive_json() == _frame(tid)


def test_post_succeeds_with_no_connections(mdb, mseed):
    assert _send(client("pm"), mseed, _thread(mdb, mseed)).status_code == 201


def test_dead_loop_does_not_fail_the_request_and_is_dropped(mdb, mseed):
    loop = asyncio.new_event_loop()
    loop.close()
    thread_signals.register(thread_signals.Connection(
        workspace_id=mseed["ws"], member_id=mseed["pm"].member_id, session_token="t",
        expires_at=datetime.now(timezone.utc) + timedelta(days=1), loop=loop,
    ))

    assert _send(client("alice"), mseed, _thread(mdb, mseed)).status_code == 201
    assert not thread_signals._connections


def test_full_outbox_closes_with_1013(mdb, mseed, monkeypatch):
    """받지 못하는 클라이언트의 신호를 조용히 버리지 않는다. 끊겨야 다시 붙어 조회로 맞춘다."""
    monkeypatch.setattr(thread_signals, "OUTBOX_SIZE", 1)
    release = asyncio.Event()

    async def stuck(self, data, mode="text"):
        await release.wait()

    monkeypatch.setattr(WebSocket, "send_json", stuck)
    with _socket(mseed, "pm") as pm:
        for _ in range(3):
            _reply_as_owner(mdb, mseed)
        assert _closes_with(pm) == 1013
    assert not thread_signals._connections
