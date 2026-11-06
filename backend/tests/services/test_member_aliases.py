"""name_alias_forms: 팀원 이름에서 별칭으로 넣을 꼴을 만든다 (#459).

ai/stt/backend.py 의 member_forms 와 같은 규칙이다(님 꼴만 뺀다).
"""
import pytest

from app.services.member_aliases import name_alias_forms


@pytest.mark.parametrize(
    "name, expected",
    [
        ("김동우", ["김동우", "동우"]),
        ("김환", ["김환", "환"]),
        ("남궁민수", ["남궁민수", "민수"]),
        (" 김동우 ", ["김동우", "동우"]),
        ("Alice", []),
        ("새 팀원", []),
        ("김", []),
        (None, []),
        ("", []),
    ],
)
def test_name_alias_forms(name, expected):
    assert name_alias_forms(name) == expected
