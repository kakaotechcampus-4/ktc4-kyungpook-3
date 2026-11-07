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

## 2026-11-07 메시지 탭 읽지 않은 수 (#480)

### 작업 근거와 요약

M6 plan.md 는 비어 있어 완료조건이 없다. 마일스톤을 M6 으로 정한 것은 사용자다(메시지 설정 기록이 M6 에 있다). 이슈 #480(FE 요청)과 이슈 댓글 "설계 확정"(2026-11-07)을 따랐다. M6 완료는 판정하지 않는다.

메시지 탭 배지를 위해 사람·대화마다 읽은 위치를 저장하고, 읽지 않은 메시지 수를 대화 목록·상세와 새 숫자 API 로 준다. 화면이 POST 로 알릴 때만 읽음이 된다.

### 실제 구현 및 관련 코드

| 변경 | 위치 |
|---|---|
| 새 표 `message_thread_read`(`thread_id`·`member_id` 기본 키, `last_read_at`, `updated_at`). 마이그레이션이 탈퇴하지 않은 팀원의 자기 대화와 PM 의 워크스페이스 모든 대화를 마이그레이션 시각으로 채운다 | [models.py](../../../app/models/models.py) `MessageThreadRead`, [마이그레이션](../../../migrations/versions/5d2e8a41c7b3_add_message_thread_read.py) |
| 읽지 않은 수 계산(쿼리 하나), 읽음 처리(뒤로 가지 않음, 처음 넣기 경쟁은 savepoint 와 조건부 UPDATE), 승격 때 모든 대화 읽음 | [message_reads.py](../../../app/services/message_reads.py) |
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
| 승격 때 그 순간까지 읽음 | 구현 | API 테스트(기능 없이 실패 확인) 통과 |
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

## 관련 기록

- [처리 단계 보고를 회의 컬럼으로 저장한다](basis-for-decision/2026-11-05-processing-stage-report.md)
- [메시지 탭 읽지 않은 수를 대화별 읽은 위치로 센다](basis-for-decision/2026-11-07-message-unread-count.md)
- [BE↔AI 계약](../../contracts/backend-ai-contract.md)
