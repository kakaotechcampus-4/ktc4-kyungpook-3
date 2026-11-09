"""심사용 시드 명령 진입점(#606). 환경변수·입력 검사와 실행 흐름을 확인한다."""
import json
import sys

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select, update

from app.cli import seed_demo
from app.cli.demo_seed import load_seed_data
from app.main import app
from app.models import ApprovalRequest, EMBEDDING_DIMENSIONS, Meeting, Task, User
from tests.api.conftest import SERVICE_TOKEN

PATTERN = "demo+{n}@example.com"


def _args(*extra):
    return ["--email-pattern", PATTERN, "--base-url", "http://testserver", *extra]


def _env(monkeypatch, *, passwords=True, token=True):
    for name in ("DEMO_PM_PASSWORD", "DEMO_MEMBER_PASSWORD", "SERVICE_TOKEN"):
        monkeypatch.delenv(name, raising=False)
    if passwords:
        monkeypatch.setenv("DEMO_PM_PASSWORD", "demo-pm-1234")
        monkeypatch.setenv("DEMO_MEMBER_PASSWORD", "demo-m2-1234")
    if token:
        monkeypatch.setenv("SERVICE_TOKEN", SERVICE_TOKEN)
    monkeypatch.setattr(sys.stdin, "isatty", lambda: False, raising=False)


def _count(db, model):
    return db.scalar(select(func.count()).select_from(model))


def test_missing_password_noninteractive_writes_nothing(mdb, monkeypatch, capsys):
    _env(monkeypatch, passwords=False)
    monkeypatch.setattr(seed_demo, "SessionLocal", lambda: mdb)

    assert seed_demo.main(_args()) == 2

    assert "DEMO_PM_PASSWORD" in capsys.readouterr().err
    assert _count(mdb, User) == 0


def test_dry_run_changes_nothing(mdb, monkeypatch, capsys):
    _env(monkeypatch, token=False)
    monkeypatch.setattr(seed_demo, "SessionLocal", lambda: mdb)

    assert seed_demo.main(_args("--dry-run")) == 0

    out = capsys.readouterr().out
    for meeting in load_seed_data().meetings:
        assert meeting.title in out
    assert _count(mdb, User) == 0
    assert _count(mdb, Meeting) == 0


def test_dry_run_reports_reuse_and_foreign_rows(mdb, monkeypatch, capsys):
    _env(monkeypatch, token=False)
    monkeypatch.setattr(seed_demo, "SessionLocal", lambda: mdb)
    mdb.add(User(email="demo+1@example.com", name="실제PM", password_hash="x"))
    mdb.commit()

    assert seed_demo.main(_args("--dry-run")) == 2
    captured = capsys.readouterr()
    assert "이미 있는 계정 1개" in captured.out
    assert "demo+1@example.com" in captured.err
    assert "--allow-existing" in captured.err
    assert _count(mdb, User) == 1

    assert seed_demo.main(_args("--dry-run", "--allow-existing")) == 0


def test_conflict_exits_2_writing_nothing(mdb, monkeypatch, capsys):
    _env(monkeypatch)
    _inject(monkeypatch, mdb)
    mdb.add(User(email="demo+1@example.com", name="실제PM", password_hash="x"))
    mdb.commit()

    assert seed_demo.main(_args()) == 2

    assert "--allow-existing" in capsys.readouterr().err
    assert _count(mdb, User) == 1
    assert _count(mdb, Meeting) == 0


def test_missing_service_token_exits_2(monkeypatch, capsys):
    _env(monkeypatch, token=False)

    assert seed_demo.main(_args()) == 2

    assert "SERVICE_TOKEN" in capsys.readouterr().err


def _inject(monkeypatch, mdb):
    def fill(workspace_id):
        zero = [0.0] * EMBEDDING_DIMENSIONS
        mdb.execute(update(Task).where(Task.workspace_id == workspace_id, Task.embedding.is_(None)).values(embedding=zero))
        mdb.execute(
            update(ApprovalRequest)
            .where(ApprovalRequest.workspace_id == workspace_id, ApprovalRequest.embedding.is_(None))
            .values(embedding=zero)
        )
        mdb.commit()

    class _Session:
        def __call__(self):
            return self

        def __enter__(self):
            return mdb

        def __exit__(self, *exc):
            return False

    monkeypatch.setattr(seed_demo, "SessionLocal", _Session())
    monkeypatch.setattr(
        seed_demo.httpx, "Client", lambda **kw: TestClient(app, base_url="https://testserver")
    )
    monkeypatch.setattr(seed_demo, "poll_embeddings", lambda factory, timeout: fill)


def test_main_runs_end_to_end_with_injected_clients(mdb, monkeypatch, capsys):
    _env(monkeypatch)
    _inject(monkeypatch, mdb)

    assert seed_demo.main(_args()) == 0

    result = json.loads(capsys.readouterr().out.strip().splitlines()[-1])
    assert result["done"] == len(load_seed_data().meetings)
    assert result["workspace_id"]
    assert result["processing"] == 0


def test_missing_gate_warns_and_exits_3(mdb, monkeypatch, capsys):
    _env(monkeypatch)
    _inject(monkeypatch, mdb)
    real = seed_demo.replay_meetings

    def fewer_gates(*args, **kwargs):
        report = real(*args, **kwargs)
        report.gates["hold"] = 0
        return report

    monkeypatch.setattr(seed_demo, "replay_meetings", fewer_gates)

    assert seed_demo.main(_args()) == 3

    captured = capsys.readouterr()
    assert json.loads(captured.out.strip().splitlines()[-1])["gates"]["hold"] == 0
    assert "hold" in captured.err


def test_seed_error_exits_1(mdb, monkeypatch, capsys):
    _env(monkeypatch)
    _inject(monkeypatch, mdb)

    def boom(*args, **kwargs):
        raise seed_demo.SeedError("재생 실패")

    monkeypatch.setattr(seed_demo, "replay_meetings", boom)

    assert seed_demo.main(_args()) == 1
    assert "재생 실패" in capsys.readouterr().err


@pytest.mark.parametrize("pattern", ["demo@example.com", "demo+{n}", "x@{n}@y.com"])
def test_bad_email_pattern_exits_2_writing_nothing(mdb, monkeypatch, capsys, pattern):
    _env(monkeypatch)
    monkeypatch.setattr(seed_demo, "SessionLocal", lambda: mdb)

    assert seed_demo.main(["--email-pattern", pattern]) == 2

    assert capsys.readouterr().err
    assert _count(mdb, User) == 0


def test_invalid_password_exits_2_writing_nothing(mdb, monkeypatch, capsys):
    _env(monkeypatch)
    monkeypatch.setenv("DEMO_PM_PASSWORD", "x")
    monkeypatch.setattr(seed_demo, "SessionLocal", lambda: mdb)

    assert seed_demo.main(_args()) == 2

    assert _count(mdb, User) == 0
