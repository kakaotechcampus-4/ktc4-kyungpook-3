import pytest

from judge.semantic_judge import (
    FindingExtractionUnavailableError,
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


def test_golden_set_labels_cover_every_sentence():
    """골든셋 expected[].text 와 실제 문장 분리 결과가 **양방향으로** 1:1 인지 검사한다.

    라벨 → 문장 방향이 깨지면 그 라벨은 어떤 findings 와도 매칭되지 않아 **조용히** 늘 같은
    답으로 채점된다 (should_flag=false 면 공짜 정답, true 면 영원한 오답). 실제로 세 건이 그
    상태였다: 한 발화가 문장 둘로 쪼개지는 경우("다들 오셨나요? 시작하겠습니다.")와
    말줄임표가 종결부호로 잘리는 경우("음... 그건~")다.

    문장 → 라벨 방향이 깨지면 그 문장을 후보로 내도 채점기가 볼 대상이 없어 **오탐이 사라진다.**
    지금은 전 케이스가 100% 덮여 있지만 그걸 지키는 장치가 없어서, 라벨을 빠뜨린 케이스를
    새로 추가하면 그 문장의 오탐이 조용히 점수에서 빠진다. 채점기(eval_golden_set._score)도
    라벨 밖 출력을 오답으로 세지만, 애초에 라벨이 빠지지 않게 하는 게 먼저다.

    judge/golden_set/README.md 도 같은 실수를 한 번 겪었다고 적어 두었는데, 사람이 눈으로
    지키는 대신 여기서 막는다.
    """
    import json
    from pathlib import Path

    golden_dir = Path(__file__).resolve().parent.parent / "judge" / "golden_set"
    problems: list[str] = []
    for path in sorted(golden_dir.rglob("case_*.json")):
        case = json.loads(path.read_text(encoding="utf-8"))
        actual = [s for turn in case["turns"] for s in split_sentences(turn["text"])]
        labeled = {e["text"] for e in case["expected"]}
        where = f"{path.parent.name}/{case['case_id']}"
        for exp in case["expected"]:
            if exp["text"] not in actual:
                problems.append(f"{where}: 라벨이 실제 문장에 없음 — {exp['text']!r}")
        for sentence in actual:
            if sentence not in labeled:
                problems.append(f"{where}: 문장에 라벨이 없음 — {sentence!r}")

    assert not problems, "골든셋 라벨과 문장이 어긋남:\n  " + "\n  ".join(problems)


def test_scorer_counts_unlabeled_and_duplicate_outputs():
    """채점기가 라벨 밖 출력과 중복 출력을 오답으로 세는지.

    라벨만 순회하던 시절엔 둘 다 점수에 안 잡혔다 — 골든셋에 없는 문장을 후보로 내도,
    한 결정을 두 건으로 쪼개 내도 만점이었다. 특히 중복은 indices 도입으로 고치려던
    문제 그 자체라, 채점기가 못 보면 고쳤는지 확인할 방법이 없다.
    """
    from judge.eval_golden_set import _score

    case = {"expected": [
        {"text": "내일까지 끝내기로 했습니다.", "should_flag": True},
        {"text": "점심 뭐 드세요?", "should_flag": False},
    ]}

    correct, total, mistakes = _score(case, [["내일까지 끝내기로 했습니다."]])
    assert (correct, total) == (2, 2)
    assert mistakes == []

    # 라벨에 없는 문장을 후보로 냄 → 분모만 늘어 점수가 깎인다
    correct, total, mistakes = _score(
        case, [["내일까지 끝내기로 했습니다."], ["라벨에 없는 문장입니다."]]
    )
    assert (correct, total) == (2, 3)
    assert any("라벨에 없는" in m for m in mistakes)

    # 같은 앵커로 두 건 → 중복 1건이 오답
    correct, total, mistakes = _score(case, [["내일까지 끝내기로 했습니다."]] * 2)
    assert (correct, total) == (2, 3)
    assert any("같은 앵커로 2건" in m for m in mistakes)


def test_scorer_separates_hit_from_anchor():
    """정답 판정(근거 어디에든)과 오탐 판정(앵커일 때만)을 분리하는지.

    한 결정이 두 문장에 걸치고 골든셋이 둘 다 True 로 라벨하면 앵커는 하나뿐이라,
    앵커 기준으로만 재면 나머지 하나가 구조적으로 영원히 놓침이 된다(long/case_03 실측).
    반대로 근거에 딸려온 문장까지 전부 후보로 세면 제안·질문이 통째로 오탐이 된다(실측 8건).
    """
    from judge.eval_golden_set import _score

    # 결정 하나가 두 문장에 걸쳐 있고 둘 다 True 라벨 — 앵커가 아닌 쪽도 정답이어야 한다
    case = {"expected": [
        {"text": "로그인 마감은 이번 주 목요일로 하기로 했습니다.", "should_flag": True},
        {"text": "네, 그리고 담당자는 저로 하겠습니다.", "should_flag": True},
    ]}
    correct, total, _ = _score(case, [[
        "로그인 마감은 이번 주 목요일로 하기로 했습니다.",
        "네, 그리고 담당자는 저로 하겠습니다.",
    ]])
    assert (correct, total) == (2, 2)

    # 제안이 합의와 한 건으로 묶인 경우 — 제안(False 라벨)은 앵커가 아니므로 오탐이 아니다
    case = {"expected": [
        {"text": "마감을 금요일로 당기는 게 어때요?", "should_flag": False},
        {"text": "네 그렇게 하시죠.", "should_flag": True},
    ]}
    correct, total, _ = _score(case, [["마감을 금요일로 당기는 게 어때요?", "네 그렇게 하시죠."]])
    assert (correct, total) == (2, 2)

    # 같은 문장이 앵커로 나오면 오탐으로 잡혀야 한다
    case = {"expected": [{"text": "마감을 금요일로 당기는 게 어때요?", "should_flag": False}]}
    correct, total, _ = _score(case, [["마감을 금요일로 당기는 게 어때요?"]])
    assert (correct, total) == (0, 1)


# ── extract_findings_rules (정규식 폴백) ──────────────────────────────────────


def test_commit_sentence_is_flagged():
    t = _transcript(
        TranscriptSegment(speaker="mem_dongwoo", start=0.0, end=2.0,
                           text="이번 주 금요일까지 로그인 화면 시안을 마무리하기로 했습니다.", seq=1)
    )
    findings = extract_findings_rules(t)
    assert len(findings) == 1
    assert findings[0].text == "이번 주 금요일까지 로그인 화면 시안을 마무리하기로 했습니다."
    assert findings[0].evidence == [findings[0].text]  # 규칙 기반은 재작성 안 하니 text == evidence
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
            evidence=["네, 알겠습니다."],
            indices=[1],
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
    assert findings[0].evidence == ["그럼 그렇게 갑시다."]


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
    assert findings[0].evidence == ["API 명세서 작성 담당이 필요합니다.", "이건 지민님이 맡아주세요."]
    assert findings[0].indices == [0, 1]
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
    assert findings[0].evidence == ["그럼 그렇게 갑시다."]


def test_llm_path_ignores_out_of_range_indices():
    t = _transcript(
        TranscriptSegment(speaker="a", start=0.0, end=1.0, text="안녕하세요.", seq=0)
    )
    fake = FakeLLM(responses=[{"findings": [{"indices": [99], "reason": "존재하지 않는 번호"}]}])
    assert extract_findings_llm(t, fake) == []


def test_llm_path_reads_signal_and_defaults_to_decision():
    """signal 을 읽어 담고, 값이 없거나 모르는 값이면 decision 으로 둔다.

    signal 은 라우팅 축이라 값이 이상하다고 항목을 버리면 결정이 통째로 사라진다.
    decision 이 기본인 이유는 그쪽이 안전한 실패라서다 — progress 로 잘못 보내면 문서 갱신
    경로를 건너뛰지만, decision 으로 잘못 보내면 2단계가 한 번 더 걸러준다.
    """
    t = _transcript(
        TranscriptSegment(speaker="a", start=0.0, end=1.0, text="로그인 API 다 붙였어요.", seq=1),
        TranscriptSegment(speaker="b", start=1.0, end=2.0, text="금요일까지 하기로 했습니다.", seq=2),
        TranscriptSegment(speaker="c", start=2.0, end=3.0, text="문서도 정리해뒀어요.", seq=3),
    )
    fake = FakeLLM(responses=[{"findings": [
        {"indices": [0], "signal": "progress", "reason": "완료 보고"},
        {"indices": [1], "signal": "decision", "reason": "일정 합의"},
        {"indices": [2], "signal": "무슨값", "reason": "모르는 값"},
    ]}])
    findings = extract_findings_llm(t, fake)

    assert [f.signal for f in findings] == ["progress", "decision", "decision"]


def test_progress_report_reaches_the_next_stage():
    """완료 보고가 1단계에서 사라지지 않는지 — 이 PR 의 핵심.

    축이 "문서를 바꿀 만한가" 하나뿐이던 시절엔 완료 보고가 문서 기준 무의미하다는 이유로
    걸러져서, 2단계의 status(done) 판정에 영원히 도달하지 못했다.
    """
    t = _transcript(
        TranscriptSegment(speaker="a", start=0.0, end=1.0, text="로그인 API 다 붙였어요.", seq=1)
    )
    fake = FakeLLM(responses=[{"findings": [
        {"indices": [0], "summary": "로그인 API 연동을 완료함", "signal": "progress", "reason": "완료 보고"}
    ]}])
    findings = extract_findings_llm(t, fake)

    assert len(findings) == 1
    assert findings[0].signal == "progress"
    assert findings[0].evidence == ["로그인 API 다 붙였어요."]


def test_llm_path_reads_assignee_and_keeps_raw_apart_from_resolved():
    """담당자 호칭 분류를 담되, 원문 표현과 해소된 이름을 섞지 않는지.

    "너"를 이름 자리에 넣으면 BE 의 별칭 조회(MemberAlias.alias_text 완전일치)가 영원히
    실패한다. first/group/none 은 가리킨 말이 없으므로 raw 를 지운다 — 특히 first 는 BE 가
    evidence_speaker(화자 uid)로 푸는데 raw 가 같이 오면 BE 분기가 그쪽을 먼저 본다.
    """
    t = _transcript(
        TranscriptSegment(speaker="a", start=0.0, end=1.0, text="이건 지민님이 맡아주세요.", seq=1),
        TranscriptSegment(speaker="b", start=1.0, end=2.0, text="결제는 제가 할게요.", seq=2),
        TranscriptSegment(speaker="a", start=2.0, end=3.0, text="그럼 이건 너가 해줘.", seq=3),
    )
    fake = FakeLLM(responses=[{"findings": [
        {"indices": [0], "assignee_type": "thirdname", "assignee_raw": "지민님", "reason": "이름 지정"},
        {"indices": [1], "assignee_type": "first", "assignee_raw": "제가", "reason": "1인칭"},
        {"indices": [2], "assignee_type": "second", "assignee_raw": "너", "assignee_resolved": "민재",
         "reason": "상대 지칭"},
    ]}])
    findings = extract_findings_llm(t, fake)

    assert [(f.assignee_type, f.assignee_raw, f.assignee_resolved) for f in findings] == [
        ("thirdname", "지민님", None),
        ("first", None, None),        # 화자 자신이라 raw 를 지운다
        ("second", "너", "민재"),      # 원문과 해소된 이름을 둘 다, 따로
    ]


def test_llm_path_leaves_assignee_unset_when_type_is_unknown():
    """모르는 타입이면 셋 다 None — "none"(담당자 언급 없음)으로 떨어뜨리지 않는다.

    판정 실패와 "담당자가 없다"는 다른 상태다. 섞으면 나중에 구분할 방법이 없다.
    """
    t = _transcript(
        TranscriptSegment(speaker="a", start=0.0, end=1.0, text="금요일까지 하기로 했습니다.", seq=1)
    )
    fake = FakeLLM(responses=[{"findings": [
        {"indices": [0], "assignee_type": "무슨값", "assignee_raw": "지민님", "reason": "모르는 타입"}
    ]}])
    f = extract_findings_llm(t, fake)[0]

    assert (f.assignee_type, f.assignee_raw, f.assignee_resolved) == (None, None, None)


def test_golden_set_assignee_labels_are_valid():
    """골든셋 assignee_type 라벨이 허용값이고 should_flag=True 에만 붙어 있는지."""
    import json
    from pathlib import Path as _P

    from shared.schemas import ASSIGNEE_TYPES

    golden_dir = _P(__file__).resolve().parent.parent / "judge" / "golden_set"
    problems: list[str] = []
    for path in sorted(golden_dir.rglob("case_*.json")):
        case = json.loads(path.read_text(encoding="utf-8"))
        where = f"{path.parent.name}/{case['case_id']}"
        for exp in case["expected"]:
            a = exp.get("assignee_type")
            if a is None:
                continue
            if a not in ASSIGNEE_TYPES:
                problems.append(f"{where}: 허용되지 않은 assignee_type {a!r} — {exp['text']!r}")
            if not exp["should_flag"]:
                problems.append(f"{where}: 고르지도 않을 문장에 assignee_type — {exp['text']!r}")

    assert not problems, "골든셋 assignee_type 라벨 문제:\n  " + "\n  ".join(problems)


def test_golden_set_signal_labels_are_valid():
    """골든셋의 signal 라벨이 허용값인지, should_flag=True 인 라벨에만 붙어 있는지."""
    import json
    from pathlib import Path as _P

    from shared.schemas import FINDING_SIGNALS

    golden_dir = _P(__file__).resolve().parent.parent / "judge" / "golden_set"
    problems: list[str] = []
    for path in sorted(golden_dir.rglob("case_*.json")):
        case = json.loads(path.read_text(encoding="utf-8"))
        where = f"{path.parent.name}/{case['case_id']}"
        for exp in case["expected"]:
            sig = exp.get("signal")
            if sig is None:
                continue
            if sig not in FINDING_SIGNALS:
                problems.append(f"{where}: 허용되지 않은 signal {sig!r} — {exp['text']!r}")
            if not exp["should_flag"]:
                problems.append(f"{where}: 고르지도 않을 문장에 signal 이 붙음 — {exp['text']!r}")

    assert not problems, "골든셋 signal 라벨 문제:\n  " + "\n  ".join(problems)


def test_llm_path_ignores_bool_indices():
    # bool은 int의 서브클래스라 isinstance(i, int) 검사만으로는 True/False가 0/1번 문장으로
    # 잘못 통과할 수 있다 — type()으로 엄격히 걸러지는지 확인한다.
    t = _transcript(
        TranscriptSegment(speaker="a", start=0.0, end=1.0, text="안녕하세요.", seq=0),
        TranscriptSegment(speaker="b", start=1.0, end=2.0, text="반갑습니다.", seq=1),
    )
    fake = FakeLLM(responses=[{"findings": [{"indices": [True, False], "reason": "타입 오염"}]}])
    assert extract_findings_llm(t, fake) == []


def test_llm_path_returns_none_when_call_fails():
    t = _transcript(TranscriptSegment(speaker="a", start=0.0, end=1.0, text="안녕하세요.", seq=0))
    assert extract_findings_llm(t, NullLLM()) is None


def test_llm_path_empty_transcript_returns_empty_without_calling():
    fake = FakeLLM(responses=[{"findings": []}])
    assert extract_findings_llm(_transcript(), fake) == []
    assert fake.prompts == []  # 빈 전사록이면 호출 자체를 안 함


def test_llm_path_treats_missing_findings_key_as_empty():
    # {} 처럼 findings 키 자체가 없으면 "0건"으로 정상 처리한다 — 실패가 아니다.
    t = _transcript(TranscriptSegment(speaker="a", start=0.0, end=1.0, text="안녕하세요.", seq=0))
    fake = FakeLLM(responses=[{}])
    assert extract_findings_llm(t, fake) == []


def test_llm_path_returns_none_when_findings_is_null():
    # 키는 있는데 값이 None/리스트가 아니면 신뢰할 수 없는 응답 → None(실패)으로 구분한다.
    t = _transcript(TranscriptSegment(speaker="a", start=0.0, end=1.0, text="안녕하세요.", seq=0))
    fake = FakeLLM(responses=[{"findings": None}])
    assert extract_findings_llm(t, fake) is None


def test_llm_path_skips_non_dict_items_but_keeps_valid_ones():
    t = _transcript(
        TranscriptSegment(speaker="a", start=0.0, end=1.0, text="안녕하세요.", seq=0),
        TranscriptSegment(speaker="b", start=1.0, end=2.0, text="그럼 그렇게 갑시다.", seq=1),
    )
    fake = FakeLLM(responses=[{"findings": [1, {"indices": [1], "reason": "정상"}]}])
    findings = extract_findings_llm(t, fake)
    assert len(findings) == 1
    assert findings[0].evidence == ["그럼 그렇게 갑시다."]


# ── extract_findings (디스패처: 규칙 기반 폴백 없음, Terra와 같은 원칙) ────────


def test_dispatcher_raises_when_llm_off(monkeypatch):
    import judge.semantic_judge as sj

    monkeypatch.setattr(sj, "get_llm", lambda which: NullLLM())
    t = _transcript(
        TranscriptSegment(speaker="a", start=0.0, end=1.0, text="내일까지 끝낼게요.", seq=0)
    )
    with pytest.raises(FindingExtractionUnavailableError):
        extract_findings(t)


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


def test_dispatcher_raises_when_llm_call_fails(monkeypatch):
    import judge.semantic_judge as sj

    fake = FakeLLM(responses=[None])  # 호출은 됐지만 파싱 실패 등으로 실패
    monkeypatch.setattr(sj, "get_llm", lambda which: fake)
    t = _transcript(
        TranscriptSegment(speaker="a", start=0.0, end=1.0, text="내일까지 끝낼게요.", seq=0)
    )
    with pytest.raises(FindingExtractionUnavailableError):
        extract_findings(t)
