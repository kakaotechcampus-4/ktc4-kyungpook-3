"""수동 업로드 오디오를 화자별 가상 트랙과 diarized 매니페스트로 만든다.

사람이 화자 이름을 확인하고 status 를 saved 로 바꾼 뒤의 처리는 이 모듈이 정하지 않는다. 길드 없는 자동 바퀴는 saved 를 집지만
workspace_id·BE 회의 정보가 없어 BE 인계는 안 되고, `--retry <서버ID>` 바퀴는 guild_id 없는 매니페스트를 거른다.
자동 이어받기와 BE 인계는 다음 PR(PM 라벨 지정 흐름)에서 정한다.
실행: python -m upload.prepare <오디오> --started-at <ISO> [--timezone Asia/Seoul]  (pyannoteAI 를 실제로 부른다)
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime
from pathlib import Path

from capture.recorder import STATUS_DIARIZED, manifest_path, save_manifest
from shared.schemas import now_iso
from upload.diarize import Diarizer, normalize
from upload.tracks import load_mono_16k, write_virtual_tracks


def _epoch(started_at: str) -> int:
    dt = datetime.fromisoformat(started_at)
    if dt.tzinfo is None:
        raise ValueError(f"started_at 에 시간대가 없다 (예: 2026-10-31T10:00:00+09:00): {started_at!r}")
    return int(dt.timestamp())


def prepare_upload(audio_path: Path, recordings_dir: Path, *, diarizer: Diarizer, session=None,
                   started_at: str, timezone: str | None = None) -> tuple[Path, dict]:
    """(매니페스트 경로, 매니페스트). 구간이 하나도 없으면 ValueError 이고 아무것도 쓰지 않는다.

    회의 ID 는 upload_<ts>(ts 는 started_at 의 epoch 초). 같은 ID 가 있으면 ts 를 올린다."""
    audio_path, recordings_dir = Path(audio_path), Path(recordings_dir)
    ts = _epoch(started_at)
    if session is not None:
        session = str(session)
        if not session or session in (".", "..") or any(c in session for c in "/\\"):
            raise ValueError(f"세션 이름에 경로 구분자를 쓸 수 없다: {session!r}")
        if manifest_path(recordings_dir, session).exists() or (recordings_dir / session).exists():
            raise ValueError(f"이미 있는 세션이다: {session!r}")
    audio, total = load_mono_16k(audio_path)
    segments = normalize(diarizer.diarize(audio_path), total)
    if not segments:
        raise ValueError("화자 구간이 없다: 사람 목소리를 찾지 못했다")
    if timezone is None:
        from shared.config import settings
        timezone = settings().meeting_timezone
    if session is None:
        while manifest_path(recordings_dir, f"upload_{ts}").exists() or (recordings_dir / f"upload_{ts}").exists():
            ts += 1
        session = f"upload_{ts}"
    meeting_dir = recordings_dir / str(session)
    entries = write_virtual_tracks(audio, segments, meeting_dir, str(ts))
    for e in entries:
        e["file"] = f"{session}/{e['file']}"
    (meeting_dir / "diarization.json").write_text(
        json.dumps({"source": audio_path.name, "duration_sec": total,
                    "segments": [{"start_s": s.start_s, "end_s": s.end_s, "label": s.label} for s in segments]},
                   ensure_ascii=False, indent=2), encoding="utf-8")
    manifest = {
        "session": str(session), "guild": None, "channel": None, "recorded_at": now_iso(),
        "library_version": None, "speakers": entries, "status": STATUS_DIARIZED,
        "started_at": started_at, "meeting_dir": str(session), "source": "upload", "timezone": timezone,
    }
    path = manifest_path(recordings_dir, session)
    save_manifest(path, manifest)
    return path, manifest


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("audio", type=Path)
    ap.add_argument("--recordings-dir", type=Path, default=Path("recordings"))
    ap.add_argument("--started-at", required=True, help="회의 시작 시각 (ISO 8601, 시간대 필수. 예: 2026-10-31T10:00:00+09:00)")
    ap.add_argument("--timezone", default=None)
    a = ap.parse_args(argv)
    from upload.diarize import PyannoteAiDiarizer
    path, m = prepare_upload(a.audio, a.recordings_dir, diarizer=PyannoteAiDiarizer(),
                             started_at=a.started_at, timezone=a.timezone)
    print(f"{path}  화자 {len(m['speakers'])}명. 이름을 확인하고 status 를 saved 로 바꾼 뒤의 처리(자동 이어받기·BE 인계)는 다음 PR 에서 정한다.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
