"""승인 대기 카드 합치기와 승인·다른 합치기가 겹칠 때(#141 PR 2). 행 잠금은 PostgreSQL 에서만 의미가 있어
TEST_DATABASE_URL 이 없으면 건너뛴다.

요청은 실제 API(TestClient)로 보낸다. 요청마다 새 세션을 열어 스레드끼리 세션을 나누지 않는다.
앱 스레드는 이 테스트의 스레드가 아니라 threadpool 이라 스레드 이름으로 요청을 가릴 수 없다. 그래서 순서는
SQL 문장(승인 요청 행 FOR UPDATE, 승인의 상태 UPDATE)으로 고정한다.
"""
import json
import os
import threading
import time
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, select, text
from sqlalchemy.orm import sessionmaker

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
    User,
    Workspace,
)
from app.services.sessions import hash_session_token

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL")
SERVICE_TOKEN = "test-service-token"
SERVICE_HEADERS = {"X-Service-Token": SERVICE_TOKEN}
JOIN_TIMEOUT = 30
# 기다리는 쪽이 정말 잠금에 걸릴 시간을 주는 간격. 이 값이 작아도 순서는 이벤트로 이미 고정돼 있다
SETTLE = 0.5


def _locks_cards(statement: str) -> bool:
    return "FOR UPDATE" in statement and "FROM approval_request" in statement


def _resolves_card(statement: str) -> bool:
    return statement.lstrip().startswith("UPDATE approval_request") and "resolved_by" in statement


@pytest.fixture
def pg(monkeypatch):
    if not TEST_DATABASE_URL:
        pytest.skip("행 잠금은 PostgreSQL 에서만 확인한다(TEST_DATABASE_URL 없음)")
    monkeypatch.setenv("SERVICE_TOKEN", SERVICE_TOKEN)
    engine = create_engine(TEST_DATABASE_URL)
    with engine.begin() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False)

    def override_get_db():
        db = factory()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    try:
        yield engine, factory
    finally:
        app.dependency_overrides.pop(get_db, None)
        engine.dispose()
        cleanup = create_engine(TEST_DATABASE_URL)
        Base.metadata.drop_all(cleanup)
        cleanup.dispose()


@pytest.fixture
def seed(pg):
    _, factory = pg
    with factory() as db:
        ws = Workspace(name="A")
        db.add(ws)
        db.flush()
        pm_user = User(email="pm@example.com", name="pm")
        db.add(pm_user)
        db.flush()
        db.add(SessionModel(
            user_id=pm_user.user_id, session_token=hash_session_token("pm-token"),
            expires_at=datetime.now(timezone.utc) + timedelta(days=1),
        ))
        db.add(Member(workspace_id=ws.workspace_id, user_id=pm_user.user_id, display_name="PM", role="pm"))
        # 카드를 만드는 회의 하나와 합치는 회의 셋. 회의마다 추출은 하나뿐이라 합치는 쪽은 카드와 다른 회의여야 한다
        meetings = [Meeting(workspace_id=ws.workspace_id, status="processing") for _ in range(4)]
        db.add_all(meetings)
        db.commit()
        return {"ws": ws.workspace_id, "meetings": [m.meeting_id for m in meetings]}


def _client() -> TestClient:
    c = TestClient(app, base_url="https://testserver")
    c.cookies.set("session_token", "pm-token")
    return c


def _judge(**fields) -> dict:
    return {
        "action": "create",
        "category": "decision",
        "task_title": "결제 API 연동",
        "doc_text": "결제 API 연동을 하기로 함",
        "assignee_type": "none",
        "due_date": "2026-10-20",
        "evidence_quote": "결제 API 붙여 주세요",
        "evidence_speaker": "uid-pm",
        "task_status": "certain",
        "due_status": "certain",
        # 유사 task 가 있다고 보내 review 카드가 되게 한다(auto 면 카드 없이 task 가 바로 생긴다)
        "similar_count": 1,
        "top_similarity": 0.8,
        **fields,
    }


def _merge_item(card_id: str, **fields) -> dict:
    return _judge(action="merge", target_approval_id=card_id, category="due", due_date="2026-10-25", **fields)


