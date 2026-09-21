import httpx
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.core.errors import AppError, ErrorCode
from app.models import Integration, Member, Task, Workspace
from app.services import notion


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    try:
        yield session
    finally:
        session.close()


def _make_task(db, *, with_integration: bool) -> Task:
    workspace = Workspace(name="워크스페이스")
    db.add(workspace)
    db.flush()

    if with_integration:
        db.add(
            Integration(
                workspace_id=workspace.workspace_id,
                provider="notion",
                access_token="secret_token",
                provider_channel_id="db_123",
            )
        )

    member = Member(workspace_id=workspace.workspace_id, display_name="김서연", notion_name="Seoyeon")
    db.add(member)
    db.flush()

    task = Task(
        workspace_id=workspace.workspace_id,
        title="설계 문서 작성",
        assignee_member_id=member.member_id,
        status="todo",
        progress=30,
    )
    db.add(task)
    db.flush()
    return task


def test_upsert_task_noop_without_integration(db):
    task = _make_task(db, with_integration=False)

    result = notion.upsert_task(db, task)

    assert result.notion_page_id is None


def test_upsert_task_creates_page_when_no_notion_page_id(db):
    task = _make_task(db, with_integration=True)

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "POST"
        assert request.url.path == "/v1/pages"
        return httpx.Response(200, json={"id": "notion-page-1"})

    notion.upsert_task(db, task, transport=httpx.MockTransport(handler))

    assert task.notion_page_id == "notion-page-1"


def test_upsert_task_updates_existing_page(db):
    task = _make_task(db, with_integration=True)
    task.notion_page_id = "notion-page-1"

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "PATCH"
        assert request.url.path == "/v1/pages/notion-page-1"
        return httpx.Response(200, json={"id": "notion-page-1"})

    notion.upsert_task(db, task, transport=httpx.MockTransport(handler))

    assert task.notion_page_id == "notion-page-1"


def test_upsert_task_raises_notion_write_failed_on_api_error(db):
    task = _make_task(db, with_integration=True)

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(400, json={"message": "invalid"})

    with pytest.raises(AppError) as exc_info:
        notion.upsert_task(db, task, transport=httpx.MockTransport(handler))

    assert exc_info.value.code == ErrorCode.NOTION_WRITE_FAILED
    assert task.notion_page_id is None
