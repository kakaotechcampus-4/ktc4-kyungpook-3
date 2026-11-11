"""인계한 디스코드 회의 녹음을 BE 로 올리는 대기 폴더(#659).

recordings/audio_outbox/<회의ID>.m4a 와 <회의ID>.json({meeting_id, workspace_id, handed_off_at, 실패하면 attempts·next_at}) 한 쌍이 항목 하나다.
매니페스트는 읽지도 쓰지도 않는다. 올리기 상태가 매니페스트에 섞이면 인계 단계의 복구·정리 규칙과 얽히기 때문이다.

  enqueue   트랙 wav 를 지우기 직전에 섞어(audio_mix) 넣는다. m4a 를 먼저, json 을 나중에 써서 json 이 있으면 m4a 도 있다
  drain     워커가 바퀴마다 비운다. 올리면 지운다. 네트워크·5xx 는 남기고 간격을 늘리며(60초 × 2^(실패 횟수-1), 최대 1시간) 다시 한다
  remove_*  회의·워크스페이스 정리(meeting_purge, privacy_cleanup)가 항목도 지운다

BE 는 보관 기간을 회의 종료 시각부터 세므로 인계(handed_off) 7일 뒤에는 올리지 않고 지운다(OUTBOX_KEEP_S).

discord 이름은 여기 없다.
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

from capture.audio_mix import mix_to_m4a
from capture.handoff import BeError

OUTBOX_DIR = "audio_outbox"
OUTBOX_KEEP_S = 7 * 86400   # 인계 뒤 이만큼 지나면 올리지 않고 포기한다. 트랙 wav 의 포기 보관(AUDIO_KEEP_AFTER_GIVE_UP_S)과 같다
# 같은 파일로 다시 올려도 결과가 같은 BE 오류. 항목을 지킬 이유가 없다
# PRIVACY_VERSION_CHANGED 는 BE 가 이 API 에서 세대를 보지 않아 나오지 않는 안전망, WORKSPACE_NOT_FOUND 는 공간이 지워졌다는 뜻이다
PERMANENT_ERRORS = {"MEETING_DELETED", "MEETING_NOT_FOUND", "INVALID_REQUEST", "AUDIO_FORMAT_UNSUPPORTED", "AUDIO_TOO_LARGE",
                    "PRIVACY_VERSION_CHANGED", "WORKSPACE_NOT_FOUND"}
RETRY_BASE_S = 60           # 올리기에 실패하면 60초 × 2^(실패 횟수-1) 뒤에 다시 한다
RETRY_MAX_S = 3600          # 간격 상한 1시간. 계약 문서(backend-ai-contract.md 의 recording 오류 표)와 같다


def _dir(recordings_dir: Path) -> Path:
    return Path(recordings_dir) / OUTBOX_DIR


def _component(value: str) -> str:
    """파일 이름에 쓸 회의 ID. 경로를 벗어나거나 거를 문자가 들어 있으면 ValueError."""
    if (not isinstance(value, str) or not value or Path(value).name != value or value in (".", "..")
            or any(c in value for c in "\\/:*?[]")):
        raise ValueError("invalid meeting id for audio outbox")
    return value


def _paths(recordings_dir: Path, meeting_id: str) -> tuple[Path, Path]:
    base = _dir(recordings_dir)
    mid = _component(meeting_id)
    return base / f"{mid}.m4a", base / f"{mid}.json"


def has(recordings_dir: Path, meeting_id: str) -> bool:
    return _paths(recordings_dir, meeting_id)[1].is_file()


def enqueue(recordings_dir: Path, *, meeting_id: str, workspace_id: str | None, handed_off_at: datetime,
            tracks: list[Path]) -> Path:
    """트랙을 섞어 <회의ID>.m4a 를 만들고 <회의ID>.json 을 원자적으로 쓴다. 이미 항목이 있으면 그대로 돌려준다.
    실패하면 ValueError·OSError 가 나가고 json 이 없어 항목으로 치지 않는다."""
    audio, meta = _paths(recordings_dir, meeting_id)
    if meta.is_file():
        return audio
    audio.parent.mkdir(parents=True, exist_ok=True)
    mix_to_m4a(tracks, audio)
    tmp = meta.with_suffix(".json.tmp")
    tmp.write_text(json.dumps({"meeting_id": meeting_id, "workspace_id": workspace_id,
                               "handed_off_at": handed_off_at.isoformat()}, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, meta)
    return audio


def _read_meta(path: Path) -> dict | None:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def _next_at(meta: dict) -> datetime | None:
    """다시 올려도 되는 시각. 없거나 읽을 수 없으면 None(바로 올린다)."""
    try:
        at = datetime.fromisoformat(meta["next_at"])
    except (KeyError, TypeError, ValueError):
        return None
    return at if at.tzinfo is not None else at.replace(tzinfo=timezone.utc)


def _record_failure(meta_path: Path, data: dict, now: datetime) -> None:
    """json 에 attempts 와 next_at 을 적는다(원자적으로)."""
    attempts = data.get("attempts")
    attempts = attempts + 1 if isinstance(attempts, int) and not isinstance(attempts, bool) and attempts >= 0 else 1
    wait = min(RETRY_BASE_S * 2 ** min(attempts - 1, 20), RETRY_MAX_S)
    tmp = meta_path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps({**data, "attempts": attempts, "next_at": (now + timedelta(seconds=wait)).isoformat()},
                              ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, meta_path)


def _handed_off_at(meta: dict) -> datetime | None:
    try:
        at = datetime.fromisoformat(meta["handed_off_at"])
    except (KeyError, TypeError, ValueError):
        return None
    return at if at.tzinfo is not None else at.replace(tzinfo=timezone.utc)


def remove_meeting(recordings_dir: Path, meeting_id: str) -> None:
    """항목과 쓰다 만 임시 파일을 지운다. 없어도 괜찮다. json 을 먼저 지워 m4a 없는 항목이 남지 않게 한다."""
    audio, meta = _paths(recordings_dir, meeting_id)
    for path in (meta, meta.with_suffix(".json.tmp"), audio, audio.with_suffix(".part")):
        path.unlink(missing_ok=True)


def remove_workspace(recordings_dir: Path, workspace_id: str) -> list[str]:
    """그 워크스페이스의 항목을 모두 지우고 회의 ID 목록을 돌려준다."""
    removed = []
    for meta in sorted(_dir(recordings_dir).glob("*.json")):
        data = _read_meta(meta)
        if data is not None and data.get("workspace_id") == workspace_id and data.get("meeting_id") == meta.stem:
            remove_meeting(recordings_dir, meta.stem)
            removed.append(meta.stem)
    return removed


def drain(recordings_dir: Path, client, *, now: datetime | None = None) -> list[str]:
    """대기 항목을 BE 로 올리고 처리한(지운) 회의 ID 목록을 돌려준다. 한 항목의 예외가 나머지를 막지 않는다.

    인계 7일 뒤면 올리지 않고 지운다. 올렸으면(BE 가 보관 기간이 지났다며 stored=false 로 답해도) 지운다.
    BE 가 다시 해도 같다고 답한 오류(PERMANENT_ERRORS)도 지우고, 네트워크·5xx 같은 나머지는 남겨 next_at 이 지난 바퀴에 다시 한다.
    실패하면 attempts 를 올리고 next_at 을 now + min(60초 × 2^(attempts-1), 1시간) 으로 적는다. 7일 포기 규칙은 next_at 보다 먼저 본다.
    결과를 나눠 보려면 drain_results 를 쓴다."""
    return [meeting_id for meeting_id, _, _ in drain_results(recordings_dir, client, now=now)]


UPLOADED, NOT_STORED, GAVE_UP = "uploaded", "not_stored", "gave_up"


def drain_results(recordings_dir: Path, client, *, now: datetime | None = None) -> list[tuple[str, str, str]]:
    """drain 과 같지만 지운 항목마다 (회의 ID, 결과, 이유) 를 돌려준다(#670 리뷰: 녹음이 빠진 걸 운영에서 알 수 있게).

    결과는 uploaded(BE 가 저장), not_stored(BE 가 보관 기간이 지났다며 받지 않음), gave_up(올리지 못하고 지움) 셋이다.
    gave_up 의 이유는 BE 오류 코드, "인계 7일 지남", "녹음 파일 없음", "항목을 읽을 수 없음" 중 하나다.
    다시 하려고 남긴 항목은 목록에 없다."""
    now = now or datetime.now(timezone.utc)
    results: list[tuple[str, str, str]] = []
    for meta in sorted(_dir(recordings_dir).glob("*.json")):
        meeting_id = meta.stem
        try:
            data = _read_meta(meta)
            if data is None or data.get("meeting_id") != meeting_id:
                # 읽을 수 없는 항목은 인계 시각을 몰라 올리지 않는다. 그래도 7일 상한은 지켜야 해서 json 이 그만큼 묵으면 지운다
                if now.timestamp() >= meta.stat().st_mtime + OUTBOX_KEEP_S:
                    for path in (meta, meta.with_suffix(".m4a"), meta.with_suffix(".part"), meta.with_suffix(".json.tmp")):
                        path.unlink(missing_ok=True)
                    results.append((meeting_id, GAVE_UP, "항목을 읽을 수 없음"))
                continue
            audio = _paths(recordings_dir, meeting_id)[0]
            handed = _handed_off_at(data)
            if handed is None or not audio.is_file() or now >= handed + timedelta(seconds=OUTBOX_KEEP_S):
                reason = ("항목을 읽을 수 없음" if handed is None
                          else "녹음 파일 없음" if not audio.is_file() else "인계 7일 지남")
                remove_meeting(recordings_dir, meeting_id)
                results.append((meeting_id, GAVE_UP, reason))
                continue
            next_at = _next_at(data)
            if next_at is not None and now < next_at:
                continue
            try:
                answer = client.upload_recording(meeting_id, audio)
            except Exception as e:  # noqa: BLE001 - BeError 가 아닌 읽기·전송 오류도 같은 간격으로 다시 한다
                if not (isinstance(e, BeError) and e.code in PERMANENT_ERRORS):
                    code = e.code if isinstance(e, BeError) else type(e).__name__
                    print(f"[audio] {meeting_id} 녹음 올리기 실패(간격을 두고 다시 한다): {code}", flush=True)
                    _record_failure(meta, data, now)
                    continue
                remove_meeting(recordings_dir, meeting_id)
                results.append((meeting_id, GAVE_UP, e.code))
                continue
            remove_meeting(recordings_dir, meeting_id)
            stored = not isinstance(answer, dict) or answer.get("stored", True) is not False
            results.append((meeting_id, UPLOADED if stored else NOT_STORED, ""))
        except Exception as e:  # noqa: BLE001 - 한 항목의 실패가 나머지를 막지 않는다. 다음 바퀴에 다시 본다
            print(f"[audio] {meeting_id} 녹음 올리기 오류(다음에 다시 한다): {type(e).__name__}: {e}", flush=True)
    return results
