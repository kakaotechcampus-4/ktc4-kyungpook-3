from datetime import date

import pytest

from judge.evidence import due_status, task_status, worse

TODAY = date(2026, 3, 2)


@pytest.mark.parametrize("lines, expected", [
    (["그건 제가 이번 주 금요일까지 할게요."], "certain"),
    (["API 명세서 작성 담당이 필요합니다.", "이건 지민님이 맡아주세요."], "inferred"),
    (["로그인 화면 시안은 해주세요."], "certain"),
    (["배포 스크립트 올렸습니다."], "certain"),
    (["로그인 화면 시안 얘기 나왔었죠."], "inferred"),
    (["지민님이 해 주실 수 있을까요?"], "inferred"),
    (["시간 되면 제가 할게요."], "inferred"),
    # 1단계가 허용하는 조건부 약속 표현은 모두 inferred (리뷰 #261)
    (["여유 되면 제가 할게요."], "inferred"),
    (["필요하시면 제가 도와드릴게요. 해드릴게요."], "inferred"),
    (["이거 하면 좋겠어요."], "inferred"),
    ([], "inferred"),
])
def test_task_status(lines, expected):
    assert task_status(lines) == expected


@pytest.mark.parametrize("lines, raw, due, expected", [
    (["그건 제가 이번 주 금요일까지 할게요."], "이번 주 금요일까지", "2026-03-06", "certain"),
    (["그건 제가 이번 주 금요일 까지 할게요."], "이번 주 금요일까지", "2026-03-06", "certain"),
    (["금요일까지 할게요."], "이번 주 금요일까지", "2026-03-06", "inferred"),
    (["이번 주 금요일까지 할게요."], "이번 주 금요일까지", "2026-03-07", "inferred"),
    (["이번 주 안에 할게요."], "이번 주 안에", "2026-03-08", "inferred"),
    (["할게요."], None, "2026-03-06", "inferred"),
    (["할게요."], None, None, "missing"),
    (["금요일까지 할게요."], "금요일까지", None, "missing"),
    (["이번 주 금요일까지 할게요."], "이번 주 금요일까지", "내일쯤", "inferred"),
    (["다음 주 화요일에 할게요."], "다음 주 화요일", "2026-03-10", "certain"),
    # 경계: 꼬리말·숫자 앞뒤·줄 걸침이면 원문 그대로가 아니다
    (["다음 주 화요일쯤 할게요."], "다음 주 화요일", "2026-03-10", "inferred"),
    (["다음 주 화요일이나 수요일까지 할게요."], "다음 주 화요일", "2026-03-10", "inferred"),
    (["금요일 전후로 할게요."], "금요일", "2026-03-06", "inferred"),
    (["11월 5일까지 할게요."], "1월 5일", "2027-01-05", "inferred"),
    (["다음 주", "화요일까지 할게요."], "다음 주 화요일까지", "2026-03-10", "inferred"),
    # 더 긴 표현 안에 든 일치는 거부(리뷰 #261): "다다음" 속 "다음". 공백으로 떨어진 독립 표현은 허용
    (["다다음 주 화요일까지 할게요."], "다음 주 화요일까지", "2026-03-10", "inferred"),
    (["다다음 주 화요일에 할게요."], "다음 주 화요일", "2026-03-10", "inferred"),
    (["제가 다음 주 화요일까지 할게요."], "다음 주 화요일까지", "2026-03-10", "certain"),
    (['"다음 주 화요일까지" 할게요.'], "다음 주 화요일까지", "2026-03-10", "certain"),
])
def test_due_status(lines, raw, due, expected):
    assert due_status(lines, raw, due, TODAY) == expected


def test_worse():
    assert worse("certain", "inferred") == "inferred"
    assert worse("missing", "certain") == "missing"
    assert worse("certain", "certain") == "certain"
