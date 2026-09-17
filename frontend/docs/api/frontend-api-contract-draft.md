# 프론트엔드 API 계약 (가정 명세)

작성일 2026-09-17. 개발 계획의 **M1-A** 산출물이다.

이 문서는 합의된 계약이 아니라 **프론트엔드가 가정한 명세**다 (D-159).
화면과 MSW 핸들러, `entities` 계층의 타입이 모두 이 문서를 근거로 삼는다.

- **기존 구현**(§2)은 `backend/app` 의 코드를 읽고 적은 **사실**이다.
- **신규 가정**(§3)은 백엔드에 요청한 내용이며 실제 API 와 다를 수 있다.
- 백엔드에 넘기는 요청 문서는 `frontend/docs/plan/backend-alignment.md` 다.

> **한 번 적은 요청·응답을 화면 사정으로 임의로 바꾸지 않는다.**
> 바꾸면 MSW 픽스처와 통합 테스트가 함께 흔들린다.

---

## 1. 공통 규약

| 항목 | 값 |
|---|---|
| prefix | `/api/v1` |
| 표기법 | `snake_case` |
| 날짜 | `YYYY-MM-DD` (예: `due_date`) |
| 시각 | ISO 8601 (예: `created_at`). 날짜와 **형식으로 구분한다** (D-144) |
| 목록 | `{"items": [...], "total": N}` |
| 인증 | Secure·HttpOnly 쿠키. `withCredentials: true` 만 설정한다 (D-165) |

### 응답 봉투

성공과 실패가 같은 껍데기를 쓴다. `entities` 계층에서 `data` 만 벗겨 도메인 모델로 변환한다.

```jsonc
// 성공
{"data": { }, "error": null}

// 실패
{"data": null,
 "error": {"code": "MEETING_NOT_FOUND",
           "message": "해당 회의 세션을 찾을 수 없습니다.",
           "details": {"meeting_id": "mt_01"}}}
```

`error.message` 는 한국어로 내려온다. 토스트에 그대로 쓸 수 있다.

### 구현된 오류 코드

`backend/app/core/errors.py` 기준. 괄호 안은 HTTP 상태 코드다.

```
INVALID_REQUEST(400)            MEETING_NOT_FOUND(404)
MEETING_ALREADY_ENDED(409)      AUDIO_UPLOAD_FAILED(422)
AUDIO_FORMAT_UNSUPPORTED(422)   TRANSCRIPTION_FAILED(502)
EXTRACTION_FAILED(502)          EXTRACTION_NOT_FOUND(404)
APPROVAL_NOT_FOUND(404)         NOTION_WRITE_FAILED(502)
INTERNAL_ERROR(500)
```

신규 API 에서 쓸 코드는 `backend-alignment.md` §1 에 적었다.

---

## 2. 기존 구현

**이 절은 사실이다.** 구현 시점 기준이며, Swagger 의 응답 스키마가 `object` 로만 노출되므로(핸들러가 `dict` 를 반환한다) 형태는 `backend/app/schemas/` 에서 확인한 값이다.

### 2.1 meetings — 봇 경로

| Method | Path | 응답 |
|---|---|---|
| POST | `/api/v1/meetings` | 201 |
| PATCH | `/api/v1/meetings/{meeting_id}/end` | 202 |
| GET | `/api/v1/meetings/{meeting_id}` | 200 |

```jsonc
// POST  요청 {"workspace_id", "title"?, "source"?}   source: discord | manual_upload (기본 discord)
//       응답 {"meeting_id", "workspace_id", "status", "started_at"}

// PATCH /{meeting_id}/end   본문 없음
//       응답 {"meeting_id", "status", "ended_at"}
//       이미 종료된 회의면 409 MEETING_ALREADY_ENDED

// GET /{meeting_id}
{"meeting_id": "mt_09", "workspace_id": "ws_01", "title": "3주차 정기회의",
 "status": "done",
 "started_at": "2026-09-15T14:00:00Z", "ended_at": "2026-09-15T14:45:00Z",
 "progress": {"audio_merged": true, "transcribed": true, "extracted": true},
 "extraction_id": "ex_01",
 "failed_stage": null}
```

