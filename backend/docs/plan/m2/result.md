# 마일스톤 구현 결과

## 작업 근거와 요약

M2 plan.md 는 비어 있다. 이번 작업은 #185(#175 멘토 리뷰 고민 4)의 BE 요청을 근거로 했다. AI 쪽 변경(`target_snapshot.title` 전송)은 `fix/185-snapshot-title` 브랜치에 있다.

task_update 승인 때 AI 가 대상 task 를 고른 근거인 제목이 바뀌었으면, 제안 필드가 그대로여도 `APPROVAL_CONFLICT` 로 다시 확인받는다. 제목은 바꾸지 않는다.

## 실제 구현 및 관련 코드

| 변경 | 위치 |
|---|---|
| `TargetSnapshot` 에 `title`(최대 300자). null 은 보내지 않은 것으로 본다 | `app/schemas/meeting.py` |
| 등록 때 payload 에 `base_title` 저장. 스냅샷 제목, 없으면 등록 시점 제목. 최상위 `title` 은 승인 때 반영되는 키라 쓰지 않음 | `app/api/extractions.py` `_request_task_update` |
| 승인 때 `base_title` ≠ 지금 제목이면 `{"field": "title", "base", "current", "proposed": null}` 충돌 항목 추가. 제안 값 예외 없음. `base_title` 이 없는 요청은 확인 안 함 | `app/api/approvals.py` `_find_target_change` |
| 계약·설명 | [AI 계약](../../contracts/backend-ai-contract.md), [Backend README](../../../README.md) |

## 완료조건 확인

M2 plan.md 가 비어 있어 완료조건이 없다. 마일스톤 완료를 판정하지 않았다. 아래는 #185 BE 요청의 테스트 항목이다.

| 조건 | 상태 | 근거 |
|---|---|---|
| 검색 → 제목 수정 → 등록 → 승인 순서에서 충돌 | 충족 | `test_title_change_after_search_is_a_conflict` |
| 제목이 같으면 지금처럼 통과 | 충족 | `test_same_title_is_not_a_conflict` |
| 스냅샷에 `title` 이 없으면 등록 시점 제목 기준 | 충족 | `test_without_snapshot_title_the_registration_title_is_the_base`, `test_without_snapshot_the_registration_title_is_the_base` |

추가로 등록 뒤 제목 변경, 필드 충돌과 함께 보고, 확인 후 재승인 시 제목 유지, `base_title` 없는 기존 요청을 테스트했다.

## 검증 내역

2026-10-09 로컬에서 `TEST_DATABASE_URL`(pgvector pg16)을 주고 `pytest -q -rs` 실행: 678 passed, 1 skipped(SQLite FOR UPDATE 미지원으로 원래 건너뛰는 테스트). `test_approval_conflict.py` 는 SQLite·PostgreSQL 각각 27개 통과.

## 계획 대비 변경

기존 테스트 2개(`test_pm_edit_of_other_field_does_not_block`, `test_edit_of_other_field_after_search_does_not_block`)는 "다른 필드 수정은 막지 않는다"의 예로 제목을 바꿨다. 이제 제목 변경은 충돌이므로 예를 blocker 수정으로 바꿨다. 테스트의 의미는 그대로다.

## 남은 작업과 제한 사항

- FE 는 아직 충돌 내용을 표시하지 않는다. 표시할 때 `title` 항목은 `proposed` 가 null 이라는 점을 반영해야 한다
- 표기만 다듬은 제목 수정도 매번 확인을 묻는다. 비용이 크면 운영 뒤 범위를 좁힌다(멘토 의견)
- 이 기능 전에 만들어진 pending 승인 요청은 제목을 확인하지 않는다

## 관련 기록

없음
