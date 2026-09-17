# 백엔드 요청 사항

작성일 2026-09-17. **2026-09-15 초판을 대체한다.**

초판은 백엔드 구현 전에 작성되어 이미 충족된 요청과 코드와 어긋난 요청이 섞여 있었다.
이 문서는 `backend/app` 의 실제 구현을 확인하고 다시 쓴 것이다.

---

## 원칙

**백엔드가 이미 구현했거나 정한 것에는 프론트엔드가 맞춘다. 요청은 코드에 존재하지 않는 것으로 한정한다.**

- 이미 동작하는 엔드포인트와 스키마의 **변경·삭제·이름 변경을 요청하지 않는다.**
- 요청은 **추가**이거나 **기존 필드의 의미 확정**에 그친다.
- 프론트엔드가 감수할 수 있는 비용은 프론트엔드가 진다.

근거는 결정 기록 D-160.

## 요약

| 구분 | 건수 | 위치 |
|---|---|---|
| 신규 API (코드에 없음) | 7개 영역 | §2 |
| 기존 구현에 대한 증분 요청 | 5건 | §3 |
| **초판에서 철회하는 요청** | **9건** | §4 |
| 백엔드 답이 필요한 질문 | 3건 | §5 |
| 아직 요청하지 않는 것 | 4항목 | §6 |

초판을 이미 읽고 작업 중이라면 **§4를 먼저 확인해 달라.**

---

## 1. 공통 규약

구현된 3개 리소스(`meetings`, `extractions`, `approvals`)를 그대로 따른다. 변경 요청 없음.

| 항목 | 따르는 값 |
|---|---|
| prefix | `/api/v1` |
| 응답 봉투 | `{"data": ..., "error": null}` / 실패 시 `{"data": null, "error": {code, message, details}}` |
| 표기법 | `snake_case` |
| 날짜 | 날짜는 `YYYY-MM-DD`, 시각은 ISO 8601. 형식으로 구분한다 |
| 목록 응답 | `{"items": [...], "total": N}` |
| 오류 코드 | `app/core/errors.py` 의 `ErrorCode` 를 확장한다 |

초판은 식별자를 `workspaceId` 로 적었으나 **`workspace_id` 로 정정한다.** 구현된 코드가 snake_case다.

### 추가가 필요한 오류 코드

신규 API에서 사용한다. 이름과 상태 코드는 제안이며 백엔드가 조정해도 된다.

```
UNAUTHENTICATED(401)          FORBIDDEN(403)
EMAIL_ALREADY_EXISTS(409)     INVALID_CREDENTIALS(401)
WORKSPACE_NAME_DUPLICATED(409)  WORKSPACE_NOT_FOUND(404)
ONBOARDING_INCOMPLETE(403)    INTEGRATION_NOT_CONNECTED(409)
INTEGRATION_REVOKED(409)      DISCORD_USER_ALREADY_MAPPED(409)
MEETING_PROCESSING_IN_PROGRESS(409)  AUDIO_TOO_LARGE(413)
TASK_NOT_FOUND(404)           TASK_ALREADY_RESOLVED(409)
```

---

## 2. 신규 API

코드에 존재하지 않는 것만 적는다. 각 항목의 근거를 결정 번호로 표시한다.

### 2.1 auth

| Method | Path | 비고 |
|---|---|---|
| POST | `/auth/signup` | D-009 |
| POST | `/auth/login` | D-007 |
| POST | `/auth/logout` | 세션 즉시 무효화 (D-165) |
| GET | `/auth/me` | 앱 부팅 시 세션 확인 |
| GET | `/auth/google/start` | **302 리다이렉트**, `state` 에 복귀 경로 (D-158) |
| GET | `/auth/google/callback` | 302 → `state` 경로 |

```jsonc
// POST /auth/signup  {"email", "password", "name"}       → 201
// POST /auth/login   {"email", "password"}               → 200 + Set-Cookie
// GET  /auth/me                                          → 200
// 세 응답의 data 는 같은 형태
{
  "user": {"user_id": "...", "email": "...", "name": "...", "avatar_url": null},
  "workspace_count": 2,
  "last_workspace_id": "ws_01"
}
```

