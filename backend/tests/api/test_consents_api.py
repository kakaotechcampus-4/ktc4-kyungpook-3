"""이용약관·개인정보처리방침 동의 기록(#564)."""
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.main import app
from app.models import UserConsent
from app.services import consents
from tests.api.conftest import _user

P = "/api/v1/consents"
V = "2026-11-08"


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


def test_outdated_version_is_rejected_and_nothing_is_saved(mdb):
    _user(mdb, "a")
    mdb.commit()

    res = _agree(client("a"), privacy="2026-01-01")

    assert res.status_code == 400
    assert res.json()["error"]["code"] == "CONSENT_VERSION_MISMATCH"
    assert mdb.scalars(select(UserConsent)).all() == []


def test_agreeing_again_keeps_one_row_per_version(mdb):
    _user(mdb, "a")
    mdb.commit()
    c = client("a")

    assert _agree(c).status_code == 200
    assert _agree(c).status_code == 200

    rows = mdb.scalars(select(UserConsent)).all()
    assert sorted(r.kind for r in rows) == ["privacy", "terms"]


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


def test_consents_belong_to_each_user(mdb):
    _user(mdb, "a")
    _user(mdb, "b")
    mdb.commit()

    _agree(client("a"))

    assert client("b").get(f"{P}/me").json()["data"]["required"] is True
