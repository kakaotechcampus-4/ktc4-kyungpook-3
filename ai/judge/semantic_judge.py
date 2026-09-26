"""Terra 1단계 — 전사록에서 2단계 판단까지 가볼 가치가 있는 발화를 골라낸다.

Luna(get_llm("luna")) 없이는 이 판단을 대신할 방법이 없으므로, 규칙 기반 폴백을 두지 않는다
— 키가 없거나 호출/파싱이 실패하면 FindingExtractionUnavailableError 를 던진다
(final_judge.py 의 JudgeUnavailableError 와 같은 원칙). extract_findings_rules 는 프로덕션
경로에서는 더 이상 쓰이지 않고, eval_golden_set.py 가 "규칙 기반 대비 Luna가 얼마나 나은가"를
비교하는 용도로만 남아있다.

담당자/마감일을 실제로 파싱하는 건 여기서 하지 않는다(Phase 1 extract 몫) — 여기는 "이 발화가
다음 단계가 볼 가치가 있는가"와 "어느 축의 신호인가"(JudgeFinding.signal)만 본다. 축이 둘인
이유는 "문서를 바꿀 만한가" 하나로 거르면 "로그인 API 다 붙였어요" 같은 완료 보고가 문서 기준
무의미하다는 이유로 사라져서, 2단계의 status(done) 판정에 영원히 도달하지 못하기 때문이다.

의도적으로 넉넉하게 통과시킨다: 애매하면 걸러내지 않고 후보로 남긴다. 여기서 놓치면 2단계까지
갈 기회 자체가 없어지지만, 여기서 잘못 통과시켜도 2단계(Notion 후보 비교 + 최종 판단)에서
걸러지므로 비용이 훨씬 적다.
"""

from __future__ import annotations

import re

from llm import LLMClient, get_llm
from shared.schemas import FINDING_SIGNALS, SIGNAL_DECISION, JudgeFinding, Transcript


