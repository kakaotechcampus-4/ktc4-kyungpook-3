"""비밀번호 재설정 서비스(app/services/password_reset.py). 시각은 now 로 직접 준다."""
import re
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.core.errors import AppError, ErrorCode
from app.models import PasswordResetToken, Session as SessionModel, User
from app.services import messages, password_reset as svc
from app.services.passwords import hash_password, verify_password
from app.services.sessions import hash_session_token
from tests.usernames import username_for

NOW = datetime(2026, 11, 5, 0, 0, tzinfo=timezone.utc)
BASE = "https://mm.example"
LINK = re.compile(r"https://mm\.example/reset-password#token=([A-Za-z0-9_-]+)")


def _user(db, email="abcd@example.com", password_hash="__default__", provider="local"):
    if password_hash == "__default__":
        password_hash = hash_password("old-pass-1")
    user = User(username=username_for(email), email=email, password_hash=password_hash, name="테스터", provider=provider)
    db.add(user)
    db.commit()
    return user


def _request(db, at=NOW, email="abcd@example.com"):
    mail = svc.request_reset(db, email, now=at, base_url=BASE)
    db.commit()
    return mail


def _raw(mail):
    return LINK.search(mail.text).group(1)


def _reason(db, raw, at):
    with pytest.raises(AppError) as exc:
        svc.verify_token(db, raw, now=at)
    assert exc.value.code == ErrorCode.PASSWORD_RESET_TOKEN_INVALID
    return exc.value.details["reason"]


def test_request_unknown_email_returns_none(mdb):
    assert _request(mdb, email="nobody@example.com") is None
    assert mdb.scalars(select(PasswordResetToken)).all() == []


def test_request_issues_token_and_stores_only_hash(mdb):
    user = _user(mdb)
    mail = _request(mdb)
    assert mail.to == "abcd@example.com"
    assert mail.user_id == user.user_id
    assert mail.subject == "[Manager's Manager] 비밀번호 재설정 안내"
    assert "https://mm.example/reset-password#token=" in mail.text
    assert "30분" in mail.text
    raw = _raw(mail)
    rows = mdb.scalars(select(PasswordResetToken)).all()
    assert len(rows) == 1
    assert rows[0].token_hash == svc.hash_token(raw)
    for col in PasswordResetToken.__table__.columns:
        assert raw not in str(getattr(rows[0], col.key))


def test_request_within_cooldown_sends_nothing_and_keeps_previous_token(mdb):
    _user(mdb)
    first = _request(mdb)
    assert _request(mdb, NOW + timedelta(seconds=30)) is None
    svc.verify_token(mdb, _raw(first), now=NOW + timedelta(seconds=30))


def test_request_hourly_limit(mdb):
    _user(mdb)
    for i in range(5):
        assert _request(mdb, NOW + timedelta(seconds=61 * i)) is not None
    assert _request(mdb, NOW + timedelta(seconds=305)) is None
    assert _request(mdb, NOW + timedelta(seconds=3601)) is not None


def test_reissue_invalidates_previous_token(mdb):
    _user(mdb)
    first = _request(mdb)
    second = _request(mdb, NOW + timedelta(seconds=61))
    at = NOW + timedelta(seconds=62)
    assert _reason(mdb, _raw(first), at) == "invalid"
    svc.verify_token(mdb, _raw(second), now=at)


def test_request_works_for_account_without_password(mdb):
    _user(mdb, password_hash=None, provider="google")
    mail = _request(mdb)
    assert mail is not None
    svc.confirm_reset(mdb, _raw(mail), "new-pass-1", now=NOW + timedelta(minutes=1))
    mdb.commit()
    user = mdb.scalars(select(User)).one()
    assert verify_password("new-pass-1", user.password_hash)


def test_request_purges_rows_older_than_7_days(mdb):
    user = _user(mdb)
    _request(mdb)
    later = NOW + timedelta(days=7, seconds=1)
    _request(mdb, later)
    rows = mdb.scalars(select(PasswordResetToken).where(PasswordResetToken.user_id == user.user_id)).all()
    assert len(rows) == 1


def test_verify_returns_expiry_and_masked_email(mdb):
    _user(mdb)
    raw = _raw(_request(mdb))
    expires_at, masked = svc.verify_token(mdb, raw, now=NOW)
    assert messages.utc(expires_at) == NOW + timedelta(minutes=30)
    assert masked == "ab***@example.com"


def test_verify_reasons(mdb):
    _user(mdb)
    raw = _raw(_request(mdb))
    assert _reason(mdb, "no-such-token", NOW) == "invalid"
    assert _reason(mdb, raw, NOW + timedelta(minutes=31)) == "expired"
    svc.confirm_reset(mdb, raw, "new-pass-1", now=NOW + timedelta(minutes=1))
    mdb.commit()
    assert _reason(mdb, raw, NOW + timedelta(minutes=2)) == "used"


