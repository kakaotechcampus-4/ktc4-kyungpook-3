"""BE 에 올라온 웹 업로드 회의를 가져와 화자 분리하고 diarized 매니페스트로 만든다.

워커가 바퀴 끝에서 intake_one 을 한 번 부른다. 한 호출은 한 건을 한 단계만 진전시키고 바로 돌아온다(pyannoteAI 를
기다리지 않는다). 진행은 recordings/.uploads/<meeting_id>/intake.json 에 적어 재시작해도 이어 가며, 이미 낸 분리 작업(job_id)은
다시 제출하지 않는다(과금).

상태(state)와 전이:
  claiming   claim 요청을 보내기 전에 적는다. 응답을 놓쳐도 다음에 이 기록을 보고 이어 간다.
  claimed    BE 가 우리에게 넘겼다. 다음 단계: 원본 내려받기(size_bytes 비교) + 16k mono wav 변환
  converted  변환 wav 가 있다. 다음 단계: pyannoteAI 에 제출(job_id, submitted_at 기록)
  submitted  결과를 기다린다. 다음 단계: fetch 한 번. 끝났으면 트랙·매니페스트를 쓰고 원본·wav 를 지운다
  done       diarized 매니페스트가 있다(끝)
  failed     BE 에 fail(diarize)을 보냈다(끝)
claiming -> claimed -> converted -> submitted -> done. 일시 실패는 상태를 그대로 두고 attempts, next_at 만 바꾼다(결과 시간
초과·job 없음·분리 실패는 converted 로 돌아가 다시 제출한다). 영구 실패이거나 시도가 한도에 닿으면 fail_pending 을 적고
fail 을 보낸다. 보내지 못하면 fail_pending 이 남아 다음 호출이 다시 보낸다. 시도 한도와 대기는 복구와 같은 규칙이다
(capture.recorder.RECOVERY_MAX_ATTEMPTS, backoff_s).
"""

from __future__ import annotations

import json
import shutil
from datetime import datetime, timedelta
from pathlib import Path
from typing import Callable, NamedTuple

from capture.handoff import BeError
from capture.recorder import RECOVERY_MAX_ATTEMPTS, _iso, backoff_s, manifest_path, save_manifest, utcnow
from upload.diarize import Diarizer, JobNotFound, normalize
from upload.prepare import _epoch, prepare_from_segments
from upload.tracks import load_mono_16k, to_wav_16k

SUBMIT_TIMEOUT_S = 1800.0      # 제출한 뒤 결과가 이만큼 안 나오면 일시 실패로 보고 다시 제출한다
FAILED_STAGE = "diarize"
_FINISHED = ("done", "failed")
_CLEAN = ("claiming", "claimed", "converted", "submitted")


class Progress(NamedTuple):
    """이번 호출이 한 일. event: claimed | converted | submitted | waiting | done | retry | failed | fail_pending | skipped"""
    meeting_id: str
    event: str


def _dir(recordings_dir: Path, mid: str) -> Path:
    return recordings_dir / ".uploads" / mid


def _save(d: Path, rec: dict) -> None:
    save_manifest(d / "intake.json", rec)


