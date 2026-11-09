"""이용약관·개인정보처리방침 동의 기록(#564)."""
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
import secrets
from threading import Barrier, Event
import time

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event, select, text
from sqlalchemy.orm import Session, sessionmaker

from app.core.database import get_db
from app.main import app
from app.models import UserConsent
from app.services import consents
from tests.api.conftest import _user, signup_verified

P = "/api/v1/consents"
V = "2026-11-08"


@pytest.fixture(autouse=True)
def _sqlite_foreign_keys_match_runtime(mdb):
    if mdb.get_bind().dialect.name == "sqlite":
        mdb.connection().exec_driver_sql("PRAGMA foreign_keys=ON")


def client(name: str | None = None) -> TestClient:
    c = TestClient(app, base_url="https://testserver")
    if name:
        c.cookies.set("session_token", f"{name}-token")
    return c


def _agree(c: TestClient, terms: str = V, privacy: str = V):
    return c.post(P, json={"terms_version": terms, "privacy_version": privacy})


def _docs(body: dict) -> dict:
    return {d["kind"]: d for d in body["data"]["documents"]}


def test_requires_login(mdb):
    assert client().get(f"{P}/me").status_code == 401
    assert _agree(client()).status_code == 401


def test_new_user_must_agree(mdb):
    _user(mdb, "a")
    mdb.commit()

    res = client("a").get(f"{P}/me")

    assert res.status_code == 200
    body = res.json()
    assert body["data"]["required"] is True
    docs = _docs(body)
    assert set(docs) == {"terms", "privacy"}
    for d in docs.values():
        assert d["current_version"] == V
        assert d["agreed_version"] is None
        assert d["agreed_at"] is None


def test_agreeing_to_current_versions_clears_required(mdb):
    _user(mdb, "a")
    mdb.commit()
    c = client("a")

    res = _agree(c)

    assert res.status_code == 200
    assert res.json()["data"]["required"] is False
    me = c.get(f"{P}/me").json()
    assert me["data"]["required"] is False
    for d in _docs(me).values():
        assert d["agreed_version"] == V
        assert d["agreed_at"] is not None


@pytest.mark.parametrize("outdated", ["terms", "privacy"])
def test_outdated_version_is_rejected_and_nothing_is_saved(mdb, outdated):
    _user(mdb, "a")
    mdb.commit()

    res = _agree(client("a"), **{outdated: "2026-01-01"})

    assert res.status_code == 400
    assert res.json()["error"]["code"] == "CONSENT_VERSION_MISMATCH"
    assert mdb.scalars(select(UserConsent)).all() == []


def test_agreeing_again_keeps_one_row_per_version(mdb):
    _user(mdb, "a")
    mdb.commit()
    c = client("a")

    assert _agree(c).status_code == 200
    first = {r.kind: (r.consent_id, r.agreed_at) for r in mdb.scalars(select(UserConsent))}
    assert _agree(c).status_code == 200

    rows = mdb.scalars(select(UserConsent)).all()
    assert sorted(r.kind for r in rows) == ["privacy", "terms"]
    assert {r.kind: (r.consent_id, r.agreed_at) for r in rows} == first


def test_new_document_version_requires_agreeing_again(mdb, monkeypatch):
    _user(mdb, "a")
    mdb.commit()
    c = client("a")
    _agree(c)

    monkeypatch.setitem(consents.CURRENT_VERSIONS, "privacy", "2026-12-01")

    me = c.get(f"{P}/me").json()
    assert me["data"]["required"] is True
    docs = _docs(me)
    assert docs["privacy"]["agreed_version"] == V
    assert docs["privacy"]["current_version"] == "2026-12-01"
    assert docs["terms"]["agreed_version"] == V
    assert _agree(c, privacy="2026-12-01").json()["data"]["required"] is False
    mdb.expire_all()
    assert sorted((row.kind, row.version) for row in mdb.scalars(select(UserConsent))) == [
        ("privacy", V), ("privacy", "2026-12-01"), ("terms", V),
    ]


