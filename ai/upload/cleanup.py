"""지정 결과가 오지 않는 업로드의 로컬 정리(#325). 워커가 assign_one → report_one → intake_one 뒤에 한 번씩 부른다.

기록은 recordings/.uploads/<meeting_id>/intake.json 의 `expire` 키다. intake·report·resume 의 상태 기계는 건드리지 않는다.
  checking  BE 에 다시 물어보는 중이다. 일시 실패는 attempts, next_at 만 바꾼다(포기 한도 없음: 지우지 않으니 해로울 것이 없다)
  expired   BE 가 이미 끝낸 회의다(409 MEETING_ALREADY_ENDED·오류 봉투의 404). 매니페스트·트랙·잠금·전사본을 지웠다(끝)
  tracks_dropped, dropped 는 이후 단계(인계 뒤 트랙 정리, 처리 포기 정리)가 쓴다.

지정 만료 후보: 가져오기가 done 이고 라벨을 reported 했고 resume 키가 없고, 보고한 지 EXPIRE_AFTER_S 가 지난 업로드.
후보는 기록해 둔 report 본문을 그대로 다시 보내 BE 의 답으로 판정한다. BE 는 같은 내용 재전송에 200(현재 status)을 주고,
끝난 회의면 409 ENDED, 없으면 404 를 준다. 로컬 시계만 믿고 지우지 않는 까닭은 PM 이 늦게 지정할 수 있기 때문이다(결정 기록 0044).
200 이면 지우지 않고 PROBE_EVERY_S 뒤에 다시 묻는다. 그 밖의 실패(NETWORK·5xx·UPLOAD_NOT_CLAIMED·다른 라벨 409·400·봉투 없는 404)는
일시 실패로 backoff 하고, 어느 경우도 BE 에 fail 을 보내지 않는다. 잠금이 걸린 회의는 BE 를 부르지 않고 건너뛰어 뒤 후보를 먼저 본다(후보가 모두 잠겼을 때만 locked). 재전송 사이에 잠기면 1분 뒤에 다시 본다.
회의 녹음 쪽 매니페스트와 intake.json 이 없는 업로드(CLI)는 읽지도 지우지도 않는다.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta
from pathlib import Path
from typing import Callable

from capture.handoff import BeError
from capture.recorder import _iso, backoff_s, drop_local, drop_transcripts, is_locked, manifest_path, utcnow
from upload.assign import _is_gone
from upload.intake import Progress, _due, _load, _save

log = logging.getLogger(__name__)

EXPIRE_AFTER_S = 7 * 86400 + 3600   # BE SPEAKER_ASSIGNMENT_TTL_SECONDS(7일)에 한 시간을 더한다: BE sweeper 가 먼저 닫을 틈
LOCKED_RETRY_S = 60.0               # 재전송 사이에 잠금이 생기면 이만큼 뒤에 다시 본다
PROBE_EVERY_S = 3600.0              # BE 가 아직 지정을 기다린다고 답하면 이 간격으로만 다시 묻는다


def _reported_at(rec: dict) -> datetime | None:
    try:
        t = datetime.fromisoformat((rec.get("report") or {}).get("reported_at") or "")
    except (ValueError, TypeError, AttributeError):
        return None
    return t if t.tzinfo is not None else None


def _candidate(rec: dict, now: datetime) -> bool:
    r = rec.get("report")
    if rec.get("state") != "done" or not isinstance(r, dict) or r.get("state") != "reported" or "resume" in rec:
        return False
    if not isinstance(r.get("speakers"), list):
        return False
    ex = rec.get("expire")
    if ex is not None and (not isinstance(ex, dict) or ex.get("state") != "checking"):
        return False
    at = _reported_at(rec)
    if at is None or now < at + timedelta(seconds=EXPIRE_AFTER_S):
        return False
    return _due(ex, now) if ex else True


def cleanup_one(recordings_dir: Path, transcripts_dir: Path, *, client,
                now: Callable[[], datetime] = utcnow) -> Progress | None:
    """한 건을 한 번 진전시킨다. 할 일이 없으면 None. 예외는 올리지 않는다.

    event: expired | still_waiting | retry | locked | dropped | tracks_dropped | record_removed"""
    recordings_dir, transcripts_dir = Path(recordings_dir), Path(transcripts_dir)
    t = now()
    root = recordings_dir / ".uploads"
    locked = None
    for d in sorted(root.iterdir()) if root.exists() else ():
        rec = _load(d) if d.is_dir() else None
        if rec is None or not _candidate(rec, t):
            continue
        m = manifest_path(recordings_dir, f"upload_{rec['meeting_id']}")
        if m.exists() and is_locked(m):   # 처리 중인 프로세스가 있다: BE 를 부르지 않고 건너뛰어 뒤 후보를 막지 않는다
            locked = locked or Progress(rec["meeting_id"], "locked")
            continue
        return _probe(recordings_dir, transcripts_dir, d, rec, client, t)
    return locked


def _probe(recordings_dir: Path, transcripts_dir: Path, d: Path, rec: dict, client, t: datetime) -> Progress:
    mid = rec["meeting_id"]
    ex = rec.setdefault("expire", {"state": "checking", "attempts": 0})
    ex["checked_at"] = _iso(t)
    try:
        client.report_speakers(mid, rec["report"]["speakers"])
    except BeError as e:
        if e.code == "MEETING_ALREADY_ENDED" or _is_gone(e):
            return _expire(recordings_dir, transcripts_dir, d, rec, f"{e.code}: {e}", t)
        return _later(d, rec, t, f"{type(e).__name__}: {e}")
    except Exception as e:  # noqa: BLE001 - 연결 오류 등
        return _later(d, rec, t, f"{type(e).__name__}: {e}")
    ex.update(attempts=0, error=None, next_at=_iso(t + timedelta(seconds=PROBE_EVERY_S)))
    _save(d, rec)
    return Progress(mid, "still_waiting")


def _expire(recordings_dir: Path, transcripts_dir: Path, d: Path, rec: dict, why: str, t: datetime) -> Progress:
    mid = rec["meeting_id"]
    session = f"upload_{mid}"
    m = manifest_path(recordings_dir, session)
    if is_locked(m):   # 재전송하는 사이에 잠겼다: 지우지 않고 잠시 뒤에 다시 본다
        rec["expire"]["next_at"] = _iso(t + timedelta(seconds=LOCKED_RETRY_S))
        _save(d, rec)
        return Progress(mid, "locked")
    try:
        manifest = json.loads(m.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        manifest = {}
    if not isinstance(manifest, dict):
        manifest = {}
    manifest.setdefault("session", session)
    try:
        drop_transcripts(transcripts_dir, manifest)   # 매니페스트가 남아 있는 동안 먼저: 죽어도 다음에 같은 목록으로 다시 지운다
        drop_local(recordings_dir, session)
        rec["expire"].update(state="expired", next_at=None, error=why)
        _save(d, rec)
    except OSError as e:   # 파일을 못 지웠다·기록을 못 썼다: 다음에 같은 일을 다시 한다(지우기는 멱등)
        rec["expire"]["state"] = "checking"
        return _later(d, rec, t, f"{type(e).__name__}: {e}")
    log.info("업로드 %s: BE 가 이미 끝낸 회의라 로컬을 지웠다(%s)", mid, why)
    return Progress(mid, "expired")


def _later(d: Path, rec: dict, t: datetime, error: str) -> Progress:
    ex = rec["expire"]
    ex["attempts"] = ex.get("attempts", 0) + 1
    ex["error"] = error
    ex["next_at"] = _iso(t + timedelta(seconds=backoff_s(ex["attempts"])))
    try:
        _save(d, rec)
    except OSError:   # 기록도 못 쓴다: 다음 바퀴에 처음부터 다시 한다
        log.warning("업로드 %s 의 expire 기록을 쓰지 못했다", rec["meeting_id"])
    return Progress(rec["meeting_id"], "retry")
