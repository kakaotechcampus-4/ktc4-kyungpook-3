# 범위 변경(scope) 승인을 태스크 이력 한 줄로 남긴다

- 기록일: 2026-11-08
- 관련 마일스톤: M6(프론트·AI 통합과 계약 확정)
- 관련 이슈: #205 (설계 확정 댓글 2026-11-08), FE #401(머지·배포됨)

## 문제와 제약

- AI 는 "소셜 로그인은 이번엔 빼기로 했다" 같은 범위 결정을 `category: scope` 인 수정 항목으로 보내고, BE 는 바뀌는 필드가 없어도 task_update 승인 요청을 만든다.
- 승인 반영은 payload 에서 태스크 칸(title·assignee_member_id·status·blocker·due_date)만 꺼내 적용해서, scope 만 있는 승인은 승인 상태만 approved 가 되고 태스크·이력·Notion 어디에도 남지 않았다.
- 리마인드 답장(#331·#345)으로 생긴 scope 줄 카드도 같은 승인 분기를 지나 같은 증상이었다. 타임라인에는 "범위 변경: 없음 · 승인함"으로 보였다.
- 이슈에서 FE 먼저 배포, BE 나중 배포로 정했고 FE(#401)는 이미 배포됐다.

## 실제 검토한 선택지

| 결정 | 선택지 | 결과 |
|---|---|---|
| 기록 위치 | task_history 한 줄(A) / Task 칸 추가 / Notion 본문 기록 | A. PR #105 리뷰에서 고른 방향이다. 칸 추가는 마이그레이션과 화면이 더 필요하고, Notion 본문 쓰기는 후속으로 미뤘다 |
| 구현 구조 | 이력 전용 함수 `log_scope_change` / `_FIELD_MAP` 에 scope 를 넣어 `apply_task_updates` 가 특별 취급 / 라우터에서 바로 add | 전용 함수. `_FIELD_MAP` 을 건드리지 않아 version·Notion 동기화·되돌리기가 범위 이력을 모르게 된다. 넣으면 세 곳 모두 예외를 알아야 한다 |
| 이력 문장 | 승인 카드의 `doc_text` / 고정 문구 | `doc_text`. FE 모의 서버와 같고 무엇이 바뀌었는지 남는다 |
| 문장이 비었을 때 | 줄을 남기고 `new_value` null / 남기지 않음 | 남김. 승인 사실 자체가 기록할 가치가 있다 |
| 답장 카드 | 같이 처리 / 회의 카드만 | 같이. 같은 승인 분기라 빼려면 조건이 더 든다. 범위 이력을 답장의 scope 줄에 이어 타임라인에 한 번만 보인다 |
| 답장 문장 공개 | 회의와 같이 `doc_text` / 답장만 고정 문구 | `doc_text`. 답장 원문이 아니라 AI 요약이고, 막힘 사유도 같은 요약을 모든 팀원이 보는 칸에 쓴다 |

사용자가 설계 초안의 추천안을 모두 골랐다(2026-11-08).

## 선택과 이유

- `category == "scope"` 인 task_update 를 승인하면 필드 반영(제안 값, PM 수정 값) 뒤에 `changed_field: "scope"`, `old_value: null`, `new_value: doc_text`(앞뒤 공백을 지우고 비면 null) 한 줄을 남긴다.
- 출처는 같은 승인의 제안 값 이력과 같다. payload `change_source` 가 있으면 그 값(답장은 `reminder_reply`), 없으면 채팅 회의는 `chat`, 그 밖은 `meeting` 이다. 남긴 사람은 승인한 PM 이다.
- 충돌 검사 뒤에 남기므로 409 `APPROVAL_CONFLICT`·반려면 이력이 없다.
- 범위만 있는 승인은 `version` 을 올리지 않고 Notion 동기화를 요청하지 않는다. 필드 변경이 함께 오면 필드 이력과 범위 이력이 둘 다 남고 `version` 은 한 번 오른다.
- 범위 이력을 되돌리면 기존 가드대로 400 `INVALID_REQUEST`("되돌릴 수 없는 변경 항목입니다.")다.

## 장단점과 감수한 제약

- 범위 결정은 이력에만 남고 Notion 페이지에는 남지 않는다. 팀원이 Notion 에서만 보면 범위 결정을 알 수 없다.
- 근거 발화는 task_history 에 칸이 없어 남기지 않는다. 근거는 승인 payload·추출 항목·답장 줄에 남아 있다.
- 답장 카드의 결정 문장(AI 요약)이 대화 주인·PM 밖의 팀원에게도 이력으로 보인다.
- PM 이 직접 만든 승인(POST /approvals)도 `category` 가 정확히 "scope" 면 같은 규칙을 탄다.
- 결정(decision) 항목은 여전히 기록되지 않는다(이슈 범위 밖, AI 와 후속).

## 영향 범위와 재검토 조건

- 코드: `app/models/models.py`(`ChangedField.SCOPE`), `app/services/tasks.py`(`log_scope_change`), `app/api/approvals.py`. 컬럼·마이그레이션 없음(`changed_field` 는 `String(20)`).
- 계약: `/tasks/{id}/history`·`/tasks/{id}/timeline` 의 `changed_field` 에 `scope` 가 나온다(FE 와 합의됨). 답장 타임라인의 scope 줄 `new_value` 가 null 에서 범위 문장이 된다.
- 재검토: Notion 본문에 범위 결정을 쓰기로 하면 한 번만 쓰기·페이지 없음 처리를 정한다. 답장 요약 공개가 문제가 되면 답장 카드만 고정 문구로 바꾼다.

## 근거와 관련 문서

- #205 본문과 설계 확정 댓글, FE #401
- 테스트: `tests/api/test_approval_scope_history.py`, `tests/api/test_reply_scope_history.py`
- [Backend README 범위 변경 승인](../../../../README.md)
