"""워크스페이스 메시지·알림 설정 조회·변경(#339)."""
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models import Integration, Member, Workspace
from app.services import message_settings as svc

P = "/api/v1"
NOW = datetime(2026, 11, 4, 0, 0, tzinfo=timezone.utc)


def client(token: str) -> TestClient:
    c = TestClient(app, base_url="https://testserver")
    c.cookies.set("session_token", f"{token}-token")
    return c


def _utc(dt):
    # SQLite 는 commit 뒤 다시 읽을 때 tz 를 잃는다.
    return dt if dt is None or dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def url(seed) -> str:
    return f"{P}/workspaces/{seed['ws']}/message-settings"


DEFAULTS = {
    "due_reminder": True, "minutes_summary": True, "silence_alert": True,
    "nudge_rule": {"days_before": 1, "hour": 9}, "pm_alert_method": "both", "reminder_auto_approve": False,
}


def test_get_returns_defaults_before_saving(mdb, mseed):
    r = client("pm").get(url(mseed))
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert {k: data[k] for k in DEFAULTS} == DEFAULTS
    assert data["saved"] is False
    assert data["updated_by"] is None


def test_member_can_read_but_not_change(mdb, mseed):
    assert client("alice").get(url(mseed)).status_code == 200
    r = client("alice").patch(url(mseed), json={"silence_alert": False})
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "FORBIDDEN"


def test_outsider_gets_403(mdb, mseed):
    assert client("outsider").get(url(mseed)).status_code == 403


def test_patch_changes_only_sent_keys(mdb, mseed):
    r = client("pm").patch(url(mseed), json={"silence_alert": False})
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert data["silence_alert"] is False
    assert {k: data[k] for k in DEFAULTS if k != "silence_alert"} == {
        k: v for k, v in DEFAULTS.items() if k != "silence_alert"
    }
    assert data["saved"] is True
    assert data["updated_by"] == mseed["pm"].member_id

    r = client("pm").patch(url(mseed), json={"nudge_rule": {"days_before": 2, "hour": 18}})
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert data["nudge_rule"] == {"days_before": 2, "hour": 18}
    assert data["silence_alert"] is False


@pytest.mark.parametrize("body", [
    {},
    {"unknown": 1},
    {"due_reminder": None},
    {"nudge_rule": {"days_before": 4, "hour": 9}},
    {"nudge_rule": {"days_before": 1, "hour": 24}},
    {"nudge_rule": {"days_before": 1}},
    {"pm_alert_method": "sms"},
])
def test_invalid_bodies_get_400(mdb, mseed, body):
    r = client("pm").patch(url(mseed), json=body)
    assert r.status_code == 400, r.text
    assert r.json()["error"]["code"] == "INVALID_REQUEST"
    assert client("pm").get(url(mseed)).json()["data"]["saved"] is False


def test_auto_approve_since_set_only_when_turned_on(mdb, mseed):
    wid, pm = mseed["ws"], mseed["pm"].member_id
    now1, now2, now3 = NOW, NOW + timedelta(hours=1), NOW + timedelta(hours=2)
    s = svc.update_settings(mdb, wid, {"reminder_auto_approve": True}, updated_by=pm, now=now1)
    mdb.commit()
    assert s.reminder_auto_approve is True and _utc(s.auto_approve_since) == now1
    s = svc.update_settings(mdb, wid, {"reminder_auto_approve": True}, updated_by=pm, now=now2)
    mdb.commit()
    assert _utc(s.auto_approve_since) == now1
    s = svc.update_settings(mdb, wid, {"reminder_auto_approve": False}, updated_by=pm, now=now3)
    mdb.commit()
    assert s.reminder_auto_approve is False and s.auto_approve_since is None


def test_pms_report_discord_link(mdb, mseed):
    wid = mseed["ws"]
    pms = svc.pm_contacts(mdb, wid)
    assert pms == [{"member_id": mseed["pm"].member_id, "name": "PM", "discord_linked": False}]

    mdb.add(Integration(workspace_id=wid, provider="discord", provider_channel_id="guild-1"))
    mseed["pm"].discord_user_id = "d_pm"
    mdb.commit()
    assert svc.pm_contacts(mdb, wid)[0]["discord_linked"] is True
    body = client("alice").get(url(mseed)).json()["data"]
    assert body["pms"] == [{"member_id": mseed["pm"].member_id, "name": "PM", "discord_linked": True}]

    gone = Member(workspace_id=wid, display_name="전 PM", role="pm", is_deleted=True, discord_user_id="d_old")
    mdb.add(gone)
    mdb.commit()
    assert [p["member_id"] for p in svc.pm_contacts(mdb, wid)] == [mseed["pm"].member_id]


def test_settings_are_per_workspace(mdb, mseed):
    other = Workspace(name="B")
    mdb.add(other)
    mdb.commit()
    r = client("pm").patch(url(mseed), json={"due_reminder": False})
    assert r.status_code == 200, r.text
    b = svc.get_settings(mdb, other.workspace_id)
    assert b.due_reminder is True and b.saved is False


def test_first_save_race_applies_changes_to_row_created_meanwhile(mdb, mseed, monkeypatch):
    """서비스가 행 없음으로 읽은 뒤 다른 요청이 먼저 첫 행을 만든 경우, 그 행에 이어서 적용한다."""
    from sqlalchemy import insert

    from app.models import WorkspaceMessageSettings

    wid, pm = mseed["ws"], mseed["pm"].member_id
    mdb.execute(insert(WorkspaceMessageSettings).values(
        workspace_id=wid, silence_alert=False, nudge_hour=18, updated_at=NOW,
    ))
    mdb.commit()

    real_get = mdb.get
    calls = []

    def stale_get(entity, ident, *a, **kw):
        if not calls:
            calls.append(1)
            return None
        return real_get(entity, ident, *a, **kw)

    monkeypatch.setattr(mdb, "get", stale_get)
    s = svc.update_settings(mdb, wid, {"due_reminder": False}, updated_by=pm, now=NOW)
    mdb.commit()
    assert s.due_reminder is False
    assert s.silence_alert is False and s.nudge_hour == 18
    assert s.updated_by == pm
