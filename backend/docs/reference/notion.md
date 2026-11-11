# Notion 연동

[Backend README](../../README.md)로 돌아가기

Task 변경을 Notion 데이터베이스에 반영하는 구조와 PM이 Notion을 연결하는 OAuth 흐름을 적는다.

## 동기화 구조

로컬 DB와 Notion은 하나의 트랜잭션으로 롤백할 수 없어서 Task 변경과 Notion 반영을 분리한다(outbox 패턴, `app/services/notion_sync.py`).

1. Task 생성·수정·되돌리기·지우기(`app/services/tasks.py`)는 `Task.version`을 올리고, 같은 트랜잭션에 "이 Task를 확인해 달라"는 요청(`notion_sync_job`) 한 줄을 연결 상태와 상관없이 쌓는다. 요청 안에서는 Notion을 호출하지 않으므로 Notion 장애가 Task API를 실패시키지 않는다.
2. 서버 프로세스 안의 워커(`app/main.py` lifespan, `NOTION_SYNC_INTERVAL_SECONDS`마다, 기본 5초, 0이면 끔)가 대기 요청을 꺼내 Task와 지금 연결을 보고 Notion에 페이지를 만들거나(POST) 고친다(PATCH). Task의 Notion 기록(`notion_page_id`·`notion_database_id`·`notion_synced_version`)은 워커만 고친다.

`Integration(provider="notion")` 행이 없으면 워커가 요청을 건너뛴다. 연동은 선택 사항이다. 행은 있는데 `provider_channel_id`(대상 데이터베이스 ID)가 비었거나(DB를 찾는 중이거나 연결이 실패함) `access_token`이 비었으면(토큰 갱신이 거절됨) 요청을 꺼내지 않고 두었다가, DB와 토큰이 모두 생기면 처리한다.

> [!WARNING]
> 워커는 프로세스당 하나만 도는 것을 전제로 한다. uvicorn 워커를 여러 개 띄우면 안 된다.

## 동기화 동작