def _load(d: Path) -> dict | None:
    """진행 기록. 없거나 깨졌거나 꼴이 틀리면 None(그 폴더는 기록이 없는 것으로 본다)."""
    try:
        rec = json.loads((d / "intake.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    ok = (isinstance(rec, dict) and isinstance(rec.get("meeting_id"), str) and isinstance(rec.get("state"), str)
          and isinstance(rec.get("item"), dict))
    return rec if ok else None


def _cleanup(d: Path) -> None:
    """원본과 변환 wav(와 받다 만 조각)를 지운다. intake.json 은 남긴다."""
    for p in d.iterdir() if d.exists() else ():
        if p.name == "intake.json":
            continue
        if p.is_file():
            p.unlink(missing_ok=True)
        else:
            shutil.rmtree(p, ignore_errors=True)


def _source(d: Path, rec: dict) -> Path:
    return d / f"source{Path(str(rec['item'].get('stored_filename') or '')).suffix}"


def _wav(d: Path) -> Path:
    return d / "audio_16k.wav"


def _due(rec: dict, now: datetime) -> bool:
    nxt = rec.get("next_at")
    if not nxt:
        return True
    try:
        return datetime.fromisoformat(nxt) <= now
    except (ValueError, TypeError):   # 깨진 시각은 지금 처리할 수 있는 것으로 본다
        return True


def _unfinished(recordings_dir: Path) -> list[tuple[Path, dict]]:
    out = []
    root = recordings_dir / ".uploads"
    for d in sorted(root.iterdir()) if root.exists() else ():
        rec = _load(d) if d.is_dir() else None
        if rec and (rec.get("state") not in _FINISHED or rec.get("fail_pending")):
            out.append((d, rec))
    return out


def intake_one(recordings_dir: Path, *, client, diarizer: Diarizer, now: Callable[[], datetime] = utcnow,
               timezone: str | None = None) -> Progress | None:
    """한 건을 한 단계 진전시킨다. 할 일이 없으면(대기 업로드 없음, 모두 대기 시각 전) None.

    끝나지 않은 로컬 기록 중 때가 된 것을 BE 대기 목록보다 먼저 이어 간다. 없으면 대기 목록의 첫 새 건을 claim 한다.
    예외는 올리지 않는다(실패는 기록하고 Progress.event 로 알린다)."""
    recordings_dir = Path(recordings_dir)
    t = now()
    for d, rec in _unfinished(recordings_dir):
        if _due(rec, t):
            return _advance(recordings_dir, d, rec, client=client, diarizer=diarizer, now=now, timezone=timezone,
                            fresh=False)
    root = recordings_dir / ".uploads"
    # 쓸 수 있는 기록이 있는 폴더만 이미 가져온 것으로 본다. 기록이 없거나 깨진 폴더는 다시 claim 대상이다
    known = {p.name for p in root.iterdir() if p.is_dir() and _load(p) is not None} if root.exists() else set()
    try:
        pending = client.pending_uploads()
    except Exception:  # noqa: BLE001 - BE 가 안 되면 다음 바퀴에 다시 본다
        return None
    for item in pending:
        mid = str(item.get("meeting_id") or "")
        if not mid or mid in known:
            continue
        d = _dir(recordings_dir, mid)
        d.mkdir(parents=True, exist_ok=True)
        rec = {"meeting_id": mid, "state": "claiming", "item": item, "attempts": 0, "next_at": None,
               "job_id": None, "submitted_at": None, "fail_pending": None, "error": None}
        _save(d, rec)   # claim 전에 적는다: 응답을 놓쳐도 우리가 가져간 건이라는 걸 안다
        return _advance(recordings_dir, d, rec, client=client, diarizer=diarizer, now=now, timezone=timezone, fresh=True)
    return None


def _advance(recordings_dir, d: Path, rec: dict, *, client, diarizer, now, timezone, fresh: bool) -> Progress:
    mid = rec["meeting_id"]
    if rec.get("fail_pending"):
        return _report_fail(d, rec, client, now())
    if manifest_path(recordings_dir, f"upload_{mid}").exists():   # 매니페스트가 이미 있다: 분리하지 않고 정리만
        _cleanup(d)
        rec.update(state="done", next_at=None, error=None)
        _save(d, rec)
        return Progress(mid, "done")
    try:
        return _step(recordings_dir, d, rec, client=client, diarizer=diarizer, now=now, timezone=timezone, fresh=fresh)
    except _Skip:
        shutil.rmtree(d, ignore_errors=True)
        return Progress(mid, "skipped")
    except _Permanent as e:
        return _fail(d, rec, client, str(e), now())
    except Exception as e:  # noqa: BLE001 - 연결·5xx·분리기 오류: 다시 해 볼 일시 실패
        return _transient(d, rec, client, now(), f"{type(e).__name__}: {e}")


class _Skip(Exception):
    """이 건은 가져갈 수 없다(없음, 이미 끝남, 다른 쪽이 가져감). 기록을 지우고 넘어간다."""


class _Permanent(Exception):
    """다시 해도 같다. 바로 fail 을 보낸다."""


class _Retry(Exception):
    """일시 실패이고 상태를 되돌려 다시 제출해야 한다."""


def _step(recordings_dir, d, rec, *, client, diarizer, now, timezone, fresh) -> Progress:
    mid, state, item = rec["meeting_id"], rec["state"], rec["item"]
    if state in ("converted", "submitted") and not _wav(d).exists():
        state = rec["state"] = "claimed"   # 변환본이 없다: 처음부터 받는다
        rec["job_id"] = rec["submitted_at"] = None
    if state == "claiming":
        try:
            client.claim_upload(mid)
        except BeError as e:
            if e.code == "MEETING_PROCESSING_IN_PROGRESS":
                if fresh:
                    raise _Skip() from e
            elif e.code == "MEETING_ALREADY_ENDED" or e.status == 404 or e.code == "MEETING_NOT_FOUND":
                raise _Skip() from e
            else:
                raise
        _set(d, rec, "claimed")
        return Progress(mid, "claimed")
    if state == "claimed":
        started_at = item.get("started_at") or ""
        try:
            _epoch(started_at)
        except ValueError as e:
            raise _Permanent(str(e)) from e
        src = _source(d, rec)
        try:
            size = client.download_upload(mid, src)
        except BeError as e:
            if e.status == 404 or e.code == "MEETING_NOT_FOUND":
                raise _Permanent(f"원본 파일이 없다: {e}") from e
            raise
        expected = item.get("size_bytes")
        if expected is not None and size != expected:
            src.unlink(missing_ok=True)
            raise OSError(f"받은 크기 {size} 가 올린 크기 {expected} 와 다르다")
        try:
            to_wav_16k(src, _wav(d))
        except ValueError as e:   # 디코딩할 수 없는 파일: 다시 받아도 같다
            raise _Permanent(f"{type(e).__name__}: {e}") from e
        _set(d, rec, "converted")
        return Progress(mid, "converted")
    if state == "converted":
        rec["job_id"] = diarizer.submit(_wav(d))
        rec["submitted_at"] = _iso(now())
        _set(d, rec, "submitted")
        return Progress(mid, "submitted")
    # submitted
    try:
        segs = diarizer.fetch(rec["job_id"])
    except (JobNotFound, RuntimeError) as e:   # job 이 사라졌거나 분리가 실패했다: 다시 제출한다
        rec["state"], rec["job_id"], rec["submitted_at"] = "converted", None, None
        raise _Retry(f"{type(e).__name__}: {e}") from e
    if segs is None:
        if now() - datetime.fromisoformat(rec["submitted_at"]) > timedelta(seconds=SUBMIT_TIMEOUT_S):
            rec["state"], rec["job_id"], rec["submitted_at"] = "converted", None, None
            raise _Retry(f"결과가 {SUBMIT_TIMEOUT_S:.0f}초 안에 나오지 않았다")
        return Progress(mid, "waiting")
    try:
        audio, total = load_mono_16k(_wav(d))
        segments = normalize(segs, total)
        shutil.rmtree(recordings_dir / f"upload_{mid}", ignore_errors=True)   # 매니페스트 없이 남은 트랙 폴더
        prepare_from_segments(
            audio, total, segments, recordings_dir, source_name=str(item.get("original_filename") or ""),
            started_at=item["started_at"], timezone=timezone, session=f"upload_{mid}",
            meta={"be": {"meeting_id": mid, "status": "processing"}, "workspace_id": item.get("workspace_id"),
                  "title": item.get("title"), "attendees": item.get("attendees") or [],
                  "upload": {k: item.get(k) for k in ("original_filename", "stored_filename", "content_type",
                                                      "size_bytes", "uploaded_at")}})
    except ValueError as e:   # 변환 wav 를 못 읽거나 화자 구간이 없다: 다시 해도 같다
        raise _Permanent(f"{type(e).__name__}: {e}") from e
    _cleanup(d)
    rec.update(state="done", next_at=None, error=None)
    _save(d, rec)
    return Progress(mid, "done")


def _set(d: Path, rec: dict, state: str) -> None:
    rec.update(state=state, next_at=None, error=None)
    _save(d, rec)


def _transient(d: Path, rec: dict, client, t: datetime, error: str) -> Progress:
    rec["attempts"] = rec.get("attempts", 0) + 1
    rec["error"] = error
    if rec["attempts"] >= RECOVERY_MAX_ATTEMPTS:
        return _fail(d, rec, client, f"{error} (시도 {rec['attempts']}번)", t)
    rec["next_at"] = _iso(t + timedelta(seconds=backoff_s(rec["attempts"])))
    _save(d, rec)
    return Progress(rec["meeting_id"], "retry")


def _fail(d: Path, rec: dict, client, error: str, t: datetime) -> Progress:
    _cleanup(d)   # 실패 보고가 되든 안 되든 원본·wav 는 더 쓸 데가 없다
    rec.update(error=error, next_at=None, fail_pending={"failed_stage": FAILED_STAGE})
    _save(d, rec)
    return _report_fail(d, rec, client, t)


def _report_fail(d: Path, rec: dict, client, t: datetime) -> Progress:
    """fail 을 보낸다. 보내지 못하면 fail_pending 을 두고 backoff 뒤(next_at)에 다시 보낸다. 그동안 다른 건을 처리한다.
    BE 에 그 회의가 없으면(404) 보낼 곳이 없으니 끝난 것으로 본다(이미 끝난 409 를 BeClient 가 성공으로 보는 것과 같다)."""
    mid = rec["meeting_id"]
    try:
        client.fail_meeting(mid, rec["fail_pending"]["failed_stage"])
    except Exception as e:  # noqa: BLE001 - 다음 호출이 다시 보낸다
        if not (isinstance(e, BeError) and (e.status == 404 or e.code == "MEETING_NOT_FOUND")):
            n = rec["fail_pending"]["attempts"] = rec["fail_pending"].get("attempts", 0) + 1
            rec["error"] = f"fail 보고 실패: {type(e).__name__}: {e}"
            rec["next_at"] = _iso(t + timedelta(seconds=backoff_s(n)))
            _save(d, rec)
            return Progress(mid, "fail_pending")
    _cleanup(d)
    rec.update(state="failed", fail_pending=None, next_at=None)
    _save(d, rec)
    return Progress(mid, "failed")
