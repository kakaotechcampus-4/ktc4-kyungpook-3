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


def test_golden_set_labels_match_split_sentences():
    """골든셋 expected[].text 가 실제 문장 분리 결과와 1:1 로 맞는지 검사한다.

    안 맞으면 그 라벨은 어떤 findings 와도 매칭되지 않아 **조용히** 늘 같은 답으로 채점된다
    (should_flag=false 면 공짜 정답, true 면 영원한 오답). 실제로 세 건이 그 상태였다:
    한 발화가 문장 둘로 쪼개지는 경우("다들 오셨나요? 시작하겠습니다.")와 말줄임표가
    종결부호로 잘리는 경우("음... 그건~")다. judge/golden_set/README.md 도 같은 실수를
    한 번 겪었다고 적어 두었는데, 사람이 눈으로 지키는 대신 여기서 막는다.
    """
    import json
    from pathlib import Path

    golden_dir = Path(__file__).resolve().parent.parent / "judge" / "golden_set"
    mismatched: list[str] = []
    for path in sorted(golden_dir.rglob("case_*.json")):
        case = json.loads(path.read_text(encoding="utf-8"))
        actual = [s for turn in case["turns"] for s in split_sentences(turn["text"])]
        for exp in case["expected"]:
            if exp["text"] not in actual:
                mismatched.append(f"{path.parent.name}/{case['case_id']}: {exp['text']!r}")

    assert not mismatched, "실제 문장과 안 맞는 라벨:\n  " + "\n  ".join(mismatched)


# ── extract_findings_rules (정규식 폴백) ──────────────────────────────────────


def test_commit_sentence_is_flagged():
    t = _transcript(
        TranscriptSegment(speaker="mem_dongwoo", start=0.0, end=2.0,
                           text="이번 주 금요일까지 로그인 화면 시안을 마무리하기로 했습니다.", seq=1)
    )
    findings = extract_findings_rules(t)
    assert len(findings) == 1
    assert findings[0].text == "이번 주 금요일까지 로그인 화면 시안을 마무리하기로 했습니다."
    assert findings[0].evidence == findings[0].text  # 규칙 기반은 재작성 안 하니 text == evidence
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


def test_llm_path_uses_summary_as_text_and_keeps_raw_sentence_as_evidence():
    t = _transcript(
        TranscriptSegment(speaker="mem_wonjun", start=0.0, end=1.0,
                           text="로그인 화면 마감을 다음 주 화요일로 미루는 게 어때요?", seq=5),
        TranscriptSegment(speaker="mem_jimin", start=1.0, end=2.0, text="네, 알겠습니다.", seq=6),
    )
    fake = FakeLLM(responses=[{"findings": [
        {"indices": [1], "summary": "로그인 화면 마감을 다음 주 화요일로 연기하는 데 동의함", "reason": "일정 변경 합의"}
    ]}])
    findings = extract_findings_llm(t, fake)

    assert findings == [
        JudgeFinding(
            text="로그인 화면 마감을 다음 주 화요일로 연기하는 데 동의함",
            evidence="네, 알겠습니다.",
            source="meeting",
            seq=6,
            speaker="mem_jimin",
            reason="일정 변경 합의",
            method="llm",
        )
    ]
    assert len(fake.prompts) == 1  # 문장마다가 아니라 전사록 전체를 한 번에 넣었는지 확인


def test_llm_path_falls_back_to_raw_sentence_when_summary_missing():
    t = _transcript(
        TranscriptSegment(speaker="mem_dongwoo", start=0.0, end=1.0, text="그럼 그렇게 갑시다.", seq=6)
    )
    fake = FakeLLM(responses=[{"findings": [{"indices": [0], "reason": "합의 표현(문맥상)"}]}])  # summary 없음
    findings = extract_findings_llm(t, fake)

    assert findings[0].text == "그럼 그렇게 갑시다."
    assert findings[0].evidence == "그럼 그렇게 갑시다."


def test_llm_path_joins_evidence_across_lines_and_anchors_on_the_last():
    """결정이 여러 줄에 걸쳐 만들어지면 근거를 이어 붙이고, seq/speaker 는 마지막 줄을 가리킨다."""
    t = _transcript(
        TranscriptSegment(speaker="mem_yujin", start=0.0, end=1.0,
                          text="API 명세서 작성 담당이 필요합니다.", seq=3),
        TranscriptSegment(speaker="mem_haeun", start=1.0, end=2.0,
                          text="이건 지민님이 맡아주세요.", seq=4),
    )
    fake = FakeLLM(responses=[{"findings": [
        {"indices": [0, 1], "summary": "API 명세서 작성을 지민이 맡기로 함", "reason": "담당자 지정"}
    ]}])
    findings = extract_findings_llm(t, fake)

    assert len(findings) == 1
    assert findings[0].evidence == "API 명세서 작성 담당이 필요합니다. 이건 지민님이 맡아주세요."
    assert findings[0].seq == 4  # 결론을 말한 마지막 줄
    assert findings[0].speaker == "mem_haeun"


def test_llm_path_keeps_valid_indices_when_some_are_out_of_range():
    """지어낸 번호가 섞여도 나머지 근거로 결정을 살린다 — 항목을 통째로 버리지 않는다."""
    t = _transcript(
        TranscriptSegment(speaker="a", start=0.0, end=1.0, text="그럼 그렇게 갑시다.", seq=7)
    )
    fake = FakeLLM(responses=[{"findings": [{"indices": [0, 99], "reason": "합의"}]}])
    findings = extract_findings_llm(t, fake)

    assert len(findings) == 1
    assert findings[0].evidence == "그럼 그렇게 갑시다."


def test_llm_path_ignores_out_of_range_indices():
    t = _transcript(
        TranscriptSegment(speaker="a", start=0.0, end=1.0, text="안녕하세요.", seq=0)
    )
    fake = FakeLLM(responses=[{"findings": [{"indices": [99], "reason": "존재하지 않는 번호"}]}])
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