- `workspace_count` 는 로그인 후 이동 경로 분기에 쓴다. 0이면 온보딩, 1이면 대시보드, 2 이상이면 워크스페이스 선택 (D-010).
- `last_workspace_id` 는 없으면 `null` (D-066).
- **세션 요구사항 3가지** (D-165). 토큰 형식은 백엔드가 정한다. JWT를 요구하지 않는다.
  1. Secure·HttpOnly 쿠키, `SameSite=Lax`. 응답 본문에 토큰을 담지 않는다.
  2. 로그아웃 시 즉시 무효화한다.
  3. **토큰·세션에 역할과 권한을 담지 않는다.** 권한은 요청마다 워크스페이스 멤버십에서 조회한다.
- 미인증 요청은 401 `UNAUTHENTICATED` 로 응답한다. 프론트엔드가 로그인 화면으로 보낸다.

### 2.2 workspaces

| Method | Path | 비고 |
|---|---|---|
| GET | `/workspaces` | 선택 화면, 헤더 전환기 |
| POST | `/workspaces` | **본문은 `name` 하나** (D-014, D-153) |
| GET | `/workspaces/{workspace_id}` | 앱 셸 진입 |
| PATCH | `/workspaces/{workspace_id}/onboarding` | 단계 완료·건너뛰기 (D-011, D-012) |

```jsonc
// GET /workspaces
{"items": [{"workspace_id": "ws_01", "name": "카테캠 3팀",
            "role": "pm",
            "onboarding_completed": false,
            "created_at": "2026-09-15T04:00:00Z"}],
 "total": 2,
 "last_workspace_id": "ws_01"}

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

// PATCH /workspaces/{workspace_id}/onboarding
// 요청  {"step": "connect_discord", "action": "skip"}     action: skip | complete
// 응답  갱신된 onboarding 객체
```

- `role` 은 `pm` 또는 `member`. 워크스페이스마다 다르므로 세션이 아니라 여기서 내려준다.
- `status` 는 `pending` / `completed` / `skipped` 3가지. 건너뛴 단계는 재개 대상에서 제외한다 (D-012).
- Discord 를 건너뛰면 팀원 연결도 자동으로 `skipped` 가 된다 (D-073).
- **이름 검증** (D-015~D-020): 앞뒤 공백 제거, 중간 연속 공백 1칸 축약 후, **같은 사용자 계정 안에서** 대소문자를 무시하고 중복을 막는다. 위반 시 409 `WORKSPACE_NAME_DUPLICATED`. 글자 수 제한은 `details.max_length` 로 함께 내려주면 프론트엔드가 안내 문구에 쓴다.
- 온보딩 미완료 워크스페이스의 대시보드 접근은 403 `ONBOARDING_INCOMPLETE` + `details.current_step` 으로 막아 달라 (D-071). 프론트엔드가 온보딩으로 되돌린다.

### 2.3 integrations

| Method | Path | 비고 |
|---|---|---|
| GET | `/workspaces/{workspace_id}/integrations` | 연결 상태 |
| GET | `/workspaces/{workspace_id}/integrations/{provider}/start` | **302** (D-158) |
| GET | `/workspaces/{workspace_id}/integrations/{provider}/callback` | 302 → `state` |
| DELETE | `/workspaces/{workspace_id}/integrations/{provider}` | 연결 해제 |

`provider` 는 `discord` 또는 `notion`. 워크스페이스당 각각 1개만 연결한다 (D-021, D-022).

```jsonc
// GET /workspaces/{workspace_id}/integrations
{"discord": {"status": "connected",
             "display_name": "카테캠 3팀 서버",
             "connected_at": "2026-09-15T05:00:00Z"},
 "notion":  {"status": "revoked",
             "display_name": "3팀 Notion",
             "connected_at": "2026-09-15T05:10:00Z"}}
```

- `status` 는 `not_connected` / `connected` / `revoked` 3가지다. **`not_connected` 와 `revoked` 를 반드시 구분해 달라.** 띄우는 모달이 다르다 — 미연결은 `Notion 연결이 필요해요`(D-097), 연결 끊김은 `Notion 연결이 끊어졌어요`(D-100).
- `display_name` 은 표시용 이름이다. Notion 워크스페이스명, Discord 서버명. 미연결이면 `null`.
- **연결 요청 본문은 비어 있다.** Notion 은 OAuth 인증만 수행하고 프론트엔드는 데이터베이스 선택·속성 매핑 화면을 제공하지 않는다 (D-154). 초판이 언급한 `mcp_token` 과 `database_id` 를 본문에 담지 않는다.

