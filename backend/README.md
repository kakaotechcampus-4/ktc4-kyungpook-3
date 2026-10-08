# Backend

회의 → 추출 → 매칭 → 게이트 → 승인 파이프라인 백엔드. FastAPI + SQLAlchemy + Alembic.

## 문서

- [문서 안내](docs/README.md): 문서 구조와 기존 문서 배치.
- 계약: [AI(녹음 봇) 계약](docs/contracts/backend-ai-contract.md), 웹 화면용은 [프론트엔드 대표 계약](../frontend/docs/contracts/frontend-api-contract.md).
- 계획: [전체 계획](docs/plan/backend-plan.md), [M0~M7 안내](docs/plan/README.md). 마일스톤별 plan.md는 아직 비어 있고 `result.md`는 없다. 진행 상태는 전체 계획의 마일스톤 개요(2026-10-02 기준)를 따른다.

## 실행

DB는 PostgreSQL이다. 로컬에서는 Docker로 띄운다(Docker Desktop 필요).

```bash
uv venv --python 3.12 .venv
uv pip install -r requirements-dev.txt   # requirements.txt(운영) + pytest
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
| 프로세스 | uvicorn `--workers 1`, `--reload` 없음. Notion/임베딩 워커가 프로세스마다 뜨므로 워커를 늘리지 않는다 |
| 포트 | api는 `127.0.0.1:8000`에만 열린다. 외부 공개는 같은 서버의 리버스 프록시(HTTPS)가 맡는다. db는 호스트에 열지 않는다 |
| DB 접속 | api의 `DATABASE_URL`은 `.env`의 `POSTGRES_USER`/`POSTGRES_PASSWORD`/`POSTGRES_DB`로 다시 만든다(`db:5432`) |
| 나머지 환경변수 | `NOTION_*`·`DISCORD_*`·`EMBEDDING_*`·`SERVICE_TOKEN` 등은 `.env`를 그대로 넘긴다 |
| 필수 값 | `OAUTH_STATE_SECRET`이 비어 있으면 `docker compose`가 기동 전에 멈춘다(Notion 연결용 서명 키) |
| 데이터 | DB는 `mm-prod_pgdata` 볼륨에 남는다. 로컬 개발용 볼륨(`mm-pgdata`)과 따로다 |
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
| `APPROVAL_NOT_FOUND` | 404 | 승인 요청을 찾을 수 없음 |
| `WORKSPACE_NOT_FOUND` | 404 | 워크스페이스를 찾을 수 없음 |
| `MEMBER_NOT_FOUND` | 404 | 팀원을 찾을 수 없음 |
| `MEMBER_ALIAS_NOT_FOUND` | 404 | 담당자 별칭을 찾을 수 없음 |
| `TASK_NOT_FOUND` | 404 | 태스크를 찾을 수 없음 |
| `TASK_HISTORY_NOT_FOUND` | 404 | 반영 로그(태스크 히스토리)를 찾을 수 없음 |
| `MEETING_ALREADY_ENDED` | 409 | 이미 종료된 회의 |
| `MEETING_NOT_PROCESSING` | 409 | 회의가 PROCESSING 상태가 아닌데 추출을 시도함 |
| `APPROVAL_ALREADY_RESOLVED` | 409 | 이미 승인/반려 처리된 요청을 다시 처리하려 함 |
| `APPROVAL_CONFLICT` | 409 | task_update 제안 이후 같은 필드가 바뀌어 승인하지 않음. `details.conflicts`에 필드별 기준값·지금 값·제안 값. 확인 후 `details.task_version`을 `confirm_task_version`에 담아 다시 승인하면 반영(그 사이 또 바뀌었으면 다시 409) |
| `TASK_HISTORY_ALREADY_ROLLED_BACK` | 409 | 이미 되돌린 변경을 다시 되돌리려 함 |
| `LAST_PM_REQUIRED` | 409 | 워크스페이스의 마지막 PM(로그인 계정이 있는 PM)을 member로 내리려 함. 다른 팀원을 먼저 PM으로 지정해야 함 |
| `DISCORD_USER_ALREADY_MAPPED` | 409 | 같은 워크스페이스에서 탈퇴하지 않은 다른 팀원에 이미 연결된 디스코드 계정(`details.discord_user_id`). 탈퇴(`is_deleted`)한 팀원의 계정은 다시 연결할 수 있음. `discord_user_id`의 앞뒤 공백은 지우고, 빈 값은 연결 없음(null)으로 저장. 64자를 넘으면 이 코드가 아니라 400 `INVALID_REQUEST` |
| `AUDIO_UPLOAD_FAILED` | 422 | 오디오 저장·병합 실패 *(아직 미구현 경로)* |
| `AUDIO_FORMAT_UNSUPPORTED` | 422 | 지원하지 않는 오디오 형식 *(아직 미구현 경로)* |
| `TRANSCRIPTION_FAILED` | 502 | 음성 전사 실패 *(아직 미구현 경로)* |
| `EXTRACTION_FAILED` | 502 | 회의 분석 실패 *(아직 미구현 경로)* |
| `NOTION_WRITE_FAILED` | 502 | Notion 페이지 생성/갱신 실패 *(Task API는 더 이상 내려주지 않음 — 아래 Notion 연동 참고)* |
| `EMBEDDING_UNAVAILABLE` | 502 | 임베딩 서버 호출 실패 또는 임베딩 키 미설정 (유사 task 검색) |
| `DISCORD_API_FAILED` | 502 | Discord 서버 사용자 목록을 가져오지 못함(봇 토큰 미설정·권한·네트워크). `details.status`에 Discord 응답 상태(응답이 없으면 null) |
| `INTERNAL_ERROR` | 500 | 그 외 서버 내부 오류 |

*(아직 미구현 경로)* 표시가 붙은 코드는 오디오 업로드/전사가 실제로 붙기
전까지는 절대 내려오지 않는다.

## Notion 연동

로컬 DB와 Notion은 하나의 트랜잭션으로 롤백할 수 없어서, Task 변경과 Notion 반영을
분리한다(outbox 패턴, `app/services/notion_sync.py`).

1. Task 생성·수정·되돌리기(`app/services/tasks.py`)는 `Task.version`을 올리고, 같은
   트랜잭션에 반영 작업(`notion_sync_job`) 한 줄을 쌓는다. **요청 안에서는 Notion을
   호출하지 않으므로** Notion 장애가 Task API를 실패시키지 않는다.
2. 서버 프로세스 안의 워커(`app/main.py` lifespan, `NOTION_SYNC_INTERVAL_SECONDS`마다,
   기본 5초, 0이면 끔)가 대기 작업을 꺼내 Notion에 페이지를 만들거나(POST) 고친다(PATCH).

`Integration(provider="notion")` 행이 없거나 `access_token`/`provider_channel_id`(대상
데이터베이스 ID)가 비어 있으면 작업을 쌓지 않는다 — 연동은 선택 사항이다.

| 항목 | 동작 |
|---|---|
| 상태 | Task 응답의 `notion_sync_status`: `pending`(반영 대기) · `synced` · `failed` · `null`(미연동) |
| 재시도 | 429·409·5xx·네트워크 오류는 지수 백오프(10초~10분, `Retry-After` 우선)로 최대 5회. 400·401·403·404는 바로 `failed` |
| 순서·중복 | 항상 Task의 현재 값 전체를 보내고 `notion_synced_version`에 보낸 버전을 기록한다. 그 이하 버전 작업은 건너뛴다(`skipped`) |
| 생성 타임아웃 | POST 직전에 `notion_create_attempted_at`을 커밋해 둔다. 결과를 모른 채 끝나면 다음 시도는 POST를 반복하지 않고 `Task ID` 속성으로 페이지를 먼저 조회한다 |
| 워커 중단 | `in_progress`로 5분 넘게 남은 작업은 다시 대기열로 돌린다 |
| 수동 재시도 | `POST /api/v1/tasks/{task_id}/notion-sync/retry` — `failed` 작업의 재시도 횟수를 초기화해 다시 대기열에 넣는다 |

워커는 프로세스당 하나만 도는 것을 전제로 한다(uvicorn 워커를 여러 개 띄우면 안 됨).

### Notion 연결 (OAuth)

PM이 온보딩에서 Notion을 연결하면 `Integration` 행(토큰 + 대상 DB ID)이 생긴다.

1. 프론트가 `GET /api/v1/workspaces/{workspace_id}/integrations/notion/start?state=<돌아올 앱 경로>`로
   이동한다. PM만 통과하고, 서명한 state와 짝 쿠키(`notion_oauth_nonce`)를 만들어 Notion 허용 화면으로 보낸다.
2. PM이 Notion에서 **"템플릿 사용"**을 고르고 허용한다. Notion이 우리 템플릿을 PM 워크스페이스에 복제한다.
3. Notion이 `GET /api/v1/integrations/notion/callback`으로 돌려보낸다. state·짝 쿠키·로그인 사용자·PM 여부를
   확인하고 토큰을 저장한 뒤 **바로** `<앱 경로>?oauth=notion&oauth_result=success`로 보낸다.
4. 템플릿 복제는 10초 남짓 걸린다. 그래서 응답 뒤에 서버가 **Notion DB 찾기 작업**을 따로 돌린다
   (`app/services/notion_connect.py`, FastAPI `BackgroundTasks`). 2초마다 복제 페이지를 보고(최대 60초),
   DB를 찾아 속성을 확인한 뒤 `provider_channel_id`에 저장한다. 이때부터 워커가 반영한다.

callback은 워크스페이스별 경로가 아닌 고정 경로다. Notion에 등록하는 redirect URI는 한 글자도 달라질 수
없어서 workspace_id를 넣지 못하고, 어느 워크스페이스인지는 서명한 state에서 꺼낸다.

| 항목 | 동작 |
|---|---|
| 결과 | 항상 앱 화면으로의 302다. `oauth_result`는 `success` · `cancelled`(허용 화면에서 취소) · `failed`. JSON 오류를 보이지 않는다 |
| 템플릿 미사용 | 허용 화면에서 기존 페이지를 고르면(Notion이 이 선택지를 숨길 수 없다) 저장하지 않고 `failed` |
| 다시 연결 | 쓰던 DB를 새 토큰으로도 쓸 수 있으면 토큰만 바꾸고 DB는 그대로 둔다. Notion에는 템플릿 복제본이 하나 더 생긴다 |
| Notion DB 찾기 작업 실패 | 60초 안에 DB를 못 찾거나, 템플릿에 DB가 없거나, 속성이 다르면 연결 행을 지운다. 이유는 경고 로그로 남는다(`Notion 대상 DB 연결 실패 … result=…`) |
| 서버 재시작 | Notion DB 찾기 작업 도중 서버가 꺼지면 토큰만 있는 연결이 남는다. 다시 연결하면 된다 |
| 보안 | state는 HMAC 서명(10분 만료)이고 짝 쿠키로 한 번만 쓰인다. callback에서 로그인 사용자와 PM 여부를 다시 확인한다. code·state·토큰은 로그에 남기지 않는다 |

**환경변수** (`.env.example` 참고)

| 이름 | 값 |
|---|---|
| `NOTION_CLIENT_ID`, `NOTION_CLIENT_SECRET` | Notion 개발자 페이지의 Public connection → Configuration 탭 |
| `NOTION_REDIRECT_URI` | 프론트와 같은 주소의 callback. 로컬 `http://localhost:5173/api/v1/integrations/notion/callback`(Vite 프록시가 백엔드로 넘긴다), 운영 `https://<서비스 주소>/api/v1/integrations/notion/callback` |
| `OAUTH_STATE_SECRET` | state 서명 키, 32자 이상. `python3 -c "import secrets;print(secrets.token_urlsafe(48))"`로 만든다. 없으면 연결 시작이 `failed`가 된다 |

