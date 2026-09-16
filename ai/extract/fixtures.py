"""extract/golden_set/full_meeting.json 을 Transcript 객체로 로드.

tests/test_extract.py, tests/test_extract_llm.py 가 공유하는 전체-회의 시나리오 하나 — 실제 데이터는
JSON 하나에만 있고(extract/golden_set/eval_golden_set.py 의 채점 대상 케이스와 동일 파일), 여기서는
그걸 읽어서 Transcript 를 만드는 편의 함수만 제공한다(중복 방지).
"""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path

from shared.schemas import Transcript, TranscriptSegment

_GOLDEN_SET_DIR = Path(__file__).resolve().parent / "golden_set"
_FULL_MEETING = json.loads((_GOLDEN_SET_DIR / "full_meeting.json").read_text(encoding="utf-8"))

TODAY = date.fromisoformat(_FULL_MEETING["reference_date"])
SPEAKER_NAMES: dict[str, str] = _FULL_MEETING["speaker_names"]


def build_transcript() -> Transcript:
    segments = [
        TranscriptSegment(speaker=t["speaker"], start=float(i), end=float(i) + 0.9, text=t["text"])
        for i, t in enumerate(_FULL_MEETING["turns"])
    ]
    return Transcript(segments=segments, source="meeting")
