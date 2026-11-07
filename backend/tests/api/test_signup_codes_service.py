"""가입 이메일 인증 코드 서비스(app/services/signup_codes.py). 시각은 now 로 직접 준다."""
import re
import threading
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app.core.errors import AppError, ErrorCode
from app.models import SignupEmailCode, User
from app.services import signup_codes as svc
from tests.api.conftest import TEST_DATABASE_URL

NOW = datetime(2026, 11, 6, 0, 0, tzinfo=timezone.utc)
EMAIL = "new@example.com"


@pytest.fixture(autouse=True)
def secret(monkeypatch):
    monkeypatch.setenv("OAUTH_STATE_SECRET", "k" * 40)


def _code(mail):
    return re.search(r"^(\d{6})$", mail.text, re.M).group(1)


def _request(db, at=NOW, email=EMAIL):
    mail = svc.request_code(db, email, now=at)
    db.commit()
    # 요청마다 세션이 새로 열리는 운영과 같게 캐시된 행을 비운다.
    db.expunge_all()
    return mail


def _wrong(code):
    return "000000" if code != "000000" else "111111"


def _failure(fn):
    with pytest.raises(AppError) as exc:
        fn()
    return exc.value


def _attempts(db):
    return db.scalar(select(SignupEmailCode.attempts).where(SignupEmailCode.email == EMAIL))


def test_mail_has_the_code_only_in_the_body(mdb):
    mail = _request(mdb)

    assert mail.to == EMAIL
    assert mail.subject == "[Manager's Manager] 가입 인증 코드"
    assert not re.search(r"\d{6}", mail.subject)
    assert "10분" in mail.text
    assert "무시" in mail.text


def test_code_is_stored_only_as_a_hash(mdb):
    mail = _request(mdb)

    row = mdb.get(SignupEmailCode, EMAIL)
    assert _code(mail) not in row.code_hash
    assert len(row.code_hash) == 64


def test_correct_code_gives_a_proof_of_that_email_and_removes_the_row(mdb):
    code = _code(_request(mdb))

    proof = svc.confirm_code(mdb, EMAIL, code, now=NOW)

    assert svc.read_proof(proof, now=NOW.timestamp()) == EMAIL
    assert mdb.scalar(select(SignupEmailCode.email)) is None


def test_proof_expires_after_thirty_minutes(mdb):
    code = _code(_request(mdb))
    proof = svc.confirm_code(mdb, EMAIL, code, now=NOW)

    assert svc.read_proof(proof, now=NOW.timestamp() + 1799) == EMAIL
    assert svc.read_proof(proof, now=NOW.timestamp() + 1800) is None


def test_read_proof_rejects_garbage(mdb):
    assert svc.read_proof("garbage") is None


def test_wrong_code_reports_attempts_left(mdb):
    code = _code(_request(mdb))

    err = _failure(lambda: svc.confirm_code(mdb, EMAIL, _wrong(code), now=NOW))

    assert err.code == ErrorCode.SIGNUP_CODE_INVALID
    assert err.details == {"reason": "wrong", "attempts_left": 4}


def test_wrong_guess_count_survives_the_session_closing(mdb):
    """get_db 는 close 만 한다. 예외 전에 commit 하지 않으면 횟수가 사라져 무제한으로 맞혀 볼 수 있다."""
    code = _code(_request(mdb))

    _failure(lambda: svc.confirm_code(mdb, EMAIL, _wrong(code), now=NOW))
    mdb.rollback()

    assert _attempts(mdb) == 1


def test_a_code_for_another_email_is_wrong(mdb):
    code = _code(_request(mdb))
    _request(mdb, email="other@example.com")

    err = _failure(lambda: svc.confirm_code(mdb, "other@example.com", code, now=NOW))

    assert err.details["reason"] == "wrong"


def test_same_code_for_two_emails_does_not_match_across_them(mdb, monkeypatch):
    monkeypatch.setattr(svc.secrets, "randbelow", lambda n: 123456)
    _request(mdb)
    _request(mdb, email="other@example.com")

    hashes = mdb.scalars(select(SignupEmailCode.code_hash)).all()

    assert len(set(hashes)) == 2


def test_sixth_try_is_refused_even_with_the_right_code(mdb):
    code = _code(_request(mdb))
    for left in (4, 3, 2, 1, 0):
        err = _failure(lambda: svc.confirm_code(mdb, EMAIL, _wrong(code), now=NOW))
        assert err.details == {"reason": "wrong", "attempts_left": left}

    err = _failure(lambda: svc.confirm_code(mdb, EMAIL, code, now=NOW))

    assert err.code == ErrorCode.SIGNUP_CODE_INVALID
    assert err.details == {"reason": "too_many"}


def test_expired_code_is_refused_and_does_not_count(mdb):
    code = _code(_request(mdb))

    err = _failure(lambda: svc.confirm_code(mdb, EMAIL, code, now=NOW + timedelta(minutes=10)))

    assert err.details == {"reason": "expired"}
    mdb.rollback()
    assert _attempts(mdb) == 0


def test_code_just_before_expiry_works(mdb):
    code = _code(_request(mdb))

    assert svc.confirm_code(mdb, EMAIL, code, now=NOW + timedelta(minutes=10, seconds=-1))


def test_confirm_without_a_request_is_expired(mdb):
    assert _failure(lambda: svc.confirm_code(mdb, EMAIL, "123456", now=NOW)).details == {"reason": "expired"}


def test_code_cannot_be_used_twice(mdb):
    code = _code(_request(mdb))
    svc.confirm_code(mdb, EMAIL, code, now=NOW)

    assert _failure(lambda: svc.confirm_code(mdb, EMAIL, code, now=NOW)).details == {"reason": "expired"}


