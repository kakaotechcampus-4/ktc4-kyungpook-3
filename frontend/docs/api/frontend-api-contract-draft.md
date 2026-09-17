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
    "payload": { },            // type 별 형태는 아래 참조
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
- 목록 정렬은 `created_at` 내림차순 고정이고 페이지네이션이 없다. **대기 오래된 순(D-050)은 클라이언트에서 정렬한다.**

#### payload — 가정

`payload` 는 구현상 자유 JSON 이다. **아래 형태를 가정하고 고정한다.** 근거는 AI 파이프라인의
`DraftResult.structured`(`ai/shared/schemas.py`)와 `ExtractedTask` 이며, 확정 여부는 백엔드 확인 대기 중이다
(`backend-alignment.md` §5 1번). **실제 형태가 다르면 `entities/approval` 의 변환만 고친다.**

```jsonc
// type: "task_create"
{"task": "로그인 API 연동",
 "assignee_member_id": null,
 "due_date": null,
 "confidence": 0.3,
 "source_sentence": "민수님이 다음 주 월요일까지 로그인 붙이기로 해요",
 "assignee_mention": "민수",
 "due_raw": "다음 주 월요일",
 "evidence": {"speaker": "김서연", "at_ms": 125000}}

// type: "task_update"   related_task_id 가 채워져 있다
{"task": "로그인 API 연동",
 "changed_field": "due_date",                  // assignee | due_date | status | title | progress | blocker
 "old_value": "2026-09-20",
 "new_value": "2026-09-27",
 "confidence": 0.6,
 "source_sentence": "로그인은 한 주 미뤄요",
 "evidence": {"speaker": "이재환", "at_ms": 430000}}

// type: "reminder_dm"
{"target_member_id": "mb_01",
 "related_task_title": "로그인 API 연동",
 "message": "로그인 API 연동 진행 상황 공유 부탁드려요",
 "reason": "no_response_72h"}                  // no_response_72h | due_soon | overdue
```

**프론트엔드가 지켜야 할 규칙**

- **보완 사유를 payload 의 빈 필드에서 파생한다.** `assignee_member_id` 가 `null` 이면 `담당자 없음`,
  `due_date` 가 `null` 이면 `마감 없음`. 서버가 사유 목록을 내려주지 않는다.
- `assignee_mention` 과 `due_raw` 는 화면에 원문 그대로 보조 표시한다. 확정 값이 아니다.
- `source_sentence` 와 `evidence` 는 근거 표시에 쓴다. 둘 다 없을 수 있다.
- 세 `type` 은 화면이 서로 다르므로 **`type` 으로 분기한 뒤 payload 를 읽는다.** 공통 필드를 가정하지 않는다.

### 2.4 health

`GET /health` → `{"data": {"status": "ok"}, "error": null}`

---

## 3. 신규 가정

코드에 존재하지 않는 부분이다. **이 절이 모든 형태의 원본이다.**
`backend-alignment.md` 는 요청 이유·제약·근거만 담고 형태는 이 절을 가리킨다. 양쪽에 같은 JSON 을 두지 않는다.

### 3.1 auth

| Method | Path | 비고 |
|---|---|---|
| POST | `/api/v1/auth/signup` | 201 |
| POST | `/api/v1/auth/login` | 200 + `Set-Cookie` |
| POST | `/api/v1/auth/logout` | 200, 본문 `null` |
| GET | `/api/v1/auth/me` | 200 |
| GET | `/api/v1/auth/google/start?state=<복귀경로>` | **302** |
| GET | `/api/v1/auth/google/callback?code=&state=` | **302** → `state` |

```jsonc
// POST /auth/signup   요청
{"email": "pm@example.com", "password": "********", "name": "최진호"}

// POST /auth/login    요청
{"email": "pm@example.com", "password": "********"}

// signup · login · me 의 응답 data 는 같다
{"user": {"user_id": "us_01", "email": "pm@example.com",
          "name": "최진호", "avatar_url": null},
 "workspace_count": 2,
 "last_workspace_id": "ws_01"}
```

