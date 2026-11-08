"""새 글 알림(message_received, #470). 글 하나에 알림 하나, 대화·방향마다 5분에 한 번."""
from datetime import timedelta

from app.models import Notification
from app.services import messages as svc
from tests.api.test_member_messages import _discord, _open, _send, _thread
from tests.api.test_messages_api import client
from tests.api.test_reply_judgment import _change, _claim, _judge
from tests.api.test_replies import _remind, _reply
from tests.api.test_scheduler import SLOT, H, tick

KIND = "message_received"
START = SLOT.replace(hour=1, minute=0)


def _notes(db, kind=KIND):
    db.expire_all()
    return db.query(Notification).filter(Notification.kind == kind).order_by(Notification.member_id).all()


def _to(db, kind=KIND):
    return sorted(n.member.display_name for n in _notes(db, kind))


def _pm_message(db, seed, at, *, who="alice", body="회의 자료요"):
    thread = svc.get_or_create_thread(db, seed["ws"], seed[who].member_id)
    message = svc.add_pm_message(db, thread, author=seed["pm"], body=body, now=at)
    db.commit()
    return message


def _second_pm(db, seed):
    seed["bob"].role = "pm"
    db.commit()


# 누구에게

def test_pm_message_notifies_the_thread_owner_only(mdb, mseed):
    tid = _thread(mdb, mseed)
    _send(client("pm"), mseed, tid, "내일 회의 자료 부탁해요")

    (note,) = _notes(mdb)
    assert note.member_id == mseed["alice"].member_id
    assert note.text == "PM: 내일 회의 자료 부탁해요"
    assert (note.link_type, note.link_id) == ("thread", tid)


def test_unlinked_owner_is_still_notified(mdb, mseed):
    _send(client("pm"), mseed, _thread(mdb, mseed, "bob"))

    assert _to(mdb) == ["밥"]


def test_member_web_message_notifies_every_pm(mdb, mseed):
    _second_pm(mdb, mseed)
    tid = _open(client("alice"), mseed, mseed["alice"].member_id).json()["data"]["thread_id"]
    _send(client("alice"), mseed, tid, "질문 있어요\n둘째 줄")

    notes = _notes(mdb)
    assert sorted(n.member.display_name for n in notes) == ["PM", "밥"]
    assert {n.text for n in notes} == {"앨리스: 질문 있어요"}
    assert {(n.link_type, n.link_id) for n in notes} == {("thread", tid)}


def test_discord_message_with_no_reminder_notifies_pms(mdb, mseed):
    _discord("d1")

    assert _to(mdb) == ["PM"]
    assert _notes(mdb)[0].text == "앨리스: 네"


def test_pm_writing_in_their_own_thread_is_not_told_about_it(mdb, mseed):
    _second_pm(mdb, mseed)
    _send(client("pm"), mseed, _thread(mdb, mseed, "pm"), "내 대화")

    assert _to(mdb) == ["밥"]


def test_preview_is_cut_to_the_shared_length(mdb, mseed):
    _pm_message(mdb, mseed, START, body="가" * 80)

    assert _notes(mdb)[0].text == f"PM: {'가' * 59}…"


# 판단을 타는 글

def test_reply_going_to_judgment_stays_quiet_until_the_result(mdb, mseed):
    _remind(mdb, mseed, [mseed["tasks"][0]], SLOT)
    _reply(mdb, mseed, SLOT + H)

    assert _to(mdb) == []


def test_judgment_with_nothing_to_change_falls_back_to_the_plain_alert(mdb, mseed):
    _remind(mdb, mseed, [mseed["tasks"][0]], SLOT)
    _reply(mdb, mseed, SLOT + H, body="네 확인했어요")
    _judge(_claim())

    assert _to(mdb) == ["PM"]
    assert _notes(mdb)[0].text == "앨리스: 네 확인했어요"
    assert _to(mdb, "reply_judged") == []


def test_judgment_with_a_change_alerts_once_as_reply_judged(mdb, mseed):
    task = mseed["tasks"][0]
    _remind(mdb, mseed, [task], SLOT)
    _reply(mdb, mseed, SLOT + H, body="끝났어요")
    item = _claim()
    _judge(item, _change(task, "status", "done", evidence="certain", claimed=item))

    assert _to(mdb, "reply_judged") == ["PM"]
    assert _to(mdb) == []


def test_failed_judgment_alerts_once_as_unjudged(mdb, mseed):
    _remind(mdb, mseed, [mseed["tasks"][0]], SLOT)
    _reply(mdb, mseed, SLOT + H)
    _judge(_claim(), failure="모델 오류")

    assert _to(mdb, "reply_unjudged") == ["PM"]
    assert _to(mdb) == []


def test_timed_out_judgment_alerts_once_as_unjudged(mdb, mseed):
    _remind(mdb, mseed, [mseed["tasks"][0]], SLOT)
    _reply(mdb, mseed, SLOT + H)
    tick(mdb, SLOT + 2 * H)

    assert _to(mdb, "reply_unjudged") == ["PM"]
    assert _to(mdb) == []


def test_picked_rejudge_alerts_as_reply_judged_not_plain(mdb, mseed):
    a, b = mseed["tasks"][:2]
    _remind(mdb, mseed, [a, b], SLOT)
    message = _reply(mdb, mseed, SLOT + H)
    _judge(_claim(), _change(None, "unknown"))
    assert _to(mdb, "reply_judged") == ["PM"]

    r = client("pm").post(
        f"/api/v1/workspaces/{mseed['ws']}/messages/replies/{message.message_id}/attribution",
        json={"task_id": a.task_id},
    )
    assert r.status_code == 200, r.text
    _judge(_claim())

    assert len(_notes(mdb, "reply_judged")) == 2
    assert _to(mdb) == []


# 5분에 한 번

def test_messages_in_one_direction_alert_once_per_five_minutes(mdb, mseed):
    _pm_message(mdb, mseed, START, body="첫 글")
    _pm_message(mdb, mseed, START + timedelta(minutes=4), body="둘째 글")
    assert [n.text for n in _notes(mdb)] == ["PM: 첫 글"]

    _pm_message(mdb, mseed, START + timedelta(minutes=5), body="셋째 글")
    assert sorted(n.text for n in _notes(mdb)) == ["PM: 셋째 글", "PM: 첫 글"]


def test_each_direction_has_its_own_window(mdb, mseed):
    _pm_message(mdb, mseed, START)
    _reply(mdb, mseed, START + timedelta(minutes=1))

    assert _to(mdb) == ["PM", "앨리스"]


def test_each_thread_has_its_own_window(mdb, mseed):
    _pm_message(mdb, mseed, START, who="alice")
    _pm_message(mdb, mseed, START, who="bob")

    assert _to(mdb) == ["밥", "앨리스"]
