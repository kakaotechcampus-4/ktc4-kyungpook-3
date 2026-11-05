"""비밀번호 재설정 토큰 발급·확인·변경(#356). 메일은 보내지 않고 보낼 내용을 돌려주며, commit 은 호출자가 한다."""
import hashlib
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session as DbSession

from app.core.errors import AppError, ErrorCode
from app.models import PasswordResetToken, Session as SessionModel, User
from app.services.passwords import hash_password

TOKEN_TTL = timedelta(minutes=30)
COOLDOWN = timedelta(seconds=60)
HOURLY_LIMIT = 5
RETENTION = timedelta(days=7)


@dataclass(frozen=True)
class ResetMail:
    user_id: str
    to: str
    subject: str
    text: str


def _utc(value: datetime) -> datetime:
    """시간대 없는 값(sqlite 가 돌려준 값)은 UTC 로 보고, 있는 값은 UTC 로 바꾼다."""
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def mask_email(email: str) -> str:
    local, _, domain = email.partition("@")
    keep = 2 if len(local) >= 3 else 1
    return f"{local[:keep]}***@{domain}"


def _reason(row: PasswordResetToken | None, now: datetime) -> str | None:
    if row is None or row.invalidated_at is not None:
        return "invalid"
    if row.used_at is not None:
        return "used"
    if _utc(row.expires_at) <= now:
        return "expired"
    return None


def request_reset(db: DbSession, email: str, *, now: datetime, base_url: str) -> ResetMail | None:
    user = db.scalars(select(User).where(User.email == email).with_for_update()).first()
    if user is None:
        return None
    latest = db.scalar(
        select(func.max(PasswordResetToken.created_at)).where(PasswordResetToken.user_id == user.user_id)
    )
    if latest is not None and _utc(latest) > now - COOLDOWN:
        return None
    recent = db.scalar(
        select(func.count())
        .select_from(PasswordResetToken)
        .where(PasswordResetToken.user_id == user.user_id, PasswordResetToken.created_at > now - timedelta(hours=1))
    )
    if recent >= HOURLY_LIMIT:
        return None

    db.execute(
        update(PasswordResetToken)
        .where(
            PasswordResetToken.user_id == user.user_id,
            PasswordResetToken.used_at.is_(None),
            PasswordResetToken.invalidated_at.is_(None),
        )
        .values(invalidated_at=now)
    )
    db.execute(
        delete(PasswordResetToken).where(
            PasswordResetToken.user_id == user.user_id, PasswordResetToken.created_at < now - RETENTION
        )
    )
    raw = secrets.token_urlsafe(32)
    db.add(
        PasswordResetToken(
            user_id=user.user_id, token_hash=hash_token(raw), expires_at=now + TOKEN_TTL, created_at=now
        )
    )
    db.flush()
    text = (
        "비밀번호 재설정을 요청하셨습니다. 아래 링크에서 새 비밀번호를 정해 주세요.\n\n"
        f"{base_url}/reset-password#token={raw}\n\n"
        "이 링크는 30분 동안만 쓸 수 있습니다.\n"
        "요청하지 않으셨다면 이 메일을 무시해 주세요. 비밀번호는 바뀌지 않습니다."
    )
    return ResetMail(
        user_id=user.user_id,
        to=user.email,
        subject="[Manager's Manager] 비밀번호 재설정 안내",
        text=text,
    )


def _row(db: DbSession, raw: str) -> PasswordResetToken | None:
    return db.scalars(select(PasswordResetToken).where(PasswordResetToken.token_hash == hash_token(raw))).first()


def _invalid(reason: str) -> AppError:
    return AppError(ErrorCode.PASSWORD_RESET_TOKEN_INVALID, details={"reason": reason})


def verify_token(db: DbSession, raw: str, *, now: datetime) -> tuple[datetime, str]:
    row = _row(db, raw)
    reason = _reason(row, now)
    if reason is not None:
        raise _invalid(reason)
    user = db.get(User, row.user_id)
    return _utc(row.expires_at), mask_email(user.email)


def confirm_reset(db: DbSession, raw: str, new_password: str, *, now: datetime) -> None:
    # request_reset 과 같은 순서(사용자 행 잠금 -> 토큰 행 UPDATE)로 잡아 PG 교착을 피한다.
    token_row = _row(db, raw)
    if token_row is None:
        raise _invalid("invalid")
    db.execute(select(User.user_id).where(User.user_id == token_row.user_id).with_for_update())
    result = db.execute(
        update(PasswordResetToken)
        .where(
            PasswordResetToken.token_hash == hash_token(raw),
            PasswordResetToken.used_at.is_(None),
            PasswordResetToken.invalidated_at.is_(None),
            PasswordResetToken.expires_at > now,
        )
        .values(used_at=now)
        .execution_options(synchronize_session=False)
    )
    if result.rowcount != 1:
        db.expire_all()
        raise _invalid(_reason(_row(db, raw), now) or "invalid")
    db.expire_all()
    row = _row(db, raw)
    user = db.get(User, row.user_id)
    user.password_hash = hash_password(new_password)
    db.execute(delete(SessionModel).where(SessionModel.user_id == user.user_id))
    db.flush()
