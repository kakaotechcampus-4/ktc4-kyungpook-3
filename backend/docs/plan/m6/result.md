# 마일스톤 구현 결과

## 작업 근거와 요약

M6 plan.md 는 비어 있어 완료조건이 없다. 마일스톤을 M6 으로 정한 것은 사용자다. 이번 작업은 이슈 #381(AI 처리 단계 보고)을 근거로 했고, 설계는 이슈 댓글 "설계 확정"(2026-11-05)을 따랐다. 전체 계획 M6(프론트·AI 통합과 계약 확정)의 "프론트·AI 통합" 중 진행 표시에 해당하는 작업이다. M6 완료는 판정하지 않는다.

회의 상세의 `progress` 세 키가 발화나 추출 항목이 저장된 뒤에야 true가 되던 것을, AI 가 처리 단계가 시작될 때 알려주면 그 시점에 true가 되게 했다. 보고가 없으면 지금처럼 데이터로 판정한다.

## 실제 구현 및 관련 코드

| 변경 | 위치 |
|---|---|
| `meeting.processing_stage`(문자열 16자), `processing_stage_at`(시각) nullable 컬럼 2개와 단계 값 enum. 마이그레이션 1건, 백필 없음 | [models.py](../../../app/models/models.py) `MeetingProcessingStage`, [마이그레이션](../../../migrations/versions/a3d7f91c5e28_add_meeting_processing_stage.py) |
| `PATCH /api/v1/meetings/{meeting_id}/stage`(서비스 토큰). 요청 `{stage}`, 응답 `{meeting_id, status, processing_stage, applied}`. 잘못된 값 400, 없는 회의 404 `MEETING_NOT_FOUND`. 새 오류 코드 없음 | [meetings.py](../../../app/api/meetings.py), [meeting.py](../../../app/schemas/meeting.py) |
| 조건부 UPDATE 한 문장으로 `processing` 이고 단계가 없거나 앞선 회의만 갱신. 반영하지 않으면 `applied=false` | [meeting_stage.py](../../../app/services/meeting_stage.py) |
| `progress` 판정식에 단계 반영(회의 상세·실패 응답 공통). 응답에 단계 값은 싣지 않음 | [meetings.py](../../../app/api/meetings.py) `_compute_progress` |
| AI: `BeClient.report_stage`(타임아웃 3초), `Handoff.report_stage`(회의 ID 없으면 안 부름, 오류는 로그만), `process_session` 단계 시작에서 보고 | `ai/capture/handoff.py`, `ai/capture/recorder.py` (사용자가 이번 PR 한정으로 허락) |
| 테스트 | [test_meeting_stage.py](../../../tests/api/test_meeting_stage.py), AI 쪽은 `ai/tests/capture/`의 `test_handoff.py`, `test_recorder.py`, `test_discord_adapter.py`, `fake_be.py` |
| 계약 | [BE↔AI 계약 처리 단계 보고](../../contracts/backend-ai-contract.md#patch-meetingsmeeting_idstage--200). FE 계약 문서는 고치지 않았다 |

## 완료조건 확인

plan.md 가 비어 있어 완료조건이 없다. 아래는 이슈 #381 의 설계 확정 항목에 이번 작업을 대조한 것이다.

| #381 설계 항목 | 상태 | 근거 |
|---|---|---|
| 회의 컬럼 2개와 마이그레이션 1건 | 구현. DB 마이그레이션 실행은 미검증 | 모델·마이그레이션 파일 존재, pytest 는 모델에서 만든 테이블로 돌았다. `alembic upgrade`·`alembic check`는 이번 작업에서 돌리지 않았다 |
| 단계 값 4개와 순서 | 구현 | `test_meeting_stage.py` 통과 |
| 같은 단계·역행·`processing` 아닌 회의는 200 `applied=false` | 구현 | `test_meeting_stage.py` 통과 |
| `progress` 가 단계를 반영하고 기존 판정 유지 | 구현 | `test_meeting_stage.py`, 기존 `test_extraction_evidence.py` 통과 |
| 응답에 `processing_stage` 를 싣지 않음 | 구현 | 회의 상세 스키마를 바꾸지 않았다 |
| AI 보고(단계 시작 시점, 실패 삼킴) | 구현. AI 파트 리뷰를 받았다(#383, 후속 PR #444) | AI 테스트 실행 결과는 아래 검증 내역 |
| 계약 문서 갱신 | 완료 | 합의 상태는 "구현됨(#381, PR #383), AI 리뷰 받음" |
| [BE→FE] 이슈, `progress` 의미 변화 전달 | 완료 | #384 로 올렸고 FE 답변(`processing_stage` 불필요, 계약 반영은 FE PR #399)을 받아 닫았다 |

## 검증 내역

- 2026-11-05 `backend/` 에서 `.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider`: 1266 passed, 777 skipped, 3 warnings(115.94초). skip 는 PostgreSQL 이 필요한 테스트로 보이나 사유는 `-rs` 로 확인하지 않았다. `tests/api/test_meeting_stage.py`와 `tests/api/test_extraction_evidence.py` 만 따로 돌린 결과는 87 passed(handoff 뒤 늦은 stt 테스트 추가 전)
- 같은 시점 `.venv/Scripts/python.exe -m ruff check --no-cache .`: All checks passed
- 같은 시점 저장소 밖 가벼운 venv(`~/.mm-ai-venv`, discord·faster-whisper 없음)에서 `ai/` 의 `python -m pytest tests/capture -q --continue-on-collection-errors`: 9 failed, 272 passed, 11 errors. 실패 목록은 develop 기준과 같다(환경 문제: Windows 경로, discord 미설치, fcntl). discord 가 필요한 테스트는 CI `ai-ci` 가 덮는다.
- 조건부 UPDATE(`report_stage`)는 sqlite 테스트로만 확인했고 PostgreSQL 에서는 확인하지 않았다.
- 실제 PostgreSQL 에 대한 마이그레이션 실행, 실제 봇과 BE 를 붙인 종단 확인은 하지 않았다.

## 계획 대비 변경

계획(plan.md)이 비어 있어 대비할 계획이 없다. 이슈 설계 확정과 다른 점은 없다. 단, 이슈가 BE 파트 PR 에서 AI 코드를 함께 고치는 것을 이번 PR 한정으로 허락받은 일로 적었고, 그에 따라 `ai/` 파일이 이 변경에 포함됐다.

## 남은 작업과 제한 사항

- AI 파트 리뷰는 #383 에서 받았고 후속은 PR #444 에서 계약 문서에 반영했다. 업로드 회의도 단계를 보고하고 채팅(#378) 경로는 보고하지 않는다.
- FE 에 `progress` 의미 변화(그 단계가 시작되면 true), 화면 단계 이름, 단계 값 노출 여부를 알리는 [BE→FE] 이슈. 프론트 계약 문서는 FE 파트가 관리한다.
- 단계 보고는 진행 표시 뒤, ops 단계를 열기 전에 하므로 보고 시간은 ops 단계 시간에 들어가지 않는다. BE 장애 때 단계 시작이 늦어질 수 있다(3초는 연결·읽기 각각의 값이고 합계 상한은 보장하지 않는다).
- 한 회의의 현재 단계만 저장하므로 단계별 시각 이력은 없다.
- 마이그레이션을 실제 DB 에 적용해 확인하지 않았다.

## 2026-11-07 추가: 승인 대기 새 항목 요청을 유사 검색에 넣기(#141 첫 PR)

M6 plan.md 는 비어 있어 완료조건이 없다. 마일스톤을 M6 으로 정한 것은 사용자다. 근거는 이슈 #141 의 합의(BE 제안·AI 답·BE 확인)와 설계 확정 댓글(2026-11-07)이다. #141 의 BE 몫 가운데 검색·임베딩만 했고, 합치기(action=merge)는 #464 머지 뒤 다음 PR 에서 한다. M6 완료는 판정하지 않는다.

| 변경 | 위치 |
|---|---|
| `approval_request.embedding`, `embedding_rejected_title` 컬럼과 마이그레이션 1건(백필 없음) | `backend/app/models/models.py`, `backend/migrations/versions/a7c25d91e4f3_add_approval_request_embedding.py` |
| 임베딩 워커가 task 다음에 승인 대기 task_create 요청의 제목을 채운다 | `backend/app/services/embedding.py`(`process_missing_approval_embeddings`, `pending_title`) |
| 승인 대기 요청 검색(최대 2개)과 검색 못 하는 요청 판정 | `backend/app/services/embedding.py`(`search_similar_pending_approvals`, `has_unsearchable_pending`) |
| `POST /tasks/similar` 의 `include_pending`(기본 false), 후보 `approval_id` | `backend/app/api/similar_tasks.py`, `backend/app/schemas/task.py` |
| 임베딩 없는 승인 대기 요청이 있으면 judge auto 를 막는다(`unsearched_pending_exists`) | `backend/app/services/matching.py`, `backend/app/api/extractions.py` |
| 계약 | [BE↔AI 계약](../../contracts/backend-ai-contract.md) 유사 검색 절과 auto 조건 |

| #141 합의 항목 | 상태 | 근거 |
|---|---|---|
| 승인 대기 task_create 제목 임베딩(task 와 같은 워커) | 구현 | `tests/services/test_embedding.py` |
| 유사 검색에 승인 대기 요청, 후보에 approval_id, 기본 false | 구현 | `tests/api/test_similar_tasks_api.py` |
| task 후보 k개와 따로 최대 2개 | 구현. 쿼리는 PostgreSQL 테스트로만 확인되고 로컬에서는 돌지 않았다 | `tests/services/test_embedding_search_pg.py`(CI) |
| auto 게이트: 임베딩 없는 승인 대기 요청이 있으면 막음 | 구현 | `tests/api/test_extractions_judge_auto.py`, `tests/services/test_matching_auto_blockers.py` |
| action=merge, 합치기 규칙, 여러 회의 항목 task_id, 행 잠금 | 다음 PR(#464 머지 뒤) | 설계 확정 댓글 |

검증(2026-11-07, `backend/`):

- `.venv/Scripts/python.exe -m ruff check --no-cache .`: All checks passed
- `.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider`: 1798 passed, 1273 skipped, 3 warnings. skip 는 PostgreSQL 이 필요한 테스트이고, 새 승인 대기 검색 테스트 3개도 여기에 들어 CI 에서 처음 돈다.
- 마이그레이션은 실제 DB 에 적용하지 않았다(CI migrations 잡에서 확인). 실제 임베딩 API 호출과 AI 를 붙인 종단 확인은 하지 않았다.

남은 작업: 합치기 PR, AI 의 대기 후보 처리와 `include_pending` 켜기(합치기 배포 뒤), FE 답(#512).

## 2026-11-07 추가: 답장 담당자 변경 승인에서 PM 이 고른 담당자 받기

M6 plan.md 는 비어 있어 완료조건이 없다. 마일스톤을 M6 으로 정한 것은 사용자다. 근거는 이슈 #460 과 설계 확정 댓글(2026-11-07)이고, BE 몫만 구현했다. FE 고르기 화면은 #344 에서 한다. M6 완료는 판정하지 않는다.

| 변경 | 위치 |
|---|---|
| 담당자 줄이 있는 답장 카드만 `task_overrides.assignee_member_id` 를 받는다 | `backend/app/api/approvals.py`(`_normalize_overrides`), `backend/app/services/replies.py`(`has_assignee_line`) |
| 담당자를 못 찾은 줄에도 충돌 기준값을 남긴다 | `backend/app/services/replies.py`(`_propose`) |
| 요청 설명 | `backend/app/schemas/approval.py` |

| 이슈 요구 | 상태 | 근거 |
|---|---|---|
| 고른 값(미정 포함)으로 담당자를 바꾸고 이력을 남긴다 | 충족 | `test_unresolved_card_takes_the_member_the_pm_picked`, `test_unresolved_card_can_clear_the_assignee` |
| 값 검증은 `task_create` 와 같다 | 충족 | `test_assignee_override_value_is_checked` 외 다른 공간·탈퇴자 테스트 |
| 골라 승인하면 `noted` 가 아니라 `approved` | 충족. 지금 담당자와 같은 사람을 고르면 `noted`(설계 확정에서 정함) | `test_unresolved_card_with_the_current_assignee_stays_noted` |
| 찾은 카드도 고칠 수 있다 | 충족 | `test_resolved_card_can_be_changed_to_another_member` |
| 다른 카드는 지금처럼 거절 | 충족 | `test_assignee_override_is_judged_per_card`, `test_meeting_task_update_refuses_an_assignee_override`, `test_manual_card_claiming_reply_source_refuses_an_assignee_override` |
| 계약 문서 갱신 | 미충족(BE 몫 아님). `frontend/` 문서라 바꿀 곳과 문구를 #460 댓글로 전달하고 FE 가 반영한다 | #460 댓글 |

검증(2026-11-07, `backend/`):

- `.venv/Scripts/python.exe -m ruff check --no-cache .`: All checks passed
- `.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider`: 1804 passed, 1298 skipped, 3 warnings
- 행 잠금과 조건부 UPDATE 의 실제 경합은 sqlite 로 재현되지 않아 코드로만 확인했다. PostgreSQL 파라미터는 CI 에서 돈다.
- 실제 FE·AI 와 붙인 종단 확인과 배포 환경 확인은 하지 않았다. 모델·마이그레이션 변경은 없다.

남은 작업: FE 고르기 화면과 계약 반영(#344). BE 배포 뒤 #460 에 알린다. 회의 추출의 못 찾은 담당자 카드는 범위 밖이다.

## 2026-11-07 메시지 탭 읽지 않은 수 (#480)

### 작업 근거와 요약

M6 plan.md 는 비어 있어 완료조건이 없다. 마일스톤을 M6 으로 정한 것은 사용자다(메시지 설정 기록이 M6 에 있다). 이슈 #480(FE 요청)과 이슈 댓글 "설계 확정"(2026-11-07)을 따랐다. M6 완료는 판정하지 않는다.

메시지 탭 배지를 위해 사람·대화마다 읽은 위치를 저장하고, 읽지 않은 메시지 수를 대화 목록·상세와 새 숫자 API 로 준다. 화면이 POST 로 알릴 때만 읽음이 된다.

### 실제 구현 및 관련 코드

| 변경 | 위치 |
|---|---|
| 새 표 `message_thread_read`(`thread_id`·`member_id` 기본 키, `last_read_at`, `updated_at`). 마이그레이션이 탈퇴하지 않은 팀원의 자기 대화와 PM 의 워크스페이스 모든 대화를 마이그레이션 시각으로 채운다 | [models.py](../../../app/models/models.py) `MessageThreadRead`, [마이그레이션](../../../migrations/versions/5d2e8a41c7b3_add_message_thread_read.py) |
| 읽지 않은 수 계산(쿼리 하나), 읽음 처리(뒤로 가지 않음, 처음 넣기 경쟁은 savepoint 와 조건부 UPDATE), 승격 때 남의 대화 읽음(자기 대화는 제외) | [message_reads.py](../../../app/services/message_reads.py) |
| `GET /api/v1/workspaces/{ws}/messages/unread-count` → `{unread_count}`, `POST /api/v1/workspaces/{ws}/messages/threads/{thread_id}/read` → `{thread_id, unread_count: 0, total_unread_count, last_read_at}`, `ThreadSummary.unread_count`. 새 오류 코드 없음 | [messages.py](../../../app/api/messages.py), [message.py](../../../app/schemas/message.py) |
| 팀원을 PM 으로 올리면 같은 PATCH 커밋 안에서 그 순간까지 읽음 | [members.py](../../../app/api/members.py) `update_member` |
| 테스트 | [test_message_reads_service.py](../../../tests/api/test_message_reads_service.py), [test_message_unread_api.py](../../../tests/api/test_message_unread_api.py), [test_migration_message_thread_read.py](../../../tests/test_migration_message_thread_read.py) |

### 완료조건 확인

| #480 설계 항목 | 상태 | 근거 |
|---|---|---|
| 새 표·마이그레이션, 기존 메시지 읽음으로 채움 | 구현. DB 마이그레이션 실행은 미검증 | 마이그레이션 테스트(sqlite) 통과. `alembic upgrade`·`alembic check` 는 CI migrations 잡에서 확인 |
| 메시지 개수, 도착 시각 `coalesce(received_at, created_at)` | 구현 | 늦게 들어온 디스코드 답장 테스트 통과 |
| POST 로만 읽음, GET 은 쓰기 없음 | 구현 | API 테스트 통과 |
| PM 마다 따로, PM 자기 대화 봇 메시지 포함 | 구현 | 서비스·API 테스트 통과 |
| 팀원 답장 앞 봇 메시지는 읽음 | 구현 | 서비스 테스트 통과 |
| 탈퇴 팀원 대화·보내기 전 묶음 제외 | 구현 | 서비스·API 테스트 통과 |
| 승격 때 그 순간까지 남의 대화 읽음, 자기 대화의 봇 메시지는 그대로 | 구현 | API 테스트(기능 없이 실패 확인) 통과 |
| 목록 쿼리 수가 대화 수에 비례하지 않음 | 구현 | 대화 2개·4개에서 집계 SELECT 1개 |
| 종 알림 변경 없음 | 지킴 | `notifications` 코드를 바꾸지 않았다 |
| FE 전달 | 이슈 #480 댓글 | PR 본문 참고 |

### 검증 내역

- 2026-11-07 `backend/` 에서 `.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider`: 2052 passed, 1425 skipped(PostgreSQL 이 필요한 테스트, `TEST_DATABASE_URL` 없음). `ruff check --no-cache .`: 통과.
- 새 테스트는 구현 전에 실패하는 것을 확인했다. 읽음 처리가 도착 시각 대신 `created_at` 을 쓰면 실패하는 것도 확인했다.
- 동시 첫 읽음 테스트(PostgreSQL 전용)와 PostgreSQL 에서의 시각 저장은 로컬에서 돌리지 않았다. CI 에서 확인한다.

### 계획 대비 변경

설계 확정과 다른 점: 팀원이 남의 대화(탈퇴한 팀원 대화 포함)에 POST 하면 404 가 아니라 403 이다. 대화 상세 GET 과 같은 순서로 권한을 먼저 본다. PM 이 탈퇴 팀원 대화에 POST 하면 설계대로 404 다.

### 남은 작업과 제한 사항

- FE: POST 를 부를 시점, 숫자 API 주기, FE 계약 문서 갱신. 종 알림과 묶을지는 후속.
- POST 는 부르는 순간 그 대화의 가장 늦은 메시지까지 옮긴다. 상세를 받은 뒤 들어온 답장도 읽음이 된다.
- 스케줄러 틱 안(생성과 커밋 사이)에 읽음 처리가 들어오면 그 봇 메시지는 세지지 않을 수 있다.
- 동시성 테스트는 둘째 세션이 UPDATE 를 한 번 했는지는 보지만 IntegrityError 를 거쳤는지 직접 확인하지는 않는다.
- 승격은 대화마다 쿼리가 나가고, 대화 상세도 보는 사람의 모든 대화를 집계한다.

## 2026-11-07 추가: 다른 회의의 같은 새 항목을 승인 대기 카드에 합치기(#141 두 번째 PR)

M6 plan.md 는 비어 있어 완료조건이 없다. 마일스톤을 M6 으로 정한 것은 사용자다. 근거는 이슈 #141 의 합의와 PR 2 설계 확정 댓글(2026-11-07)이다. M6 완료는 판정하지 않는다.

| 변경 | 위치 |
|---|---|
| 추출 등록 항목의 `action: merge`, `target_approval_id`. 대상 카드를 ID 순으로 잠그고 합치며, 쓸 수 없으면 create(auto 아님) | `backend/app/api/extractions.py`, `backend/app/schemas/meeting.py`, `backend/app/models/models.py`(`ExtractionAction.MERGE` 값만) |
| 합치기 규칙(마감·상태·담당자·doc_text·merged_items)과 담당 항목(`assignee_item_of`) | `backend/app/services/pending_merge.py` |
| 승인 때 최신 카드 값을 다시 읽고 연결된 모든 항목에 task_id. 별칭은 카드의 담당 항목에서만 저장 | `backend/app/api/approvals.py`, `backend/app/services/alias_learning.py` |
| 별칭 후보를 카드의 담당 항목으로 거름(승인 목록·상세, 추출 조회) | `backend/app/services/alias_learning.py`, `backend/app/api/extractions.py` |
| 계약 | [BE↔AI 계약](../../contracts/backend-ai-contract.md) 추출 등록 절, [Backend README](../../../README.md) 유사 task 검색과 별칭 학습 절 |

| #141 합의 항목 | 상태 | 근거 |
|---|---|---|
| action=merge 와 합치기 규칙, 대상을 못 쓰면 create | 구현 | `tests/services/test_pending_merge.py`, `tests/api/test_extractions_merge.py` |
| 승인 때 최신 값, 여러 회의 항목 task_id | 구현 | `tests/api/test_approval_merged_card.py` |
| 별칭 학습과 후보를 담당 항목으로 | 구현 | `tests/api/test_alias_learning_approval.py`, `tests/services/test_alias_learning.py` |
| 행 잠금(합치기와 승인, 반대 순서 두 카드) | 구현. PostgreSQL 테스트로만 확인되고 로컬에서는 돌지 않았다 | `tests/api/test_pending_merge_concurrency.py`(CI) |

검증(2026-11-08, `backend/`):

- `.venv/Scripts/python.exe -m ruff check --no-cache .`: All checks passed
- `.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider`: 2307 passed, 1485 skipped. skip 는 PostgreSQL 이 필요한 테스트이고 새 동시성 테스트 3개도 여기에 들어 CI 에서 처음 돈다.
- 실제 AI 를 붙인 종단 확인과 배포 환경 확인은 하지 않았다. 모델 컬럼·마이그레이션 변경은 없다.

남은 작업: AI 의 merge 전송과 `include_pending` 켜기(BE 배포 뒤), FE 답(#512)과 합친 카드 표시, 승인 사이에 담당 항목이 바뀐 경우의 별칭 저장(결정 기록의 장단점).

## 2026-11-08 추가: 전사 진행과 단계 시작 시각을 회의 상세에 노출(#483 A안 BE 몫)

M6 plan.md 는 비어 있어 완료조건이 없다. #381 과 같은 M6 에 둔다. 근거는 이슈 #483 과 설계 확정 댓글(2026-11-08)이고, AI·BE·FE 공동 이슈 중 BE 몫만 구현했다. M6 완료는 판정하지 않는다.

| 변경 | 위치 |
|---|---|
| 회의에 전사 진행 컬럼 2개 | `backend/app/models/models.py`, 마이그레이션 `d6e1b4a8c297` |
| stage 보고가 `stt: {done, total}` 을 받고 같은 stt 단계에서는 진행만 고친다 | `backend/app/services/meeting_stage.py`, `backend/app/schemas/meeting.py` |
| 상세·`/fail` 응답 `processing`, stage 응답 `stt` | `backend/app/api/meetings.py` |

| 이슈 요구(BE) | 상태 | 근거 |
|---|---|---|
| stage 보고로 전사 진행을 받는다, 같은 단계 재전송은 진행만 갱신 | 충족 | `test_stt_progress_is_stored_and_exposed`, `test_stt_progress_update_keeps_stage_at`, `test_same_stt_progress_is_ignored`, `test_stt_resend_without_progress_keeps_progress`, `test_stt_progress_decrease_overwrites` |
| 단계가 넘어가거나 늦은 보고는 진행을 바꾸지 않는다 | 충족 | `test_moving_past_stt_clears_progress`, `test_late_stt_progress_after_handoff_is_ignored`, `test_late_stt_progress_does_not_change_stored_value_after_handoff` |
| 잘못된 진행 값은 400 | 충족 | `test_stt_progress_invalid_400` |
| `GET /meetings/{id}` 에 `processing: {stage, stage_at, stt}`, `progress` 유지 | 충족. processing 이 아닌 회의는 `null`(설계 확정에서 정함) | `test_stt_progress_ignored_on_non_processing`, `test_processing_without_report_has_empty_fields`, `test_fail_response_processing_is_null`, 기존 `progress` 테스트 |
| AI 진행 보고, FE 화면·모의 서버·FE 계약 | 미충족(BE 몫 아님) | #483 댓글로 전달 |

검증(2026-11-08, `backend/`):

- `.venv/Scripts/python.exe -m ruff check --no-cache .`: All checks passed
- `.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider`: 2260 passed, 1501 skipped. skip 은 PostgreSQL 이 필요한 테스트이고 CI 에서 돈다.
- 마이그레이션은 실제 DB 에 적용하지 않았다(CI migrations 잡에서 확인). 조건부 UPDATE 의 실제 경합은 sqlite 로 재현되지 않는다. AI·FE 와 붙인 종단 확인은 하지 않았다.

남은 작업: AI 진행 보고(단위·빈도 결정 포함), FE 화면과 FE 계약 반영. BE 배포 뒤 #483 에 알린다.

## 2026-11-08 추가: PM 글과 읽지 않은 수 통합

### 작업 근거와 실제 변경

사용자가 PR #454, #518, #524의 순차 백엔드 작업을 요청해 #518을 최신 `develop`과 대조했다. M6 계획은 비어 있으므로 마일스톤 완료를 판정하지 않는다.

- `messages.py` 병합에서 대화 열기와 최신 읽음 API를 모두 유지했다. 대화 열기 응답도 현재 사용자의 `unread_count`를 대화 요약에 전달한다.
- 자기 대화의 상대편 메시지를 기존 `MessageSender`의 `BOT`, `PM` 값으로 조회한다. 다른 팀원의 대화를 보는 PM은 기존처럼 `MEMBER`만 센다. 대화 주인의 후속 답장과 명시적 읽음 처리는 PM 글에도 적용된다.
- `5ae76a6102a8`의 부모를 최신 기반의 `5d2e8a41c7b3`으로 연결했다. 별도 스키마 변경은 추가하지 않았다.
- [프론트엔드 대표 계약](../../../../frontend/docs/contracts/frontend-api-contract.md#57-메시지) §5.7에 확인한 읽음 API와 PM 글 집계의 구현 사실을 기록했다. FE 연결·합의 완료는 선언하지 않았다.

### 검증 내역

2026-11-08 로컬 Windows에서 Python 3.12로 실행했다.

- 수정 전 새 회귀에서 PM 글의 읽지 않은 수가 1 대신 0으로 나오는 실패 2건과 대화 열기의 `_summary` 인자 누락 `TypeError` 1건을 확인했다. 기존 `test_opening_a_thread_twice_gives_the_same_thread`도 같은 `TypeError`로 실패했다.
- 수정 후 `pytest tests/api/test_member_messages.py tests/api/test_message_notifications.py tests/api/test_message_reads_service.py tests/api/test_message_unread_api.py tests/api/test_messages_api.py -q --tb=short --basetemp=<격리 경로>`는 123개 통과, PostgreSQL 미설정 및 관련 조건으로 125개 건너뜀.
- PM 글 전송 후 팀원 배지 증가, 팀원 웹 답장 후 팀원 배지 해제·PM 배지 증가, 명시적 읽음 후 0, PM 작성 글의 다른 대화 미집계를 확인했다.
- `ruff check .` 통과. `alembic heads`는 `5ae76a6102a8 (head)` 하나를 반환했다.
- `develop@2ba38e96` 기반 전체 백엔드 회귀는 2318개 통과, 1561개 건너뜀. 이후 `033293b4`를 추가 병합하고 메시지·알림·읽음 및 #533 추출 합치기 관련 테스트를 함께 실행해 207개 통과, 185개 건너뜀을 확인했다. 최신 기반 전체 PostgreSQL 회귀는 CI에서 확인해야 한다.

### 계획 대비 변경과 제한 사항

PR 작성 뒤 #480의 읽음 수가 `develop`에 들어와 새 PM 글과 연결할 필요가 생겼다. 기존 읽음 위치와 집계 쿼리 구조를 유지하고 상대편 발신자 범위만 늘렸다. 실제 PostgreSQL 마이그레이션·동시성·Discord 송신은 이번 로컬 검증에서 실행하지 않았다.

사용자의 순차 병합 요청에 따라 선행 #454의 최종 코드를 이 브랜치에 일반 병합하고, `5ae76a6102a8`의 부모를 가입 인증의 `d2f6b81c4e07`으로 연결했다. 이후 #542가 develop에 병합되어 해당 변경도 반영했다. 최종 체인은 읽음 위치 → STT 진행률 → 가입 인증 → PM 작성자 순서이며 단일 head는 `5ae76a6102a8`이다. 실제 develop 병합은 #454 다음에 진행한다. PR의 base와 기존 이력은 유지한다.

최종 통합 후 PM 메시지·알림·읽음·가입·카카오 API 테스트는 131개 통과, 133개 건너뜀이다. Ruff와 단일 Alembic head 확인도 통과했다. PostgreSQL 전체 회귀와 업그레이드는 이 통합 커밋의 CI에서 확인한다.

#542 추가 반영 뒤 STT 진행률·PM 메시지·읽음 API 회귀는 89개 통과, 89개 건너뜀이다. 별도 검증자는 인증 코드 가입부터 초대 수락·대화 열기·PM 글·읽음·답장·봇 인계 및 결과 보고까지 실제 HTTPS 요청 41개로 검증했다. SQLite와 로컬 메일·Discord 경계 대역을 사용하므로 실제 PostgreSQL·SMTP·Discord 검증을 대신하지 않는다.

## 2026-11-08 추가: 웹 답장 안내의 대기 수와 읽음 응답 통합

### 작업 근거와 실제 변경

사용자가 PR #454, #518, #524의 순차 백엔드 작업을 요청해 #524를 최신 `develop@033293b4`와 대조했다. M6 계획은 비어 있으므로 마일스톤 완료를 판정하지 않는다.

- 대화 요약의 `web_reply_available`과 최신 `unread_count`를 함께 보존해 API·스키마 병합 충돌을 해결했다. 기존 읽음 수·명시적 읽음 API도 유지했다.
- [메시지 서비스](../../../app/services/messages.py)의 DM 안내 집계에서 `paused_at`이 있는 시계를 제외했다. 팀원 답장이 PM 확인 대기여서 시계가 `WATCHING`으로 남아도 새 답장을 기다리는 수에 다시 넣지 않는다.
- [BE↔AI 계약](../../contracts/backend-ai-contract.md)의 `n` 정의에 실제 제외 조건을 반영했다. API 필드나 승인 정책을 추가하지 않았으며 새 합의 완료를 선언하지 않는다.

### 검증 내역

2026-11-08 로컬 Windows에서 Python 3.12로 실행했다.

- 새 `test_a_reply_waiting_for_pm_review_leaves_the_count`는 수정 전 안내가 1개 대신 2개를 반환해 실패했다. `WATCHING`이면서 `paused_at`이 설정된 상태를 기존 답장 판단·스케줄러 흐름으로 만들었다.
- 수정 후 `pytest tests/api/test_reminder_dm_notice.py tests/api/test_messages_api.py tests/api/test_scheduler.py tests/api/test_reply_clock.py tests/api/test_message_unread_api.py -q --tb=short --basetemp=<격리 경로>`는 159개 통과, PostgreSQL 미설정 및 관련 조건으로 158개 건너뜀.
- `ruff check .` 통과. `alembic heads`는 `5d2e8a41c7b3 (head)` 하나를 반환했다. 이번 변경은 마이그레이션을 추가하지 않는다.
- `develop@033293b4` 기반 전체 백엔드 회귀는 2370개 통과, 1540개 건너뜀. PostgreSQL 전용 및 조건부 테스트는 실행되지 않았다. 실제 PostgreSQL은 CI에서 확인해야 한다.

### 계획 대비 변경과 제한 사항

이미 답한 태스크가 PM 확인 때문에 정지한 상태를 안내 집계가 구분하지 못해 실제 응답 대기보다 큰 수가 나왔다. 기존 시계의 `paused_at`을 조회 조건에 추가해 해결했다. 전체 회귀·PostgreSQL·실제 Discord 발송은 이번 타깃 검증의 범위 밖이다.

초기 개별 수정 뒤 사용자가 순차 병합까지 요청해 선행 #518의 최종 코드를 이 브랜치에 일반 병합했다. `_dm_body`는 기존 `MessageSender`로 PM 글을 먼저 분기하고, PM 글에는 공간·작성자 안내, 봇 리마인드에는 응답 대기 수를 붙인다. 두 경우 모두 기존 `_reply_guide`로 계정 연결 여부에 맞는 웹 안내를 만든다. 별도 PM·리마인드 헬퍼를 늘리면 같은 안내와 단일 호출자를 나누게 되어 한 함수의 작은 분기를 유지했다.

- 통합 직후 PM 글이 `리마인드가 0개` 안내로 바뀌는 실패 2건을 먼저 확인했다. 수정 후 PM 작성자·본문 비노출, 계정이 없는 수신자의 초대 요청·가입 링크, 정상 리마인드 수와 정지 시계 제외를 함께 확인했다.
- 최종 타깃 `test_member_messages.py`, `test_message_notifications.py`, `test_reminder_dm_notice.py`, `test_messages_api.py`, `test_message_unread_api.py`, `test_reply_clock.py`는 171개 통과, 170개 건너뜀이다. Ruff와 `5ae76a6102a8` 단일 head 확인도 통과했다.
- 대화 요약은 PM 작성자, 마지막 봇·PM DM 실패, `web_reply_available`, `unread_count`를 모두 보존한다. API·문서의 옛 Discord DM 자동 저장 정책은 웹 답장 안내 정책으로 유지했다. AI 코드는 새로 수정하지 않았다.
- 이 통합의 실제 PostgreSQL 전체 회귀와 업그레이드는 최종 CI에서 확인한다. 실제 develop 병합은 #454, #518 다음에 진행한다.
- 선행 #518의 최신 `e4ffc0d0`을 추가 병합해 #542 STT 진행률과 가입 인증 마이그레이션 연결도 반영했다. 최종 메시지·리마인드·읽음·답장 시계·STT API 회귀는 214개 통과, 213개 건너뜀이다. 단일 head는 `5ae76a6102a8`이고 Ruff도 통과했다.

## 관련 기록

- [전사 진행과 단계 시작 시각을 회의 상세에 노출한다](basis-for-decision/2026-11-08-processing-stt-progress.md)
- [다른 회의의 같은 새 항목을 승인 대기 카드에 합친다](basis-for-decision/2026-11-07-pending-merge.md)
- [승인 대기 새 항목 요청을 유사 검색 후보에 따로 더한다](basis-for-decision/2026-11-07-pending-approval-search.md)
- [답장 담당자 변경 승인에서 PM 이 담당자를 고르게 한다](basis-for-decision/2026-11-07-reply-assignee-override.md)
- [처리 단계 보고를 회의 컬럼으로 저장한다](basis-for-decision/2026-11-05-processing-stage-report.md)
- [메시지 탭 읽지 않은 수를 대화별 읽은 위치로 센다](basis-for-decision/2026-11-07-message-unread-count.md)
- [BE↔AI 계약](../../contracts/backend-ai-contract.md)
