# Luna Phase 2 — 승인 요청에 담을 제목·마감일·설명(DraftResult) 생성

- 날짜: 2026-09-28
- 이슈: #103
- PR: #104
- 브랜치: feat/103-luna-draft
- 작성자: 유재환

## 한 일

- `shared/schemas.py` — `DraftStructured(task, due_date)` 추가. `DraftResult.structured`를
  타입 없는 `dict`에서 `DraftStructured`로, `method` 기본값을 `"rules"` → `"llm"`으로
- `draft/doc_draft.py` — `JudgeFinding` + `JudgeResult` (+ update 대상 후보, 회의 날짜) → Luna →
  `DraftResult`
  - `_draft_prompt` — 확정된 판단(종류/바뀌는 것/상태), 발화 요약·근거 원문, 담당자 언급, update 면
    현재 값을 넣는다. few-shot 4개(생성·일정·상태·담당자)
  - `_parse_draft_response` — update 의 제목, 일정 외 update 의 마감일은 지우고, 날짜는
    `extract/dates.sanity_check_due_date`로 검증. create 의 제목·doc_text 가 비면 실패
  - `draft_llm` / `draft` — `final_judge.py`의 `judge_llm` / `judge`와 같은 구조. 키 없음/파싱
    실패는 `DraftUnavailableError`, `is_meaningful=False`로 들어오면 `ValueError`
- `tests/test_doc_draft.py` 19개, `tests/shared/test_schemas.py` 3개 추가 — FakeLLM/NullLLM 기반
- `CLAUDE.md` — "캡처까지만 구현" 문구를 현재 구현 상태로

## 왜

Terra 2단계까지는 "무엇을 바꿀지"만 정해지고, 승인 요청에 담을 **실제 값**(새 할일 제목, "다음 주
화요일"을 계산한 날짜, PM 이 읽을 설명)을 만드는 단계가 없었다. `DraftResult` 는 스키마만 있었고
`structured` 가 dict 라 어떤 키가 들어가는지 코드 어디에도 정해져 있지 않았다.

### Luna 가 만드는 값을 셋으로 좁혔다

원래 `structured` 는 `{task, assignee_member_id, due_date, type}` 이었다. 이 중 담당자는 1단계
(`JudgeFinding.assignee_*`)가 전사록 전체를 보고 이미 판정하고, 진행 상태(`type`)는 2단계
(`JudgeResult.status`)가 후보와 비교해 이미 판정한다. 같은 값을 Luna 가 다시 판단하면 단계마다 다른
답이 나올 수 있어서, **Luna 가 새로 만들어야 하는 값(task, due_date, doc_text)만** 남겼다. member_id
해소는 BE `resolve_assignee` 몫이라 AI 쪽 스키마에서 뺐다.

### 응답을 코드가 한 번 더 거른다

update 에서 제목이나 관계없는 마감일이 채워지면 승인 시 `_apply_approval` 이 payload 값으로
덮어써 기존 값이 바뀐다. 프롬프트에 "수정이면 null"이라고 써도 LLM 이 어길 수 있으므로 코드가
지운다. 반대로 create 의 제목, doc_text 처럼 없으면 승인 요청을 못 만드는 값이 비면 실패로 본다.

### "다음 주 ○요일"

`extract/prompts.py` 의 날짜 규칙은 "요일만 있으면 가장 가까운 다음 해당 요일"이라 "다음 주
수요일"을 이번 주 수요일로 읽을 여지가 있다. 일상적인 말뜻에 맞춰 **다음 주(월~일)의 그 요일**로
규칙을 추가했다. 추출기(`extract/`)에는 반영하지 않았다 — 두 경로의 해석을 맞출지는 추출기 담당과
정할 일.

## 결과

| 항목 | 값 |
|---|---|
| `tests/test_doc_draft.py` | 19 passed |
| 전체 AI pytest | 604 passed, 1 skipped |

실제 Luna API 평가(doc_text 가 자연스러운지, 날짜 계산이 맞는지)는 하지 않았다 — 파이프라인
오케스트레이터가 붙은 뒤 E2E 에서 1단계 요약문을 실제 입력으로 넣어 함께 본다.

## 다음

- 파이프라인 오케스트레이터(`judge/pipeline.py` 등) — 1단계 → 유사 검색 → Terra → `draft()` →
  `/extractions` item. `to_item()`에서 #99 에서 기록한 두 규칙 반영
  (status 는 category 무관하게 반영, 바뀌는 필드가 없으면 승인 요청 안 만듦)
- "다음 주 ○요일" 해석을 추출기와 맞출지 추출기 담당과 논의
- `shared/schemas.py` 변경(`DraftResult`) BE 공유 — 현재 BE 에서 쓰는 곳은 없음
