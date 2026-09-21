from embedding import (
    FakeEmbedder,
    NullEmbedder,
    cosine_similarity,
    find_similar_candidates,
    get_embedder,
    top_k_similar,
)


def test_null_embedder_returns_none():
    assert NullEmbedder().embed("아무 텍스트") is None


def test_get_embedder_off_returns_null_embedder():
    assert get_embedder(force="off").embed("텍스트") is None


def test_cosine_similarity_identical_vectors_is_one():
    v = [1.0, 2.0, 3.0]
    assert cosine_similarity(v, v) == 1.0


def test_cosine_similarity_orthogonal_vectors_is_zero():
    assert cosine_similarity([1.0, 0.0], [0.0, 1.0]) == 0.0


def test_cosine_similarity_opposite_vectors_is_negative_one():
    assert cosine_similarity([1.0, 0.0], [-1.0, 0.0]) == -1.0


def test_cosine_similarity_handles_zero_vector():
    assert cosine_similarity([0.0, 0.0], [1.0, 1.0]) == 0.0


def test_cosine_similarity_mismatched_length_is_zero():
    assert cosine_similarity([1.0, 0.0], [1.0, 0.0, 0.0]) == 0.0


def test_top_k_similar_ranks_by_similarity_descending():
    query = [1.0, 0.0]
    candidates = [
        ("task_far", [0.0, 1.0]),       # 직교 → 유사도 0
        ("task_close", [0.9, 0.1]),     # 거의 같은 방향 → 유사도 높음
        ("task_opposite", [-1.0, 0.0]),  # 반대 방향 → 유사도 -1
    ]
    ranked = top_k_similar(query, candidates, k=2)
    assert [cid for cid, _ in ranked] == ["task_close", "task_far"]


def test_top_k_similar_respects_k():
    query = [1.0, 0.0]
    candidates = [(f"t{i}", [1.0, 0.0]) for i in range(5)]
    assert len(top_k_similar(query, candidates, k=3)) == 3


def test_find_similar_candidates_uses_fake_embedder(monkeypatch):
    import embedding as embedding_module

    fake = FakeEmbedder(vectors=[[1.0, 0.0]])
    monkeypatch.setattr(embedding_module, "_cached", fake)
    monkeypatch.setattr(embedding_module, "get_embedder", lambda force=None: fake)

    existing = [("task_a", [1.0, 0.0]), ("task_b", [0.0, 1.0])]
    result = find_similar_candidates("새 문장", existing, k=1)

    assert result == [("task_a", 1.0)]
    assert fake.texts == ["새 문장"]


def test_find_similar_candidates_returns_empty_when_embed_fails(monkeypatch):
    import embedding as embedding_module

    null = NullEmbedder()
    monkeypatch.setattr(embedding_module, "get_embedder", lambda force=None: null)

    assert find_similar_candidates("문장", [("task_a", [1.0, 0.0])]) == []