- `status` 는 `created` → `recording` → `processing` → `done` \| `failed`.
- **`extraction_id` 는 `status` 가 `done` 일 때만 채워진다.** 그 전에는 `null` 이다.
- 진행률 UI 는 `progress` 의 boolean 3개로 그린다.

### 2.2 extractions

| Method | Path | 비고 |
|---|---|---|
| POST | `/api/v1/extractions` | **AI 파이프라인이 호출한다.** 프론트엔드는 사용하지 않는다 |
| GET | `/api/v1/extractions/{extraction_id}` | 조회 |

```jsonc
// GET /api/v1/extractions/{extraction_id}
{"extraction_id": "ex_01", "meeting_id": "mt_09",
 "items": [
   {"item_id": "it_01",
    "task": {"title": "로그인 API 연동", "confidence": 0.9},
    "assignee": {"raw": "민수", "member_id": null, "display_name": null,
                 "confidence": 0.3, "needs_check": true},
    "due_date": {"value": "2026-09-20", "raw": "다음 주 월요일", "confidence": 0.8},
    "confidence": 0.3,
    "gate": "hold",
    "evidence": {"quote": "...", "speaker": "김서연", "at_ms": 125000}}]}
```

- `confidence` 는 `min(task, assignee, due)` 로 계산된다.
- `gate` 는 `auto`(≥0.8) / `review`(≥0.5) / `hold`. 임계값은 `app/services/matching.py` 에 있다.
- `assignee.needs_check` 가 `true` 면 담당자가 확정되지 않은 상태다. `member_id` 와 `display_name` 이 `null` 이므로 **`raw` 문자열로 대체 표시한다.**

### 2.3 approvals

**`확인 필요` 화면이 사용하는 리소스다** (D-161).

| Method | Path | 비고 |
|---|---|---|
| POST | `/api/v1/approvals` | **AI → BE.** 프론트엔드는 사용하지 않는다 |
| GET | `/api/v1/approvals?workspace_id=...&status=...` | `workspace_id` 필수 |
| GET | `/api/v1/approvals/{approval_id}` | 단건 |
| PATCH | `/api/v1/approvals/{approval_id}` | 승인·반려 |

```jsonc
// GET /api/v1/approvals?workspace_id=ws_01&status=pending
{"items": [
   {"approval_id": "ap_01", "workspace_id": "ws_01",
    "type": "task_create",
    "payload": { },
    "related_task_id": null,
    "requested_by": null,
    "status": "pending",
    "resolved_by": null,
    "created_at": "2026-09-15T06:00:00Z",
    "resolved_at": null}],
 "total": 3}

// PATCH /api/v1/approvals/{approval_id}
// 요청 {"status": "approved" | "rejected", "resolved_by": "<PM member_id>"}
// 이미 처리된 건이면 400 + "이미 처리된 승인 요청입니다." + details.current_status
```

- `type` 은 `task_create` / `task_update` / `reminder_dm`.
- `requested_by` 가 `null` 이면 AI 가 자동 생성한 요청이다.
- **`payload` 는 자유 JSON 이다.** AI 파이프라인의 `DraftResult.structured`(`task`, `assignee_member_id`, `due_date`, `type`)를 따르는 것으로 가정한다. 확정 여부는 백엔드 확인 대기 중이다 (`backend-alignment.md` §5 1번).
- 목록 정렬은 `created_at` 내림차순 고정이고 페이지네이션이 없다. **대기 오래된 순(D-050)은 클라이언트에서 정렬한다.**

### 2.4 health

`GET /health` → `{"data": {"status": "ok"}, "error": null}`

---

## 3. 신규 가정

코드에 없는 부분이다. **요청과 응답의 상세는 `frontend/docs/plan/backend-alignment.md` §2 에 적었고, 이 문서에서 중복하지 않는다.** 아래는 인벤토리와 프론트엔드가 지켜야 할 규칙이다.

| 영역 | 엔드포인트 | 상세 |
|---|---|---|
| auth | signup · login · logout · me · google start/callback | §2.1 |
| workspaces | 목록 · 생성 · 상세 · 온보딩 갱신 | §2.2 |
| integrations | 상태 · start · callback · 해제 | §2.3 |
| members | 팀원 목록 · discord-users · 매핑 PUT/DELETE | §2.4 |
| meetings | 목록 · 업로드 · 진행률 · 회의록 본문 | §2.5 |
| tasks | 목록 · 상세 · PATCH | §2.6 |
| dashboard | 집계 1개 | §2.7 |
| task-history | rollback | §3 5번 |