### 2.4 members · Discord 매핑

| Method | Path | 비고 |
|---|---|---|
| GET | `/workspaces/{workspace_id}/members` | 담당자 선택, 참석자 선택 (D-086) |
| GET | `/workspaces/{workspace_id}/discord-users` | 팀원 연결 화면 (D-026) |
| PUT | `/workspaces/{workspace_id}/discord-users/{discord_user_id}/mapping` | 매핑 |
| DELETE | `/workspaces/{workspace_id}/discord-users/{discord_user_id}/mapping` | 해제 |

```jsonc
// GET /workspaces/{workspace_id}/members
{"items": [{"member_id": "mb_01", "display_name": "김서연",
            "role": "member", "active": true}],
 "total": 5}

// GET /workspaces/{workspace_id}/discord-users
{"items": [{"discord_user_id": "1123...", "discord_username": "seoyeon_01",
            "member_id": "mb_01", "member_display_name": "김서연", "active": true},
           {"discord_user_id": "1124...", "discord_username": "jaehwan_dev",
            "member_id": null, "member_display_name": null, "active": true}],
 "total": 7,
 "mapped_count": 4}

// PUT .../discord-users/{discord_user_id}/mapping
// 요청  {"display_name": "이재환"}
// 응답  {"discord_user_id": "...", "member_id": "mb_02", "member_display_name": "이재환"}
```

- **요청 본문이 `member_id` 가 아니라 `display_name` 인 이유**: 화면이 PM 이 팀원 이름을 직접 입력하는 방식이다 (D-026). 백엔드가 기존 팀원을 찾거나 새로 만들고 `member_id` 를 돌려주면 된다.
- 같은 팀원에 다른 Discord 사용자를 연결하면 409 `DISCORD_USER_ALREADY_MAPPED`. 워크스페이스 안에서 1:1 을 유지한다 (D-027).
- 미매핑 사용자는 `member_display_name` 이 `null` 이다. 프론트엔드가 `discord_username` 으로 대체 표시한다 (D-028).
- Discord 서버의 신규 사용자는 목록에 자동으로 포함한다 (D-030). 서버를 나간 사용자는 `active: false` 로 유지하고 목록에서 지우지 않는다 (D-031).
- `mapped_count` 는 연결되지 않은 인원수 표시에 쓴다 (D-076).

### 2.5 meetings — 웹 경로

회의 리소스는 하나로 유지한다. **이 부분은 이미 구현이 그렇게 되어 있어 요청이 아니다** — `meeting` 테이블이 `workspace_id` 와 `source`(`discord` / `manual_upload`)를 보유한다 (D-157, D-160).

기존 `POST /meetings` 와 `PATCH /meetings/{id}/end` 는 **봇 경로로 그대로 둔다.** 웹에 필요한 4개만 추가 요청한다.

| Method | Path | 비고 |
|---|---|---|
| GET | `/workspaces/{workspace_id}/meetings` | 회의록 목록 (D-106) |
| POST | `/workspaces/{workspace_id}/meetings/upload` | **multipart** (D-084) |
| GET | `/meetings/{meeting_id}/progress` | 진행률 폴링 (D-094) |
| GET | `/meetings/{meeting_id}/minutes` | **회의록 본문** (D-156) |

```jsonc
// GET /workspaces/{workspace_id}/meetings
// 정렬은 회의 날짜 최신순 고정. 정리에 실패한 회의는 제외한다 (D-093, D-106)
{"items": [{"meeting_id": "mt_09", "title": "3주차 정기회의",
            "started_at": "2026-09-15T14:00:00Z",
            "source": "discord", "status": "done",
            "duration_ms": 2730000, "attendee_count": 5,
            "processed_at": "2026-09-15T06:12:00Z"}],
 "total": 12}
```

```
POST /workspaces/{workspace_id}/meetings/upload      multipart/form-data

  file           음성 파일 1개만 (D-078, D-084)
  title          필수 (D-087)
  started_at     회의 날짜. 기본값은 파일 lastModified, 사용자가 수정 가능 (D-079, D-164)
  attendee_member_ids   로컬 업로드는 1명 이상 필수 (D-085, D-086)

→ 202  {"meeting_id": "mt_10", "status": "processing"}
```

업로드를 막아야 하는 경우가 2가지다.

