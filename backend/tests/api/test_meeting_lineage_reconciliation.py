import json

import pytest

from app.cli import reconcile_meeting_lineages as cli
from app.models import Meeting, Workspace


def meeting(db, workspace, *, status="done", source="discord", ready=False):
    row = Meeting(workspace_id=workspace, status=status, source=source, title="retain original")
    row.deletion_ready = ready
    db.add(row)
    db.commit()
    return row


def manifest(directory, ids, *, session="one"):
    path = directory / f"session_{session}.json"
    path.write_text(json.dumps({"session": session, "be": {
        "meeting_id": ids[-1], "replaced": ids[:-1],
    }}), encoding="utf-8")
    return path


@pytest.fixture
def old_chain(mdb, mseed, tmp_path, monkeypatch):
    monkeypatch.delenv("MEETING_DELETION_ENABLED", raising=False)
    old = meeting(mdb, mseed["ws"], status="failed")
    current = meeting(mdb, mseed["ws"])
    manifest(tmp_path, [old.meeting_id, current.meeting_id])
    return tmp_path, old, current


def test_dry_run_and_atomic_idempotent_apply_preserve_work(mdb, mseed, old_chain):
    directory, old, current = old_chain
    original = [(row.title, row.status, row.started_at) for row in [old, current]]
    tasks = [(row.task_id, row.title, row.version) for row in mseed["tasks"]]
    before = {path.name: path.read_bytes() for path in directory.iterdir()}
    dry = cli.reconcile(mdb, directory)
    assert dry["mode"] == "dry-run" and dry["changed_count"] == 2
    assert old.deletion_ready is False and current.recording_root_id is None
    with pytest.raises(cli.ReconciliationError, match="writers-stopped"):
        cli.reconcile(mdb, directory, apply=True)
    result = cli.reconcile(mdb, directory, apply=True, writers_stopped=True)
    assert result["changed_count"] == 2
    assert old.deletion_ready is True and old.recording_root_id is None
    assert current.deletion_ready is True
    assert current.recording_root_id == old.meeting_id and current.replaces_meeting_id == old.meeting_id
    assert cli.reconcile(mdb, directory, apply=True, writers_stopped=True)["changed_count"] == 0
    assert [(row.title, row.status, row.started_at) for row in [old, current]] == original
    assert [(row.task_id, row.title, row.version) for row in mseed["tasks"]] == tasks
    assert {path.name: path.read_bytes() for path in directory.iterdir()} == before


def test_missing_legacy_manifest_blocks_all_readiness(mdb, mseed, old_chain):
    directory, old, current = old_chain
    missing = meeting(mdb, mseed["ws"], status="failed")
    with pytest.raises(cli.ReconciliationError, match="unaccounted"):
        cli.reconcile(mdb, directory, apply=True, writers_stopped=True)
    assert all(not row.deletion_ready for row in [old, current, missing])
    assert current.recording_root_id is None


@pytest.mark.parametrize("problem", ["workspace", "source", "status", "existing_root", "existing_predecessor"])
def test_invalid_graph_is_rejected_without_partial_updates(mdb, mseed, old_chain, problem):
    directory, old, current = old_chain
    other = meeting(mdb, mseed["ws"], ready=True)
    if problem == "workspace":
        workspace = Workspace(name="other")
        mdb.add(workspace)
        mdb.flush()
        current.workspace_id = workspace.workspace_id
    elif problem == "source":
        current.source = "chat"
    elif problem == "status":
        old.status = "done"
    elif problem == "existing_root":
        current.recording_root_id = other.meeting_id
    else:
        current.replaces_meeting_id = other.meeting_id
    mdb.commit()
    with pytest.raises(cli.ReconciliationError):
        cli.reconcile(mdb, directory, apply=True, writers_stopped=True)
    assert old.deletion_ready is False and current.deletion_ready is False


@pytest.mark.parametrize("problem", ["unknown_id", "cycle", "fork", "idless", "corrupt", "temporary", "session", "replaced_type"])
def test_bad_inventory_fails_closed(mdb, old_chain, problem):
    directory, old, current = old_chain
    path = directory / "session_one.json"
    if problem == "unknown_id":
        manifest(directory, [old.meeting_id, "missing-id"])
    elif problem == "cycle":
        manifest(directory, [old.meeting_id, current.meeting_id, old.meeting_id])
    elif problem == "fork":
        manifest(directory, [old.meeting_id], session="two")
    elif problem == "idless":
        path.write_text(json.dumps({"session": "one", "be": {}}), encoding="utf-8")
    elif problem == "corrupt":
        path.write_text("{", encoding="utf-8")
    elif problem == "temporary":
        (directory / "session_two.json.tmp").write_text("{}", encoding="utf-8")
    elif problem == "session":
        path.write_text(json.dumps({"session": "different", "be": {"meeting_id": current.meeting_id}}), encoding="utf-8")
    else:
        path.write_text(json.dumps({"session": "one", "be": {"meeting_id": current.meeting_id, "replaced": "invalid"}}), encoding="utf-8")
    with pytest.raises(cli.ReconciliationError):
        cli.reconcile(mdb, directory, apply=True, writers_stopped=True)
    assert old.deletion_ready is False and current.deletion_ready is False


def test_gate_must_be_disabled_for_reconciliation(mdb, old_chain, monkeypatch):
    directory, old, _ = old_chain
    monkeypatch.setenv("MEETING_DELETION_ENABLED", "true")
    with pytest.raises(cli.ReconciliationError, match="disable"):
        cli.reconcile(mdb, directory, apply=True, writers_stopped=True)
    assert old.deletion_ready is False


def test_changed_inventory_prevents_apply(mdb, old_chain, monkeypatch):
    directory, old, current = old_chain
    original = cli._inventory
    calls = 0

    def changed(path):
        nonlocal calls
        calls += 1
        if calls == 2:
            manifest(directory, [current.meeting_id])
        return original(path)

    monkeypatch.setattr(cli, "_inventory", changed)
    with pytest.raises(cli.ReconciliationError, match="changed"):
        cli.reconcile(mdb, directory, apply=True, writers_stopped=True)
    assert old.deletion_ready is False and current.recording_root_id is None


def test_new_versioned_meetings_need_no_legacy_manifest(mdb, mseed, tmp_path, monkeypatch):
    monkeypatch.delenv("MEETING_DELETION_ENABLED", raising=False)
    ready = meeting(mdb, mseed["ws"], ready=True)
    assert cli.reconcile(mdb, tmp_path, apply=True, writers_stopped=True)["changed_count"] == 0
    assert ready.deletion_ready is True


def test_missing_existing_child_blocks_reconciliation(mdb, mseed, old_chain):
    directory, old, current = old_chain
    hidden = meeting(mdb, mseed["ws"], ready=True)
    hidden.replaces_meeting_id = old.meeting_id
    mdb.commit()
    with pytest.raises(cli.ReconciliationError, match="child absent"):
        cli.reconcile(mdb, directory, apply=True, writers_stopped=True)
    assert old.deletion_ready is False and current.deletion_ready is False


def test_cli_default_is_dry_run_without_changing_files(mdb, old_chain, monkeypatch, capsys):
    from sqlalchemy.orm import Session
    directory, old, _ = old_chain
    monkeypatch.setattr(cli, "SessionLocal", lambda: Session(mdb.bind, autoflush=False))
    monkeypatch.setattr("sys.argv", ["reconcile_meeting_lineages", "--recordings-dir", str(directory)])
    assert cli.main() == 0
    assert json.loads(capsys.readouterr().out)["mode"] == "dry-run"
    mdb.refresh(old)
    assert old.deletion_ready is False