- Task 응답의 `notion_sync_status`는 `pending`(반영 대기) · `synced` · `failed` · `null`(미연동)이다.
- 429·409·5xx·네트워크 오류는 지수 백오프(10초~10분, `Retry-After` 우선)로 최대 5회 다시 시도한다. 400·403·404는 바로 `failed`, 401은 아래 [토큰 갱신](#토큰-갱신-401)을 한다.
- 항상 Task의 현재 값 전체를 보내고 `notion_synced_version`에 보낸 버전을 기록하므로 같은 Task에 요청이 여러 줄 있어도 된다. 지금 버전이 지금 DB에 이미 반영됐으면 Notion을 부르지 않고 건너뛴다(`skipped`).
- 페이지를 보낸 DB를 `notion_database_id`에 함께 기록한다. 연결된 DB가 이와 다르면 옛 페이지는 쓰지 않고 지금 DB에 새로 만든다. 새 DB가 붙으면(`notion_sync.enqueue_workspace_sync`) 워크스페이스의 모든 Task에 요청을 하나씩 쌓고, 옛 DB의 페이지는 지우지 않는다.
- POST 직전에 `notion_create_attempted_at`을 커밋해 둔다. 결과를 모른 채 끝나면 다음 시도는 POST를 반복하지 않고 `Task ID` 속성으로 지금 DB에서 페이지를 먼저 조회한다.
- `in_progress`로 5분 넘게 남은 요청은 다시 대기열로 돌린다.
- `POST /api/v1/tasks/{task_id}/notion-sync/retry`는 `failed` 요청의 재시도 횟수를 초기화해 다시 대기열에 넣는다. Task의 지금 버전이 지금 DB에 이미 반영됐으면 거절한다.
- 끝난(`done`·`skipped`·`failed`) 요청은 지우지 않는다. Notion을 쓰지 않는 워크스페이스도 Task를 고칠 때마다 한 줄씩 쌓인다.

## 토큰 갱신 (401)

Notion이 401을 돌려주면 `integration`의 `refresh_token`으로 토큰을 한 번 갱신한다(`notion_sync._refresh_token`).

- 갱신하면 새 `access_token`·`refresh_token`을 바로 커밋하고 기다리지 않고 다시 보낸다. 마지막(5번째) 시도에서 갱신했으면 한 번 더 보낸다.
- 저장된 토큰이 실패한 토큰과 다르면(그 사이 다시 연결함) 갱신하지 않고 다시 보낸다.
- 갱신이 거절되거나(`invalid_grant`) `refresh_token`이 없으면 토큰 두 개를 비우고 DB ID는 남긴다. 연동 조회가 `revoked`가 되고, 요청은 시도로 세지 않고 다시 연결할 때까지 기다린다. 다시 연결할 때 기존 페이지를 고르면 남겨 둔 DB를 이어 쓰고, 템플릿을 복제하면 새 DB로 옮긴다([다시 연결](#다시-연결)).
- 네트워크·5xx·`invalid_client`·환경변수 누락은 토큰을 그대로 두고 백오프로 다시 시도한다.
- 갱신 응답을 받지 못했는데(타임아웃) Notion은 이미 새 토큰을 발급했다면, 옛 `refresh_token`만 남아 다음 갱신이 거절되고 다시 연결해야 할 수 있다.

## 지운 Task

지울 때(`tasks.delete_task`)도 버전을 올리고 요청을 쌓는다. 워커는 지금 DB에 페이지가 있으면 보관(`archived: true`)하고, 없으면 만들지 않는다. 결과를 모르는 POST가 있었으면 조회한 뒤 보관한다.

- 보관 요청이 400·404로 거부되면 페이지를 다시 읽어(`GET /pages/{id}`) `archived`나 `in_trash`가 참일 때만 보관된 것으로 본다. 400은 요청 검증 오류, 404는 연결에 공유되지 않은 페이지일 수도 있어서다.
- 확인하지 못하면(보관되지 않았거나 읽을 수 없으면) 원래 오류와 함께 `failed`로 남겨 원인을 보고 재시도(`POST /tasks/{id}/notion-sync/retry`)할 수 있게 한다. 다시 읽다가 5xx·네트워크 오류가 나면 평소처럼 다시 시도한다.
- 페이지를 만들려던 요청을 처리하는 중에 Task가 지워지면 POST 직전에 다시 읽어 만들지 않고 건너뛴다. 새 DB가 붙어도 지운 Task에는 요청을 쌓지 않는다(#232).

## Notion 연결 (OAuth)

PM이 온보딩에서 Notion을 연결하면 `Integration` 행(토큰 + 대상 DB ID)이 생긴다.

1. 프론트가 `GET /api/v1/workspaces/{workspace_id}/integrations/notion/start?state=<돌아올 앱 경로>`로 이동한다. PM만 통과하고, 서명한 state와 짝 쿠키(`notion_oauth_nonce`)를 만들어 Notion 허용 화면으로 보낸다.
2. PM이 Notion에서 "템플릿 사용"을 고르고 허용하면 Notion이 우리 템플릿을 PM 워크스페이스에 복제한다. 다시 연결할 때는 쓰던 DB가 든 기존 페이지를 골라 이어 쓸 수도 있다.
3. Notion이 `GET /api/v1/integrations/notion/callback`으로 돌려보낸다. state·짝 쿠키·로그인 사용자·PM 여부를 확인하고 토큰을 저장한 뒤 바로 `<앱 경로>?oauth=notion&oauth_result=success`로 보낸다.
4. 템플릿 복제는 10초 남짓 걸려서, 응답 뒤에 서버가 Notion DB 찾기 작업을 따로 돌린다(`app/services/notion_connect.py`, FastAPI `BackgroundTasks`). 2초마다 복제 페이지를 보고(최대 60초) DB를 찾아 속성을 확인한 뒤 `provider_channel_id`에 저장하면 워커가 반영하기 시작한다. 그동안 `GET /api/v1/workspaces/{workspace_id}/integrations`의 notion은 `connecting`이다.

callback은 고정 경로다. Notion에 등록하는 redirect URI는 한 글자도 달라질 수 없어 workspace_id를 넣지 못하고, 워크스페이스는 서명한 state에서 꺼낸다.

- 결과는 항상 앱 화면으로의 302다. `oauth_result`는 `success` · `cancelled`(허용 화면에서 취소) · `failed`이고 JSON 오류를 보이지 않는다.
- 허용 화면에서 기존 페이지를 골랐는데(Notion이 이 선택지를 숨길 수 없다) 이어 쓸 DB가 없으면(처음 연결이거나 DB ID가 비어 있음) 저장하지 않고 `failed`다. 쓰던 DB가 있으면 [다시 연결](#다시-연결)대로 한다.
- state는 HMAC 서명(10분 만료)이고 짝 쿠키로 한 번만 쓰인다. callback에서 로그인 사용자와 PM 여부를 다시 확인한다. code·state·토큰은 로그에 남기지 않는다.

### 연동 조회 상태

| notion 상태 | 조건 |
|---|---|
| `not_connected` | 행이 없다 |
| `connected` | DB ID와 토큰이 있다 |
| `revoked`("Notion 연결 끊김") | DB ID가 있는데 토큰을 비웠다(토큰 갱신 거절) |
| `connecting`("Notion 준비 중") | DB ID가 없고, 토큰이 있고, 행이 마지막으로 바뀐 지 2분(DB 찾기 상한 60초 + 여유, `NOTION_CONNECTING_TIMEOUT`) 안이다 |
| `revoked`("Notion DB 연결 실패") | DB ID가 없고, 토큰을 비웠거나 2분이 넘었다 |

찾는 사이 만든 Task도 DB가 붙으면 반영된다.

### 다시 연결

PM이 허용 화면에서 고른 방식대로 대상 DB를 정한다.

- 템플릿 복제: 쓰던 DB를 확인하지 않고 DB ID를 비운 뒤 새 사본에서 DB를 찾는다(그동안 `connecting`). 새 DB가 붙으면 모든 Task가 새 DB에 새로 만들어지고, 예전 DB의 페이지는 더 이상 갱신되지 않는다. 새 DB 찾기가 실패하면 예전 DB로 돌아갈 수 없어 템플릿을 다시 복제해야 한다.
- 기존 페이지: 쓰던 DB를 새 토큰으로 읽어 보고, 읽히고 속성이 맞으면 토큰만 바꾼다. 고른 페이지에 그 DB가 없거나(403·404) 속성이 다르면, 또 Notion이 잠깐 응답하지 못해도 아무것도 바꾸지 않고 `failed`다.

### DB 찾기 실패와 서버 재시작

- 60초 안에 DB를 못 찾거나, 템플릿에 DB가 없거나, 속성이 다르면 행은 두고 토큰만 비워 연동 조회가 바로 `revoked`가 된다. 템플릿을 복제해 다시 연결하면 callback이 새 토큰을 채운다. 이유는 경고 로그(`Notion 대상 DB 연결 실패 … result=…`)로 남는다.
- DB를 붙이며 Task 요청을 쌓다 오류가 나면 DB 저장도 함께 되돌려져 2분 뒤 `revoked`가 된다.
- 작업 도중 서버가 꺼지면 토큰만 있는 행이 남는다. 2분이 지나면 `revoked`로 보이고, 템플릿을 복제해 다시 연결하면 callback이 그 행을 덮어쓴다.

## 환경변수와 개발자 페이지 설정

`.env.example`을 참고한다.

| 이름 | 값 |
|---|---|
| `NOTION_CLIENT_ID`, `NOTION_CLIENT_SECRET` | Notion 개발자 페이지의 Public connection → Configuration 탭. 워커의 토큰 갱신에도 쓰고, 없으면 401 때 갱신하지 못하고 error 로그를 남긴다 |
| `NOTION_REDIRECT_URI` | 프론트와 같은 주소의 callback. 로컬 `http://localhost:5173/api/v1/integrations/notion/callback`(Vite 프록시가 백엔드로 넘긴다), 운영 `https://<서비스 주소>/api/v1/integrations/notion/callback` |
| `OAUTH_STATE_SECRET` | state 서명 키, 32자 이상. 없으면 연결 시작이 `failed`가 된다. 가입 이메일 증명과 카카오 로그인도 쓴다 |

`OAUTH_STATE_SECRET`은 `python3 -c "import secrets;print(secrets.token_urlsafe(48))"`로 만든다. Notion 개발자 페이지(Public connection)에서는 Redirect URI에 `NOTION_REDIRECT_URI`와 같은 값을 등록하고, "Notion URL for optional template"에 웹에 게시한 템플릿 페이지 주소를 넣는다.

## 템플릿 규칙

어긋나면 [Notion 연결 (OAuth)](#notion-연결-oauth) 4번에서 연결이 실패한다(`revoked`, `notion.verify_database_schema`).

- "회의 Task" 같은 페이지 바로 아래에 데이터베이스를 둔다. 열·토글 안에 넣으면 찾지 못한다.
- 속성 이름과 종류는 `app/services/notion.py`의 `DATABASE_SCHEMA`와 맞춘다. Name/title, Status/select, Assignee/rich_text, Due Date/date, Blocker/rich_text, Task ID/rich_text다. 예전 템플릿의 Progress 속성은 있어도 되고 워커가 쓰지 않는다.
- Status 선택지에 `todo`·`in_progress`·`blocked`·`done`이 있어야 한다(색은 자유).
- 속성·선택지를 더 넣거나 뷰·아이콘을 꾸미는 것은 자유다. 샘플 행은 복제되므로 지운다.
- 템플릿이 클수록 복제가 오래 걸려 60초를 넘길 수 있다.

## OAuth 없이 시험하기

`Integration` 행을 직접 만든다. 해당 Notion 연결이 그 데이터베이스에 공유돼 있어야 한다.

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