**Notion 개발자 페이지 설정** (Public connection)

- Redirect URI에 위 `NOTION_REDIRECT_URI`와 같은 값을 등록한다.
- "Notion URL for optional template"에 웹에 게시한 템플릿 페이지 주소를 넣는다.

**템플릿 규칙** — 어긋나면 4번에서 연결이 지워진다(`notion.verify_database_schema`)

- "회의 Task" 같은 페이지 **바로 아래**에 데이터베이스를 둔다(열·토글 안에 넣으면 찾지 못한다).
- 속성 이름과 종류를 `app/services/notion.py`의 `DATABASE_SCHEMA`와 맞춘다: Name/title, Status/select,
  Assignee/rich_text, Due Date/date, Progress/number, Blocker/rich_text, **Task ID/rich_text**.
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
| 회의 인계 | 봇은 아직 `ai/.env`의 `BE_WORKSPACE_ID` 하나로 회의를 보낸다. 서버로 워크스페이스를 찾는 조회는 여러 워크스페이스 지원 때 붙인다 |

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

**환경변수** (`.env.example` 참고)

| 이름 | 값 |
|---|---|
| `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` | Discord 개발자 포털 → 앱 → OAuth2 |
| `DISCORD_REDIRECT_URI` | 프론트와 같은 주소의 callback. 로컬 `http://localhost:5173/api/v1/integrations/discord/callback`, 운영 `https://<서비스 주소>/api/v1/integrations/discord/callback` |
| `DISCORD_BOT_TOKEN` | 녹음 봇(`ai/.env`)과 같은 봇의 토큰. 서버 사용자 목록을 읽는다 |
| `OAUTH_STATE_SECRET` | Notion 연결과 같은 서명 키를 쓴다 |