def _post_extraction(client: TestClient, seed: dict, meeting_index: int, items: list[dict]):
    return client.post("/api/v1/extractions", json={
        "meeting_id": seed["meetings"][meeting_index],
        "workspace_id": seed["ws"],
        "items": items,
    }, headers=SERVICE_HEADERS)


def _make_cards(factory, seed: dict, titles: list[str]) -> list[str]:
    """첫 회의 한 번으로 review 카드를 제목마다 하나씩 만들고 approval_id 를 항목 순서대로 돌려준다."""
    r = _post_extraction(_client(), seed, 0, [_judge(task_title=t) for t in titles])
    assert r.status_code == 201, r.text
    with factory() as db:
        by_title = {json.loads(c.payload)["task_title"]: c.approval_id for c in db.scalars(select(ApprovalRequest))}
    return [by_title[t] for t in titles]


def _run(results: dict, **targets):
    """대상마다 스레드를 띄워 결과를 모은다. 예외는 문자열로 남겨 실패 원인이 보이게 한다."""

    def wrap(name, fn):
        def run():
            try:
                results[name] = fn()
            except Exception as e:  # noqa: BLE001
                results[name] = f"{type(e).__name__}: {str(e).splitlines()[0] if str(e) else ''}"

        return run

    threads = [threading.Thread(target=wrap(n, fn), name=n) for n, fn in targets.items()]
    for t in threads:
        t.start()
    for t in threads:
        t.join(JOIN_TIMEOUT)
    assert not any(t.is_alive() for t in threads), "threads did not finish (deadlock?)"


def _approve(card_id: str):
    return _client().patch(f"/api/v1/approvals/{card_id}", json={"status": "approved"})


def _db_state(factory):
    with factory() as db:
        return (
            list(db.scalars(select(ApprovalRequest).order_by(ApprovalRequest.created_at))),
            list(db.scalars(select(Task))),
            list(db.scalars(
                select(ExtractionItem)
                .join(Extraction, Extraction.extraction_id == ExtractionItem.extraction_id)
                .order_by(ExtractionItem.created_at)
            )),
        )


def test_approval_waits_for_merge_lock_and_creates_task_from_merged_card(pg, seed):
    engine, factory = pg
    [card_id] = _make_cards(factory, seed, ["결제 API 연동"])
    merge_holds_card, approval_is_waiting = threading.Event(), threading.Event()
    state = {"merge_locked": False}

    # 합치기가 카드를 잠근 직후 멈춘다. 승인이 상태 UPDATE 를 보내 그 잠금에 걸린 뒤에야 풀어, 승인이
    # 합치기 전의 값이 아니라 합쳐진 값으로 task 를 만드는지 본다
    def before(conn, cursor, statement, params, context, executemany):
        if _resolves_card(statement):
            approval_is_waiting.set()

    def after(conn, cursor, statement, params, context, executemany):
        if _locks_cards(statement) and not state["merge_locked"]:
            state["merge_locked"] = True
            merge_holds_card.set()
            approval_is_waiting.wait(10)
            time.sleep(SETTLE)

    def merge():
        try:
            return _post_extraction(_client(), seed, 1, [_merge_item(card_id)]).status_code
        finally:
            merge_holds_card.set()

    def approve():
        merge_holds_card.wait(10)
        try:
            return _approve(card_id).status_code
        finally:
            approval_is_waiting.set()

    results: dict = {}
    event.listen(engine, "before_cursor_execute", before)
    event.listen(engine, "after_cursor_execute", after)
    try:
        _run(results, merge=merge, approve=approve)
    finally:
        approval_is_waiting.set()
        event.remove(engine, "before_cursor_execute", before)
        event.remove(engine, "after_cursor_execute", after)

    assert results == {"merge": 201, "approve": 200}
    cards, tasks, items = _db_state(factory)
    assert [c.status for c in cards] == ["approved"]
    [task] = tasks
    # 합친 마감(10/25)이 task 에 들어간다. 합치기 전 값(10/20)이면 승인이 낡은 payload 로 task 를 만든 것이다
    assert task.due_date.isoformat() == "2026-10-25"
    assert len(items) == 2
    assert {i.task_id for i in items} == {task.task_id}
    assert {i.approval_id for i in items} == {card_id}


