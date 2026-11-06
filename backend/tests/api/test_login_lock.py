"""로그인이 비밀번호 재설정(confirm)과 겹쳐도 옛 비밀번호 세션이 남지 않게 한다(#356 리뷰).

비밀번호 검사(PBKDF2, 약 0.2초)는 잠금 없이 하고, 세션을 넣기 직전에만 사용자 행을 공유 잠금으로 다시 읽어
해시가 그대로인지 본다. 검사 내내 공유 잠금을 잡으면 로그인이 계속 겹칠 때 confirm 의 FOR UPDATE 가 끝없이
밀린다(PostgreSQL 은 대기 중인 배타 잠금이 있어도 새 공유 잠금을 준다).
"""
from fastapi.testclient import TestClient
from sqlalchemy import select, update
from sqlalchemy.dialects import postgresql

from app.api import auth
from app.main import app
from app.models import Session as SessionModel, User
from app.services.passwords import hash_password

EMAIL = "lock@example.com"
PW = "oldpass123"


def _compiled(stmt) -> str:
    return str(stmt.compile(dialect=postgresql.dialect()))


def test_login_reads_the_user_row_without_a_lock():
    """비밀번호를 검사하는 동안에는 잠그지 않는다."""
    sql = _compiled(auth._login_user_stmt(EMAIL))

    assert "FOR SHARE" not in sql
    assert "FOR UPDATE" not in sql


def test_login_rechecks_the_hash_with_a_share_lock():
    """세션을 넣기 직전의 재확인만 공유 잠금이다. sqlite 는 행 잠금이 없어 PostgreSQL 로 컴파일해 본다."""
    sql = _compiled(auth._password_hash_lock_stmt("user-id"))

    assert "FOR SHARE" in sql
    assert "FOR UPDATE" not in sql


def test_login_rejects_when_password_changed_during_the_check(mdb, monkeypatch):
    """검사하는 사이 재설정으로 비밀번호가 바뀌었으면 옛 비밀번호 세션을 만들지 않는다."""
    c = TestClient(app, base_url="https://testserver")
    assert c.post("/api/v1/auth/signup", json={"email": EMAIL, "password": PW, "name": "l"}).status_code == 201
    user_id = mdb.scalar(select(User.user_id).where(User.email == EMAIL))
    sessions_before = mdb.query(SessionModel).filter(SessionModel.user_id == user_id).count()
    real_verify = auth.verify_password

    def verify_then_reset(password, stored_hash):
        ok = real_verify(password, stored_hash)
        # confirm 이 검사 도중 비밀번호를 바꾼 상황. 이미 읽은 User 객체는 옛 해시를 들고 있다.
        mdb.execute(
            update(User).where(User.user_id == user_id).values(password_hash=hash_password("newpass456")),
            execution_options={"synchronize_session": False},
        )
        return ok

    monkeypatch.setattr(auth, "verify_password", verify_then_reset)

    r = c.post("/api/v1/auth/login", json={"email": EMAIL, "password": PW})

    assert r.status_code == 401, r.text
    assert r.json()["error"]["code"] == "INVALID_CREDENTIALS"
    assert mdb.query(SessionModel).filter(SessionModel.user_id == user_id).count() == sessions_before