class FindingExtractionUnavailableError(RuntimeError):
    """Luna API 키가 없거나 호출/응답 파싱에 실패해 1단계 판단을 할 수 없을 때."""


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
    "너는 회의/채팅 전사록에서 다음 단계가 볼 가치가 있는 발화만 골라내는 필터다. "
    "고른 발화마다 signal 로 어느 쪽 신호인지 표시한다:\n"
    "  signal=\"decision\" — 문서에 쓸 새 내용이 있다 (일정 합의, 담당자 지정, 작업 범위 변경,"
    " 프로젝트 관련 결정)\n"
    "  signal=\"progress\" — 문서에 쓸 새 내용은 없지만 **이미 있는 작업의 진척** 신호다\n"
    "인사/잡담/맞장구/회의 진행 멘트(시작·마무리 인사, 발언 요청)는 둘 다 아니므로 제외한다. "
    "이미 하고 있거나 끝낸 작업에 대한 진행상황 공유(예: '저는 어제 로그인 API 붙였고요', "
    "'디자인 시스템 정리하고 있어요')는 signal=\"progress\" 로 포함한다 — 새 결정은 아니지만 "
    "기존 작업의 상태를 바꿀 신호라 버리면 완료 소식이 어디에도 도달하지 못한다. "
    "다만 **어떤 작업인지 문장에서 알 수 있어야** 한다 — '어제 야근했어요', '다른 작업 좀 "
    "했어요'처럼 가리키는 작업이 없으면 상태를 바꿀 대상이 없으므로 제외한다. "
    "진행상황 공유 안에 새로운 일정/담당자/범위 결정이 실제로 포함돼 있으면 그 결정 부분은 "
    "signal=\"decision\" 으로 따로 낸다. "
    "질문 형태(예: ~ 어때요?, ~할 수 있어요?)나 제안/의견 형태(예: ~하는 게 나을 것 같아요, "
    "~하면 좋겠어요)는 아직 결정된 게 아니므로 그 자체로는 포함하지 않는다 — 다만 그 제안에 "
    "대한 답변/합의가 의미 있다면, 답변 쪽 발화에 제안 내용까지 반영해서 자기완결적으로 "
    "요약한다. 질문/제안이 결론 없이 보류되면(예: '나중에 다시 얘기하죠') 둘 다 포함하지 않는다. "
    "다만 이미 정해진 것을 바꾸자는 발화는 제안 형태('~게 나을 것 같아요')여도 포함한다 — "
    "기존 결정을 흔드는 정보라 다음 단계가 반드시 봐야 한다. 제외하는 제안은 아직 아무것도 "
    "정해지지 않은 상태에서 처음 꺼내는 의견이다. "
    "조건이 붙은 약속(예: '시간 되면 접근성 점검도 해볼게요', '여유 되면 문서도 정리해둘게요', "
    "'필요하시면 디자인 쪽도 도와드릴게요')은 포함한다 — 실행 여부가 불확실한 것이지 하겠다는 "
    "말 자체가 없는 게 아니다. 남에게 묻는 제안과 달리 본인이 하겠다고 말하고 있다. "
    "산출물이 분명한 작업 요청(예: '리뷰 부탁드려요', '배포 스크립트 좀 봐주세요')도 포함한다 "
    "— 위에서 제외하라고 한 '발언 요청'은 회의를 굴리기 위한 말(예: '편하게 말씀해주세요', "
    "'각자 공유해주세요')에 한한다. "
    "생각만 하겠다는 말(예: '고민해볼게요')은 제외하되, 산출물이 붙으면(예: '고민해보고 "
    "내일까지 정리해서 공유드릴게요') 포함한다. "
    "누군가 이미 말한 결정에 대해 다른 사람이 새 정보 없이 그대로 동의/재확인만 하는 발화"
    "(예: '저도 그렇게 생각해요', '저도 그렇게 알고 있어요')는 제외한다 — 최초 결정 발화 "
    "하나면 충분하다. "
    "같은 회의 안에서 나중에 정정/번복되더라도, 정정 전 발화도 그 자체로 결정/합의였다면 "
    "포함한다 — 어느 쪽이 최종본인지 판단하는 건 다음 단계의 몫이니 여기서 미리 하나만 "
    "고르지 않는다. "
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
    """규칙(정규식) 기반 1차 필터.

    프로덕션 경로(extract_findings)에서는 더 이상 쓰이지 않는다 — eval_golden_set.py 가
    Luna(extract_findings_llm)와 나란히 돌려 정답률을 비교하는 용도로만 직접 호출한다.
    """
    # LLM 경로와 같은 _flatten 을 쓴다 — indices 가 가리키는 위치가 두 경로에서 같아야 한다.
    sentences, seqs, speakers = _flatten(transcript)
    findings: list[JudgeFinding] = []
    for i, sentence in enumerate(sentences):
        reason = _match_reason(sentence)
        if reason is None:
            continue
        findings.append(
            JudgeFinding(
                text=sentence,
                evidence=[sentence],  # 재작성 능력이 없어서 원문 그대로(text와 동일)
                indices=[i],  # 문장을 묶을 능력도 없어서 항상 한 줄
                source=transcript.source,
                seq=seqs[i],
                speaker=speakers[i],
                reason=reason,
                method="rules",
            )
        )
    return findings


def _numbered_lines(sentences: list[str], speakers: list[str | None]) -> str:
    return "\n".join(f"[{i}] {speakers[i] or '?'}: {s}" for i, s in enumerate(sentences))


def _valid_indices(item: dict, n: int) -> list[int]:
    """LLM 이 준 근거 줄 번호 중 범위 안의 것만 남겨 정렬한다.

    지어낸 번호는 버리고 나머지는 살린다 — 한 줄이 어긋났다고 항목을 통째로 버리면 결정
    자체가 사라진다. 구형 단일 index 응답도 그대로 받아준다.
    """
    raw = item.get("indices", item.get("index"))
    # bool은 int의 서브클래스라 isinstance(True, int)가 True다 — type()으로 엄격히 검사한다.
    if type(raw) is int:
        raw = [raw]
    if not isinstance(raw, list):
        return []
    return sorted({i for i in raw if type(i) is int and 0 <= i < n})


def _valid_signal(item: dict) -> str:
    """LLM 이 준 signal 을 허용값으로 좁힌다. 모르는 값이면 decision 으로 둔다.

    signal 은 라우팅용 축이라 값이 이상하다고 항목을 버리면 결정이 통째로 사라진다.
    decision 이 기본인 이유는 그쪽이 안전한 실패이기 때문이다 — progress 로 잘못 보내면
    문서 갱신 경로를 건너뛰지만, decision 으로 잘못 보내면 2단계가 한 번 더 걸러준다.
    """
    raw = item.get("signal")
    return raw if raw in FINDING_SIGNALS else SIGNAL_DECISION


