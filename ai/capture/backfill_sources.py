"""인계까지 끝났는데 발화 저장 기록이 없는 회의에 발화를 한 번 보낸다(#146 전에 끝난 회의).

    python -m capture.backfill_sources --dry-run    # ai/ 안에서. 대상만 본다
    python -m capture.backfill_sources              # 보낸다. --recordings, --transcripts 로 위치를 바꿀 수 있다

복구(recover_pass)는 인계까지 끝난 회의를 다시 집지 않아서 새로 생긴 회의록 저장 단계가 그 회의에는 돌지 않는다.
BE 는 done 회의의 발화도 받고 같은 seq 는 건너뛰므로 두 번 돌려도 쌓이지 않는다. 봇·워커와는 회의 잠금으로 갈린다.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from capture import recorder as R
from capture.handoff import from_env as handoff_from_env
from shared.config import RECORDINGS_DIR, TRANSCRIPTS_DIR
from shared.schemas import now_iso


def _needs_sources(m: dict | None) -> bool:
    return bool(m) and m.get("status") == R.STATUS_HANDED_OFF and R.STATUS_SOURCED not in (m.get("stages") or {}) \
        and bool((m.get("be") or {}).get("meeting_id"))


def targets(recordings_dir: Path) -> list[tuple[Path, dict]]:
    """인계까지 끝났고(handed_off) 발화 저장 기록이 없으며 BE 회의가 있는 회의 [(매니페스트 경로, 매니페스트)]."""
    found = []
    for p in sorted(recordings_dir.glob("session_*.json")):
        m = R._load(p)
        if _needs_sources(m):
            found.append((p, m))
    return found


def backfill(recordings_dir: Path, *, transcripts_dir: Path, handoff, dry_run: bool = False) -> list[dict]:
    """대상마다 {session, sent, busy, error, sources}. 보낸 회의는 stages 에 sourced 를 남기고 상태는 그대로 둔다."""
    claims = R.Claims()
    rows = []
    for path, m in targets(recordings_dir):
        row = {"session": m.get("session"), "sent": False, "busy": False, "error": None, "sources": None}
        rows.append(row)
        if dry_run:
            continue
        held = claims.acquire(path)
        if held is None:
            row["busy"] = True                  # 봇이나 워커가 처리 중이다. 다음에 다시 돌리면 된다
            continue
        try:
            if not _needs_sources(held):        # 잡는 사이 남이 보냈다
                continue
            be = handoff.save_sources(held, transcripts_dir=transcripts_dir, title=R.meeting_title(held))
            held.setdefault("stages", {})[R.STATUS_SOURCED] = now_iso()
            row.update(sent=True, sources=dict(be["sources"]))
        except Exception as e:  # noqa: BLE001 - 한 회의의 실패로 나머지를 멈추지 않는다
            row["error"] = f"{type(e).__name__}: {e}"
        finally:
            claims.release(path, held)          # 표시를 지우며 매니페스트를 저장한다
    return rows


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="인계가 끝났는데 발화 저장이 없는 회의에 발화를 한 번 보낸다")
    ap.add_argument("--recordings", default=str(RECORDINGS_DIR))
    ap.add_argument("--transcripts", default=str(TRANSCRIPTS_DIR))
    ap.add_argument("--dry-run", action="store_true", help="대상만 보고 보내지 않는다")
    a = ap.parse_args(argv)
    handoff = handoff_from_env()
    if not R.saves_sources(handoff):
        print("BE_BASE_URL, BE_WORKSPACE_ID, BE_SERVICE_TOKEN 이 다 있어야 보낼 수 있다", file=sys.stderr)
        return 1
    rows = backfill(Path(a.recordings), transcripts_dir=Path(a.transcripts), handoff=handoff, dry_run=a.dry_run)
    for r in rows:
        if a.dry_run:
            print(f"{r['session']}: 대상")
        elif r["sent"]:
            s = r["sources"]
            print(f"{r['session']}: 보냄 (새로 {s['inserted']}줄, 이미 있던 {s['skipped']}줄)")
        elif r["busy"]:
            print(f"{r['session']}: 처리 중이라 건너뜀")
        elif r["error"]:
            print(f"{r['session']}: 실패 {r['error']}")
    print(f"대상 {len(rows)}개")
    return 1 if any(r["error"] for r in rows) else 0


if __name__ == "__main__":
    raise SystemExit(main())
