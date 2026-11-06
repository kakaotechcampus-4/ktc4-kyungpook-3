"""가져온 업로드 회의의 화자 라벨과 샘플 구간을 BE 에 보고한다(POST /uploads/{id}/speakers).

워커가 바퀴 끝에서(assign_one 다음, intake_one 보다 먼저) report_one 을 한 번 부른다. 한 호출은 한 건을 한 번 진전시키고
돌아온다. BE 는 보고를 받아야 awaiting_speakers 로 바뀌고 PM 이 지정할 수 있다. 보고 본문은 처음 만들 때 기록에 고정하고
재전송은 그 본문을 그대로 보낸다(BE 는 같은 내용이면 200 이라 응답을 잃은 재시도가 안전하고, 다시 계산하면 내용이 달라져 409 가 된다).

기록은 recordings/.uploads/<meeting_id>/intake.json 의 `report` 키다. 가져오기 state 와 매니페스트(`diarized`)는 건드리지 않는다.
  reporting  본문을 적고 보내기 전에 적는다. 일시 실패는 attempts, next_at 만 바꾼다(포기 한도 없음: 멱등이고 ENDED·BE sweeper 가 끝낸다)
  reported   BE 가 라벨을 받았다(끝). 409 SPEAKERS_ALREADY_REPORTED 의 라벨이 우리 것과 같아도 여기로 온다
  ended      BE 가 이미 끝낸 회의다(409 ENDED·404). 로컬 매니페스트·트랙·잠금을 지웠고 fail 은 보내지 않는다(끝)
  failing    보고할 수 없어(파일 문제, 라벨 불일치, NOT_CLAIMED, 400) 로컬을 지우고 fail(diarize)을 보내는 중이다. 보내지 못하면 다음에 다시
  failed     fail 을 보냈다(끝)
reporting -> reported | ended | failing -> failed.

대상: 가져오기 state 가 done 이고 report·resume 키가 없는 기록(지정 받기가 이미 이어 가는 기록은 건드리지 않는다). 그다음 때가 된
reporting·failing. 처리 가드와 가져오기 상태 기계는 그대로다.
"""

from __future__ import annotations

import json
import math
from datetime import datetime, timedelta
from pathlib import Path
from typing import Callable, Iterable

from capture.handoff import BeError
from capture.recorder import _iso, backoff_s, manifest_path, utcnow
from upload.assign import _drop_local, _is_gone
from upload.intake import FAILED_STAGE, Progress, _cleanup, _dir, _due, _load, _save

_OPEN = ("reporting", "failing")
SAMPLE_MAX = 3         # 라벨마다 샘플 구간 최대 개수
SAMPLE_MIN_S = 2.0     # 이보다 짧은 깨끗한 구간은 먼저 고르지 않는다
SAMPLE_CAP_S = 10.0    # 샘플 하나의 최대 길이(구간 앞에서부터 자른다)
SAMPLE_PIECE_MIN_S = 0.5   # 깨끗한 구간으로 대체할 때 이보다 짧은 조각은 후보에서 뺀다(겹친 긴 구간이 낫다)
_EPS = 1e-9


def _floor3(x: float) -> float:
    return math.floor(x * 1000 + _EPS) / 1000


def _ceil3(x: float) -> float:
    return math.ceil(x * 1000 - _EPS) / 1000


def _intervals(diarization: dict) -> tuple[float, dict[str, list[tuple[float, float]]]]:
    """(길이, 라벨 -> [(start, end)]). 범위를 [0, duration] 으로 자르고 길이가 없거나 유한하지 않은 구간은 버린다."""
    duration = diarization.get("duration_sec")
    if isinstance(duration, bool) or not isinstance(duration, (int, float)) or not math.isfinite(duration) or duration <= 0:
        raise ValueError(f"녹음 길이가 올바르지 않다: {duration!r}")
    by: dict[str, list[tuple[float, float]]] = {}
    for seg in diarization.get("segments") or []:
        try:
            a, b, label = float(seg["start_s"]), float(seg["end_s"]), seg["label"]
        except (KeyError, TypeError, ValueError):
            continue
        if not isinstance(label, str) or not (math.isfinite(a) and math.isfinite(b)):
            continue
        a, b = max(a, 0.0), min(b, float(duration))
        if b > a:
            by.setdefault(label, []).append((a, b))
    return float(duration), by


def _merge(spans: list[tuple[float, float]]) -> list[tuple[float, float]]:
    out: list[tuple[float, float]] = []
    for a, b in sorted(spans):
        if out and a <= out[-1][1]:
            out[-1] = (out[-1][0], max(out[-1][1], b))
        else:
            out.append((a, b))
    return out