def test_consents_belong_to_each_user(mdb):
    _user(mdb, "a")
    _user(mdb, "b")
    mdb.commit()

    _agree(client("a"))

    assert client("b").get(f"{P}/me").json()["data"]["required"] is True


def test_storage_integrity_failure_is_not_reported_as_agreement(mdb, monkeypatch):
    _user(mdb, "a")
    mdb.commit()

    def invalid_record(db, user_id, versions):
        db.add(UserConsent(user_id=user_id, kind="terms", version=None))

    monkeypatch.setattr(consents, "agree", invalid_record)
    c = TestClient(app, base_url="https://testserver", raise_server_exceptions=False)
    c.cookies.set("session_token", "a-token")
    assert _agree(c).status_code == 500
    mdb.rollback()
    assert mdb.scalars(select(UserConsent)).all() == []


def test_a_request_cannot_record_another_users_agreement(mdb):
    _user(mdb, "a")
    other = _user(mdb, "b")
    other_id = other.user_id
    mdb.commit()
    res = client("a").post(P, json={"terms_version": V, "privacy_version": V, "user_id": other_id})
    assert res.status_code == 400
    assert mdb.scalars(select(UserConsent)).all() == []


def test_withdrawal_erases_consents_and_same_email_signup_starts_fresh(mdb, signup_secret):
    user = _user(mdb, "a")
    old_id = user.user_id
    mdb.commit()
    old = client("a")
    assert _agree(old).status_code == 200
    res = old.delete("/api/v1/auth/me", headers={
        "X-Withdrawal-Key": secrets.token_urlsafe(32), "X-Withdrawal-Account-ID": old_id,
    })
    assert res.status_code == 202, res.text
    mdb.expire_all()
    assert mdb.scalars(select(UserConsent)).all() == []
    assert _agree(client("a")).status_code == 401
    fresh = client()
    signup = signup_verified(fresh, "a@example.com", name="새 계정")
    assert signup.status_code == 201, signup.text
    assert signup.json()["data"]["user"]["user_id"] != old_id
    assert fresh.get(f"{P}/me").json()["data"]["required"] is True


@contextmanager
def _independent_requests(mdb):
    engine = mdb.get_bind()
    if engine.dialect.name != "postgresql":
        pytest.skip("독립 HTTP 요청의 실제 행 잠금은 PostgreSQL에서 검증한다")
    mdb.commit()
    factory = sessionmaker(bind=engine, autoflush=False)
    prior = app.dependency_overrides[get_db]

    def independent_db():
        with factory() as db:
            db.execute(text("SET LOCAL lock_timeout = '15s'"))
            yield db

    app.dependency_overrides[get_db] = independent_db
    try:
        yield engine
    finally:
        app.dependency_overrides[get_db] = prior


def test_concurrent_posts_preserve_one_row_and_first_agreement_time(mdb):
    _user(mdb, "a")
    mdb.commit()
    with _independent_requests(mdb) as engine:
        insertions = Barrier(2, timeout=5)

        def before(conn, cursor, statement, params, context, executemany):
            if statement.startswith("INSERT INTO user_consent"):
                insertions.wait()

        event.listen(engine, "before_cursor_execute", before)
        try:
            with ThreadPoolExecutor(2) as pool:
                results = list(pool.map(lambda _: _agree(client("a")), range(2)))
        finally:
            event.remove(engine, "before_cursor_execute", before)
        assert [r.status_code for r in results] == [200, 200]
        assert all(r.json()["data"]["required"] is False for r in results)
    mdb.expire_all()
    rows = list(mdb.scalars(select(UserConsent)))
    assert sorted(row.kind for row in rows) == ["privacy", "terms"]
    assert len({row.agreed_at for row in rows}) == 1


def _wait_for_blocker(engine, waiting_pid, blocker_pid):
    deadline = time.monotonic() + 5
    with engine.connect() as observer:
        while blocker_pid not in observer.scalar(text("SELECT pg_blocking_pids(:pid)"), {"pid": waiting_pid}):
            assert time.monotonic() < deadline, "HTTP request did not wait for the existing account lock"
            Event().wait(0.01)


