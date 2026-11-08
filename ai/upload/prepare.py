"""수동 업로드 오디오를 화자별 가상 트랙과 diarized 매니페스트로 만든다.

이어서 사람이 화자 라벨을 멤버에 지정한다(upload.mapping: python -m upload.mapping <매니페스트> <mapping.json>, status 가 mapped 가 된다).
워커의 처리 바퀴는 업로드 회의(source == "upload")를 diarized 일 때, 그리고 BE 회의·워크스페이스가 없는 매니페스트(이 prepare 로 만든 것)를 상태와
상관없이 집지 않는다. BE 에서 가져온 회의는 워커가 upload.report 로 라벨을 보고하고 upload.assign 으로 PM 의 지정을 받아 mapped 로 만들며,
mapped 가 된 뒤에는 처리 바퀴가 집어 전사·BE 인계를 한다(디스코드 회의보다 먼저, /meetings·/end 는 부르지 않는다).
BE 에 올라온 업로드를 가져오는 쪽은 upload.intake 이고, 분리 결과(Segment 목록)로 같은 매니페스트를 쓰는 prepare_from_segments 를 쓴다.
meta 키워드로 be·workspace_id·title·attendees·upload 를 매니페스트에 얹는다.
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
                   started_at: str, timezone: str | None = None, meta: dict | None = None) -> tuple[Path, dict]:
    """(매니페스트 경로, 매니페스트). 구간이 하나도 없으면 ValueError 이고 아무것도 쓰지 않는다. meta 는 매니페스트에 얹을 키(be, workspace_id 등).

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
    if session is None:
        while manifest_path(recordings_dir, f"upload_{ts}").exists() or (recordings_dir / f"upload_{ts}").exists():
            ts += 1
        session = f"upload_{ts}"
    return prepare_from_segments(audio, total, segments, recordings_dir, source_name=audio_path.name,
                                 started_at=started_at, timezone=timezone, session=str(session), meta=meta, ts=ts)


def prepare_from_segments(audio, total: float, segments: list[Segment], recordings_dir: Path, *, source_name: str,
                          started_at: str, timezone: str | None, session: str,
                          meta: dict | None = None, ts: int | None = None) -> tuple[Path, dict]:
    """이미 분리된(normalize 를 거친) 구간 목록으로 가상 트랙과 diarized 매니페스트를 한 번에 쓴다.
    업로드 가져오기(upload.intake)는 분리기를 따로 불러 두었다가 이 경로로 저장한다. meta 의 키는 매니페스트에 그대로 얹는다
    (be, workspace_id, title, attendees, upload 등). 구간이 없으면 ValueError 이고 아무것도 쓰지 않는다.
    ts 는 트랙 파일 이름({id}_{ts}.wav)에 쓴다. 기본은 started_at 의 epoch 초이고, 세션 이름의 ts 를 이름 충돌로 올렸다면 같은 값을 넘긴다."""
    recordings_dir = Path(recordings_dir)
    ts = _epoch(started_at) if ts is None else ts
    if not segments:
        raise ValueError("화자 구간이 없다: 사람 목소리를 찾지 못했다")
    if timezone is None:
        from shared.config import settings
        timezone = settings().meeting_timezone
    meeting_dir = recordings_dir / str(session)
    entries = write_virtual_tracks(audio, segments, meeting_dir, str(ts))
    for e in entries:
        e["file"] = f"{session}/{e['file']}"
    (meeting_dir / "diarization.json").write_text(
        json.dumps({"source": source_name, "duration_sec": total,
                    "segments": [{"start_s": s.start_s, "end_s": s.end_s, "label": s.label} for s in segments]},
                   ensure_ascii=False, indent=2), encoding="utf-8")
    manifest = {
        "session": str(session), "guild": None, "channel": None, "recorded_at": now_iso(),
        "library_version": None, "speakers": entries, "status": STATUS_DIARIZED,
        "started_at": started_at, "meeting_dir": str(session), "source": "upload", "timezone": timezone,
        **(meta or {}),
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
    print(f"{path}  화자 {len(m['speakers'])}명. 개발용으로 라벨을 멤버에 지정하려면: python -m upload.mapping {path} <mapping.json> "
          "(PM 의 지정은 BE 웹 경로와 upload.assign 이 받고, mapped 가 된 BE 업로드는 처리 바퀴가 전사·인계한다).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