def _minus(seg: tuple[float, float], others: list[tuple[float, float]]) -> list[tuple[float, float]]:
    """seg 에서 others(합친 구간 목록)와 겹친 부분을 뺀 조각들."""
    parts, cur = [], seg[0]
    for a, b in others:
        if b <= cur:
            continue
        if a >= seg[1]:
            break
        if a > cur:
            parts.append((cur, a))
        cur = max(cur, b)
    if cur < seg[1]:
        parts.append((cur, seg[1]))
    return parts


def _sample(span: tuple[float, float], duration: float) -> dict | None:
    """10초로 자르고(앞에서부터) 소수 셋째 자리로 맞춘다. 시작은 내림, 끝은 올림이고 끝은 녹음 길이를 넘지 않는다."""
    a, b = span[0], min(span[1], span[0] + SAMPLE_CAP_S)
    start, end = max(_floor3(a), 0.0), min(_ceil3(b), _floor3(duration))
    return {"start": start, "end": end} if 0 <= start < end else None


def build_speakers(diarization: dict, labels: Iterable[str]) -> list[dict]:
    """분리 결과(diarization.json 의 dict)와 라벨 목록으로 보고 본문 [{label, total_sec, samples}] 을 만든다. labels 순서대로, 한 번씩.

    total_sec: 그 라벨 구간 길이의 합(다른 라벨과 겹친 부분 포함, 소수 셋째 자리 반올림).
    samples: 다른 라벨과 겹친 부분을 뺀 구간 중 2초 이상을 긴 순으로 최대 3개, 각각 앞 10초만, 시작 시각 순.
    그런 구간이 없으면(또는 자르고 나서 쓸 수 없으면) 0.5초 이상인 가장 긴 깨끗한 구간 하나, 그것도 없으면 가장 긴 원래 구간 하나.
    각 단계는 유효한 샘플이 하나라도 나와야 통과한다. 같은 입력이면 같은 결과다.
    구간이 하나도 없는 라벨이거나 어느 단계에서도 샘플을 만들 수 없으면 ValueError."""
    duration, by = _intervals(diarization)
    out, seen = [], set()
    for label in labels:
        if label in seen:
            continue
        seen.add(label)
        own = by.get(label)
        if not own:
            raise ValueError(f"라벨 {label!r} 의 화자 구간이 없다")
        others = _merge([s for l, spans in by.items() if l != label for s in spans])
        clean = [p for seg in own for p in _minus(seg, others)]
        key = lambda s: (-(s[1] - s[0]), s[0])   # noqa: E731 - 긴 순, 같으면 이른 순(결정적)
        stages = (
            sorted((p for p in clean if p[1] - p[0] >= SAMPLE_MIN_S - _EPS), key=key)[:SAMPLE_MAX],
            sorted((p for p in clean if p[1] - p[0] >= SAMPLE_PIECE_MIN_S - _EPS), key=key)[:1],
            sorted(own, key=key)[:1],
        )
        samples: list[dict] = []
        for picked in stages:   # 유효한 샘플이 하나라도 나오는 첫 단계를 쓴다
            samples = [s for s in (_sample(p, duration) for p in sorted(picked)) if s]
            if samples:
                break
        if not samples:
            raise ValueError(f"라벨 {label!r} 의 샘플 구간을 만들 수 없다")
        out.append({"label": label, "total_sec": round(sum(b - a for a, b in own), 3), "samples": samples})
    return out


def _pending(recordings_dir: Path, t: datetime):
    """때가 된 reporting·failing 기록 하나, 없으면 보고를 아직 시작하지 않은 done 기록 하나. (폴더, 기록, 새로 시작하는가)"""
    root = recordings_dir / ".uploads"
    dirs = sorted(root.iterdir()) if root.exists() else []
    fresh = None
    for d in dirs:
        rec = _load(d) if d.is_dir() else None
        if rec is None:
            continue
        r = rec.get("report")
        if isinstance(r, dict) and r.get("state") in _OPEN and _due(r, t):
            return d, rec, False
        if fresh is None and rec.get("state") == "done" and "report" not in rec and "resume" not in rec:
            fresh = (d, rec, True)
    return fresh


