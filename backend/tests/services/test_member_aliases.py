"""name_alias_forms: 팀원 이름에서 별칭으로 넣을 꼴을 만든다 (#459).

ai/stt/backend.py 의 member_forms 와 같은 규칙이다(님 꼴만 뺀다).
"""
import pytest

from app.services.member_aliases import name_alias_forms, pick_discord_nickname


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


@pytest.mark.parametrize(
    "guild_member, expected",
    [
        ({"nick": "동우", "user": {"global_name": "Dong"}}, "동우"),
        ({"nick": "dongwoo", "user": {"global_name": "동우"}}, "동우"),
        ({"nick": None, "user": {"global_name": "동우"}}, "동우"),
        ({"nick": " 동우 ", "user": {}}, "동우"),
        ({"nick": "동우 (BE)", "user": {}}, None),
        ({"user": {"username": "동우"}}, None),
        ({"nick": "dongwoo", "user": {"global_name": None}}, None),
        ({}, None),
    ],
)
def test_pick_discord_nickname(guild_member, expected):
    assert pick_discord_nickname(guild_member) == expected
