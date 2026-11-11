# 데이터 모델

Backend 의 PostgreSQL 16(pgvector) 스키마를 정리한다. 표는 48개이고 정의는 [backend/app/models/models.py](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/backend/app/models/models.py), 변경 이력은 Alembic 마이그레이션에 있다. AI 파트는 DB 에 직접 닿지 않고 HTTP API 로만 읽고 쓴다([인터페이스 명세](interface.md)).

## 핵심 관계

회의에서 태스크까지 이어지는 표만 그렸다.

```mermaid
erDiagram
  workspace ||--o{ member : "팀원"
  user ||--o{ member : "계정 연결"
  member ||--o{ member_alias : "호칭"
  workspace ||--o{ meeting : "회의"
  meeting ||--o| meeting_upload : "웹 업로드"
  meeting ||--o| meeting_audio : "녹음 보관"
  meeting ||--o{ source : "발화(seq)"
  meeting ||--o{ extraction : "추출 한 번"
  extraction ||--o{ extraction_item : "항목"
  extraction_item ||--o{ evidence : "근거"
  source ||--o{ evidence : "가리킨 발화"
  extraction_item }o--o| approval_request : "승인 카드"
  extraction_item }o--o| task : "만든 태스크"
  approval_request }o--o| task : "수정 대상"
  workspace ||--o{ task : "태스크"
  task ||--o{ task_history : "변경 이력"
  task ||--o{ notion_sync_job : "Notion outbox"
```

## 표 묶음

| 묶음 | 표 | 하는 일 |
|---|---|---|
| 계정과 공간 | `user`, `session`, `password_reset_token`, `signup_email_code`, `user_consent`, `workspace`, `workspace_onboarding_step`, `integration`, `member`, `member_alias`, `alias_resolution_log`, `alias_review`, `invitation`, `withdrawal_receipt`, `privacy_cleanup` | 로그인과 세션, 동의 기록, 워크스페이스와 팀원, Discord·Notion 연결, 담당자 호칭과 그 확인 기록, 탈퇴 처리 |
| 회의와 전사 | `meeting`, `meeting_upload`, `meeting_audio`, `meeting_purge`, `source` | 회의 상태와 처리 단계, 업로드 파일, 녹음 보관 기한, 삭제 진행, 발화 한 줄 |
| 추출과 승인 | `extraction`, `extraction_item`, `evidence`, `approval_request` | AI 가 보낸 추출 결과, 항목마다의 게이트와 근거 상태, 근거 발화 연결, PM 승인 카드 |
| 태스크 | `task`, `task_history`, `notion_sync_job` | 태스크와 임베딩, 무엇이 어떤 경로로 바뀌었는지, Notion 반영 대기열 |
| 메시지와 리마인드 | `message_thread`, `thread_message`, `message_thread_read`, `reminder_bundle`, `reminder`, `bot_dm_part`, `reminder_watch`, `scheduler_suggestion`, `reply_judgment`, `reply_change`, `notification`, `push_subscription`, `workspace_message_settings` | PM·팀원 대화, 재촉 묶음과 DM 전달 기록, 72시간 시계, 답장 판단과 그 결과, 웹 푸시 |
| 전사 용어 | `workspace_asr_term`, `asr_title_queue` | 팀이 쓰는 낱말 목록과 PM 이 승인한 제목 대기열 |
| 프로젝트 맵 | `topic`, `topic_alias`, `topic_task_detach`, `topic_meeting`, `topic_item`, `decision` | 주제로 묶은 회의·결정·태스크 |

## 상태값

| 표 | 값 | 쓰임 |
|---|---|---|
| `meeting.status` | `created` / `recording` / `processing` / `awaiting_speakers` / `done` / `failed` | 웹의 회의 목록과 처리 화면. 처리 단계(`stt → sources → extract → handoff`)는 따로 둔다 |
| `meeting.source` | `discord` / `manual_upload` / `chat` | 입력 경로. 게이트가 경로를 본다(채팅은 자동 반영을 낮춘다) |
| `extraction_item.gate` | `auto` / `review` / `hold` | 화면의 반영된 것 / 확인 필요 / 보류 |
| `approval_request.type` | `task_create` / `task_update` | 새 태스크 승인과 기존 태스크 수정 승인. 충돌 확인 방식이 다르다 |
| `approval_request.status` | `pending` / `approved` / `rejected` | 요약은 승인된 값만 쓴다 |
| `task.status` | `todo` / `in_progress` / `blocked` / `done` | `blocked` 는 72시간 무응답이나 "막혔다"는 답장으로 바뀐다 |

## 설계에서 정한 것

| 정한 것 | 이유 |
|---|---|
| 발화를 `source` 한 줄씩, 회의 안 번호(`seq`)로 저장 | 추출 항목의 근거가 이 번호를 가리킨다. 같은 번호를 다시 보내면 건너뛰어 재전송해도 중복이 없다 |
| 근거를 `evidence` 로 따로 둠 | 항목 하나가 발화 여러 줄을 근거로 가질 수 있다 |
| 승인 카드에 기준값을 같이 저장 | PM 이 본 값과 지금 값이 다르면 409 로 다시 확인받는다([승인과 충돌](../design/backend/approval-conflict.md)) |
| `task` 와 `approval_request` 에 임베딩 `vector(1536)` | 비슷한 기존 태스크와 승인 대기 중인 새 항목을 pgvector 로 찾는다. 별도 벡터 DB 를 두지 않는다 |
| Notion 반영을 `notion_sync_job` 대기열로 | 승인 트랜잭션과 외부 호출을 나눈다([Notion 동기화](../design/backend/notion-sync.md)) |
| 녹음 보관 기한을 `meeting_audio` 로 | 회의 종료부터 7일. 처리 중인 회의는 지우지 않는다 |
| KPI 는 `kpi` 스키마의 view 3개 | `kpi.meeting_fact`, `kpi.extraction_item_fact`, `kpi.approval_fact`. ID·이름·본문 없이 시각과 코드값만 내보낸다([추가 지표](metrics.md)) |

파일 저장: 업로드 음성과 보관 녹음은 `UPLOAD_STORAGE` 설정에 따라 로컬 디스크나 S3 에 둔다. AI 워커의 회의 매니페스트와 트랙 파일은 워커의 로컬 디스크에 있고 DB 에 넣지 않는다([아키텍처 설계](architecture.md#단계-상태와-재시작-매니페스트)).
