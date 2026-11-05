"""워크스페이스 메시지·알림 설정. 행이 없으면 기본값을 돌려주고, 처음 바꿀 때 행을 만든다."""
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import Integration, Member, MemberRole, PmAlertMethod, WorkspaceMessageSettings

MAX_NUDGE_DAYS_BEFORE = 3

DEFAULTS = {
    "due_reminder": True,
    "minutes_summary": True,
    "silence_alert": True,
    "nudge_days_before": 1,
    "nudge_hour": 9,
    "pm_alert_method": PmAlertMethod.BOTH.value,
    "reminder_auto_approve": False,
}


@dataclass(frozen=True)
class MessageSettings:
    due_reminder: bool
    minutes_summary: bool
    silence_alert: bool
    nudge_days_before: int
    nudge_hour: int
    pm_alert_method: str
    reminder_auto_approve: bool
    auto_approve_since: datetime | None
    saved: bool
    updated_at: datetime | None
    updated_by: str | None


def _view(row: WorkspaceMessageSettings | None) -> MessageSettings:
    if row is None:
        return MessageSettings(**DEFAULTS, auto_approve_since=None, saved=False, updated_at=None, updated_by=None)
    return MessageSettings(
        **{k: getattr(row, k) for k in DEFAULTS},
        auto_approve_since=row.auto_approve_since, saved=True,
        updated_at=row.updated_at, updated_by=row.updated_by,
    )


def get_settings(db: Session, workspace_id: str) -> MessageSettings:
    return _view(db.get(WorkspaceMessageSettings, workspace_id))


def _apply(row: WorkspaceMessageSettings, changes: dict, updated_by: str, now: datetime) -> None:
    if "reminder_auto_approve" in changes:
        turned_on = bool(changes["reminder_auto_approve"])
        if turned_on and not row.reminder_auto_approve:
            row.auto_approve_since = now
        elif not turned_on:
            row.auto_approve_since = None
    for key, value in changes.items():
        setattr(row, key, value)
    row.updated_at = now
    row.updated_by = updated_by


def update_settings(
    db: Session, workspace_id: str, changes: dict, *, updated_by: str, now: datetime
) -> MessageSettings:
    """보낸 키만 바꾼다. commit 은 호출한 쪽이 한다."""
    # 읽은 값으로 바뀐 칸을 가르므로, 동시에 바꾸는 PM 요청이 서로의 값을 덮어쓰지 않게 잠가서 읽는다.
    row = db.get(WorkspaceMessageSettings, workspace_id, with_for_update=True)
    if row is None:
        row = WorkspaceMessageSettings(workspace_id=workspace_id, **DEFAULTS)
        try:
            with db.begin_nested():
                db.add(row)
                db.flush()
        except IntegrityError:
            # 다른 요청이 먼저 첫 행을 만들었다. 그 행을 읽어 이어서 적용한다.
            # SAVEPOINT 롤백이 새 객체를 이미 세션에서 뗐다.
            row = db.execute(
                select(WorkspaceMessageSettings)
                .where(WorkspaceMessageSettings.workspace_id == workspace_id)
                .with_for_update()
            ).scalar_one()
    _apply(row, changes, updated_by, now)
    db.flush()
    return _view(row)


def pm_contacts(db: Session, workspace_id: str) -> list[dict]:
    """탈퇴하지 않은 PM. discord_linked 는 워크스페이스 디스코드 연동과 그 PM 의 디스코드 계정이 모두 있을 때다."""
    connected = db.execute(
        select(Integration.integration_id).where(
            Integration.workspace_id == workspace_id, Integration.provider == "discord"
        )
    ).first() is not None
    pms = db.execute(
        select(Member)
        .where(Member.workspace_id == workspace_id, Member.role == MemberRole.PM, Member.is_deleted.is_(False))
        .order_by(Member.created_at, Member.member_id)
    ).scalars().all()
    return [
        {"member_id": m.member_id, "name": m.display_name, "discord_linked": connected and bool(m.discord_user_id)}
        for m in pms
    ]