- `workspace_count` 로 로그인 후 이동을 분기한다. `0` → 온보딩, `1` → 대시보드, `2` 이상 → 워크스페이스 선택 (D-010).
- `last_workspace_id` 는 없으면 `null`.
- 미인증 요청은 401 `UNAUTHENTICATED`. Axios 인터셉터가 로그인으로 보낸다.
- OAuth 는 본문 없는 302 다. `window.location.assign` 만 하고 `state` 에 복귀 경로를 담는다 (D-158).

### 3.2 workspaces

| Method | Path | 비고 |
|---|---|---|
| GET | `/api/v1/workspaces` | 선택 화면·헤더 전환기 |
| POST | `/api/v1/workspaces` | 201 |
| GET | `/api/v1/workspaces/{workspace_id}` | 앱 셸 진입 |
| PATCH | `/api/v1/workspaces/{workspace_id}/onboarding` | 단계 갱신 |

```jsonc
// GET /workspaces
{"items": [{"workspace_id": "ws_01", "name": "카테캠 3팀",
            "role": "pm",
            "onboarding_completed": false,
            "created_at": "2026-09-15T04:00:00Z"}],
 "total": 2,
 "last_workspace_id": "ws_01"}

// POST /workspaces   요청 — 이름 하나뿐이다 (D-014, D-153)
{"name": "카테캠 3팀"}

// GET /workspaces/{workspace_id}
{"workspace_id": "ws_01", "name": "카테캠 3팀", "role": "pm",
 "onboarding": {
   "completed": false,
   "current_step": "connect_notion",
   "steps": [{"step": "create_workspace", "status": "completed"},
             {"step": "connect_discord",  "status": "skipped"},
             {"step": "connect_notion",   "status": "pending"},
             {"step": "connect_members",  "status": "pending"}]},
 "integrations": {"discord": "not_connected", "notion": "not_connected"}}

// PATCH /workspaces/{workspace_id}/onboarding   요청
{"step": "connect_discord", "action": "skip"}     // action: skip | complete
// 응답 — 갱신된 onboarding 객체 (위 GET 의 onboarding 과 같은 형태)
```

- `role` 은 `pm` \| `member`. 워크스페이스마다 다르므로 세션이 아니라 여기서 받는다 (D-165).
- `step` 은 `create_workspace` \| `connect_discord` \| `connect_notion` \| `connect_members`, 순서 고정 (D-008).
- `status` 는 `pending` \| `completed` \| `skipped`. 건너뛴 단계는 재개 대상에서 제외한다 (D-012).
- `current_step` 은 재개 지점이다. `completed: true` 면 `null`.
- 이름 중복은 409 `WORKSPACE_NAME_DUPLICATED`, 글자 수 초과는 `details.max_length` 동반 (D-015~D-020).
- 온보딩 미완료 워크스페이스의 대시보드 접근은 403 `ONBOARDING_INCOMPLETE` + `details.current_step` (D-071).

### 3.3 integrations

| Method | Path | 비고 |
|---|---|---|
| GET | `/api/v1/workspaces/{workspace_id}/integrations` | 상태 |
| GET | `/api/v1/workspaces/{workspace_id}/integrations/{provider}/start?state=` | **302** |
| GET | `/api/v1/workspaces/{workspace_id}/integrations/{provider}/callback` | **302** → `state` |
| DELETE | `/api/v1/workspaces/{workspace_id}/integrations/{provider}` | 해제 |

`provider` 는 `discord` \| `notion`. 워크스페이스당 각 1개 (D-021, D-022).

```jsonc
// GET .../integrations
{"discord": {"status": "connected",
             "display_name": "카테캠 3팀 서버",
             "connected_at": "2026-09-15T05:00:00Z"},
 "notion":  {"status": "not_connected",
             "display_name": null,
             "connected_at": null}}
```