def _luna_user_prompt(numbered: str) -> str:
    return (
        "다음은 번호가 매겨진 발화 목록이다. 의미 있다고 판단한 내용마다 근거가 되는 줄 번호 "
        "전부(indices)와, 앞뒤 문맥까지 반영해서 이것만 읽어도 무슨 내용인지 알 수 있게 다시 쓴 "
        "자기완결적 요약(summary), 어느 쪽 신호인지(signal), 왜 그렇게 판단했는지 짧은 "
        "이유(reason)를 JSON으로만 답하라.\n\n"
        "하나의 결정이 여러 줄에 걸쳐 만들어지면(제안 → 합의, 지시 → 수락) 그 줄 번호를 모두 "
        "indices 에 담아라. 한 줄로 끝나면 번호 하나만 담는다. 서로 다른 결정은 따로 나눈다.\n\n"
        'signal 은 "decision"(문서에 쓸 새 내용) 또는 "progress"(기존 작업의 진척) 둘 중 하나다.\n\n'
        '형식: {"findings": [{"indices": [1, 2], "summary": "...", '
        '"signal": "decision", "reason": "..."}]}\n\n'
        f"{numbered}"
    )


def extract_findings_llm(transcript: Transcript, client: LLMClient) -> list[JudgeFinding] | None:
    """Luna로 전사록 전체를 한 번에 훑어 JudgeFinding을 뽑는다.

    청크로 안 쪼개고 전사록 전체를 한 번에 넣는다 — 경계에서 문맥이 끊기는 걸 피하기 위함
    (지민님의 Phase 1 추출기와 같은 방식). 호출 실패/파싱 실패면 None — 호출자(extract_findings)가
    이걸 신뢰할 수 없는 응답으로 보고 FindingExtractionUnavailableError 를 던져야 한다.
    """
    sentences, seqs, speakers = _flatten(transcript)
    if not sentences:
        return []

    prompt = _LUNA_SYSTEM_PROMPT + "\n\n" + _luna_user_prompt(_numbered_lines(sentences, speakers))
    result = client.generate_json(prompt, reasoning_effort="low")
    if result is None:
        return None

    if "findings" not in result:
        findings_raw: list = []  # 키 자체가 없으면 "0건"으로 정상 처리
    else:
        findings_raw = result.get("findings")
        if not isinstance(findings_raw, list):
            return None  # 값은 있는데 리스트가 아니면 신뢰 불가

    findings: list[JudgeFinding] = []
    for item in findings_raw:
        if not isinstance(item, dict):
            continue  # 항목 하나가 이상해도 나머지는 살림
        idxs = _valid_indices(item, len(sentences))
        if not idxs:
            continue  # Luna가 범위 밖 번호를 지어내면 그냥 무시 — 통째로 실패 처리하지 않는다
        summary = str(item.get("summary", "")).strip()
        evidence = [sentences[i] for i in idxs]
        # 마지막 줄을 앵커로 삼는다 — "제안 → 합의" 구조에선 결론을 말한 발화가 뒤에 오고,
        # 1인칭("제가 할게요") 담당자 해소도 그 발화의 화자를 봐야 한다.
        # ponytail: 앵커가 항상 마지막이라는 보장은 없다. 어긋나면 LLM 에 anchor 를 따로 받는다.
        anchor = idxs[-1]
        findings.append(
            JudgeFinding(
                text=summary or " ".join(evidence),  # summary 비어있으면 원문으로 폴백
                evidence=evidence,
                indices=idxs,
                source=transcript.source,
                seq=seqs[anchor],
                speaker=speakers[anchor],
                signal=_valid_signal(item),
                reason=str(item.get("reason", "")).strip()[:200],
                method="llm",
            )
        )
    return findings


def extract_findings(transcript: Transcript) -> list[JudgeFinding]:
    """Luna로 1단계 판단을 한다. 키가 없거나 호출/파싱이 실패하면 FindingExtractionUnavailableError."""
    client = get_llm("luna")
    if client.name == "off":
        raise FindingExtractionUnavailableError("Luna API 키가 없어 1단계 판단을 할 수 없습니다.")
    result = extract_findings_llm(transcript, client)
    if result is None:
        raise FindingExtractionUnavailableError("Luna 응답을 파싱하지 못했습니다.")
    return result
