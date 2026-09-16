"""Terra 1단계 — 전사록에서 2단계 판단까지 가볼 가치가 있는 발화를 골라낸다.

Luna(get_llm("luna"))가 있으면 전사록 전체를 한 번에 넣어 필터링하고, 키가 없거나 호출이
실패하면 규칙 기반(extract_findings_rules)으로 폴백한다 — llm.py/embedding.py와 같은 원칙
("API 키 없어도 전 단계가 실행/테스트 가능해야 한다")이라, 호출자는 항상 extract_findings()만
쓰면 된다.

담당자/마감일을 실제로 파싱하는 건 여기서 하지 않는다(Phase 1 extract 몫) — 여기는
"이 문장이 Notion 문서를 바꿀 만큼 의미가 있는가"만 본다.

의도적으로 넉넉하게 통과시킨다: 애매하면 걸러내지 않고 후보로 남긴다. 여기서 놓치면 2단계까지
갈 기회 자체가 없어지지만, 여기서 잘못 통과시켜도 2단계(Notion 후보 비교 + 최종 판단)에서
걸러지므로 비용이 훨씬 적다.
"""

from __future__ import annotations

import re

from llm import LLMClient, get_llm
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

_LUNA_SYSTEM_PROMPT = (
    "너는 회의/채팅 전사록에서 Notion 문서를 갱신할 만큼 의미 있는 발화만 골라내는 필터다. "
    "일정 합의, 담당자 관련 언급, 작업 범위 변경, 프로젝트 관련 결정은 포함하고, "
    "인사/잡담/맞장구/회의 진행 멘트(시작·마무리 인사, 발언 요청)는 제외한다. "
    "애매하면 포함시켜라 — 여기서 놓치면 다음 단계에서 검토할 기회가 아예 없어진다."
)


def split_sentences(text: str) -> list[str]:
    return [s.strip() for s in _SENTENCE_RE.findall(text) if s.strip()]


def _flatten(transcript: Transcript) -> tuple[list[str], list[int], list[str | None]]:
    """세그먼트를 시간순으로 훑어 문장 단위 병렬 리스트(문장/seq/화자)를 만든다."""
    sentences: list[str] = []
    seqs: list[int] = []
    speakers: list[str | None] = []
    for seg in sorted(transcript.segments, key=lambda s: s.start):
        for sentence in split_sentences(seg.text):
            sentences.append(sentence)
            seqs.append(seg.seq)
            speakers.append(seg.speaker)
    return sentences, seqs, speakers


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


def extract_findings_rules(transcript: Transcript) -> list[JudgeFinding]:
    """규칙(정규식) 기반 1차 필터. Luna 키가 없거나 호출이 실패했을 때의 폴백."""
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


def _numbered_lines(sentences: list[str], speakers: list[str | None]) -> str:
    return "\n".join(f"[{i}] {speakers[i] or '?'}: {s}" for i, s in enumerate(sentences))


def _luna_user_prompt(numbered: str) -> str:
    return (
        "다음은 번호가 매겨진 발화 목록이다. 의미 있다고 판단한 발화의 번호와, "
        "왜 그렇게 판단했는지 짧은 이유를 JSON으로만 답하라.\n\n"
        '형식: {"findings": [{"index": 0, "reason": "..."}]}\n\n'
        f"{numbered}"
    )


def extract_findings_llm(transcript: Transcript, client: LLMClient) -> list[JudgeFinding] | None:
    """Luna로 전사록 전체를 한 번에 훑어 JudgeFinding을 뽑는다.

    청크로 안 쪼개고 전사록 전체를 한 번에 넣는다 — 경계에서 문맥이 끊기는 걸 피하기 위함
    (지민님의 Phase 1 추출기와 같은 방식). 호출 실패/파싱 실패면 None — 호출자가 규칙 기반으로
    폴백해야 한다.
    """
    sentences, seqs, speakers = _flatten(transcript)
    if not sentences:
        return []

    prompt = _LUNA_SYSTEM_PROMPT + "\n\n" + _luna_user_prompt(_numbered_lines(sentences, speakers))
    result = client.generate_json(prompt, reasoning_effort="low")
    if result is None:
        return None

    findings: list[JudgeFinding] = []
    for item in result.get("findings", []):
        idx = item.get("index")
        if not isinstance(idx, int) or not (0 <= idx < len(sentences)):
            continue  # Luna가 범위 밖 번호를 지어내면 그냥 무시 — 통째로 실패 처리하지 않는다
        findings.append(
            JudgeFinding(
                text=sentences[idx],
                source=transcript.source,
                seq=seqs[idx],
                speaker=speakers[idx],
                reason=str(item.get("reason", "")).strip()[:200],
                method="llm",
            )
        )
    return findings


def extract_findings(transcript: Transcript) -> list[JudgeFinding]:
    """Luna가 되면 그걸로, 안 되면(키 없음/호출 실패) 규칙 기반으로 폴백한다."""
    client = get_llm("luna")
    if client.name != "off":
        result = extract_findings_llm(transcript, client)
        if result is not None:
            return result
    return extract_findings_rules(transcript)
