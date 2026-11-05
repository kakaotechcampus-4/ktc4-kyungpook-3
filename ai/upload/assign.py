"""PM 이 화자 지정을 끝낸 업로드 회의를 BE 에서 받아 diarized 매니페스트를 mapped 로 바꾼다.

워커가 바퀴 끝에서 assign_one → report_one(upload.report) → intake_one 순서로 한 번씩 부른다. BE 는 라벨 보고를 받은 회의만 지정받게 하므로
보고는 이 지정 받기 앞 단계다. 한 호출은 한 건을 한 번 진전시키고 돌아온다.
BE 의 GET /uploads/assigned 는 resume 하지 않은 건만 주므로, resume 직전에 로컬 기록을 남겨 두고 응답을 잃거나 죽어도
기록을 보고 다시 resume 한다(resume 은 멱등: processing 이면 같은 mapping 으로 200).

기록은 recordings/.uploads/<meeting_id>/intake.json 의 `resume` 키다. intake 의 state 와 상태 기계는 건드리지 않는다.
  resuming  resume 을 보내기 전에 적는다. resume·apply 가 끝나지 않았다. 일시 실패는 attempts, next_at 만 바꾼다
            (포기 한도 없음: 멱등이고 ENDED·BE sweeper 가 끝낸다)
  mapped    resume 응답의 mapping 을 매니페스트에 썼다(끝)
  ended     BE 가 이미 끝낸 회의다(409 ENDED·404). 로컬 매니페스트·트랙·잠금을 지웠고 fail 은 보내지 않는다(끝)
  failing   지정을 쓸 수 없어(라벨 불일치 등) 로컬을 지우고 fail(diarize)을 보내는 중이다. 보내지 못하면 다음에 다시
  failed    fail 을 보냈다(끝)
resuming -> mapped | ended | failing -> failed.

한 호출의 순서: 때가 된 resuming·failing 기록 먼저 → 없으면 assigned 첫 항목 중 로컬 매니페스트가 있는 것을
resuming 으로 적고 이어 간다. 로컬 매니페스트가 없는 항목은 resume 하지 않고 건너뛴다(로그는 실행 동안 회의마다 한 번).
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta
from pathlib import Path
from typing import Callable

from capture.handoff import BeError
from capture.recorder import _iso, backoff_s, drop_local, manifest_path, utcnow
from upload.intake import FAILED_STAGE, Progress, _cleanup, _dir, _due, _load, _save
from upload.mapping import MappingBusy, apply_mapping

log = logging.getLogger(__name__)

_OPEN = ("resuming", "failing")
_skip_logged: set[str] = set()   # 실행 동안 로그를 한 번만 남길 회의
_list_failing = False            # assigned 목록 조회가 실패하는 중이면 True. 장애마다 한 번만 로그를 남긴다


def _is_gone(e: Exception) -> bool:
    """BE 가 "그 회의가 없다"고 답했다. 오류 봉투의 MEETING_NOT_FOUND 만 그렇게 본다.
    봉투 없는 404(잘못된 경로, 프록시, BE 배포 중)는 회의가 사라진 것이 아니라 일시 실패이고, 로컬 파일은 되돌릴 수 없다."""
    return isinstance(e, BeError) and e.code == "MEETING_NOT_FOUND"


def _pending(recordings_dir: Path, t: datetime):
    root = recordings_dir / ".uploads"
    for d in sorted(root.iterdir()) if root.exists() else ():
        rec = _load(d) if d.is_dir() else None
        r = rec.get("resume") if rec else None
        if isinstance(r, dict) and r.get("state") in _OPEN and _due(r, t):
            return d, rec
    return None


def assign_one(recordings_dir: Path, *, client, now: Callable[[], datetime] = utcnow) -> Progress | None:
    """한 건을 한 번 진전시킨다. 할 일이 없으면 None. 예외는 올리지 않는다(실패는 기록하고 Progress.event 로 알린다).

    event: mapped | waiting | retry | ended | failed | fail_pending"""
    recordings_dir = Path(recordings_dir)
    found = _pending(recordings_dir, now())
    if found:
        return _advance(recordings_dir, *found, client=client, now=now)
    global _list_failing
    try:
        items = client.assigned_uploads()
    except Exception as e:  # noqa: BLE001 - BE 가 안 되면 다음 바퀴에 다시 본다
        if not _list_failing:   # 경로 설정이 틀려도 흔적이 남게, 같은 장애는 한 번만
            log.warning("지정이 끝난 업로드 목록(assigned)을 못 가져왔다: %s: %s", type(e).__name__, e)
            _list_failing = True
        return None
    _list_failing = False
    for item in items:
        mid = str(item.get("meeting_id") or "") if isinstance(item, dict) else ""
        if not mid:
            continue
        d = _dir(recordings_dir, mid)
        rec = _load(d)
        if rec is not None and "resume" in rec:   # 기록이 있다: 이어 가는 일은 위에서 한다(기다리는 중이거나 끝났다)
            continue
        if rec is not None and rec.get("state") != "done":   # 매니페스트를 쓴 뒤 done 저장 전에 죽었을 수 있다: intake 가 끝낸 뒤에 본다
            continue
        if rec is None or not manifest_path(recordings_dir, f"upload_{mid}").exists():
            if mid not in _skip_logged:
                _skip_logged.add(mid)
                log.warning("지정이 끝난 업로드 %s 의 로컬 매니페스트·가져오기 기록이 없어 resume 하지 않고 건너뛴다", mid)
            continue
        rec["resume"] = {"state": "resuming", "attempts": 0, "next_at": None, "error": None}
        _save(d, rec)   # resume 을 보내기 전에 적는다: 응답을 잃거나 죽어도 다시 resume 한다
        return _advance(recordings_dir, d, rec, client=client, now=now)
    return None


def _advance(recordings_dir: Path, d: Path, rec: dict, *, client, now) -> Progress:
    mid, r = rec["meeting_id"], rec["resume"]
    if r["state"] == "failing":
        return _report_fail(recordings_dir, d, rec, client, now())
    try:
        data = client.resume_upload(mid)
    except BeError as e:
        if e.code == "SPEAKERS_NOT_ASSIGNED":   # 지정이 아직이다: 매니페스트 그대로 두고 다음에
            return _later(d, rec, now(), f"{e.code}: {e}", "waiting")
        if e.code == "MEETING_ALREADY_ENDED" or _is_gone(e):
            drop_local(recordings_dir, f"upload_{mid}")
            return _finish(d, rec, "ended", f"{e.code}: {e}")
        return _later(d, rec, now(), f"{type(e).__name__}: {e}", "retry")
    except Exception as e:  # noqa: BLE001 - 연결 오류 등: 응답을 잃었을 수 있으니 같은 resume 을 다시 보낸다
        return _later(d, rec, now(), f"{type(e).__name__}: {e}", "retry")
    try:
        apply_mapping(manifest_path(recordings_dir, f"upload_{mid}"), data["mapping"])
    except MappingBusy as e:   # 다른 프로세스가 매니페스트를 쥐고 있다
        return _later(d, rec, now(), f"{type(e).__name__}: {e}", "retry")
    except ValueError as e:    # 라벨 불일치·status 가 맞지 않음 등: 다시 해도 같다
        drop_local(recordings_dir, f"upload_{mid}")
        r.update(state="failing", error=str(e), next_at=None)
        _save(d, rec)
        return _report_fail(recordings_dir, d, rec, client, now())
    except OSError as e:
        return _later(d, rec, now(), f"{type(e).__name__}: {e}", "retry")
    return _finish(d, rec, "mapped", None)


def _finish(d: Path, rec: dict, state: str, error: str | None) -> Progress:
    rec["resume"].update(state=state, next_at=None, error=error)
    _save(d, rec)
    return Progress(rec["meeting_id"], state)


def _later(d: Path, rec: dict, t: datetime, error: str, event: str) -> Progress:
    r = rec["resume"]
    r["attempts"] = r.get("attempts", 0) + 1
    r["error"] = error
    r["next_at"] = _iso(t + timedelta(seconds=backoff_s(r["attempts"])))
    _save(d, rec)
    return Progress(rec["meeting_id"], event)


def _report_fail(recordings_dir: Path, d: Path, rec: dict, client, t: datetime) -> Progress:
    """fail(diarize)을 보낸다. 409 ENDED 는 BeClient 가 성공으로 돌려주고, 404 는 보낼 곳이 없으니 끝난 것으로 본다.
    보내지 못하면 failing 으로 두고 backoff 뒤에 다시 보낸다."""
    mid = rec["meeting_id"]
    try:
        client.fail_meeting(mid, FAILED_STAGE)
    except Exception as e:  # noqa: BLE001
        if not _is_gone(e):
            return _later(d, rec, t, f"fail 보고 실패: {type(e).__name__}: {e}", "fail_pending")
    _cleanup(d)
    return _finish(d, rec, "failed", rec["resume"].get("error"))