- `status` 는 `not_connected` \| `connected` \| `revoked`.
  **`not_connected` 와 `revoked` 는 다른 모달을 띄운다** — 미연결은 `Notion 연결이 필요해요`(D-097), 끊김은 `Notion 연결이 끊어졌어요`(D-100).
- 연결 요청에 본문이 없다. 데이터베이스 선택·속성 매핑 화면을 만들지 않는다 (D-154).

### 3.4 members · Discord 매핑

| Method | Path | 비고 |
|---|---|---|
| GET | `/api/v1/workspaces/{workspace_id}/members` | 담당자·참석자 선택 |
| GET | `/api/v1/workspaces/{workspace_id}/discord-users` | 팀원 연결 화면 |
| PUT | `/api/v1/workspaces/{workspace_id}/discord-users/{discord_user_id}/mapping` | 매핑 |
| DELETE | `/api/v1/workspaces/{workspace_id}/discord-users/{discord_user_id}/mapping` | 해제 |

```jsonc
// GET .../members
{"items": [{"member_id": "mb_01", "display_name": "김서연",
            "role": "member", "active": true}],
 "total": 5}

// GET .../discord-users
{"items": [{"discord_user_id": "1123...", "discord_username": "seoyeon_01",
            "member_id": "mb_01", "member_display_name": "김서연", "active": true},
           {"discord_user_id": "1124...", "discord_username": "jaehwan_dev",
            "member_id": null, "member_display_name": null, "active": true}],
 "total": 7,
 "mapped_count": 4}

// PUT .../mapping   요청 — 이름을 직접 입력하는 화면이라 member_id 가 아니다 (D-026)
{"display_name": "이재환"}
// 응답
{"discord_user_id": "1124...", "member_id": "mb_02", "member_display_name": "이재환"}
```

- 미매핑이면 `member_display_name` 이 `null` 이다. **`discord_username` 으로 대체 표시한다** (D-028).
- 중복 매핑은 409 `DISCORD_USER_ALREADY_MAPPED` (D-027).
- 서버를 나간 사용자는 `active: false` 로 남는다. 목록에서 지우지 않는다 (D-031).

### 3.5 meetings — 웹 경로

봇 경로(§2.1)와 같은 리소스다. `source` 로만 구분한다 (D-157).

| Method | Path | 비고 |
|---|---|---|
| GET | `/api/v1/workspaces/{workspace_id}/meetings` | 회의록 목록 |
| POST | `/api/v1/workspaces/{workspace_id}/meetings/upload` | **multipart**, 202 |
| GET | `/api/v1/meetings/{meeting_id}/progress` | 폴링 |
| GET | `/api/v1/meetings/{meeting_id}/minutes` | 회의록 본문 |

```jsonc
// GET .../meetings   — started_at 내림차순 고정, 실패 회의 제외 (D-093, D-106)
{"items": [{"meeting_id": "mt_09", "title": "3주차 정기회의",
            "started_at": "2026-09-15T14:00:00Z",
            "source": "discord",
            "status": "done",
            "duration_ms": 2730000,
            "attendee_count": 5,
            "processed_at": "2026-09-15T06:12:00Z"}],
 "total": 12}
```

```
POST .../meetings/upload            multipart/form-data

  file                  음성 1개 (D-078, D-084)
  title                 필수 (D-087)
  started_at            회의 날짜. 기본값은 파일 lastModified (D-079, D-164)
  attendee_member_ids   로컬 업로드는 1명 이상 (D-085, D-086)

→ 202  {"meeting_id": "mt_10", "status": "processing"}
```

- 409 `MEETING_PROCESSING_IN_PROGRESS` + `details.meeting_id` — 워크스페이스에 처리 중 회의가 있다 (D-088, D-089). 그 회의의 `정리 중` 화면으로 보낸다.
- 409 `INTEGRATION_NOT_CONNECTED` — Notion 미연결 (D-096, D-097).