- 워크스페이스에 처리 중인 회의가 있으면 409 `MEETING_PROCESSING_IN_PROGRESS` 와 `details.meeting_id`. 제한 범위는 사용자가 아니라 **워크스페이스 전체**다 (D-088, D-089). 프론트엔드가 그 회의의 `정리 중` 화면으로 보낸다 (D-090).
- Notion 미연결이면 409 `INTEGRATION_NOT_CONNECTED` (D-096, D-097).

```jsonc
// GET /meetings/{meeting_id}/progress
{"meeting_id": "mt_10",
 "status": "processing",
 "progress": {"uploaded": true, "transcribed": false, "extracted": false},
 "percent": 45,
 "failed_stage": null,
 "failure_reason": null}
```

- `failure_reason` 으로 **Notion 연결 끊김과 그 밖의 실패를 구분해 달라.** 전자는 차단 모달(D-100), 후자는 오류 토스트(D-092)로 화면 처리가 갈린다.
- 실패한 회의의 원본 파일은 보관하지 않는다 (D-091). 목록에도 남기지 않는다 (D-093).

```jsonc
// GET /meetings/{meeting_id}/minutes   — 회의록 상세 화면 전체가 여기에 의존한다
{"meeting_id": "mt_09", "title": "3주차 정기회의",
 "started_at": "2026-09-15T14:00:00Z", "duration_ms": 2730000, "source": "discord",
 "attendees": [{"member_id": "mb_01", "display_name": "김서연"}],
 "summary": {"overview": "...", "key_points": ["..."], "decisions": ["..."]},
 "transcript": [{"at_ms": 125000,
                 "speaker_member_id": "mb_01",
                 "speaker_display_name": "김서연",
                 "speaker_fallback": "seoyeon_01",
                 "text": "..."}],
 "applied_tasks": [{"task_id": "tk_01", "title": "...",
                    "assignee": {"member_id": "mb_01", "display_name": "김서연"},
                    "due_date": "2026-09-22",
                    "notion_url": "https://notion.so/..."}],
 "needs_review": [{"approval_id": "ap_01", "...": "..."}],
 "permissions": {"can_review": true, "can_undo": true}}
```

- `speaker_display_name` 이 `null` 이면 프론트엔드가 `speaker_fallback`(Discord 아이디)으로 표시한다 (D-028).
- **`needs_review` 는 일반 팀원 응답에서 키 자체를 제외해 달라.** 빈 배열로 내려주면 존재 여부와 개수가 노출된다. D-104 가 이를 명시적으로 금지한다.
- 일반 팀원도 요약·전사문·반영된 태스크는 읽기 전용으로 조회한다 (D-105). `permissions` 로 되돌리기 버튼 노출을 판단한다.

### 2.6 tasks

`확인 필요` 는 **별도 리소스인 `approvals` 로 조회한다.** 초판의 `tasks?status=needs_review` 통합 요청은 철회한다 (§4, D-161).

| Method | Path | 비고 |
|---|---|---|
| GET | `/workspaces/{workspace_id}/tasks` | 목록 |
| GET | `/tasks/{task_id}` | 상세 |
| PATCH | `/tasks/{task_id}` | 보완 입력, 상태 변경 |

```jsonc
// GET /workspaces/{workspace_id}/tasks?status=in_progress&filter=due_soon
//   status  all | in_progress | done | blocked          (확인 필요는 포함하지 않는다)
//   filter  due_soon → 기한 지남 + 오늘부터 7일 이내      (D-046 전체 보기 진입)
{"items": [{"task_id": "tk_01", "title": "로그인 API 연동",
            "status": "in_progress",
            "assignee": {"member_id": "mb_01", "display_name": "김서연"},
            "due_date": "2026-09-20", "overdue": true,
            "blocked_reasons": [],
            "meeting": {"meeting_id": "mt_09", "title": "3주차 정기회의"}}],
 "total": 10}

// PATCH /tasks/{task_id}
{"title": "...", "assignee_member_id": "mb_02",
 "due_date": "2026-09-22", "status": "in_progress"}
```

- 상세 응답에는 위 필드에 더해 `blocked_reasons`(`manual` / `discord_no_response`, D-056), Notion 반영 정보(`notion_page_id`, `notion_url`, `synced_at`)가 필요하다.
- 일반 팀원에게는 `all` 에 확인 필요를 포함하지 않는다 (D-102, D-163).

### 2.7 dashboard

