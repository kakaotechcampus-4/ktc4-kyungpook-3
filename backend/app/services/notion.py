"""Task를 워크스페이스에 연결된 Notion 데이터베이스에 Upsert한다.

`Integration(provider="notion")`이 없거나 `access_token`/`provider_channel_id`
(대상 데이터베이스 ID)가 비어 있으면 아무 일도 하지 않는다 — Notion 연동은
선택 사항이라 미연결 워크스페이스의 Task CRUD를 막으면 안 된다. 연동은 돼
있는데 API 호출 자체가 실패하면 `NOTION_WRITE_FAILED`를 올려 호출부(주로
`services/tasks.py`)가 같은 트랜잭션의 로컬 변경도 함께 롤백하게 한다 —
Notion과 로컬 DB가 어긋난 채로 `notion_page_id`만 안 채워지는 상태를 막기 위해서다.

OAuth 연결 플로우(§4.3 `/integrations/{provider}/start`·`/callback`)는 이 모듈의
범위가 아니다. 로컬 개발 중에는 `Integration` 행을 직접 넣어서 테스트한다:
`Integration(workspace_id=..., provider="notion", access_token="secret_...", provider_channel_id="<database_id>")`.
"""
import httpx
from sqlalchemy.orm import Session

from app.core.errors import AppError, ErrorCode
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
}


def get_notion_integration(db: Session, workspace_id: str) -> Integration | None:
    return (
        db.query(Integration)
        .filter(Integration.workspace_id == workspace_id, Integration.provider == "notion")
        .first()
    )


def _assignee_name(db: Session, task: Task) -> str | None:
    if task.assignee_member_id is None:
        return None
    member = db.get(Member, task.assignee_member_id)
    if member is None:
        return None
    return member.notion_name or member.display_name


def _build_properties(task: Task, assignee_name: str | None) -> dict[str, object]:
    properties: dict[str, object] = {
        PROPERTY_NAMES["title"]: {"title": [{"text": {"content": task.title}}]},
        PROPERTY_NAMES["status"]: {"select": {"name": task.status}},
    }
    if assignee_name:
        properties[PROPERTY_NAMES["assignee"]] = {
            "rich_text": [{"text": {"content": assignee_name}}]
        }
    if task.due_date:
        properties[PROPERTY_NAMES["due_date"]] = {"date": {"start": task.due_date.isoformat()}}
    if task.progress is not None:
        properties[PROPERTY_NAMES["progress"]] = {"number": task.progress}
    if task.blocker:
        properties[PROPERTY_NAMES["blocker"]] = {
            "rich_text": [{"text": {"content": task.blocker}}]
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


def upsert_task(
    db: Session,
    task: Task,
    *,
    transport: httpx.BaseTransport | None = None,
) -> Task:
    """Task를 Notion 페이지로 생성/갱신하고 `task.notion_page_id`를 채운다.

    Notion 연동이 안 돼 있으면 그대로 `task`를 반환한다(no-op).
    """
    integration = get_notion_integration(db, task.workspace_id)
    if integration is None or not integration.access_token or not integration.provider_channel_id:
        return task

    properties = _build_properties(task, _assignee_name(db, task))

    try:
        with _client(integration.access_token, transport=transport) as client:
            if task.notion_page_id:
                response = client.patch(
                    f"/pages/{task.notion_page_id}", json={"properties": properties}
                )
            else:
                response = client.post(
                    "/pages",
                    json={
                        "parent": {"database_id": integration.provider_channel_id},
                        "properties": properties,
                    },
                )
            response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        # Notion이 실제로 왜 거부했는지는 응답 바디의 message에 있다 (예: "Make sure
        # the relevant pages and databases are shared with your integration").
        # str(exc)만 남기면 상태 코드만 보이고 원인은 매번 API를 다시 호출해봐야 한다.
        try:
            reason = exc.response.json().get("message", str(exc))
        except ValueError:
            reason = str(exc)
        raise AppError(
            ErrorCode.NOTION_WRITE_FAILED,
            details={"task_id": task.task_id, "reason": reason},
        ) from exc
    except httpx.HTTPError as exc:
        raise AppError(
            ErrorCode.NOTION_WRITE_FAILED,
            details={"task_id": task.task_id, "reason": str(exc)},
        ) from exc

    if not task.notion_page_id:
        task.notion_page_id = response.json()["id"]
    return task
