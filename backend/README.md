# Backend

회의 → 추출 → 매칭 → 게이트 → 승인 파이프라인 백엔드. FastAPI + SQLAlchemy + Alembic.

## 문서

- 화자 지정 만료 이력 조회(#256, 2026-11-04): 회의 목록에서 수동 업로드의 `speaker_assignment_expired`만 실패 제외 정책의 예외로 유지하고 `failed_stage`를 함께 반환한다. [M5 추가 결과](docs/plan/m5/result.md#2026-11-04-추가-화자-지정-만료-이력-조회)에 검증과 한계를 기록한다. 자동 만료 생성은 이 변경에 포함하지 않는다.

- [문서 안내](docs/README.md): 문서 구조와 기존 문서 배치.
- 계약: [AI(녹음 봇) 계약](docs/contracts/backend-ai-contract.md), 웹 화면용은 [프론트엔드 대표 계약](../frontend/docs/contracts/frontend-api-contract.md).
- 계획: [전체 계획](docs/plan/backend-plan.md), [M0~M7 안내](docs/plan/README.md). 마일스톤별 plan.md는 아직 비어 있다. 진행 상태는 전체 계획의 마일스톤 개요(2026-10-02 기준)를 따른다.
- 결과: [M0](docs/plan/m0/result.md)(백엔드 CI 보완), [M2](docs/plan/m2/result.md)(승인 때 대상 task 제목 확인), [M3](docs/plan/m3/result.md)(추출 근거를 발화 seq로 저장, 담당자 별칭 자동 채우기와 승인 때 별칭 학습 #459), [M5](docs/plan/m5/result.md)(녹음 업로드 저장과 AI 가져가기 API, AI 경로 미구현), [M6](docs/plan/m6/result.md)(AI 처리 단계 보고와 진행 표시 #381, 답장 담당자 변경 승인 #460, 승인 대기 요청 유사 검색과 합치기 #141, 메시지 탭 읽지 않은 수 #480), [M7](docs/plan/m7/result.md)(배포 전 CI 검사, 봇 재시작 잠금, 되돌리기 문서). 모두 마일스톤 완료를 판정하지 않았다.
- 배포: [배포 안내](../deploy/README.md). 요청: [녹음 시작 때 배포 재시작 잠금 확인](docs/requests/bot-restart-lock.md)(AI).

## 실행

DB는 PostgreSQL이다. 로컬에서는 Docker로 띄운다(Docker Desktop 필요).

```bash
uv venv --python 3.12 .venv
uv pip install -r requirements-dev.txt   # requirements.txt(운영) + pytest, ruff
cp .env.example .env

docker compose up -d db         # PostgreSQL(pgvector 포함) 기동, 데이터는 mm-pgdata 볼륨에 남는다
./run.sh                        # alembic upgrade head + uvicorn --reload
```

- 접속 정보는 docker-compose.yml과 같다: `postgresql+psycopg://mm:mm@localhost:5432/mm`.
  `DATABASE_URL`을 따로 주지 않으면 이 값이 기본값이다(`app/core/database.py`).
- 로컬에 이미 5432 포트를 쓰는 PostgreSQL이 있으면 `POSTGRES_PORT=5433 docker compose up -d db`로
  띄우고 `DATABASE_URL`의 포트도 같이 바꾼다.
- DB를 비우고 처음부터 다시 만들려면 `docker compose down -v` 후 다시 띄운다.
- SQLite(`mm.db`) 시절 데이터와 마이그레이션은 이관(#98) 때 정리했다. 예전 `mm.db` 파일은 지워도 된다.
- `run.sh`는 `.env`를 읽어 alembic과 uvicorn에 환경변수로 넘긴다. `run.sh` 없이 직접 띄우면 `.env`를 읽지 않는다.
- 테스트(`pytest`)는 sqlite in-memory로 돌아서 DB를 띄우지 않아도 된다. pgvector 검색 테스트만
  PostgreSQL이 필요해서 `TEST_DATABASE_URL`이 있을 때만 돈다(`tests/services/test_embedding_search_pg.py` 참고).
- CI(`.github/workflows/backend-ci.yml`)는 ruff 린트, pytest, 빈 PostgreSQL에 `alembic upgrade head`·`alembic check`, 운영 이미지 빌드를 돌린다.
  로컬에서 린트는 `.venv/bin/python -m ruff check .`(설정 `ruff.toml`).

서버가 뜨면 `http://localhost:8000` 기준으로:

| 경로 | 용도 |
|---|---|
| `/docs` | Swagger UI — 엔드포인트별 요청/응답 스키마를 보고 바로 호출해볼 수 있다 |
| `/redoc` | ReDoc — 읽기 전용으로 훑어볼 때 |
| `/openapi.json` | 원본 OpenAPI 스펙 (Postman 등으로 임포트할 때) |

**프론트엔드는 API 명세를 여기(`/docs`)에서 확인하는 게 기준입니다.** 코드가 바뀌면
자동으로 갱신되므로, 이 문서에 엔드포인트 목록을 따로 손으로 옮겨 적지 않습니다.

## 운영 실행 (Docker)

EC2 한 대에 DB와 API를 컨테이너로 같이 띄운다(RDS는 쓰지 않는다). 구성은 `Dockerfile`과
`docker-compose.prod.yml`이다.

```bash
cp .env.example .env    # POSTGRES_PASSWORD 등 운영 값을 채운다
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml logs -f api
```

| 항목 | 동작 |
|---|---|
| 기동 순서 | db가 healthy가 된 뒤 api가 뜬다. api는 `alembic upgrade head` 후 uvicorn을 띄운다 |
| 프로세스 | uvicorn `--workers 1`, `--reload` 없음. Notion/임베딩/업로드 sweeper/세션 sweeper/리마인드 스케줄러 워커가 프로세스마다 뜨므로 워커를 늘리지 않는다 |
| 포트 | api는 `127.0.0.1:8000`에만 열린다. 외부 공개는 같은 서버의 리버스 프록시(HTTPS)가 맡는다. db는 호스트에 열지 않는다 |
| DB 접속 | api의 `DATABASE_URL`은 `.env`의 `POSTGRES_USER`/`POSTGRES_PASSWORD`/`POSTGRES_DB`로 다시 만든다(`db:5432`) |
| 나머지 환경변수 | `NOTION_*`·`DISCORD_*`·`EMBEDDING_*`·`SERVICE_TOKEN` 등은 `.env`를 그대로 넘긴다 |
| 필수 값 | `OAUTH_STATE_SECRET`이 비어 있으면 `docker compose`가 기동 전에 멈춘다(Notion 연결용 서명 키) |
| 데이터 | DB는 `mm-prod_pgdata` 볼륨에 남는다. 로컬 개발용 볼륨(`mm-pgdata`)과 따로다 |
| 업로드 녹음 | `mm-prod_uploads` 볼륨(컨테이너의 `/data/uploads`)에 둔다. 회의가 done·failed가 되면 그 회의 폴더를 지운다 |
| 업로드 sweeper | 서버 안의 워커가 `UPLOAD_SWEEP_INTERVAL_SECONDS`(기본 300, 0 이하면 끔)마다 멈춘 업로드 회의를 failed 로 바꾸고 녹음 폴더를 지운다. AI 가 가져간 뒤 진행이 3시간 없으면 `failed_stage=diarize`, 화자 지정을 7일 기다리면 `speaker_assignment_expired`. 기준은 [봇 계약](docs/contracts/backend-ai-contract.md)의 "웹 업로드 가져가기" |
| 세션 sweeper | 서버 안의 워커가 `SESSION_SWEEP_INTERVAL_SECONDS`(기본 3600, 0 이하면 끔)마다 만료된(`expires_at` 이 지난) 세션 행을 지운다. 만료 세션은 워커가 돌기 전에도 조회 때 401 이다 |
| 리마인드 스케줄러 | 서버 안의 워커가 `REMINDER_SCHEDULER_INTERVAL_SECONDS`(기본 60, 0 이하면 끔)마다 재촉 제안, 발송 직전 확인, 72시간 무응답 막힘, 푸시 발송을 돈다. 브라우저 푸시는 `VAPID_PRIVATE_KEY`·`VAPID_PUBLIC_KEY`·`VAPID_SUBJECT` 가 모두 있어야 나가고, 하나라도 없으면 웹 안 알림만 쌓인다 |
| 자동 막힘 표시 | 태스크 응답의 `auto_blocked` 는 `POST /tasks/{task_id}/auto-block/undo` 가 지금 성공하는 상태와 같다. 이력의 `change_source` 로 가리지 않는다. 막힌 뒤 사유를 PM 이 바꾸면 false 다 |
| 로그 | 컨테이너당 10MB × 3개까지만 남긴다(디스크 50GB 고정) |

## 응답 형식

모든 엔드포인트는 아래 봉투(envelope)로 감싸서 응답한다 (`app/core/errors.py`의 `Envelope`).

```json
// 성공
{ "data": { ... }, "error": null }

// 실패
{ "data": null, "error": { "code": "TASK_NOT_FOUND", "message": "...", "details": { ... } } }
```

`data`의 실제 모양은 엔드포인트마다 다르며 `/docs`의 각 엔드포인트 응답 스키마에서 확인한다.
`error.details`는 있을 수도 없을 수도 있고, 있다면 보통 실패 원인이 된 ID들을 담는다
(`{"task_id": "..."}` 등).

## 에러 코드

`error.code`로 내려오는 값과 그때의 HTTP 상태 코드. 원본은 `app/core/errors.py`.

| 코드 | HTTP | 의미 |
|---|---|---|
| `INVALID_REQUEST` | 400 | 요청 형식이 올바르지 않음 (필드 검증 실패 등) |
| `WORKSPACE_MISMATCH` | 400 | 요청한 workspace_id가 대상 리소스의 실제 workspace와 다름 |
| `MEETING_NOT_FOUND` | 404 | 회의를 찾을 수 없음 |
| `EXTRACTION_NOT_FOUND` | 404 | 추출 결과를 찾을 수 없음 |
| `EXTRACTION_ITEM_NOT_FOUND` | 404 | 그 추출 결과에 해당 항목이 없음 (auto 되돌리기) |
| `APPROVAL_NOT_FOUND` | 404 | 승인 요청을 찾을 수 없음 |
| `WORKSPACE_NOT_FOUND` | 404 | 워크스페이스를 찾을 수 없음 |
| `MEMBER_NOT_FOUND` | 404 | 팀원을 찾을 수 없음 |
| `MEMBER_ALIAS_NOT_FOUND` | 404 | 담당자 별칭을 찾을 수 없음 |
| `TASK_NOT_FOUND` | 404 | 태스크를 찾을 수 없음 |
| `TASK_HISTORY_NOT_FOUND` | 404 | 반영 로그(태스크 히스토리)를 찾을 수 없음 |
| `REMINDER_NOT_FOUND` | 404 | 리마인드를 찾을 수 없음. `details.reminder_id` |
| `REMINDER_BUNDLE_NOT_FOUND` | 404 | 보낼 메시지(묶음)를 찾을 수 없음. `details.bundle_id` |
| `INVITATION_NOT_FOUND` | 404 | 초대를 찾을 수 없음. 내 이메일로 온 초대가 아니거나(수락·거절), 그 워크스페이스 소속이 아니어도(취소·연결 끊기) 같음. `details.invitation_id` |
| `MESSAGE_THREAD_NOT_FOUND` | 404 | 대화를 찾을 수 없음. `details.thread_id` |
| `MESSAGE_NOT_FOUND` | 404 | 봇 메시지를 찾을 수 없음. `details.message_id` |
| `MEETING_ALREADY_ENDED` | 409 | 이미 종료된 회의 |
| `MEETING_NOT_PROCESSING` | 409 | 회의가 PROCESSING 상태가 아닌데 추출을 시도함 |
| `MEETING_PROCESSING_IN_PROGRESS` | 409 | 같은 워크스페이스에 이미 처리 중인 회의가 있어 업로드를 받지 않음. `details.meeting_id` |
| `APPROVAL_ALREADY_RESOLVED` | 409 | 이미 승인/반려 처리된 요청을 다시 처리하려 함 |
| `APPROVAL_CONFLICT` | 409 | task_update 제안 이후 같은 필드가 바뀌었거나 대상 task 제목이 바뀌어 승인하지 않음. `details.conflicts`에 필드별 기준값·지금 값·제안 값(`field: "title"`은 대상 확인용이라 `proposed`가 null). 확인 후 `details.task_version`을 `confirm_task_version`에 담아 다시 승인하면 반영(그 사이 또 바뀌었으면 다시 409) |
| `TASK_HISTORY_ALREADY_ROLLED_BACK` | 409 | 이미 되돌린 변경을 다시 되돌리려 함 |
| `AUTO_TASK_NOT_REVERTIBLE` | 409 | auto로 만든 태스크를 되돌릴 수 없음. `details.reason`: `already_reverted`(이미 되돌림) · `not_auto_created`(auto로 만든 항목이 아님) · `task_missing`(태스크가 없음) · `task_changed`(만든 뒤 바뀜, `details.task_version`) · `pending_approval`(그 태스크의 처리 대기 승인 요청이 있음, `details.approval_id`). 태스크를 직접 고친다 |
| `LAST_PM_REQUIRED` | 409 | 워크스페이스의 마지막 PM(로그인 계정이 있는 PM)을 member로 내리려 함. 다른 팀원을 먼저 PM으로 지정해야 함 |
| `REMINDER_NOT_EDITABLE` | 409 | 예정 상태가 아닌 리마인드·묶음을 고치거나 승인하거나 취소하려 함. `details`에 `reminder_id` 또는 `bundle_id`와 `status` |
| `REMINDER_SCHEDULED_AT_PASSED` | 409 | 지난 시각으로 만들거나 고치거나, 시각이 지난 묶음을 승인하려 함 |
| `BUNDLE_CHANGED` | 409 | PM 이 본 뒤 묶음 문구나 구성이 바뀌어 승인하지 않음. `details.bundle_id`, `details.draft_version`(지금 판) |
| `DRAFT_STALE` | 409 | 초안을 맡긴 뒤 묶음이 바뀌었거나 이미 승인·발송돼 초안을 받지 않음. `details.bundle_id`, `details.draft_version`, `details.status` |
| `INVITATION_NOT_PENDING` | 409 | 대기 중이 아닌 초대를 수락·거절·취소하려 함. `details.invitation_id` |
| `INVITATION_NOT_ACCEPTED` | 409 | 수락하지 않은 초대의 연결을 끊으려 함. `details.invitation_id` |
| `MEMBER_ALREADY_LINKED` | 409 | 이미 계정이 연결된 팀원을 초대하거나 수락하려 함. `details.member_id` |
| `ALREADY_WORKSPACE_MEMBER` | 409 | 그 이메일의 계정이 이미 이 워크스페이스 팀원임. 초대할 때 `details.email`, 수락할 때 `details.workspace_id` |
| `EMAIL_ALREADY_INVITED` | 409 | 같은 이메일로 다른 팀원에게 보낸 초대가 대기 중임. `details.email` |
| `PM_MEMBER_NOT_INVITABLE` | 409 | 역할이 PM 인 팀원을 초대하려 함. 팀원으로 초대해 수락한 뒤 PM 으로 바꿈. `details.member_id` |
| `MEMBER_HAS_PENDING_INVITATION` | 409 | 대기 초대가 있는 팀원을 PM 으로 올리려 함. `details.member_id` |
| `PASSWORD_RESET_TOKEN_INVALID` | 400 | 비밀번호 재설정 링크를 쓸 수 없음(없는·무효화된·이미 쓴·만료된 토큰). `details.reason` 은 `invalid`·`used`·`expired` |
| `MAIL_UNAVAILABLE` | 503 | 메일을 보낼 수 없음(SMTP 설정이 없음). 발송 실패는 응답에 드러나지 않는다 |
| `TOO_MANY_LOGIN_ATTEMPTS` | 429 | 같은 이메일 10회·같은 공인 IP 50회 실패가 15분 안에 쌓여 로그인이 막힘(맞는 비밀번호도 막음). `Retry-After` 헤더와 `details.retry_after_seconds` 는 같은 정수 초 |
| `MESSAGE_RESULT_CONFLICT` | 409 | 이미 다른 결과가 보고됐거나 아직 가져가지 않은 메시지에 결과를 보고함. `details.message_id` |
| `DISCORD_USER_ALREADY_MAPPED` | 409 | 같은 워크스페이스에서 탈퇴하지 않은 다른 팀원에 이미 연결된 디스코드 계정(`details.discord_user_id`). 탈퇴(`is_deleted`)한 팀원의 계정은 다시 연결할 수 있음. `discord_user_id`의 앞뒤 공백은 지우고, 빈 값은 연결 없음(null)으로 저장. 64자를 넘으면 이 코드가 아니라 400 `INVALID_REQUEST` |
| `UPLOAD_NOT_CLAIMED` | 409 | AI가 아직 가져가지(claim) 않은 업로드에 화자를 보고하려 함. `details.status`(그 시점의 회의 상태) |
| `SPEAKERS_ALREADY_REPORTED` | 409 | 이미 화자 목록을 받은 업로드에 저장된 것과 다른 목록을 보고하려 함(같은 목록의 재전송은 200). `details.status` |
| `MEETING_NOT_AWAITING_SPEAKERS` | 409 | 회의가 화자 지정 대기(`awaiting_speakers`) 상태가 아닌데 화자를 지정하려 함. `details.status` |
| `SPEAKERS_NOT_ASSIGNED` | 409 | PM이 화자 지정을 끝내지 않은 업로드의 처리를 AI가 이어 가려 함. `details.status` |
| `AUDIO_TOO_LARGE` | 413 | 업로드한 녹음이 한도(기본 100MiB, `UPLOAD_MAX_BYTES`)를 넘음. `details.size_bytes`·`max_bytes` |
| `AUDIO_UPLOAD_FAILED` | 422 | 오디오 저장·병합 실패 |
| `AUDIO_FORMAT_UNSUPPORTED` | 422 | 지원하지 않는 오디오 형식. `details.filename`·`supported` |
| `TRANSCRIPTION_FAILED` | 502 | 음성 전사 실패 *(아직 미구현 경로)* |
| `EXTRACTION_FAILED` | 502 | 회의 분석 실패 *(아직 미구현 경로)* |
| `NOTION_WRITE_FAILED` | 502 | Notion 페이지 생성/갱신 실패 *(Task API는 더 이상 내려주지 않음 — 아래 Notion 연동 참고)* |
| `EMBEDDING_UNAVAILABLE` | 502 | 임베딩 서버 호출 실패 또는 임베딩 키 미설정 (유사 task 검색) |
| `DISCORD_API_FAILED` | 502 | Discord 요청 실패(봇 토큰 미설정·권한·네트워크). `details.status`에 Discord 응답 상태(응답이 없으면 null), 채널 API 는 `details.reason` 도 준다 |
| `DISCORD_CHANNEL_NOT_FOUND` | 404 | 연결한 서버에서 그 텍스트 채널을 찾지 못함. `details.channel_id` |
| `DISCORD_CHANNEL_NOT_ACCESSIBLE` | 409 | 봇이 그 채널을 읽거나 메시지를 보낼 수 없음. `details`는 `{channel_id, need: "read"\|"send", discord_code}` |
| `INTERNAL_ERROR` | 500 | 그 외 서버 내부 오류 |

*(아직 미구현 경로)* 표시가 붙은 코드는 음성 전사·회의 분석이 실제로 붙기
전까지는 절대 내려오지 않는다.

## Notion 연동

로컬 DB와 Notion은 하나의 트랜잭션으로 롤백할 수 없어서, Task 변경과 Notion 반영을
분리한다(outbox 패턴, `app/services/notion_sync.py`).

1. Task 생성·수정·되돌리기·지우기(`app/services/tasks.py`)는 `Task.version`을 올리고, 같은
   트랜잭션에 "이 Task를 확인해 달라"는 요청(`notion_sync_job`) 한 줄을 쌓는다. 연결 상태와 상관없이
   항상 쌓는다. **요청 안에서는 Notion을 호출하지 않으므로** Notion 장애가 Task API를 실패시키지 않는다.
2. 서버 프로세스 안의 워커(`app/main.py` lifespan, `NOTION_SYNC_INTERVAL_SECONDS`마다,
   기본 5초, 0이면 끔)가 대기 요청을 꺼내 Task와 지금 연결을 보고 Notion에 페이지를 만들거나(POST)
   고친다(PATCH). Task의 Notion 기록(`notion_page_id`·`notion_database_id`·`notion_synced_version`)은 워커만 고친다.

`Integration(provider="notion")` 행이 없으면 워커가 요청을 건너뛴다 — 연동은 선택 사항이다. 행은 있는데
`provider_channel_id`(대상 데이터베이스 ID)가 비어 있거나(DB를 찾는 중이거나 연결이 실패함) `access_token`이
비어 있으면(토큰 갱신이 거절됨) 요청을 꺼내지 않고 두었다가, DB와 토큰이 모두 생기면 처리한다.

| 항목 | 동작 |
|---|---|
| 상태 | Task 응답의 `notion_sync_status`: `pending`(반영 대기) · `synced` · `failed` · `null`(미연동) |
| 재시도 | 429·409·5xx·네트워크 오류는 지수 백오프(10초~10분, `Retry-After` 우선)로 최대 5회. 400·403·404는 바로 `failed`. 401은 아래 토큰 갱신 |
| 토큰 갱신(401) | Notion이 401을 돌려주면 `integration`의 `refresh_token`으로 토큰을 한 번 갱신한다(`notion_sync._refresh_token`). 갱신하면 새 `access_token`·`refresh_token`을 바로 커밋하고 요청을 기다리지 않고 다시 보낸다. 마지막(5번째) 시도에서 갱신했으면 한 번 더 보낸다. 저장된 토큰이 실패한 토큰과 다르면(그 사이 다시 연결함) 갱신하지 않고 다시 보낸다. 갱신이 거절되거나(`invalid_grant`) `refresh_token`이 없으면 토큰 두 개를 비우고 DB ID는 남긴다. 연동 조회가 `revoked`가 되고, 요청은 시도로 세지 않고 다시 연결할 때까지 기다린다. 다시 연결할 때 기존 페이지를 고르면 남겨 둔 DB를 이어 쓰고, 템플릿을 복제하면 새 DB로 옮긴다(아래 "다시 연결"). 네트워크·5xx·`invalid_client`·환경변수 누락은 토큰을 그대로 두고 백오프로 다시 시도한다. 갱신 응답을 받지 못했는데(타임아웃) Notion은 이미 새 토큰을 발급했다면, 옛 `refresh_token`만 남아 다음 갱신이 거절되고 다시 연결해야 할 수 있다 |
| 순서·중복 | 항상 Task의 현재 값 전체를 보내고 `notion_synced_version`에 보낸 버전을 기록한다. 같은 Task에 요청이 여러 줄 있어도 된다. Task의 지금 버전이 지금 DB에 이미 반영됐으면 Notion을 부르지 않고 건너뛴다(`skipped`) |
| 대상 DB | 페이지를 보낸 DB를 `notion_database_id`에 함께 기록한다. 연결된 DB가 이와 다르면 옛 페이지는 쓰지 않고 지금 DB에 새로 만든다. 새 DB가 붙으면(`notion_sync.enqueue_workspace_sync`) 워크스페이스의 모든 Task에 요청을 하나씩 쌓는다. 옛 DB의 페이지는 지우지 않는다 |
| 생성 타임아웃 | POST 직전에 `notion_create_attempted_at`을 커밋해 둔다. 결과를 모른 채 끝나면 다음 시도는 POST를 반복하지 않고 `Task ID` 속성으로 지금 DB에서 페이지를 먼저 조회한다 |
| 워커 중단 | `in_progress`로 5분 넘게 남은 요청은 다시 대기열로 돌린다 |
| 수동 재시도 | `POST /api/v1/tasks/{task_id}/notion-sync/retry` — `failed` 요청의 재시도 횟수를 초기화해 다시 대기열에 넣는다. Task의 지금 버전이 지금 DB에 이미 반영됐으면 거절한다 |
| 쌓이는 행 | 끝난(`done`·`skipped`·`failed`) 요청은 지우지 않는다. Notion을 쓰지 않는 워크스페이스도 Task를 고칠 때마다 한 줄씩 쌓인다 |
| 지운 Task | 지울 때(`tasks.delete_task`)도 버전을 올리고 요청을 쌓는다. 워커는 지금 DB에 페이지가 있으면 보관(`archived: true`)하고, 없으면 만들지 않는다. 결과를 모르는 POST가 있었으면 조회한 뒤 보관한다. 보관 요청이 400·404로 거부되면 페이지를 다시 읽어(`GET /pages/{id}`) `archived`나 `in_trash`가 참일 때만 보관된 것으로 본다. 400은 요청 검증 오류, 404는 연결에 공유되지 않은 페이지일 수도 있어서다. 확인하지 못하면(보관되지 않은 채 있거나 읽을 수 없으면) 원래 오류와 함께 실패(`failed`)로 남겨 원인을 보고 재시도(`POST /tasks/{id}/notion-sync/retry`)할 수 있게 한다. 다시 읽다가 5xx·네트워크 오류가 나면 보관 여부를 모르니 평소처럼 다시 시도한다. 페이지를 만들려던 요청이 처리 중에 Task가 지워지면, POST 직전에 다시 읽어 만들지 않고 건너뛴다. 새 DB가 붙어도 지운 Task에는 요청을 쌓지 않는다(#232) |

워커는 프로세스당 하나만 도는 것을 전제로 한다(uvicorn 워커를 여러 개 띄우면 안 됨).

### Notion 연결 (OAuth)

PM이 온보딩에서 Notion을 연결하면 `Integration` 행(토큰 + 대상 DB ID)이 생긴다.

1. 프론트가 `GET /api/v1/workspaces/{workspace_id}/integrations/notion/start?state=<돌아올 앱 경로>`로
   이동한다. PM만 통과하고, 서명한 state와 짝 쿠키(`notion_oauth_nonce`)를 만들어 Notion 허용 화면으로 보낸다.
2. PM이 Notion에서 **"템플릿 사용"**을 고르고 허용한다. Notion이 우리 템플릿을 PM 워크스페이스에 복제한다.
   다시 연결할 때는 템플릿 대신 쓰던 DB가 든 기존 페이지를 골라 그 DB를 이어 쓸 수도 있다(아래 "다시 연결").
3. Notion이 `GET /api/v1/integrations/notion/callback`으로 돌려보낸다. state·짝 쿠키·로그인 사용자·PM 여부를
   확인하고 토큰을 저장한 뒤 **바로** `<앱 경로>?oauth=notion&oauth_result=success`로 보낸다.
4. 템플릿 복제는 10초 남짓 걸린다. 그래서 응답 뒤에 서버가 **Notion DB 찾기 작업**을 따로 돌린다
   (`app/services/notion_connect.py`, FastAPI `BackgroundTasks`). 2초마다 복제 페이지를 보고(최대 60초),
   DB를 찾아 속성을 확인한 뒤 `provider_channel_id`에 저장한다. 이때부터 워커가 반영한다.
   그동안 `GET /api/v1/workspaces/{workspace_id}/integrations`의 notion은 `connecting`이다(아래 "연동 조회 상태" 참고).

callback은 워크스페이스별 경로가 아닌 고정 경로다. Notion에 등록하는 redirect URI는 한 글자도 달라질 수
없어서 workspace_id를 넣지 못하고, 어느 워크스페이스인지는 서명한 state에서 꺼낸다.

| 항목 | 동작 |
|---|---|
| 결과 | 항상 앱 화면으로의 302다. `oauth_result`는 `success` · `cancelled`(허용 화면에서 취소) · `failed`. JSON 오류를 보이지 않는다 |
| 템플릿 미사용 | 허용 화면에서 기존 페이지를 골랐는데(Notion이 이 선택지를 숨길 수 없다) 이어 쓸 DB가 없으면(처음 연결이거나 DB ID가 비어 있음) 저장하지 않고 `failed`. 쓰던 DB가 있으면 아래 "다시 연결"대로 한다 |
| 연동 조회 상태 | notion은 행이 없으면 `not_connected`, DB ID와 토큰이 있으면 `connected`, DB ID가 있는데 토큰을 비웠으면(토큰 갱신 거절) `revoked`("Notion 연결 끊김"). DB ID가 없을 때 토큰이 있고 행이 마지막으로 바뀐 지 2분(DB 찾기 상한 60초 + 여유, `NOTION_CONNECTING_TIMEOUT`) 안이면 `connecting`("Notion 준비 중"), 토큰을 비웠거나 2분이 넘으면 `revoked`("Notion DB 연결 실패"). 찾는 사이 만든 Task도 DB가 붙으면 반영된다 |
| 다시 연결 | PM이 허용 화면에서 고른 방식대로 대상 DB를 정한다. **템플릿 복제**: 쓰던 DB를 확인하지 않고 DB ID를 비운 뒤 새 사본에서 DB를 찾는다(그동안 `connecting`). 새 DB가 붙으면 모든 Task가 새 DB에 새로 만들어지고, 예전 DB의 페이지는 더 이상 갱신되지 않는다. 새 DB 찾기가 실패하면 예전 DB로 돌아갈 수 없어 템플릿을 다시 복제해야 한다. **기존 페이지**: 쓰던 DB를 새 토큰으로 읽어 본다. 읽히고 속성이 맞으면 토큰만 바꾸고 DB는 그대로 둔다. 고른 페이지에 그 DB가 없거나(403·404) 속성이 다르면 아무것도 바꾸지 않고 `failed`. Notion이 잠깐 응답하지 못해도 그대로 두고 `failed`다 |
| Notion DB 찾기 작업 실패 | 60초 안에 DB를 못 찾거나, 템플릿에 DB가 없거나, 속성이 다르면 행은 두고 토큰만 비운다. 연동 조회가 바로 `revoked`가 되고, 템플릿을 복제해 다시 연결하면 callback이 새 토큰을 채운다. DB를 붙이며 Task 요청을 쌓다 오류가 나면 DB 저장도 함께 되돌려져 2분 뒤 `revoked`가 된다. 이유는 경고 로그로 남는다(`Notion 대상 DB 연결 실패 … result=…`) |
| 서버 재시작 | Notion DB 찾기 작업 도중 서버가 꺼지면 토큰만 있는 행이 남는다. 2분이 지나면 연동 조회가 `revoked`로 보이고, 템플릿을 복제해 다시 연결하면 callback이 그 행을 덮어쓴다 |
| 보안 | state는 HMAC 서명(10분 만료)이고 짝 쿠키로 한 번만 쓰인다. callback에서 로그인 사용자와 PM 여부를 다시 확인한다. code·state·토큰은 로그에 남기지 않는다 |

**환경변수** (`.env.example` 참고)

| 이름 | 값 |
|---|---|
| `NOTION_CLIENT_ID`, `NOTION_CLIENT_SECRET` | Notion 개발자 페이지의 Public connection → Configuration 탭. 워커의 토큰 갱신에도 쓴다. 없으면 401 때 갱신하지 못하고 error 로그를 남긴다 |
| `NOTION_REDIRECT_URI` | 프론트와 같은 주소의 callback. 로컬 `http://localhost:5173/api/v1/integrations/notion/callback`(Vite 프록시가 백엔드로 넘긴다), 운영 `https://<서비스 주소>/api/v1/integrations/notion/callback` |
| `OAUTH_STATE_SECRET` | state 서명 키, 32자 이상. `python3 -c "import secrets;print(secrets.token_urlsafe(48))"`로 만든다. 없으면 연결 시작이 `failed`가 된다 |

**Notion 개발자 페이지 설정** (Public connection)

- Redirect URI에 위 `NOTION_REDIRECT_URI`와 같은 값을 등록한다.
- "Notion URL for optional template"에 웹에 게시한 템플릿 페이지 주소를 넣는다.

**템플릿 규칙** — 어긋나면 4번에서 연결이 실패한다(`revoked`, `notion.verify_database_schema`)

- "회의 Task" 같은 페이지 **바로 아래**에 데이터베이스를 둔다(열·토글 안에 넣으면 찾지 못한다).
- 속성 이름과 종류를 `app/services/notion.py`의 `DATABASE_SCHEMA`와 맞춘다: Name/title, Status/select,
  Assignee/rich_text, Due Date/date, Blocker/rich_text, **Task ID/rich_text**. 예전 템플릿의 Progress 속성은 있어도 되고, 워커가 쓰지 않는다.
- Status 선택지에 `todo`·`in_progress`·`blocked`·`done`이 있어야 한다(색은 자유).
- 속성·선택지를 더 넣거나 뷰·아이콘을 꾸미는 것은 자유다. 샘플 행은 지운다(복제된다).
- 템플릿이 클수록 복제가 오래 걸려 60초를 넘길 수 있다.

**OAuth 없이 시험할 때**는 `Integration` 행을 직접 만든다. 이때 해당 Notion 연결이 그 데이터베이스에
공유돼 있어야 한다:

```python
from app.models import Integration
db.add(Integration(
    workspace_id="...",
    provider="notion",
    access_token="secret_...",       # Notion Integration Token
    provider_channel_id="...",       # 대상 데이터베이스 ID
))
db.commit()
```

## Discord 연동

PM이 온보딩에서 Discord를 연결하면 녹음 봇이 팀 서버에 들어가고, 그 서버 ID가 `Integration` 행
(`provider="discord"`, `provider_channel_id`=서버 ID)에 저장된다(#171). 이어지는 팀원 매핑 단계는 그 서버의
실제 사용자 목록으로 디스코드 계정과 팀원을 잇는다. 이어진 계정으로 봇이 녹음한 화자를 팀원으로 찾는다
(1인칭 담당자, 화자 이름).

### Discord 연결 (봇 초대 OAuth)

1. 프론트가 `GET /api/v1/workspaces/{workspace_id}/integrations/discord/start?state=<돌아올 앱 경로>`로
   이동한다. PM만 통과하고, 서명한 state와 짝 쿠키(`discord_oauth_nonce`)를 만들어 Discord 허용 화면으로 보낸다.
2. PM이 봇을 들일 서버를 고르고 허용한다.
3. Discord가 `GET /api/v1/integrations/discord/callback`으로 돌려보낸다. state·짝 쿠키·로그인 사용자·PM 여부를
   확인하고, code를 토큰으로 바꿔 **Discord가 확인해 준 서버 ID**를 저장한 뒤 `<앱 경로>?oauth=discord&oauth_result=success`로 보낸다.

scope는 `bot applications.commands identify`다. 봇 초대 scope만 요청하면 Discord가 callback 없이 끝나서,
`identify`를 더해 code grant로 이어지게 한다(Discord 문서 OAuth2 "Advanced Bot Authorization"). 토큰 응답에
봇을 들인 서버(`guild`)가 담긴다. 받은 사용자 토큰은 쓰지 않아 저장하지 않는다.

| 항목 | 동작 |
|---|---|
| 결과 | 항상 앱 화면으로의 302다. `oauth_result`는 `success` · `cancelled`(허용 화면에서 취소) · `failed`. JSON 오류를 보이지 않는다 |
| 서버 확인 | 주소의 `guild_id`는 바꿀 수 있어서 믿지 않는다. 토큰 응답의 서버 ID와 다르면 `failed` |
| 한 서버 한 워크스페이스 | 다른 워크스페이스에 이미 연결된 서버면 `failed`(DB 부분 유일 인덱스 `uq_integration_discord_guild`도 막는다). 같은 워크스페이스에서 다시 연결하면 서버 ID를 바꾼다 |
| 봇 권한 | 채널 보기, 메시지·링크·파일 보내기, 메시지 기록 보기, 음성 채널 접속(`discord_oauth.DEFAULT_BOT_PERMISSIONS`). `DISCORD_BOT_PERMISSIONS`로 바꿀 수 있다 |
| 보안 | Notion 연결과 같다. state는 제공자까지 서명해서 Notion 연결의 state로는 통과하지 못한다 |
| 회의 인계 | 봇은 회의마다 아래 [서버로 워크스페이스 찾기](#서버로-워크스페이스-찾기)로 워크스페이스를 정한다(AI #199). `ai/.env`에는 `BE_WORKSPACE_ID`가 필요 없다 |

### Discord 서버 사용자 목록

`GET /api/v1/workspaces/{workspace_id}/discord/members` — 소속이면 누구나. 연결한 서버의 사용자(봇 포함)를
`{discord_user_id, username, display_name, avatar_url, is_bot}`로 준다. 봇은 프론트가 걸러 낸다.

| 항목 | 동작 |
|---|---|
| 조회 | 봇 토큰으로 Discord REST API `GET /guilds/{guild_id}/members`를 부른다(`app/services/discord.py`). 1000명씩 이어 받는다 |
| 표시 이름 | 서버 별명 → 계정 표시 이름(global_name) → 사용자 이름. 녹음 봇이 화자 이름을 정하는 순서와 같다 |
| 아바타 | 서버 전용 아바타 → 계정 아바타 → 없으면 `null` |
| 미연결 | 연결 행이 없거나 서버 ID가 비어 있으면 409 `INTEGRATION_NOT_CONNECTED` |
| 실패 | 봇 토큰이 없거나 Discord가 목록을 주지 않으면 502 `DISCORD_API_FAILED`(`details.status`). 401은 봇 토큰, 403은 Server Members Intent·권한, 404는 봇이 서버에 없는 경우가 많다 |

### 채팅 수집 채널

PM 이 디스코드 서버의 텍스트 채널 하나를 골라 두면 녹음 봇이 매일 그 채널 대화를 읽어 task 제안에 쓴다(#428).
채널은 디스코드 `Integration` 행의 `chat_channel_id`·`chat_channel_name`에 저장한다(연결 행을 지우면 같이 사라진다).
결정 근거는 [채팅 수집 채널 설정 결정 기록](docs/plan/m4/basis-for-decision/2026-11-06-discord-chat-channel-setting.md).

| 경로 | 권한 | 동작 |
|---|---|---|
| `GET /workspaces/{workspace_id}/discord/channels` | PM | 고를 수 있는 채널 `{items: [{channel_id, name}], total}`. 미연결이면 409 `INTEGRATION_NOT_CONNECTED`, 봇 토큰이 없거나 Discord 가 실패하면 502 `DISCORD_API_FAILED`(`details.status`, `details.reason`) |
| `PUT /workspaces/{workspace_id}/integrations/discord/chat-channel` | PM | 요청 `{channel_id}` → `{channel_id, name}`. 채널을 확인하고 켬 공지를 보낸 뒤 저장 |
| `DELETE /workspaces/{workspace_id}/integrations/discord/chat-channel` | PM | 수집을 끈다. 200 `{off_notice_sent}` |
| `GET /bot/chat-channels` | 서비스 토큰 | 봇이 읽을 대상 `{items: [{workspace_id, guild_id, channel_id}]}`, `workspace_id` 순. 서버와 채널이 모두 있는 연결만 준다 |

연결 조회(`GET /workspaces/{workspace_id}/integrations`)의 `discord`에는 `chat_channel: {channel_id, name}`이 있다(꺼져 있거나 연결 전이면 `null`). 소속이면 누구나 본다.

| 항목 | 동작 |
|---|---|
| 채널 목록 | 일반 텍스트 채널(type 0)만. 공지·포럼·음성 채팅 채널은 뺀다. 순서는 카테고리 없는 채널, 그다음 카테고리 position 순이고 같은 카테고리 안은 채널 position, 같으면 id 순이다 |
| 저장 순서 | 연결 행을 `FOR UPDATE`로 잠근 채 (1) 서버의 텍스트 채널인지 (2) 읽기 확인(`GET /channels/{id}/messages?limit=1`) (3) 켬 공지 전송을 차례로 하고, 모두 성공하면 두 열을 저장·커밋한다. 하나라도 실패하면 아무것도 저장하지 않는다. 같은 워크스페이스의 동시 저장은 순서대로 처리된다. Discord 호출마다 5초 제한이 있고 세 번 부르므로 대략 15초 안팎 걸릴 수 있다(합계 상한은 아니다). 그동안 같은 워크스페이스의 연결 해제도 기다린다 |
| 켬 공지 | "이 채널 대화는 매일 09:00(KST)에 Manager's Manager 가 읽어 task 추가·수정 제안에 씁니다. 제안은 PM 승인 뒤에만 반영됩니다." 멘션 알림은 보내지 않는다(`allowed_mentions.parse: []`). 보내지 못하면 저장 실패다 |
| 끔 공지 | "이 채널 대화 수집을 껐습니다." 채널 해제, 다른 채널로 변경(옛 채널), 디스코드 연결 해제 때 DB 커밋 **뒤** 시도한다. 실패해도 해제·변경·연결 해제는 성공이다 |
| 읽기 확인의 한계 | `GET /channels/{id}/messages?limit=1`은 VIEW_CHANNEL 만 있고 READ_MESSAGE_HISTORY 가 없으면 403 이 아니라 200 빈 목록을 줄 수 있다(Discord 동작, 확인 필요). 그러면 읽을 수 없는 채널도 통과할 수 있다 |
| 같은 채널 재저장 | Discord 를 부르지 않고 현재 값을 200 으로 준다. 채널 이름은 저장한 시점의 값이다. 다만 봇 토큰 확인이 먼저라 `DISCORD_BOT_TOKEN`이 없으면 이 경우도 502 |
| 해제 응답 | `DELETE`는 204 가 아니라 200 `{off_notice_sent}`다. 공지를 보냈으면 `true`. 이미 꺼져 있거나 연결 행이 없어도 200 `false`이고 공지는 없다 |
| 연결 해제·재연결 | `DELETE .../integrations/discord`(204 그대로)는 채팅 채널도 지우고 커밋 뒤 끔 공지를 시도한다. 다른 서버로 다시 연결하면 공지 없이 채널을 비운다(이전 서버의 채널은 의미가 없다). 같은 서버로 다시 연결하면 유지한다 |
| 요청 검증 | `channel_id`는 앞뒤 공백을 지운 숫자 1~20자. 아니면 400 `INVALID_REQUEST` |
| 오류 | 연결이 없으면 409 `INTEGRATION_NOT_CONNECTED`(채널 목록은 연결 확인이 먼저, PUT 은 봇 토큰 확인이 먼저라 토큰이 없으면 연결 없음도 502 `DISCORD_API_FAILED`, `details.reason: "bot_token_missing"`). 서버의 텍스트 채널이 아니면 404 `DISCORD_CHANNEL_NOT_FOUND`. 봇이 읽지 못하면(403) 409 `DISCORD_CHANNEL_NOT_ACCESSIBLE` `need: "read"`, 켬 공지를 보내지 못하면(403) `need: "send"`. 봇 토큰이 없거나 그 밖의 Discord 실패(채널 목록 조회 실패 포함)는 502 `DISCORD_API_FAILED` |

### 서버로 워크스페이스 찾기

`GET /api/v1/integrations/discord/guilds/{guild_id}/workspace` — 녹음 봇용(#180). 사용자 세션 대신 서비스 토큰(`X-Service-Token`)으로 막는다.
봇이 `/record` 때 녹음하는 서버의 ID로 불러 회의를 보낼 워크스페이스를 정한다.

| 항목 | 동작 |
|---|---|
| 응답 | `{guild_id, workspace_id}`. 한 서버는 한 워크스페이스에만 연결되므로(`uq_integration_discord_guild`) 결과는 하나다 |
| 미연결 | 그 서버를 연결한 워크스페이스가 없으면(연결 해제 포함) 409 `INTEGRATION_NOT_CONNECTED`, `details`는 `{provider: "discord", guild_id}` |
| 인증 | 토큰이 없거나 틀리면 401 `UNAUTHENTICATED`. 워크스페이스 멤버의 세션도 토큰을 대신하지 못한다 |

**환경변수** (`.env.example` 참고)

| 이름 | 값 |
|---|---|
| `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` | Discord 개발자 포털 → 앱 → OAuth2 |
| `DISCORD_REDIRECT_URI` | 프론트와 같은 주소의 callback. 로컬 `http://localhost:5173/api/v1/integrations/discord/callback`, 운영 `https://<서비스 주소>/api/v1/integrations/discord/callback` |
| `DISCORD_BOT_TOKEN` | 녹음 봇(`ai/.env`)과 같은 봇의 토큰. 서버 사용자 목록을 읽고, 채팅 수집 채널 설정의 채널 목록·읽기 확인·켬·끔 공지 전송에도 쓴다 |
| `OAUTH_STATE_SECRET` | Notion 연결과 같은 서명 키를 쓴다 |

**Discord 개발자 포털 설정**

- OAuth2 → Redirects에 위 `DISCORD_REDIRECT_URI`와 같은 값을 등록한다.
- Bot → Privileged Gateway Intents에서 **Server Members Intent**를 켠다(녹음 봇도 이미 쓴다).
- 채팅 수집을 쓰려면 **Message Content Intent**도 켠다(AI 담당이 켠다).

## 유사 task 검색과 AI 판단 접수

회의에서 나온 말이 기존 task의 수정인데도 새 task가 생기는 것을 막기 위한 흐름이다(#102).

1. AI가 Terra 1단계 결과 문장으로 `POST /api/v1/workspaces/{workspace_id}/tasks/similar`를 부른다.
   BE는 비슷한 기존 task 후보(AI의 `NotionCandidate` 필드 형식)를 돌려준다.
2. AI가 Terra 2단계에서 새 task인지 기존 task 수정인지 판단한다.
3. AI가 판단 결과를 `POST /api/v1/extractions` 항목의 `action`(create/update/merge)으로 보낸다. merge 는 유사 검색이 돌려준 승인 대기 카드에 합치는 것이다(#141).

| 항목 | 동작 |
|---|---|
| 임베딩 저장 | task 제목의 임베딩을 `task.embedding`(pgvector, 1536차원)에 둔다. 생성·제목 변경 시 NULL로 비우고, 서버 안의 워커(`EMBEDDING_SYNC_INTERVAL_SECONDS`마다)가 채운다. 요청 안에서는 임베딩 API를 부르지 않는다 |
| 워커 실패 | 제목이 비었거나 공백뿐인 task는 보내지 않는다. 입력 오류(400·413·422)면 하나씩 다시 보내 거절된 task만 건너뛴다. 그 외 실패(연결·타임아웃·5xx·429)는 연속 실패할수록 대기 간격을 두 배씩 늘리고(최대 5분, `Retry-After`가 있으면 우선), 성공하면 원래 간격으로 돌아간다. 401·403은 바로 5분 간격으로 늘리고 error 로그를 남긴다 |
| 검색 대상 | 같은 워크스페이스에서 status가 todo·in_progress·blocked·done이고 임베딩이 있는, 지우지 않은 task. 코사인 유사도 상위 `k`(기본 3)개 중 `min_similarity`(기본 0.4, ai/docs/basis_for_decision/ai/2026-09-22-0010-embedding-similarity-threshold.md) 이상만 |
| 승인 대기 요청 포함 | 요청에 `include_pending: true`(기본 false, 불리언만)를 보내면 임베딩이 있는 승인 대기 task_create 요청을 최대 2개 더 합친다. task `k`개 뒤에 더해 유사도 내림차순(같으면 task가 앞)으로 돌려주고 `min_similarity`는 똑같이 쓴다. pending 후보는 `task_id`·`status`·`notion_page_id`가 null이고 `approval_id`가 있으며, 제목·마감·담당자는 payload에서 읽고(형식이 틀리면 마감·담당자는 null) `updated_at`은 요청 생성 시각이다. task 후보의 `approval_id`는 null. AI는 합치기(아래 `action: merge`) 배포 뒤에 켠다(#141) |
| 검색 인증 | 봇이 세션 없이 부르므로 `X-Service-Token` 헤더를 `SERVICE_TOKEN`과 비교한다. 없거나 다르면 401 |
| 검색 실패 | 임베딩 호출이 실패하면 빈 목록 대신 `EMBEDDING_UNAVAILABLE`(502). 빈 목록이면 호출한 쪽이 중복 task를 만들 수 있다 |
| `action` 없음 / `create` | 게이트가 auto면 task 생성, 아니면 task_create 승인 요청. 게이트는 `decide_create_gate`가 정한다. 먼저 BE가 계산한 담당자 확신도를 본다. 담당자를 언급했는데 찾지 못했으면(중의적·없음) `hold`다. `assignee_raw` 없이 `second`·`thirdpronoun`·`thirdrole`만 오거나 1인칭인데 화자가 없으면, 사람을 지목했지만 누군지 모르는 것이라 `hold`다(`mentions_assignee`). 1인칭 화자는 `evidence_speaker_member_id`(탈퇴하지 않은 팀원이 아니면 화자를 못 찾은 것이고 아래로 넘어가지 않는다), `evidence_speaker`(uid), 결론 발화의 `member_id`(활성 팀원일 때, 아니면 그 발화의 uid) 순으로 정한다. 틀린 `evidence_speaker_member_id`는 새 항목이 경로와 무관하게 `hold`이고, 화자도 `assignee_raw`도 없는 1인칭은 judge·경로 불명이 `hold`, legacy는 확신도로 정해 `review`가 될 수 있다. update 항목은 항상 `review`다(#265). judge 항목은 그다음 아래 auto 조건을 모두 만족하면 `auto`, 아니면 `review`다. 경로를 가릴 수 없고 확신도도 없는 항목은 `review`, legacy는 확신도로 정한다(#201). 경로와 상관없이 `assignee_type`이 `thirdrole`(역할로 지목)인 새 항목은 `auto`가 나와도 `review`로 내린다. 역할은 맡은 사람이 바뀔 수 있어 PM이 본다(#459) |
| judge auto 조건 | 숫자 점수가 아니라 조건을 모두 만족할 때만 `auto`다(`matching.auto_blockers`, #232). ① 새 항목 ② `task_status`가 certain ③ 담당자를 언급했으면 한 명으로 찾았고(검증된 별칭이나 화자) 확신도 0.8 이상 ④ `assignee_type`이 `second`·`thirdpronoun`·`thirdrole`이 아님(AI가 대명사·역할을 문맥으로 푼 이름) ⑤ `due_status`가 certain이거나 missing이고 `due_date` 유무와 맞음 ⑥ `similar_count`가 0이고, 워크스페이스에 임베딩이 없는 활성 task가 없음(`embedding.has_unsearchable_tasks`). 그런 task는 AI의 유사 검색에 잡히지 않아 0을 믿을 수 없다. 같은 회의에서 앞 항목이 auto로 만든 task도 여기 걸려, 한 회의에서 auto는 보통 첫 항목뿐이다. 임베딩 API가 지금 제목을 거절한 task도 포함한다. 워커가 다시 시도하지 않을 뿐 검색에서 빠진 것은 같아서, 제목이 바뀌어 임베딩이 채워지거나 지워질 때까지 auto를 막는다. 지운 task와 제목이 비었거나 공백뿐인 task는 뺀다. 승인 대기 중인 task_create 요청 가운데 임베딩이 없는 것(`embedding.has_unsearchable_pending`)이 있어도 막는다(`unsearched_pending_exists`). 유사 검색에 합치는 승인 대기 후보에 잡히지 않기 때문이고, 빈 제목으로 건너뛴 요청은 뺀다. 이 요청 안에서 앞 항목이 만든 pending은 보지 않는다. `task_status`·`due_status`·`similar_count` 중 하나라도 보내지 않으면 `review`다. 할 일 근거 상태는 LLM의 자기 표시라 걸러 내는 힘이 약해서, 중복 생성은 임베딩으로 계산한 유사 검색 결과로 막는다. `top_similarity`는 판단에 쓰지 않고 기록만 한다(유사도 기준값을 정할 근거). 못 맞춘 조건은 info 로그(`reasons=`)로 남긴다 |
| auto 되돌리기 | `POST /api/v1/extractions/{extraction_id}/items/{item_id}/revert`(PM). auto로 만든 태스크를 지우고(`task.is_deleted`) 같은 내용의 task_create 승인 요청(`gate: review`, 표시용 `reverted_task_id`)을 만들어 항목에 잇는다. 항목의 `task_id`는 비우고 `reverted_at`·`reverted_by`를 남기며 `gate`는 처음 판단대로 `auto`다. 승인하면 새 태스크가 생겨 항목에 이어지고, 반려하면 태스크 없이 끝난다. 값 하나가 틀린 것은 태스크를 직접 고치면 되지만 중복·오판은 고칠 값이 없어서 PM이 승인·반려를 다시 고르게 한다. 만든 뒤 태스크가 바뀌었거나(`version`이 1이 아님) 그 태스크의 처리 대기 승인 요청이 있으면 409 `AUTO_TASK_NOT_REVERTIBLE`이다. 바뀐 값이 승인 요청에 담기지 않고 사라지기 때문이다. 근거는 저장된 근거 발화(`evidence`, #229) 중 seq가 가장 큰 발화로 승인 요청에 담긴다. AI가 `evidence_seqs`를 보내지 않았거나 하나도 찾지 못했으면 비어 있다 |
| 지운 task | 지금은 auto 되돌리기만 task를 지운다. 행은 남기고(Notion 페이지 보관, 추출 항목·이력 연결 유지) task 목록·조회·수정·이력·유사 검색·임베딩·승인 요청 대상에서 뺀다. 지운 task를 가리키는 조회는 404 `TASK_NOT_FOUND`, update 추출 항목은 건너뛰고, 추출 조회는 그 task를 가리키던 항목의 `task_id`를 null로 내린다. Notion 재시도(`POST /tasks/{id}/notion-sync/retry`)만 지운 task도 받는다(페이지 보관 재시도). task를 바꾸는 경로(`PATCH /tasks/{id}`, 이력 되돌리기, 승인 요청 생성, 추출 update 대상)는 task 행을 커밋까지 잠그고 다시 읽어, 되돌리기와 겹쳐도 지운 task에 쓰지 않는다 |
| 추출 경로 | AI가 경로를 보내지 않으므로 항목이 보낸 키로 가린다. `action`·`category`·`doc_text`를 보냈으면 judge, 확신도를 보냈으면 legacy다(`ExtractionItemCreate.extraction_path`). 모든 항목이 같을 때만 `extraction.extraction_path`에 남기고 아니면 NULL. 확신도를 보내지 않으면 0.0이 아니라 NULL(측정 안 함)로 저장한다 |
| `action: update` | `target_task_id`의 task_update 승인 요청을 만든다(신뢰도와 무관하게 항상 PM 승인 대상). `task_title`은 없어도 되고, 와도 제목은 바꾸지 않는다 |
| update 변경안 | 들어온 값 중 지금 task와 다른 `due_date`·`status`·`assignee_member_id`만 담는다. 담당자는 지금 task와 다를 때만 넣고 같으면 뺀다 |
| update 충돌 기준값 | 변경 필드마다 `base_values`를 남겨 승인 시 그 뒤 수정과 충돌을 확인한다. 기준값은 AI가 유사 검색에서 본 값(`target_snapshot`의 `due_date`·`status`·`assignee_member_id`)이다. 보내지 않은 필드나 `target_snapshot`이 없는 요청은 등록 시점의 값을 쓴다. 검색과 등록 사이에 PM이 고친 값을 승인이 덮지 않게 하려는 것이다 |
| update 대상 확인 | AI가 task를 고를 때 본 제목(`target_snapshot.title`, 없거나 null이면 등록 시점 제목)을 payload의 `base_title`에 남긴다. 승인할 때 지금 제목과 다르면 다른 필드가 그대로여도 `APPROVAL_CONFLICT`의 `title` 항목으로 알린다. 제목은 바꾸지 않는다. 앞뒤 공백만 다르면 같은 제목으로 본다. `base_title`이 없는 요청(이 기능 전에 만든 요청, `base_title`을 보내지 않은 수동 생성)은 제목을 확인하지 않는다. 수동 생성(`POST /approvals`)은 payload를 그대로 저장해서 `base_title`·`base_values`를 넣으면 확인한다(#185) |
| update 승인 요청 생성 여부 | 담당자를 하나로 못 찾았으면(중의적이거나 없음) 다른 변경이 없어도 PM이 보도록 승인 요청을 만든다. `category: scope`(대응하는 task 필드가 없는 범위 결정)도 다른 변경이 없어도 승인 요청을 만든다. 그 외에 담당자까지 같거나 언급이 없고 다른 변경도 없으면 승인 요청 자체를 만들지 않는다(단 `doc_text`·근거는 ExtractionItem에 남는다) |
| 추출 조회의 auto 표시 | 항목의 `gate`가 `auto`면 승인 없이 만든 항목이다. 되돌렸으면 `reverted_at`이 있고 새 승인 요청이 `approval_id`·`approval_status`로 보인다. 판단 근거로 `task.evidence_status`·`due_date.evidence_status`·`similar_count`·`top_similarity`를 함께 싣는다(보내지 않았으면 null) |
| 추출 조회의 반영 여부 | `GET /api/v1/extractions/{extraction_id}` 항목의 `task_id`는 연결된 task다. create는 task가 생긴 뒤에 채워지지만, update는 수정 대상이라 승인 전에도 있다. 그래서 반영 여부는 `approval_status`(연결된 승인 요청의 `status`: pending·approved·rejected, 승인 요청이 없으면 null)로 본다. approved는 task 반영과 같은 트랜잭션에서 커밋되고, 충돌로 반영하지 못하면 pending으로 남는다. 상태는 항목 조회에 승인 요청을 붙여 한 쿼리로 읽는다. 따로 읽으면 그 사이 승인이 커밋되어 `task_id`는 승인 전, `approval_status`는 승인 뒤 값으로 어긋날 수 있다(#211) |
| 잘못된 항목 | update의 `target_task_id`가 없거나 다른 워크스페이스 task면, create·merge의 `task_title`이 비어 있으면 그 항목만 건너뛰고 나머지는 처리한다(응답 `item_count`는 저장된 항목 수) |
| `action: merge` | `target_approval_id`의 승인 대기 task_create 카드(같은 워크스페이스, 팀원이 직접 만든 카드 포함)에 합친다. 새 카드·task는 만들지 않고 항목은 `action=merge`, `approval_id`=그 카드로 남는다. 규칙은 `app/services/pending_merge.py`에 있다. 마감은 새 값이 있을 때만, `status`는 보냈을 때만 덮어쓴다(`status`는 표시용이라 승인으로 만드는 task 는 항상 `todo`다). 담당자·`assignee_raw`·카드 gate·`assignee_item_id`(담당자를 정한 항목)는 `category`가 `assignee`일 때만 덮어쓴다. 카드에 있던 담당자를 지우게 되면(담당자 표현이 없는 none·group 항목) PM 이 알아보도록 카드 gate 를 `hold`로 올린다. 그 밖의 merge 항목은 `assignee_type`·`assignee_raw`를 보지 않는다(별칭을 찾지 않고 판정 로그도 남기지 않으며 항목 gate 는 `review`). `doc_text`는 " / "로 잇고, 합친 항목의 근거는 `merged_items`에 쌓는다. 제목·대표 근거·`extraction_item_id`는 처음 것 그대로다. 합친 항목은 새 일이 아니라 judge auto 조건을 보지 않고 gate가 `auto`면 `review`로 내린다 |
| merge 대상을 쓸 수 없을 때 | 대상이 없음·못 찾음·다른 워크스페이스·task_create 아님·승인 대기 아님·payload가 dict 아님(`merged_items`가 리스트 아님 포함)이면 400 없이 create로 처리하고(새 카드) gate가 `auto`면 `review`로 내린다. 중복 검사를 거치지 못한 항목이라서다. info 로그 `merge_target_unavailable reason=...` |
| merge 잠금 | 선점 뒤 update 대상 task를 ID 순으로, 이어 merge 대상 task_create 카드를 ID 순으로 한 쿼리에서 `FOR UPDATE`로 잠근다(`populate_existing`으로 최신 상태를 읽음). 승인은 카드 상태를 조건부 UPDATE 로 바꾸므로, 합치기가 먼저 잡으면 승인은 합친 값으로 task를 만들고, 승인이 먼저 잡으면 합치기는 새 카드로 간다. task_update 카드는 잠그지 않는다. 그 승인은 카드 → task 순서로 잠가 이 요청과 순서가 반대다 |
| 합친 카드 승인 | 조건부 UPDATE 뒤 카드를 다시 읽어 최신 payload로 task를 만든다(PM이 고친 칸은 PM 값). 같은 카드에 연결된 모든 추출 항목에 `task_id`를 채운다. 팀원이 직접 만든 카드는 payload 에 `meeting_id` 가 없어, 회의 항목을 합친 뒤 승인해도 task 는 `meeting_id` 없이 `manual` 출처로 만들어진다(`merged_items` 의 회의는 보지 않는다). 반려하면 연결된 항목 모두 `approval_status`가 rejected다 |

## 담당자 별칭

담당자는 별칭 표(`member_alias`)로 찾는다(#459). 별칭은 PM이 직접 넣는 것 말고도 아래처럼 자동으로 생긴다.

| 항목 | 동작 |
|---|---|
| 찾기 | `resolve_assignee`가 `assignee_raw`에서 "님"·조사를 뗀 후보를 만들어 긴 것부터 찾는다("하은이가" → 하은이가, 하은이, 하은). 처음 걸린 후보에 팀원이 1명이면 매칭, 2명 이상이면 애매함, 아무 후보도 안 걸리면 못 찾음이다. 탈퇴한 팀원의 별칭은 보지 않는다. 한 글자 별칭으로 찾으면 담당자는 채우되 확인 필요로 둬서 auto 가 되지 않는다(조사를 떼면 "하은" → "하"처럼 한 글자 후보가 생겨, 팀에 없는 사람이 엉뚱한 팀원에게 자동 배정될 수 있다). 후보 규칙(`matching.name_candidates`)은 AI 채점 코드 `_name_candidates`(`ai/extract/eval_golden_set.py`)와 같고, 세 가지만 다르다. 공백을 한 칸으로 줄이고 후보마다 앞뒤 공백을 지운다(띄어 쓴 님: "환 님이" → 환). 조사를 떼고 "이"로 끝나면 "이"를 한 번 더 뗀 것도 후보다("하은이는" → 하은이는, 하은이, 하은). "님"처럼 "씨"도 떼고("민수 씨", "민수씨가" → 민수), 호칭을 뗀 뒤에도 "이"를 한 번 더 뗀다("하은이님이", "하은이 씨는" → 하은) |
| 미매칭 목록 | `GET /members/unresolved-aliases`도 같은 후보 규칙으로 판정한다. 처음 걸린 후보의 별칭이 1개이고 확인된(`verified`) 것이면 해결로 보고 목록에서 뺀다. 한 글자 별칭은 PM 이 직접 등록한(`manual`·`learned`) 것만 해결로 본다. 이름에서 자동으로 만든 한 글자 별칭("김환" → "환")은 목록에 남는다. 담당자 찾기는 한 글자면 계속 확인 필요다 |
| 팀원 이름 | 팀원을 만들 때(`POST /members`, 워크스페이스를 만들 때의 PM)와 이름을 바꿀 때 이름과 성 뗀 이름을 `source=display_name` 별칭으로 넣는다(확인됨, 확신도 1.0). 한글 2글자 이상만 넣고, 4글자는 앞 두 글자, 그 외는 첫 글자를 성으로 본다("김동우" → 김동우, 동우). 규칙은 AI 전사 힌트 `member_forms`(`ai/stt/backend.py`)와 같다. 이름을 바꾸면 옛 이름에서 만든 `display_name` 별칭만 지우고, PM이 넣은 별칭과 닉네임 별칭은 남긴다. `display_name` 은 서버만 쓰는 값이라 별칭 등록 API(`POST /members/{id}/aliases`)에 보내면 400 `INVALID_REQUEST` 다. 이 API 는 `alias_text` 의 공백을 후보와 같은 규칙으로 정리해 저장하고(한 칸으로 줄이고 앞뒤를 지움), 공백뿐이면 400 이다. 같은 글자의 자동 별칭이 이미 있으면 요청의 `source` 가 `manual`·`learned` 일 때만 그 행을 요청 값으로 올린다. 기존 팀원은 마이그레이션 `1032faab5855`가 채웠다 |
| 디스코드 닉네임 | 팀원에 `discord_user_id`를 붙이면 팀원을 저장한 뒤 봇 토큰으로 Discord `GET /guilds/{guild_id}/members/{user_id}`를 부른다(제한 3초, 호출 동안 DB 트랜잭션을 열지 않는다). 서버 닉네임, 계정 표시 이름(`global_name`) 순서로 한글로만 된 첫 값을 `source=discord_profile` 별칭으로 넣는다(미확인, 확신도 0.8. 이 별칭으로 찾으면 담당자는 채워지지만 PM 검토로 간다). 토큰·연동이 없거나 호출이 실패해도 경고 로그만 남기고 응답은 그대로다. `discord_user_id`가 바뀌거나 풀리면 그 팀원의 `discord_profile` 별칭을 지우고 새 계정이면 다시 넣는다. 이미 연결돼 있던 팀원의 닉네임은 채우지 않았다 |
| 겹칠 때 | 자동 별칭은 같은 팀원이 이미 같은 글자를 가졌거나, 탈퇴하지 않은 다른 팀원이 PM이 넣은(`manual`·`learned`) 같은 글자를 가졌으면 넣지 않는다. 자동 별칭끼리 겹치면(김민수·이민수 → "민수") 둘 다 넣어 애매함이 된다 |

## 승인 때 별칭 학습

추출 때 담당자를 별칭으로 찾지 못한 항목을 PM이 담당자를 골라 승인할 때, 회의에서 부른 말을 그 팀원의 별칭으로 저장한다(#459). 별칭 테이블은 PM이 수동으로 등록하지 않으면 비어 있어서, 승인할 때 채워 다음 회의부터 찾히게 하려는 것이다. 이름 규칙으로 찾지 못하는 이름 표현(STT 오인식 "화은", 애칭, 영어 이름)이 대상이다. 규칙과 함수는 `app/services/alias_learning.py`에 있다.

| 항목 | 동작 |
|---|---|
| 담당자 종류 저장 | `POST /extractions` 항목의 `assignee_type`을 `extraction_item.assignee_type`에 저장한다. 알려진 7개(first·second·thirdname·thirdpronoun·thirdrole·group·none)가 아니면 NULL로 저장하고 경고 로그를 남긴다. 요청은 거절하지 않고, 게이트 판단에는 보낸 값을 그대로 쓴다. 이 기능 전에 저장된 항목은 NULL이다 |
| 저장할 글자 | `assignee_raw`를 다듬은 것이다. 앞뒤 공백 제거 → 끝 조사 한 번(께서·한테·에게·이가·가·이·는·을·를·께, 긴 것부터, "은"은 떼지 않음) → 끝 "님" → 연속 공백을 하나로. 비면 저장하지 않는다. 예: "하은이가" → "하은", "지민님이" → "지민", "환 님이" → "환" |
| 물어볼 항목 (`alias_candidate`) | 모두 만족하면 `true`이고 `alias_text`에 저장할 글자가 실린다. ① 새 항목(create, 승인 대기 카드에 합친 merge 포함)이고 카드의 담당 항목(payload `assignee_item_id`, 없으면 `extraction_item_id`) ② 추출 때 담당자가 비어 있었음(못 찾음·애매함) ③ `assignee_type`이 `thirdname`(역할 `thirdrole`은 아래 역할 행) ④ 다듬은 글자가 비지 않음 ⑤ 연결된 승인 요청이 pending ⑥ 같은 워크스페이스에서 탈퇴하지 않은 팀원 누구도 저장할 글자와 찾기 후보(`name_candidates(assignee_raw)`)를 별칭으로 갖고 있지 않음(후보 중 하나라도 있으면 이미 찾히거나 애매한 표현이다. 예: "하은은"은 후보 [하은은, 하은]이고 "하은"을 두 팀원이 가졌으면, "하은은"을 저장하면 이후 항상 그 팀원으로 확정된다. 탈퇴 팀원의 별칭은 담당자를 찾을 때도 보지 않으므로 세지 않고, 지우지도 않는다. PM이 `DELETE /members/aliases/{id}`로 지울 수 있다). 아니면 `false`·`null`이다. 응답을 만들 때 계산하고 저장하지 않는다 |
| 싣는 응답 | `GET /extractions/{id}`의 항목, `GET /approvals`, `GET /approvals/{id}`, `POST /approvals`, `PATCH /approvals/{id}`(처리 뒤라 항상 `false`). 수동으로 만든 승인 요청은 추출 항목이 없어 `false`다 |
| 저장 (`save_alias`) | `PATCH /approvals/{id}`에 `{"status": "approved", "save_alias": true}`를 보내고, 카드의 담당 항목이 그 카드에 연결된 항목이며(payload 의 항목 ID 가 다른 카드 것이면 무시), 위 ①~④·⑥을 만족하고, 최종 담당자(`task_overrides`로 고른 값 포함)가 있으면 그 팀원에게 `member_alias`(`source=learned`, `verified=true`, `confidence=0.9`, `alias_type=nickname`)를 하나 만든다. 확인된 별칭이라 다음 회의에서 바로 확정 매칭된다. 단 한 글자 별칭("환", "민")은 찾을 때 확정 근거로 쓰지 않아(`matching._is_one_letter`) 담당자만 채우고 PM 확인(`review`)으로 간다. 미매칭 목록에서는 PM이 직접 등록한(`manual`·`learned`) 별칭이라 해결로 보고 뺀다(`resolved_texts`). 띄어 쓴 님("화은 님이")과 연속 공백도 같은 후보 규칙으로 찾는다. 이름 끝 글자가 조사와 같으면("민이" → "민", "수가" → "수") 깎여 한 글자가 되고, 저장 글자를 승인에서 고칠 수는 없다. 잘못 저장된 별칭은 `DELETE /members/aliases/{id}`로 지우고 필요하면 다시 등록한다(수정 API 없음) |
| 저장하지 않는 경우 | `save_alias`가 없거나 false, 반려(같이 와도 오류 없이 무시), task_update 승인, 추출 때 담당자를 찾았던 항목(PM이 다른 사람으로 바꿔도), 1·2인칭·대명사·그룹·없음, `assignee_type`이 NULL인 옛 항목, 담당자를 미정으로 승인, 다듬은 글자가 1인칭이 주어로 쓰인 꼴(AI가 1인칭을 `thirdname`으로 잘못 분류한 경우. 범위는 아래 1인칭 거르기 행), 그 글자를 탈퇴하지 않은 누군가가 이미 가짐, `thirdrole`(아래 역할 행). 모두 승인은 그대로 성공한다 |
| 1인칭 거르기의 범위 | 1인칭이 할 일의 **주어로 쓰인 꼴**만 막는다. 규칙은 어간(제·저·나·내 / 저희·우리 / 본인) × 복수 "들"(저희·우리·본인에만) × 주어 표지다. 이·가·는·를 같은 격조사는 다듬기가 먼저 떼고, 도·만과 받침 있는 말 뒤의 은("본인은", "저희들은")은 이 규칙이 처리한다. 막는 예: 제가·저는·저도·저만·저희들이·저희들은·본인은. **막지 않는 것**: 주어 표지가 아닌 부사어·구·끝말(우리끼리·우리까지·저희 모두·제가요), 3인칭 "저들". 통째로 일치할 때만 막으므로 "제인"·"나연"·"나은"은 배우지만, 조사 "이"를 떼면 "제"·"나"가 되는 "제이"·"나이"는 배우지 않으니 PM이 직접 등록한다. 규칙 밖에서 새는 경우는 PM 동의, 한 글자 확인 필요, 별칭 삭제, AI 오분류 개선이 받는다. 새 꼴이 거론되면 "이 규칙이 만드는 조합인가"로 판단해, 안이면 고치고 밖이면 문서에 남긴다 |
| 동시 승인 | 저장 전에 같은 글자가 있는지 보고, 같은 팀원·글자 유니크 제약(`uq_alias_per_member`)에 걸리면 그 저장만 savepoint로 되돌린다. 승인과 태스크 생성은 커밋된다 |
| 역할 | `thirdrole` 새 항목은 학습한 별칭으로 확신도가 높아져도 `auto`로 보내지 않는다(위 create 행). 역할은 지금 학습하지 않는다. AI는 `thirdrole`이면 역할 원문("BE 리더가")을 빼고, 문맥으로 추측한 이름이 있으면 그 이름을 `assignee_raw`로 보낸다(`ai/capture/handoff.py`, `ai/judge/pipeline.py`). BE는 원문과 추측을 구분할 수 없어, 배우면 추측한 이름이 확인된 별칭이 될 수 있다. AI가 역할 원문을 보내고 추측 이름은 보내지 않게 되면 학습 대상(`LEARNABLE_ASSIGNEE_TYPES`)에 다시 넣는다 |

## 전사 힌트 조회

녹음 봇용. 사용자 세션 대신 서비스 토큰(`X-Service-Token`)으로 막는다. 봇이 전사(STT)에 거는 이름 힌트를 받는다. 팀원 이름만 돌려주고 회의 내용은 돌려주지 않는다.

| 경로 | 응답 `data` |
|---|---|
| `GET /api/v1/workspaces/{workspace_id}/members/names` | `{items: [{member_id, name, discord_user_id, aliases}]}`. `name`은 PM이 온보딩에서 정한 `display_name`이다. 탈퇴한 팀원은 빼고 만든 순서다. `aliases`는 별칭 문자열 전부이고 확인한(`verified`) 별칭이 앞이다. 자동으로 넣은 이름·닉네임 별칭(위 "담당자 별칭")도 들어간다 |

| 항목 | 동작 |
|---|---|
| 오류 | 토큰이 없거나 틀리면 401 `UNAUTHENTICATED`, 없는 워크스페이스는 404 `WORKSPACE_NOT_FOUND` |
| 봇 사용 | 봇은 아직 부르지 않는다. 디스코드 표시 이름 대신 이 값을 힌트로 쓰는 작업은 AI 후속이다. 자세한 내용은 [AI(녹음 봇) 계약](docs/contracts/backend-ai-contract.md#전사-힌트-조회) |

## 이메일 정규화

가입(`POST /api/v1/auth/signup`)·로그인(`POST /api/v1/auth/login`)·비밀번호 재설정 요청·워크스페이스 초대는 이메일의 앞뒤 공백을 지우고 소문자로 바꿔(`@` 앞부분 포함) 비교·저장한다. 규칙은 `app/schemas/email.py` 의 `normalize_email`·`NormalizedEmail` 한 곳에 있고, `User` 모델이 저장할 때도 같은 함수를 부른다. `Kim@Example.com` 과 `kim@example.com` 은 같은 계정이다.

- 응답의 `user.email`·`accepted_user.email`·`email_masked` 는 소문자다.
- 같은 이메일로 동시에 가입하면 하나만 만들어지고 나머지는 409 `EMAIL_ALREADY_EXISTS` 를 받는다.
- 기존 계정은 마이그레이션 `537911f267dc` 가 소문자로 바꾼다. 소문자로 같아지는 계정이 있으면 아무것도 바꾸지 않고 멈춘다. 되돌릴 수 없고 배포 전 확인 방법은 그 파일 설명에 있다.
- 결정 근거는 [M1 결정 기록](docs/plan/m1/basis-for-decision/2026-11-06-email-normalization.md).

## 세션 토큰

세션 토큰은 sha256 해시로 저장하고 쿠키 값을 해시해 찾는다. 만료된 세션은 워커가 지운다. 쿠키 이름(`session_token`)·값·속성·7일 만료·401 `UNAUTHENTICATED` 는 그대로다. 코드는 `app/services/sessions.py`.

- `session.session_token`(String(255), 유일 인덱스 `ix_session_session_token`)에는 쿠키 원문이 아니라 그 sha256 hex 만 남고 원문은 DB 에 없다. 컬럼 이름은 [마이그레이션 호환 원칙](../deploy/README.md)(이름 변경은 두 배포로 나눈다) 때문에 그대로 두었다. 쓸 때는 `hash_session_token` 을 직접 불러 넣는다. 원문은 로그인 응답의 쿠키로만 나간다.
- 로그아웃은 그 쿠키의 세션 한 행만 지운다. 비밀번호 재설정 confirm 은 그 계정의 세션을 모두 지운다.
- 기존 세션은 마이그레이션 `3c9a1f7d2b64` 가 값만 해시로 바꾼다(스키마 변경 없음). 이미 로그인한 사용자는 그대로 로그인되어 있다. 되돌리면(downgrade) 해시에서 원문을 알 수 없어 모든 세션이 지워지고, 코드만 되돌리면 옛 코드가 쿠키 원문을 해시와 비교해 401 이 되어 모두 다시 로그인한다(500 은 아니다). 배포 전 확인은 그 파일 설명에 있다.
- 만료 세션 정리 주기는 `SESSION_SWEEP_INTERVAL_SECONDS`([운영 실행](#운영-실행-docker)의 세션 sweeper). 로그인 시에는 정리하지 않는다.
- 결정 근거는 [M1 결정 기록](docs/plan/m1/basis-for-decision/2026-11-06-session-token-hash.md).

## 로그인 제한

`POST /api/v1/auth/login` 은 실패가 쌓이면 429 `TOO_MANY_LOGIN_ATTEMPTS` 로 막는다. 원본은 `app/services/login_limit.py`, 적용은 `app/api/auth.py` 의 `login`.

| 기준 | 한도 | 막는 시간 |
|---|---|---|
| 같은 이메일 | 15분 안에 10번 실패(첫 실패부터 창 시작) | 10번째 실패 직후부터 15분 동안 막는다(11번째 시도부터 429) |
| 같은 공인 IP | 15분 안에 50번 실패(첫 실패부터 창 시작) | 50번째 실패 직후부터 15분 동안 막는다(51번째 시도부터 429) |

- 막힌 동안에는 비밀번호가 맞아도 해시 계산 없이 429 를 준다. 막힌 동안 시도해도 시간이 늘지 않는다. 점증 잠금은 없다.
- 응답은 이메일 막힘과 IP 막힘이 같고, 있는 이메일과 없는 이메일도 같다. `Retry-After` 헤더와 `details.retry_after_seconds` 는 같은 정수 초(올림, 최소 1)다.
- 해제: 시간이 지나면 풀린다. 로그인에 성공하면 그 이메일의 횟수를 지운다. 비밀번호 재설정 confirm 이 commit 된 뒤에도 그 이메일의 막힘을 푼다. 시간이 지나기 전에 사용자가 직접 풀 수 있는 방법은 이것뿐이고, 같은 공인 IP 의 막힘은 confirm 으로 풀리지 않는다. 막힌 화면에서 재설정으로 안내하는 것은 FE 몫이다(#554). 이미 로그인한 세션은 영향이 없다.
- 시도는 사용자 조회와 해시 계산 전에 잠금 안에서 먼저 센다(예약). 틀린 비밀번호는 센다. 500 같은 예기치 못한 오류나 401 이외의 `AppError` 는 예약을 되돌린다.
- IP 판단: `request.client.host` 만 읽고 `X-Forwarded-For` 를 직접 읽지 않는다(uvicorn 이 `--proxy-headers` 로 해석한 값). IPv6 는 /64 로 묶는다. 사설 주소·해석할 수 없는 값(테스트 기본값 `testclient` 포함)은 IP 제한을 건너뛰고 이메일 제한만 적용한다. 로그인 성공 때 IP 쪽은 이번 예약만 되돌린다. IP 전체를 지우면 자기 계정으로 로그인해 초기화할 수 있어서다.
- 같은 공인 IP(교육장 등)에서 실패가 50번 쌓이면 그 IP 전체가 막힌다. 급히 풀어야 할 때는 API 를 재시작한다.
- 저장은 프로세스 메모리다. 서버를 재시작하면 모두 풀린다. 항목은 5만 개까지이고 넘치면 만료된 것을 먼저, 그다음 오래된 것부터 지운다.
- 서버가 단일 프로세스(`--workers 1`)라는 전제다. `--workers` 를 늘리거나 서버를 2대 이상 두면 프로세스마다 횟수가 따로 쌓이므로 저장소부터 다시 설계한다.
- 같은 이메일로 막을 수 있어 남이 내 계정을 15분 막을 수 있다. #549 에서 (이메일, IP) 조합 키는 다시 버리고 재설정 안내로 완화하기로 했다. 결정 근거와 남은 노출은 [M1 결정 기록](docs/plan/m1/basis-for-decision/2026-11-06-login-rate-limit.md).

## 비밀번호 재설정

로그인 없이 부르는 경로 3개다. 결정 근거는 [M1 결정 기록](docs/plan/m1/basis-for-decision/2026-11-05-password-reset.md), 원본은 `app/services/password_reset.py`·`app/services/mailer.py`.

| 경로 | 요청 | 응답 |
|---|---|---|
| `POST /api/v1/auth/password-reset/request` | `{email}` | 메일 설정이 없으면 503 `MAIL_UNAVAILABLE`. 있으면 가입 여부와 상관없이 200 `{}` |
| `POST /api/v1/auth/password-reset/verify` | `{token}` | 200 `{expires_at, email_masked}`. 쓸 수 없으면 400 `PASSWORD_RESET_TOKEN_INVALID` |
| `POST /api/v1/auth/password-reset/confirm` | `{token, new_password}` | 200 `{}`. 그 계정의 세션을 모두 지운다(새 세션은 만들지 않는다) |

- 링크: `{APP_BASE_URL}/reset-password#token=<토큰>`. 30분 동안 한 번만 쓸 수 있고 DB 에는 sha256 해시만 둔다. 새 토큰을 발급하면 이전 미사용 토큰은 `invalid` 가 된다.
- 요청 제한: 계정마다 60초에 1번, 1시간에 5번. 걸려도 응답은 같은 200 이고 이전 링크는 살아 있다. 이메일은 [정규화한 값](#이메일-정규화)으로 찾는다.
- 발송: 응답 뒤 백그라운드에서 보내고, 실패하면 2·4·8초 뒤 3번 더 보낸다. 그래도 실패하면 로그만 남긴다(사용자는 다시 요청한다). 서버가 재시작되면 보내던 메일은 사라진다.
- 비밀번호 규칙: 8자 이상, 숫자(0-9) 하나 이상. 회원가입(`POST /api/v1/auth/signup`)에도 같이 적용되고 어기면 400 `INVALID_REQUEST`.

### 운영 메일 설정

`.env` 에 `SMTP_HOST`·`SMTP_USERNAME`·`SMTP_PASSWORD`·`APP_BASE_URL` 이 모두 있어야 켜진다(나머지는 [.env.example](.env.example)). 팀 Gmail 을 쓰는 경우:

1. 팀 전용 Gmail 계정에 2단계 인증을 켠다.
2. Google 계정 > 보안 > 앱 비밀번호에서 비밀번호를 만든다. 일반 비밀번호로는 SMTP 로그인이 안 된다.
3. 서버 `.env` 에 `SMTP_HOST=smtp.gmail.com`, `SMTP_USERNAME=<계정>`, `SMTP_PASSWORD=<앱 비밀번호>`, `APP_BASE_URL=<웹 주소>` 를 넣고 백엔드를 재시작한다.
4. 실제 계정으로 재설정 메일을 받아 링크로 비밀번호를 바꿔 본다. 받은편지함에 없으면 스팸함을 본다.

Gmail 은 하루 발송 한도(약 500통)가 있다. 다른 SMTP 로 옮길 때는 환경변수만 바꾼다(포트 465 면 `SMTP_SECURITY=ssl`).

## 가입 이름 규칙

`POST /api/v1/auth/signup` 의 `name` 은 앞뒤 공백을 지운 값으로 저장한다. 지운 뒤 비었거나, 보이지 않는 글자(형식 문자·결합 부호)만 있거나, 제어문자·줄 구분자·짝 없는 서로게이트·글자 방향 제어 문자가 있거나, 100자를 넘으면 400 `INVALID_REQUEST` 다. 이미 있는 계정의 이름은 검사하지 않는다. 결정 근거는 [M1 결정 기록](docs/plan/m1/basis-for-decision/2026-11-06-signup-name-rule.md), 원본은 `app/schemas/auth.py` 의 `validate_name`.

## 권한

로그인한 사용자가 요청한 워크스페이스의 팀원인지(소속) 확인하고, 아래 쓰기 API는 PM인지까지 확인한다. 아니면 403 `FORBIDDEN`.
원본은 `app/api/deps.py`의 `require_pm`.

| 구분 | API |
|---|---|
| PM 전용 | 승인·반려(`PATCH /approvals/{id}`), 할일 생성·수정(`POST /tasks`, `PATCH /tasks/{id}`), 되돌리기, auto 되돌리기(`POST /extractions/{id}/items/{item_id}/revert`), Notion 재시도, 팀원 생성·수정, 별칭 생성·삭제, Notion 연결 시작·콜백(`GET .../integrations/notion/start`, `GET /integrations/notion/callback`), Discord 연결 시작·콜백(`GET .../integrations/discord/start`, `GET /integrations/discord/callback`), Discord 채널 목록·채팅 수집 채널 저장·해제(`GET .../discord/channels`, `PUT`·`DELETE .../integrations/discord/chat-channel`), 연동 해제, 회의 업로드, 온보딩 저장, 메시지 설정 변경(`PATCH /workspaces/{workspace_id}/message-settings`) |
| 소속이면 누구나 | 조회 API 전부(메시지 설정 조회 `GET .../message-settings` 포함), 승인 요청 생성(`POST /approvals`) |

- Notion 연결 시작·콜백은 브라우저 페이지 이동이라 403 대신 앱 화면의 `?oauth=notion&oauth_result=failed`로 돌려보낸다.
- 일반 팀원은 할일을 직접 바꾸지 못하고 승인 요청을 올려 PM의 승인을 받는다. 요청자(`requested_by`)는 바디 값이 아니라 로그인한 팀원으로 기록한다.
- PM 역할은 `PATCH /members/{id}`의 `role`로 바꾼다. PM을 넘길 때는 다른 팀원을 먼저 PM으로 올린 뒤 자기를 내린다. 로그인 계정이 있는 PM이 한 명도 남지 않게 되면 409 `LAST_PM_REQUIRED`.
- 봇 경로(회의 생성·종료·단계 보고·실패, 발화 저장, 유사 task 검색, 추출 등록, 서버로 워크스페이스 찾기, 전사 힌트 조회, 채팅 수집 대상 목록 `GET /bot/chat-channels`)는 사용자 세션 대신 서비스 토큰(`X-Service-Token`, `deps.require_service_token`)으로 막는다. 없거나 틀리면 401 `UNAUTHENTICATED`. 자세한 내용은 [AI(녹음 봇) 계약](docs/contracts/backend-ai-contract.md#인증).

## 아직 없는 것

워크스페이스 초대, 업로드 녹음을 AI가 처리하는 경로(BE 가져가기 API는 있고 AI 쪽이 없다, [M5 결과](docs/plan/m5/result.md)), 메시지 로그. PM 알림을 DM 으로 보내는 경로와 #회의록 요약 게시를 읽는 경로는 없어서 설정의 PM 알림 방식·요약 값은 저장만 하고 PM 알림은 항상 웹으로 간다.

## 메시지·알림 설정

워크스페이스마다 한 행(`workspace_message_settings`)이고, 행이 없으면 기본값이다(`saved: false`).

| 요청 | 누가 | 하는 일 |
|---|---|---|
| `GET /api/v1/workspaces/{workspace_id}/message-settings` | 소속 팀원 | 설정 6개와 `saved`, `updated_at`, `updated_by`, PM 목록(`pms`, Discord 연결 여부 포함) |
| `PATCH /api/v1/workspaces/{workspace_id}/message-settings` | PM | 보낸 키만 바꾼다. 빈 본문·null·범위 밖·모르는 키는 400 `INVALID_REQUEST` |

- 키: `due_reminder`, `minutes_summary`, `silence_alert`, `reminder_auto_approve`(bool), `nudge_rule`(`days_before` 0~3, `hour` 0~23, 한국 시간, 객체째 보낸다), `pm_alert_method`(`web`·`discord_dm`·`both`).
- `due_reminder` 가 꺼지면 스케줄러가 재촉을 제안하지 않는다. PM 이 직접 만든 재촉은 그대로 나간다. `silence_alert` 가 꺼지면 72시간 무응답 막힘 알림만 건너뛴다.
- `reminder_auto_approve` 가 켜지면 켠 뒤 발송 시각이 오는 재촉 묶음을 발송 시각에 승인한다. 켜기 전에 시각이 지난 묶음은 보내지 않는다. 자동 승인된 묶음은 `approved_by` 가 null 이다.
- 설정을 바꿔도 이미 만든 제안·묶음은 그대로다.
- `pm_alert_method` 와 `minutes_summary` 는 저장만 한다.
- 계약은 [FE 계약](../frontend/docs/contracts/frontend-api-contract.md), 결정 근거는 [결정 기록](docs/plan/m6/basis-for-decision/2026-11-04-message-settings.md).

## 메시지 탭 읽지 않은 수

사람·대화마다 읽은 위치(`message_thread_read.last_read_at`) 하나를 저장하고, 그 뒤에 들어온 상대편 메시지를 센다(#480).

| 요청 | 누가 | 하는 일 |
|---|---|---|
| `GET /api/v1/workspaces/{workspace_id}/messages/unread-count` | 소속 팀원 | `{unread_count}`. 쓰기 없음 |
| `POST /api/v1/workspaces/{workspace_id}/messages/threads/{thread_id}/read` | PM 또는 대화 주인 | 그 대화의 가장 늦은 메시지까지 읽음으로 옮긴다(뒤로 가지 않음). `{thread_id, unread_count: 0, total_unread_count, last_read_at}`. 다시 불러도 200, 메시지 없는 대화는 `last_read_at` null. 없음·다른 워크스페이스·(PM 이 보낸) 탈퇴 팀원 대화는 404 `MESSAGE_THREAD_NOT_FOUND`, 팀원이 남의 대화면 403 `FORBIDDEN` |

- 대화 목록(`GET .../messages`)의 `threads[]` 와 대화 상세(`GET .../threads/{id}`)의 `thread` 에 `unread_count` 가 있다. 조회는 읽음을 바꾸지 않는다.
- 도착 시각은 `coalesce(received_at, created_at)` 다. 늦게 들어온 디스코드 답장도 센다. 단 봇 메시지에 답했는지는 보낸 시각(`created_at`)으로 가른다. `awaiting_reply_since` 와 같은 기준이다.
- 상대편: 자기 대화면 봇 메시지, 남의 대화(PM)면 대화 주인의 답장. 자기 대화에서 봇 메시지 뒤에 내가 답했으면 그 봇 메시지는 세지 않는다.
- PM 마다 따로 센다. PM 자기 대화의 봇 메시지도 센다. 탈퇴한 팀원 대화와 보내기 전 묶음은 세지 않는다.
- 읽은 위치가 없으면 그 사람이 들어온 시각이 기준이다. 배포 때 있던 메시지는 마이그레이션이 모두 읽음으로 채웠다.
- 팀원을 PM 으로 올리면 그 순간까지 남의 대화가 읽음이 된다. 자기 대화의 봇 메시지는 그대로 센다.
- 종 알림(`notifications`)과는 별개다. 결정 근거는 [결정 기록](docs/plan/m6/basis-for-decision/2026-11-07-message-unread-count.md).
