# JudgeFinding/NotionCandidate/JudgeInput 스키마 추가

- 날짜: 2026-09-16
- 이슈: Part of #26
- PR: #28
- 브랜치: feat/26-notion-schema
- 작성자: 유재환

## 한 일

BE와 합의한 형식대로 `ai/shared/schemas.py`에 세 타입 추가:

- `JudgeFinding` — Terra 1단계 출력. "이 발화는 2단계 판단까지 가볼 가치가 있다"고 골라낸
  후보 하나. `text`, `source`, `seq`, `speaker`, `reason`, `method` 필드
- `NotionCandidate` — BE가 벡터 검색으로 찾아준, 의미상 가장 가까운 기존 Notion 항목 하나.
  `notion_page_id`, `task_id`, `title`, `content_snippet`, `assignee_member_id`, `due_date`,
  `status`, `similarity`, `updated_at` 필드
- `JudgeInput` — Terra 2단계(`semantic_judge`)의 입력. `source`, `text`,
  `candidates: list[NotionCandidate]`. `candidates`가 빈 리스트면 기존 문서화된 단순 판단
  (문장만 보고 판단)과 동일하게 동작

## 왜

Terra 1단계(발화 필터링)와 2단계(Notion 후보 비교 + 최종 판단) 사이를 잇는 타입이 없어서
BE와의 계약부터 먼저 정했다.

## 결과

`test_schemas.py`에 6개 추가(각 타입의 기본값/round-trip, `JudgeInput`의 중첩 `NotionCandidate`
리스트 복원 확인). 전체 스위트 291 passed, 1 skipped.

`JudgeInput`은 `candidates` 리스트 안에 중첩 dataclass가 있어서, 공통 `_Base.to_dict/from_dict`
만으로는 안 되고 `Transcript`처럼 커스텀 `to_dict`/`from_dict`를 따로 구현했다.

## 다음

이 스키마들을 실제로 쓰는 Terra 1단계 로직(`judge/semantic_judge.py`) → PR #49.
2단계(`JudgeResult` 실제 구현)는 이슈 #63에서 진행.