**Discord 개발자 포털 설정**

- OAuth2 → Redirects에 위 `DISCORD_REDIRECT_URI`와 같은 값을 등록한다.
- Bot → Privileged Gateway Intents에서 **Server Members Intent**를 켠다(녹음 봇도 이미 쓴다).

## 유사 task 검색과 AI 판단 접수

회의에서 나온 말이 기존 task의 수정인데도 새 task가 생기는 것을 막기 위한 흐름이다(#102).

1. AI가 Terra 1단계 결과 문장으로 `POST /api/v1/workspaces/{workspace_id}/tasks/similar`를 부른다.
   BE는 비슷한 기존 task 후보(AI의 `NotionCandidate` 필드 형식)를 돌려준다.
2. AI가 Terra 2단계에서 새 task인지 기존 task 수정인지 판단한다.
3. AI가 판단 결과를 `POST /api/v1/extractions` 항목의 `action`(create/update)으로 보낸다.

| 항목 | 동작 |
|---|---|
| 임베딩 저장 | task 제목의 임베딩을 `task.embedding`(pgvector, 1536차원)에 둔다. 생성·제목 변경 시 NULL로 비우고, 서버 안의 워커(`EMBEDDING_SYNC_INTERVAL_SECONDS`마다)가 채운다. 요청 안에서는 임베딩 API를 부르지 않는다 |
| 워커 실패 | 제목이 비었거나 공백뿐인 task는 보내지 않는다. 입력 오류(400·413·422)면 하나씩 다시 보내 거절된 task만 건너뛴다. 그 외 실패(연결·타임아웃·5xx·429)는 연속 실패할수록 대기 간격을 두 배씩 늘리고(최대 5분, `Retry-After`가 있으면 우선), 성공하면 원래 간격으로 돌아간다. 401·403은 바로 5분 간격으로 늘리고 error 로그를 남긴다 |
| 검색 대상 | 같은 워크스페이스에서 status가 todo·in_progress·blocked·done이고 임베딩이 있는 task. 코사인 유사도 상위 `k`(기본 3)개 중 `min_similarity`(기본 0.4, ai/docs/basis_for_decision/ai/2026-09-22-0010-embedding-similarity-threshold.md) 이상만 |
| 검색 인증 | 봇이 세션 없이 부르므로 `X-Service-Token` 헤더를 `SERVICE_TOKEN`과 비교한다. 없거나 다르면 401 |
| 검색 실패 | 임베딩 호출이 실패하면 빈 목록 대신 `EMBEDDING_UNAVAILABLE`(502). 빈 목록이면 호출한 쪽이 중복 task를 만들 수 있다 |
| `action` 없음 / `create` | 예전과 같다. 게이트가 auto면 task 생성, 아니면 task_create 승인 요청 |
| `action: update` | `target_task_id`의 task_update 승인 요청을 만든다(신뢰도와 무관하게 항상 PM 승인 대상). `task_title`은 없어도 되고, 와도 제목은 바꾸지 않는다 |
| update 변경안 | 들어온 값 중 지금 task와 다른 `due_date`·`status`·`assignee_member_id`만 담는다. 담당자는 지금 task와 다를 때만 넣고 같으면 뺀다 |
| update 충돌 기준값 | 변경 필드마다 `base_values`를 남겨 승인 시 그 뒤 수정과 충돌을 확인한다. 기준값은 AI가 유사 검색에서 본 값(`target_snapshot`의 `due_date`·`status`·`assignee_member_id`)이다. 보내지 않은 필드나 `target_snapshot`이 없는 요청은 등록 시점의 값을 쓴다. 검색과 등록 사이에 PM이 고친 값을 승인이 덮지 않게 하려는 것이다 |
| update 승인 요청 생성 여부 | 담당자를 하나로 못 찾았으면(중의적이거나 없음) 다른 변경이 없어도 PM이 보도록 승인 요청을 만든다. `category: scope`(대응하는 task 필드가 없는 범위 결정)도 다른 변경이 없어도 승인 요청을 만든다. 그 외에 담당자까지 같거나 언급이 없고 다른 변경도 없으면 승인 요청 자체를 만들지 않는다(단 `doc_text`·근거는 ExtractionItem에 남는다) |
| 잘못된 항목 | update의 `target_task_id`가 없거나 다른 워크스페이스 task면, create의 `task_title`이 비어 있으면 그 항목만 건너뛰고 나머지는 처리한다(응답 `item_count`는 저장된 항목 수) |

## 권한

로그인한 사용자가 요청한 워크스페이스의 팀원인지(소속) 확인하고, 아래 쓰기 API는 PM인지까지 확인한다. 아니면 403 `FORBIDDEN`.
원본은 `app/api/deps.py`의 `require_pm`.

| 구분 | API |
|---|---|
| PM 전용 | 승인·반려(`PATCH /approvals/{id}`), 할일 생성·수정(`POST /tasks`, `PATCH /tasks/{id}`), 되돌리기, Notion 재시도, 팀원 생성·수정, 별칭 생성·삭제, Notion 연결 시작·콜백(`GET .../integrations/notion/start`, `GET /integrations/notion/callback`), Discord 연결 시작·콜백(`GET .../integrations/discord/start`, `GET /integrations/discord/callback`), 연동 해제, 회의 업로드, 온보딩 저장 |
| 소속이면 누구나 | 조회 API 전부, 승인 요청 생성(`POST /approvals`) |

- Notion 연결 시작·콜백은 브라우저 페이지 이동이라 403 대신 앱 화면의 `?oauth=notion&oauth_result=failed`로 돌려보낸다.
- 일반 팀원은 할일을 직접 바꾸지 못하고 승인 요청을 올려 PM의 승인을 받는다. 요청자(`requested_by`)는 바디 값이 아니라 로그인한 팀원으로 기록한다.
- PM 역할은 `PATCH /members/{id}`의 `role`로 바꾼다. PM을 넘길 때는 다른 팀원을 먼저 PM으로 올린 뒤 자기를 내린다. 로그인 계정이 있는 PM이 한 명도 남지 않게 되면 409 `LAST_PM_REQUIRED`.
- 봇 경로(회의 생성·종료·실패, 추출 등록)는 아직 사용자·서비스 인증이 없다. 운영에서는 리버스 프록시가 외부 접근을 막는다.

## 아직 없는 것

Discord 서버로 워크스페이스를 찾는 조회(봇은 `ai/.env`의 `BE_WORKSPACE_ID` 하나로 회의를 보낸다), 워크스페이스 초대, 오디오 업로드·스트리밍, 메시지 로그.
