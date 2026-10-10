from datetime import date

import httpx
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.models import Integration, Member, Task, TaskStatus, Workspace
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


# ---------- 템플릿 DB 찾기 ----------


def _transport(*responses: httpx.Response) -> tuple[list[httpx.Request], httpx.MockTransport]:
    """응답을 차례로 돌려주고, 받은 요청을 기록한다."""
    seen: list[httpx.Request] = []
    queue = list(responses)

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return queue.pop(0)

    return seen, httpx.MockTransport(handler)


def _children(*types: str, has_more: bool = False, next_cursor: str | None = None) -> httpx.Response:
    results = [{"type": kind, "id": f"{kind}-{i}"} for i, kind in enumerate(types)]
    return httpx.Response(200, json={"results": results, "has_more": has_more, "next_cursor": next_cursor})


def test_find_template_database_returns_database_right_under_page():
    seen, transport = _transport(_children("paragraph", "child_database"))

    database_id = notion.find_template_database("secret_token", "page-1", transport=transport)

    assert database_id == "child_database-1"
    request = seen[0]
    assert request.method == "GET"
    assert request.url.path == "/v1/blocks/page-1/children"
    assert request.url.params["page_size"] == "100"
    assert request.headers["Authorization"] == "Bearer secret_token"


def test_find_template_database_reads_next_page():
    seen, transport = _transport(
        _children("paragraph", has_more=True, next_cursor="cursor-2"),
        _children("child_database"),
    )

    assert notion.find_template_database("t", "page-1", transport=transport) == "child_database-0"
    assert seen[1].url.params["start_cursor"] == "cursor-2"


def test_find_template_database_waits_while_page_is_being_copied():
    # 복제 직후 실제로 받은 응답
    _, transport = _transport(
        httpx.Response(
            400,
            json={"code": "validation_error", "message": "Block type copy_indicator is not supported via the API."},
        )
    )

    with pytest.raises(notion.TemplateNotReady):
        notion.find_template_database("t", "page-1", transport=transport)


def test_find_template_database_waits_while_database_is_unsupported_placeholder():
    # 복제 2~7초쯤: 조회는 되지만 DB 자리가 아직 unsupported 블록이다
    _, transport = _transport(_children("unsupported"))

    with pytest.raises(notion.TemplateNotReady):
        notion.find_template_database("t", "page-1", transport=transport)


def test_find_template_database_returns_none_when_template_has_no_database():
    _, transport = _transport(_children("paragraph", "heading_1"))

    assert notion.find_template_database("t", "page-1", transport=transport) is None


@pytest.mark.parametrize(("status", "retryable"), [(400, False), (403, False), (500, True)])
def test_find_template_database_other_errors_keep_retry_classification(status, retryable):
    _, transport = _transport(httpx.Response(status, json={"message": "nope"}))

    with pytest.raises(notion.NotionWriteError) as exc_info:
        notion.find_template_database("t", "page-1", transport=transport)

    assert exc_info.value.retryable is retryable


# ---------- 템플릿 DB 확인 ----------


def _schema(**changes) -> dict:
    """워커가 쓰는 속성을 모두 갖춘 DB 응답. changes로 속성을 바꾸거나(None이면 뺀다) 더한다."""
    properties: dict[str, dict] = {name: {"type": kind} for name, kind in notion.DATABASE_SCHEMA.items()}
    properties["Status"]["select"] = {"options": [{"name": str(s)} for s in TaskStatus]}
    for name, value in changes.items():
        name = name.replace("_", " ")
        if value is None:
            properties.pop(name, None)
        else:
            properties[name] = value
    return {"object": "database", "properties": properties}


def _verify(body: dict | httpx.Response) -> list[str]:
    response = body if isinstance(body, httpx.Response) else httpx.Response(200, json=body)
    seen, transport = _transport(response)
    problems = notion.verify_database_schema("t", "db-1", transport=transport)
    assert seen[0].method == "GET" and seen[0].url.path == "/v1/databases/db-1"
    return problems


def test_verify_database_schema_passes_for_matching_database():
    assert _verify(_schema()) == []


def test_verify_database_schema_reports_misspelled_property():
    body = _schema(Task_ID=None)
    body["properties"]["task id"] = {"type": "rich_text"}

    assert _verify(body) == ["'Task ID' 속성이 없음"]


def test_verify_database_schema_reports_wrong_property_type():
    assert _verify(_schema(Progress={"type": "rich_text"})) == [
        "'Progress' 속성 종류가 rich_text임 (필요: number)"
    ]


def test_verify_database_schema_reports_missing_status_options():
    status = {"type": "select", "select": {"options": [{"name": "todo"}, {"name": "진행 중"}]}}

    assert _verify(_schema(Status=status)) == ["'Status' 선택지가 없음: in_progress, blocked, done"]


def test_verify_database_schema_allows_extra_properties_and_options():
    status = {"type": "select", "select": {"options": [{"name": str(s)} for s in TaskStatus] + [{"name": "보류"}]}}

    assert _verify(_schema(Status=status, Memo={"type": "rich_text"})) == []


@pytest.mark.parametrize("status", [403, 404])
def test_verify_database_schema_reports_inaccessible_database(status):
    assert _verify(httpx.Response(status, json={"message": "no access"})) == ["접근할 수 없음"]


def test_verify_database_schema_raises_on_server_error():
    with pytest.raises(notion.NotionWriteError) as exc_info:
        _verify(httpx.Response(500, json={"message": "oops"}))

    assert exc_info.value.retryable


def test_database_schema_matches_what_the_worker_writes(db):
    # 한쪽만 고치면 깨진다. 확인하는 속성과 워커가 보내는 속성이 같아야 한다.
    _, task = _make_task(db)
    task.due_date = date(2026, 10, 5)

    written = notion.build_properties(db, task)

    assert written.keys() == notion.DATABASE_SCHEMA.keys()
    for name, value in written.items():
        assert list(value) == [notion.DATABASE_SCHEMA[name]], name
