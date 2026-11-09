import argparse
import hashlib
import json
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.models import Meeting
from app.services.meeting_deletion import enabled


class ReconciliationError(ValueError):
    pass


def _identifier(value: object) -> str:
    if not isinstance(value, str) or not value or len(value) > 36 or value.strip() != value:
        raise ReconciliationError("manifest contains an invalid meeting ID")
    return value


def _inventory(directory: Path) -> tuple[list[list[str]], dict[str, str]]:
    if not directory.is_dir() or directory.is_symlink() or directory.is_junction():
        raise ReconciliationError("recordings directory must be an existing local directory")
    if list(directory.glob("session_*.json.tmp")):
        raise ReconciliationError("temporary manifests must be resolved before reconciliation")
    chains = []
    fingerprints = {}
    seen = set()
    for path in sorted(directory.glob("session_*.json")):
        if path.is_symlink() or path.is_junction() or not path.is_file():
            raise ReconciliationError("manifest must be a regular local file")
        raw = path.read_bytes()
        try:
            manifest = json.loads(raw)
        except (ValueError, UnicodeError) as error:
            raise ReconciliationError("manifest is not readable JSON") from error
        if not isinstance(manifest, dict):
            raise ReconciliationError("manifest must be an object")
        session = manifest.get("session")
        if not isinstance(session, str) or path.name != f"session_{session}.json":
            raise ReconciliationError("manifest session does not match its filename")
        be = manifest.get("be")
        if not isinstance(be, dict) or not be.get("meeting_id"):
            raise ReconciliationError("manifest has no persisted backend meeting ID")
        replaced = be.get("replaced", [])
        if not isinstance(replaced, list):
            raise ReconciliationError("manifest replaced history must be an array")
        chain = [_identifier(mid) for mid in [*replaced, be["meeting_id"]]]
        if len(set(chain)) != len(chain):
            raise ReconciliationError("manifest lineage contains a cycle or duplicate ID")
        if seen.intersection(chain):
            raise ReconciliationError("multiple manifests claim the same meeting ID")
        seen.update(chain)
        chains.append(chain)
        fingerprints[path.name] = hashlib.sha256(raw).hexdigest()
    return chains, fingerprints


def _plan(rows: list[Meeting], chains: list[list[str]]) -> list[dict]:
    by_id = {row.meeting_id: row for row in rows}
    covered = {mid for chain in chains for mid in chain}
    unknown = sorted(
        row.meeting_id for row in rows
        if row.source == "discord" and row.deleted_at is None
        and not row.deletion_ready and row.meeting_id not in covered
    )
    if unknown:
        raise ReconciliationError(f"unaccounted legacy Discord meetings: {', '.join(unknown)}")
    changes = []
    for chain in chains:
        if any(mid not in by_id for mid in chain):
            raise ReconciliationError("manifest refers to a meeting absent from the database")
        members = [by_id[mid] for mid in chain]
        first = members[0]
        if any(row.deleted_at is not None for row in members):
            raise ReconciliationError("deleted meeting content must be purged before reconciliation")
        if any(row.workspace_id != first.workspace_id or row.source != first.source for row in members):
            raise ReconciliationError("lineage crosses workspace or source boundaries")
        if first.source != "discord":
            if len(members) != 1:
                raise ReconciliationError("only Discord recordings may have replacement history")
            continue
        if any(row.status != "failed" for row in members[:-1]):
            raise ReconciliationError("every predecessor must have failed before replacement")
        if any(
            row.meeting_id not in chain
            and (row.recording_root_id == first.meeting_id or row.replaces_meeting_id in chain)
            for row in rows
        ):
            raise ReconciliationError("database lineage contains a child absent from its manifest")
        for index, row in enumerate(members):
            root = first.meeting_id if index else None
            predecessor = members[index - 1].meeting_id if index else None
            if row.recording_root_id not in (None, root) or row.replaces_meeting_id not in (None, predecessor):
                raise ReconciliationError("manifest lineage conflicts with existing database links")
            if (row.recording_root_id, row.replaces_meeting_id, row.deletion_ready) != (root, predecessor, True):
                changes.append({
                    "meeting_id": row.meeting_id,
                    "recording_root_id": root,
                    "replaces_meeting_id": predecessor,
                    "deletion_ready": True,
                })
    return sorted(changes, key=lambda change: change["meeting_id"])


def reconcile(
    db: Session, recordings_dir: Path, *, apply: bool = False, writers_stopped: bool = False
) -> dict:
    if enabled():
        raise ReconciliationError("disable MEETING_DELETION_ENABLED before reconciliation")
    if apply and not writers_stopped:
        raise ReconciliationError("--apply requires --writers-stopped after stopping AI writers")
    chains, fingerprints = _inventory(recordings_dir)
    rows = db.scalars(select(Meeting).order_by(Meeting.meeting_id)).all()
    changes = _plan(rows, chains)
    if apply:
        roots = {row.recording_root_id or row.meeting_id for row in rows}
        db.scalars(
            select(Meeting).where(Meeting.meeting_id.in_(roots)).order_by(Meeting.meeting_id)
            .with_for_update().execution_options(populate_existing=True)
        ).all()
        rows = db.scalars(
            select(Meeting).order_by(Meeting.meeting_id).with_for_update()
            .execution_options(populate_existing=True)
        ).all()
        _, current = _inventory(recordings_dir)
        if current != fingerprints:
            raise ReconciliationError("manifest inventory changed during reconciliation")
        changes = _plan(rows, chains)
        by_id = {row.meeting_id: row for row in rows}
        for change in changes:
            row = by_id[change["meeting_id"]]
            row.recording_root_id = change["recording_root_id"]
            row.replaces_meeting_id = change["replaces_meeting_id"]
            row.deletion_ready = True
        db.commit()
    return {"mode": "apply" if apply else "dry-run", "changed_count": len(changes), "changes": changes}


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate existing recording lineages before enabling meeting deletion")
    parser.add_argument("--recordings-dir", type=Path, required=True)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--writers-stopped", action="store_true")
    args = parser.parse_args()
    with SessionLocal() as db:
        try:
            result = reconcile(db, args.recordings_dir, apply=args.apply, writers_stopped=args.writers_stopped)
        except (ReconciliationError, OSError) as error:
            db.rollback()
            print(json.dumps({"error": str(error)}))
            return 1
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
