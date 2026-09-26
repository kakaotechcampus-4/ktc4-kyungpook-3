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

from app.models import Integration, Member, Task

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
    try:
        with _client(integration.access_token, transport=transport) as client:
            response = client.request(method, path, json=body)
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
