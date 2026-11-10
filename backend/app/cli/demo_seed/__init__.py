"""심사용 시드 데이터(meetings.json)를 읽고 검증한다(#606).

회의 글·추출 항목·요약은 JSON 에 고정해 두고, 사람과 날짜는 자리표시자로 둔다.
  - turns[].speaker, items[].speaker_key: people 의 key (p1..p6)
  - items[].due_in_days: 회의일 기준 마감까지 일수 (실제 due_date 는 시드 단계에서 계산한다)
  - items[].evidence_seqs: turns 인덱스(= 발화 seq)
"""
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

DEFAULT_DATA_PATH = Path(__file__).with_name("meetings.json")

_REQUIRED_ITEM_KEYS = (
    "action", "task_title", "assignee_type", "evidence_seqs", "task_status", "due_status",
    "similar_count", "asr_suspects",
)
_EVIDENCE_STATUSES = {"certain", "inferred", "missing"}


class SeedDataError(ValueError):
    pass


@dataclass(frozen=True)
class SeedPerson:
    key: str
    name: str


@dataclass(frozen=True)
class SeedTurn:
    speaker: str
    text: str


@dataclass(frozen=True)
class SeedMeeting:
    title: str
    days_ago: int
    turns: list[SeedTurn]
    items: list[dict]
    summary: dict


@dataclass(frozen=True)
class SeedData:
    workspace_name: str
    people: list[SeedPerson]
    meetings: list[SeedMeeting]
    asr_terms: list[str]


def _validate_item(title: str, index: int, item: Any, turn_count: int, keys: set[str], first: bool) -> None:
    def fail(problem: str) -> SeedDataError:
        return SeedDataError(f"회의 '{title}' 항목 {index}: {problem}")

    if not isinstance(item, dict):
        raise fail("객체가 아닙니다")
    for key in _REQUIRED_ITEM_KEYS:
        if key not in item:
            raise fail(f"필수 키 {key} 가 없습니다")
    if "evidence_speaker" in item or "due_date" in item:
        raise fail("evidence_speaker·due_date 는 쓰지 않습니다(speaker_key·due_in_days 를 씁니다)")
    seqs = item["evidence_seqs"]
    if not isinstance(seqs, list) or not seqs or not all(
        isinstance(s, int) and 0 <= s < turn_count for s in seqs
    ):
        raise fail(f"evidence_seqs 가 발화 범위(0~{turn_count - 1}) 밖입니다: {seqs}")
    speaker_key = item.get("speaker_key")
    if speaker_key is not None and speaker_key not in keys:
        raise fail(f"모르는 speaker_key: {speaker_key}")
    if item["assignee_type"] == "first" and speaker_key is None:
        raise fail("assignee_type first 는 speaker_key 가 필요합니다")
    due_in_days = item.get("due_in_days")
    if due_in_days is not None and (
        isinstance(due_in_days, bool) or not isinstance(due_in_days, int) or due_in_days < 0
    ):
        raise fail("due_in_days 는 0 이상의 정수여야 합니다")
    if item["task_status"] not in _EVIDENCE_STATUSES or item["due_status"] not in _EVIDENCE_STATUSES:
        raise fail("task_status·due_status 는 certain/inferred/missing 이어야 합니다")
    if (item["due_status"] == "missing") != (due_in_days is None):
        raise fail("due_status 가 missing 일 때만 due_in_days 가 없어야 합니다")
    if first:
        auto_shaped = (
            item["task_status"] == "certain"
            and item["due_status"] in ("certain", "missing")
            and item["similar_count"] == 0
            and item["asr_suspects"] == []
            and item["assignee_type"] == "first"
        )
        if not auto_shaped:
            raise fail("첫 항목은 auto 조건(certain·similar_count 0·asr_suspects 비움·first)이어야 합니다")


def _parse(raw: Any) -> SeedData:
    if not isinstance(raw, dict):
        raise SeedDataError("최상위가 객체가 아닙니다")
    try:
        people = [SeedPerson(key=p["key"], name=p["name"]) for p in raw["people"]]
        workspace_name = raw["workspace_name"]
        raw_meetings = raw["meetings"]
        asr_terms = list(raw["asr_terms"])
    except (KeyError, TypeError) as exc:
        raise SeedDataError(f"필수 항목이 없거나 모양이 다릅니다: {exc!r}") from exc

    keys = {p.key for p in people}
    if len(keys) != len(people) or len(people) != 6:
        raise SeedDataError("people 은 key 가 서로 다른 6명이어야 합니다")
    if len({p.name for p in people}) != len(people):
        raise SeedDataError("people 이름이 겹칩니다")

    meetings: list[SeedMeeting] = []
    for raw_meeting in raw_meetings:
        try:
            title = raw_meeting["title"]
            turns = [SeedTurn(speaker=t["speaker"], text=t["text"]) for t in raw_meeting["turns"]]
            meeting = SeedMeeting(
                title=title, days_ago=raw_meeting["days_ago"], turns=turns,
                items=list(raw_meeting["items"]), summary=dict(raw_meeting["summary"]),
            )
        except (KeyError, TypeError) as exc:
            raise SeedDataError(f"회의 모양이 다릅니다: {exc!r}") from exc
        if not turns or not meeting.items:
            raise SeedDataError(f"회의 '{title}': turns 와 items 가 비어 있습니다")
        for turn in turns:
            if turn.speaker not in keys:
                raise SeedDataError(f"회의 '{title}': 모르는 화자 key {turn.speaker}")
        if not meeting.summary.get("overview"):
            raise SeedDataError(f"회의 '{title}': summary.overview 가 없습니다")
        for index, item in enumerate(meeting.items):
            _validate_item(title, index, item, len(turns), keys, first=index == 0)
        meetings.append(meeting)

    if len({m.title for m in meetings}) != len(meetings):
        raise SeedDataError("회의 제목이 겹칩니다")
    days = [m.days_ago for m in meetings]
    if len(set(days)) != len(days) or not all(
        isinstance(d, int) and not isinstance(d, bool) and 1 <= d <= 30 for d in days
    ):
        raise SeedDataError("days_ago 는 서로 다른 1~30 의 정수여야 합니다")
    if not asr_terms or len(set(asr_terms)) != len(asr_terms) or not all(
        isinstance(t, str) and 1 <= len(t.strip()) <= 30 for t in asr_terms
    ):
        raise SeedDataError("asr_terms 는 1~30자, 중복 없는 문자열이어야 합니다")
    return SeedData(workspace_name=workspace_name, people=people, meetings=meetings, asr_terms=asr_terms)


def load_seed_data(path: Path = DEFAULT_DATA_PATH) -> SeedData:
    try:
        raw = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise SeedDataError(f"시드 파일을 읽지 못했습니다: {exc}") from exc
    return _parse(raw)