def test_merge_waits_for_approval_and_becomes_new_review_card(pg, seed):
    engine, factory = pg
    [card_id] = _make_cards(factory, seed, ["결제 API 연동"])
    approval_holds_card, merge_is_waiting = threading.Event(), threading.Event()
    state = {"resolved": False}

    # 승인이 상태 UPDATE 로 카드를 잠근 직후 멈춘다. 합치기가 카드 FOR UPDATE 에서 기다린 뒤 승인이 커밋되면,
    # 합치기는 처리된 카드를 알아보고 새 카드로 만들어야 한다
    def before(conn, cursor, statement, params, context, executemany):
        if _locks_cards(statement):
            merge_is_waiting.set()

    def after(conn, cursor, statement, params, context, executemany):
        if _resolves_card(statement) and not state["resolved"]:
            state["resolved"] = True
            approval_holds_card.set()
            merge_is_waiting.wait(10)
            time.sleep(SETTLE)

    def approve():
        try:
            return _approve(card_id).status_code
        finally:
            approval_holds_card.set()

    def merge():
        approval_holds_card.wait(10)
        try:
            return _post_extraction(_client(), seed, 1, [_merge_item(card_id)]).status_code
        finally:
            merge_is_waiting.set()

    results: dict = {}
    event.listen(engine, "before_cursor_execute", before)
    event.listen(engine, "after_cursor_execute", after)
    try:
        _run(results, approve=approve, merge=merge)
    finally:
        merge_is_waiting.set()
        event.remove(engine, "before_cursor_execute", before)
        event.remove(engine, "after_cursor_execute", after)

    assert results == {"approve": 200, "merge": 201}
    cards, tasks, items = _db_state(factory)
    by_id = {c.approval_id: c for c in cards}
    assert by_id[card_id].status == "approved"
    # 원래 카드는 합치기 없이 승인됐다
    assert "merged_items" not in json.loads(by_id[card_id].payload)
    assert json.loads(by_id[card_id].payload)["due_date"] == "2026-10-20"
    [task] = tasks
    assert task.due_date.isoformat() == "2026-10-20"
    original, merged_attempt = items
    assert original.task_id == task.task_id
    # 합치려던 항목은 새 review 카드가 되고 task 와 이어지지 않는다
    assert merged_attempt.action == "create"
    assert merged_attempt.gate == "review"
    assert merged_attempt.task_id is None
    assert merged_attempt.approval_id != card_id
    assert by_id[merged_attempt.approval_id].status == "pending"
    assert len(cards) == 2


def test_two_extractions_merging_same_cards_in_opposite_order_do_not_deadlock(pg, seed):
    engine, factory = pg
    card_x, card_y = _make_cards(factory, seed, ["카드 X", "카드 Y"])
    both_inside = threading.Barrier(2, timeout=0.5)

    # 둘 다 합치기 요청이 카드 잠금 쿼리를 보낸 시점에 겹치게 한다. 한쪽이 잠금을 잡은 채 잠깐 멈추면 다른 쪽은
    # 같은 쿼리에서 기다릴 뿐이다. 카드를 항목 순서대로 하나씩 잠그면 서로를 기다려 데드락이 난다
    def after(conn, cursor, statement, params, context, executemany):
        if _locks_cards(statement):
            time.sleep(SETTLE)

    def before(conn, cursor, statement, params, context, executemany):
        if _locks_cards(statement):
            try:
                both_inside.wait()
            except threading.BrokenBarrierError:
                pass

    def merge(meeting_index, first, second):
        return _post_extraction(_client(), seed, meeting_index, [
            _merge_item(first, due_date="2026-10-25"),
            _merge_item(second, due_date="2026-10-26"),
        ]).status_code

    results: dict = {}
    event.listen(engine, "before_cursor_execute", before)
    event.listen(engine, "after_cursor_execute", after)
    try:
        _run(
            results,
            xy=lambda: merge(1, card_x, card_y),
            yx=lambda: merge(2, card_y, card_x),
        )
    finally:
        both_inside.abort()
        event.remove(engine, "before_cursor_execute", before)
        event.remove(engine, "after_cursor_execute", after)

    assert results == {"xy": 201, "yx": 201}
    cards, _, _ = _db_state(factory)
    assert len(cards) == 2
    # 한쪽 갱신이 다른 쪽에 덮이지 않았다: 카드마다 두 요청의 항목이 모두 들어 있다
    for card in cards:
        assert len(json.loads(card.payload)["merged_items"]) == 2
