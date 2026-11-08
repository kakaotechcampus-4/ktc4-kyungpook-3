"""가입 이메일 인증 코드 발급·확인(#427). 메일은 보내지 않고 보낼 내용을 돌려준다.

코드가 맞으면 코드를 만료시키고, 그 이메일을 담은 서명 토큰(증명)을 준다. 행은 남겨 보낸 수에 계속 잡히게 한다. 증명은 되돌릴 수 없지만 풀어 주는 일이
이메일 unique 로 막힌 insert 하나뿐이라 한 번만 쓰는 표시를 따로 두지 않는다.
"""
import hmac
import math
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import delete, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as DbSession

from app.core.errors import AppError, ErrorCode
from app.models import SignupEmailCode, User
from app.services import oauth_state, signup_mail
from app.services.messages import utc

CODE_TTL = timedelta(minutes=10)
MAX_ATTEMPTS = 5
COOLDOWN = timedelta(seconds=60)
HOURLY_LIMIT = 5
# 전체 주소 합계. 재설정 메일과 같은 계정을 쓰므로 하루로 곱해도 Gmail 발송 한도(약 500통)를 넘지 않게 둔다.
GLOBAL_HOURLY_LIMIT = 20
WINDOW = timedelta(hours=1)
RETENTION = timedelta(days=1)
PROOF_KIND = "signup_email"
PROOF_TTL_SECONDS = 1800


@dataclass(frozen=True)
class SignupCodeMail:
    to: str
    subject: str
    text: str
    html: str


def _hash(email: str, code: str) -> str:
    # 이메일을 넣어, 한 이메일로 받은 코드가 다른 이메일의 해시와 같아지지 않게 한다.
    return oauth_state.mac("signup_code", f"{email}:{code}")


def _rate_limited(reason: str, retry_at: datetime, now: datetime) -> AppError:
    retry_after = math.ceil((retry_at - now).total_seconds())
    return AppError(ErrorCode.SIGNUP_CODE_RATE_LIMITED, details={"reason": reason, "retry_after": retry_after})


def _invalid(reason: str, **details: int) -> AppError:
    return AppError(ErrorCode.SIGNUP_CODE_INVALID, details={"reason": reason, **details})


def _check_global_cap(db: DbSession, now: datetime) -> None:
    sent, oldest = db.execute(
        select(func.coalesce(func.sum(SignupEmailCode.window_count), 0), func.min(SignupEmailCode.window_started_at))
        .where(SignupEmailCode.window_started_at > now - WINDOW)
    ).one()
    if sent >= GLOBAL_HOURLY_LIMIT:
        raise _rate_limited("global", utc(oldest) + WINDOW, now)


def request_code(db: DbSession, email: str, *, now: datetime) -> SignupCodeMail:
    """정규화한 이메일에 새 코드를 만든다. commit 은 호출자가 한다."""
    if db.scalar(select(User.user_id).where(User.email == email)) is not None:
        raise AppError(ErrorCode.EMAIL_ALREADY_EXISTS)
    db.execute(
        delete(SignupEmailCode)
        .where(SignupEmailCode.sent_at < now - RETENTION)
        .execution_options(synchronize_session=False)
    )

    row = db.scalars(select(SignupEmailCode).where(SignupEmailCode.email == email).with_for_update()).first()
    code = f"{secrets.randbelow(1_000_000):06d}"
    if row is None:
        _check_global_cap(db, now)
        db.add(
            SignupEmailCode(
                email=email,
                code_hash=_hash(email, code),
                attempts=0,
                expires_at=now + CODE_TTL,
                sent_at=now,
                window_started_at=now,
                window_count=1,
            )
        )
        try:
            db.flush()
        except IntegrityError:
            # 처음 보내는 요청 둘이 겹쳤다. 먼저 넣은 쪽이 메일을 보내므로 재발송 제한으로 답한다.
            db.rollback()
            raise _rate_limited("cooldown", now + COOLDOWN, now) from None
    else:
        sent_at = utc(row.sent_at)
        if sent_at + COOLDOWN > now:
            raise _rate_limited("cooldown", sent_at + COOLDOWN, now)
        window_ends = utc(row.window_started_at) + WINDOW
        if window_ends <= now:
            row.window_started_at, row.window_count = now, 0
        elif row.window_count >= HOURLY_LIMIT:
            raise _rate_limited("hourly", window_ends, now)
        _check_global_cap(db, now)
        row.window_count += 1
        row.code_hash = _hash(email, code)
        row.attempts = 0
        row.expires_at = now + CODE_TTL
        row.sent_at = now
        db.flush()

    text = (
        "Manager's Manager 가입 인증 코드입니다.\n\n"
        f"{code}\n\n"
        "이 코드는 10분 동안만 쓸 수 있습니다.\n"
        "요청하지 않으셨다면 이 메일을 무시해 주세요."
    )
    return SignupCodeMail(
        to=email, subject="[Manager's Manager] 가입 인증 코드", text=text, html=signup_mail.render(code)
    )


def confirm_code(db: DbSession, email: str, code: str, *, now: datetime) -> str:
    """맞으면 이 이메일의 증명을 돌려준다. 시도 횟수를 남겨야 해서 호출자가 아니라 여기서 commit 한다."""
    # 비교 전에 횟수를 먼저 올려, 겹친 요청도 상한을 넘어 맞혀 보지 못하게 한다.
    claimed = db.execute(
        update(SignupEmailCode)
        .where(
            SignupEmailCode.email == email,
            SignupEmailCode.attempts < MAX_ATTEMPTS,
            SignupEmailCode.expires_at > now,
        )
        .values(attempts=SignupEmailCode.attempts + 1)
        .returning(SignupEmailCode.code_hash, SignupEmailCode.attempts)
        .execution_options(synchronize_session=False)
    ).first()
    if claimed is None:
        live = db.scalar(
            select(SignupEmailCode.email).where(SignupEmailCode.email == email, SignupEmailCode.expires_at > now)
        )
        raise _invalid("too_many" if live else "expired")
    if not hmac.compare_digest(claimed.code_hash, _hash(email, code)):
        # get_db 는 닫기만 한다. 예외 전에 commit 하지 않으면 횟수가 사라져 무제한으로 맞혀 볼 수 있다.
        db.commit()
        raise _invalid("wrong", attempts_left=MAX_ATTEMPTS - claimed.attempts)

    # 행을 지우면 재발송 제한과 전체 상한의 집계에서 빠져, 자기 메일함으로 인증을 되풀이해 발송 한도를 쓸 수 있다.
    db.execute(
        update(SignupEmailCode)
        .where(SignupEmailCode.email == email)
        .values(expires_at=now)
        .execution_options(synchronize_session=False)
    )
    db.commit()
    return oauth_state.seal(PROOF_KIND, PROOF_TTL_SECONDS, {"m": email}, now=now.timestamp())


def read_proof(token: str, *, now: float | None = None) -> str | None:
    """증명에 담긴 정규화된 이메일. 쓸 수 없는 증명이면 None 이다."""
    data = oauth_state.decode(PROOF_KIND, token, now=now)
    return data["m"] if data else None