```jsonc
// GET /meetings/{meeting_id}/progress
{"meeting_id": "mt_10",
 "status": "processing",                       // created|recording|processing|done|failed
 "progress": {"uploaded": true, "transcribed": false, "extracted": false},
 "percent": 45,
 "failed_stage": null,                         // upload | transcribe | extract | notion
 "failure_reason": null}                       // notion_revoked | transcription_failed
                                               // | extraction_failed | audio_unsupported
```

- **`failure_reason` 으로 화면이 갈린다.** `notion_revoked` 는 차단 모달(D-100), 그 밖은 오류 토스트(D-092).

```jsonc
// GET /meetings/{meeting_id}/minutes
{"meeting_id": "mt_09",
 "title": "3주차 정기회의",
 "started_at": "2026-09-15T14:00:00Z",
 "duration_ms": 2730000,
 "source": "discord",
 "attendees": [{"member_id": "mb_01", "display_name": "김서연"}],

 "summary": {"overview": "로그인 연동 일정과 담당자를 정했다.",
             "key_points": ["로그인 API 우선", "디자인 토큰은 다음 주"],
             "decisions": ["로그인 마감을 한 주 미룬다"]},

 "transcript": [{"at_ms": 125000,
                 "speaker_member_id": "mb_01",
                 "speaker_display_name": "김서연",
                 "speaker_fallback": "seoyeon_01",
                 "text": "로그인부터 붙이는 게 좋겠어요"}],

 "applied_tasks": [{"task_id": "tk_01",
                    "title": "로그인 API 연동",
                    "assignee": {"member_id": "mb_01", "display_name": "김서연"},
                    "due_date": "2026-09-22",
                    "status": "in_progress",
                    "notion_url": "https://notion.so/...",
                    "applied_at": "2026-09-15T06:12:00Z",
                    "history_id": "hs_01"}],

 "needs_review": [{"approval_id": "ap_01",
                   "type": "task_create",
                   "payload": { },                 // §2.3 참조
                   "created_at": "2026-09-15T06:00:00Z"}],

 "permissions": {"can_review": true, "can_undo": true}}
```

- `speaker_display_name` 이 `null` 이면 `speaker_fallback`(Discord 아이디)으로 표시한다 (D-028).
- **`needs_review` 는 일반 팀원 응답에서 키 자체가 없어야 한다.** 빈 배열은 존재와 개수를 노출한다 (D-104).
- `needs_review[].payload` 는 §2.3 의 `payload` 형태와 같다.
- `applied_tasks[].history_id` 는 되돌리기(§3.8)에 쓴다.
- `permissions` 로 되돌리기 버튼 노출을 판단한다 (D-105).

### 3.6 tasks

| Method | Path | 비고 |
|---|---|---|
| GET | `/api/v1/workspaces/{workspace_id}/tasks` | 목록 |
| GET | `/api/v1/tasks/{task_id}` | 상세 |
| PATCH | `/api/v1/tasks/{task_id}` | 보완·상태 변경 |

#### 상태와 탭의 매핑 — 가정

백엔드 `TaskStatus` 는 `todo` · `in_progress` · `blocked` · `done` 4개인데 시안의 탭은 3개다.
**`todo` 와 `blocked` 가 어느 탭에 속하는지 정한 결정이 없어 아래를 가정한다.**
근거는 시안의 탭 개수 `전체 13 = 확인 필요 3 + 진행 중 7 + 완료 3` 이며, 완료가 아닌 태스크가 모두 `진행 중` 에 모여야 이 합이 맞는다.

| 탭 | 데이터 출처 | `status` 질의 |
|---|---|---|
| 확인 필요 | `GET /approvals?status=pending` (§2.3) | — |
| 진행 중 | tasks | `todo,in_progress,blocked` |
| 완료 | tasks | `done` |
| 전체 | 위 둘을 클라이언트에서 병합 (D-161) | 확인 필요 + `todo,in_progress,blocked,done` |