def test_confirm_changes_password_and_deletes_sessions(mdb):
    user = _user(mdb)
    for i in range(2):
        mdb.add(SessionModel(user_id=user.user_id, session_token=hash_session_token(f"tok{i}"), expires_at=NOW + timedelta(days=1)))
    mdb.commit()
    raw = _raw(_request(mdb))
    svc.confirm_reset(mdb, raw, "new-pass-1", now=NOW + timedelta(minutes=1))
    mdb.commit()
    assert mdb.scalars(select(SessionModel)).all() == []
    mdb.refresh(user)
    assert verify_password("new-pass-1", user.password_hash)
    assert not verify_password("old-pass-1", user.password_hash)


def test_confirm_twice_is_used(mdb):
    _user(mdb)
    raw = _raw(_request(mdb))
    svc.confirm_reset(mdb, raw, "new-pass-1", now=NOW + timedelta(minutes=1))
    mdb.commit()
    with pytest.raises(AppError) as exc:
        svc.confirm_reset(mdb, raw, "new-pass-2", now=NOW + timedelta(minutes=2))
    assert exc.value.details["reason"] == "used"


@pytest.mark.parametrize(
    "email,masked",
    [("a@x.com", "a***@x.com"), ("ab@x.com", "a***@x.com"), ("abc@x.com", "ab***@x.com")],
)
def test_mask_email_edges(email, masked):
    assert svc.mask_email(email) == masked


def test_confirm_expired_token_keeps_password(mdb):
    user = _user(mdb)
    raw = _raw(_request(mdb))
    with pytest.raises(AppError) as exc:
        svc.confirm_reset(mdb, raw, "new-pass-1", now=NOW + timedelta(minutes=31))
    assert exc.value.details["reason"] == "expired"
    mdb.refresh(user)
    assert verify_password("old-pass-1", user.password_hash)


def test_confirm_invalidated_token_keeps_password(mdb):
    user = _user(mdb)
    first = _request(mdb)
    _request(mdb, NOW + timedelta(seconds=61))
    with pytest.raises(AppError) as exc:
        svc.confirm_reset(mdb, _raw(first), "new-pass-1", now=NOW + timedelta(seconds=62))
    assert exc.value.details["reason"] == "invalid"
    mdb.refresh(user)
    assert verify_password("old-pass-1", user.password_hash)


def _fill_global(db, count=svc.GLOBAL_HOURLY_LIMIT, start=NOW):
    users = []
    for i in range(count):
        users.append(_user(db, email=f"user{i}@example.com"))
        assert _request(db, start + timedelta(seconds=i), email=f"user{i}@example.com") is not None
    return users


def test_request_global_hourly_cap(mdb):
    _fill_global(mdb)
    _user(mdb, email="late@example.com")
    assert _request(mdb, NOW + timedelta(seconds=10), email="late@example.com") is None
    assert len(mdb.scalars(select(PasswordResetToken)).all()) == svc.GLOBAL_HOURLY_LIMIT


def test_global_cap_keeps_previous_link(mdb):
    users = _fill_global(mdb)
    assert _request(mdb, NOW + timedelta(seconds=120), email=users[0].email) is None
    row = mdb.scalars(select(PasswordResetToken).where(PasswordResetToken.user_id == users[0].user_id)).one()
    assert row.invalidated_at is None
    assert len(mdb.scalars(select(PasswordResetToken)).all()) == svc.GLOBAL_HOURLY_LIMIT


def test_global_cap_window_slides(mdb):
    _fill_global(mdb)
    _user(mdb, email="late@example.com")
    assert _request(mdb, NOW + timedelta(seconds=3599), email="late@example.com") is None
    assert _request(mdb, NOW + timedelta(hours=1), email="late@example.com") is not None


def test_global_cap_counts_invalidated_and_used_rows(mdb):
    users = _fill_global(mdb, count=svc.GLOBAL_HOURLY_LIMIT - 2)
    # 한 사용자가 재발급해 앞 토큰을 무효화하고, 다른 토큰은 사용 처리해도 행은 모두 센다.
    reissued = _request(mdb, NOW + timedelta(seconds=100), email=users[0].email)
    assert reissued is not None
    svc.confirm_reset(mdb, _raw(reissued), "new-pass-1", now=NOW + timedelta(seconds=101))
    mdb.commit()
    flags = mdb.execute(select(PasswordResetToken.invalidated_at, PasswordResetToken.used_at)).all()
    assert len(flags) == svc.GLOBAL_HOURLY_LIMIT - 1
    assert any(inv is not None for inv, _ in flags) and any(used is not None for _, used in flags)
    assert _request(mdb, NOW + timedelta(seconds=102), email=users[1].email) is not None
    assert _request(mdb, NOW + timedelta(seconds=200), email=users[2].email) is None


def test_unknown_email_does_not_consume_global_budget(mdb):
    for i in range(10):
        assert _request(mdb, NOW + timedelta(seconds=i), email=f"ghost{i}@example.com") is None
    _fill_global(mdb, start=NOW + timedelta(seconds=20))
    assert len(mdb.scalars(select(PasswordResetToken)).all()) == svc.GLOBAL_HOURLY_LIMIT


def test_global_cap_blocked_logs_reason_without_email(mdb, caplog):
    _fill_global(mdb)
    _user(mdb, email="late@example.com")
    with caplog.at_level("WARNING"):
        assert _request(mdb, NOW + timedelta(seconds=10), email="late@example.com") is None
    assert "reason=global" in caplog.text
    assert "late@example.com" not in caplog.text
