"""실제 LLM 호출 없이(가짜 client 로) extract/llm.py 의 파이프라인 배선을 검증한다.

실제 응답 "품질"은 이 테스트로 검증할 수 없다 — extract/eval_golden_set.py --llm 으로 채점해야 한다.
여기선 배선(관련성 필터 → 구조화 추출 → 상태 판정 → 마감일 sanity check)이 맞는지만 확인한다.
"""

from extract.fixtures import SPEAKER_NAMES, TODAY, build_transcript
from extract.llm import ExtractionItem, ExtractionResult, RelevanceResult, extract_tasks


class _FakeMessage:
    def __init__(self, parsed):
        self.parsed = parsed
        self.content = parsed.model_dump_json()


class _FakeChoice:
    def __init__(self, parsed):
        self.message = _FakeMessage(parsed)


class _FakeResponse:
    def __init__(self, parsed):
        self.choices = [_FakeChoice(parsed)]


class _FakeCompletions:
    def __init__(self, responses):
        self._responses = list(responses)
        self.calls: list[dict] = []

    def parse(self, *, model, messages, response_format, temperature, **kwargs):
        self.calls.append({"model": model, "messages": messages, "response_format": response_format,
                           "temperature": temperature, **kwargs})
        return _FakeResponse(self._responses.pop(0))


class _FakeChat:
    def __init__(self, responses):
        self.completions = _FakeCompletions(responses)


class FakeChatClient:
    """client.chat.completions.parse(...) 모양만 흉내 낸 가짜 — 큐에서 순서대로 응답을 꺼내 준다."""

    def __init__(self, responses):
        self.chat = _FakeChat(responses)

    @property
    def calls(self) -> list[dict]:
        return self.chat.completions.calls


def _run(client, **kwargs):
    return extract_tasks(
        build_transcript(), client=client, model="gemini-3.8-flash",
        today=TODAY, speaker_names=SPEAKER_NAMES, **kwargs
    )


def test_first_person_keeps_type_but_no_name():
    """1인칭은 BE 가 발화자로 바로 푸니 AI 가 이름을 채우면 안 된다."""
    client = FakeChatClient([
        RelevanceResult(relevant_indices=[2]),
        ExtractionResult(items=[ExtractionItem(
            index=2,
            evidence_span="이번 주 목요일까지 리프레시 토큰 처리까지 끝낼게요.",
            reasoning="화자 본인이 하겠다고 말함",
            task_raw="리프레시 토큰 처리",
            assignee_type="first",
            assignee_mention="도윤",  # LLM 이 굳이 채워 보내도
            due_date="2026-09-10",
            due_raw="이번 주 목요일까지",
        )]),
    ])

    tasks = _run(client)

    assert len(tasks) == 1
    t = tasks[0]
    assert t.assignee_type == "first"
    assert t.assignee_mention is None  # 코드가 지운다 (BE 가 발화자로 해결)
    assert t.assignee_status == "certain"
    assert t.due_date == "2026-09-10" and t.due_status == "certain"
    assert t.method == "llm"
    assert len(client.calls) == 2  # 관련성 필터 1 + 구조화 추출 1
    # 기준일이 프롬프트에 박혔는지 — 이게 빠지면 상대 날짜가 전부 조용히 틀린다
    assert "2026-09-09" in client.calls[1]["messages"][0]["content"]


def test_pronoun_resolution_is_marked_inferred():
    """지시대명사는 문맥으로 풀었어도 '추론 필요' — PM 이 근거를 보게 한다."""
    client = FakeChatClient([
        RelevanceResult(relevant_indices=[21]),
        ExtractionResult(items=[ExtractionItem(
            index=21,
            evidence_span="세영님이 대신 맡아주시기로 했어요",
            reasoning="앞 문맥의 반응형 레이아웃을 세영이 넘겨받음",
            task_raw="반응형 레이아웃",
            assignee_type="thirdpronoun",
            assignee_mention="그분",
            assignee_resolved="세영",
        )]),
    ])

    t = _run(client)[0]
    assert t.assignee_type == "thirdpronoun"
    assert t.assignee_resolved == "세영"
    assert t.assignee_status == "inferred"
    assert t.due_status == "missing"


def test_thirdname_without_regex_backing_is_downgraded():
    """LLM 만 주장하고 원문에 'OO님'이 없으면 certain 으로 올려주지 않는다(혼합 검증)."""
    client = FakeChatClient([
        RelevanceResult(relevant_indices=[15]),  # "모레까지는 무조건 끝낼게요." — 이름이 없는 문장
        ExtractionResult(items=[ExtractionItem(
            index=15,
            evidence_span="모레까지는 무조건 끝낼게요.",
            reasoning="세영이 말했다고 판단",
            task_raw="노션 문서 정리",
            assignee_type="thirdname",
            assignee_mention="세영",  # 원문엔 "세영님"이 없다
            due_date="2026-09-11",
            due_raw="모레까지",
        )]),
    ])

    t = _run(client)[0]
    assert t.assignee_type == "thirdname"
    assert t.assignee_status == "inferred"  # 정규식이 뒷받침 못 해서 낮춤


