import httpx
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
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


def _make_task(db) -> tuple[Integration, Task]:
    workspace = Workspace(name="워크스페이스")
    db.add(workspace)
    db.flush()

    integration = Integration(
        workspace_id=workspace.workspace_id,
        provider="notion",
        access_token="secret_token",
        provider_channel_id="db_123",
    )
    db.add(integration)

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
    return integration, task


def test_is_configured_requires_token_and_database_id():
    assert not notion.is_configured(None)
    assert not notion.is_configured(Integration(provider="notion", access_token="t"))
    assert notion.is_configured(
        Integration(provider="notion", access_token="t", provider_channel_id="db")
    )


def test_create_page_posts_to_database_with_task_id_property(db):
    integration, task = _make_task(db)

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "POST"
        assert request.url.path == "/v1/pages"
        body = request.read().decode()
        assert task.task_id in body  # Task ID 속성으로 나중에 페이지를 다시 찾을 수 있어야 한다
        return httpx.Response(200, json={"id": "notion-page-1"})

    page_id = notion.create_page(db, integration, task, transport=httpx.MockTransport(handler))

    assert page_id == "notion-page-1"


def test_update_page_patches_existing_page(db):
    integration, task = _make_task(db)

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "PATCH"
        assert request.url.path == "/v1/pages/notion-page-1"
        return httpx.Response(200, json={"id": "notion-page-1"})

    notion.update_page(
        db, integration, task, "notion-page-1", transport=httpx.MockTransport(handler)
    )


def test_find_page_by_task_id_queries_database(db):
    integration, task = _make_task(db)

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/databases/db_123/query"
        return httpx.Response(200, json={"results": [{"id": "notion-page-1"}]})

    assert (
        notion.find_page_by_task_id(
            integration, task.task_id, transport=httpx.MockTransport(handler)
        )
        == "notion-page-1"
    )


@pytest.mark.parametrize(
    ("status", "retryable", "uncertain"),
    [
        (400, False, False),  # 속성 불일치 — 다시 보내도 같다
        (404, False, False),  # 공유 해제
        (429, True, False),   # rate limit — 처리되지 않았다
        (502, True, True),    # 처리됐는지 알 수 없다
    ],
)
def test_http_error_is_classified(db, status, retryable, uncertain):
    integration, task = _make_task(db)

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(status, json={"message": "invalid"})

    with pytest.raises(notion.NotionWriteError) as exc_info:
        notion.create_page(db, integration, task, transport=httpx.MockTransport(handler))

    assert exc_info.value.reason == "invalid"
    assert exc_info.value.status_code == status
    assert exc_info.value.retryable is retryable
    assert exc_info.value.outcome_uncertain is uncertain


def test_build_properties_sends_explicit_clear_values_when_fields_are_emptied(db):
    integration, task = _make_task(db)

    properties = notion.build_properties(db, task)
    assert properties[notion.PROPERTY_NAMES["assignee"]] == {
        "rich_text": [{"text": {"content": "Seoyeon"}}]
    }
    assert properties[notion.PROPERTY_NAMES["progress"]] == {"number": 30}

    task.assignee_member_id = None
    task.due_date = None
    task.progress = None
    task.blocker = None

    cleared = notion.build_properties(db, task)
    assert cleared[notion.PROPERTY_NAMES["assignee"]] == {"rich_text": []}
    assert cleared[notion.PROPERTY_NAMES["due_date"]] == {"date": None}
    assert cleared[notion.PROPERTY_NAMES["progress"]] == {"number": None}
    assert cleared[notion.PROPERTY_NAMES["blocker"]] == {"rich_text": []}


def test_read_timeout_is_uncertain_but_connect_error_is_not(db):
    integration, task = _make_task(db)

    def read_timeout(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("timed out", request=request)

    def connect_error(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused", request=request)

    with pytest.raises(notion.NotionWriteError) as exc_info:
        notion.create_page(db, integration, task, transport=httpx.MockTransport(read_timeout))
    assert exc_info.value.retryable and exc_info.value.outcome_uncertain

    with pytest.raises(notion.NotionWriteError) as exc_info:
        notion.create_page(db, integration, task, transport=httpx.MockTransport(connect_error))
    assert exc_info.value.retryable and not exc_info.value.outcome_uncertain