def report_one(recordings_dir: Path, *, client, now: Callable[[], datetime] = utcnow) -> Progress | None:
    """한 건을 한 번 진전시킨다. 할 일이 없으면 None. 예외는 올리지 않는다(실패는 기록하고 Progress.event 로 알린다).

    event: reported | retry | ended | failed | fail_pending"""
    recordings_dir = Path(recordings_dir)
    found = _pending(recordings_dir, now())
    if not found:
        return None
    d, rec, fresh = found
    mid = rec["meeting_id"]
    if fresh:
        try:
            speakers = _prepare(recordings_dir, mid)
        except (OSError, ValueError, KeyError, TypeError) as e:   # 매니페스트·분리 파일이 없거나 깨졌거나 라벨이 어긋났다
            _drop_local(recordings_dir, mid)
            rec["report"] = {"state": "failing", "attempts": 0, "next_at": None, "error": f"{type(e).__name__}: {e}"}
            _save(d, rec)
            return _report_fail(d, rec, client, now())
        rec["report"] = {"state": "reporting", "speakers": speakers, "attempts": 0, "next_at": None, "error": None}
        _save(d, rec)   # 보내기 전에 본문을 고정한다: 응답을 잃거나 죽어도 같은 본문을 다시 보낸다
    r = rec["report"]
    if r["state"] == "failing":
        return _report_fail(d, rec, client, now())
    try:
        client.report_speakers(mid, r["speakers"])
    except BeError as e:
        if e.code == "SPEAKERS_ALREADY_REPORTED":
            labels = e.details.get("labels")
            if isinstance(labels, list) and set(labels) == {s["label"] for s in r["speakers"]}:
                return _reported(d, rec, now())
            return _fail(recordings_dir, d, rec, client, now(), f"{e.code}: 다른 라벨이 이미 보고됐다 {labels}")
        if e.code == "MEETING_ALREADY_ENDED" or _is_gone(e):
            _drop_local(recordings_dir, mid)
            return _finish(d, rec, "ended", f"{e.code}: {e}")
        if e.code == "UPLOAD_NOT_CLAIMED" or e.status == 400:   # 다시 해도 같다
            return _fail(recordings_dir, d, rec, client, now(), f"{e.code}: {e}")
        return _later(d, rec, now(), f"{type(e).__name__}: {e}", "retry")
    except Exception as e:  # noqa: BLE001 - 연결 오류 등: 응답을 잃었을 수 있으니 같은 본문을 다시 보낸다
        return _later(d, rec, now(), f"{type(e).__name__}: {e}", "retry")
    return _reported(d, rec, now())


def _prepare(recordings_dir: Path, mid: str) -> list[dict]:
    session = f"upload_{mid}"
    manifest = json.loads(manifest_path(recordings_dir, session).read_text(encoding="utf-8"))
    diarization = json.loads((recordings_dir / session / "diarization.json").read_text(encoding="utf-8"))
    labels = [s["display_name"] for s in manifest["speakers"]]
    found = {seg["label"] for seg in diarization["segments"]}
    if set(labels) != found or not labels:
        raise ValueError(f"매니페스트 라벨 {sorted(labels)} 과 분리 결과 라벨 {sorted(found)} 이 다르다")
    return build_speakers(diarization, labels)


def _reported(d: Path, rec: dict, t: datetime) -> Progress:
    rec["report"]["reported_at"] = _iso(t)
    return _finish(d, rec, "reported", None)


def _finish(d: Path, rec: dict, state: str, error: str | None) -> Progress:
    rec["report"].update(state=state, next_at=None, error=error)
    _save(d, rec)
    return Progress(rec["meeting_id"], state)


def _later(d: Path, rec: dict, t: datetime, error: str, event: str) -> Progress:
    r = rec["report"]
    r["attempts"] = r.get("attempts", 0) + 1
    r["error"] = error
    r["next_at"] = _iso(t + timedelta(seconds=backoff_s(r["attempts"])))
    _save(d, rec)
    return Progress(rec["meeting_id"], event)


def _fail(recordings_dir: Path, d: Path, rec: dict, client, t: datetime, error: str) -> Progress:
    _drop_local(recordings_dir, rec["meeting_id"])
    rec["report"].update(state="failing", error=error, next_at=None)
    _save(d, rec)
    return _report_fail(d, rec, client, t)


def _report_fail(d: Path, rec: dict, client, t: datetime) -> Progress:
    """fail(diarize)을 보낸다. 409 ENDED 는 BeClient 가 성공으로 돌려주고, 404 는 보낼 곳이 없으니 끝난 것으로 본다.
    보내지 못하면 failing 으로 두고 backoff 뒤에 다시 보낸다."""
    try:
        client.fail_meeting(rec["meeting_id"], FAILED_STAGE)
    except Exception as e:  # noqa: BLE001
        if not _is_gone(e):
            return _later(d, rec, t, f"fail 보고 실패: {type(e).__name__}: {e}", "fail_pending")
    _cleanup(d)
    return _finish(d, rec, "failed", rec["report"].get("error"))