def test_bad_due_date_is_rejected_by_sanity_check():
    """LLM 이 과거 날짜나 엉뚱한 형식을 줘도 코드가 막는다."""
    client = FakeChatClient([
        RelevanceResult(relevant_indices=[2]),
        ExtractionResult(items=[ExtractionItem(
            index=2, evidence_span="...", reasoning="...", task_raw="리프레시 토큰 처리",
            assignee_type="first",
            due_date="2020-01-01",  # 기준일보다 한참 과거
            due_raw="작년 1월",
        )]),
    ])

    t = _run(client)[0]
    assert t.due_date is None
    assert t.due_status == "missing"


def test_self_consistency_marks_wobbling_fields_inferred():
    """반복 호출에서 담당자 판단이 흔들리면 certain 으로 안 올린다."""
    stable = ExtractionItem(
        index=21, evidence_span="세영님이 대신 맡아주시기로 했어요", reasoning="재할당",
        task_raw="반응형 레이아웃", assignee_type="thirdname", assignee_mention="세영님",
    )
    wobbled = ExtractionItem(
        index=21, evidence_span="세영님이 대신 맡아주시기로 했어요", reasoning="재할당",
        task_raw="반응형 레이아웃", assignee_type="thirdname", assignee_mention="민재",
    )
    client = FakeChatClient([
        RelevanceResult(relevant_indices=[21]),
        ExtractionResult(items=[stable]),
        ExtractionResult(items=[wobbled]),
        ExtractionResult(items=[stable]),
    ])

    t = _run(client, n_samples=3)[0]
    assert t.assignee_status == "inferred"
    assert len(client.calls) == 1 + 3


def test_no_relevant_sentences_skips_extraction_call():
    client = FakeChatClient([RelevanceResult(relevant_indices=[])])

    assert _run(client) == []
    assert len(client.calls) == 1  # 구조화 추출은 호출조차 안 함(비용 절약)


def test_all_is_certain_without_mention():
    """`all`("다 같이")은 이름은 없지만 '참석자 전원'이라는 판단이 명확하다 — BE 가 전원을 채운다."""
    client = FakeChatClient([
        RelevanceResult(relevant_indices=[2]),
        ExtractionResult(items=[ExtractionItem(
            index=2,
            evidence_span="코드 컨벤션 문서는 다 같이 한번 훑어보죠.",
            reasoning="참석자 전원을 지칭",
            task_raw="코드 컨벤션 문서 검토",
            assignee_type="all",
            assignee_mention="다 같이",  # LLM 이 채워 보내도
        )]),
    ])

    t = _run(client)[0]

    assert t.assignee_type == "all"
    assert t.assignee_mention is None  # 코드가 지운다 (BE 가 참석자 전원으로 펼침)
    assert t.assignee_status == "certain"


def test_long_transcript_is_chunked_into_multiple_calls():
    """긴 회의록은 끊어서 묻는다 — 한 번에 몰아 넣으면 게이트웨이 출력 상한(6000토큰)에서
    JSON 이 잘리고 LengthFinishReasonError 로 케이스가 통째로 날아간다."""
    from shared.schemas import Transcript, TranscriptSegment
    from extract.llm import _CHUNK_SIZE, _RELEVANCE_CHUNK_SIZE, extract_tasks

    n = _RELEVANCE_CHUNK_SIZE * 2 + 1  # 관련성 2청크를 넘기는 문장 수
    transcript = Transcript(
        segments=[TranscriptSegment(speaker="A", start=float(i), end=float(i) + 0.9,
                                    text=f"작업 {i} 오늘까지 끝낼게요.") for i in range(n)],
        source="meeting",
    )
    # 관련성: 청크마다 그 청크의 인덱스를 전부 관련 있다고 답한다
    relevance = [
        RelevanceResult(relevant_indices=list(range(s, min(s + _RELEVANCE_CHUNK_SIZE, n))))
        for s in range(0, n, _RELEVANCE_CHUNK_SIZE)
    ]
    extraction = [
        ExtractionResult(items=[
            ExtractionItem(index=i, evidence_span=f"작업 {i} 오늘까지 끝낼게요.", reasoning="본인 선언",
                           task_raw=f"작업 {i}", assignee_type="first", due_date="2026-09-09")
            for i in range(s, min(s + _CHUNK_SIZE, n))
        ])
        for s in range(0, n, _CHUNK_SIZE)
    ]
    client = FakeChatClient(relevance + extraction)

    tasks = extract_tasks(transcript, client=client, model="m", today=TODAY, speaker_names={"A": "유진"})

    assert len(tasks) == n  # 청크를 넘나들어도 하나도 안 흘린다
    assert len(client.calls) == len(relevance) + len(extraction) == 3 + 5


def test_double_encoded_json_is_unwrapped():
    """게이트웨이가 JSON 을 문자열로 한 겹 더 감싸 보내도 케이스를 통째로 날리지 않는다."""
    import json as _json
    from extract.llm import _validate_json

    inner = ExtractionResult(items=[ExtractionItem(
        index=0, evidence_span="e", reasoning="r", task_raw="t", assignee_type="first",
    )]).model_dump_json()

    out = _validate_json(ExtractionResult, _json.dumps({"items": inner}))

    assert isinstance(out, ExtractionResult) and out.items[0].task_raw == "t"
