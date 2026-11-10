"""#643 용어 목록 E2E 목업 회의(fixture) 데이터 검사."""

import copy
import json
import re
from datetime import date
from pathlib import Path

import draft.doc_draft as doc_draft
import judge.final_judge as final_judge
import judge.pipeline as pipeline
import judge.semantic_judge as semantic_judge
from capture.handoff import BeClient
from judge import asr_check
from llm import FakeLLM
from shared.schemas import JudgeFinding, Transcript
from tests.capture.fake_be import FakeBe

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


def test_meeting4_rehearsal_is_said_only_by_kimhwan():
    segs = _transcript(MEETINGS[3]).segments
    who = {s.speaker for s in segs if "리허설" in asr_check.nouns(s.text)}
    assert who == {"uid_kimhwan"}


def test_outsider_is_not_a_member():
    assert not any("수빈" in m["name"] for m in SERIES["members"])

WS = SERIES["workspace_id"]
NEW = {"is_meaningful": True, "category": "decision", "is_new": True, "matched_candidate_index": None,
       "status": None, "evidence": "근거"}


class WordJev:
    """task/due 는 확실, asr* 는 볼러·폴러만 아니라고 답한다. 질문 instructions 의 '단어' 를 읽는다."""

    name = "fake"

    def __init__(self):
        self.calls = []

    def decide(self, state, questions):
        self.calls.append((state, questions))
        out = {}
        for key, q in questions.items():
            if key.startswith("asr"):
                word = re.search(r"'([^']+)'", q["instructions"]).group(1)
                yes = 0.1 if word in {"볼러", "폴러"} else 0.95
            else:
                yes = 0.95
            out[key] = {"choice": "yes", "probabilities": {"yes": yes, "no": 1 - yes, "unclear": 0.0}}
        return out


def _new_be():
    fb = FakeBe()
    fb.workspaces.add(WS)
    fb.members[WS] = SERIES["members"]
    return fb


def _findings(m):
    segs = {s.seq: s for s in _transcript(m).segments}
    return [JudgeFinding(text=f["summary"], evidence=[segs[i].text for i in f["indices"]], indices=f["indices"],
                         seq=f["indices"][-1], seqs=f["indices"], speaker=segs[f["indices"][-1]].speaker,
                         assignee_type="none", method="llm") for f in m["findings"]]


def _run_meeting(fb, m, monkeypatch):
    """회의 하나를 판단 파이프라인으로 돌린다(LLM 고정). (결과, Jev) 를 돌려준다."""
    n = len(m["findings"])
    terra = FakeLLM(responses=[dict(NEW) for _ in range(n)])
    luna = FakeLLM(responses=[{"task": f["title"], "due_date": None, "due_raw": None, "doc_text": f["title"]}
                              for f in m["findings"]])
    jev = WordJev()
    monkeypatch.setattr(pipeline, "get_jev", lambda: jev)
    monkeypatch.setattr(final_judge, "get_llm", lambda which: terra)
    monkeypatch.setattr(doc_draft, "get_llm", lambda which: luna)
    monkeypatch.setattr(pipeline, "get_llm", lambda which: terra if which == "terra" else luna)
    monkeypatch.setattr(pipeline, "extract_findings_counted",
                        lambda t, context=None: (_findings(m), semantic_judge.empty_drops()))
    client = BeClient("http://be", session=fb, service_token=fb.service_token)
    out = pipeline.run(_transcript(m), workspace_id=WS, today=date.fromisoformat(m["meeting_date"]),
                       candidates=client)
    assert out.failures == []
    return out, jev


def _item(out, title_part):
    [item] = [i for i in out.items if title_part in i["task_title"]]
    return item


def _replay(fb, monkeypatch, name):
    """회의 하나를 돌리고, PM 이 승인한 항목의 제목을 승인 뒤 큐에 넣는다(approvals.py 흉내)."""
    m = _load(f"{name}.json")
    out, _ = _run_meeting(fb, m, monkeypatch)
    for i, a in enumerate(m["approve"]):
        item = _item(out, a["title_contains"])
        fb.asr_titles[WS].append({"title_id": f"{name}-{i}", "title": a.get("title", item["task_title"])})
    return out


def _history(monkeypatch):
    fb = _new_be()
    for n in range(1, 6):
        _replay(fb, monkeypatch, f"meeting_0{n}")
    return fb


# ── 회차 E2E: 1~5회차를 거치며 용어 목록이 쌓이고 6회차 오인식만 잡힌다 ─────────────────
# LLM 은 고정(1단계 = fixture findings, Terra = 매번 새 할 일, Luna = finding 제목). BE 는 BeClient ↔ FakeBe.

WS = SERIES["workspace_id"]


def test_five_meetings_build_the_workspace_terms(monkeypatch):
    fb = _history(monkeypatch)
    assert {"제브", "폴러", "루나", "리허설"} <= fb.asr_terms[WS]
    # 리허설은 김환 혼자 말했다. 팀 용어(두 사람 이상)가 아니라 승인 제목으로만 들어왔다
    assert "리허설" not in asr_check.team_nouns((s.speaker, s.text) for s in _transcript(MEETINGS[3]).segments)
    assert fb.asr_titles[WS] == []   # 5회차 approve 가 없어도 4회차 제목까지 흡수됐다


def test_meeting6_correct_has_no_suspect_after_history(monkeypatch):
    fb = _history(monkeypatch)
    out, jev = _run_meeting(copy.deepcopy(fb), CORRECT, monkeypatch)
    a = _item(out, "서버 설정")
    assert a["asr_suspects"] == []
    [questions] = [q for state, q in jev.calls if "서버 설정" in state]
    assert not [k for k in questions if k.startswith("asr")]


def test_meeting6_misheard_is_flagged_with_the_term_as_candidate(monkeypatch):
    fb = _history(monkeypatch)
    out, _ = _run_meeting(copy.deepcopy(fb), MISHEARD, monkeypatch)
    [s] = _item(out, "서버 설정")["asr_suspects"]
    assert (s["word"], s["source"]) == ("볼러", "title")
    assert "폴러" in s["candidates"]
    assert _item(out, "발표 자료")["asr_suspects"] == []


def test_meeting6_correct_without_history_asks_about_the_term(monkeypatch):
    out, jev = _run_meeting(_new_be(), CORRECT, monkeypatch)
    asked = [q[k]["instructions"] for _, q in jev.calls for k in q if k.startswith("asr")]
    assert any("'폴러'" in text for text in asked)