- `막힌 일 N` 은 탭이 아니라 대시보드 집계다. `blocked` 만 센다 (D-056).
- `status` 는 쉼표로 여러 값을 받는다. 백엔드 enum 값을 그대로 쓴다 (D-160).
- 이 매핑은 제품 결정이 나오면 교체한다. §6 에 결정 대기로 남겼다.

```jsonc
// GET .../tasks?status=todo,in_progress,blocked&filter=due_soon
//   filter=due_soon → 기한 지남 + 오늘부터 7일 이내 (D-046)
{"items": [{"task_id": "tk_01",
            "title": "로그인 API 연동",
            "status": "blocked",
            "assignee": {"member_id": "mb_01", "display_name": "김서연"},
            "due_date": "2026-09-20",
            "overdue": true,
            "progress": 40,
            "blocked_reasons": ["discord_no_response"],
            "meeting": {"meeting_id": "mt_09", "title": "3주차 정기회의"},
            "updated_at": "2026-09-16T02:00:00Z"}],
 "total": 10}
```

```jsonc
// GET /tasks/{task_id}   — 목록 항목의 모든 필드에 아래가 더해진다
{"task_id": "tk_01",
 "workspace_id": "ws_01",
 "title": "로그인 API 연동",
 "status": "blocked",
 "assignee": {"member_id": "mb_01", "display_name": "김서연"},
 "due_date": "2026-09-20",
 "overdue": true,
 "progress": 40,
 "blocked_reasons": ["discord_no_response"],
 "blocker": "Discord 답장 없음",
 "meeting": {"meeting_id": "mt_09", "title": "3주차 정기회의",
             "started_at": "2026-09-15T14:00:00Z"},
 "evidence": {"quote": "로그인부터 붙이는 게 좋겠어요",
              "speaker": "김서연", "at_ms": 125000},
 "notion": {"page_id": "abc123", "url": "https://notion.so/...",
            "synced_at": "2026-09-15T06:12:00Z"},
 "history": [{"history_id": "hs_01",
              "changed_field": "due_date",
              "old_value": "2026-09-13", "new_value": "2026-09-20",
              "change_source": "meeting",
              "is_auto": true,
              "is_rolled_back": false,
              "changed_at": "2026-09-15T06:12:00Z"}],
 "created_at": "2026-09-15T06:12:00Z",
 "updated_at": "2026-09-16T02:00:00Z"}

// PATCH /tasks/{task_id}   요청 — 보낸 필드만 바꾼다
{"title": "로그인 API 연동", "assignee_member_id": "mb_02",
 "due_date": "2026-09-27", "status": "in_progress", "progress": 60}
// 응답 — 갱신된 상세 (위와 같은 형태)
```

- `blocked_reasons` 의 원소는 `manual` \| `discord_no_response`. 두 개가 함께 있을 수 있고, `blocked_count` 는 태스크 1건으로 센다 (D-056).
- `blocker` 는 막힘 사유 서술이다. `blocked_reasons` 와 함께 쓴다 (D-056).
- `notion` 은 반영 전이면 `null`.
- `evidence` 는 회의에서 생성되지 않은 태스크면 `null`.
- 일반 팀원이 `확인 필요` 경로에 접근하면 403 `FORBIDDEN` → 리스트 뷰 이동 + 토스트 (D-103, D-162).

### 3.7 dashboard

**집계 엔드포인트 하나로 받는다.** 목록에 5개만 보여도 상단 숫자는 워크스페이스 전체 개수라(D-052~D-054), 페이지네이션된 목록으로는 맞출 수 없다.

| Method | Path |
|---|---|
| GET | `/api/v1/workspaces/{workspace_id}/dashboard` |