**단일 집계 엔드포인트여야 한다.** 목록에는 5개만 보여도 상단 숫자는 워크스페이스 전체 개수다 (D-052~D-054). 페이지네이션된 목록을 프론트엔드가 합산할 수 없다.

| Method | Path |
|---|---|
| GET | `/workspaces/{workspace_id}/dashboard` |

```jsonc
{"summary": {"needs_review_count": 12,
             "overdue_count": 3,
             "due_in_7days_count": 4,
             "blocked_count": 2},
 "needs_review": {"items": [], "total": 12},
 "due_soon":     {"items": [], "total": 7},
 "recent_applied": {
   "meeting": {"meeting_id": "mt_09", "title": "3주차 정기회의",
               "processed_at": "2026-09-15T06:12:00Z", "duration_ms": 2730000},
   "items": [{"history_id": "hs_01", "task_id": "tk_04", "title": "...",
              "applied_at": "2026-09-15T06:12:00Z",
              "is_rolled_back": false, "revertible": true}],
   "total": 8,
   "empty_reason": null},
 "latest_meeting": {"meeting_id": "mt_09", "title": "...", "duration_ms": 2730000}}
```

- 상단 요약 4개의 배치 순서는 `확인 대기` → `기한 지남` → `7일 이내 마감` → `막힌 일` (D-055).
- `due_in_7days_count` 는 오늘을 포함한 7일이며 **기한이 지난 태스크를 포함하지 않는다** (D-053, D-054). 두 숫자를 중복 집계하지 않는다.
- `blocked_count` 는 수동 지정과 Discord 무응답 자동 전환을 합쳐 **태스크 1건당 1로 센다** (D-056).
- **`needs_review.items` 는 태스크가 아니라 승인 요청이다** (D-161). `approval_id` 를 식별자로 하고 기존 `GET /approvals` 의 항목 형태를 따른다. 최대 5개, 대기 오래된 순 (D-050, D-051).
- `due_soon.items` 는 태스크다. 최대 5개이며 기한 지남을 먼저, 그다음 마감이 가까운 순으로 배치한다 (D-044, D-045).
- `recent_applied` 는 **가장 최근 회의록 1건만** 기준으로 한다 (D-038). 최대 3개 (D-039).
- **`empty_reason` 은 3가지를 구분해 달라** (D-041, D-042). 빈 상태마다 문구와 이동 버튼이 다르다.
  - `no_meeting` → 회의 업로드로 이동
  - `no_applied_items` → 가장 최근 회의록 상세로 이동
  - `notion_not_connected` → 워크스페이스 설정의 Notion 연결로 이동
- `latest_meeting` 은 처리된 회의가 없으면 `null` (D-065).

---

## 3. 기존 구현에 대한 증분 요청

5건이다. **컬럼 삭제·이름 변경·타입 변경은 요청하지 않는다.** 모두 추가이거나 기존 필드의 의미 확정이다.

| # | 대상 | 현재 | 요청 | 이유 |
|---|---|---|---|---|
| 1 | `meeting.started_at` | 서버 기본값(`_now`) | 업로드 요청의 사용자 지정 날짜를 그대로 저장 | 지난 녹음을 나중에 올리면 회의 날짜가 업로드 날짜가 된다. 목록 정렬이 깨진다 (D-079, D-106, D-164) |
| 2 | `meeting.failed_stage` | 자유 문자열 | Notion 연결 끊김을 구분할 수 있는 값 포함 | 차단 모달(D-100)과 오류 토스트(D-092)로 화면이 갈린다 |
| 3 | `extraction` | 요약 저장 위치 없음 | 회의 요약을 저장할 컬럼 또는 테이블 | 회의록 상세의 요약 영역에 데이터 출처가 없다 (D-156) |
| 4 | `extraction.transcript_path` | 파일 경로 | 화자·시각이 붙은 구조화 응답으로 제공 | 브라우저가 서버 파일을 읽을 수 없다. `audio_segment` 에 화자·구간이 이미 있다 (D-028, D-105) |
| 5 | `task_history` | `is_rolled_back` 컬럼만 존재 | `POST /task-history/{history_id}/rollback` | 되돌리기 플래그는 있으나 세울 경로가 없다 (D-036, D-037) |

5번 보충. 대시보드 `최근 반영`과 `되돌리기`를 위해 새 리소스를 요청하려 했으나, `task_history` 에 `change_source`, `is_auto`, `is_rolled_back`, `rolled_back_at` 이 이미 있어 그대로 쓸 수 있다. 되돌린 항목을 목록에서 제거하지 않고 상태만 바꾸는 D-037 이 `is_rolled_back` 과 정확히 맞는다.

