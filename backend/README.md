# Backend

회의 → 추출 → 매칭 → 게이트 → 승인 파이프라인 백엔드. FastAPI + SQLAlchemy + Alembic.

## 실행

```bash
uv venv --python 3.12 .venv
uv pip install -r requirements.txt
cp .env.example .env            # 기본값(SQLite)만으로 바로 실행 가능

./run.sh                        # alembic upgrade head + uvicorn --reload
```

서버가 뜨면 `http://localhost:8000` 기준으로:

| 경로 | 용도 |
|---|---|
| `/docs` | Swagger UI — 엔드포인트별 요청/응답 스키마를 보고 바로 호출해볼 수 있다 |
| `/redoc` | ReDoc — 읽기 전용으로 훑어볼 때 |
| `/openapi.json` | 원본 OpenAPI 스펙 (Postman 등으로 임포트할 때) |

**프론트엔드는 API 명세를 여기(`/docs`)에서 확인하는 게 기준입니다.** 코드가 바뀌면
자동으로 갱신되므로, 이 문서에 엔드포인트 목록을 따로 손으로 옮겨 적지 않습니다.

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
| `TASK_HISTORY_ALREADY_ROLLED_BACK` | 409 | 이미 되돌린 변경을 다시 되돌리려 함 |
| `AUDIO_UPLOAD_FAILED` | 422 | 오디오 저장·병합 실패 *(아직 미구현 경로)* |
| `AUDIO_FORMAT_UNSUPPORTED` | 422 | 지원하지 않는 오디오 형식 *(아직 미구현 경로)* |
| `TRANSCRIPTION_FAILED` | 502 | 음성 전사 실패 *(아직 미구현 경로)* |
| `EXTRACTION_FAILED` | 502 | 회의 분석 실패 *(아직 미구현 경로)* |
| `NOTION_WRITE_FAILED` | 502 | Notion 페이지 생성/갱신 실패 *(Task API는 더 이상 내려주지 않음 — 아래 Notion 연동 참고)* |
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

OAuth 연결 화면(`GET/POST .../integrations/notion/start`·`/callback`)은 아직
없다. 로컬에서 Upsert를 테스트하려면 `Integration` 행을 직접 만든다:

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

대상 Notion 데이터베이스에는 `app/services/notion.py`의 `PROPERTY_NAMES`와
이름이 같은 속성(Name/title, Status/select, Assignee/rich_text, Due Date/date,
Progress/number, Blocker/rich_text, **Task ID/rich_text**)이 있어야 하고, 해당 Integration이 그
데이터베이스에 공유돼 있어야 한다.

## 아직 없는 것

로그인/인증, Discord 봇 연동, Notion OAuth 연결 화면, 오디오 업로드·스트리밍, 메시지 로그.
현재 모든 엔드포인트는 `member_id`를 요청 바디/쿼리로 그대로 받는다 (예:
`resolved_by`, `changed_by`) — PM 본인 확인 없이도 호출 가능한 상태이니 그렇게 알고 써야 한다.
