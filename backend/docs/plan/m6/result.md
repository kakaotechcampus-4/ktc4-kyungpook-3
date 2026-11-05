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
| 테스트 | [test_meeting_stage.py](../../../tests/api/test_meeting_stage.py), AI 쪽은 `ai/tests/capture/`의 `test_handoff.py`, `test_recorder.py`, `test_recovery.py`, `fake_be.py` |
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
| AI 보고(단계 시작 시점, 실패 삼킴) | 구현. AI 파트 리뷰 대기 | AI 테스트 실행 결과는 아래 검증 내역 |
| 계약 문서 갱신 | 완료 | 합의 상태는 "구현됨(#381), AI 리뷰 대기" |
| [BE→FE] 이슈, `progress` 의미 변화 전달 | 미수행 | PR 뒤 따로 올린다 |

## 검증 내역

- 2026-11-05 `backend/` 에서 `.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider`: 1266 passed, 777 skipped, 3 warnings(115.94초). skip 는 PostgreSQL 이 필요한 테스트로 보이나 사유는 `-rs` 로 확인하지 않았다. `tests/api/test_meeting_stage.py`와 `tests/api/test_extraction_evidence.py` 만 따로 돌린 결과는 87 passed(handoff 뒤 늦은 stt 테스트 추가 전)
- 같은 시점 `.venv/Scripts/python.exe -m ruff check --no-cache .`: All checks passed
- 같은 시점 저장소 밖 가벼운 venv(`~/.mm-ai-venv`, discord·faster-whisper 없음)에서 `ai/` 의 `python -m pytest tests/capture -q --continue-on-collection-errors`: 9 failed, 272 passed, 11 errors. 실패 목록은 develop 기준과 같다(환경 문제: Windows 경로, discord 미설치, fcntl). discord 가 필요한 테스트는 CI `ai-ci` 가 덮는다.
- 조건부 UPDATE(`report_stage`)는 sqlite 테스트로만 확인했고 PostgreSQL 에서는 확인하지 않았다.
- 실제 PostgreSQL 에 대한 마이그레이션 실행, 실제 봇과 BE 를 붙인 종단 확인은 하지 않았다.

## 계획 대비 변경

계획(plan.md)이 비어 있어 대비할 계획이 없다. 이슈 설계 확정과 다른 점은 없다. 단, 이슈가 BE 파트 PR 에서 AI 코드를 함께 고치는 것을 이번 PR 한정으로 허락받은 일로 적었고, 그에 따라 `ai/` 파일이 이 변경에 포함됐다.

## 남은 작업과 제한 사항

- AI 파트 리뷰. 수동 업로드와 채팅(#378) 경로는 단계를 보고하지 않는다.
- FE 에 `progress` 의미 변화(그 단계가 시작되면 true), 화면 단계 이름, 단계 값 노출 여부를 알리는 [BE→FE] 이슈. 프론트 계약 문서는 FE 파트가 관리한다.
- 단계 보고는 진행 표시 뒤, ops 단계를 열기 전에 하므로 보고 시간은 ops 단계 시간에 들어가지 않는다. BE 장애 때 단계 시작이 최대 타임아웃(3초)만큼 늦어질 수 있다.
- 한 회의의 현재 단계만 저장하므로 단계별 시각 이력은 없다.
- 마이그레이션을 실제 DB 에 적용해 확인하지 않았다.

## 관련 기록

- [처리 단계 보고를 회의 컬럼으로 저장한다](basis-for-decision/2026-11-05-processing-stage-report.md)
- [BE↔AI 계약](../../contracts/backend-ai-contract.md)
