# 원래 마감이 없던 업무에서 같은 회의 안 마감 제안을 취소할 수 있게

- 날짜: 2026-10-17
- 이슈: -
- PR: (생성 후 기입)
- 브랜치: fix/due-revert-to-none
- 작성자: 윤지민 (Claude Code)

## 한 일

- `draft/doc_draft.py`: Luna 초안이 마감을 없애자는 결정을 `due_date: "none"` 으로 낸다. `null`(못 정함·파싱 실패)과 구분해 `DraftStructured.due_cleared=True` 로 받는다. 일정 변경 수정에서만 받고, 새 Task 의 `"none"` 은 마감 없음으로 본다. 일정 변경인데 `null` 이면 지금처럼 초안 실패다
- `shared/schemas.py`: `DraftStructured.due_cleared`(기본 False). `due_date=None` 은 "바꾸지 않음"이라 따로 둔다. AI 단계 사이 타입이고 BE 로 가는 item 에는 들어가지 않는다
- `judge/pipeline.py`
  - `_merge_into`: `due_cleared` 면 앞 카드의 마감 제안을 지운다. 원래 마감이 없던 업무면 원래 값과 같아져 카드가 사라진다(되돌림)
  - `_with_edit`: 원래 마감이 없으면 메모를 `마감을 None → 10/16` 대신 `마감을 없음 → 10/16` 으로 보여, Luna 가 되돌릴 값이 없음을 알게 한다
  - `run`: 원래 마감이 있는 Task 의 마감을 없애자는 결정, 앞 카드 없이 마감을 없애자는 수정은 실패(`draft`)로 남긴다. BE 는 `due_date=null` 을 "바꾸지 않음"으로 받아 보낼 칸이 없다. 조용히 버리지 않는다
- 테스트: `test_reverting_to_no_due_in_same_meeting_leaves_no_card`, `test_clearing_an_existing_due_is_a_failure_not_a_silent_drop`(pipeline), `test_none_due_clears_the_due_only_on_a_schedule_update`(doc_draft), `test_draft_result_roundtrip` 기대값에 `due_cleared`

## 왜

#230 멘토 리뷰(`ai/judge/pipeline.py:165`, MEDIUM). 원래 마감이 `None` 인 업무에서 "10/16까지" → "취소하고 원래처럼 미정으로"를 처리하면, 두 번째 Luna 응답의 `due_date=null` 이 초안 실패가 되어 10/16 제안이 남았다. 합치기도 null 은 덮어쓰지 않아 이 되돌림을 표현할 수 없었다. 날짜 파싱 실패와 명시적인 앞 제안 취소를 구분해 달라는 요청이다.

## 결과

| 항목 | 값 |
|---|---|
| 새 테스트 | 3개. 수정을 빼면 되돌림 · 초안 테스트 2개가 실패한다(마감 삭제 실패 테스트는 전후 모두 실패 결과라 통과, 조용히 버리지 않는지 지킨다) |
| 판단·초안 테스트 | `test_pipeline`·`test_doc_draft`·`test_semantic_judge`·`test_final_judge` 통과 |
| 전체 | 로컬 venv(Python 3.10, 음성 의존성 없음)에서 실패 목록이 변경 전과 같다. CI 확인 필요 |

실제 Terra·Luna 로 대본 3개를 돌렸다(유사 검색만 가짜, 회의 날짜 10/13).

| 대본 | 수정 전 | 수정 후 (3회) |
|---|---|---|
| 마감 없던 업무: "10/16까지" → "취소, 원래처럼 미정으로" | 10/16 카드가 남고 초안 실패 1건 (2/2). Luna 가 `null` | 3/3 카드 없음·실패 없음. Luna 가 `"none"` |
| 마감 10/14 업무: "마감 아예 없애죠" | | 3/3 카드 없음, `draft` 실패 1건 |
| 마감 10/14 업무: "10/16으로" → "원래대로"(회귀) | | 3/3 카드 없음·실패 없음. Luna 가 원래 날짜 `2026-10-14` |

표본이 대본당 3회이고, "미정으로 둡시다" 처럼 뜻이 분명한 표현만 썼다.

## 다음

- "일단 날짜는 빼죠" 처럼 애매한 표현에서도 `"none"` 을 내는지 확인
- 원래 마감이 있는 Task 의 마감 삭제는 BE 계약에 "마감 지움"을 담을 방법이 생기면 지원
