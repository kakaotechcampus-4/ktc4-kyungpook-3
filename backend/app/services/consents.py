"""이용약관·개인정보처리방침 동의 기록(#564).

문서의 지금 버전은 CURRENT_VERSIONS 한곳에 둔다. 문서 내용을 바꾸면 FE 문서 화면의 버전과 이 값을 같이 올린다.
올리면 모든 사용자가 다시 동의해야 하는 상태(required)가 된다.
"""
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session

from app.core.errors import AppError, ErrorCode
from app.models import UserConsent

TERMS = "terms"
PRIVACY = "privacy"
CURRENT_VERSIONS: dict[str, str] = {TERMS: "2026-11-08", PRIVACY: "2026-11-08"}


def status(db: Session, user_id: str) -> dict:
    """문서마다 지금 버전과 가장 최근에 동의한 버전. 지금 버전에 동의하지 않은 문서가 있으면 required."""
    rows = db.scalars(
        select(UserConsent).where(UserConsent.user_id == user_id).order_by(UserConsent.agreed_at)
    ).all()
    latest = {row.kind: row for row in rows}  # 시각 순이라 마지막 행이 남는다
    current = {row.kind for row in rows if row.version == CURRENT_VERSIONS.get(row.kind)}
    documents = [
        {
            "kind": kind,
            "current_version": version,
            "agreed_version": latest[kind].version if kind in latest else None,
            "agreed_at": latest[kind].agreed_at if kind in latest else None,
        }
        for kind, version in CURRENT_VERSIONS.items()
    ]
    return {"required": any(kind not in current for kind in CURRENT_VERSIONS), "documents": documents}


def agree(db: Session, user_id: str, versions: dict[str, str], now: datetime | None = None) -> None:
    """두 문서의 지금 버전에 동의한다. 하나라도 지금 버전이 아니면 아무것도 저장하지 않고 400 이다.
    이미 동의한 버전은 다시 쓰지 않는다(처음 동의한 시각이 남는다)."""
    mismatched = {k: v for k, v in versions.items() if v != CURRENT_VERSIONS[k]}
    if mismatched:
        raise AppError(
            ErrorCode.CONSENT_VERSION_MISMATCH,
            details={"current_versions": dict(CURRENT_VERSIONS), "received": versions},
        )
    now = now or datetime.now(timezone.utc)
    insert = pg_insert if db.get_bind().dialect.name == "postgresql" else sqlite_insert
    db.execute(
        insert(UserConsent)
        .values([
            {"user_id": user_id, "kind": kind, "version": version, "agreed_at": now}
            for kind, version in versions.items()
        ])
        .on_conflict_do_nothing(index_elements=["user_id", "kind", "version"])
    )
