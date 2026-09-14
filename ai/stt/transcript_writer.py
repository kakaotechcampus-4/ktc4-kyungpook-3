"""회의록 두 벌을 만든다.

transcript.jsonl  발화별 레코드. BE 계약(TranscriptSegment)과 같은 모양
transcript.md     사람이 읽는 것. 시간순과 화자별 두 절
"""

from __future__ import annotations

import json
from pathlib import Path

from shared.schemas import TranscriptSegment
from stt.session import Line


def _clock(ms: int) -> str:
    total = ms // 1000
    return f"{total // 60:02d}:{total % 60:02d}"


def _display_name(ln: Line) -> str:
    # speaker_name 이 빈 문자열이면 화자 ID 로 대신한다. "### " 같은 빈 절 제목을 막는다.
    return ln.speaker_name or ln.speaker_id


def _md_text(text: str) -> str:
    # 발화 안에 개행이 있으면 그 지점에서 글머리표 목록이 끊긴다. 한 줄로 편다.
    return " ".join(text.splitlines())


def write_transcript(lines: list[Line], out_dir: Path, meeting_id: str) -> dict[str, Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    finals = sorted((ln for ln in lines if ln.final), key=lambda ln: (ln.start_ms, ln.speaker_id))

    jsonl_path = out_dir / "transcript.jsonl"
    with jsonl_path.open("w", encoding="utf-8") as f:
        for ln in finals:
            seg = TranscriptSegment(
                speaker=ln.speaker_id,
                start=ln.start_ms / 1000,
                end=ln.end_ms / 1000,
                text=ln.text,
                seq=ln.seq,
            )
            f.write(json.dumps(seg.to_dict(), ensure_ascii=False) + "\n")

    md = [f"# 회의 전사 {meeting_id}", "", "## 시간순", ""]
    for ln in finals:
        md.append(f"- `[{_clock(ln.start_ms)}]` **{_display_name(ln)}** {_md_text(ln.text)}")

    md += ["", "## 화자별", ""]
    by_speaker: dict[str, list[Line]] = {}
    for ln in finals:
        by_speaker.setdefault(_display_name(ln), []).append(ln)
    for name, items in by_speaker.items():
        md.append(f"### {name}")
        for ln in items:
            md.append(f"- `[{_clock(ln.start_ms)}]` {_md_text(ln.text)}")
        md.append("")

    md_path = out_dir / "transcript.md"
    md_path.write_text("\n".join(md) + "\n", encoding="utf-8")
    return {"jsonl": jsonl_path, "markdown": md_path}
