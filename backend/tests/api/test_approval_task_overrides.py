"""승인 요청의 출처(payload change_source)와 승인하면서 고친 값(task_overrides)을 API로 확인한다(#303)."""
import json
import os
from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base, get_db
from app.main import app
from app.models import (
    ApprovalRequest,
    Extraction,
    ExtractionItem,
    Meeting,
    Member,
    Session as SessionModel,
    Task,
    TaskHistory,
    User,
    Workspace,
)

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL")


def _sqlite_engine():
    return create_engine(
        "sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )


def _pg_engine():
    engine = create_engine(TEST_DATABASE_URL)
    with engine.begin() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
    Base.metadata.drop_all(engine)
    return engine


@pytest.fixture(
    params=[
        "sqlite",
        pytest.param(
            "postgresql",
            marks=pytest.mark.skipif(not TEST_DATABASE_URL, reason="TEST_DATABASE_URL(PostgreSQL)이 없습니다."),
        ),
    ]
)
def db(request):
    engine = _pg_engine() if request.param == "postgresql" else _sqlite_engine()
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()

    def override_get_db():
        yield session

    app.dependency_overrides[get_db] = override_get_db
    try:
        yield session
    finally:
        app.dependency_overrides.pop(get_db, None)
        session.close()
        Base.metadata.drop_all(engine)
        engine.dispose()


@pytest.fixture
def seed(db):
    ws = Workspace(name="A")
    db.add(ws)
    db.flush()

    pm_user = User(email="pm@example.com", name="pm")
    db.add(pm_user)
    db.flush()
    db.add(SessionModel(
        user_id=pm_user.user_id, session_token="pm-token",
        expires_at=datetime.now(timezone.utc) + timedelta(days=1),
    ))
    pm = Member(workspace_id=ws.workspace_id, user_id=pm_user.user_id, display_name="PM", role="pm")
    jimin = Member(workspace_id=ws.workspace_id, display_name="지민", role="member")
    minsu = Member(workspace_id=ws.workspace_id, display_name="민수", role="member")
    db.add_all([pm, jimin, minsu])
    db.flush()
    other_ws = Workspace(name="B")
    db.add(other_ws)
    db.flush()
    outsider = Member(workspace_id=other_ws.workspace_id, display_name="외부", role="member")
    db.add(outsider)

    login = Task(workspace_id=ws.workspace_id, title="로그인 화면 시안", status="in_progress",
                 due_date=date(2026, 10, 3))
    meeting = Meeting(workspace_id=ws.workspace_id, status="processing")
    db.add_all([login, meeting])
    db.commit()
    return {"ws": ws, "pm": pm, "jimin": jimin, "minsu": minsu, "outsider": outsider, "login": login, "meeting": meeting}


@pytest.fixture
def client(seed):
    c = TestClient(app, base_url="https://testserver")
    c.cookies.set("session_token", "pm-token")
    return c




def _request(client, seed, type, payload, *, related_task_id=None):
    r = client.post("/api/v1/approvals", json={
        "workspace_id": seed["ws"].workspace_id, "type": type, "payload": payload,
        "related_task_id": related_task_id,
    })
    return r


def _create_approval(client, seed, type, payload, *, related_task_id=None) -> str:
    r = _request(client, seed, type, payload, related_task_id=related_task_id)
    assert r.status_code == 201, r.text
    return r.json()["data"]["approval_id"]


def _resolve(client, approval_id, status="approved", **extra):
    return client.patch(f"/api/v1/approvals/{approval_id}", json={"status": status, **extra})


def _history(db, task_id) -> list[TaskHistory]:
    db.expire_all()
    return list(db.execute(
        select(TaskHistory).where(TaskHistory.task_id == task_id).order_by(TaskHistory.created_at)
    ).scalars())


# ---------- 출처(change_source) ----------


def test_task_update_without_change_source_is_recorded_as_meeting(client, db, seed):
    approval_id = _create_approval(
        client, seed, "task_update", {"status": "done"}, related_task_id=seed["login"].task_id
    )

    assert _resolve(client, approval_id).status_code == 200

    [row] = [h for h in _history(db, seed["login"].task_id) if h.changed_field == "status"]
    assert row.change_source == "meeting"


def test_task_update_uses_change_source_from_payload(client, db, seed):
    approval_id = _create_approval(
        client, seed, "task_update", {"status": "done", "change_source": "reminder_reply"},
        related_task_id=seed["login"].task_id,
    )

    assert _resolve(client, approval_id).status_code == 200

    [row] = [h for h in _history(db, seed["login"].task_id) if h.changed_field == "status"]
    assert row.change_source == "reminder_reply"


def test_create_approval_rejects_unknown_change_source(client, seed):
    r = _request(
        client, seed, "task_update", {"status": "done", "change_source": "telepathy"},
        related_task_id=seed["login"].task_id,
    )

    assert r.status_code == 400
    assert r.json()["error"]["code"] == "INVALID_REQUEST"


def test_create_approval_rejects_non_string_change_source(client, seed):
    r = _request(client, seed, "task_update", {"status": "done", "change_source": ["meeting"]})

    assert r.status_code == 400


# ---------- 승인하면서 고치기: 공통 ----------


def _create_payload(seed, **changes) -> dict:
    return {
        "task_title": "결제 API 연동",
        "assignee_member_id": seed["jimin"].member_id,
        "due_date": "2026-10-20",
        "meeting_id": seed["meeting"].meeting_id,
        **changes,
    }


def _stored(client, approval_id) -> dict:
    return client.get(f"/api/v1/approvals/{approval_id}").json()["data"]


def _task_of(db, approval_id) -> Task:
    db.expire_all()
    return db.get(Task, db.get(ApprovalRequest, approval_id).related_task_id)


def _pending(db, approval_id) -> bool:
    db.expire_all()
    return db.get(ApprovalRequest, approval_id).status == "pending"


def _task_count(db) -> int:
    db.expire_all()
    return len(db.execute(select(Task)).scalars().all())


def _new_create(client, seed, **changes) -> str:
    return _create_approval(client, seed, "task_create", _create_payload(seed, **changes))


def test_reject_with_overrides_is_400_and_leaves_approval_pending(client, db, seed):
    approval_id = _new_create(client, seed)

    r = _resolve(client, approval_id, "rejected", task_overrides={"task_title": "바꾼 이름"})

    assert r.status_code == 400
    assert r.json()["error"]["code"] == "INVALID_REQUEST"
    # 거절이 커밋되지 않아야 한다
    assert _pending(db, approval_id)


def test_reminder_dm_with_overrides_is_400(client, db, seed):
    approval_id = _create_approval(client, seed, "reminder_dm", {"text": "마감 알림"})

    r = _resolve(client, approval_id, task_overrides={"due_date": "2026-10-20"})

    assert r.status_code == 400
    assert _pending(db, approval_id)


def test_reminder_dm_with_empty_overrides_is_fine(client, seed):
    approval_id = _create_approval(client, seed, "reminder_dm", {"text": "마감 알림"})

    assert _resolve(client, approval_id, task_overrides={}).status_code == 200


@pytest.mark.parametrize("overrides", [
    {"status": "done"},
    {"title": "새 이름"},
    {"meeting_id": "x"},
    {"blocker": "대기"},
    {"task_title": "새 이름", "extraction_item_id": "x"},
])
def test_task_create_override_outside_allow_list_is_400(client, db, seed, overrides):
    approval_id = _new_create(client, seed)

    r = _resolve(client, approval_id, task_overrides=overrides)

    assert r.status_code == 400
    assert _pending(db, approval_id)
    assert _task_count(db) == 1


@pytest.mark.parametrize("overrides", [
    {"title": "새 이름"},
    {"assignee_member_id": "x"},
    {"blocker": "대기"},
])
def test_task_update_override_outside_allow_list_is_400(client, db, seed, overrides):
    approval_id = _create_approval(
        client, seed, "task_update", {"status": "done"}, related_task_id=seed["login"].task_id
    )

    r = _resolve(client, approval_id, task_overrides=overrides)

    assert r.status_code == 400
    assert _pending(db, approval_id)


def test_null_for_task_title_is_400(client, db, seed):
    approval_id = _new_create(client, seed)

    r = _resolve(client, approval_id, task_overrides={"task_title": None})

    assert r.status_code == 400
    assert _pending(db, approval_id)


def test_null_for_status_is_400(client, db, seed):
    approval_id = _create_approval(
        client, seed, "task_update", {"due_date": "2026-10-06"}, related_task_id=seed["login"].task_id
    )

    r = _resolve(client, approval_id, task_overrides={"status": None})

    assert r.status_code == 400
    assert _pending(db, approval_id)


def test_create_approval_rejects_payload_with_overrides_key(client, seed):
    r = _request(client, seed, "task_create", _create_payload(seed, task_overrides={"task_title": "몰래 고침"}))

    assert r.status_code == 400
    assert r.json()["error"]["code"] == "INVALID_REQUEST"


# ---------- 승인하면서 고치기: task_create ----------


def test_task_create_overrides_make_task_with_final_values_and_todo(client, db, seed):
    approval_id = _new_create(client, seed, status="done")

    r = _resolve(client, approval_id, task_overrides={
        "task_title": "결제 API 연동 (v2)",
        "assignee_member_id": seed["minsu"].member_id,
        "due_date": "2026-10-27",
    })

    assert r.status_code == 200, r.text
    task = _task_of(db, approval_id)
    assert (task.title, task.assignee_member_id, task.due_date) == (
        "결제 API 연동 (v2)", seed["minsu"].member_id, date(2026, 10, 27)
    )
    # 상태는 고르지 않는다. 제안에 status가 실려 와도 항상 todo다
    assert task.status == "todo"
    assert task.version == 1


def test_task_create_payload_status_is_ignored_without_overrides(client, db, seed):
    approval_id = _new_create(client, seed, status="done")

    assert _resolve(client, approval_id).status_code == 200

    assert _task_of(db, approval_id).status == "todo"


def test_task_create_overrides_are_stored_normalized_beside_untouched_proposal(client, db, seed):
    payload = _create_payload(seed, evidence_quote="이번 주 안에 하죠")
    approval_id = _create_approval(client, seed, "task_create", payload)

    r = _resolve(client, approval_id, task_overrides={"task_title": "새 이름", "due_date": "20261027"})

    assert r.status_code == 200, r.text
    stored = r.json()["data"]["payload"]
    assert stored["task_overrides"] == {"task_title": "새 이름", "due_date": "2026-10-27"}
    assert {k: v for k, v in stored.items() if k != "task_overrides"} == payload
    assert _stored(client, approval_id)["payload"] == stored


def test_task_create_without_overrides_keeps_payload_unchanged(client, db, seed):
    payload = _create_payload(seed)
    approval_id = _create_approval(client, seed, "task_create", payload)

    r = _resolve(client, approval_id)

    assert r.json()["data"]["payload"] == payload


def test_task_create_override_equal_to_proposal_is_not_an_override(client, db, seed):
    approval_id = _new_create(client, seed)

    r = _resolve(client, approval_id, task_overrides={
        "task_title": "결제 API 연동", "due_date": "2026-10-20", "assignee_member_id": seed["jimin"].member_id,
    })

    assert r.status_code == 200, r.text
    assert "task_overrides" not in r.json()["data"]["payload"]
    # 생성 줄만 남는다
    assert [(h.changed_field, h.change_source) for h in _history(db, _task_of(db, approval_id).task_id)] == [
        ("title", "meeting")
    ]


def test_task_create_history_keeps_proposal_then_pm_override_lines(client, db, seed):
    approval_id = _new_create(client, seed)

    _resolve(client, approval_id, task_overrides={
        "task_title": "새 이름", "assignee_member_id": seed["minsu"].member_id, "due_date": "2026-10-27",
    })

    rows = _history(db, _task_of(db, approval_id).task_id)
    # 생성 줄은 제안한 제목과 원래 출처(회의)로 남는다
    assert (rows[0].changed_field, rows[0].old_value, rows[0].new_value, rows[0].change_source) == (
        "title", None, "결제 API 연동", "meeting"
    )
    assert rows[0].changed_by == seed["pm"].member_id
    edit_rows = {h.changed_field: h for h in rows[1:]}
    assert len(rows) == 4
    assert (edit_rows["title"].old_value, edit_rows["title"].new_value) == ("결제 API 연동", "새 이름")
    assert (edit_rows["assignee"].old_value, edit_rows["assignee"].new_value) == (
        seed["jimin"].member_id, seed["minsu"].member_id
    )
    assert (edit_rows["due_date"].old_value, edit_rows["due_date"].new_value) == ("2026-10-20", "2026-10-27")
    for row in edit_rows.values():
        assert (row.change_source, row.changed_by) == ("manual", seed["pm"].member_id)


def test_task_create_creation_line_source_is_manual_without_meeting(client, db, seed):
    payload = _create_payload(seed)
    del payload["meeting_id"]
    approval_id = _create_approval(client, seed, "task_create", payload)

    _resolve(client, approval_id, task_overrides={"task_title": "새 이름"})

    rows = _history(db, _task_of(db, approval_id).task_id)
    assert [(h.new_value, h.change_source) for h in rows] == [("결제 API 연동", "manual"), ("새 이름", "manual")]


def test_task_create_null_overrides_mean_undetermined(client, db, seed):
    approval_id = _new_create(client, seed)

    r = _resolve(client, approval_id, task_overrides={"due_date": None, "assignee_member_id": None})

    assert r.status_code == 200, r.text
    task = _task_of(db, approval_id)
    assert (task.assignee_member_id, task.due_date) == (None, None)
    assert r.json()["data"]["payload"]["task_overrides"] == {"due_date": None, "assignee_member_id": None}
    rows = {h.changed_field: h for h in _history(db, task.task_id)}
    assert (rows["due_date"].old_value, rows["due_date"].new_value) == ("2026-10-20", None)
    assert (rows["assignee"].old_value, rows["assignee"].new_value) == (seed["jimin"].member_id, None)


def test_task_create_null_override_on_null_proposal_is_not_an_override(client, db, seed):
    approval_id = _new_create(client, seed, due_date=None)

    r = _resolve(client, approval_id, task_overrides={"due_date": None, "task_title": "새 이름"})

    assert r.status_code == 200, r.text
    task = _task_of(db, approval_id)
    assert (task.assignee_member_id, task.due_date) == (seed["jimin"].member_id, None)
    assert r.json()["data"]["payload"]["task_overrides"] == {"task_title": "새 이름"}


def test_task_create_override_replaces_assignee_that_would_be_rejected_in_proposal(client, db, seed):
    approval_id = _new_create(
        client, seed, assignee_member_id=seed["outsider"].member_id, due_date="내일까지"
    )

    r = _resolve(client, approval_id, task_overrides={
        "assignee_member_id": seed["jimin"].member_id, "due_date": "2026-10-22",
    })

    assert r.status_code == 200, r.text
    task = _task_of(db, approval_id)
    assert (task.assignee_member_id, task.due_date) == (seed["jimin"].member_id, date(2026, 10, 22))
    rows = {h.changed_field: h for h in _history(db, task.task_id)}
    assert rows["due_date"].old_value == "내일까지"
    assert rows["assignee"].old_value == seed["outsider"].member_id


def test_task_create_invalid_proposal_without_override_is_still_400(client, db, seed):
    approval_id = _new_create(client, seed, assignee_member_id=seed["outsider"].member_id)

    r = _resolve(client, approval_id)

    assert r.status_code == 400
    assert _pending(db, approval_id)


def test_task_create_override_with_assignee_from_other_workspace_is_400(client, db, seed):
    approval_id = _new_create(client, seed)

    r = _resolve(client, approval_id, task_overrides={"assignee_member_id": seed["outsider"].member_id})

    # WORKSPACE_MISMATCH 는 400이다
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "WORKSPACE_MISMATCH"
    assert _pending(db, approval_id)
    assert _task_count(db) == 1
    assert "task_overrides" not in _stored(client, approval_id)["payload"]


def test_task_create_override_with_unknown_assignee_is_404(client, db, seed):
    approval_id = _new_create(client, seed)

    r = _resolve(client, approval_id, task_overrides={"assignee_member_id": "no-such-member"})

    assert r.status_code == 404
    assert r.json()["error"]["code"] == "MEMBER_NOT_FOUND"
    assert _pending(db, approval_id)


@pytest.mark.parametrize("overrides", [
    {"due_date": "다음 주"},
    {"due_date": "2026-13-45"},
    {"task_title": "   "},
    {"task_title": "가" * 301},
    {"task_title": 7},
    {"assignee_member_id": 7},
])
def test_task_create_bad_override_values_are_400(client, db, seed, overrides):
    approval_id = _new_create(client, seed)

    r = _resolve(client, approval_id, task_overrides=overrides)

    assert r.status_code == 400
    assert _pending(db, approval_id)
    assert _task_count(db) == 1
    assert "task_overrides" not in _stored(client, approval_id)["payload"]


def test_overrides_are_ignored_from_payload_when_resolving(client, db, seed):
    # 요청 payload 가 아니라 DB의 payload 에 overrides 가 들어 있어도 읽지 않는다
    approval = ApprovalRequest(
        workspace_id=seed["ws"].workspace_id, type="task_create",
        payload=json.dumps({**_create_payload(seed), "task_overrides": {"task_title": "몰래 고침"}}, ensure_ascii=False),
    )
    db.add(approval)
    db.commit()

    r = _resolve(client, approval.approval_id)

    assert r.status_code == 200, r.text
    assert _task_of(db, approval.approval_id).title == "결제 API 연동"


# ---------- 승인하면서 고치기: task_update ----------


def _update_approval(client, seed, **payload) -> str:
    return _create_approval(client, seed, "task_update", payload, related_task_id=seed["login"].task_id)


def _login(db, seed) -> Task:
    db.expire_all()
    return db.get(Task, seed["login"].task_id)


def test_task_update_overrides_override_proposed_values(client, db, seed):
    approval_id = _update_approval(client, seed, status="done", due_date="2026-10-06", change_source="reminder_reply")

    r = _resolve(client, approval_id, task_overrides={"status": "blocked", "due_date": "2026-10-09"})

    assert r.status_code == 200, r.text
    task = _login(db, seed)
    assert (task.status, task.due_date) == ("blocked", date(2026, 10, 9))
    assert r.json()["data"]["payload"]["task_overrides"] == {"status": "blocked", "due_date": "2026-10-09"}
    assert r.json()["data"]["payload"]["status"] == "done"


def test_task_update_applies_unchanged_fields_with_proposal_source_and_overridden_with_manual(client, db, seed):
    approval_id = _update_approval(client, seed, status="done", due_date="2026-10-06", change_source="reminder_reply")

    _resolve(client, approval_id, task_overrides={"due_date": "2026-10-09"})

    rows = {h.changed_field: h for h in _history(db, seed["login"].task_id)}
    assert (rows["status"].new_value, rows["status"].change_source) == ("done", "reminder_reply")
    assert (rows["due_date"].old_value, rows["due_date"].new_value, rows["due_date"].change_source) == (
        "2026-10-03", "2026-10-09", "manual"
    )
    assert rows["due_date"].changed_by == seed["pm"].member_id
    # 제안 값을 거치지 않으므로 제안 반영 줄은 상태 하나뿐이다
    assert sorted(h.changed_field for h in _history(db, seed["login"].task_id)) == ["due_date", "status"]


def test_task_update_override_on_field_missing_from_proposal(client, db, seed):
    approval_id = _update_approval(client, seed, status="done")

    r = _resolve(client, approval_id, task_overrides={"due_date": None})

    assert r.status_code == 200, r.text
    task = _login(db, seed)
    assert (task.status, task.due_date) == ("done", None)
    assert r.json()["data"]["payload"]["task_overrides"] == {"due_date": None}


def test_task_update_override_equal_to_proposal_is_applied_as_proposal(client, db, seed):
    approval_id = _update_approval(client, seed, status="done")

    r = _resolve(client, approval_id, task_overrides={"status": "done"})

    assert r.status_code == 200, r.text
    assert "task_overrides" not in r.json()["data"]["payload"]
    [row] = _history(db, seed["login"].task_id)
    assert row.change_source == "meeting"


@pytest.mark.parametrize("overrides", [{"status": "almost"}, {"due_date": "곧"}])
def test_task_update_bad_override_values_are_400(client, db, seed, overrides):
    approval_id = _update_approval(client, seed, status="done")

    r = _resolve(client, approval_id, task_overrides=overrides)

    assert r.status_code == 400
    assert _pending(db, approval_id)
    assert _login(db, seed).status == "in_progress"


def test_task_update_with_overrides_bumps_version_for_proposal_and_for_override(client, db, seed):
    approval_id = _update_approval(client, seed, status="done", due_date="2026-10-06")

    _resolve(client, approval_id, task_overrides={"due_date": "2026-10-09"})

    # 제안 값 반영 한 번, PM 수정 반영 한 번
    assert _login(db, seed).version == 3


# ---------- 승인하면서 고치기: 충돌 검사 ----------


def _propose_conflicting(client, seed, **fields) -> str:
    return _update_approval(client, seed, base_values={"due_date": "2026-10-03", "status": "in_progress"}, **fields)


def _edit_task(client, task: Task, **fields):
    r = client.patch(f"/api/v1/tasks/{task.task_id}", json=fields)
    assert r.status_code == 200, r.text


def test_conflict_is_still_detected_with_overrides_present(client, db, seed):
    approval_id = _propose_conflicting(client, seed, due_date="2026-10-06", status="done")
    _edit_task(client, seed["login"], due_date="2026-10-10")

    r = _resolve(client, approval_id, task_overrides={"status": "blocked"})

    assert r.status_code == 409
    assert r.json()["error"]["code"] == "APPROVAL_CONFLICT"
    assert r.json()["error"]["details"]["conflicts"] == [
        {"field": "due_date", "base": "2026-10-03", "current": "2026-10-10", "proposed": "2026-10-06"}
    ]
    assert _pending(db, approval_id)
    task = _login(db, seed)
    assert (task.status, task.due_date) == ("in_progress", date(2026, 10, 10))
    assert "task_overrides" not in _stored(client, approval_id)["payload"]


def test_conflict_on_overridden_field_reports_pm_value_as_proposed(client, db, seed):
    approval_id = _propose_conflicting(client, seed, due_date="2026-10-06")
    _edit_task(client, seed["login"], due_date="2026-10-10")

    r = _resolve(client, approval_id, task_overrides={"due_date": "2026-10-15"})

    assert r.status_code == 409
    assert r.json()["error"]["details"]["conflicts"] == [
        {"field": "due_date", "base": "2026-10-03", "current": "2026-10-10", "proposed": "2026-10-15"}
    ]


def test_current_value_equal_to_pm_override_is_not_a_conflict(client, db, seed):
    approval_id = _propose_conflicting(client, seed, due_date="2026-10-06")
    _edit_task(client, seed["login"], due_date="2026-10-10")

    r = _resolve(client, approval_id, task_overrides={"due_date": "2026-10-10"})

    assert r.status_code == 200, r.text
    assert _login(db, seed).due_date == date(2026, 10, 10)


def test_confirm_task_version_applies_with_overrides_after_conflict(client, db, seed):
    approval_id = _propose_conflicting(client, seed, due_date="2026-10-06")
    _edit_task(client, seed["login"], due_date="2026-10-10")
    seen = _resolve(client, approval_id, task_overrides={"due_date": "2026-10-15"}).json()["error"]["details"]["task_version"]

    r = _resolve(client, approval_id, task_overrides={"due_date": "2026-10-15"}, confirm_task_version=seen)

    assert r.status_code == 200, r.text
    assert _login(db, seed).due_date == date(2026, 10, 15)
    assert r.json()["data"]["payload"]["task_overrides"] == {"due_date": "2026-10-15"}


def test_confirm_task_version_is_rejected_if_task_changed_again_with_overrides(client, db, seed):
    approval_id = _propose_conflicting(client, seed, due_date="2026-10-06")
    _edit_task(client, seed["login"], due_date="2026-10-10")
    seen = _resolve(client, approval_id, task_overrides={"status": "blocked"}).json()["error"]["details"]["task_version"]
    _edit_task(client, seed["login"], due_date="2026-10-12")

    r = _resolve(client, approval_id, task_overrides={"status": "blocked"}, confirm_task_version=seen)

    assert r.status_code == 409
    assert _pending(db, approval_id)


def test_target_title_change_is_still_a_conflict_with_overrides(client, db, seed):
    approval_id = _update_approval(client, seed, status="done", base_title="로그인 화면 시안")
    _edit_task(client, seed["login"], title="회원가입 화면 시안")

    r = _resolve(client, approval_id, task_overrides={"due_date": "2026-10-09"})

    assert r.status_code == 409
    assert r.json()["error"]["details"]["conflicts"][0]["field"] == "title"


def _rollback(client, task_id, history_id):
    return client.post(f"/api/v1/tasks/{task_id}/history/{history_id}/rollback")


def test_rolling_back_override_to_invalid_proposed_due_date_is_400(client, db, seed):
    approval_id = _new_create(client, seed, due_date="내일까지")
    assert _resolve(client, approval_id, task_overrides={"due_date": "2026-10-22"}).status_code == 200
    task = _task_of(db, approval_id)
    line = {h.changed_field: h for h in _history(db, task.task_id)}["due_date"]

    r = _rollback(client, task.task_id, line.history_id)

    assert r.status_code == 400, r.text
    db.expire_all()
    assert db.get(Task, task.task_id).due_date == date(2026, 10, 22)


def test_rolling_back_override_to_other_workspace_assignee_is_400(client, db, seed):
    approval_id = _new_create(client, seed, assignee_member_id=seed["outsider"].member_id)
    overrides = {"assignee_member_id": seed["jimin"].member_id}
    assert _resolve(client, approval_id, task_overrides=overrides).status_code == 200
    task = _task_of(db, approval_id)
    line = {h.changed_field: h for h in _history(db, task.task_id)}["assignee"]

    r = _rollback(client, task.task_id, line.history_id)

    assert r.status_code == 400, r.text
    db.expire_all()
    assert db.get(Task, task.task_id).assignee_member_id == seed["jimin"].member_id


def test_task_create_uses_change_source_from_payload(client, db, seed):
    approval_id = _new_create(client, seed, change_source="reminder_reply")

    assert _resolve(client, approval_id).status_code == 200

    [row] = _history(db, _task_of(db, approval_id).task_id)
    assert row.change_source == "reminder_reply"


def test_task_create_with_non_string_proposed_title_can_be_fixed_by_override(client, db, seed):
    approval_id = _new_create(client, seed, task_title=["결제"])

    r = _resolve(client, approval_id, task_overrides={"task_title": "결제 API"})

    assert r.status_code == 200, r.text
    assert _task_of(db, approval_id).title == "결제 API"


def test_rolling_back_title_override_of_non_string_proposal_is_400(client, db, seed):
    approval_id = _new_create(client, seed, task_title=["결제"])
    assert _resolve(client, approval_id, task_overrides={"task_title": "결제 API"}).status_code == 200
    task = _task_of(db, approval_id)
    [line] = [h for h in _history(db, task.task_id) if h.change_source == "manual"]

    r = _rollback(client, task.task_id, line.history_id)

    assert r.status_code == 400, r.text
    assert _task_of(db, approval_id).title == "결제 API"


# ---------- 탈퇴 팀원 담당자 ----------


def _leave(db, member):
    member.is_deleted = True
    member.deleted_at = datetime.now(timezone.utc)
    db.commit()


def test_task_create_override_with_left_member_is_404(client, db, seed):
    left_id = seed["minsu"].member_id
    approval_id = _new_create(client, seed)
    _leave(db, seed["minsu"])

    r = _resolve(client, approval_id, task_overrides={"assignee_member_id": left_id})

    assert r.status_code == 404
    assert r.json()["error"]["code"] == "MEMBER_NOT_FOUND"
    assert _pending(db, approval_id)


def test_task_create_override_can_replace_left_member_in_proposal(client, db, seed):
    approval_id = _new_create(client, seed, assignee_member_id=seed["minsu"].member_id)
    _leave(db, seed["minsu"])
    assert _resolve(client, approval_id).status_code == 404

    r = _resolve(client, approval_id, task_overrides={"assignee_member_id": seed["jimin"].member_id})

    assert r.status_code == 200, r.text
    assert _task_of(db, approval_id).assignee_member_id == seed["jimin"].member_id


def test_rolling_back_to_left_assignee_is_404(client, db, seed):
    approval_id = _new_create(client, seed, assignee_member_id=seed["minsu"].member_id)
    overrides = {"assignee_member_id": seed["jimin"].member_id}
    assert _resolve(client, approval_id, task_overrides=overrides).status_code == 200
    task = _task_of(db, approval_id)
    line = {h.changed_field: h for h in _history(db, task.task_id)}["assignee"]
    _leave(db, seed["minsu"])

    r = _rollback(client, task.task_id, line.history_id)

    assert r.status_code == 404, r.text
    db.expire_all()
    assert db.get(Task, task.task_id).assignee_member_id == seed["jimin"].member_id


def test_patch_keeping_left_assignee_still_saves_other_fields(client, db, seed):
    login = seed["login"]
    login.assignee_member_id = seed["minsu"].member_id
    db.commit()
    _leave(db, seed["minsu"])

    r = client.patch(f"/api/v1/tasks/{login.task_id}", json={
        "title": "로그인 화면 시안 2차", "assignee_member_id": seed["minsu"].member_id,
    })

    assert r.status_code == 200, r.text


# ---------- 처리 순서 ----------


def test_resolved_approval_with_bad_override_is_409_not_400(client, db, seed):
    approval_id = _new_create(client, seed)
    assert _resolve(client, approval_id, "rejected").status_code == 200

    r = _resolve(client, approval_id, task_overrides={"due_date": "다음 주"})

    assert r.status_code == 409
    assert r.json()["error"]["code"] == "APPROVAL_ALREADY_RESOLVED"


# ---------- 출처는 PM 만 ----------


@pytest.fixture
def member_client(db, seed):
    user = User(email="jimin@example.com", name="지민")
    db.add(user)
    db.flush()
    db.add(SessionModel(
        user_id=user.user_id, session_token="jimin-token",
        expires_at=datetime.now(timezone.utc) + timedelta(days=1),
    ))
    seed["jimin"].user_id = user.user_id
    db.commit()
    c = TestClient(app, base_url="https://testserver")
    c.cookies.set("session_token", "jimin-token")
    return c


def test_member_cannot_choose_change_source(member_client, seed):
    r = _request(member_client, seed, "task_update", {"status": "done", "change_source": "meeting"},
                 related_task_id=seed["login"].task_id)

    assert r.status_code == 400
    assert r.json()["error"]["details"]["field"] == "change_source"


def test_member_request_without_change_source_still_works(member_client, seed):
    r = _request(member_client, seed, "task_update", {"status": "done"},
                 related_task_id=seed["login"].task_id)

    assert r.status_code == 201, r.text


# ---------- 추출 항목 연결 ----------


def _linked_create(client, db, seed) -> tuple[str, str]:
    extraction = Extraction(meeting_id=seed["meeting"].meeting_id)
    db.add(extraction)
    db.flush()
    item = ExtractionItem(extraction_id=extraction.extraction_id, task_title="결제 API")
    db.add(item)
    db.commit()
    approval_id = _new_create(client, seed, extraction_item_id=item.item_id)
    item.approval_id = approval_id
    db.commit()
    return approval_id, item.item_id


def test_task_create_with_override_links_extraction_item(client, db, seed):
    approval_id, item_id = _linked_create(client, db, seed)

    r = _resolve(client, approval_id, task_overrides={"task_title": "결제 API 연동"})

    assert r.status_code == 200, r.text
    db.expire_all()
    assert db.get(ExtractionItem, item_id).task_id == _task_of(db, approval_id).task_id


def test_rejected_override_assignee_leaves_extraction_item_unlinked(client, db, seed):
    approval_id, item_id = _linked_create(client, db, seed)

    r = _resolve(client, approval_id, task_overrides={"assignee_member_id": "no-such-member"})

    assert r.status_code == 404
    db.expire_all()
    assert db.get(ExtractionItem, item_id).task_id is None
    assert _pending(db, approval_id)
    assert _task_count(db) == 1
