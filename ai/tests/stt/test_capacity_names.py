"""이름 자리 채점(stt/eval/capacity/names.py, #195)."""

import json

from stt.eval.capacity import names as N

NAMES = ["동우", "재환", "원준", "지민", "환", "진호"]


def test_a_name_inside_another_name_is_not_counted():
    """"재환님" 의 "환님" 은 김환이 아니다. 앞 글자가 한글이면 다른 이름의 일부로 본다."""
    hits = N.name_hits("재환님과 환님이 정합니다. 원준님 도우님", NAMES)
    assert hits == {"동우": 0, "재환": 1, "원준": 1, "지민": 0, "환": 1, "진호": 0}


def test_a_leaked_prompt_is_a_run_of_three_or_more_names():
    assert N.leaks("동우님, 재환님, 원준님. 회의를 시작합니다", NAMES) == 1
    assert N.leaks("동우님과 재환님이 같이 봅니다", NAMES) == 0


def test_report_compares_each_transcript_with_the_expected_names(tmp_path):
    lines = tmp_path / "a.json"
    lines.write_text(json.dumps({"segments": [{"text": "재환님이 하고 도우님은 쉽니다"}]}, ensure_ascii=False),
                     encoding="utf-8")
    rows = N.report({"동우": 1, "재환": 1}, {"힌트 없음": lines}, NAMES)
    assert rows == [{"label": "힌트 없음", "hit": 1, "expected": 2, "missed": ["동우"], "extra": [], "leaks": 0}]
