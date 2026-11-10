"""#643 용어 목록 E2E 목업 회의(fixture) 데이터 검사."""

import json
import re
from pathlib import Path

from judge import asr_check
from shared.schemas import Transcript

DIR = Path(__file__).resolve().parents[1] / "judge" / "golden_set_asr_terms"


def _load(name):
    return json.loads((DIR / name).read_text(encoding="utf-8"))


def _transcript(m):
    return Transcript.from_dict(m["transcript"])


SERIES = _load("series.json")
TERMS = SERIES["terms"]
MEETINGS = [_load(f"meeting_0{n}.json") for n in range(1, 6)]
CORRECT = _load("meeting_06_correct.json")
MISHEARD = _load("meeting_06_misheard.json")


def test_team_terms_are_not_in_the_base_list():
    base = asr_check.base_vocab()
    for term in TERMS:
        assert term not in base
        assert asr_check.nouns(term) == {term}


def test_each_mock_meeting_has_every_term_from_two_speakers():
    for m in MEETINGS:
        segs = _transcript(m).segments
        got = asr_check.team_nouns((s.speaker, s.text) for s in segs)
        assert set(TERMS) <= got, (m["meeting_date"], set(TERMS) - got)


def test_meeting6_scripts_differ_in_one_line_and_term_is_said_once():
    mh = SERIES["misheard"]
    a = [s.text for s in _transcript(CORRECT).segments]
    b = [s.text for s in _transcript(MISHEARD).segments]
    assert len(a) == len(b)
    diff = [i for i, (x, y) in enumerate(zip(a, b)) if x != y]
    assert diff == [mh["seq"]]
    assert b[mh["seq"]] == a[mh["seq"]].replace(mh["correct"], mh["heard"])
    assert sum(mh["correct"] in t for t in a) == 1


def test_misheard_word_is_off_the_list_and_points_to_the_term():
    base = asr_check.base_vocab()
    terms = set(TERMS)
    assert "볼러" not in base
    assert "폴러" in asr_check.candidates("볼러", base | terms)
    assert asr_check.suspects("채팅 폴러 서버 설정", base) == ["폴러"]
    assert asr_check.suspects("채팅 폴러 서버 설정", base | terms) == []


def test_fixture_shape():
    uids = {m["discord_user_id"] for m in SERIES["members"]}
    assert len(SERIES["members"]) == 6
    for m in [*MEETINGS, CORRECT, MISHEARD]:
        segs = _transcript(m).segments
        assert [s.seq for s in segs] == list(range(len(segs)))
        assert all(s.start < s.end for s in segs)
        assert all(a.end <= b.start for a, b in zip(segs, segs[1:]))
        assert {s.speaker for s in segs} <= uids
        titles = [f["title"] for f in m["findings"]]
        for ap in m["approve"]:
            assert any(ap["title_contains"] in t for t in titles)
        for f in m["findings"]:
            assert set(f["indices"]) <= {s.seq for s in segs}
    for m in MEETINGS:
        assert 30 <= len(m["transcript"]["segments"]) <= 38
        assert 3 <= len(m["findings"]) <= 5


def test_judge_script_matches_meeting6_correct():
    names = {m["discord_user_id"]: m["name"] for m in SERIES["members"]}
    rows = re.findall(r"^\|\s*\d+\s*\|\s*(\S+)\s*\|\s*(.+?)\s*\|\s*$",
                      (DIR / "judge-script.md").read_text(encoding="utf-8"), re.M)
    segs = _transcript(CORRECT).segments
    assert [t for _, t in rows] == [s.text for s in segs]
    assert [n for n, _ in rows] == [names[s.speaker] for s in segs]
