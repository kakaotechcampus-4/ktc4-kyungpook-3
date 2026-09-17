# 프론트엔드 API 계약

- 작성일 2026-09-17
- **기준 커밋: `origin/develop` `3dab0a1`** (PR #38 병합 이후)
- 개발 계획의 M1-A 산출물

§2 와 §3 은 `backend/app` 을 읽고 적은 **사실**이다. §4 는 코드에 없어 프론트엔드가 가정한 것이며 실제 API 와 다를 수 있다.
백엔드를 향한 요청은 **§5 한 절**에 모았다.

> **기준 커밋을 반드시 확인하고 읽을 것.** 이 문서의 이전 판은 하루 낡은 `develop` 을 보고 쓰여
> 이미 구현된 엔드포인트를 신규 요청으로 적는 오류가 있었다. 백엔드는 빠르게 움직인다.

원칙은 D-160 이다. **백엔드가 이미 구현했거나 정한 것에는 프론트엔드가 맞춘다.**

---

## 1. 공통 규약

| 항목 | 값 |
|---|---|
| prefix | `/api/v1` |
| 표기법 | `snake_case` |
| 날짜 | `YYYY-MM-DD` (`due_date`) / 시각 ISO 8601 (`created_at`) |
| 목록 | `{"items": [...], "total": N}` |
| 페이지네이션 | **없다.** 모든 목록이 전량을 반환한다 |

### 응답 봉투

신규 엔드포인트는 `Envelope[T]` 를 `response_model` 로 선언하므로 **Swagger 에 실제 형태가 나온다.**

```jsonc
// 성공
{"data": { }, "error": null}
// 실패
{"data": null, "error": {"code": "TASK_NOT_FOUND", "message": "...", "details": {"task_id": "tk_01"}}}
```

`error.message` 는 한국어다. 토스트에 그대로 쓸 수 있다.

### 오류 코드

`backend/app/core/errors.py` 기준. 괄호는 HTTP 상태 코드다.

```
INVALID_REQUEST(400)              MEETING_NOT_FOUND(404)
MEETING_ALREADY_ENDED(409)        MEETING_NOT_PROCESSING(409)
AUDIO_UPLOAD_FAILED(422)          AUDIO_FORMAT_UNSUPPORTED(422)
TRANSCRIPTION_FAILED(502)         EXTRACTION_FAILED(502)
EXTRACTION_NOT_FOUND(404)         APPROVAL_NOT_FOUND(404)
APPROVAL_ALREADY_RESOLVED(409)    NOTION_WRITE_FAILED(502)
WORKSPACE_NOT_FOUND(404)          WORKSPACE_MISMATCH(409)
MEMBER_NOT_FOUND(404)             MEMBER_ALIAS_NOT_FOUND(404)
TASK_NOT_FOUND(404)               TASK_HISTORY_NOT_FOUND(404)
TASK_HISTORY_ALREADY_ROLLED_BACK(409)
INTERNAL_ERROR(500)
```

§4 의 신규 API 에 필요한 코드는 §5.3 에 적었다.

---

## 2. 구현된 API

### 2.1 workspaces

| Method | Path | 비고 |
|---|---|---|
| POST | `/api/v1/workspaces` | 201 |
| GET | `/api/v1/workspaces` | 전체 목록 |
| GET | `/api/v1/workspaces/{workspace_id}` | |

```jsonc
// POST 요청  {"name": "카테캠 3팀"}      1~100자
// 응답 / GET 단건
{"workspace_id": "ws_01", "name": "카테캠 3팀", "created_at": "2026-09-15T04:00:00Z"}

// GET 목록 — created_at 내림차순
{"items": [ ... ], "total": 2}
```

- **생성 본문이 `name` 하나다.** D-153 의 요청이 이미 충족돼 있다.
- **사용자 개념이 없어 목록이 전체 워크스페이스를 반환한다.** 로그인한 사용자의 소속만 거르는 기능이 없다 → §4.2.
- `role`(pm/member)과 온보딩 진행 상태가 응답에 없다 → §4.2.

### 2.2 members · aliases

| Method | Path | 비고 |
|---|---|---|
| POST | `/api/v1/members` | 201 |
| GET | `/api/v1/members?workspace_id=` | `workspace_id` 필수 |
| GET · PATCH | `/api/v1/members/{member_id}` | |
| POST | `/api/v1/members/{member_id}/aliases` | 별칭 추가 |
| GET | `/api/v1/members/aliases?workspace_id=` | 별칭 목록 |
| GET | `/api/v1/members/unresolved-aliases?workspace_id=` | **미매칭 이름** |
| DELETE | `/api/v1/members/aliases/{alias_id}` | 204 |

```jsonc
// MemberResponse
{"member_id": "mb_01", "workspace_id": "ws_01", "display_name": "김서연",
 "discord_user_id": "1123...", "notion_name": null,
 "role": "member", "created_at": "2026-09-15T04:10:00Z"}
// POST 요청: {workspace_id, display_name, discord_user_id?, notion_name?, role?}
// PATCH 요청: 위 4개 모두 선택

// MemberAliasResponse
{"alias_id": "al_01", "member_id": "mb_01", "workspace_id": "ws_01",
 "alias_text": "서연", "alias_type": "nickname", "source": "manual",
 "confidence": 1.0, "verified": true, "created_at": "..."}
// POST 요청: {alias_text, alias_type?, source?, confidence?, verified?}

// UnresolvedAliasResponse — 회의에서 나왔지만 아직 팀원과 연결되지 않은 이름
{"alias_text": "민수", "occurrences": 3, "last_seen_at": "2026-09-15T06:00:00Z"}
```

- `alias_type` 은 `realname` \| `nickname` \| `mention` \| `inferred`, `source` 는 `manual` \| `discord_profile` \| `learned`.
- **`unresolved-aliases` 는 Discord 서버의 사용자 목록이 아니다.** 회의 전사에서 감지됐지만 매칭되지 않은 **이름 문자열**이다. `alias_resolution_log` 에서 집계하며 이미 별칭으로 등록된 것은 빠진다.
- 따라서 **팀원 연결 화면의 데이터 출처가 D-026 의 전제와 다르다** → §5.2 의 질문 1번.
- Discord 사용자 식별자는 `member.discord_user_id` 에 팀원당 하나씩 붙는다.

### 2.3 meetings — 봇 경로

| Method | Path | 비고 |
|---|---|---|
| POST | `/api/v1/meetings` | 201 |
| PATCH | `/api/v1/meetings/{meeting_id}/end` | 202 |
| GET | `/api/v1/meetings/{meeting_id}` | |

```jsonc
// POST 요청 {"workspace_id", "title"?, "source"?}   source: discord | manual_upload
//      응답 {"meeting_id", "workspace_id", "status", "started_at"}
// PATCH /end 응답 {"meeting_id", "status", "ended_at"}

// GET /{meeting_id}
{"meeting_id": "mt_09", "workspace_id": "ws_01", "title": "3주차 정기회의",
 "status": "done",
 "started_at": "2026-09-15T14:00:00Z", "ended_at": "2026-09-15T14:45:00Z",
 "extraction_id": "ex_01",
 "failed_stage": null}
```

- `status` 는 `created` → `recording` → `processing` → `done` \| `failed`.
- `extraction_id` 는 `status: done` 일 때만 채워진다.
- **`progress`(audio_merged·transcribed·extracted) 가 응답에서 빠졌다.** 모델에는 남아 있지만 API 가 내려주지 않는다. 진행률 UI 는 현재 `status` 밖에 쓸 것이 없다 → §5.1 증분 요청.
- 이미 종료된 회의에 `/end` 를 호출하면 409 `MEETING_ALREADY_ENDED`.

### 2.4 extractions

| Method | Path | 비고 |
|---|---|---|
| POST | `/api/v1/extractions` | **AI → BE.** 프론트엔드는 호출하지 않는다 |
| GET | `/api/v1/extractions/{extraction_id}` | |

```jsonc
{"extraction_id": "ex_01", "meeting_id": "mt_09",
 "items": [
   {"item_id": "it_01",
    "task": {"title": "로그인 API 연동", "confidence": 0.9},
    "assignee": {"raw": "민수", "member_id": null, "display_name": null,
                 "confidence": 0.3, "needs_check": true},
    "due_date": {"value": "2026-09-20", "raw": "다음 주 월요일", "confidence": 0.8},
    "confidence": 0.3,
    "gate": "hold",
    "evidence": {"quote": "...", "speaker": "김서연", "at_ms": 125000},
    "task_id": null,
    "approval_id": "ap_01"}]}
```

- `confidence` 는 `min(task, assignee, due)`.
- `gate` 는 `auto`(≥0.8) / `review`(≥0.5) / `hold`. 임계값은 `services/matching.py`.
- **`task_id` 와 `approval_id` 가 배타적으로 채워진다.** `gate=auto` 면 `task_id`, `review`·`hold` 면 `approval_id`. §3 참조.
- `assignee.member_id` 가 `null` 이면 `raw` 로 대체 표시한다.

### 2.5 approvals — `확인 필요` 의 데이터 출처

| Method | Path | 비고 |
|---|---|---|
| POST | `/api/v1/approvals` | AI → BE. 프론트엔드는 호출하지 않는다 |
| GET | `/api/v1/approvals?workspace_id=&status=` | `workspace_id` 필수 |
| GET | `/api/v1/approvals/{approval_id}` | |
| PATCH | `/api/v1/approvals/{approval_id}` | 승인·반려 |

```jsonc
// GET 목록 — created_at 내림차순
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

// PATCH 요청 {"status": "approved" | "rejected", "resolved_by": "<PM member_id>"}
// 이미 처리된 건 → 409 APPROVAL_ALREADY_RESOLVED
```

#### payload — 가정이 아니라 사실

회의에서 생성되는 `task_create` 승인의 payload 는 `api/extractions.py` 가 아래 키로 만든다.

```jsonc
{"task_title": "로그인 API 연동",
 "assignee_member_id": null,
 "assignee_raw": "민수",
 "due_date": null,                      // "2026-09-20" 또는 null
 "due_raw": "다음 주 월요일",
 "evidence_quote": "민수님이 다음 주까지 로그인 붙이기로 해요",
 "evidence_speaker": "김서연",
 "evidence_at_ms": 125000,
 "extraction_item_id": "it_01",
 "meeting_id": "mt_09",
 "gate": "hold"}                        // review | hold
```

승인 시 백엔드가 읽는 키는 `api/approvals.py` 의 `_apply_approval` 에 있다.

- `task_create` → `task_title`(없으면 `title`), `meeting_id`, `assignee_member_id`, `due_date`
- `task_update` → `title`, `assignee_member_id`, `status`, `progress`, `blocker`, `due_date` 중 존재하는 것만
- `reminder_dm` → 태스크에 반영하지 않는다. 발송은 Discord 봇의 책임이다

**프론트엔드가 지킬 규칙**

- **보완 사유는 서버가 주지 않는다.** `assignee_member_id` 가 `null` 이면 `담당자 없음`, `due_date` 가 `null` 이면 `마감 없음` 으로 프론트엔드가 파생한다.
- `assignee_raw` 와 `due_raw` 는 회의에서 나온 원문이다. 확정 값이 아니므로 보조 표시한다.
- `evidence_quote` · `evidence_speaker` · `evidence_at_ms` 로 근거를 보여준다.
- `type` 마다 화면이 다르므로 **`type` 으로 분기한 뒤 payload 를 읽는다.** 공통 필드를 가정하지 않는다.
- 목록 정렬이 `created_at` 내림차순 고정이다. **대기 오래된 순(D-050)은 클라이언트에서 뒤집는다.**

### 2.6 tasks · task history

| Method | Path | 비고 |
|---|---|---|
| POST | `/api/v1/tasks` | 201 |
| GET | `/api/v1/tasks?workspace_id=&status=&assignee_member_id=&due_before=&due_after=` | |
| GET · PATCH | `/api/v1/tasks/{task_id}` | |
| GET | `/api/v1/tasks/{task_id}/history` | |
| POST | `/api/v1/tasks/{task_id}/history/{history_id}/rollback?changed_by=` | **되돌리기** |

```jsonc
// TaskResponse — 평평하다. 중첩 객체가 없다
{"task_id": "tk_01", "workspace_id": "ws_01", "meeting_id": "mt_09",
 "title": "로그인 API 연동",
 "assignee_member_id": "mb_01",
 "status": "todo",                      // todo | in_progress | blocked | done
 "progress": 40,                        // 0~100 또는 null
 "blocker": null,
 "due_date": "2026-09-20",
 "notion_page_id": null,
 "created_at": "...", "updated_at": "..."}

// POST 요청 {workspace_id, title, meeting_id?, assignee_member_id?, due_date?,
//            status?, progress?, blocker?, created_by?}
// PATCH 요청 {title?, assignee_member_id?, status?, progress?, blocker?, due_date?, changed_by?}

// TaskHistoryResponse — created_at 내림차순
{"history_id": "hs_01", "task_id": "tk_01",
 "changed_field": "due_date",           // assignee|due_date|status|title|progress|blocker
 "old_value": "2026-09-13", "new_value": "2026-09-20",
 "change_source": "meeting",            // meeting|chat|checkin|notion|reminder_reply|manual
 "changed_by": null,
 "is_auto": true,
 "is_rolled_back": false,
 "rolled_back_at": null,
 "created_at": "..."}

// rollback 응답은 갱신된 TaskResponse 다
```

**프론트엔드가 감수해야 할 것**

- **`assignee_member_id` 만 온다.** 담당자 이름을 붙이려면 `GET /members` 를 따로 불러 클라이언트에서 조인한다.
- **`overdue` 필드가 없다.** `due_date` 와 오늘을 비교해 프론트엔드가 계산한다.
- **`status` 필터가 단일 값이다.** 쉼표로 여러 값을 받지 않는다 → §3.2.
- 정렬이 `due_date` 오름차순, `created_at` 내림차순으로 고정이다.
- `due_before` / `due_after` 가 있어 **마감 임박(오늘 포함 7일)은 `due_before` 로 거를 수 있다** (D-043).
- 세션이 없으므로 `created_by` · `changed_by` · `resolved_by` 를 **프론트엔드가 직접 실어 보낸다.**
- 되돌리기는 이미 되돌린 기록이면 409 `TASK_HISTORY_ALREADY_ROLLED_BACK`.

---

## 3. 파이프라인이 화면을 가르는 방식

### 3.1 게이트 — `확인 필요` 가 생기는 지점

`POST /extractions` 가 항목마다 신뢰도로 게이트를 판정하고 **두 갈래로 나눈다.**

```
추출 항목
  confidence = min(task, assignee, due)
      |
      +- >= 0.8  gate=auto       -> create_task() 즉시 실행, task_history 에 is_auto=true 로 기록
      |                             extraction_item.task_id 채워짐
      |                             화면: 회의록의 "반영된 태스크", 대시보드 "최근 반영"
      |
      +- <  0.8  gate=review|hold -> ApprovalRequest(type=task_create) 생성
                                    extraction_item.approval_id 채워짐, related_task_id 는 null
                                    화면: "확인 필요"
                                    PATCH /approvals/{id} 로 승인하면 그때 create_task() 가 돌고
                                    related_task_id 가 채워진다
```

이 구조가 D-101(확실한 항목은 즉시 반영, 확인 필요는 승인 후 반영)과 그대로 맞는다.

**따라서 `확인 필요` 항목에는 `task_id` 가 없다.** 승인 전까지 태스크 행이 존재하지 않는다.
식별자는 `approval_id` 뿐이며, 이것이 D-161·D-162 의 근거다.

승인 직후 프론트엔드가 다시 조회해야 할 것:

| 목록 | 갱신 이유 |
|---|---|
| `GET /approvals?status=pending` | 해당 건이 빠진다 |
| `GET /tasks?workspace_id=` | 태스크가 새로 생긴다 |
| 대시보드 | `needs_review_count` 와 `최근 반영` 이 함께 바뀐다 |

반려(`rejected`)는 태스크를 만들지 않는다. 승인 요청만 닫힌다.

### 3.2 태스크 상태와 탭의 매핑

백엔드 `TaskStatus` 는 `todo` · `in_progress` · `blocked` · `done` 4개인데 시안의 탭은 3개다.
**`todo` 와 `blocked` 가 어느 탭에 속하는지 정한 제품 결정이 없다.**

시안의 탭 개수가 `전체 13 = 확인 필요 3 + 진행 중 7 + 완료 3` 이므로, 완료가 아닌 태스크가 모두 `진행 중` 에 모여야 이 합이 맞는다. 이를 가정으로 고정한다.

| 탭 | 데이터 출처 | 필터 |
|---|---|---|
| 확인 필요 | `GET /approvals?status=pending` | — |
| 진행 중 | `GET /tasks` | `status` 가 `done` 이 아닌 것 |
| 완료 | `GET /tasks` | `status` 가 `done` 인 것 |
| 전체 | 위 둘을 병합 | 확인 필요를 상단 고정 후 나머지를 마감순 |

- **`status` 질의 파라미터를 쓰지 않는다.** 단일 값만 받으므로 `진행 중` 탭을 서버에서 거를 수 없다.
  페이지네이션이 없으니 `GET /tasks?workspace_id=` 로 전량을 받아 **클라이언트에서 필터링한다.**
- `막힌 일 N` 은 탭이 아니라 대시보드 집계다. `status` 가 `blocked` 인 것을 센다 (D-056).
- `전체` 탭 병합은 PM 화면에만 적용된다. 일반 팀원은 승인 요청을 조회하지 않는다 (D-163).
- 이 매핑은 제품 결정이 나오면 교체한다. §8 참조.

---

## 4. 신규 요청 — 코드에 없는 것

§2 에 없는 것만 적는다. 형태는 프론트엔드의 가정이다.

### 4.1 auth

세션과 사용자 개념이 백엔드에 전혀 없다.

| Method | Path | 비고 |
|---|---|---|
| POST | `/api/v1/auth/signup` · `/auth/login` · `/auth/logout` | |
| GET | `/api/v1/auth/me` | |
| GET | `/api/v1/auth/google/start?state=` · `/auth/google/callback` | **302** |

```jsonc
// signup 요청 {"email", "password", "name"}   login 요청 {"email", "password"}
// signup · login · me 의 응답 data
{"user": {"user_id": "us_01", "email": "pm@example.com", "name": "최진호", "avatar_url": null},
 "workspace_count": 2,
 "last_workspace_id": "ws_01"}
```

- `workspace_count` 로 로그인 후 이동을 분기한다. `0` 이면 온보딩, `1` 이면 대시보드, `2` 이상이면 선택 화면 (D-010).
- **세션 요구사항 3가지** (D-165). 토큰 형식은 백엔드가 정하며 **JWT 를 요구하지 않는다.**
  1. Secure·HttpOnly 쿠키, `SameSite=Lax`. 응답 본문에 토큰을 담지 않는다.
  2. 로그아웃 시 즉시 무효화한다.
  3. **토큰과 세션에 역할·권한을 담지 않는다.** 권한은 요청마다 워크스페이스 멤버십에서 조회한다.
- OAuth 는 본문 없는 302 다. `state` 에 복귀 경로를 담는다 (D-158).
- 미인증 요청은 401 `UNAUTHENTICATED`.

### 4.2 워크스페이스의 사용자 스코프 · 역할 · 온보딩

`GET /workspaces` 가 **전체 워크스페이스**를 반환한다. 세 가지가 필요하다.

| 필요한 것 | 형태 |
|---|---|
| 로그인 사용자의 소속만 반환 | `GET /workspaces` 의 동작 변경 |
| 워크스페이스별 내 역할 | `WorkspaceResponse` 에 `"role": "pm" 또는 "member"` |
| 온보딩 진행 상태 | 아래 |

```jsonc
// GET /workspaces/{workspace_id} 에 추가를 요청하는 필드
{"role": "pm",
 "onboarding": {
   "completed": false,
   "current_step": "connect_notion",
   "steps": [{"step": "create_workspace", "status": "completed"},
             {"step": "connect_discord",  "status": "skipped"},
             {"step": "connect_notion",   "status": "pending"},
             {"step": "connect_members",  "status": "pending"}]}}

// PATCH /api/v1/workspaces/{workspace_id}/onboarding
// 요청 {"step": "connect_discord", "action": "skip"}     action 은 skip 또는 complete
```

- `step` 은 `create_workspace`, `connect_discord`, `connect_notion`, `connect_members` 순서 고정 (D-008).
- `status` 는 `pending`, `completed`, `skipped`. 건너뛴 단계는 재개 대상에서 제외한다 (D-012).
- **이름 중복 검증이 없다.** 같은 계정 안에서 앞뒤 공백 제거·연속 공백 축약·대소문자 무시 후 중복을 막아 달라 (D-015~D-020). 409 `WORKSPACE_NAME_DUPLICATED`.
- 온보딩 미완료 워크스페이스의 대시보드 접근은 403 `ONBOARDING_INCOMPLETE` 와 `details.current_step` (D-071).

### 4.3 integrations

Discord·Notion 연결 상태를 다루는 API 가 없다.

| Method | Path |
|---|---|
| GET | `/api/v1/workspaces/{workspace_id}/integrations` |
| GET | `/api/v1/workspaces/{workspace_id}/integrations/{provider}/start?state=` (**302**) |
| GET | `/api/v1/workspaces/{workspace_id}/integrations/{provider}/callback` (**302**) |
| DELETE | `/api/v1/workspaces/{workspace_id}/integrations/{provider}` |

```jsonc
{"discord": {"status": "connected", "display_name": "카테캠 3팀 서버",
             "connected_at": "2026-09-15T05:00:00Z"},
 "notion":  {"status": "not_connected", "display_name": null, "connected_at": null}}
```

- `status` 는 `not_connected`, `connected`, `revoked` 3가지다.
  **`not_connected` 와 `revoked` 를 구분해 달라.** 미연결은 `Notion 연결이 필요해요`(D-097), 끊김은 `Notion 연결이 끊어졌어요`(D-100) 로 다른 모달을 띄운다.
- 연결 요청에 본문이 없다. Notion 은 OAuth 만 수행하고 데이터베이스 선택 화면을 만들지 않는다 (D-154).

### 4.4 meetings 웹 경로

봇 경로(§2.3)와 같은 리소스를 쓴다. `source` 로만 구분한다 (D-157).

| Method | Path | 비고 |
|---|---|---|
| GET | `/api/v1/workspaces/{workspace_id}/meetings` | 회의록 목록 |
| POST | `/api/v1/workspaces/{workspace_id}/meetings/upload` | **multipart**, 202 |
| GET | `/api/v1/meetings/{meeting_id}/minutes` | 회의록 본문 |

```jsonc
// GET .../meetings — started_at 내림차순, 실패 회의 제외 (D-093, D-106)
{"items": [{"meeting_id": "mt_09", "title": "3주차 정기회의",
            "started_at": "2026-09-15T14:00:00Z", "source": "discord",
            "status": "done", "duration_ms": 2730000,
            "attendee_count": 5, "processed_at": "2026-09-15T06:12:00Z"}],
 "total": 12}
```

```
POST .../meetings/upload            multipart/form-data
  file                  음성 1개 (D-078, D-084)
  title                 필수 (D-087)
  started_at            회의 날짜. 기본값은 파일 lastModified (D-079, D-164)
  attendee_member_ids   로컬 업로드는 1명 이상 (D-085, D-086)

  202 {"meeting_id": "mt_10", "status": "processing"}
```

- 409 `MEETING_PROCESSING_IN_PROGRESS` 와 `details.meeting_id` — 워크스페이스에 처리 중인 회의가 있다 (D-088, D-089).
- 409 `INTEGRATION_NOT_CONNECTED` — Notion 미연결 (D-096, D-097).

```jsonc
// GET /meetings/{meeting_id}/minutes
{"meeting_id": "mt_09", "title": "3주차 정기회의",
 "started_at": "2026-09-15T14:00:00Z", "duration_ms": 2730000, "source": "discord",
 "attendees": [{"member_id": "mb_01", "display_name": "김서연"}],
 "summary": {"overview": "...", "key_points": ["..."], "decisions": ["..."]},
 "transcript": [{"at_ms": 125000, "speaker_member_id": "mb_01",
                 "speaker_display_name": "김서연", "speaker_fallback": "seoyeon_01",
                 "text": "..."}],
 "permissions": {"can_review": true, "can_undo": true}}
```

- **반영된 태스크와 확인 필요 항목은 이 응답에 넣지 않아도 된다.** `GET /extractions/{extraction_id}` 의 항목이 `task_id` 와 `approval_id` 를 이미 들고 있어(§2.4) 프론트엔드가 조립할 수 있다.
- `speaker_display_name` 이 `null` 이면 `speaker_fallback` 으로 표시한다 (D-028).
- 일반 팀원에게 `확인 필요` 영역을 숨긴다. **개수와 존재 여부도 노출하지 않는다** (D-104). 프론트엔드가 `approval_id` 가 있는 항목을 걸러 낸다.

### 4.5 dashboard

| Method | Path |
|---|---|
| GET | `/api/v1/workspaces/{workspace_id}/dashboard` |

**집계 엔드포인트 하나여야 한다.** 목록에 5개만 보여도 상단 숫자는 워크스페이스 전체 개수다 (D-052~D-054).

```jsonc
{"summary": {"needs_review_count": 12, "overdue_count": 3,
             "due_in_7days_count": 4, "blocked_count": 2},
 "needs_review": {"items": [], "total": 12},
 "due_soon":     {"items": [], "total": 7},
 "recent_applied": {
   "meeting": {"meeting_id": "mt_09", "title": "3주차 정기회의",
               "processed_at": "2026-09-15T06:12:00Z", "duration_ms": 2730000},
   "items": [{"history_id": "hs_01", "task_id": "tk_04", "title": "디자인 토큰 정리",
              "changed_field": "assignee", "applied_at": "2026-09-15T06:12:00Z",
              "is_rolled_back": false}],
   "total": 8,
   "empty_reason": null},
 "latest_meeting": {"meeting_id": "mt_09", "title": "...", "duration_ms": 2730000}}
```

- `needs_review.items` 는 **§2.5 의 승인 요청 형태**, `due_soon.items` 는 **§2.6 의 태스크 형태**다. 서로 다른 리소스다.
- 상단 요약 순서는 `확인 대기`, `기한 지남`, `7일 이내 마감`, `막힌 일` (D-055). 앞 셋은 클릭할 수 없다 (D-061).
- `due_in_7days_count` 는 오늘 포함 7일이며 **기한 지남을 포함하지 않는다** (D-053, D-054).
- `needs_review.items` 는 최대 5개, 대기 오래된 순 (D-050, D-051). `due_soon.items` 는 최대 5개, 기한 지남 먼저 그다음 마감 가까운 순 (D-044, D-045).
- `recent_applied` 는 가장 최근 회의록 1건만, 최대 3개 (D-038, D-039). 되돌리기는 §2.6 의 rollback 을 쓴다.
- **`empty_reason`** 은 `null`, `no_meeting`, `no_applied_items`, `notion_not_connected` 4가지다 (D-041, D-042).
- `latest_meeting` 은 처리된 회의가 없으면 `null` (D-065).

---

## 5. 백엔드 요청 정리

**이 절만 백엔드를 향한다.** §1~§4 는 프론트엔드가 지킬 계약이다.

원칙은 D-160 이다. 이미 구현된 엔드포인트와 스키마의 **변경·삭제·이름 변경을 요청하지 않는다.** 요청은 추가이거나 기존 필드의 의미 확정에 그친다.

### 5.1 기존 구현에 대한 증분 요청 — 5건

| # | 대상 | 현재 | 요청 | 이유 |
|---|---|---|---|---|
| 1 | `GET /meetings/{id}` | `progress` 가 응답에서 빠졌다 | `audio_merged` · `transcribed` · `extracted` 를 다시 내려 달라 | 모델에는 있는데 API 에 없다. `status` 만으로는 진행률 UI 를 그릴 수 없다 (D-094) |
| 2 | `meeting.started_at` | 서버 기본값(`_now`) | 업로드 요청의 사용자 지정 날짜를 그대로 저장 | 지난 녹음을 나중에 올리면 회의 날짜가 업로드 날짜가 된다. 목록 정렬이 깨진다 (D-079, D-106, D-164) |
| 3 | `meeting.failed_stage` | 자유 문자열 | Notion 연결 끊김을 구분할 수 있는 값 포함 | 차단 모달(D-100)과 오류 토스트(D-092)로 화면이 갈린다 |
| 4 | `extraction` | 요약 저장 위치가 없다 | 회의 요약을 저장할 컬럼 또는 테이블 | 회의록 상세의 요약 영역에 데이터 출처가 없다 (D-156) |
| 5 | `extraction.transcript_path` | 파일 경로 | 화자·시각이 붙은 구조화 응답으로 제공 | 브라우저가 서버 파일을 읽을 수 없다. `audio_segment` 에 화자와 구간이 이미 있다 (D-028, D-105) |

되돌리기는 요청 목록에서 빠졌다. `POST /tasks/{task_id}/history/{history_id}/rollback` 이 **이미 구현돼 있다**(§2.6).

### 5.2 백엔드 답이 필요한 것 — 2건

1. **팀원 연결 화면의 데이터 출처.**
   D-026 은 `연결된 Discord 서버에서 사용자 목록을 자동으로 불러온다` 를 전제한다. 그런데 `GET /members/unresolved-aliases` 는 **회의 전사에서 감지된 미매칭 이름**을 돌려주지 온보딩 시점의 Discord 서버 멤버 목록이 아니다.
   회의를 한 번도 돌리지 않은 온보딩 단계에서는 이 목록이 비어 있다.
   Discord 서버 사용자 목록을 주는 경로를 추가할지, 아니면 화면을 alias 기반으로 다시 설계할지 정해야 한다. 후자면 D-026·D-028·D-030 을 개정한다.

2. **Notion 반영 여부의 판단 근거.**
   `task.notion_page_id` 가 채워진 것을 반영 완료로 봐도 되는지. 회의록 상세와 대시보드 `최근 반영` 에 반영 시각과 Notion URL 이 필요하다.

> 이전 판에서 물었던 `approval_request.payload` 의 형태와 `승인 시 task 생성 주체` 는 **코드에 답이 있어 질문에서 뺐다.** §2.5 와 §3.1 에 사실로 적었다.

### 5.3 신규 API 에 필요한 오류 코드

§4 에서 쓴다. 이름과 상태 코드는 제안이며 백엔드가 조정해도 된다.

```
UNAUTHENTICATED(401)            FORBIDDEN(403)
EMAIL_ALREADY_EXISTS(409)       INVALID_CREDENTIALS(401)
WORKSPACE_NAME_DUPLICATED(409)  ONBOARDING_INCOMPLETE(403)
INTEGRATION_NOT_CONNECTED(409)  INTEGRATION_REVOKED(409)
MEETING_PROCESSING_IN_PROGRESS(409)   AUDIO_TOO_LARGE(413)
```

---

## 6. 도메인 모델

화면은 DTO 를 직접 참조하지 않는다. `entities` 계층에서만 DTO 를 다루고 변환한다 (D-133, D-134).
`pages`·`widgets`·`features` 에서 DTO 타입을 import 하지 않으며 ESLint `no-restricted-imports` 로 강제한다.

| 엔티티 | 비고 |
|---|---|
| `user` | §4.1 이 나오기 전까지 mock 전용 |
| `workspace` | 온보딩 진행 상태 포함 |
| `member` | `discord_user_id` 와 별칭 |
| `meeting` | `source` 로 봇·업로드를 구분 |
| `minutes` | 요약·전사문 |
| `task` | |
| `approval` | **`확인 필요` 를 담는다.** `task` 와 별도 엔티티다 |
| `integration` | Discord·Notion 연결 상태 |

**변환 계층이 반드시 해야 할 일.** 백엔드 응답이 평평하므로 화면이 쓰는 모양으로 만드는 비용을 여기서 전부 흡수한다.

- **담당자 이름 조인** — `task.assignee_member_id` 에 `GET /members` 결과를 붙인다. 응답에 이름이 없다.
- **`overdue` 계산** — `due_date` 와 오늘을 비교한다. 서버가 주지 않는다.
- **보완 사유 파생** — `approval.payload` 의 `assignee_member_id` 와 `due_date` 가 비었는지로 `담당자 없음` · `마감 없음` 을 만든다.
- **화자 이름 대체** — `speaker_display_name` 이 없으면 `speaker_fallback` (D-028).
- **담당자 대체** — 추출 항목의 `assignee.member_id` 가 없으면 `assignee.raw` (D-161).
- **탭 필터링** — `status` 로 클라이언트에서 거른다 (§3.2).

---

## 7. MSW

- 로컬 개발·Vitest·Storybook 이 같은 핸들러를 공유한다. production 번들에서 제외한다 (D-146).
- 정상 응답이 기본이다. 빈 상태·권한 오류·검증 오류·서버 오류·느린 응답은 테스트와 Story 에서 개별 override 한다.
- 고정 ID·고정 날짜를 쓴다. 자동 테스트에 인위적 지연을 넣지 않는다.
- `onUnhandledRequest` 는 테스트에서 실패, 로컬에서 경고.

픽스처가 지켜야 할 값:

- **`gate` 와 식별자의 짝이 맞아야 한다.** `gate=auto` 인 추출 항목은 `task_id` 만, `review`·`hold` 는 `approval_id` 만 갖는다 (§3.1).
- 승인 픽스처의 `payload` 는 §2.5 의 11개 키를 그대로 쓴다. `task_title` 이며 `task` 가 아니다.
- `전체` 탭 개수가 `확인 필요 + 완료 아님 + 완료` 와 맞아야 한다. 시안 기준 `13 = 3 + 7 + 3`.
- `extraction_id` 는 `status: done` 인 회의에만 존재한다.
- 일반 팀원 픽스처에는 `approval_id` 를 가진 항목이 노출되지 않아야 한다 (D-104).

---

## 8. 결정 대기

**가정으로 고정한 것 1건.** 실제 결정이 나오면 교체하고, 그때 고칠 범위는 `entities` 계층이다.

- **`todo` 와 `blocked` 가 속할 탭** (§3.2). 완료가 아닌 태스크를 모두 `진행 중` 에 넣는다고 가정했다. 시안의 탭 개수 `13 = 3 + 7 + 3` 이 근거이며 제품 결정은 없다.

**아직 손대지 않은 것.**

- 태스크 목록의 정렬·페이지네이션 정책. 현재 백엔드는 페이지네이션이 없고 정렬이 고정이다.
- 보드·캘린더·간트차트 전용 조회. `due_before` / `due_after` 가 캘린더용으로 이미 있다.
- 메시지 전반.
- 워크스페이스 관리·설정의 개별 항목.
- 팀원 연결 화면의 데이터 출처 (§5.2 1번의 답에 따라 D-026·D-028·D-030 개정 여부가 갈린다).

---

## 참고

- 결정 기록: `frontend/docs/decision/frontend-decisions.md` (특히 D-160~D-166)
- 개발 계획: `frontend/docs/plan/frontend-development-plan.md`
- 백엔드 실행과 Swagger: `backend/README.md`
