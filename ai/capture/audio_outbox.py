"""인계한 디스코드 회의 녹음을 BE 로 올리는 대기 폴더(#659).

recordings/audio_outbox/<회의ID>.m4a 와 <회의ID>.json({meeting_id, workspace_id, handed_off_at}) 한 쌍이 항목 하나다.
매니페스트는 읽지도 쓰지도 않는다. 올리기 상태가 매니페스트에 섞이면 인계 단계의 복구·정리 규칙과 얽히기 때문이다.

  enqueue   트랙 wav 를 지우기 직전에 섞어(audio_mix) 넣는다. m4a 를 먼저, json 을 나중에 써서 json 이 있으면 m4a 도 있다
  drain     워커가 바퀴마다 비운다. 올리면 지운다. 네트워크·5xx 는 남겨 다음 바퀴에 다시 한다
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
PERMANENT_ERRORS = {"MEETING_DELETED", "MEETING_NOT_FOUND", "INVALID_REQUEST", "AUDIO_FORMAT_UNSUPPORTED", "AUDIO_TOO_LARGE"}


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
    BE 가 다시 해도 같다고 답한 오류(PERMANENT_ERRORS)도 지우고, 네트워크·5xx 같은 나머지는 남겨 다음 바퀴에 다시 한다."""
    now = now or datetime.now(timezone.utc)
    done = []
    for meta in sorted(_dir(recordings_dir).glob("*.json")):
        meeting_id = meta.stem
        try:
            data = _read_meta(meta)
            if data is None or data.get("meeting_id") != meeting_id:
                # 읽을 수 없는 항목은 인계 시각을 몰라 올리지 않는다. 그래도 7일 상한은 지켜야 해서 json 이 그만큼 묵으면 지운다
                if now.timestamp() >= meta.stat().st_mtime + OUTBOX_KEEP_S:
                    for path in (meta, meta.with_suffix(".m4a"), meta.with_suffix(".part"), meta.with_suffix(".json.tmp")):
                        path.unlink(missing_ok=True)
                    done.append(meeting_id)
                continue
            audio = _paths(recordings_dir, meeting_id)[0]
            handed = _handed_off_at(data)
            if handed is None or not audio.is_file() or now >= handed + timedelta(seconds=OUTBOX_KEEP_S):
                remove_meeting(recordings_dir, meeting_id)
                done.append(meeting_id)
                continue
            try:
                client.upload_recording(meeting_id, audio)
            except BeError as e:
                if e.code not in PERMANENT_ERRORS:
                    print(f"[audio] {meeting_id} 녹음 올리기 실패(다음에 다시 한다): {e.code}", flush=True)
                    continue
            remove_meeting(recordings_dir, meeting_id)
            done.append(meeting_id)
        except Exception as e:  # noqa: BLE001 - 한 항목의 실패가 나머지를 막지 않는다. 다음 바퀴에 다시 본다
            print(f"[audio] {meeting_id} 녹음 올리기 오류(다음에 다시 한다): {type(e).__name__}: {e}", flush=True)
    return done
