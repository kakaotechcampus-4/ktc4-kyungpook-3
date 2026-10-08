# 임베딩 유사도 검색 유틸 추가

- 날짜: 2026-09-16
- 이슈: Part of #26
- PR: #27
- 브랜치: feature/26-embedding
- 작성자: 유재환

## 한 일

- `ai/llm.py` — LLM 클라이언트 래퍼. Elice MLAPI(OpenAI 호환 SDK)의 GPT-5.6 Terra/Luna 사용.
  Terra(판단)/Luna(초안)는 `base_url`·API 키가 서로 다른 별개 엔드포인트라 `get_llm("terra")`/
  `get_llm("luna")`로 구분해서 가져오는 구조
- `ai/embedding.py` — 텍스트 임베딩 + 벡터 유사도 검색 유틸 (`text-embedding-3-small`)
  - `embed(text)` — 텍스트 → 벡터
  - `cosine_similarity(a, b)` — 코사인 유사도
  - `top_k_similar(query_vector, candidates, k)` — 후보 중 상위 k개 순위
  - `find_similar_candidates(query_text, existing_items, k)` — 위 둘을 순서대로 불러주는 조합 함수 (BE는 이것만 호출하면 됨)
- `ai/judge/`, `ai/draft/` — Terra/Luna 실제 판단·초안 로직이 들어갈 빈 패키지 스캐폴드

## 왜

원래 Gemini 무료 티어로 시작했다가, 팀 결정으로 유료 모델(GPT-5.6 Terra/Luna, Elice MLAPI
프록시)로 전환했다. 이 모델은 `temperature` 커스텀 값을 지원하지 않아서(실제 호출해보고
에러로 확인 — 기본값 1만 허용) `reasoning_effort`(none/low/medium/high) 파라미터로 대체했다.

설계 원칙: API 키 없거나 호출 실패하면 `None`/빈 리스트 반환 → 호출자는 "검색 결과 없음"으로
처리(키 없이도 전 단계가 테스트 가능). 계산(`embed`)과 순위 매기기(`top_k_similar`)를 분리 —
`top_k_similar`는 순수 함수라 API 없이 손으로 만든 벡터로 단위 테스트 가능. 벡터를 언제
저장/교체할지(BE의 sqlite)는 BE 책임으로 남김.

## 결과

- `test_embedding.py` 11개(NullEmbedder, cosine_similarity 각 케이스, top_k_similar, find_similar_candidates)
- 전체 스위트: 296 passed, 1 skipped
- Terra/Luna/임베딩 세 엔드포인트 모두 실제 API 키로 호출해서 정상 동작 확인(임베딩 1536차원 반환)

## 다음

- `NotionCandidate`/`JudgeInput` 스키마 → PR #28
- Terra(`judge/semantic_judge.py`), Luna(`draft/doc_draft.py`) 실제 판단 로직은 이 PR 범위 밖
