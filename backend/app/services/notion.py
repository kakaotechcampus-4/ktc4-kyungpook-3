"""워크스페이스에 연결된 Notion 데이터베이스에 Task 페이지를 만들고 고치는 저수준 호출.

이 모듈은 Notion API를 한 번 호출하고 그 결과만 돌려준다. 언제 호출할지, 실패하면
다시 시도할지는 `services/notion_sync.py`(outbox 워커)가 정한다 — Notion 호출은
로컬 DB 트랜잭션과 같이 롤백할 수 없어서 요청 처리 흐름에서 분리했다.

실패는 `NotionWriteError`로 올리며 두 가지를 같이 알려준다.
- `retryable`: 다시 보내면 성공할 여지가 있는가 (429·5xx·네트워크 오류)
- `outcome_uncertain`: 요청이 Notion에 도달해 처리됐을 수도 있는가 (응답 대기 중 타임아웃,
  5xx 등). 페이지 생성(POST)에서 이 값이 참이면 페이지가 이미 만들어졌을 수 있으므로
  POST를 그대로 반복하면 안 되고, `find_page_by_task_id()`로 먼저 확인해야 한다.

OAuth 연결 플로우(§4.3 `/integrations/{provider}/start`·`/callback`)는 이 모듈의
범위가 아니다. 로컬 개발 중에는 `Integration` 행을 직접 넣어서 테스트한다:
`Integration(workspace_id=..., provider="notion", access_token="secret_...", provider_channel_id="<database_id>")`.
"""
import httpx
from sqlalchemy.orm import Session

from app.models import Integration, Member, Task, TaskStatus

NOTION_API_BASE = "https://api.notion.com/v1"
NOTION_VERSION = "2022-06-28"

# 실제 Notion 데이터베이스의 속성 이름에 맞춰 조정한다.
PROPERTY_NAMES = {
    "title": "Name",
    "status": "Status",
    "assignee": "Assignee",
    "due_date": "Due Date",
    "progress": "Progress",
    "blocker": "Blocker",
    # 페이지와 Task를 잇는 키. 생성 결과가 불명확할 때 이 값으로 기존 페이지를 찾는다.
    "task_id": "Task ID",
}

# 대상 데이터베이스에 있어야 하는 속성과 그 종류. `build_properties`가 보내는 값의 종류와 같아야 한다.
DATABASE_SCHEMA = {
    PROPERTY_NAMES["title"]: "title",
    PROPERTY_NAMES["status"]: "select",
    PROPERTY_NAMES["assignee"]: "rich_text",
    PROPERTY_NAMES["due_date"]: "date",
    PROPERTY_NAMES["progress"]: "number",
    PROPERTY_NAMES["blocker"]: "rich_text",
    PROPERTY_NAMES["task_id"]: "rich_text",
}


class NotionWriteError(Exception):
    def __init__(
        self,
        reason: str,
        *,
        retryable: bool,
        outcome_uncertain: bool = False,
        status_code: int | None = None,
        retry_after: float | None = None,
    ) -> None:
        super().__init__(reason)
        self.reason = reason
        self.retryable = retryable
        self.outcome_uncertain = outcome_uncertain
        self.status_code = status_code
        self.retry_after = retry_after


class TemplateNotReady(Exception):
    """템플릿 복제가 아직 끝나지 않았다. 잠시 뒤 다시 보면 된다."""


def get_notion_integration(db: Session, workspace_id: str) -> Integration | None:
    return (
        db.query(Integration)
        .filter(Integration.workspace_id == workspace_id, Integration.provider == "notion")
        .first()
    )


def is_configured(integration: Integration | None) -> bool:
    """토큰과 대상 데이터베이스 ID가 모두 있어야 반영할 수 있다."""
    return (
        integration is not None
        and bool(integration.access_token)
        and bool(integration.provider_channel_id)
    )


def _assignee_name(db: Session, task: Task) -> str | None:
    if task.assignee_member_id is None:
        return None
    member = db.get(Member, task.assignee_member_id)
    if member is None:
        return None
    return member.notion_name or member.display_name


