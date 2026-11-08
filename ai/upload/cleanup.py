"""지정 결과가 오지 않는 업로드의 로컬 정리(#325). 워커가 assign_one → report_one → intake_one 뒤에 한 번씩 부른다.

기록은 recordings/.uploads/<meeting_id>/intake.json 의 `expire` 키다. intake·report·resume 의 상태 기계는 건드리지 않는다.
  checking  BE 에 다시 물어보는 중이다. 일시 실패는 attempts, next_at 만 바꾼다(포기 한도 없음: 지우지 않으니 해로울 것이 없다)
  expired   BE 가 이미 끝낸 회의다(409 MEETING_ALREADY_ENDED·오류 봉투의 404). 매니페스트·트랙·잠금·전사본을 지웠다(끝)
  tracks_dropped  인계가 끝나 KEEP_S 가 지나 트랙 wav 만 지웠다(회의 폴더의 대본·기록, 매니페스트·전사본 유지, 다시 보지 않는다).
                  트랙은 recorder.prune_audio 가 인계 직후 이미 지우므로(0055) 보통은 표시만 남긴다
  dropped         처리를 포기한 지 KEEP_S 가 지나 매니페스트·트랙·전사본을 지웠다
끝난 기록 폴더(.uploads/<id>/)는 열린 상태가 없고 이 회의의 매니페스트가 없을 때 intake.json 수정 시각 + KEEP_S 뒤 통째로 지운다. 깨진 intake.json 은 지우지 않고 한 번만 경고한다.

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
import shutil
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Callable

from capture.handoff import BeError
from capture.recorder import _iso, backoff_s, drop_local, drop_transcripts, is_locked, manifest_path, utcnow
from upload.assign import _is_gone
from upload.intake import Progress, _due, _load, _save

log = logging.getLogger(__name__)

EXPIRE_AFTER_S = 7 * 86400 + 3600   # BE SPEAKER_ASSIGNMENT_TTL_SECONDS(7일)에 한 시간을 더한다: BE sweeper 가 먼저 닫을 틈
LOCKED_RETRY_S = 60.0               # 재전송 사이에 잠금이 생기면 이만큼 뒤에 다시 본다
KEEP_S = 7 * 86400                  # 처리 포기·인계 완료 뒤, 끝난 기록 폴더를 이만큼 두었다가 지운다
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
    try:
        dirs = sorted(root.iterdir()) if root.exists() else []
    except OSError as e:
        log.warning("업로드 가져오기 기록 폴더를 읽지 못했다(다음에 다시 한다): %s", e)
        return None
    for d in dirs:
        rec = _load(d) if d.is_dir() else None
        if rec is None or not _candidate(rec, t):
            continue
        m = manifest_path(recordings_dir, f"upload_{rec['meeting_id']}")
        if m.exists() and is_locked(m):   # 처리 중인 프로세스가 있다: BE 를 부르지 않고 건너뛰어 뒤 후보를 막지 않는다
            locked = locked or Progress(rec["meeting_id"], "locked")
            continue
        return _probe(recordings_dir, transcripts_dir, d, rec, client, t)
    for d in dirs:
        if not d.is_dir():
            continue
        rec = _load(d)
        if rec is None:
            _warn_broken(d)
            continue
        step = _keep_expired(recordings_dir, transcripts_dir, d, rec, t) or _remove_record(recordings_dir, d, rec, t)
        if step is not None:
            return step
    return locked


_warned: set[str] = set()


def _warn_broken(d: Path) -> None:
    if not (d / "intake.json").exists() or str(d) in _warned:
        return
    _warned.add(str(d))
    log.warning("업로드 가져오기 기록 %s 이 깨졌다: 지우지 않고 그대로 둔다", d)


def _at(value) -> datetime | None:
    try:
        t = datetime.fromisoformat(value or "")
    except (ValueError, TypeError):
        return None
    return t if t.tzinfo is not None else None


def _keep_expired(recordings_dir: Path, transcripts_dir: Path, d: Path, rec: dict, t: datetime) -> Progress | None:
    """매니페스트로 판정하는 정리: 처리 포기(KEEP_S 뒤 전부) · 인계 완료(KEEP_S 뒤 트랙만). BE 는 부르지 않는다."""
    mid = rec["meeting_id"]
    session = f"upload_{mid}"
    m = manifest_path(recordings_dir, session)
    try:
        manifest = json.loads(m.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if not isinstance(manifest, dict) or manifest.get("source") != "upload":
        return None
    be_status = (manifest.get("be") or {}).get("status") if isinstance(manifest.get("be"), dict) else None
    ex = rec.get("expire")
    state = ex.get("state") if isinstance(ex, dict) else None
    if be_status == "failed":
        rc = manifest.get("recovery")
        since = _at(rc.get("gave_up_at")) if isinstance(rc, dict) else None
        event = "dropped"
    elif manifest.get("status") == "handed_off" and be_status == "done" and state != "tracks_dropped":
        st = manifest.get("stages")
        since = _at(st.get("handed_off")) if isinstance(st, dict) else None
        event = "tracks_dropped"
    else:
        return None
    if since is None or t < since + timedelta(seconds=KEEP_S) or is_locked(m):
        return None
    manifest.setdefault("session", session)
    new = dict(ex) if isinstance(ex, dict) else {}
    try:
        if event == "dropped":
            drop_transcripts(transcripts_dir, manifest)   # 매니페스트가 남아 있는 동안 먼저
            drop_local(recordings_dir, session)
        else:
            # 트랙 wav 만 지운다. 같은 회의 폴더의 대본(transcript.md·jsonl)·처리 기록·diarization.json,
            # 매니페스트·전사본·intake.json 은 남긴다(#439 리뷰). 이미 없어도 표시는 남긴다
            for e in manifest.get("speakers") or []:
                if isinstance(e, dict) and e.get("file"):
                    (recordings_dir / e["file"]).unlink(missing_ok=True)
        new.update(state=event, next_at=None)
        rec["expire"] = new
        _save(d, rec)
    except OSError as e:
        log.warning("업로드 %s 정리 실패(다음에 다시 한다): %s", mid, e)
        return None
    log.info("업로드 %s: %s", mid, event)
    return Progress(mid, event)


_OPEN_REPORT = ("reporting", "failing")
_OPEN_RESUME = ("resuming", "failing")


def _finished(rec: dict) -> bool:
    """더 진행할 것이 없는 기록인가. 열린 상태(fail_pending·report·resume·expire)가 하나라도 있으면 False."""
    if rec.get("fail_pending"):
        return False
    r, u, x = rec.get("report"), rec.get("resume"), rec.get("expire")
    rs = r.get("state") if isinstance(r, dict) else None
    us = u.get("state") if isinstance(u, dict) else None
    xs = x.get("state") if isinstance(x, dict) else None
    if rs in _OPEN_REPORT or us in _OPEN_RESUME or (xs == "checking" and "resume" not in rec):
        return False   # resume 이 있으면 지정이 끝난 것: checking 은 더 돌지 않으니 열린 상태가 아니다
    return rec.get("state") in ("failed", "done")   # done 은 위의 열린 상태가 없고 호출한 쪽이 매니페스트 없음을 확인한다


def _remove_record(recordings_dir: Path, d: Path, rec: dict, t: datetime) -> Progress | None:
    """끝난 기록 폴더(.uploads/<id>/)를 통째로 지운다. 이 회의의 매니페스트가 남아 있으면 지우지 않는다."""
    mid = rec["meeting_id"]
    if not _finished(rec) or manifest_path(recordings_dir, f"upload_{mid}").exists():
        return None
    try:
        at = datetime.fromtimestamp((d / "intake.json").stat().st_mtime, timezone.utc)
    except OSError:
        return None
    if t < at + timedelta(seconds=KEEP_S):
        return None
    try:
        shutil.rmtree(d)
    except OSError as e:
        log.warning("업로드 %s 의 기록 폴더를 지우지 못했다(다음에 다시 한다): %s", mid, e)
        return None
    log.info("업로드 %s: 끝난 기록 폴더를 지웠다", mid)
    return Progress(mid, "record_removed")


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
    _try_save(d, rec)
    return Progress(mid, "still_waiting")


def _expire(recordings_dir: Path, transcripts_dir: Path, d: Path, rec: dict, why: str, t: datetime) -> Progress:
    mid = rec["meeting_id"]
    session = f"upload_{mid}"
    m = manifest_path(recordings_dir, session)
    if is_locked(m):   # 재전송하는 사이에 잠겼다: 지우지 않고 잠시 뒤에 다시 본다
        rec["expire"]["next_at"] = _iso(t + timedelta(seconds=LOCKED_RETRY_S))
        _try_save(d, rec)
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


def _try_save(d: Path, rec: dict) -> None:
    try:
        _save(d, rec)
    except OSError as e:   # 기록을 못 쓴다: 다음 바퀴에 같은 일을 다시 한다
        log.warning("업로드 %s 의 expire 기록을 쓰지 못했다: %s", rec["meeting_id"], e)


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