---

## 4. 초판(2026-09-15)에서 철회하는 요청

구현된 코드를 확인한 결과 아래 9건의 요청을 철회한다. **초판 기준으로 작업 중이라면 중단해도 된다.**

| 초판의 요청 | 철회 사유 |
|---|---|
| `assignee` 를 문자열에서 member ID 로 | `task.assignee_member_id` 가 이미 ID다 |
| 목록 응답에 `total` 포함 | `ApprovalListResponse.total` 이 이미 있다 |
| `/proposals` `/tasks` 등에 워크스페이스 스코프 추가 | `task.workspace_id` 와 `approval_request.workspace_id` 가 이미 있다 |
| `decision` 의 `action` 에 `reject` 추가 | `ApprovalResolveRequest.status` 가 이미 `approved` / `rejected` 다 |
| `blocker` 를 문자열에서 태스크 상태로 | `TaskStatus.BLOCKED` 가 이미 있다. `blocker` 텍스트는 막힘 원인 표시로 함께 쓴다 (D-056) |
| `POST /changes/poll` 의 job 상태 조회 경로 | `GET /meetings/{id}` 의 `progress` 가 이미 폴링 대상이다 |
| `GET /proposals` 를 `GET /tasks?status=needs_review` 로 통합 | 프론트엔드가 표시 계층에서 병합하는 것으로 변경했다 (D-161) |
| `/meetings/notes` 텍스트 업로드 처리 | 1차에서 호출하지 않으므로 요청 자체를 철회한다 (D-084, D-156) |
| `checkin-rules` 의 `days: 3` 을 72시간 단위로 | 메시지·체크인이 1차 범위 밖이다. 제품 결정 후 다시 요청한다 |

마지막 항목 보충. D-060 이 Discord 무응답 3일을 **72시간**으로 계산한다고 정해 두었으므로 이 요구 자체는 유효하다. 다만 해당 화면이 1차 범위가 아니어서 지금 요청하지 않는다.

---

## 5. 백엔드 답이 필요한 것

프론트엔드가 단독으로 정할 수 없는 3가지다.

1. **`approval_request.payload` 의 확정 형태.**
   AI 파이프라인의 `DraftResult.structured`(`task`, `assignee_member_id`, `due_date`, `type`)를 그대로 넣는지 확인이 필요하다.
   프론트엔드는 이 키들로 `확인 필요` 카드를 그리고, 비어 있는 필드에서 보완 사유(`담당자 없음`, `마감 없음`)를 파생할 계획이다.

2. **Notion 반영 여부의 판단 근거.**
   `task.notion_page_id` 가 채워진 것을 반영 완료로 봐도 되는지. 회의록 상세와 대시보드 `최근 반영`에 반영 시각과 Notion URL 이 필요하다.

3. **승인 시 `task` 행을 만드는 주체.**
   `PATCH /approvals/{approval_id}` 가 승인되면 백엔드가 `task` 를 생성하는지, AI 파이프라인이 따로 넣는지.
   승인 직후 프론트엔드가 어느 목록을 다시 조회해야 하는지가 달라진다.

---

## 6. 아직 요청하지 않는 것

해당 제품 결정이 없어 스펙을 확정하지 않는다. 결정 기록이 D-106 까지만 화면 정책을 다룬다.
**존재를 알리되 스펙을 앞질러 확정하지 않는다.** 결정이 나오면 이 문서에 추가한다.

- 태스크 목록의 **필터·정렬·페이지네이션 파라미터.** §2.6 의 `status` 와 `filter` 는 대시보드 진입 경로에 필요한 최소값만 적었다.
- **보드·캘린더·간트차트** 전용 조회.
- **메시지** 전반.
- **워크스페이스 관리·설정**의 개별 항목. 연결 상태 조회와 해제는 §2.3 에서 확정했다.

---

## 참고

- 결정 기록: `frontend/docs/decision/frontend-decisions.md` (D-160~D-165 가 이 문서의 근거)
- 전체 API 계약(기존 구현 포함): `frontend/docs/api/frontend-api-contract-draft.md`
- 개발 계획: `frontend/docs/plan/frontend-development-plan.md` (이 문서는 M1-A 에 해당)
