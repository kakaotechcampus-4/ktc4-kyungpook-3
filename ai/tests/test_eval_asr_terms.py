"""judge.eval_asr_terms 의 순수 부분(승인 매칭, 메모리 용어 목록)만 본다. 실제 LLM 은 부르지 않는다."""

from judge.eval_asr_terms import SeriesBe, approve_titles

ITEMS = [
    {"action": "create", "task_title": "채팅 폴러 서버 설정"},
    {"action": "update", "task_title": "발표 자료 정리"},
    {"action": "create", "task_title": "발표 자료 초안"},
]


def test_approve_matches_by_contained_text_and_prefixes_the_id():
    got = approve_titles(ITEMS, [{"title_contains": "서버 설정"}], "m1")
    assert got == [{"title_id": "m1-0", "title": "채팅 폴러 서버 설정"}]


def test_approve_only_matches_create_items():
    assert approve_titles(ITEMS, [{"title_contains": "정리"}], "m1") == []


def test_approve_title_wins_over_item_title():
    got = approve_titles(ITEMS, [{"title_contains": "초안", "title": "발표 초안"}], "m1")
    assert got[0]["title"] == "발표 초안"


def test_unmatched_approve_is_skipped_and_ids_keep_their_index():
    got = approve_titles(ITEMS, [{"title_contains": "없는 말"}, {"title_contains": "초안"}], "m1")
    assert got == [{"title_id": "m1-1", "title": "발표 자료 초안"}]


def test_series_be_adds_and_absorbs_terms():
    be = SeriesBe([], [])   # 태스크가 없으면 임베딩을 부르지 않는다
    be.pending = [{"title_id": "a", "title": "x"}, {"title_id": "b", "title": "y"}]
    assert be.asr_terms("ws") == {"words": [], "pending_titles": be.pending}
    be.add_asr_terms("ws", ["폴러", "제브"], ["a"])
    assert be.asr_terms("ws")["words"] == ["제브", "폴러"]
    assert [p["title_id"] for p in be.pending] == ["b"]
    be.add_asr_terms("ws", ["폴러"], [])
    assert be.words == {"제브", "폴러"}


def test_recording_jev_extracts_asr_word_and_yes_probability():
    from judge.eval_asr_terms import RecordingJev

    class Inner:
        def decide(self, state, questions):
            return {"asr1": {"choice": "yes", "probabilities": {"yes": 0.1}}, "task": {"probabilities": {"yes": 0.9}}}

    rec = RecordingJev(Inner())
    rec.decide("s", {"task": {"instructions": "x 'no'"}, "asr1": {"instructions": "'볼러' 는 맞게 적힌 말인가?"}})
    assert rec.asr_questions() == [{"word": "볼러", "yes": 0.1}]


def _main_with(monkeypatch, llm_off, jev_name):
    import pytest

    import judge.eval_asr_terms as mod
    import judge.pipeline as pipeline

    class L:
        name = "off" if llm_off else "x"

    class J:
        name = jev_name

    monkeypatch.setattr(pipeline, "get_llm", lambda which: L())
    monkeypatch.setattr(pipeline, "get_jev", lambda: J())
    monkeypatch.setattr(mod, "one_run", lambda *a: pytest.fail("키 확인 전에 돌면 안 된다"))
    monkeypatch.setattr("sys.argv", ["x"])
    with pytest.raises(SystemExit):
        mod.main()


def test_main_stops_before_running_when_llm_key_is_missing(monkeypatch):
    _main_with(monkeypatch, True, "jev")


def test_main_stops_before_running_when_jev_key_is_missing(monkeypatch):
    _main_with(monkeypatch, False, "off")


def test_a_failed_run_is_recorded_and_the_next_run_still_goes(monkeypatch):
    import judge.eval_asr_terms as mod
    import judge.pipeline as pipeline

    class Key:
        name = "x"

    calls, saved = [], []

    def flaky_run(runs):
        calls.append(1)
        runs.append({"meetings": {}, "meeting6": {}})
        if len(calls) == 1:
            raise RuntimeError("1단계 응답을 쓰지 못함")
        runs[-1]["meeting6"] = {"correct": {"items": [], "jev_asr": []}}

    monkeypatch.setattr(pipeline, "get_llm", lambda which: Key())
    monkeypatch.setattr(pipeline, "get_jev", lambda: Key())
    monkeypatch.setattr(mod, "one_run", flaky_run)
    monkeypatch.setattr(mod, "save", lambda runs: saved.append([dict(r) for r in runs]))
    monkeypatch.setattr("sys.argv", ["x", "--runs", "2"])
    mod.main()
    assert len(calls) == 2
    first, second = saved[-1]
    assert "1단계 응답을 쓰지 못함" in first["error"] and "error" not in second


def test_recording_jev_records_task_and_due_yes_by_title():
    from judge.eval_asr_terms import RecordingJev

    class Inner:
        def decide(self, state, questions):
            return {k: {"probabilities": {"yes": 0.3 if k == "task" else 0.8}} for k in questions}

    rec = RecordingJev(Inner())
    rec.decide("회의 날짜: 2026-11-02\n할 일: 서버 설정\n근거: x", {"task": {"instructions": "a"}, "due": {"instructions": "b"}})
    assert rec.evidence_yes() == {"서버 설정": {"task": 0.3, "due": 0.8}}


def test_show_handles_update_items_without_evidence_status(capsys):
    from judge.eval_asr_terms import show

    r = {"date": "2026-11-05", "failures": [], "new_terms": [], "jev_asr": [],
         "items": [{"action": "create", "task_title": "A", "task_status": "inferred", "due_status": "inferred",
                    "asr_suspects": [], "jev": {"task": 0.3, "due": None}},
                   {"action": "update", "task_title": None, "target_task_id": "t1", "due_date": "2026-11-20",
                    "status": None, "assignee_raw": "지민"}]}
    show("m", r)
    out = capsys.readouterr().out
    assert "t1" in out and "2026-11-20" in out and "0.3" in out
