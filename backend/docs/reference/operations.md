# 운영과 의존성

[Backend README](../../README.md)로 돌아가기

운영 실행과 동작, 모니터링용 health ready·KPI view, 의존성 잠금을 적는다.

## 운영 실행 (Docker)

EC2 한 대에 DB와 API를 컨테이너로 같이 띄운다(RDS는 쓰지 않는다). 구성은 `Dockerfile`과 `docker-compose.prod.yml`이다.

```bash
cp .env.example .env    # POSTGRES_PASSWORD 등 운영 값을 채운다
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml logs -f api
```

### 기동과 설정

- db가 healthy가 된 뒤 api가 뜬다. api는 `alembic upgrade head` 후 uvicorn을 띄운다.
- api는 `127.0.0.1:8000`에만 열리고, 외부 공개는 같은 서버의 리버스 프록시(HTTPS)가 맡는다. db는 호스트에 열지 않는다.
- api의 `DATABASE_URL`은 `.env`의 `POSTGRES_USER`/`POSTGRES_PASSWORD`/`POSTGRES_DB`로 다시 만든다(`db:5432`). `NOTION_*`·`DISCORD_*`·`KAKAO_*`·`EMBEDDING_*`·`SERVICE_TOKEN` 등 나머지는 `.env`를 그대로 넘긴다.
- `OAUTH_STATE_SECRET`이 비어 있으면 `docker compose`가 기동 전에 멈춘다. OAuth state, 가입 이메일 증명, 카카오 로그인이 함께 쓰는 서명 키다.
- DB는 `mm-prod_pgdata` 볼륨에 남고, 로컬 개발용 볼륨(`mm-pgdata`)과 따로다.
- 로그는 컨테이너당 10MB × 3개까지만 남긴다(디스크 50GB 고정).

> [!WARNING]
> uvicorn은 `--workers 1`, `--reload` 없이 띄운다. Notion/임베딩/업로드 sweeper/세션 sweeper/리마인드 스케줄러 워커가 프로세스마다 뜨므로 워커를 늘리지 않는다. 대화 신호 웹소켓의 연결 목록도 프로세스 메모리에 있어서, 워커를 늘리면 신호가 일부 소켓에만 간다.

### 녹음 저장소

`UPLOAD_STORAGE`(local 기본 | s3)로 저장소를 고른다. 운영은 s3이고 키는 `{UPLOAD_S3_PREFIX}{meeting_id}/audio.<확장자>`다(기본 `meetings/`). local이면 `mm-prod_uploads` 볼륨(컨테이너의 `/data/uploads`)의 `{meeting_id}/`에 둔다. 회의가 done이 돼도 원문 듣기용으로 보관하고, failed가 되면 바로 지운다.

`UPLOAD_STORAGE=s3`인데 `UPLOAD_S3_BUCKET`이 비었거나 `UPLOAD_STORAGE`가 `local`·`s3`가 아니면 설정 오류다. 업로드·재생 요청은 500으로 실패하고(가려 주는 코드는 없다), 만료 정리(`sweep_expired_audio`)는 로그만 남기고 다음 바퀴에 다시 시도한다.

