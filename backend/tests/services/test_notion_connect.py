import logging

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base
from app.models import Integration, NotionSyncJob, Task, Workspace
from app.services import notion, notion_sync
from app.services.notion_connect import AttachResult, attach_template_database

TOKEN = "secret_new"
PAGE_ID = "copied-page"


@pytest.fixture
def session_factory():
    engine = create_engine(
        "sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)


@pytest.fixture
def workspace_id(session_factory):
    with session_factory() as db:
        workspace = Workspace(name="워크스페이스")
        db.add(workspace)
        db.flush()
        db.add(Integration(workspace_id=workspace.workspace_id, provider="notion", access_token=TOKEN))
        db.commit()
        return workspace.workspace_id


class FakeClock:
    """sleep을 부르면 시간이 그만큼 흐른다. 테스트가 실제로 기다리지 않게 한다."""

    def __init__(self):
        self.now = 0.0
        self.sleeps: list[float] = []

    def __call__(self) -> float:
        return self.now

    def sleep(self, seconds: float) -> None:
        self.sleeps.append(seconds)
        self.now += seconds


def _script(monkeypatch, *, find=(), verify=()):
    """찾기·확인 함수가 차례로 돌려줄 값(예외면 던짐). 마지막 값은 계속 되풀이한다."""
    calls = {"find": 0, "verify": 0}

    def fake(name, outcomes):
        def call(access_token, target_id, *, transport=None):
            assert access_token == TOKEN
            index = min(calls[name], len(outcomes) - 1)
            calls[name] += 1
            outcome = outcomes[index]
            if isinstance(outcome, Exception):
                raise outcome
            return outcome

        return call

    monkeypatch.setattr(notion, "find_template_database", fake("find", list(find)))
    monkeypatch.setattr(notion, "verify_database_schema", fake("verify", list(verify) or [[]]))
    return calls


def _attach(workspace_id, session_factory, clock, **kwargs):
    return attach_template_database(
        workspace_id, kwargs.pop("token", TOKEN), PAGE_ID,
        sleep=clock.sleep, clock=clock, session_factory=session_factory, **kwargs,
    )


def _row(session_factory, workspace_id) -> Integration | None:
    with session_factory() as db:
        return notion.get_notion_integration(db, workspace_id)


def _assert_token_cleared(session_factory, workspace_id) -> None:
    """실패하면 행은 남기고 토큰만 비운다. 연동 조회가 이 행을 끊김(revoked)으로 내려준다."""
    row = _row(session_factory, workspace_id)
    assert row is not None
    assert (row.access_token, row.refresh_token, row.provider_channel_id) == (None, None, None)


def _not_ready():
    return notion.TemplateNotReady("복제 중")


def _notion_error(status: int, retryable: bool):
    return notion.NotionWriteError("오류", retryable=retryable, status_code=status)


def test_waits_while_copying_then_saves_database(monkeypatch, session_factory, workspace_id):
    calls = _script(monkeypatch, find=[_not_ready(), _not_ready(), "db-1"])
    clock = FakeClock()

    result = _attach(workspace_id, session_factory, clock)

    assert result is AttachResult.ATTACHED
    assert _row(session_factory, workspace_id).provider_channel_id == "db-1"
    assert clock.sleeps == [2, 2]
    assert calls == {"find": 3, "verify": 1}


def test_gives_up_after_timeout_and_clears_token(monkeypatch, session_factory, workspace_id):
    _script(monkeypatch, find=[_not_ready()])
    clock = FakeClock()

    result = _attach(workspace_id, session_factory, clock)

    assert result is AttachResult.TEMPLATE_NOT_READY
    _assert_token_cleared(session_factory, workspace_id)
    assert clock.now <= 60
    assert len(clock.sleeps) == 30


def test_template_without_database_clears_token(monkeypatch, session_factory, workspace_id):
    _script(monkeypatch, find=[None])
    clock = FakeClock()

    assert _attach(workspace_id, session_factory, clock) is AttachResult.DATABASE_NOT_FOUND
    _assert_token_cleared(session_factory, workspace_id)
    assert clock.sleeps == []


def test_schema_mismatch_clears_token(monkeypatch, session_factory, workspace_id):
    _script(monkeypatch, find=["db-1"], verify=[["'Task ID' 속성이 없음"]])

    assert _attach(workspace_id, session_factory, FakeClock()) is AttachResult.SCHEMA_MISMATCH
    _assert_token_cleared(session_factory, workspace_id)


def test_retries_temporary_notion_errors(monkeypatch, session_factory, workspace_id):
    _script(
        monkeypatch,
        find=[_notion_error(502, retryable=True), "db-1"],
        verify=[_notion_error(429, retryable=True), []],
    )
    clock = FakeClock()

    assert _attach(workspace_id, session_factory, clock) is AttachResult.ATTACHED
    assert _row(session_factory, workspace_id).provider_channel_id == "db-1"
    assert clock.sleeps == [2, 2]


def test_temporary_errors_until_timeout_are_reported_as_notion_error(monkeypatch, session_factory, workspace_id):
    _script(monkeypatch, find=[_notion_error(503, retryable=True)])

    assert _attach(workspace_id, session_factory, FakeClock()) is AttachResult.NOTION_ERROR
    _assert_token_cleared(session_factory, workspace_id)


def test_permanent_notion_error_clears_token(monkeypatch, session_factory, workspace_id):
    _script(monkeypatch, find=[_notion_error(403, retryable=False)])
    clock = FakeClock()

    assert _attach(workspace_id, session_factory, clock) is AttachResult.NOTION_ERROR
    _assert_token_cleared(session_factory, workspace_id)
    assert clock.sleeps == []


def test_unexpected_error_clears_token(monkeypatch, session_factory, workspace_id, caplog):
    # 예: Notion이 200에 JSON이 아닌 본문을 줬다. 멈추지 않고 반쪽 연결의 토큰을 비운다.
    _script(monkeypatch, find=[ValueError("JSON이 아님")])
    clock = FakeClock()

    assert _attach(workspace_id, session_factory, clock) is AttachResult.NOTION_ERROR
    _assert_token_cleared(session_factory, workspace_id)
    assert clock.sleeps == []
    assert any(r.levelname == "ERROR" and r.exc_info for r in caplog.records)


def test_leaves_newer_connection_alone(monkeypatch, session_factory, workspace_id):
    # 기다리는 사이 PM이 다시 연결해서 토큰이 바뀌었다
    with session_factory() as db:
        notion.get_notion_integration(db, workspace_id).access_token = "secret_newer"
        db.commit()

    for find in (["db-1"], [None]):
        _script(monkeypatch, find=find)
        assert _attach(workspace_id, session_factory, FakeClock()) is AttachResult.SUPERSEDED

        row = _row(session_factory, workspace_id)
        assert row.access_token == "secret_newer"
        assert row.provider_channel_id is None


def test_connection_removed_meanwhile_is_left_alone(monkeypatch, session_factory, workspace_id):
    with session_factory() as db:
        db.delete(notion.get_notion_integration(db, workspace_id))
        db.commit()
    _script(monkeypatch, find=["db-1"])

    assert _attach(workspace_id, session_factory, FakeClock()) is AttachResult.SUPERSEDED
    assert _row(session_factory, workspace_id) is None


def test_success_is_logged_as_info(monkeypatch, session_factory, workspace_id, caplog):
    _script(monkeypatch, find=["db-1"])
    caplog.set_level(logging.INFO, logger="app.services.notion_connect")

    _attach(workspace_id, session_factory, FakeClock())

    assert [(r.levelno, r.getMessage()) for r in caplog.records] == [
        (logging.INFO, f"Notion 대상 DB 연결 workspace_id={workspace_id} result=attached")
    ]


def test_failure_is_logged_as_warning_with_reason(monkeypatch, session_factory, workspace_id, caplog):
    # 화면에는 끊김으로만 보이므로 이유가 기본 로그 설정(경고 이상)에서도 보여야 한다
    _script(monkeypatch, find=[None])
    caplog.set_level(logging.INFO, logger="app.services.notion_connect")

    _attach(workspace_id, session_factory, FakeClock())

    assert [(r.levelno, r.getMessage()) for r in caplog.records] == [
        (logging.WARNING, f"Notion 대상 DB 연결 실패 workspace_id={workspace_id} result=database_not_found")
    ]


def test_failure_does_not_touch_connection_that_already_has_database(monkeypatch, session_factory, workspace_id):
    with session_factory() as db:
        notion.get_notion_integration(db, workspace_id).provider_channel_id = "db-existing"
        db.commit()
    _script(monkeypatch, find=[None])

    # 이미 DB가 채워졌으면 이 작업이 맡을 연결이 아니다
    assert _attach(workspace_id, session_factory, FakeClock()) is AttachResult.SUPERSEDED
    row = _row(session_factory, workspace_id)
    assert (row.access_token, row.provider_channel_id) == (TOKEN, "db-existing")


def test_attaching_database_asks_every_task_of_the_workspace_to_be_checked(monkeypatch, session_factory, workspace_id):
    with session_factory() as db:
        other = Workspace(name="다른 워크스페이스")
        db.add(other)
        db.flush()
        for owner in (workspace_id, workspace_id, other.workspace_id):
            db.add(Task(workspace_id=owner, title="할 일"))
        db.commit()
    _script(monkeypatch, find=["db-1"])

    assert _attach(workspace_id, session_factory, FakeClock()) is AttachResult.ATTACHED

    with session_factory() as db:
        rows = db.execute(
            select(Task.workspace_id, Task.notion_sync_status, NotionSyncJob.status)
            .join(NotionSyncJob, NotionSyncJob.task_id == Task.task_id)
        ).all()
    # 이 워크스페이스의 Task에만 확인 요청을 쌓고 반영 대기로 보이게 한다
    assert sorted(rows) == [(workspace_id, "pending", "pending")] * 2


def test_database_is_not_saved_if_asking_tasks_to_be_checked_fails(monkeypatch, session_factory, workspace_id):
    _script(monkeypatch, find=["db-1"])

    def broken(db, workspace_id):
        raise RuntimeError("DB 오류")

    monkeypatch.setattr(notion_sync, "enqueue_workspace_sync", broken)

    with pytest.raises(RuntimeError):
        _attach(workspace_id, session_factory, FakeClock())

    # DB ID도 함께 되돌려져 "DB 없음"으로 남는다. 연동 조회가 2분 뒤 끊김(revoked)으로 알린다
    row = _row(session_factory, workspace_id)
    assert (row.access_token, row.provider_channel_id) == (TOKEN, None)