def build_properties(db: Session, task: Task) -> dict[str, object]:
    assignee_name = _assignee_name(db, task)
    properties: dict[str, object] = {
        PROPERTY_NAMES["title"]: {"title": [{"text": {"content": task.title}}]},
        PROPERTY_NAMES["status"]: {"select": {"name": task.status}},
        PROPERTY_NAMES["task_id"]: {"rich_text": [{"text": {"content": task.task_id}}]},
    }
    properties[PROPERTY_NAMES["assignee"]] = {
        "rich_text": [{"text": {"content": assignee_name}}] if assignee_name else []
    }
    properties[PROPERTY_NAMES["due_date"]] = {
        "date": {"start": task.due_date.isoformat()} if task.due_date else None
    }
    properties[PROPERTY_NAMES["progress"]] = {"number": task.progress}
    properties[PROPERTY_NAMES["blocker"]] = {
        "rich_text": [{"text": {"content": task.blocker}}] if task.blocker else []
    }
    return properties


def _client(access_token: str, transport: httpx.BaseTransport | None = None) -> httpx.Client:
    return httpx.Client(
        base_url=NOTION_API_BASE,
        headers={
            "Authorization": f"Bearer {access_token}",
            "Notion-Version": NOTION_VERSION,
            "Content-Type": "application/json",
        },
        timeout=10.0,
        transport=transport,
    )


def _retry_after(response: httpx.Response) -> float | None:
    try:
        return float(response.headers["Retry-After"])
    except (KeyError, ValueError):
        return None


def _send(
    integration: Integration,
    method: str,
    path: str,
    body: dict[str, object],
    transport: httpx.BaseTransport | None,
) -> dict:
    return _request(integration.access_token, method, path, transport, json=body)


def _request(
    access_token: str,
    method: str,
    path: str,
    transport: httpx.BaseTransport | None,
    *,
    json: dict[str, object] | None = None,
    params: dict[str, object] | None = None,
) -> dict:
    """토큰 문자열만으로 부른다. 연결을 저장하기 전(OAuth 직후)에도 쓸 수 있다."""
    try:
        with _client(access_token, transport=transport) as client:
            response = client.request(method, path, json=json, params=params)
            response.raise_for_status()
            return response.json()
    except httpx.HTTPStatusError as exc:
        status = exc.response.status_code
        # Notion이 실제로 왜 거부했는지는 응답 바디의 message에 있다 (예: "Make sure
        # the relevant pages and databases are shared with your integration").
        # str(exc)만 남기면 상태 코드만 보이고 원인은 매번 API를 다시 호출해봐야 한다.
        try:
            reason = exc.response.json().get("message", str(exc))
        except ValueError:
            reason = str(exc)
        raise NotionWriteError(
            reason,
            # 429(rate limit)·409(동시 수정 충돌)·5xx만 다시 보낼 가치가 있다.
            # 400(속성 불일치)·401/403(권한)·404(공유 해제)는 몇 번을 보내도 같다.
            retryable=status in (409, 429) or status >= 500,
            # 5xx는 Notion 내부에서 처리가 끝났는데 응답만 실패했을 수도 있다.
            outcome_uncertain=status >= 500,
            status_code=status,
            retry_after=_retry_after(exc.response),
        ) from exc
    except (httpx.ConnectError, httpx.ConnectTimeout, httpx.PoolTimeout) as exc:
        # 연결 자체가 안 됐으므로 요청은 Notion에 도달하지 않았다.
        raise NotionWriteError(str(exc) or type(exc).__name__, retryable=True) from exc
    except httpx.HTTPError as exc:
        # 응답 대기 중 타임아웃·연결 끊김 — 요청은 이미 보냈을 수 있다.
        raise NotionWriteError(
            str(exc) or type(exc).__name__, retryable=True, outcome_uncertain=True
        ) from exc


def create_page(
    db: Session,
    integration: Integration,
    task: Task,
    *,
    transport: httpx.BaseTransport | None = None,
) -> str:
    """Task를 새 Notion 페이지로 만들고 페이지 ID를 돌려준다."""
    data = _send(
        integration,
        "POST",
        "/pages",
        {
            "parent": {"database_id": integration.provider_channel_id},
            "properties": build_properties(db, task),
        },
        transport,
    )
    return data["id"]


