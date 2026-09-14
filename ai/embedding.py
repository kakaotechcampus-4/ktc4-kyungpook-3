"""텍스트 임베딩 + 유사도 검색. Google Gemini 무료 티어 임베딩 모델만 사용합니다.

원칙 (ai/llm.py 와 동일)
  - API 키가 없거나 호출이 실패하면 None/빈 리스트를 반환합니다. 호출자는 이걸 "검색 결과 없음"으로
    처리해야 합니다 — 키 없이도 전 단계가 실행/테스트 가능해야 하므로.
  - 계산(embed, top_k_similar)과 조합(find_similar_candidates)을 분리합니다. top_k_similar 는
    순수 함수라 API 없이 손으로 만든 벡터로 바로 단위 테스트할 수 있습니다.

책임 경계 (BE ↔ AI)
  - "벡터를 언제 계산해서 저장해둘지"(task 생성/수정 시점, 이력 누적 없이 현재 상태로 교체)는 BE 책임.
  - 이 모듈은 "텍스트 → 벡터"와 "벡터들 비교해서 순위 매기기"라는 계산만 제공합니다.
"""

from __future__ import annotations

import sys
from typing import Any, Protocol

from shared.config import settings

ALLOWED_EMBEDDING_MODELS = ("text-embedding-004",)


class EmbedderClient(Protocol):
    name: str

    def embed(self, text: str) -> list[float] | None: ...


class NullEmbedder:
    """임베딩을 쓰지 않는 모드. 항상 None → 호출자가 빈 검색 결과로 처리."""

    name = "off"

    def embed(self, text: str) -> list[float] | None:
        return None


class FakeEmbedder:
    """테스트용. 미리 정해둔 벡터를 순서대로 돌려주고 요청 텍스트를 기록."""

    name = "fake"

    def __init__(self, vectors: list[list[float] | None] | None = None):
        self.vectors = list(vectors or [])
        self.texts: list[str] = []

    def embed(self, text: str) -> list[float] | None:
        self.texts.append(text)
        if not self.vectors:
            return None
        return self.vectors.pop(0)


class GeminiEmbedder:
    name = "gemini"

    def __init__(self, api_key: str, model: str = "text-embedding-004"):
        if model not in ALLOWED_EMBEDDING_MODELS:
            raise ValueError(f"허용되지 않은 임베딩 모델: {model}. 무료 티어 모델만 사용: {ALLOWED_EMBEDDING_MODELS}")
        from google import genai  # 지연 import: 설치 안 돼 있어도 나머지 모듈은 동작

        self._client = genai.Client(api_key=api_key)
        self.model = model
        self.calls = 0

    def embed(self, text: str) -> list[float] | None:
        try:
            self.calls += 1
            resp = self._client.models.embed_content(model=self.model, contents=text)
            return list(resp.embeddings[0].values)
        except Exception as e:
            print(f"[embedding] {self.model} 호출 실패: {str(e)[:120]}", file=sys.stderr)
            return None


_cached: EmbedderClient | None = None


def get_embedder(force: str | None = None) -> EmbedderClient:
    """설정에 따라 임베딩 클라이언트를 돌려줍니다.

    force: "off" | "gemini" | None(설정값 따름). GEMINI_API_KEY 가 없으면 항상 NullEmbedder.
    """
    global _cached
    if force is None and _cached is not None:
        return _cached
    s = settings()
    mode = force or ("gemini" if s.gemini_api_key else "off")
    client: EmbedderClient
    if mode == "gemini" and s.gemini_api_key:
        try:
            client = GeminiEmbedder(s.gemini_api_key)
        except ImportError:
            print("[embedding] google-genai 미설치 → 검색 결과 없음으로 폴백 (pip install google-genai)", file=sys.stderr)
            client = NullEmbedder()
    else:
        client = NullEmbedder()
    if force is None:
        _cached = client
    return client


def embed(text: str) -> list[float] | None:
    """현재 설정된 임베딩 클라이언트로 텍스트를 벡터화."""
    return get_embedder().embed(text)


def cosine_similarity(a: list[float], b: list[float]) -> float:
    """코사인 유사도. 둘 중 하나라도 영벡터면 0.0."""
    if len(a) != len(b) or not a or not b:
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = sum(x * x for x in a) ** 0.5
    norm_b = sum(y * y for y in b) ** 0.5
    if norm_a == 0.0 or norm_b == 0.0:
        return 0.0
    return dot / (norm_a * norm_b)


def top_k_similar(
    query_vector: list[float],
    candidates: list[tuple[str, list[float]]],
    k: int = 3,
) -> list[tuple[str, float]]:
    """candidates = [(id, 벡터), ...] 를 query_vector 와의 유사도 내림차순으로 정렬해 상위 k개 반환."""
    scored = [(cid, cosine_similarity(query_vector, vec)) for cid, vec in candidates]
    scored.sort(key=lambda pair: pair[1], reverse=True)
    return scored[:k]


def find_similar_candidates(
    query_text: str,
    existing_items: list[tuple[str, list[float]]],
    k: int = 3,
) -> list[tuple[str, float]]:
    """embed() + top_k_similar() 를 순서대로 불러주는 조합 함수. BE 는 이것만 호출하면 됨.

    existing_items 는 BE 가 미리 계산해서 저장해둔 (task_id, 벡터) 목록 — 여기서 다시 임베딩하지 않음.
    query_vector 를 못 구하면(키 없음/호출 실패) 빈 리스트를 반환한다.
    """
    query_vector = embed(query_text)
    if query_vector is None:
        return []
    return top_k_similar(query_vector, existing_items, k)