S3 클라이언트(`_s3_client`)는 프로세스당 한 번 만들어 캐시하므로 `AWS_REGION`을 바꾸면 api를 다시 띄운다. 자격은 boto3 기본 체인으로 받는다. 운영은 개인 AWS 계정 버킷이라 그 버킷 전용 IAM 사용자 키를 `.env`의 `AWS_ACCESS_KEY_ID`·`AWS_SECRET_ACCESS_KEY`에 둔다(커밋하지 않는다). 인프라 준비는 [배포 안내](../../../deploy/README.md#회의-녹음-s3-준비)에 있다.

### 녹음 보관·정리

보관 기간(`UPLOAD_AUDIO_RETENTION_DAYS`, 기본 7일)은 `meeting_audio.retention_from`부터 센다. 업로드 회의는 녹음을 받은 시각(`uploaded_at`), 디스코드 회의는 회의 종료 시각(`meeting.ended_at`, 없으면 받은 시각)이다.

- 업로드 sweeper 바퀴가 done이면서 기간이 지난 녹음을 지우고 `deleted_at`을 채운다. 처리 중(done·failed가 아님)인 회의는 기간이 지나도 지우지 않는다.
- 파일을 지우지 못하면 `deleted_at`을 비워 두고 다음 바퀴에 다시 한다.
- `UPLOAD_SWEEP_INTERVAL_SECONDS`가 0 이하면 이 정리도 멈추고 S3 lifecycle 안전망만 남는다.
- 회의·공간 삭제와 탈퇴 정리는 S3 prefix도 지운다. 근거는 [결정 기록](../plan/m5/basis-for-decision/2026-11-10-meeting-audio-s3-retention.md)에 있다.

### 서버 안 워커

세 워커 모두 주기가 0 이하면 꺼진다.

| 워커 | 주기 환경변수(기본값) | 하는 일 |
|---|---|---|
| 업로드 sweeper | `UPLOAD_SWEEP_INTERVAL_SECONDS`(300) | 멈춘 업로드 회의를 failed로 바꾸고 녹음 폴더 제거를 시도한다 |
| 세션 sweeper | `SESSION_SWEEP_INTERVAL_SECONDS`(3600) | 만료된(`expires_at`이 지난) 세션 행을 지운다. 만료 세션은 워커가 돌기 전에도 조회 때 401이다 |
| 리마인드 스케줄러 | `REMINDER_SCHEDULER_INTERVAL_SECONDS`(60) | 재촉 제안, 발송 직전 확인, 72시간 무응답 막힘, 푸시 발송 |

업로드 sweeper는 AI가 가져간 뒤 진행이 3시간 없으면 `failed_stage=diarize`, 화자 지정을 7일 기다리면 `speaker_assignment_expired`, 가져가지 않은 채 24시간이 지나면 `upload_unclaimed`로 바꾼다. live failed 업로드의 남은 폴더는 다음 바퀴마다 재시도하고, 과거 failed 잔존 파일도 대상이다. 처리 실패가 삭제 완료를 뜻하지 않는다. 기준은 [봇 계약](../contracts/backend-ai-contract.md)의 "웹 업로드 가져가기"다.

브라우저 푸시는 `VAPID_PRIVATE_KEY`·`VAPID_PUBLIC_KEY`·`VAPID_SUBJECT`가 모두 있어야 나가고, 하나라도 없으면 웹 안 알림만 쌓인다.

### 웹소켓과 자동 막힘 표시

대화 신호 웹소켓은 `GET /api/v1/workspaces/{workspace_id}/messages/ws`다. 자세한 동작은 [FE 계약](../../../frontend/docs/contracts/frontend-api-contract.md) §5.7에 있다.

- 인증은 `session_token` 쿠키다. `Origin`의 `host:port`가 `Host`와 다르면 HTTP 403으로 거절한다.
- 대화에 새 줄이 커밋되면 `thread_updated` 신호만 보낸다(본문 없음).
- 열린 소켓은 신호를 보내기 전과 클라이언트 프레임을 받은 뒤 세션과 소속을 확인하고, 유휴 상태에서도 30초마다 재확인한다. 탈퇴·세션 철회 신호로도 닫는다.
- 권한이 사라지면 4401(세션 없음)·4403(소속 아님)으로, 신호가 밀리거나 팀원 행이 바뀌면 1013으로 닫는다.
- 리버스 프록시는 이 경로의 업그레이드를 넘겨야 한다.

태스크 응답의 `auto_blocked`는 `POST /tasks/{task_id}/auto-block/undo`가 지금 성공하는 상태와 같다. 이력의 `change_source`로 가리지 않고, 막힌 뒤 사유를 PM이 바꾸면 false다.

## health ready

`GET /api/v1/health/ready`는 DB에 `SELECT 1`을 보내 연결을 확인한다(#675). Grafana Cloud Synthetic Monitoring이 밖에서 부르는 모니터링 전용 경로이고 FE·AI는 부르지 않는다. 인증이 없다.

- 정상이면 200 `{"data": {"status": "ok"}, "error": null}`이다.
- DB에 연결할 수 없으면 503 `DATABASE_UNAVAILABLE`이다. 응답에 예외 문구(호스트·계정)를 넣지 않고, 로그에도 예외 클래스 이름만 warning으로 남긴다.
- Caddy는 `/api`만 백엔드로 넘기므로 경로가 `/api/v1` 아래에 있다. 루트 `/health`는 DB를 보지 않는 프로세스 확인이고 compose healthcheck가 그대로 쓴다.

## KPI view

Grafana Cloud 대시보드(#675)가 읽는 `kpi` 스키마다. 마이그레이션 `c4f7a2d91e3b`가 PostgreSQL에만 만들고 sqlite에서는 아무것도 하지 않는다. 설치와 패널 SQL은 [deploy/monitoring/README.md](../../../deploy/monitoring/README.md)에 있다.

| 이름 | 한 행 | 컬럼 |
|---|---|---|
| `kpi.meeting_fact` | 회의 한 건(삭제된 회의·`ended_at` 없는 회의 제외) | `ended_at`, `extracted_at`, `source`, `status`, `failed_stage`, `replaced`, `meeting_minutes`, `processing_seconds`, `speaker_wait_seconds` |
| `kpi.extraction_item_fact` | 추출 항목 한 건(삭제된 회의 제외) | `created_at`, `meeting_source`, `extraction_path`, `action`, `gate`, `reverted`, `revert_after_seconds` |
| `kpi.approval_fact` | 승인 요청 한 건(삭제된 회의의 요청은 상태와 관계없이 제외) | `created_at`, `resolved_at`, `type`, `origin`, `meeting_source`, `card_gate`, `outcome`, `response_seconds`, `asr_flag`, `title_edited` |
| `kpi.excluded_workspace` | 세 view에서 뺄 워크스페이스(`workspace_id` 하나). 비어 있고 운영 SQL로 채운다 | `workspace_id` |

view에는 ID·제목·본문·payload·이름·이메일 컬럼이 없다. 워크스페이스 컬럼도 없어 서비스 전체 값만 본다.

### 값의 뜻

`processing_seconds`는 녹음이 끝난 때부터 첫 추출 등록까지다. 디스코드 회의는 `ended_at`이 워커가 처리를 시작한 시각(`PATCH /meetings/{id}/end`)이라 큐 대기가 빠지므로 `started_at + duration_ms`(마지막 발화 끝)를 녹음 끝으로 쓴다. 교체로 다시 만든 회의처럼 `started_at`이 늦게 찍혀 이 값이 `ended_at`을 넘으면 `ended_at`으로 자른다(녹음 끝은 `/end`보다 늦을 수 없다). `duration_ms`가 없거나 디스코드가 아닌 회의는 `ended_at`을 쓴다. `ended_at` 컬럼 자체는 그대로 내보내 워커 처리 구간(`ended_at`→`extracted_at`)을 볼 수 있다.

| 컬럼 | 값 |
|---|---|
| `failed_stage` | 실패한 회의에서만 알려진 단계(`stt`·`sources`·`extract`·`handoff`·`diarize`·`speaker_assignment_expired`·`upload_unclaimed`·`chat_stalled`)를 그대로, 그 밖의 값은 `other`, 실패가 아니면 null |
| `replaced` | 이 회의를 다시 시도한 회의가 있다 |
| `origin` | `auto_revert`·`manual`·`reply`·`meeting`·`other` |
| `outcome` | `pending`·`approved`·`approved_edited`·`rejected`·`other` |
| `asr_flag` | 회의 추출로 만든 `task_create` 카드에서만 `none`·`suspect`·`check_failed`(그 밖은 null) |

- 새 상태값·새 `failed_stage`가 생기면 view가 `other`로 담으므로 따로 고치지 않아도 조회는 깨지지 않는다.
- payload는 JSON 객체일 때만 읽는다. 깨진 payload 한 행은 view에서 빠지고 조회 전체를 깨지 않는다.
- JSON 문법은 맞아도 `\u0000`(NUL)이 든 payload는 jsonb로 바꿀 수 없어 같은 이유로 뺀다. 조회 실패를 막는 것이라 `\\u0000` 같은 드문 값도 함께 빠질 수 있다.
- 키 확인은 `?` 연산자 대신 `-> ... IS NOT NULL`을 쓴다(바인드 해석을 피한다).
- view는 소유자 권한으로 원본을 읽는다. 읽기 계정은 view 3개에만 SELECT를 받고 원본 표와 `excluded_workspace`는 보지 못한다.

### 원천 컬럼과 마이그레이션

view는 `SELECT *` 없이 아래 컬럼만 쓴다. 그 밖의 컬럼(예: `approval_request.resolved_by`)은 view와 상관없이 바꿀 수 있다.

| 표 | 컬럼 |
|---|---|
| `meeting` | `meeting_id`, `workspace_id`, `deleted_at`, `source`, `status`, `failed_stage`, `started_at`, `ended_at`, `duration_ms`, `replaces_meeting_id` |
| `extraction` | `extraction_id`, `meeting_id`, `created_at`, `extraction_path` |
| `extraction_item` | `extraction_id`, `created_at`, `action`, `gate`, `reverted_at` |
| `meeting_upload` | `meeting_id`, `speakers_reported_at`, `speakers_assigned_at` |
| `approval_request` | `workspace_id`, `type`, `payload`(키 `reverted_task_id`·`change_source`·`extraction_item_id`·`meeting_id`·`gate`·`task_overrides`·`asr_suspects`·`source_deleted`), `requested_by`, `status`, `created_at`, `resolved_at` |

이 컬럼을 DROP하거나 타입을 바꾸는 마이그레이션은 PostgreSQL이 거부한다. 같은 마이그레이션에서 view를 DROP한 뒤 다시 만들고, 읽기 계정의 GRANT를 다시 실행한다.

마이그레이션 테스트(`tests/test_migration_kpi_views.py`)는 view 컬럼 목록, 고정 행의 값, `downgrade()` 뒤 스키마가 남지 않는 것, 위 거부 동작, view가 쓰지 않는 컬럼은 지울 수 있다는 것, view가 실제로 기대는 원천 컬럼이 위 표와 같다는 것을 확인한다. 위 표를 고치면 `test_views_depend_only_on_listed_columns`의 `expected`도 같이 고친다. PostgreSQL이 필요해 `TEST_DATABASE_URL`이 있을 때만 돈다.

## 의존성 잠금

운영 이미지와 CI는 `requirements.lock`(버전과 해시 고정)으로 설치한다. `requirements.txt`는 직접 쓰는 패키지와 하한만 적는 입력이다. 둘 다 `backend/`에서 CI와 같은 uv 0.13.7로 만든다.

```bash
# requirements.txt 를 고친 뒤. 이미 고정한 버전은 그대로 두고 바뀐 것만 다시 푼다
uvx uv@0.13.7 pip compile requirements.txt --universal --python-version 3.12 --generate-hashes -o requirements.lock
# 특정 패키지만 올릴 때
uvx uv@0.13.7 pip compile requirements.txt --universal --python-version 3.12 --generate-hashes -o requirements.lock --upgrade-package fastapi
# 전부 최신으로 올릴 때(CI 와 운영 이미지 빌드를 다시 확인한다)
uvx uv@0.13.7 pip compile requirements.txt --universal --python-version 3.12 --generate-hashes -o requirements.lock --upgrade
```

`requirements.txt`만 고치고 잠금 파일을 다시 만들지 않으면 CI lint 잡의 "잠금 파일 확인"이 실패한다. `--universal`은 서버(리눅스)에서만 쓰는 패키지가 맥에서 만들 때 빠지지 않게 한다.