def test_resend_within_sixty_seconds_is_refused(mdb):
    _request(mdb)

    err = _failure(lambda: svc.request_code(mdb, EMAIL, now=NOW + timedelta(seconds=45)))

    assert err.code == ErrorCode.SIGNUP_CODE_RATE_LIMITED
    assert err.details == {"reason": "cooldown", "retry_after": 15}


def test_resend_replaces_the_code_and_resets_attempts(mdb):
    first = _code(_request(mdb))
    _failure(lambda: svc.confirm_code(mdb, EMAIL, _wrong(first), now=NOW))
    mdb.expunge_all()

    second = _code(_request(mdb, at=NOW + timedelta(seconds=60)))

    assert _attempts(mdb) == 0
    later = NOW + timedelta(seconds=61)
    if first != second:
        assert _failure(lambda: svc.confirm_code(mdb, EMAIL, first, now=later)).details["reason"] == "wrong"
    assert svc.confirm_code(mdb, EMAIL, second, now=later)


def test_sixth_send_in_an_hour_is_refused_until_the_window_ends(mdb):
    for i in range(5):
        _request(mdb, at=NOW + timedelta(minutes=2 * i))

    at = NOW + timedelta(minutes=30)
    err = _failure(lambda: svc.request_code(mdb, EMAIL, now=at))
    mdb.rollback()

    assert err.details == {"reason": "hourly", "retry_after": 1800}
    assert _request(mdb, at=NOW + timedelta(hours=1))


def test_requests_for_other_emails_do_not_share_a_limit(mdb):
    _request(mdb)

    assert _request(mdb, email="other@example.com")


def test_registered_email_is_refused(mdb):
    mdb.add(User(email="Taken@example.com", name="t", provider="local"))
    mdb.commit()

    err = _failure(lambda: svc.request_code(mdb, "taken@example.com", now=NOW))

    assert err.code == ErrorCode.EMAIL_ALREADY_EXISTS


def test_rows_older_than_a_day_are_removed_by_later_requests(mdb):
    _request(mdb)

    _request(mdb, at=NOW + timedelta(days=1, seconds=1), email="other@example.com")

    assert mdb.scalars(select(SignupEmailCode.email)).all() == ["other@example.com"]


pg_only = pytest.mark.skipif(not TEST_DATABASE_URL, reason="TEST_DATABASE_URL(PostgreSQL)이 없습니다.")


def _parallel(jobs):
    start = threading.Barrier(len(jobs))
    results = [None] * len(jobs)

    def run(i, job):
        start.wait()
        results[i] = job()

    threads = [threading.Thread(target=run, args=(i, job)) for i, job in enumerate(jobs)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    return results


def _sessions():
    return sessionmaker(bind=create_engine(TEST_DATABASE_URL, pool_size=10), autoflush=False)


@pg_only
@pytest.mark.parametrize("mdb", ["postgresql"], indirect=True)
def test_parallel_guesses_never_exceed_the_limit(mdb):
    code = _code(_request(mdb))
    make = _sessions()

    def guess():
        with make() as db:
            try:
                svc.confirm_code(db, EMAIL, _wrong(code), now=NOW)
            except AppError as exc:
                return exc.details["reason"]

    reasons = _parallel([guess] * 8)

    assert sorted(reasons) == ["too_many"] * 3 + ["wrong"] * 5
    mdb.rollback()
    assert _attempts(mdb) == 5


@pg_only
@pytest.mark.parametrize("mdb", ["postgresql"], indirect=True)
def test_parallel_first_requests_send_one_mail(mdb):
    make = _sessions()

    def ask():
        with make() as db:
            try:
                mail = svc.request_code(db, EMAIL, now=NOW)
                db.commit()
                return mail
            except AppError as exc:
                return exc.details["reason"]

    results = _parallel([ask] * 6)

    mails = [r for r in results if isinstance(r, svc.SignupCodeMail)]
    assert len(mails) == 1
    assert [r for r in results if r not in mails] == ["cooldown"] * 5


def test_html_mail_shows_the_code_but_the_subject_does_not(mdb):
    mail = svc.request_code(mdb, EMAIL, now=NOW)
    code = _code(mail)

    assert code in mail.html
    assert code not in mail.subject
    assert "cid:logo" in mail.html
    assert "10분" in mail.html


def test_new_address_is_refused_once_the_hour_cap_is_used(mdb):
    for n in range(svc.GLOBAL_HOURLY_LIMIT):
        svc.request_code(mdb, f"user{n}@example.com", now=NOW + timedelta(seconds=n))
    mdb.commit()

    err = _failure(lambda: svc.request_code(mdb, "late@example.com", now=NOW + timedelta(minutes=30)))

    assert err.details["reason"] == "global"
    assert err.details["retry_after"] == 30 * 60


def test_cap_also_stops_a_resend_and_lifts_after_the_hour(mdb):
    for n in range(svc.GLOBAL_HOURLY_LIMIT):
        svc.request_code(mdb, f"user{n}@example.com", now=NOW)
    mdb.commit()

    err = _failure(lambda: svc.request_code(mdb, "user0@example.com", now=NOW + timedelta(minutes=5)))
    assert err.details["reason"] == "global"

    assert svc.request_code(mdb, "late@example.com", now=NOW + timedelta(hours=1, seconds=1)).to == "late@example.com"


def test_cap_keeps_a_day_under_the_gmail_daily_limit():
    assert svc.GLOBAL_HOURLY_LIMIT * 24 < 500
