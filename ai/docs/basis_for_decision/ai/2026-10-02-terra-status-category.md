# Terra 2단계 — 상태 변경 category 분리와 is_meaningful 기준 강화

- 날짜: 2026-10-02
- 이슈: #138
- PR: #139
- 브랜치: fix/138-terra-status-category
- 작성자: 유재환

## 한 일

- `shared/schemas.py` — `JUDGE_CATEGORIES`에 `status` 추가
- `judge/final_judge.py` — Terra 판단 기준
  - 진행 상태만 바뀌면(시작 · 완료 · 막힘 · 재개) `category=status`
  - "실제로 바뀌는 것이 하나도 없으면 `is_meaningful=false`"를 구체적으로: 현재 값과 같은 보고, 진행 중의
    어려움 · 감상, 상태가 그대로인 진척률, 질문 · 확인
  - 예외: 필드에 담기지 않아도 방식 · 형식 · 도구 · 규칙을 새로 정했다면 `is_meaningful=true`, `decision`
- `draft/doc_draft.py` — Luna 프롬프트의 category 한국어 표기에 `status: 진행 상태`
- `judge/golden_set_stage2/` — 30 → 35개. 상태만 바뀌는 7건에 `category=status` 기대값, 관찰용이던 29 · 30번을
  "바뀌는 것 없음"으로 채점, 새 케이스 5개(필드 없는 결정 2, 감상 1, 질문 1, 상태 + 일정 동시 변경 1)
- `tests/test_final_judge.py` — status category 파싱, 프롬프트 기준 문구 (2개)
- `decision_log/0014` — 보류에서 결정됨으로. 이 브랜치로 옮겨 온 9/30 기록(PR #109 머지 뒤에 push 돼
  develop 에 빠졌던 것)을 갱신했다
- `docs/2026-09-29-judge-pipeline.md` — 같은 9/30 커밋에 들어 있던 "기록만 한 것" · "다음" 보강

## 왜

category 에 상태 변경 값이 없어서, "검색 성능 개선 다 끝냈어요"처럼 상태만 바뀌는 발화가 "그 외"인 `decision`
으로 분류됐다(#99 · #100). 그 결과 decision 안에 성격이 다른 세 가지가 섞였다.

| 발화 (기존 Task) | 실제 의미 |
|---|---|
| "검색 성능 개선 다 끝냈어요" | 상태 변경 |
| "결제 API 연동 중인데 문서가 헷갈리네요" (이미 진행 중) | 바뀌는 것 없음 |
| "결제 API 응답은 JSON:API 형식으로 통일하기로 해요" | 필드에 안 담기는 결정 |

뒤의 둘은 category 도 같고 바뀌는 필드도 없어서 `to_item()` 이 구분하지 못하고 둘 다 버렸다. 진짜 결정이
같이 사라지는 한계를 PR #105 리뷰에서 짚었고, decision 에 진짜 결정만 남도록 먼저 이 두 가지를 하기로 했다.

## 결과

실제 Terra API 로 stage2 골든셋 2회 — **33/33, 33/33** (관찰용 2개 제외, 전체 35개)

| 그룹 | 결과 (2회 모두) |
|---|---|
| 상태만 바뀜 7건 | 모두 `category=status`, status 정확 |
| 바뀌는 것 없음 4건 (애로사항 · 진척률 · 감상 · 질문) | 모두 `is_meaningful=false` |
| 필드 없는 진짜 결정 2건 (응답 형식 · 구현 방식) | 모두 `is_meaningful=true`, `decision` — 기준 강화에 같이 걸리지 않음 |
| 상태 + 일정 동시 변경 | status=blocked, category=schedule |
| 기존 케이스 | 회귀 없음 |

파이프라인 E2E(`eval_pipeline`, 실제 Luna · Terra · 임베딩) 1회 6/6. 완료 보고 item 의 category 가
`decision` → `status` 로 바뀐 것 말고는 그대로다.

전체 AI pytest 679 passed.

## 다음

- decision 을 바뀌는 필드 없이도 보내기 — `to_item` 의 scope 예외에 decision 추가 + BE `/extractions` 예외 요청.
  scope · decision 결정을 사용자에게 어디에 보여줄지 첫 배포 이후 정하기로 해서(PR #105 리뷰) 그때 한다
- BE 공유 — `/extractions` 의 `category` 에 `status` 값이 새로 온다 (자유 문자열이라 BE 수정은 필요 없음,
  스키마 설명 문구만)
- 새 항목의 category 는 여전히 기준이 맞지 않는다 (새 항목에도 scope · assignee 가 붙음, #109 기록)
