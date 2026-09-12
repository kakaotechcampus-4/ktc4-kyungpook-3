"""extract5 골든셋(stt/eval/ground_truth/extract5_script.md) 문장을 그대로 써서
규칙 기반 추출기(extract/rules.py)의 핵심 케이스를 검증한다.

전체 신호 표(9개) 중 문장 단위로 판별 가능한 신호만 다룬다. 마감/담당자 "정정"(#3, #5 — 뒤 발화가
최종값)은 턴을 넘나드는 동일 할일 판단이 필요해 이번 이터레이션엔 없다 — 정정 발화도 그냥 별개
항목으로 추출된다(아래 turn12 에 대한 주석 참고).
"""

from datetime import date

from extract.rules import extract_tasks
from shared.schemas import Transcript, TranscriptSegment

TODAY = date(2026, 9, 9)  # 수요일 — 이번주 목=9/10, 다음주 화=9/15, 내일=9/10, 모레=9/11

SPEAKER_NAMES = {"A": "유진", "B": "도윤", "C": "하은", "D": "민재", "E": "세영"}

# extract5_script.md 진행 순서 그대로. start 는 턴 번호로만 정렬 순서를 보장하면 되므로 1씩 증가.
TURNS = [
    ("A", "자, 오늘 스탠드업 시작할게요. 어제 한 일이랑 오늘 할 일, 막히는 거 있으면 편하게 말씀해 주세요."),
    ("B", "저는 어제 로그인 API 붙였고요, 음, 이번 주 목요일까지 리프레시 토큰 처리까지 끝낼게요."),
    ("A", "좋아요. 그럼 리프레시 토큰 작업 끝나면 하은님이 코드 리뷰 한번 부탁드려요."),
    ("C", "넵 확인할게요. 근데 어제 QA 팀에서 버그 리포트가 27건이나 왔더라고요. 일단 급한 것부터 오늘 안에 세 개는 고쳐볼게요."),
    ("D", "음... 저는 어제 디자인 시스템 쪽 UI 컴포넌트 작업하다가 머지 컨플릭트가 나서 좀 헤맸어요. 그래도 오늘 중으로 PR은 올릴게요."),
    ("A", "민재님, 그거 말고 지난주 회의 때 나온 반응형 레이아웃 작업도 다음 주 화요일까지 부탁드릴게요."),
    ("E", "어 죄송해요, 좀 늦었습니다—"),
    ("B", "괜찮아요, 방금 시작했어요."),
    ("E", "저는 노션 문서 정리하는 거 오늘까지 끝낼 계획이었는데 반나절 밀렸어요. 모레까지는 무조건 끝낼게요."),
    ("A", "다들 점심 뭐 드실 거예요? 저는 오늘 국밥이요."),
    ("B", "저는 아직 점심 메뉴 고민 중이에요, 하하."),
    ("A", "아 그리고 이번 주 안으로 전체 코드 컨벤션 문서 한번 다 같이 검토하죠."),
    ("C", "아 참, 아까 말씀드린 버그 수정이요, 세 개 다 오늘 못 끝낼 것 같아서 내일 오전까지로 미룰게요."),
    ("A", "참고로 아까 민재님한테 부탁드린 반응형 레이아웃은 세영님이 대신 맡아주시기로 했어요. 민재님이 다른 일정이 있어서요."),
    ("A", "네, 오늘 스탠드업은 여기까지 할게요. 다들 수고하셨습니다."),
]


def _transcript() -> Transcript:
    segments = [
        TranscriptSegment(speaker=spk, start=float(i), end=float(i) + 0.9, text=text)
        for i, (spk, text) in enumerate(TURNS)
    ]
    return Transcript(segments=segments, source="meeting")


def _by_sentence_prefix(tasks, prefix: str):
    matches = [t for t in tasks if t.source_sentence.startswith(prefix)]
    assert len(matches) == 1, f"expected exactly 1 task starting with {prefix!r}, got {matches}"
    return matches[0]


def test_core_signals():
    tasks = extract_tasks(_transcript(), today=TODAY, speaker_names=SPEAKER_NAMES)

    # 잡담/회의 진행 발언은 추출되면 안 됨: 턴1(시작인사), 7~8의 크로스토크 인터젝션,
    # 9~10(점심 잡담), 14(마무리 인사)
    excluded_prefixes = [
        "자, 오늘 스탠드업 시작할게요",
        "어제 한 일이랑",
        "어 죄송해요",
        "괜찮아요, 방금 시작했어요",
        "다들 점심",
        "저는 오늘 국밥",
        "저는 아직 점심",
        "네, 오늘 스탠드업은 여기까지",
        "다들 수고하셨습니다",
    ]
    for prefix in excluded_prefixes:
        assert not any(t.source_sentence.startswith(prefix) for t in tasks), prefix

    # 턴2 — 본인 지칭(화자=도윤) + 상대 날짜("이번 주 목요일")
    t = _by_sentence_prefix(tasks, "저는 어제 로그인 API")
    assert t.assignee_mention == "도윤"
    assert t.due_date == "2026-09-10"
    assert "끝낼게요" in t.task and "로그인 API" not in t.task  # 근황 보고 절은 제목에서 빠짐

    # 턴3 — 3인칭 지정("하은님이"), 조건부("끝나면") 마감은 None
    t = _by_sentence_prefix(tasks, "그럼 리프레시 토큰")
    assert t.assignee_mention == "하은"
    assert t.due_date is None

    # 턴4 — 한 턴에 잡담+할일이 섞여도 할일만 추출(2건: 확인할게요/고쳐볼게요), 화자=하은
    assert not any("27건" in t.source_sentence for t in tasks)  # 근황 보고는 제외
    t_ack = _by_sentence_prefix(tasks, "넵 확인할게요")
    assert t_ack.assignee_mention == "하은"
    t_fix = _by_sentence_prefix(tasks, "일단 급한 것부터")
    assert t_fix.assignee_mention == "하은"
    assert t_fix.due_date == "2026-09-09"  # 오늘

    # 턴5 — 잡담(컨플릭트) 뒤에 할일 등장, 잡담 문장은 추출 안 됨
    assert not any("헤맸어요" in t.source_sentence for t in tasks)
    t = _by_sentence_prefix(tasks, "그래도 오늘 중으로")
    assert t.assignee_mention == "민재"
    assert t.due_date == "2026-09-09"

    # 턴6 — 3인칭 지정("민재님") + 마감("다음 주 화요일")
    t = _by_sentence_prefix(tasks, "민재님, 그거 말고")
    assert t.assignee_mention == "민재"
    assert t.due_date == "2026-09-15"

    # 턴8 — 크로스토크 뒤 할일, 마감="모레". 앞의 실패한 과거 계획 문장은 추출 안 됨
    assert not any("반나절 밀렸어요" in t.source_sentence for t in tasks)
    t = _by_sentence_prefix(tasks, "모레까지는")
    assert t.assignee_mention == "세영"
    assert t.due_date == "2026-09-11"

    # 턴11 — 담당자 특정 불가(전체/다같이), 마감도 요일 미지정("이번 주")이라 None
    t = _by_sentence_prefix(tasks, "아 그리고 이번 주 안으로")
    assert t.assignee_mention is None
    assert t.due_date is None

    # 정확히 이 신호들만큼만 추출됐는지(오탐/누락 없는지) 총 건수로 한 번 더 확인.
    # (턴12 마감 정정은 v1 범위 밖 — 별개 항목으로 하나 더 잡히는 게 현재 기대 동작)
    assert len(tasks) == 9
