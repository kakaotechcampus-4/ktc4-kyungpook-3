"""승인 때 별칭을 학습하는 서비스(#459)의 글자 다듬기·상수 규칙."""
import pytest

from app.models import ExtractionAction, ExtractionItem
from app.services import alias_learning


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("하은이가", "하은"),
        ("지민님이", "지민"),
        ("BE 리더가", "BE 리더"),
        # "은"은 떼지 않는다. 이름 끝 글자인 경우가 많아 "하은"을 "하"로 만들 수 있다
        ("하은은", "하은은"),
        ("선생님께서", "선생"),
        # 조사는 한 번만 뗀다
        ("하은이가가", "하은이가"),
        (" 지민 님 ", "지민"),
        ("BE  리더", "BE 리더"),
        ("민이", "민"),
        ("지민님", "지민"),
        ("하은한테", "하은"),
        ("하은을", "하은"),
        # 떼고 나면 남는 글자가 없는 것은 별칭이 될 수 없다
        ("님", None),
        ("이", None),
        ("", None),
        ("   ", None),
        (None, None),
    ],
)
def test_trim_alias_text(raw, expected):
    assert alias_learning.trim_alias_text(raw) == expected


def test_learning_constants():
    assert alias_learning.LEARNED_CONFIDENCE == 0.9
    assert alias_learning.LEARNABLE_ASSIGNEE_TYPES == frozenset({"thirdname"})
    assert alias_learning.KNOWN_ASSIGNEE_TYPES == frozenset(
        {"first", "second", "thirdname", "thirdpronoun", "thirdrole", "group", "none"}
    )
    assert alias_learning.LEARNABLE_ASSIGNEE_TYPES <= alias_learning.KNOWN_ASSIGNEE_TYPES


def _item(**fields) -> ExtractionItem:
    base = {"action": ExtractionAction.CREATE, "assignee_type": "thirdname", "assignee_raw": "하은이가",
            "assignee_member_id": None}
    return ExtractionItem(**{**base, **fields})


def test_learnable_alias_text_for_unmatched_name():
    assert alias_learning.learnable_alias_text(_item()) == "하은"


@pytest.mark.parametrize(
    "fields",
    [
        {"assignee_member_id": "member-1"},
        {"assignee_type": "first"},
        {"assignee_type": "second"},
        {"assignee_type": "thirdpronoun"},
        # 역할 지목은 AI 가 원문 대신 추측한 이름을 보낼 수 있어, 원문을 보낼 때까지 배우지 않는다(#464 리뷰)
        {"assignee_type": "thirdrole", "assignee_raw": "BE 리더가"},
        {"assignee_type": "thirdrole", "assignee_raw": "환"},
        {"assignee_type": "group"},
        {"assignee_type": "none"},
        {"assignee_type": None},
        {"action": ExtractionAction.UPDATE},
        {"assignee_raw": "님"},
        {"assignee_raw": None},
    ],
)
def test_learnable_alias_text_is_none_when_not_learnable(fields):
    assert alias_learning.learnable_alias_text(_item(**fields)) is None
