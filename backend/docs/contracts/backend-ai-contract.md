# 백엔드 ↔ AI(녹음 봇) 계약

디스코드 녹음 봇이 회의를 백엔드에 넘길 때 쓰는 API를 현재 코드 기준으로 정리한다. 웹 화면이 쓰는 API는 [프론트엔드 대표 계약](../../../frontend/docs/contracts/frontend-api-contract.md)에 있고 여기서 다시 적지 않는다.

- 제공자: Backend (`backend/app/api/`)
- 소비자: AI 녹음 봇 (`ai/capture/handoff.py`의 `BeClient`·`Handoff`, 판단 파이프라인 `ai/judge/pipeline.py`)
- 기준: 2026-10-08 develop 코드 대조
- 합의 근거: 인계 방식은 [AI 결정 0009](../../../ai/decision_log/0009-bot-hands-off-to-be-api.md), 발화 저장은 [AI 결정 0017](../../../ai/decision_log/0017-transcript-sources-stage.md)에 AI 쪽 기록이 있다. 이 문서는 그 이후의 필드·오류 세부를 코드에서 읽은 것이며, 별도 합의 문서가 없는 항목은 구현 사실로만 적는다.

## 공통

- 경로 prefix는 `/api/v1`이고 응답은 백엔드 공통 봉투 `{data, error}`다 ([Backend README 응답 형식](../../README.md#응답-형식)).
- 봇은 `error.code`로 분기한다. 봉투가 아닌 응답이나 4xx·5xx는 `HTTP_<status>`로 다룬다 (`BeClient._call`).
- 봇의 연결 설정은 `ai/.env`의 `BE_BASE_URL`, `BE_WORKSPACE_ID`, 서비스 토큰이다. `BE_BASE_URL`과 `BE_WORKSPACE_ID`가 없으면 인계 단계를 건너뛴다 (`handoff.from_env`).
- 봇은 아직 워크스페이스 하나(`BE_WORKSPACE_ID`)로만 회의를 보낸다. 디스코드 서버로 워크스페이스를 찾는 조회는 없다.

## 호출 순서

| 시점 | 요청 | 회의 상태 | 인증 |
|---|---|---|---|
| `/record` 직후 | `POST /meetings` | `created` | 없음 |
| 트랙을 닫은 뒤 | `PATCH /meetings/{meeting_id}/end` | `processing` | 없음 |
| 전사가 닫힌 뒤 | `POST /meetings/{meeting_id}/sources` | 변화 없음 | `X-Service-Token` |
| 추출 도중 (항목마다) | `POST /workspaces/{workspace_id}/tasks/similar` | 변화 없음 | `X-Service-Token` |
| 추출이 끝난 뒤 | `POST /extractions` | `done` | 없음 |
| 어느 단계든 실패 | `PATCH /meetings/{meeting_id}/fail` | `failed` | 없음 |

봇은 회의 상세 `GET /meetings/{meeting_id}`를 부르지 않는다.

## 인증

- `X-Service-Token`: 발화 저장과 유사 task 검색에만 건다 (`deps.require_service_token`). 헤더 값을 서버의 `SERVICE_TOKEN`과 비교하고, 없거나 다르면 401 `UNAUTHENTICATED`다. 서버에 `SERVICE_TOKEN`이 비어 있으면 모든 요청을 거절한다.
- 회의 생성·종료·실패와 추출 등록은 사용자 세션도 서비스 토큰도 확인하지 않는다. 운영에서는 리버스 프록시가 외부 접근을 막는다 ([Backend README 권한](../../README.md#권한)). 이 경로들에 서비스 토큰을 걸지는 정해지지 않았다.

## 회의

### `POST /meetings` → 201

```jsonc
// 요청
{ "workspace_id": "…", "title": "…" | null, "source": "discord" }   // source: discord | manual_upload, 기본 discord
// data
{ "meeting_id": "…", "workspace_id": "…", "status": "created", "started_at": "…" }
```

봇은 `meeting_id`를 매니페스트 `be.meeting_id`에 남기고 이후 모든 단계의 재시도 키로 쓴다.

### `PATCH /meetings/{meeting_id}/end` → 202

- `data`: `{meeting_id, status: "processing", ended_at}`
- 이미 `processing`·`done`·`failed`면 409 `MEETING_ALREADY_ENDED`, `details.status`에 지금 상태. 봇은 이 값을 지금 상태로 받아들이고 계속한다.
- 없는 회의는 404 `MEETING_NOT_FOUND`.

### `PATCH /meetings/{meeting_id}/fail` → 200

- 요청: `{ "failed_stage": "stt" | "extract" | "handoff" … }` (서버는 문자열만 확인)
- `data`: 회의 상세 모양 `{meeting_id, workspace_id, title, status: "failed", started_at, ended_at, extraction_id: null, failed_stage, progress}`
- `done`·`failed`가 아닌 회의만 조건부 UPDATE로 `failed`가 된다. 이미 끝났으면 409 `MEETING_ALREADY_ENDED`이고, 봇은 이를 "이미 처리됨"으로 넘어간다. 추출 등록이 먼저 `done`으로 바꾼 회의를 늦은 실패 요청이 덮지 않는다.

## 발화 저장 `POST /meetings/{meeting_id}/sources` → 201

AI `Transcript.to_dict()` 모양에 화자 이름을 더해 보낸다. 한 회의의 전사를 나눠 보내도 된다.

```jsonc
// 요청
{
  "source": "meeting",                       // meeting만 받는다
  "segments": [
    { "speaker": "<Discord uid>" | null, "start": 0.0, "end": 3.2, "text": "…", "seq": 0 }
  ],
  "speaker_names": { "<Discord uid>": "<표시 이름>" } | null
}
// data
{ "meeting_id": "…", "inserted": 1, "skipped": 0, "duration_ms": 3200 | null }
```

| 항목 | 동작 |
|---|---|
| 시각 | 초 단위, 0 이상 24시간 이하, `end >= start` |
| `seq` | 0 이상 int4 범위. 한 요청 안에서 겹치면 400. 사이가 비어도 된다 |
| 재전송 | `(meeting_id, seq)`가 이미 있으면 덮어쓰지 않고 건너뛴다 (`skipped`). 같은 seq의 `speaker_names`도 다시 반영하지 않으므로 처음 보낼 때 같이 보낸다 |
| 화자 | 빈 문자열은 null. uid로 그 워크스페이스 팀원을 찾아 `member_id`를 채운다. 이름이 uid와 같으면 이름을 버린다 |
| `duration_ms` | 저장된 발화 전체의 `end_ms` 최댓값 |
| 상태 | `done` 회의도 받는다. `failed` 회의는 409 `MEETING_FAILED` (`MEETING_ALREADY_ENDED`와 다르다. 저장되지 않았으니 새 회의로 다시 올려야 한다) |

## 유사 task 검색 `POST /workspaces/{workspace_id}/tasks/similar` → 200

```jsonc
// 요청
{ "text": "…", "k": 3, "min_similarity": 0.4 }      // k 1~20, min_similarity 0.0~1.0. 봇은 text만 보내 기본값을 쓴다
// data
{ "items": [
  { "task_id": "…", "notion_page_id": "…" | null, "title": "…", "content_snippet": "",
    "assignee_member_id": "…" | null, "due_date": "YYYY-MM-DD" | null, "status": "…",
    "similarity": 0.83, "updated_at": "…" }
] }
```

- 항목 필드는 AI `NotionCandidate`(`ai/shared/schemas.py`)와 이름을 맞춘다. `content_snippet`은 지금 항상 빈 문자열이다.
- 같은 워크스페이스에서 임베딩이 있는 task만 유사도 순으로 돌려준다.
- 없는 워크스페이스는 404 `WORKSPACE_NOT_FOUND`. 임베딩 호출 실패는 빈 목록이 아니라 502 `EMBEDDING_UNAVAILABLE`이다. 봇도 실패를 빈 목록으로 바꾸지 않는다.

## 추출 등록 `POST /extractions` → 201

```jsonc
// 요청
{
  "meeting_id": "…", "workspace_id": "…",
  "transcript_path": "…" | null, "model_name": "…" | null,
  "items": [ {
    "action": "create" | "update",            // 기본 create
    "target_task_id": "…" | null,             // update일 때 수정할 task
    "task_title": "…" | null,                 // create면 필수
    "task_confidence": 0.0,
    "assignee_raw": "…" | null, "assignee_type": "first" | "second" | "thirdname" | "group" | "none" | null,
    "due_date": "YYYY-MM-DD" | null, "due_raw": "…" | null, "due_confidence": 0.0,
    "evidence_quote": "…" | null, "evidence_speaker": "<Discord uid>" | null, "evidence_at_ms": 0 | null,
    "category": "schedule" | "assignee" | "scope" | "decision" | null,
    "status": "todo" | "in_progress" | "blocked" | "done" | null,
    "doc_text": "…" | null,
    "target_snapshot": { "updated_at": "…", "due_date": "…", "status": "…", "assignee_member_id": "…" } | null
  } ]
}
// data
{ "extraction_id": "…", "meeting_id": "…", "item_count": 2 }
```

| 항목 | 동작 |
|---|---|
| 선점 | `processing` → `done`을 조건부 UPDATE로 한 번만 처리한다 |
| 멱등 | 이미 `done`이고 추출이 있으면 기존 `extraction_id`와 항목 수를 그대로 돌려준다. 봇의 복구 재전송이 중복을 만들지 않는다 |
| 상태 오류 | `processing`이 아니면 409 `MEETING_NOT_PROCESSING`. 회의가 없으면 404 `MEETING_NOT_FOUND`, 워크스페이스가 다르면 400 `WORKSPACE_MISMATCH` |
| 담당자 | `assignee_type`이 `first`면 `evidence_speaker` uid로 `Member.discord_user_id`를 찾고, 그 외에는 `assignee_raw`를 별칭으로 매칭한다 |
| 잘못된 항목 | update의 대상이 없거나 다른 워크스페이스 task, create의 제목이 비어 있으면 그 항목만 건너뛴다. `item_count`는 저장된 항목 수 |
| update 처리 | 게이트·승인 생성 규칙과 `target_snapshot`의 충돌 기준값은 [Backend README 유사 task 검색과 AI 판단 접수](../../README.md#유사-task-검색과-ai-판단-접수)를 따른다 |

## 오류 코드 요약

| 코드 | HTTP | 나오는 경로 | 봇 처리 |
|---|---|---|---|
| `UNAUTHENTICATED` | 401 | sources, tasks/similar | 실패 |
| `MEETING_NOT_FOUND` | 404 | end, fail, sources, extractions | 실패 |
| `WORKSPACE_NOT_FOUND` | 404 | tasks/similar | 실패 |
| `WORKSPACE_MISMATCH` | 400 | extractions | 실패 |
| `MEETING_ALREADY_ENDED` | 409 | end, fail | 지금 상태로 보고 계속 |
| `MEETING_FAILED` | 409 | sources | 실패 |
| `MEETING_NOT_PROCESSING` | 409 | extractions | 실패 |
| `EMBEDDING_UNAVAILABLE` | 502 | tasks/similar | 실패 (빈 목록으로 바꾸지 않음) |
| `INVALID_REQUEST` | 400 | 요청 검증 실패 전부 | 실패 |

## 코드 근거

- Backend: `app/api/meetings.py`, `app/api/sources.py`, `app/api/similar_tasks.py`, `app/api/extractions.py`, `app/api/deps.py`의 `require_service_token`, `app/schemas/meeting.py`, `app/schemas/source.py`, `app/schemas/task.py`
- AI: `ai/capture/handoff.py`의 `BeClient`, `Handoff`, `from_env`