@pytest.mark.parametrize("first", ["consent", "withdrawal"])
def test_consent_and_withdrawal_respect_the_current_account_lock(mdb, first):
    user = _user(mdb, "a")
    uid = user.user_id
    mdb.commit()
    assert _agree(client("a")).status_code == 200
    headers = {"X-Withdrawal-Key": secrets.token_urlsafe(32), "X-Withdrawal-Account-ID": uid}
    held, attempted, release = Event(), Event(), Event()
    pids = {}
    hold_kind = "FOR SHARE" if first == "consent" else "FOR UPDATE"
    wait_kind = "FOR UPDATE" if first == "consent" else "FOR SHARE"

    with _independent_requests(mdb) as engine:
        def before(conn, cursor, statement, params, context, executemany):
            if 'FROM "user"' in statement and wait_kind in statement:
                pids["waiting"] = conn.scalar(text("SELECT pg_backend_pid()"))
                attempted.set()

        def after(conn, cursor, statement, params, context, executemany):
            if 'FROM "user"' in statement and hold_kind in statement and not held.is_set():
                pids["holding"] = conn.scalar(text("SELECT pg_backend_pid()"))
                held.set()
                assert release.wait(10)

        event.listen(engine, "before_cursor_execute", before)
        event.listen(engine, "after_cursor_execute", after)
        jobs = {
            "consent": lambda: _agree(client("a")),
            "withdrawal": lambda: client("a").delete("/api/v1/auth/me", headers=headers),
        }
        try:
            with ThreadPoolExecutor(2) as pool:
                leading = pool.submit(jobs[first])
                try:
                    assert held.wait(5)
                    following = pool.submit(jobs["withdrawal" if first == "consent" else "consent"])
                    assert attempted.wait(5)
                    _wait_for_blocker(engine, pids["waiting"], pids["holding"])
                finally:
                    release.set()
                leading_response, following_response = leading.result(20), following.result(20)
        finally:
            release.set()
            event.remove(engine, "before_cursor_execute", before)
            event.remove(engine, "after_cursor_execute", after)
        if first == "consent":
            assert leading_response.status_code == 200, leading_response.text
            assert leading_response.json()["data"]["required"] is False
            assert following_response.status_code == 202, following_response.text
        else:
            assert leading_response.status_code == 202, leading_response.text
            assert following_response.status_code == 401, following_response.text
    mdb.expire_all()
    assert mdb.scalars(select(UserConsent)).all() == []
    assert _agree(client("a")).status_code == 401


def test_committed_agreement_response_survives_withdrawal_before_delivery(mdb, monkeypatch):
    user = _user(mdb, "a")
    uid = user.user_id
    mdb.commit()
    saved, release = Event(), Event()
    original_agree = consents.agree

    def observed_agree(db, user_id, versions):
        db.info["pause_consent_response"] = True
        original_agree(db, user_id, versions)

    def after_commit(db):
        if db.info.get("pause_consent_response"):
            saved.set()
            assert release.wait(10)

    monkeypatch.setattr(consents, "agree", observed_agree)
    with _independent_requests(mdb):
        event.listen(Session, "after_commit", after_commit)
        c = TestClient(app, base_url="https://testserver", raise_server_exceptions=False)
        c.cookies.set("session_token", "a-token")
        try:
            with ThreadPoolExecutor(1) as pool:
                response = pool.submit(lambda: _agree(c))
                try:
                    assert saved.wait(5)
                    withdrawn = client("a").delete("/api/v1/auth/me", headers={
                        "X-Withdrawal-Key": secrets.token_urlsafe(32), "X-Withdrawal-Account-ID": uid,
                    })
                    assert withdrawn.status_code == 202, withdrawn.text
                finally:
                    release.set()
                result = response.result(10)
        finally:
            release.set()
            event.remove(Session, "after_commit", after_commit)
    assert result.status_code == 200, result.text
    assert result.json()["data"]["required"] is False
    mdb.expire_all()
    assert mdb.scalars(select(UserConsent)).all() == []
