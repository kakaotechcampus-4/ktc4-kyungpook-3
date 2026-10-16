# Backend

회의 → 추출 → 매칭 → 게이트 → 승인 파이프라인 백엔드. FastAPI + SQLAlchemy + Alembic.

## 문서

- [문서 안내](docs/README.md): 문서 구조와 기존 문서 배치.
- 계약: [AI(녹음 봇) 계약](docs/contracts/backend-ai-contract.md), 웹 화면용은 [프론트엔드 대표 계약](../frontend/docs/contracts/frontend-api-contract.md).
- 계획: [전체 계획](docs/plan/backend-plan.md), [M0~M7 안내](docs/plan/README.md). 마일스톤별 plan.md는 아직 비어 있다. 진행 상태는 전체 계획의 마일스톤 개요(2026-10-02 기준)를 따른다.
- 결과: [M0](docs/plan/m0/result.md)(백엔드 CI 보완), [M2](docs/plan/m2/result.md)(승인 때 대상 task 제목 확인), [M7](docs/plan/m7/result.md)(배포 전 CI 검사, 봇 재시작 잠금, 되돌리기 문서). 모두 마일스톤 완료를 판정하지 않았다.
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
| `EXTRACTION_ITEM_NOT_FOUND` | 404 | 그 추출 결과에 해당 항목이 없음 (auto 되돌리기) |
| `APPROVAL_NOT_FOUND` | 404 | 승인 요청을 찾을 수 없음 |
| `WORKSPACE_NOT_FOUND` | 404 | 워크스페이스를 찾을 수 없음 |
| `MEMBER_NOT_FOUND` | 404 | 팀원을 찾을 수 없음 |
| `MEMBER_ALIAS_NOT_FOUND` | 404 | 담당자 별칭을 찾을 수 없음 |
| `TASK_NOT_FOUND` | 404 | 태스크를 찾을 수 없음 |
| `TASK_HISTORY_NOT_FOUND` | 404 | 반영 로그(태스크 히스토리)를 찾을 수 없음 |
| `MEETING_ALREADY_ENDED` | 409 | 이미 종료된 회의 |
| `MEETING_NOT_PROCESSING` | 409 | 회의가 PROCESSING 상태가 아닌데 추출을 시도함 |
| `APPROVAL_ALREADY_RESOLVED` | 409 | 이미 승인/반려 처리된 요청을 다시 처리하려 함 |
| `APPROVAL_CONFLICT` | 409 | task_update 제안 이후 같은 필드가 바뀌었거나 대상 task 제목이 바뀌어 승인하지 않음. `details.conflicts`에 필드별 기준값·지금 값·제안 값(`field: "title"`은 대상 확인용이라 `proposed`가 null). 확인 후 `details.task_version`을 `confirm_task_version`에 담아 다시 승인하면 반영(그 사이 또 바뀌었으면 다시 409) |
| `TASK_HISTORY_ALREADY_ROLLED_BACK` | 409 | 이미 되돌린 변경을 다시 되돌리려 함 |
| `AUTO_TASK_NOT_REVERTIBLE` | 409 | auto로 만든 태스크를 되돌릴 수 없음. `details.reason`: `already_reverted`(이미 되돌림) · `not_auto_created`(auto로 만든 항목이 아님) · `task_missing`(태스크가 없음) · `task_changed`(만든 뒤 바뀜, `details.task_version`) · `pending_approval`(그 태스크의 처리 대기 승인 요청이 있음, `details.approval_id`). 태스크를 직접 고친다 |
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
| 지운 Task | 지울 때(`tasks.delete_task`)도 버전을 올리고 요청을 쌓는다. 워커는 지금 DB에 페이지가 있으면 보관(`archived: true`)하고, 없으면 만들지 않는다. 결과를 모르는 POST가 있었으면 조회한 뒤 보관한다. 새 DB가 붙어도 지운 Task에는 요청을 쌓지 않는다(#232) |

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
| 회의 인계 | 봇은 아직 `ai/.env`의 `BE_WORKSPACE_ID` 하나로 회의를 보낸다. 봇이 아래 [서버로 워크스페이스 찾기](#서버로-워크스페이스-찾기)를 쓰도록 바꾸는 작업은 AI 쪽 #180 후속이며 #194 머지 뒤에 시작한다 |

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
| 검색 대상 | 같은 워크스페이스에서 status가 todo·in_progress·blocked·done이고 임베딩이 있는, 지우지 않은 task. 코사인 유사도 상위 `k`(기본 3)개 중 `min_similarity`(기본 0.4, ai/docs/basis_for_decision/ai/2026-09-22-0010-embedding-similarity-threshold.md) 이상만 |
| 검색 인증 | 봇이 세션 없이 부르므로 `X-Service-Token` 헤더를 `SERVICE_TOKEN`과 비교한다. 없거나 다르면 401 |
| 검색 실패 | 임베딩 호출이 실패하면 빈 목록 대신 `EMBEDDING_UNAVAILABLE`(502). 빈 목록이면 호출한 쪽이 중복 task를 만들 수 있다 |
| `action` 없음 / `create` | 게이트가 auto면 task 생성, 아니면 task_create 승인 요청. 게이트는 `decide_create_gate`가 정한다. 먼저 BE가 계산한 담당자 확신도를 본다. 담당자를 언급했는데 찾지 못했으면(중의적·없음) `hold`다. `assignee_raw` 없이 `second`·`thirdpronoun`·`thirdrole`만 오거나 1인칭인데 화자가 없으면, 사람을 지목했지만 누군지 모르는 것이라 `hold`다(`mentions_assignee`). judge 항목은 그다음 아래 auto 조건을 모두 만족하면 `auto`, 아니면 `review`다. 경로를 가릴 수 없고 확신도도 없는 항목은 `review`, legacy는 확신도로 정한다(#201) |
| judge auto 조건 | 숫자 점수가 아니라 조건을 모두 만족할 때만 `auto`다(`matching.auto_blockers`, #232). ① 새 항목 ② `task_status`가 certain ③ 담당자를 언급했으면 한 명으로 찾았고(검증된 별칭이나 화자) 확신도 0.8 이상 ④ `assignee_type`이 `second`·`thirdpronoun`·`thirdrole`이 아님(AI가 대명사·역할을 문맥으로 푼 이름) ⑤ `due_status`가 certain이거나 missing이고 `due_date` 유무와 맞음 ⑥ `similar_count`가 0이고, 워크스페이스에 임베딩을 기다리는 task가 없음(`embedding.has_tasks_waiting_for_embedding`). 그런 task는 AI의 유사 검색에 잡히지 않아 0을 믿을 수 없다. 같은 회의에서 앞 항목이 auto로 만든 task도 여기 걸려, 한 회의에서 auto는 보통 첫 항목뿐이다. 지운 task와 임베딩 API가 지금 제목을 거절한 task는 기다리지 않는 것으로 본다. `task_status`·`due_status`·`similar_count` 중 하나라도 보내지 않으면 `review`다. 할 일 근거 상태는 LLM의 자기 표시라 걸러 내는 힘이 약해서, 중복 생성은 임베딩으로 계산한 유사 검색 결과로 막는다. `top_similarity`는 판단에 쓰지 않고 기록만 한다(유사도 기준값을 정할 근거). 못 맞춘 조건은 info 로그(`reasons=`)로 남긴다 |
| auto 되돌리기 | `POST /api/v1/extractions/{extraction_id}/items/{item_id}/revert`(PM). auto로 만든 태스크를 지우고(`task.is_deleted`) 같은 내용의 task_create 승인 요청(`gate: review`, 표시용 `reverted_task_id`)을 만들어 항목에 잇는다. 항목의 `task_id`는 비우고 `reverted_at`·`reverted_by`를 남기며 `gate`는 처음 판단대로 `auto`다. 승인하면 새 태스크가 생겨 항목에 이어지고, 반려하면 태스크 없이 끝난다. 값 하나가 틀린 것은 태스크를 직접 고치면 되지만 중복·오판은 고칠 값이 없어서 PM이 승인·반려를 다시 고르게 한다. 만든 뒤 태스크가 바뀌었거나(`version`이 1이 아님) 그 태스크의 처리 대기 승인 요청이 있으면 409 `AUTO_TASK_NOT_REVERTIBLE`이다. 바뀐 값이 승인 요청에 담기지 않고 사라지기 때문이다. 근거는 저장된 근거 발화가 있을 때만 승인 요청에 담긴다(#229 전에는 비어 있다) |
| 지운 task | 지금은 auto 되돌리기만 task를 지운다. 행은 남기고(Notion 페이지 보관, 추출 항목·이력 연결 유지) task 목록·조회·수정·이력·유사 검색·임베딩·승인 요청 대상에서 뺀다. 지운 task를 가리키는 조회는 404 `TASK_NOT_FOUND`, update 추출 항목은 건너뛰고, 추출 조회는 그 task를 가리키던 항목의 `task_id`를 null로 내린다. Notion 재시도(`POST /tasks/{id}/notion-sync/retry`)만 지운 task도 받는다(페이지 보관 재시도). task를 바꾸는 경로(`PATCH /tasks/{id}`, 이력 되돌리기, 승인 요청 생성, 추출 update 대상)는 task 행을 커밋까지 잠그고 다시 읽어, 되돌리기와 겹쳐도 지운 task에 쓰지 않는다 |
| 추출 경로 | AI가 경로를 보내지 않으므로 항목이 보낸 키로 가린다. `action`·`category`·`doc_text`를 보냈으면 judge, 확신도를 보냈으면 legacy다(`ExtractionItemCreate.extraction_path`). 모든 항목이 같을 때만 `extraction.extraction_path`에 남기고 아니면 NULL. 확신도를 보내지 않으면 0.0이 아니라 NULL(측정 안 함)로 저장한다 |
| `action: update` | `target_task_id`의 task_update 승인 요청을 만든다(신뢰도와 무관하게 항상 PM 승인 대상). `task_title`은 없어도 되고, 와도 제목은 바꾸지 않는다 |
| update 변경안 | 들어온 값 중 지금 task와 다른 `due_date`·`status`·`assignee_member_id`만 담는다. 담당자는 지금 task와 다를 때만 넣고 같으면 뺀다 |
| update 충돌 기준값 | 변경 필드마다 `base_values`를 남겨 승인 시 그 뒤 수정과 충돌을 확인한다. 기준값은 AI가 유사 검색에서 본 값(`target_snapshot`의 `due_date`·`status`·`assignee_member_id`)이다. 보내지 않은 필드나 `target_snapshot`이 없는 요청은 등록 시점의 값을 쓴다. 검색과 등록 사이에 PM이 고친 값을 승인이 덮지 않게 하려는 것이다 |
| update 대상 확인 | AI가 task를 고를 때 본 제목(`target_snapshot.title`, 없거나 null이면 등록 시점 제목)을 payload의 `base_title`에 남긴다. 승인할 때 지금 제목과 다르면 다른 필드가 그대로여도 `APPROVAL_CONFLICT`의 `title` 항목으로 알린다. 제목은 바꾸지 않는다. 앞뒤 공백만 다르면 같은 제목으로 본다. `base_title`이 없는 요청(이 기능 전에 만든 요청, `base_title`을 보내지 않은 수동 생성)은 제목을 확인하지 않는다. 수동 생성(`POST /approvals`)은 payload를 그대로 저장해서 `base_title`·`base_values`를 넣으면 확인한다(#185) |
| update 승인 요청 생성 여부 | 담당자를 하나로 못 찾았으면(중의적이거나 없음) 다른 변경이 없어도 PM이 보도록 승인 요청을 만든다. `category: scope`(대응하는 task 필드가 없는 범위 결정)도 다른 변경이 없어도 승인 요청을 만든다. 그 외에 담당자까지 같거나 언급이 없고 다른 변경도 없으면 승인 요청 자체를 만들지 않는다(단 `doc_text`·근거는 ExtractionItem에 남는다) |
| 추출 조회의 auto 표시 | 항목의 `gate`가 `auto`면 승인 없이 만든 항목이다. 되돌렸으면 `reverted_at`이 있고 새 승인 요청이 `approval_id`·`approval_status`로 보인다. 판단 근거로 `task.evidence_status`·`due_date.evidence_status`·`similar_count`·`top_similarity`를 함께 싣는다(보내지 않았으면 null) |
| 추출 조회의 반영 여부 | `GET /api/v1/extractions/{extraction_id}` 항목의 `task_id`는 연결된 task다. create는 task가 생긴 뒤에 채워지지만, update는 수정 대상이라 승인 전에도 있다. 그래서 반영 여부는 `approval_status`(연결된 승인 요청의 `status`: pending·approved·rejected, 승인 요청이 없으면 null)로 본다. approved는 task 반영과 같은 트랜잭션에서 커밋되고, 충돌로 반영하지 못하면 pending으로 남는다. 상태는 항목 조회에 승인 요청을 붙여 한 쿼리로 읽는다. 따로 읽으면 그 사이 승인이 커밋되어 `task_id`는 승인 전, `approval_status`는 승인 뒤 값으로 어긋날 수 있다(#211) |
| 잘못된 항목 | update의 `target_task_id`가 없거나 다른 워크스페이스 task면, create의 `task_title`이 비어 있으면 그 항목만 건너뛰고 나머지는 처리한다(응답 `item_count`는 저장된 항목 수) |

## 권한

로그인한 사용자가 요청한 워크스페이스의 팀원인지(소속) 확인하고, 아래 쓰기 API는 PM인지까지 확인한다. 아니면 403 `FORBIDDEN`.
원본은 `app/api/deps.py`의 `require_pm`.

| 구분 | API |
|---|---|
| PM 전용 | 승인·반려(`PATCH /approvals/{id}`), 할일 생성·수정(`POST /tasks`, `PATCH /tasks/{id}`), 되돌리기, auto 되돌리기(`POST /extractions/{id}/items/{item_id}/revert`), Notion 재시도, 팀원 생성·수정, 별칭 생성·삭제, Notion 연결 시작·콜백(`GET .../integrations/notion/start`, `GET /integrations/notion/callback`), Discord 연결 시작·콜백(`GET .../integrations/discord/start`, `GET /integrations/discord/callback`), 연동 해제, 회의 업로드, 온보딩 저장 |
| 소속이면 누구나 | 조회 API 전부, 승인 요청 생성(`POST /approvals`) |

- Notion 연결 시작·콜백은 브라우저 페이지 이동이라 403 대신 앱 화면의 `?oauth=notion&oauth_result=failed`로 돌려보낸다.
- 일반 팀원은 할일을 직접 바꾸지 못하고 승인 요청을 올려 PM의 승인을 받는다. 요청자(`requested_by`)는 바디 값이 아니라 로그인한 팀원으로 기록한다.
- PM 역할은 `PATCH /members/{id}`의 `role`로 바꾼다. PM을 넘길 때는 다른 팀원을 먼저 PM으로 올린 뒤 자기를 내린다. 로그인 계정이 있는 PM이 한 명도 남지 않게 되면 409 `LAST_PM_REQUIRED`.
- 봇 경로(회의 생성·종료·실패, 발화 저장, 유사 task 검색, 추출 등록, 서버로 워크스페이스 찾기)는 사용자 세션 대신 서비스 토큰(`X-Service-Token`, `deps.require_service_token`)으로 막는다. 없거나 틀리면 401 `UNAUTHENTICATED`. 자세한 내용은 [AI(녹음 봇) 계약](docs/contracts/backend-ai-contract.md#인증).

## 아직 없는 것

봇이 서버로 워크스페이스를 찾아 회의를 보내는 연결(BE 조회는 있고 봇은 아직 `ai/.env`의 `BE_WORKSPACE_ID` 하나로 보낸다, AI #180 후속), 워크스페이스 초대, 오디오 업로드·스트리밍, 메시지 로그.