def update_page(
    db: Session,
    integration: Integration,
    task: Task,
    page_id: str,
    *,
    transport: httpx.BaseTransport | None = None,
) -> None:
    """기존 페이지를 Task의 현재 값 전체로 덮어쓴다. 같은 값으로 여러 번 보내도 결과가 같다."""
    _send(
        integration,
        "PATCH",
        f"/pages/{page_id}",
        {"properties": build_properties(db, task)},
        transport,
    )


def find_page_by_task_id(
    integration: Integration,
    task_id: str,
    *,
    transport: httpx.BaseTransport | None = None,
) -> str | None:
    """`Task ID` 속성으로 이미 만들어진 페이지를 찾는다. 없으면 None."""
    data = _send(
        integration,
        "POST",
        f"/databases/{integration.provider_channel_id}/query",
        {
            "filter": {
                "property": PROPERTY_NAMES["task_id"],
                "rich_text": {"equals": task_id},
            },
            "page_size": 1,
        },
        transport,
    )
    results = data.get("results") or []
    return results[0]["id"] if results else None


def find_template_database(
    access_token: str,
    page_id: str,
    *,
    transport: httpx.BaseTransport | None = None,
) -> str | None:
    """템플릿을 복제한 페이지 바로 아래의 데이터베이스 ID. 템플릿에 DB가 없으면 None.

    복제는 Notion 안에서 십몇 초 걸린다. 그동안은 페이지 안을 읽을 수 없거나(400
    `copy_indicator`), DB 자리가 아직 `unsupported` 블록으로 보인다. 이때는 `TemplateNotReady`를 던진다.
    """
    saw_unsupported = False
    params: dict[str, object] = {"page_size": 100}
    while True:
        try:
            data = _request(access_token, "GET", f"/blocks/{page_id}/children", transport, params=params)
        except NotionWriteError as exc:
            if exc.status_code == 400 and "copy_indicator" in exc.reason:
                raise TemplateNotReady(exc.reason) from exc
            raise
        for block in data.get("results") or []:
            if block.get("type") == "child_database":
                return block["id"]
            if block.get("type") == "unsupported":
                saw_unsupported = True
        if not data.get("has_more") or not data.get("next_cursor"):
            break
        params = {"page_size": 100, "start_cursor": data["next_cursor"]}

    if saw_unsupported:
        raise TemplateNotReady("템플릿 복제가 아직 끝나지 않았습니다")
    return None


def verify_database_schema(
    access_token: str,
    database_id: str,
    *,
    transport: httpx.BaseTransport | None = None,
) -> list[str]:
    """데이터베이스가 워커가 쓰는 속성을 갖췄는지 본다. 어긋난 점의 목록이고, 비어 있으면 통과다.

    속성이나 선택지가 더 있는 것은 괜찮다. 템플릿을 자유롭게 꾸밀 수 있게 하기 위해서다.
    """
    try:
        data = _request(access_token, "GET", f"/databases/{database_id}", transport)
    except NotionWriteError as exc:
        if exc.status_code in (403, 404):
            return ["접근할 수 없음"]
        raise

    properties = data.get("properties") or {}
    problems = []
    for name, expected in DATABASE_SCHEMA.items():
        prop = properties.get(name)
        if prop is None:
            problems.append(f"'{name}' 속성이 없음")
        elif prop.get("type") != expected:
            problems.append(f"'{name}' 속성 종류가 {prop.get('type')}임 (필요: {expected})")

    # 워커는 Task 상태 값을 그대로 선택지 이름으로 보낸다.
    status = properties.get(PROPERTY_NAMES["status"]) or {}
    if status.get("type") == "select":
        options = {option.get("name") for option in (status.get("select") or {}).get("options") or []}
        missing = [str(value) for value in TaskStatus if str(value) not in options]
        if missing:
            problems.append(f"'{PROPERTY_NAMES['status']}' 선택지가 없음: {', '.join(missing)}")
    return problems
