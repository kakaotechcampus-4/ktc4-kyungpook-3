"""Terra 1단계 — 전사록에서 2단계 판단까지 가볼 가치가 있는 발화를 골라낸다.

규칙 기반 1차 필터. 담당자/마감일을 실제로 파싱하는 건 여기서 하지 않는다(Phase 1 extract 몫) —
여기는 "이 문장이 Notion 문서를 바꿀 만큼 의미가 있는가"만 본다.

의도적으로 넉넉하게 통과시킨다: 애매하면 걸러내지 않고 후보로 남긴다. 여기서 놓치면 2단계까지
갈 기회 자체가 없어지지만, 여기서 잘못 통과시켜도 2단계(Notion 후보 비교 + 최종 판단)에서
걸러지므로 비용이 훨씬 적다.
"""

from __future__ import annotations

import re

from shared.schemas import JudgeFinding, Transcript

# 문장 종결(.!?) 단위로 스플릿. 구분자 자체는 버린다.
_SENTENCE_RE = re.compile(r"[^.!?]+[.!?]?")

# 실행 의지/합의/결정을 나타내는 종결 표현
_COMMIT_RE = re.compile(r"(하기로\s?했(?:습니다|어요)?|하겠습니다|게요|하죠|시죠|합시다|정했습니다)[.!]?$")
# 범위/일정 변경(추가/제외/변경/취소/보류)을 나타내는 표현
_SCOPE_RE = re.compile(r"(추가하기로|빼기로|제외하기로|취소하기로|변경하기로|보류하기로)")
# 일정 관련(상대 날짜/요일/기한) 언급
_SCHEDULE_RE = re.compile(r"(오늘|내일|모레|이번\s?주|다음\s?주|[가-힣]요일|까지)")

# 신호 패턴에 걸려도 회의 진행 발언(시작/마무리 인사, 발언 요청)이면 제외
_MEETING_TALK_RE = re.compile(r"(스탠드업|회의).*(시작|여기까지|마치|마무리)")
_FACILITATION_RE = re.compile(r"말씀해\s?주세요")


def split_sentences(text: str) -> list[str]:
    return [s.strip() for s in _SENTENCE_RE.findall(text) if s.strip()]


def _match_reason(sentence: str) -> str | None:
    if _MEETING_TALK_RE.search(sentence) or _FACILITATION_RE.search(sentence):
        return None
    if _COMMIT_RE.search(sentence):
        return "실행 의지/합의 종결 표현"
    if _SCOPE_RE.search(sentence):
        return "범위 변경 표현"
    if _SCHEDULE_RE.search(sentence):
        return "일정 관련 표현"
    return None


def extract_findings(transcript: Transcript) -> list[JudgeFinding]:
    """시간순으로 정렬된 세그먼트를 문장 단위로 훑어 규칙 기반 JudgeFinding 목록을 만든다."""
    findings: list[JudgeFinding] = []
    for seg in sorted(transcript.segments, key=lambda s: s.start):
        for sentence in split_sentences(seg.text):
            reason = _match_reason(sentence)
            if reason is None:
                continue
            findings.append(
                JudgeFinding(
                    text=sentence,
                    source=transcript.source,
                    seq=seg.seq,
                    speaker=seg.speaker,
                    reason=reason,
                    method="rules",
                )
            )
    return findings
