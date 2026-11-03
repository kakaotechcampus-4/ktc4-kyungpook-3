# 진행률 빼기와 승인하면서 고치기 (P0)

- 날짜: 2026-11-04
- 이슈: #303, FE 요청 #305
- PR: #307
- 브랜치: `feature/303-drop-progress-approve-edit`

## 한 일

BE 에서 Task 진행률(progress)을 뺐다. 칼럼(마이그레이션 `c7a2e91b4d36`), 생성·수정 요청과 응답, 검증, 승인 반영, `ChangedField.PROGRESS`, 노션 Progress 쓰기와 연결 검사의 필수 속성까지 지웠다. 요청 본문에 progress 가 와도 무시한다. 노션 DB 에 이미 있는 Progress 속성은 지우지도 쓰지도 않는다.

`PATCH /approvals/{id}` 가 `task_overrides` 를 받는다. 새 태스크 승인은 `task_title`·`assignee_member_id`·`due_date`, 수정 제안 승인은 `status`·`due_date` 를 고칠 수 있다. 담당자·마감은 null 로 "미정"을 고를 수 있고, 새 태스크는 항상 todo 로 들어간다. 고친 필드는 이력에 manual 출처와 승인한 PM 으로 남고, 승인 기록 payload 에는 원래 제안 옆에 제안과 다른 값만 `task_overrides` 로 남는다.

수정 제안을 반영할 때 이력 출처를 회의로 고정하던 것을 승인 요청 payload 의 `change_source` 로 바꿨다(없으면 회의). `POST /approvals` 는 정해진 값이 아닌 `change_source` 와 미리 넣은 `task_overrides` 를 400 으로 막는다.

이력 되돌리기가 되살릴 값을 다시 검증한다. 승인하면서 고친 줄의 이전 값은 검증하지 않은 제안 값이라, 형식이 틀린 날짜는 500, 다른 공간 담당자는 그대로 되살아났다. 둘 다 재현 테스트를 먼저 쓰고 400 으로 막았다.

새 태스크 승인도 payload `change_source` 를 생성 이력 출처로 쓴다. 제안 제목이 문자열이 아닐 때 PM 이 제목을 고쳐 승인하면 500 이 나던 것과, 그 고친 줄을 되돌리면 이상한 제목이 돌아오던 것도 리뷰에서 찾아 재현 테스트와 함께 고쳤다.

FE 계약(`frontend-api-contract.md`)에 「승인하면서 고치기 `task_overrides`」 절을 더하고 progress 서술을 고쳤다. `backend/README.md` 의 노션 템플릿 필수 속성 안내에서도 Progress 를 뺐다. `backend-ai-contract.md` 에는 progress, 승인 payload, ChangedField 서술이 없어 고치지 않았다.

## 왜

[결정 기록 0032](2026-11-04-0032-approval-overrides-and-progress-drop.md).

## 결과

| 항목 | 값 |
|---|---|
| `cd backend && .venv/bin/python -m pytest -q` | 792 passed, 310 skipped (시작 전 730 passed, 254 skipped. 늘어난 skip 은 새 테스트의 PostgreSQL 판으로 `TEST_DATABASE_URL` 이 있어야 돈다) |
| `ruff check .` | 통과 |
| `alembic upgrade bd244dd27629:head --sql` | `ALTER TABLE task DROP COLUMN progress;` |
| `alembic check`, 실제 PostgreSQL 업그레이드 | 아직 안 했다. 로컬 PostgreSQL 에 pgvector 가 없어 CI 에 맡긴다 |
| 비용 | 0원 |

## 다음

- FE 가 #305 로 진행률 표시를 지우고 `task_overrides` 를 실 API 에서 켠다
- P1(메시지)이 이 브랜치 위에서 시작한다. P4 가 답장으로 승인 요청을 만들 때 payload 에 `change_source: "reminder_reply"` 를 싣는다
- `api/extractions.py` 는 새 태스크 승인 payload 에 `status` 를 계속 싣는다. 승인은 읽지 않으므로 그대로 뒀다