```jsonc
{"summary": {"needs_review_count": 12,
             "overdue_count": 3,
             "due_in_7days_count": 4,
             "blocked_count": 2},

 "needs_review": {                              // 승인 요청이다. 태스크가 아니다 (D-161)
   "items": [{"approval_id": "ap_01",
              "type": "task_create",
              "payload": { },                 // §2.3 참조
              "created_at": "2026-09-15T06:00:00Z",
              "meeting": {"meeting_id": "mt_09", "title": "3주차 정기회의"}}],
   "total": 12},

 "due_soon": {                                  // 태스크다
   "items": [{"task_id": "tk_01",
              "title": "로그인 API 연동",
              "status": "blocked",
              "assignee": {"member_id": "mb_01", "display_name": "김서연"},
              "due_date": "2026-09-20",
              "overdue": true}],
   "total": 7},

 "recent_applied": {
   "meeting": {"meeting_id": "mt_09", "title": "3주차 정기회의",
               "processed_at": "2026-09-15T06:12:00Z", "duration_ms": 2730000},
   "items": [{"history_id": "hs_01",
              "task_id": "tk_04",
              "title": "디자인 토큰 정리",
              "changed_field": "assignee",
              "applied_at": "2026-09-15T06:12:00Z",
              "is_rolled_back": false,
              "revertible": true}],
   "total": 8,
   "empty_reason": null},

 "latest_meeting": {"meeting_id": "mt_09", "title": "3주차 정기회의",
                    "duration_ms": 2730000,
                    "processed_at": "2026-09-15T06:12:00Z"}}
```

- 상단 요약 배치 순서는 `확인 대기` → `기한 지남` → `7일 이내 마감` → `막힌 일` (D-055). 앞 세 개는 클릭할 수 없다 (D-061).
- `due_in_7days_count` 는 오늘 포함 7일이며 **기한 지남을 포함하지 않는다.** 두 숫자를 중복 집계하지 않는다 (D-053, D-054).
- `needs_review.items` 는 최대 5개, `created_at` 오름차순(대기 오래된 순) (D-050, D-051).
- `due_soon.items` 는 최대 5개, **기한 지남 먼저** 그다음 마감 가까운 순 (D-044, D-045).
- `recent_applied` 는 가장 최근 회의록 1건만, 최대 3개 (D-038, D-039).
- **`empty_reason`** 은 `null` \| `no_meeting` \| `no_applied_items` \| `notion_not_connected`.
  빈 상태마다 문구와 이동 버튼이 다르다 (D-041, D-042).
  회의 업로드 / 최근 회의록 상세 / 워크스페이스 설정의 Notion 연결로 각각 보낸다.
- `latest_meeting` 은 처리된 회의가 없으면 `null` (D-065).

### 3.8 task-history

| Method | Path | 비고 |
|---|---|---|
| POST | `/api/v1/task-history/{history_id}/rollback` | 되돌리기 (D-036) |

```jsonc
// 요청 본문 없음
// 응답
{"history_id": "hs_01",
 "task_id": "tk_04",
 "is_rolled_back": true,
 "rolled_back_at": "2026-09-17T01:00:00Z"}
```

- 실행 전에 확인 모달을 한 번 띄운다 (D-036).
- 되돌린 항목을 목록에서 제거하지 않는다. 자리를 유지하고 `되돌림` 상태로 표시한다 (D-037).
- 되돌릴 수 없으면 409 `APPLIED_ITEM_NOT_REVERTIBLE`.

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

**형태를 가정으로 고정한 것 2가지.** 실제 결정이 나오면 교체하고, 그때 고칠 범위는 `entities` 계층이다.

- **`approval.payload` 의 형태** (§2.3). AI 파이프라인의 `DraftResult.structured` 를 근거로 삼았으나 백엔드 확인이 필요하다.
- **`todo` 와 `blocked` 가 속할 탭** (§3.6). 완료가 아닌 태스크를 모두 `진행 중` 에 넣는다고 가정했다. 시안의 탭 개수 `13 = 3 + 7 + 3` 이 근거이며 제품 결정은 없다.

**아직 손대지 않은 것.**

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
