"""화자 라벨(SPEAKER_00 ...)을 멤버에 지정한다. 모든 라벨을 한 번에 지정해야 하고, 틀리면 매니페스트를 건드리지 않는다.

지정은 speakers[].member_id (멤버 ID 문자열, 외부 참석자는 null) 와 최상위 mapped_at 을 더하고 status 를 mapped 로 바꾼다.
user_id(라벨 id)·file·wav 파일명은 그대로라 parse_wav_stem 이 보는 화자 id 가 변하지 않는다. 멤버 ID 는 형식만 본다.
같은 멤버를 여러 라벨에 지정해도 된다. mapped 에서 다시 지정하면 덮어쓴다.
지정 뒤의 처리(워커 이어받기·BE 인계)는 정해지지 않았고 워커는 업로드 회의를 집지 않는다(#254·#255 인계 합의 전까지).
실행(내장 map 과 이름이 겹치지 않게 모듈 이름은 mapping): python -m upload.mapping <매니페스트> <mapping.json>
mapping.json 은 {"mapping": {"SPEAKER_00": "멤버ID", "SPEAKER_01": null}} 또는 안쪽 dict 그대로. 키는 SPEAKER_00 도 SPEAKER00 도 된다.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from capture.recorder import STATUS_DIARIZED, STATUS_MAPPED, save_manifest, try_lock
from shared.schemas import now_iso
from upload.tracks import speaker_label_id


def _normalize(mapping: dict, known: list[str]) -> dict[str, str | None]:
    if not isinstance(mapping, dict):
        raise ValueError("mapping 은 {라벨: 멤버ID} 객체여야 한다")
    out: dict[str, str | None] = {}
    for key, member in mapping.items():
        ident = speaker_label_id(str(key))
        if ident in out:
            raise ValueError(f"같은 라벨을 두 번 지정했다: {key!r}")
        if member is not None and (not isinstance(member, str) or not member.strip()):
            raise ValueError(f"멤버 ID 는 비어 있지 않은 문자열이나 null 이어야 한다: {key!r}: {member!r}")
        out[ident] = member
    unknown = sorted(set(out) - set(known))
    if unknown:
        raise ValueError(f"모르는 라벨: {unknown} (있는 라벨: {known})")
    missing = [k for k in known if k not in out]
    if missing:
        raise ValueError(f"지정하지 않은 라벨: {missing} (모든 라벨을 한 번에 지정해야 한다)")
    return out


def apply_mapping(path: Path, mapping: dict) -> dict:
    """매니페스트에 지정을 쓰고 새 매니페스트를 돌려준다. 어떤 검사든 실패하면 ValueError 이고 파일은 그대로다."""
    path = Path(path)
    lock = try_lock(path)
    if lock is None:
        raise ValueError(f"다른 프로세스가 이 회의를 쥐고 있다: {path.name}")
    try:
        manifest = json.loads(path.read_text(encoding="utf-8"))
        if manifest.get("source") != "upload":
            raise ValueError("수동 업로드 회의가 아니다 (source != upload)")
        if manifest.get("status") not in (STATUS_DIARIZED, STATUS_MAPPED):
            raise ValueError(f"status 가 diarized/mapped 가 아니다: {manifest.get('status')!r}")
        speakers = manifest.get("speakers") or []
        chosen = _normalize(mapping, [s["user_id"] for s in speakers])
        for s in speakers:
            s["member_id"] = chosen[s["user_id"]]
        manifest["status"] = STATUS_MAPPED
        manifest["mapped_at"] = now_iso()
        save_manifest(path, manifest)
        return manifest
    finally:
        lock.release()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("manifest", type=Path, help="recordings/session_upload_<ts>.json")
    ap.add_argument("mapping", type=Path, help='{"mapping": {"SPEAKER_00": "멤버ID", "SPEAKER_01": null}} 또는 안쪽 dict')
    a = ap.parse_args(argv)
    try:
        data = json.loads(a.mapping.read_text(encoding="utf-8"))
        if isinstance(data, dict) and isinstance(data.get("mapping"), dict):
            data = data["mapping"]
        m = apply_mapping(a.manifest, data)
    except (ValueError, OSError) as e:
        print(f"지정 실패: {e}", file=sys.stderr)
        return 1
    print(f"{a.manifest}  status={m['status']}  화자 {len(m['speakers'])}명 지정. "
          "워커는 업로드 회의를 아직 집지 않는다(#254·#255 인계 합의 전까지).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
