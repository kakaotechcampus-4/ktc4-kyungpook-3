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
    be = SeriesBe.__new__(SeriesBe)   # 임베딩 없이 메모리 상태만 쓴다
    be.words, be.pending, be.members = set(), [{"title_id": "a", "title": "x"}, {"title_id": "b", "title": "y"}], []
    assert be.asr_terms("ws") == {"words": [], "pending_titles": be.pending}
    be.add_asr_terms("ws", ["폴러", "제브"], ["a"])
    assert be.asr_terms("ws")["words"] == ["제브", "폴러"]
    assert [p["title_id"] for p in be.pending] == ["b"]
    be.add_asr_terms("ws", ["폴러"], [])
    assert be.words == {"제브", "폴러"}
