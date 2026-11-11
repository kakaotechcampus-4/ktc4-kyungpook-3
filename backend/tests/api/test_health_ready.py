"""Grafana Synthetic Monitoring 이 부르는 DB 확인용 health ready(#675)."""
import logging

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.exc import OperationalError

from app.core.database import get_db
from app.main import app

READY = "/api/v1/health/ready"


class _DownSession:
    def execute(self, *args, **kwargs):
        raise OperationalError("SELECT 1", {}, Exception("host=secret-db password=x"))


@pytest.fixture
def db_down():
    prior = app.dependency_overrides.get(get_db)
    app.dependency_overrides[get_db] = lambda: _DownSession()
    try:
        yield
    finally:
        if prior is None:
            app.dependency_overrides.pop(get_db, None)
        else:
            app.dependency_overrides[get_db] = prior


def test_ready_ok_without_auth(mdb):
    response = TestClient(app).get(READY)

    assert response.status_code == 200
    body = response.json()
    assert body["data"] == {"status": "ok"}
    assert body["error"] is None


def test_ready_db_down_returns_503(db_down, caplog):
    with caplog.at_level(logging.WARNING):
        response = TestClient(app).get(READY)

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "DATABASE_UNAVAILABLE"
    assert "secret-db" not in response.text
    assert "password" not in response.text
    assert "OperationalError" in caplog.text
    assert "secret-db" not in caplog.text


def test_health_still_ok_when_db_down(db_down):
    response = TestClient(app).get("/health")

    assert response.status_code == 200
    assert response.json()["data"] == {"status": "ok"}
