"""Phase 1 — 규칙 기반 할일 추출 (v1: 핵심 케이스만).

`stt/eval/ground_truth/extract5_script.md` 골든셋 표의 신호 중 문장 단위로 판별 가능한 것만 다룬다:
본인 지칭, 3인칭 지정, 잡담 필터링, 담당자 불명(전체/다같이), 상대 날짜 해석("오늘"·"내일"·"모레"·
"이번 주/다음 주 <요일>"). 같은 할일에 대한 마감/담당자 **정정**(뒤 발화가 최종값)은 턴을 넘나드는
동일성 판단이 필요해 다음 이터레이션으로 미룬다 — 지금은 정정 발화도 별개 항목으로 추출된다.

담당자를 실제 member_id 로 매칭하는 건 BE(backend/app/services/matching.py)의 책임이다. 여기서는
원문 멘션 텍스트(assignee_mention)만 뽑는다 — discord_user_id 같은 플랫폼 타입은 여전히 opaque 문자열로만
다룬다(CLAUDE.md 플랫폼 격리 원칙).
"""

from __future__ import annotations

import re
from datetime import date

from extract.dates import parse_due_date
from shared.config import today as _config_today
from shared.schemas import ExtractedTask, Transcript

# 문장 종결(.!?) 단위로 스플릿. 구분자 자체는 버린다.
_SENTENCE_RE = re.compile(r"[^.!?]+[.!?]?")

# 실행 의지/요청/제안을 나타내는 종결 표현 (문장 끝 기준)
_ACTIONABLE_RE = re.compile(r"(게요|겠습니다|해\s?주세요|부탁드립니다|부탁드려요|하죠|시죠)[.!]?$")

# 종결 표현이 맞아도 할일이 아닌 회의 진행 발언(시작/마무리 인사, 발언 요청)은 제외
_MEETING_TALK_RE = re.compile(r"(스탠드업|회의).*(시작|여기까지|마치|마무리)")
_FACILITATION_RE = re.compile(r"말씀해\s?주세요")

# "다 같이/모두/전체/다들" — 특정 개인이 아니라 담당자 불명으로 처리
_GROUP_RE = re.compile(r"다\s?같이|모두|전체|다들")

# "OO님" 형태(3인칭 지정 또는 호명) — 조사(이/한테/께 등) 유무와 무관하게 이름만 뽑는다
_ASSIGNEE_RE = re.compile(r"([가-힣]{2,4})님")


def split_sentences(text: str) -> list[str]:
    return [s.strip() for s in _SENTENCE_RE.findall(text) if s.strip()]


def _is_actionable(sentence: str) -> bool:
    if _MEETING_TALK_RE.search(sentence) or _FACILITATION_RE.search(sentence):
        return False
    return bool(_ACTIONABLE_RE.search(sentence))


def _task_title(sentence: str) -> str:
    """콤마로 나뉜 절 중 실행 의지가 담긴 마지막 절만 제목으로 삼는다.

    ("저는 어제 API 붙였고요, 이번 주 목요일까지 끝낼게요." → 앞의 근황 보고 절은 버리고
    "이번 주 목요일까지 끝낼게요."만 제목으로 남김)
    """
    clauses = [c.strip() for c in sentence.split(",") if c.strip()]
    for clause in reversed(clauses):
        if _ACTIONABLE_RE.search(clause):
            return clause
    return sentence


def find_explicit_name(sentence: str) -> str | None:
    """문장에 "OO님" 형태로 이름이 **원문 그대로** 박혀 있으면 그 이름을 돌려준다.

    LLM 경로(extract/llm.py)에서도 교차검증용으로 쓴다 — LLM 이 thirdname 이라고 분류했는데
    정규식이 같은 이름을 못 찾으면, 근거가 약한 것으로 보고 상태를 inferred 로 낮춘다.
    """
    m = _ASSIGNEE_RE.search(sentence)
    return m.group(1) if m else None


def _classify_assignee(sentence: str, speaker_name: str | None) -> tuple[str, str | None]:
    """(assignee_type, assignee_mention) — 규칙으로 판별 가능한 범위까지만.

    정규식으로는 second/thirdpronoun/thirdrole 을 신뢰성 있게 못 가른다(그건 LLM 경로의 몫).
    여기선 확실한 것만: 그룹 지칭 / 원문에 박힌 "OO님" / 그 외 본인 지칭.
    """
    if _GROUP_RE.search(sentence):
        return "group", None  # 할일은 맞지만 담당자는 PM 이 지정해야 함
    name = find_explicit_name(sentence)
    if name:
        return "thirdname", name
    if speaker_name:
        return "first", None  # first 는 BE 가 발화자로 바로 푸니 이름을 채우지 않는다
    return "none", None


def _confidence(task_status: str, assignee_status: str, due_status: str) -> float:
    score = {"certain": 1.0, "inferred": 0.6, "missing": 0.3}
    return round(min(score[task_status], score[assignee_status], score[due_status]), 2)


def extract_tasks(
    transcript: Transcript,
    *,
    today: date | None = None,
    speaker_names: dict[str, str] | None = None,
) -> list[ExtractedTask]:
    """시간순으로 정렬된 세그먼트를 문장 단위로 훑어 규칙 기반 ExtractedTask 목록을 만든다.

    speaker_names: {platform_user_id(opaque) -> 표시 이름}. 본인 지칭 케이스에서 담당자 멘션을
    채우는 데만 쓰고, 그 외엔 discord_user_id 를 그대로 opaque 문자열로 취급한다.
    """
    ref_date = today if today is not None else _config_today()
    names = speaker_names or {}

    results: list[ExtractedTask] = []
    for seg in sorted(transcript.segments, key=lambda s: s.start):
        speaker_name = names.get(seg.speaker) if seg.speaker else None
        for sentence in split_sentences(seg.text):
            if not _is_actionable(sentence):
                continue
            assignee_type, mention = _classify_assignee(sentence, speaker_name)
            due = parse_due_date(sentence, ref_date)

            # 규칙 경로는 원문에 박힌 것만 보므로 추론(inferred) 상태가 나올 일이 없다:
            # 잡았으면 certain, 못 잡았으면 missing.
            assignee_status = "certain" if assignee_type in {"first", "thirdname"} else "missing"
            due_status = "certain" if due else "missing"
            results.append(
                ExtractedTask(
                    task=_task_title(sentence),
                    assignee_member_id=None,
                    due_date=due.isoformat() if due else None,
                    confidence=_confidence("certain", assignee_status, due_status),
                    assignee_mention=mention,
                    source_sentence=sentence,
                    method="rules",
                    assignee_type=assignee_type,
                    due_raw=None,  # 규칙 파서는 원문 조각을 따로 보관하지 않는다
                    task_status="certain",
                    assignee_status=assignee_status,
                    due_status=due_status,
                )
            )
    return results
