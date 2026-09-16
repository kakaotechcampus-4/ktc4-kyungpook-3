from judge.semantic_judge import (
    extract_findings,
    extract_findings_llm,
    extract_findings_rules,
    split_sentences,
)
from llm import FakeLLM, NullLLM
from shared.schemas import JudgeFinding, Transcript, TranscriptSegment


def _transcript(*segs: TranscriptSegment, source: str = "meeting") -> Transcript:
    return Transcript(segments=list(segs), source=source)


def test_split_sentences_drops_delimiters_and_empties():
    assert split_sentences("안녕하세요. 반갑습니다!  ") == ["안녕하세요.", "반갑습니다!"]


# ── extract_findings_rules (정규식 폴백) ──────────────────────────────────────


def test_commit_sentence_is_flagged():
    t = _transcript(
        TranscriptSegment(speaker="mem_dongwoo", start=0.0, end=2.0,
                           text="이번 주 금요일까지 로그인 화면 시안을 마무리하기로 했습니다.", seq=1)
    )
    findings = extract_findings_rules(t)
    assert len(findings) == 1
    assert findings[0].text == "이번 주 금요일까지 로그인 화면 시안을 마무리하기로 했습니다."
    assert findings[0].reason == "실행 의지/합의 종결 표현"
    assert findings[0].seq == 1
    assert findings[0].speaker == "mem_dongwoo"
    assert findings[0].source == "meeting"
    assert findings[0].method == "rules"


def test_scope_change_sentence_is_flagged():
    t = _transcript(
        TranscriptSegment(speaker="mem_jimin", start=0.0, end=2.0,
                           text="로그인 기능 범위에서 소셜 로그인은 빼기로 했어요.", seq=2)
    )
    findings = extract_findings_rules(t)
    assert len(findings) == 1
    assert findings[0].reason == "범위 변경 표현"


def test_pure_chitchat_is_not_flagged():
    t = _transcript(
        TranscriptSegment(speaker="mem_wonjun", start=0.0, end=1.0, text="네, 알겠습니다.", seq=3)
    )
    assert extract_findings_rules(t) == []


def test_meeting_facilitation_talk_is_excluded_even_if_pattern_matches():
    t = _transcript(
        TranscriptSegment(speaker="mem_yujaehwan", start=0.0, end=1.0,
                           text="오늘 스탠드업 시작하겠습니다.", seq=0)
    )
    assert extract_findings_rules(t) == []


def test_segments_are_processed_in_time_order_not_list_order():
    t = _transcript(
        TranscriptSegment(speaker="a", start=5.0, end=6.0, text="다음 주까지 끝내기로 했습니다.", seq=2),
        TranscriptSegment(speaker="b", start=0.0, end=1.0, text="내일까지 디자인 시안 드리기로 했습니다.", seq=1),
    )
    findings = extract_findings_rules(t)
    assert [f.seq for f in findings] == [1, 2]


def test_schedule_only_mention_is_flagged_generously():
    """규칙 기반이라 문맥 없이 날짜 키워드만 봐도 후보로 남긴다 — 정밀 판단은 2단계 몫."""
    t = _transcript(
        TranscriptSegment(speaker="mem_hwan", start=0.0, end=1.0, text="오늘 날씨가 좋네요.", seq=4)
    )
    findings = extract_findings_rules(t)
    assert len(findings) == 1
    assert findings[0].reason == "일정 관련 표현"


# ── extract_findings_llm (Luna) ──────────────────────────────────────────────


def test_llm_path_maps_indices_back_to_seq_and_speaker():
    t = _transcript(
        TranscriptSegment(speaker="mem_dongwoo", start=0.0, end=1.0, text="그거 좋은데요.", seq=5),
        TranscriptSegment(speaker="mem_jimin", start=1.0, end=2.0, text="그럼 그렇게 갑시다.", seq=6),
    )
    fake = FakeLLM(responses=[{"findings": [{"index": 1, "reason": "합의 표현(문맥상)"}]}])
    findings = extract_findings_llm(t, fake)

    assert findings == [
        JudgeFinding(
            text="그럼 그렇게 갑시다.",
            source="meeting",
            seq=6,
            speaker="mem_jimin",
            reason="합의 표현(문맥상)",
            method="llm",
        )
    ]
    assert len(fake.prompts) == 1  # 문장마다가 아니라 전사록 전체를 한 번에 넣었는지 확인


def test_llm_path_ignores_out_of_range_indices():
    t = _transcript(
        TranscriptSegment(speaker="a", start=0.0, end=1.0, text="안녕하세요.", seq=0)
    )
    fake = FakeLLM(responses=[{"findings": [{"index": 99, "reason": "존재하지 않는 번호"}]}])
    assert extract_findings_llm(t, fake) == []


def test_llm_path_returns_none_when_call_fails():
    t = _transcript(TranscriptSegment(speaker="a", start=0.0, end=1.0, text="안녕하세요.", seq=0))
    assert extract_findings_llm(t, NullLLM()) is None


def test_llm_path_empty_transcript_returns_empty_without_calling():
    fake = FakeLLM(responses=[{"findings": []}])
    assert extract_findings_llm(_transcript(), fake) == []
    assert fake.prompts == []  # 빈 전사록이면 호출 자체를 안 함


# ── extract_findings (디스패처: Luna 되면 Luna, 안 되면 규칙 폴백) ────────────


def test_dispatcher_uses_rules_when_llm_off(monkeypatch):
    import judge.semantic_judge as sj

    monkeypatch.setattr(sj, "get_llm", lambda which: NullLLM())
    t = _transcript(
        TranscriptSegment(speaker="a", start=0.0, end=1.0, text="내일까지 끝낼게요.", seq=0)
    )
    findings = extract_findings(t)
    assert len(findings) == 1
    assert findings[0].method == "rules"


def test_dispatcher_uses_llm_when_available(monkeypatch):
    import judge.semantic_judge as sj

    fake = FakeLLM(responses=[{"findings": [{"index": 0, "reason": "테스트"}]}])
    monkeypatch.setattr(sj, "get_llm", lambda which: fake)
    t = _transcript(
        TranscriptSegment(speaker="a", start=0.0, end=1.0, text="아무 문장.", seq=0)
    )
    findings = extract_findings(t)
    assert len(findings) == 1
    assert findings[0].method == "llm"


def test_dispatcher_falls_back_to_rules_when_llm_call_fails(monkeypatch):
    import judge.semantic_judge as sj

    fake = FakeLLM(responses=[None])  # 호출은 됐지만 파싱 실패 등으로 실패
    monkeypatch.setattr(sj, "get_llm", lambda which: fake)
    t = _transcript(
        TranscriptSegment(speaker="a", start=0.0, end=1.0, text="내일까지 끝낼게요.", seq=0)
    )
    findings = extract_findings(t)
    assert len(findings) == 1
    assert findings[0].method == "rules"