### 지켜야 할 규칙

- **OAuth 는 302 리다이렉트로 받는다.** 프론트엔드는 `window.location.assign` 만 하고 `state` 에 복귀 경로를 담는다 (D-158).
- **`확인 필요` 는 태스크가 아니라 승인 요청이다.** 식별자는 `approval_id` 이고 URL 은 `/workspaces/:workspaceId/approvals/:approvalId` 다 (D-161, D-162).
- **`전체` 탭만 클라이언트에서 병합한다.** 확인 필요를 대기 오래된 순으로 상단 고정하고, 아래에 태스크를 마감일 순으로 둔다. 1차는 전량 조회이며 페이지네이션이 없다 (D-161).
- **대시보드는 집계 API 하나로 받는다.** 상단 숫자는 표시 개수가 아니라 워크스페이스 전체 개수다 (D-052~D-054).
- **회의 날짜는 `started_at` 이다.** 별도의 날짜 필드를 두지 않는다 (D-164).

---

## 4. 도메인 모델 (entities)

화면은 DTO 를 직접 참조하지 않는다. `entities` 계층에서만 DTO 를 다루고 변환한다 (D-133, D-134).
`pages`·`widgets`·`features` 에서 DTO 타입을 import 하지 않으며 ESLint `no-restricted-imports` 로 강제한다.

| 엔티티 | 비고 |
|---|---|
| `user` | |
| `workspace` | 온보딩 진행 상태 포함 |
| `member` | Discord 매핑 상태 포함 |
| `meeting` | `source` 로 봇·업로드를 구분한다 |
| `minutes` | 요약·전사문·반영 태스크 |
| `task` | |
| `approval` | **`확인 필요` 를 담는다.** `task` 와 별도 엔티티다 |
| `integration` | Discord·Notion 연결 상태 |

변환 단계에서 처리할 것:

- `null` 과 기본값 (D-134).
- 화자 이름 대체 — `speaker_display_name` 이 없으면 `speaker_fallback` (D-028).
- 담당자 대체 — `assignee.member_id` 가 없으면 `assignee.raw` (D-161).
- 보완 사유 파생 — `approval.payload` 의 빈 필드에서 `담당자 없음` / `마감 없음` 을 만든다.

---

## 5. MSW

- 로컬 개발·Vitest·Storybook 이 같은 핸들러를 공유한다. production 번들에서 제외한다 (D-146).
- 정상 응답이 기본이다. 빈 상태·권한 오류·검증 오류·서버 오류·느린 응답은 테스트와 Story 에서 개별 override 한다.
- 고정 ID·고정 날짜를 쓴다. 자동 테스트에 인위적 지연을 넣지 않는다.
- `onUnhandledRequest` 는 테스트에서 실패, 로컬에서 경고.

픽스처가 지켜야 할 값:

- `전체` 탭 개수가 `확인 필요 + 진행 중 + 완료` 와 맞아야 한다. 시안 기준 `13 = 3 + 7 + 3`.
- `extraction_id` 는 `status: done` 인 회의에만 존재한다.
- 일반 팀원 픽스처의 회의록 응답에는 `needs_review` 키가 **없어야** 한다 (D-104).

---

## 6. 결정 대기

제품 결정이 없어 이 문서에서 확정하지 않는다. 결정이 나오면 추가한다.

- 태스크 목록의 필터·정렬·페이지네이션 파라미터
- 보드·캘린더·간트차트 전용 조회
- 메시지 전반
- 워크스페이스 관리·설정의 개별 항목
- `전체` 탭에 페이지네이션을 도입할 시점과 방식 (도입하면 병합 개수와 정렬이 먼저 깨진다)

---

## 참고

- 백엔드 요청: `frontend/docs/plan/backend-alignment.md`
- 결정 기록: `frontend/docs/decision/frontend-decisions.md` (특히 D-160~D-165)
- 개발 계획: `frontend/docs/plan/frontend-development-plan.md`
