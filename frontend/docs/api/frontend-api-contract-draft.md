# 프론트엔드 API 계약

- 작성일 2026-09-17 · 개정 2026-09-21
- **기준 커밋: `origin/develop` `f441ea4`** (PR #59 병합 이후)
- 개발 계획의 M1-A 산출물

§2 와 §3.1 은 `backend/app` 을 읽고 적은 **사실**이다. §3.2 는 제품 결정이 없어 프론트엔드가 세운 가정이다.
§4 는 백엔드를 향한 절이며, 각 화면이 무엇을 호출하는지는 §5 에 있다.

> **2026-09-21 개정.** PR #59(`feature/58-backend-api-contract`)가 **§4.1~§4.5 를 실제로 구현했다.**
> PR #55(`fix/be-review-week6-1`)는 §2.6 의 `PATCH` 의미와 §3.1 의 게이트 판정을 바꿨다.
> 그래서 §4 는 성격이 달라졌다 — **「없는 것을 만들어 달라」가 아니라 「만들어진 것이 계약과 다르다」가 주류다.**
> 구현 현황은 §4.0 의 표 하나로 모았다.

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

**봉투 규약에 구멍이 두 개 생겼다** (PR #59). 둘 다 §4.0 에 요청으로 올렸다.

- `DELETE /workspaces/{id}/integrations/{provider}` 는 **204 로 본문이 없다.** 봉투가 아니다.
- `MeetingListResponse.items` 와 `MeetingMinutesResponse` 의 `attendees` · `transcript` · `summary` · `permissions` 가
  `list[dict]` · `dict` 로 선언돼 **Swagger 에 형태가 나오지 않는다.** 이 두 응답의 필드 이름은 이 문서(§4.4)가 유일한 출처다.

### 오류 코드

`backend/app/core/errors.py` 기준 **31개.** 괄호는 HTTP 상태 코드다.

```
INVALID_REQUEST(400)              MEETING_NOT_FOUND(404)
MEETING_ALREADY_ENDED(409)        MEETING_NOT_PROCESSING(409)
AUDIO_UPLOAD_FAILED(422)          AUDIO_FORMAT_UNSUPPORTED(422)
TRANSCRIPTION_FAILED(502)         EXTRACTION_FAILED(502)
EXTRACTION_NOT_FOUND(404)         APPROVAL_NOT_FOUND(404)
APPROVAL_ALREADY_RESOLVED(409)    NOTION_WRITE_FAILED(502)
WORKSPACE_NOT_FOUND(404)          WORKSPACE_MISMATCH(400)
MEMBER_NOT_FOUND(404)             MEMBER_ALIAS_NOT_FOUND(404)
TASK_NOT_FOUND(404)               TASK_HISTORY_NOT_FOUND(404)
TASK_HISTORY_ALREADY_ROLLED_BACK(409)
INTERNAL_ERROR(500)

// §4.9 로 요청했던 11개. PR #59 가 이름과 상태 코드까지 제안 그대로 추가했다
UNAUTHENTICATED(401)              FORBIDDEN(403)
EMAIL_ALREADY_EXISTS(409)         INVALID_CREDENTIALS(401)
WORKSPACE_NAME_DUPLICATED(409)    ONBOARDING_INCOMPLETE(403)
INTEGRATION_NOT_CONNECTED(409)    INTEGRATION_REVOKED(409)
MEETING_PROCESSING_IN_PROGRESS(409)
AUDIO_TOO_LARGE(413)              DISCORD_USER_ALREADY_MAPPED(409)
```

- `WORKSPACE_MISMATCH` 는 **400** 이다. 이전 판이 409 로 적은 것은 오류였다.
- 아래 3개는 **정의만 되고 아직 아무도 던지지 않는다.** 화면은 처리 경로를 갖되 실제로 오는지는 기대하지 않는다 → §4.0.
  `ONBOARDING_INCOMPLETE` · `INTEGRATION_REVOKED` · `AUDIO_TOO_LARGE`

---

## 2. 구현된 API

### 2.1 workspaces

| Method | Path | 비고 |
|---|---|---|
| POST | `/api/v1/workspaces` | 201 |
| GET | `/api/v1/workspaces` | **로그인 사용자의 소속만** |
| GET | `/api/v1/workspaces/{workspace_id}` | |

```jsonc
// POST 요청  {"name": "카테캠 3팀"}      1~100자
// 응답 / GET 단건
{"workspace_id": "ws_01", "name": "카테캠 3팀", "created_at": "2026-09-15T04:00:00Z"}

// GET 목록 — created_at 내림차순
{"items": [ ... ], "total": 2}
```

- **생성 본문이 `name` 하나다.** D-153 의 요청이 이미 충족돼 있다.
- ~~사용자 개념이 없어 목록이 전체 워크스페이스를 반환한다.~~ **PR #59 로 사용자 스코프가 생겼다.** `Member.user_id` 조인으로 소속만 반환한다 → §4.2.
- ~~`role`(pm/member)과 온보딩 진행 상태가 응답에 없다.~~ **둘 다 생겼고 목록 항목에도 들어온다.** `role` 은 `Optional` 이고 `onboarding` 은 스텁이다 → §4.0-②-3, §4.2.
- **`GET /workspaces/{workspace_id}` 에 멤버십 검사가 없다.** 로그인만 하면 남의 워크스페이스를 ID 로 읽는다 → §4.0-②-1.
- 이름 중복은 409 `WORKSPACE_NAME_DUPLICATED` 다. 다만 **완전일치 + 전역** 비교라 D-015~D-020 과 다르다 → §4.0-②-2.

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
- 따라서 **팀원 연결 화면의 데이터 출처가 D-026 의 전제와 다르다** → §4.5 에서 엔드포인트 하나를 요청한다.
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
- ~~`progress` 가 응답에서 빠졌다.~~ **PR #59 가 §4.7-1 을 반영했다.** `progress`(audio_merged·transcribed·extracted)가 **필수 필드**로 온다. 진행률 UI 가 이 값을 쓴다.
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
  **`≥0.8` 이 `auto` 의 충분조건이 아니다.** `needs_check` 면 점수와 무관하게 `review` 로 내려간다 (PR #55) → §3.1.
- **생성 시점에는** `task_id` 와 `approval_id` 가 배타적으로 채워진다. `gate=auto` 면 `task_id`, `review`·`hold` 면 `approval_id`.
- **승인 뒤에는 배타적이지 않다.** `PATCH /approvals/{id}` 로 승인하면 백엔드가 `extraction_item.task_id` 를 채우면서
  **`approval_id` 를 비우지 않는다.** 같은 항목이 두 ID 를 동시에 갖는다 → §3.1, §4.0-②-12.
  화면은 `task_id` 를 우선으로 읽어 `task_id` 가 있으면 `반영됨` 으로 다룬다 (§6).
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

- `task_create` → `task_title`(없으면 `title`), `meeting_id`, `assignee_member_id`, `due_date`, **`status`, `progress`**
  뒤의 둘은 PR #55 가 추가했다. `validate_task_fields` 를 거치므로 **잘못된 값이면 승인이 400 으로 실패한다.**
  반영 뒤 `extraction_item.task_id` 도 채워진다 (§3.1).
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
 "start_date": "2026-09-15",            // §4.7-6 반영됨. nullable
 "due_date": "2026-09-20",
 "notion_page_id": null,
 "created_at": "...", "updated_at": "..."}

// POST 요청 {workspace_id, title, meeting_id?, assignee_member_id?, start_date?, due_date?,
//            status?, progress?, blocker?, created_by?}
// PATCH 요청 {title?, assignee_member_id?, status?, progress?, blocker?,
//            start_date?, due_date?, changed_by?}

// TaskHistoryResponse — created_at 내림차순
{"history_id": "hs_01", "task_id": "tk_01",
 "changed_field": "due_date",           // assignee|start_date|due_date|status|title|progress|blocker
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
- `created_by` · `changed_by` · `resolved_by` 를 **프론트엔드가 직접 실어 보낸다.**
  ~~세션이 없으므로~~ **세션은 PR #59 로 생겼지만 `tasks` · `approvals` 가 아직 쓰지 않는다.** 서버가 actor 를 유추하도록 바꿔 달라 → §4.0.
- 되돌리기는 이미 되돌린 기록이면 409 `TASK_HISTORY_ALREADY_ROLLED_BACK`.

**PR #55 가 바꾼 것 — 조용하지만 중요하다**

- **`PATCH` 가 명시적 `null` 을 필드 해제로 받는다.** 이전에는 `exclude_none=True` 라서 `{"due_date": null}` 이 **무시**됐다.
  이제 같은 요청이 마감을 **지운다.** 담당자 해제·마감 해제·블로커 해제가 `PATCH` 하나로 된다는 뜻이고,
  반대로 **부분 갱신에서 실수로 `null` 을 실어 보내면 값이 날아간다.** 화면은 보내지 않을 필드를 `undefined` 로 빼야 한다.
  `PATCH` 본문을 조립할 때 `JSON.stringify` 가 `undefined` 키를 지우는 동작에 기대는 것이 안전하다.
- **`changed_field` 에 `start_date` 가 추가됐다** (`ChangedField.START_DATE`). 시작일 변경도 이력과 되돌리기 대상이다.
- 승인 반영 시 `TASK_CREATE` 가 원본 `extraction_item.task_id` 를 채운다. §2.4 의 항목이 승인 후 `task_id` 를 갖게 되므로
  **회의록의 「반영된 태스크」를 승인 직후에도 `extraction` 재조회로 조립할 수 있다.**
- 승인의 워크스페이스와 대상 태스크의 워크스페이스가 다르면 400 `WORKSPACE_MISMATCH` 다.

---

## 3. 파이프라인이 화면을 가르는 방식

### 3.1 게이트 — `확인 필요` 가 생기는 지점

`POST /extractions` 가 항목마다 신뢰도로 게이트를 판정하고 **두 갈래로 나눈다.**

```
추출 항목
  confidence = min(task, assignee, due)
  needs_check = 미검증 별칭 · 중의성 등            <- PR #55 가 추가
      |
      +- >= 0.8 이고 needs_check 아님
      |          gate=auto        -> create_task() 즉시 실행, task_history 에 is_auto=true 로 기록
      |                              extraction_item.task_id 채워짐
      |                              화면: 회의록의 "반영된 태스크", 대시보드 "최근 반영"
      |
      +- >= 0.8 인데 needs_check
      |          gate=review      -> 점수가 높아도 AUTO 로 가지 않는다. 아래와 같은 경로
      |
      +- <  0.8  gate=review|hold -> ApprovalRequest(type=task_create) 생성
                                     extraction_item.approval_id 채워짐, related_task_id 는 null
                                     화면: "확인 필요"
                                     PATCH /approvals/{id} 로 승인하면 그때 create_task() 가 돌고
                                     related_task_id 가 채워진다
```

이 구조가 D-101(확실한 항목은 즉시 반영, 확인 필요는 승인 후 반영)과 그대로 맞는다.

**PR #55 로 `confidence >= 0.8` 이 더 이상 `auto` 의 충분조건이 아니다.**
`decide_gate(confidence, needs_check=)` 가 미검증 별칭·중의성이면 점수와 무관하게 `review` 로 내린다.
**`확인 필요` 에 높은 신뢰도 항목이 섞일 수 있다.** 신뢰도 순으로 정렬해 낮은 것만 의심하는 UI 는 쓰지 않는다.
1인칭 발화(`assignee_type == "first"`)는 `evidence_speaker` 를 화자로 보고 담당자를 매칭한다.

> **`task_id` XOR `approval_id` 는 생성 시점에만 성립한다.**
> 이전 판은 이 배타성을 화면이 기댈 불변식으로 적었다. **승인 뒤에는 깨진다.**
>
> ```python
> # approvals.py — task_id 를 채우고 approval_id 는 그대로 둔다
> ext_item.task_id = task.task_id
> # extractions.py — 둘 다 응답에 실린다
> task_id=i.task_id, approval_id=i.approval_id
> ```
>
> 그대로 두면 승인된 항목이 **`반영됨` 과 `확인 필요` 양쪽에 동시에** 나타나고,
> D-104 로 `approval_id` 있는 항목을 숨기는 일반 팀원에게는 **영원히 보이지 않는다.**
>
> - **백엔드 요청** — 승인 반영 시 `extraction_item.approval_id` 를 `null` 로 비워 달라 (§4.0-②-12).
> - **프론트엔드 대응** — 답을 기다리지 않는다. `확인 필요` 의 기준을
>   `approval_id != null` 에서 **`approval_id != null 이고 task_id == null`** 로 바꾼다.
>   `task_id` 가 우선이므로 백엔드가 비우든 안 비우든 같은 결과가 나온다 (§6).

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
- **보드의 컬럼도 같은 축이다.** `확인 필요`·`진행 중`·`완료` 3컬럼이며 위 표를 그대로 쓴다 (D-169, §5.6).

---

## 4. 백엔드 요청

**이 절만 백엔드를 향한다.** §1~§3 은 이미 구현된 것이고(§3.2 만 예외로 가정이다), §5~§8 은 프론트엔드가 지킬 규약이다.

원칙은 D-160 이다. 이미 구현된 엔드포인트와 스키마의 **변경·삭제·이름 변경을 요청하지 않는다.**
요청은 추가이거나 기존 필드의 의미 확정에 그친다.

- **§4.0** — **구현 현황.** 2026-09-21 개정으로 새로 생긴 절이다. 여기부터 읽는다.
- **§4.1~§4.5** — 요청했던 API 의 형태. **대부분 구현됐다.** 각 절 머리에 구현 상태를 적었다.
- **§4.6** — 이전 판에서 요청했다가 **철회**하는 것.
- **§4.7** — 이미 있는 것에 붙이는 증분 **6건**.
- **§4.8** — 프론트엔드가 답을 기다리지 않고 고정한 가정 5건.
- **§4.9** — §4.1~§4.5 에 필요했던 오류 코드. **전부 추가됐다.**

### 4.0 구현 현황 (2026-09-21)

PR #59 가 §4.1~§4.5 를 구현했다. **요청의 성격이 바뀌었다** — 이제 대부분은 「만들어 달라」가 아니라
「만들어진 것이 계약과 다르다」다. 세 갈래로 나눈다.

**① 계약대로 구현됨 — 프론트엔드가 그대로 쓴다**

| 계약 | 구현 |
|---|---|
| §4.1 `signup` · `login` · `logout` · `me` | `api/auth.py`. PBKDF2, `session` 테이블 |
| §4.1 세션 요구 3가지 (D-165) | **3개 다 충족.** `httponly` · `samesite=lax` · `secure`, 로그아웃 즉시 삭제, 토큰은 opaque random 이라 역할이 안 담긴다. **단 그 세션을 요구하는 라우터가 절반뿐이다** → ②-1 |
| §4.2 `GET /workspaces` 사용자 스코프 | `Member.user_id` 조인으로 소속만 반환 |
| §4.2 `role` | `MemberRole` = `pm` \| `member`. 제안 그대로 |
| §4.4 `GET /workspaces/{id}/meetings` | `started_at` 내림차순, `failed` 제외까지 맞다 (D-093, D-106) |
| §4.4 `POST .../meetings/upload` | multipart, 202, 409 `MEETING_PROCESSING_IN_PROGRESS` + `details.meeting_id` |
| §4.5 Discord 유일 제약 (D-027) | `UniqueConstraint(workspace_id, discord_user_id)` + 409 `DISCORD_USER_ALREADY_MAPPED` |
| §4.7-1 `progress` | `MeetingProgress{audio_merged, transcribed, extracted}` 복구 |
| §4.7-2 `started_at` 사용자 지정 | 업로드 요청 값을 그대로 저장 |
| §4.7-6 `task.start_date` | 모델 · 응답 · POST · PATCH · `ChangedField` 전부 |
| §4.9 오류 코드 11개 | 이름과 상태 코드까지 제안 그대로 |

**② 구현됐지만 계약과 다르다 — 이 15건이 새 요청 목록이다**

| # | 대상 | 현재 | 요청 |
|---|---|---|---|
| 1 | **인증 전반** | **절반만 걸려 있다.** 아래 표 참조 | 프론트가 쓰는 모든 엔드포인트에 `get_current_user` · `get_current_member` 를 걸어 달라 |
| 2 | 워크스페이스 이름 중복 | 완전일치 + **전역** 비교 | 앞뒤 공백 제거 · 연속 공백 축약 후 **대소문자는 구분한 채** **같은 계정 안에서만** 비교 (D-015~D-020) |
| 3 | `onboarding` | **스텁이다.** `current_step` 이 하드코딩, `steps` 가 고정, `skipped` 가 절대 안 나온다 | 단계별 상태를 실제로 저장. `PATCH .../onboarding` 의 `skip` 이 동작해야 한다 (D-008, D-012) |
| 4 | `onboarding.current_step` | 완료 시 **빈 문자열** `""` | 완료 시 `null` |
| 5 | 온보딩 미완료 대시보드 접근 | 검사가 없다 | 403 `ONBOARDING_INCOMPLETE` + `details.current_step` (D-071) |
| 6 | `GET /integrations` | `status` 가 `connected` \| `not_connected` **둘뿐.** `revoked` 가 절대 안 나온다 | **`revoked` 를 구분해 달라.** 미연결과 끊김은 다른 모달이다 (D-097, D-100) |
| 7 | `integration.display_name` | `"Discord 연결됨"` 같은 **생성 문자열** | 실제 서버 · 워크스페이스 이름 |
| 8 | `DELETE .../integrations/{provider}` | **204, 본문 없음** | 봉투로 (§1) |
| 9 | `POST .../meetings/upload` | `attendee_member_ids` 를 **받고 버린다.** 파일도 저장하지 않는다(TODO) | 참석자 저장 (D-085, D-086). Notion 미연결 409 `INTEGRATION_NOT_CONNECTED` (D-096), 용량 초과 413 `AUDIO_TOO_LARGE` |
| 10 | `GET .../discord/members` | **하드코딩 2명** (`disc_01`, `disc_02`) | 연결된 서버의 실제 사용자 목록 |
| 11 | `GET /meetings/{id}/minutes` | `transcript` 가 **하드코딩 1줄.** `attendees` 는 `audio_segment` 에서 역산 | §4.7-5 의 구조화 응답. 참석자는 회의 참석자 명단에서 |
| 12 | 승인 반영 | `extraction_item.task_id` 를 채우되 **`approval_id` 를 비우지 않는다** | 승인 시 `approval_id` 를 `null` 로. 안 되면 프론트가 `task_id` 우선으로 우회한다 (§3.1) |
| 13 | 승인 `task_create` | payload 의 `status` · `progress` 도 읽어 반영한다 | 요청이 아니라 **기록**이다. §2.5 의 payload 설명에 빠져 있었다 |
| 14 | `GET /workspaces/{id}/meetings` | `title` 이 nullable 인데 `items: list[dict]` 라 스키마에 안 드러난다 | 목록 `title` 의 nullable 여부를 스키마로 고정해 달라. 프론트 DTO 는 지금 필수 `string` 이다 |
| 15 | `GET /members/unresolved-aliases` | 해결 판정이 **`verified` 별칭 정확히 1개**다. 미검증·복수 verified 는 목록에 남는다 | 요청이 아니라 기록이다. MSW 가 고정 배열이라 이 전이를 재현하지 못한다 |

**①-1 의 실제 범위** — PR #59 가 인증을 넣었지만 라우터별로 적용이 갈린다. `main.py` 에 전역 미들웨어도 없다.

| 라우터 | 인증 의존성 | 상태 |
|---|---|---|
| `workspaces.py` | 7곳 | 걸려 있다. 단 `GET /{workspace_id}` 는 **멤버십을 안 본다** |
| `integrations.py` | 4곳 | 걸려 있다 |
| `meetings.py` | 2곳 | `/minutes` 만. `GET /meetings/{id}` 등은 열려 있다 |
| `tasks.py` | **0** | 조회 · 생성 · 수정 · 되돌리기 전부 **비로그인 가능** |
| `approvals.py` | **0** | 조회 · 승인 · 반려 전부 비로그인 가능 |
| `extractions.py` | **0** | 열려 있다 |
| `members.py` | **0** | `get_current_member` 를 **import 만 하고 쓰지 않는다** |

**이 사실이 프론트엔드 설계에 주는 것.** 라우터 가드는 **UX 장치이지 보안 경계가 아니다.**
서버가 막아 준다고 가정하고 가드를 느슨하게 만들면 안 된다. 반대로 가드를 촘촘히 해도 API 는 그대로 열려 있다.
**이것은 프론트엔드가 해결할 수 없는 문제이며, 위 표를 그대로 백엔드에 전달한다.**

**③ 아직 없다**

| 계약 | 상태 |
|---|---|
| §4.1 Google OAuth `start` · `callback` (302) | 미구현. 로컬 이메일·비밀번호 경로만 있다 |
| §4.3 integrations `start` · `callback` (302) | 미구현. 연결을 만들 방법이 API 에 없다 |
| §4.7-3 `failed_stage` 값 구분 | 미구현. 자유 문자열 그대로 |
| §4.7-4 요약 저장 | **절반.** `Extraction.summary` 컬럼은 생겼고 `/minutes` 가 읽지만, 채우는 쪽이 없다 |
| §4.7-5 transcript 구조화 | 미구현 (②-11) |
| §2.6 actor 유추 | 미구현. `created_by` · `changed_by` · `resolved_by` 를 여전히 프론트엔드가 실어 보낸다 |

**프론트엔드에 주는 영향**

- **M1 산출물은 그대로 유효하다.** `entities` 타입과 mapper 는 §4.1~§4.5 를 미리 가정해 두었고, 실제 구현이 그 가정과 이름·형태가 맞다.
- 스텁(②-3, ②-10, ②-11)에 걸리는 화면은 **M4 · M5 다.** 그때까지 채워지지 않으면 MSW 로 개발하고 실 API 연결을 뒤로 미룬다.
- ②-1 은 보안 문제이므로 화면 일정과 무관하게 먼저 올린다.
- ①의 `WorkspaceResponse.role` 은 `Optional` 이다. 목록에서는 항상 채워지지만 상세에서는 `null` 이 가능하다.
  프론트엔드 DTO 는 필수 `string` 으로 두고 mapper 가 `member` 로 폴백한다 (§6).

### 4.1 auth

~~세션과 사용자 개념이 백엔드에 전혀 없다.~~ **PR #59 로 생겼다.** `user` · `session` 테이블과 `api/auth.py`.

| Method | Path | 비고 | 구현 |
|---|---|---|---|
| POST | `/api/v1/auth/signup` | **201** | ✅ |
| POST | `/auth/login` · `/auth/logout` | | ✅ |
| GET | `/api/v1/auth/me` | | ✅ |
| GET | `/api/v1/auth/google/start?state=` · `/auth/google/callback` | **302** | ❌ 미구현 |

```jsonc
// signup 요청 {"email", "password", "name"}   login 요청 {"email", "password"}
// signup · login · me 의 응답 data
{"user": {"user_id": "us_01", "email": "pm@example.com", "name": "최진호", "avatar_url": null},
 "workspace_count": 2,
 "last_workspace_id": "ws_01"}
```

- `workspace_count` 로 로그인 후 이동을 분기한다. `0` 이면 온보딩, `1` 이면 대시보드, `2` 이상이면 선택 화면 (D-010).
  구현은 `Member` 행 수를 센다. `last_workspace_id` 는 가장 최근에 만들어진 멤버십이다.
- **세션 요구사항 3가지** (D-165) — **셋 다 충족됐다.** 토큰 형식은 백엔드가 정하며 **JWT 를 요구하지 않았다.**
  1. Secure·HttpOnly 쿠키, `SameSite=Lax`. 응답 본문에 토큰을 담지 않는다. → ✅ `set_cookie(httponly, samesite="lax", secure=True)`
  2. 로그아웃 시 즉시 무효화한다. → ✅ `session` 행을 삭제하고 쿠키를 지운다
  3. **토큰과 세션에 역할·권한을 담지 않는다.** → ✅ `secrets.token_urlsafe(32)` 의 opaque 값이라 담길 수 없다.
     권한은 `get_current_member` 가 요청마다 멤버십에서 조회한다 — **다만 그 의존성을 건 라우터에 한해서다.** `tasks` · `approvals` · `extractions` · `members` 에는 걸려 있지 않다 (②-1)
- OAuth 는 본문 없는 302 다. `state` 에 복귀 경로를 담는다 (D-158). → ❌ 미구현. 로그인 화면의 Google 버튼은 M4 에서 비활성으로 둔다.
- 미인증 요청은 401 `UNAUTHENTICATED`. → ✅ `deps.get_current_user`
- 쿠키가 `secure=True` 라서 **HTTPS 가 아니면 브라우저가 저장하지 않는다.** `localhost` 는 예외로 허용되므로 Vite 프록시 경유 개발은 된다.

### 4.2 워크스페이스의 사용자 스코프 · 역할 · 온보딩

~~`GET /workspaces` 가 **전체 워크스페이스**를 반환한다.~~ **세 가지 모두 PR #59 가 넣었다.** 온보딩만 스텁이다.

| 필요한 것 | 형태 | 구현 |
|---|---|---|
| 로그인 사용자의 소속만 반환 | `GET /workspaces` 의 동작 변경 | ✅ |
| 워크스페이스별 내 역할 | `WorkspaceResponse` 에 `"role": "pm" 또는 "member"` | ✅ 단 `Optional` |
| 온보딩 진행 상태 | 아래 | ⚠️ **스텁** (§4.0-②-3) |

**`role` 과 `onboarding` 은 목록에도 들어온다.** 요청은 상세에만 했는데 `GET /workspaces` 의 각 항목에도 있다.
프론트엔드에는 이득이라 그대로 쓴다 — 선택 화면이 워크스페이스마다 상세를 다시 부르지 않아도 된다.

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

- `step` 은 `create_workspace`, `connect_discord`, `connect_notion`, `connect_members` 순서 고정 (D-008). → ✅ 이름과 순서 그대로
- `status` 는 `pending`, `completed`, `skipped`. 건너뛴 단계는 재개 대상에서 제외한다 (D-012).
  → ⚠️ **`skipped` 가 절대 오지 않는다.** `steps` 가 `onboarding_completed` 불리언 하나로 생성되고, `PATCH` 는 `connect_members` + `complete` 조합만 반응한다.
  `skip` 액션은 받아들이고 아무 일도 하지 않는다. **단계별 상태가 저장되지 않는다** (§4.0-②-3).
- `current_step` 은 완료 시 `null` 을 기대했는데 **빈 문자열** `""` 이 온다 (§4.0-②-4).
  프론트엔드 mapper 는 `''` 를 `null` 과 같게 다룬다 (§6).
- **이름 중복 검증이 없다.** → ⚠️ **409 는 생겼지만 비교 방식이 다르다.** 완전일치 + **전역** 비교다.
  같은 계정 안에서 앞뒤 공백 제거·연속 공백 축약 후 중복을 막아 달라 (D-015~D-020). 409 `WORKSPACE_NAME_DUPLICATED`.
  지금은 **남이 쓴 이름도 막힌다.** 반대로 `"팀 A"` 와 `"팀  A"` 는 둘 다 통과한다.
  **대소문자는 구분한다.** D-019 가 `Alpha` 와 `alpha` 를 서로 다른 이름으로 정했다. 이전 판이 `대소문자 무시` 를 요청한 것은 **D-019 와 어긋난 오류**였다.
  이 점에서는 백엔드의 완전일치 비교가 이미 맞다.
- 온보딩 미완료 워크스페이스의 대시보드 접근은 403 `ONBOARDING_INCOMPLETE` 와 `details.current_step` (D-071).
  → ❌ 코드는 정의됐지만 던지는 곳이 없다. **가드는 M3 에서 프론트엔드가 `onboarding.completed` 로 먼저 판단한다.**

### 4.3 integrations

~~Discord·Notion 연결 상태를 다루는 API 가 없다.~~ **조회와 해제는 생겼고 연결은 없다.**
`integration` 테이블이 `UniqueConstraint(workspace_id, provider)` 로 워크스페이스당 provider 하나를 보장한다.

| Method | Path | 구현 |
|---|---|---|
| GET | `/api/v1/workspaces/{workspace_id}/integrations` | ⚠️ `revoked` 안 옴 |
| GET | `/api/v1/workspaces/{workspace_id}/integrations/{provider}/start?state=` (**302**) | ❌ |
| GET | `/api/v1/workspaces/{workspace_id}/integrations/{provider}/callback` (**302**) | ❌ |
| DELETE | `/api/v1/workspaces/{workspace_id}/integrations/{provider}` | ⚠️ 204, 본문 없음 |

**`start` · `callback` 이 없어서 API 로는 연결을 만들 수 없다.** 온보딩 2·3단계(Discord·Notion 연결)가
M4 에서 실 API 로 완결되지 않는다. 그때까지 MSW 로 진행한다.

```jsonc
{"discord": {"status": "connected", "display_name": "카테캠 3팀 서버",
             "connected_at": "2026-09-15T05:00:00Z"},
 "notion":  {"status": "not_connected", "display_name": null, "connected_at": null}}
```

- `status` 는 `not_connected`, `connected`, `revoked` 3가지다.
  **`not_connected` 와 `revoked` 를 구분해 달라.** 미연결은 `Notion 연결이 필요해요`(D-097), 끊김은 `Notion 연결이 끊어졌어요`(D-100) 로 다른 모달을 띄운다.
  → ⚠️ 구현은 `integration` 행의 **존재 여부만** 본다. 행이 있으면 `connected`, 없으면 `not_connected` 다.
  **`revoked` 를 표현할 컬럼이 없다.** 끊김 모달(D-100)은 실 API 로 뜨지 않는다. 프론트엔드는 세 값을 계속 다룬다.
- `display_name` 이 `"Discord 연결됨"` 같은 **생성 문자열**이다 (§4.0-②-7). 화면에 그대로 쓸 수 없다.
  연동 카드는 provider 이름을 프론트엔드가 쓰고, `display_name` 은 실제 값이 올 때까지 표시하지 않는다.
- 연결 요청에 본문이 없다. Notion 은 OAuth 만 수행하고 데이터베이스 선택 화면을 만들지 않는다 (D-154). → 연결 경로 자체가 아직 없다.

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

- 409 `MEETING_PROCESSING_IN_PROGRESS` 와 `details.meeting_id` — 워크스페이스에 처리 중인 회의가 있다 (D-088, D-089). → ✅ 그대로
- 409 `INTEGRATION_NOT_CONNECTED` — Notion 미연결 (D-096, D-097). → ❌ 검사가 없다
- 413 `AUDIO_TOO_LARGE` → ❌ 검사가 없다. 코드만 있다
- ⚠️ **`attendee_member_ids` 를 받고 버린다.** `Form(...)` 으로 필수로 받지만 저장하지 않는다.
  D-085·D-086 의 「로컬 업로드는 참석자 1명 이상」이 서버에서 보장되지 않는다. 프론트엔드가 폼에서 강제한다.
- ⚠️ **파일도 저장하지 않는다** (`# TODO: 파일 저장 및 큐 전송`). 업로드는 `processing` 회의 행만 만든다.
  회의는 영원히 `processing` 에 머무르며, 이 상태가 **다음 업로드를 409 로 막는다.**
- `source` 가 `"manual_upload"` 로 고정된다. `MeetingSource` = `discord` \| `manual_upload` 그대로다 (D-157).
- `started_at` 을 보내지 않으면 서버 시각이 된다. 프론트엔드는 **항상 보낸다** (D-079, D-164).

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
- `speaker_display_name` 이 `null` 이면 `speaker_fallback` 으로 표시한다 (D-028). → 필드 이름 3개 그대로 구현됐다
- 일반 팀원에게 `확인 필요` 영역을 숨긴다. **개수와 존재 여부도 노출하지 않는다** (D-104). 프론트엔드가 `approval_id` 가 있는 항목을 걸러 낸다.
- `permissions` 는 `member.role == 'pm'` 을 `can_review` · `can_undo` 두 값에 그대로 넣는다. 둘이 항상 같다.
- ⚠️ **`transcript` 가 하드코딩 1줄이다** (§4.0-②-11). `at_ms: 0`, 화자 없음, 안내 문구 한 줄.
  `extraction` 이 없으면 빈 배열이다. 필드 **이름과 형태는 계약대로**이므로 mapper 는 그대로 쓸 수 있고, 값만 비어 있다.
- ⚠️ `attendees` 를 `audio_segment` 의 화자에서 역산한다. 말하지 않은 참석자가 빠지고, 로컬 업로드는 세그먼트가 없어 **빈 배열**이 된다.
- ⚠️ `summary` 는 `Extraction.summary` 컬럼(TEXT)을 `json.loads` 한다. **채우는 쪽이 아직 없어 항상 `null`** 이다 (§4.7-4).
- 비소속 사용자는 403 `FORBIDDEN` 이다. `MEETING_NOT_FOUND` 가 아니라 존재는 드러난다.

### 4.5 Discord 서버 사용자 목록

~~팀원 연결 화면(온보딩 4단계)의 데이터 출처가 없다.~~ **엔드포인트는 생겼고 내용이 스텁이다.**

| Method | Path | 구현 |
|---|---|---|
| GET | `/api/v1/workspaces/{workspace_id}/discord/members` | ⚠️ 하드코딩 2명 |

```jsonc
{"items": [{"discord_user_id": "1123...",
            "username": "seoyeon_01",
            "display_name": "서연",        // Discord 서버 별명, 없으면 null
            "avatar_url": "https://cdn.discordapp.com/...",
            "is_bot": false}],
 "total": 7}
```

- 연결된 Discord 서버의 현재 사용자 목록이다. 봇은 `is_bot: true` 로 표시해 프론트엔드가 거른다.
  → ⚠️ 구현은 `disc_01` · `disc_02` 두 명을 **상수로 반환한다** (`# 향후 Discord API 연동 시 실제 멤버 목록으로 교체`).
  필드 5개는 계약대로다. 온보딩 4단계를 실 API 로 검증할 수는 없다.
- Discord 미연결이면 409 `INTEGRATION_NOT_CONNECTED`. → ✅ `details.provider` 까지 온다

**매핑은 새 엔드포인트가 필요 없다.** 기존 것을 그대로 쓴다.

| 동작 | 호출 |
|---|---|
| 팀원 생성과 동시에 Discord 사용자 연결 | `POST /api/v1/members` `{workspace_id, display_name, discord_user_id}` |
| 이미 있는 팀원에 연결 | `PATCH /api/v1/members/{member_id}` `{discord_user_id}` |
| 연결 해제 | `PATCH /api/v1/members/{member_id}` `{discord_user_id: null}` |
| 매핑 현황 | `GET /api/v1/members?workspace_id=` 의 `discord_user_id` 와 위 목록을 클라이언트에서 조인 |

- 한 Discord 사용자가 두 팀원에 붙지 않도록 **`member.discord_user_id` 에 워크스페이스 범위 유일 제약**을 걸어 달라 (D-027). 위반은 409 `DISCORD_USER_ALREADY_MAPPED`.
  → ✅ **`UniqueConstraint(workspace_id, discord_user_id)`** + `POST`·`PATCH` 양쪽에 사전 검사. 요청 그대로다.
- 부분 매핑을 허용한다. 일부만 연결한 상태로 저장하고 온보딩을 완료할 수 있다 (D-029).
  → ✅ `discord_user_id` 가 nullable 이고 SQL 은 `NULL` 을 서로 다르게 보므로 미연결 팀원이 여럿이어도 제약에 걸리지 않는다.
- 서버를 나간 사용자는 이 목록에서 빠지지만 `member` 행과 과거 회의록의 화자 정보는 남는다 (D-031). 프론트엔드가 `members` 에는 있고 Discord 목록에는 없는 사용자를 `비활성` 으로 표시한다.
- 신규 사용자는 이 목록에 자동으로 나타난다 (D-030).

**PR #59 가 `member` 에 소프트 삭제를 넣었다** (`is_deleted` · `deleted_at`). `GET /members` 는 삭제된 행을 제외한다.
여기에 제약과 어긋나는 구멍이 하나 있으니 백엔드에 알린다.

- 사전 검사는 `is_deleted == False` 만 보는데 **DB 유일 제약은 삭제된 행까지 본다.**
  탈퇴한 팀원의 Discord 사용자를 새 팀원에 다시 붙이면 409 가 아니라 **`IntegrityError` → 500** 이 난다.
  삭제 시 `discord_user_id` 를 `null` 로 비우거나, 제약에 `is_deleted` 를 포함해 달라.
- `MemberResponse` 에는 `is_deleted` 가 없다. 프론트엔드는 목록에서 빠지는 것으로만 삭제를 안다. 그대로 괜찮다.

**`GET /members/unresolved-aliases` 는 이 화면이 아니다.**
그 API 는 회의 전사에서 감지됐지만 팀원과 연결되지 않은 **이름 문자열**을 준다(§2.2). 회의를 한 번도 돌리지 않은 온보딩 시점에는 비어 있다.
운영 중 `워크스페이스 설정 > 팀원` 에서 **회의에 나왔지만 매칭 안 된 이름**을 보여주고 `POST /members/{member_id}/aliases` 로 붙이는 보조 화면에 쓴다. 두 화면은 목적이 다르다.

### 4.6 대시보드 — 요청하지 않는다

이전 판은 `GET /workspaces/{id}/dashboard` 집계 엔드포인트를 요청했다. **철회한다.**

목록 API 에 페이지네이션이 없어 전량이 오므로, 상단 숫자 4개와 두 목록을 **프론트엔드가 기존 API 로 계산할 수 있다.** 계산 방법은 §5.4 에 적었다.

집계 API 를 요청했던 이유는 `목록에는 5개만 보여도 상단 숫자는 전체 개수여야 한다`(D-052~D-054) 였는데, 전량이 오면 이 문제가 성립하지 않는다.

- `GET /approvals?workspace_id=&status=pending` 의 `total` 이 필터를 반영한다.
- `GET /tasks?workspace_id=` 가 워크스페이스의 태스크 전량을 준다.

대시보드에 추가로 필요한 것은 **회의 목록(§4.4)뿐**이었고 그것은 **PR #59 로 구현됐다.**
데이터가 커져 페이지네이션이 도입되면 이 판단을 다시 한다(§8).

### 4.7 기존 구현에 대한 증분 요청 — 6건

**6건 중 3건이 반영됐다** (PR #59). 1 · 2 · 6 이 끝났고 4 는 절반, 3 · 5 는 그대로다.

| # | 대상 | 요청 | 상태 | 이유 |
|---|---|---|---|---|
| 1 | `GET /meetings/{id}` | `audio_merged` · `transcribed` · `extracted` 를 다시 내려 달라 | ✅ **반영.** `MeetingProgress` 로 **필수** 필드다 | 모델에는 있는데 API 에 없었다. `status` 만으로는 진행률 UI 를 그릴 수 없다 (D-094) |
| 2 | `meeting.started_at` | 업로드 요청의 사용자 지정 날짜를 그대로 저장 | ✅ **반영.** `started_at or now` | 지난 녹음을 나중에 올리면 회의 날짜가 업로드 날짜가 된다. 목록 정렬이 깨진다 (D-079, D-106, D-164) |
| 3 | `meeting.failed_stage` | Notion 연결 끊김을 구분할 수 있는 값 포함 | ❌ 자유 문자열 그대로. 봇이 `"STT"` · `"LLM"` 같은 값을 보낸다 | 차단 모달(D-100)과 오류 토스트(D-092)로 화면이 갈린다 |
| 4 | `extraction` | 회의 요약을 저장할 컬럼 또는 테이블 | ⚠️ **절반.** `Extraction.summary`(TEXT, JSON 문자열) 컬럼이 생겼고 `/minutes` 가 읽는다. **채우는 쪽이 없다** | 회의록 상세의 요약 영역에 데이터 출처가 없다 (D-156) |
| 5 | `extraction.transcript_path` | 화자·시각이 붙은 구조화 응답으로 제공 | ❌ `/minutes` 의 `transcript` 가 하드코딩 1줄이다 | 브라우저가 서버 파일을 읽을 수 없다. `audio_segment` 에 화자와 구간이 이미 있다 (D-028, D-105) |
| 6 | `task` | `start_date` (nullable, `YYYY-MM-DD`) 를 응답과 `POST`·`PATCH` 에 추가 | ✅ **반영.** `TaskResponse` · `POST` · `PATCH` · `ChangedField.START_DATE` 전부 | 간트차트에 기간 축이 없다. `due_date` 만으로는 막대를 그릴 수 없다 (D-016, D-170) |

되돌리기는 요청 목록에서 빠졌다. `POST /tasks/{task_id}/history/{history_id}/rollback` 이 **이미 구현돼 있다**(§2.6).

**6번이 반영되면서 딸려 온 것.** `ChangedField` 에 `start_date` 가 들어갔으므로 시작일 변경도
`task_history` 에 기록되고 **되돌리기 대상**이 된다. §2.6 의 `changed_field` 목록에 반영했다.
`start_date` 컬럼은 방금 생겨 **기존 태스크 행은 모두 `null`** 이다. 그래서 §4.8-5 의 폴백은 사라지지 않는다.

### 4.8 프론트엔드가 고정한 가정

백엔드가 답을 주기를 기다리지 않고 프론트엔드가 정했다. **다르면 알려 달라.** 고칠 범위는 `entities` 계층이다.

| # | 항목 | 고정한 내용 | 근거 |
|---|---|---|---|
| 1 | Notion 반영 여부 | `task.notion_page_id` 가 `null` 이 아니면 반영 완료로 본다 | 다른 판단 근거가 스키마에 없다 |
| 2 | Notion 반영 시각 | 별도 필드를 요청하지 않는다. `task_history` 의 해당 변경 시각을 쓴다 | 반영은 태스크 변경과 함께 일어난다 |
| 3 | Notion URL | 요청하지 않는다. `notion_page_id` 로 프론트엔드가 URL 을 만든다 | 페이지 ID 만으로 링크가 성립한다 |
| 4 | `todo`·`blocked` 가 속할 탭 | 완료가 아닌 태스크를 모두 `진행 중` 탭에 넣는다 | 시안의 탭 개수 `13 = 3 + 7 + 3` (§3.2) |
| 5 | 태스크의 시작일 | `start_date` 가 `null` 이면 `created_at` 의 날짜 부분을 시작일로 본다 | §4.7-6 이 반영됐으므로 **폴백으로만 남는다** (D-170) |

3번이 틀리면(예: 워크스페이스마다 도메인이 다르다) 링크만 깨진다. 화면은 그대로 동작한다.

**5번은 §4.7-6 이 반영되면서 「가정」에서 「폴백」으로 내려갔다.** 없어지지는 않는다.

- `start_date` 는 **항상 응답에 들어온다.** 「없거나 `null`」 중 **「없다」는 경우가 사라졌다.** `null` 만 남는다.
- 컬럼이 방금 추가돼 **기존 태스크 행은 전부 `null`** 이고, 봇이 만드는 태스크도 `start_date` 를 보내지 않는다.
  폴백은 앞으로도 대부분의 태스크에 적용된다.
- 도메인 `Task.startDate` 는 계속 **비어 있지 않은 `string`** 이다. mapper 만 이 폴백을 안다.

### 4.9 신규 API 에 필요한 오류 코드 — **전부 추가됐다**

§4.1~§4.5 에서 쓴다. ~~이름과 상태 코드는 제안이며 백엔드가 조정해도 된다.~~
**PR #59 가 11개를 제안한 이름과 상태 코드 그대로 넣었다.** 조정된 것이 없다. §1 의 목록에 합쳤다.

```
UNAUTHENTICATED(401)            FORBIDDEN(403)
EMAIL_ALREADY_EXISTS(409)       INVALID_CREDENTIALS(401)
WORKSPACE_NAME_DUPLICATED(409)  ONBOARDING_INCOMPLETE(403)
INTEGRATION_NOT_CONNECTED(409)  INTEGRATION_REVOKED(409)
MEETING_PROCESSING_IN_PROGRESS(409)   AUDIO_TOO_LARGE(413)
DISCORD_USER_ALREADY_MAPPED(409)
```

`error.message` 도 한국어로 들어갔다. 토스트에 그대로 쓸 수 있다 (§1).

**던지는 곳이 있는 것 8개** — `UNAUTHENTICATED` · `FORBIDDEN` · `EMAIL_ALREADY_EXISTS` · `INVALID_CREDENTIALS` ·
`WORKSPACE_NAME_DUPLICATED` · `INTEGRATION_NOT_CONNECTED` · `MEETING_PROCESSING_IN_PROGRESS` · `DISCORD_USER_ALREADY_MAPPED`

**정의만 있고 던지는 곳이 없는 것 3개** — `ONBOARDING_INCOMPLETE`(§4.0-②-5) · `INTEGRATION_REVOKED`(②-6) · `AUDIO_TOO_LARGE`(②-9).
프론트엔드는 세 코드를 `ERROR_CODES` 에 두지만 **실 API 로는 오지 않는다.**
MSW 도 `INTEGRATION_REVOKED` 만 낼 수 있고(업로드 handler), 나머지 둘은 픽스처 경로가 없어 `server.use()` override 로만 만든다.

---

---

## 5. 화면별 데이터 요구

§1~§4 는 API 중심이다. 이 절은 그 역방향으로, **각 화면이 무엇을 몇 번 호출하는지** 적는다.
MSW 픽스처의 단위이자 M1-C 의 작업 단위이기도 하다.

범위는 D-001 의 1차 개발 8개 영역이다. 상태 표기는 넷이다 (§4.0 기준, 2026-09-21).

| 표기 | 뜻 |
|---|---|
| **구현됨** §2 | 처음부터 있었다 |
| **구현됨** §4 | PR #59 로 생겼고 계약과 맞다 |
| ⚠️ **스텁** §4 | 엔드포인트는 있고 **값이 비었거나 하드코딩**이다. 필드 이름은 계약대로라 mapper 는 그대로 쓴다 |
| ❌ **없다** §4 | 아직 엔드포인트가 없다. MSW 로만 개발한다 |

### 5.1 랜딩 · 로그인 · 회원가입

| 화면 | 호출 | 상태 |
|---|---|---|
| 랜딩 | 없음 | — |
| 로그인 | `POST /auth/login` | **구현됨** §4.1 |
| 회원가입 | `POST /auth/signup` | **구현됨** §4.1 — 201 |
| Google 로그인 | `GET /auth/google/start?state=` 로 **페이지 이동** | ❌ **없다** §4.1 — M4 에서 버튼 비활성 |
| 앱 부팅 | `GET /auth/me` | **구현됨** §4.1 |

- 랜딩은 데모 기능을 넣지 않으므로 호출이 없다 (D-002).
- 로그인 응답의 `workspace_count` 로 이동을 분기한다. `0` 이면 온보딩, `1` 이면 대시보드, `2` 이상이면 선택 화면 (D-010).

### 5.2 워크스페이스 선택 · 온보딩

| 화면 | 호출 | 상태 |
|---|---|---|
| 워크스페이스 선택 | `GET /workspaces` | **구현됨** §4.2 — 사용자 스코프·`role`·`onboarding` 다 온다 |
| 워크스페이스 만들기 | `POST /workspaces` `{name}` | **구현됨** §2.1 |
| 온보딩 진행 상태 | `GET /workspaces/{id}` 의 `onboarding` | ⚠️ **스텁** §4.2 |
| 단계 건너뛰기·완료 | `PATCH /workspaces/{id}/onboarding` | ⚠️ **스텁** §4.2 — `skip` 이 동작하지 않는다 |

- 생성은 이름 하나만 보낸다. **이미 그렇게 구현돼 있다** (D-014, D-153).
- 미완료 워크스페이스는 목록에서 표시를 달리하고 대시보드 접근을 막는다 (D-070, D-071).

### 5.3 Discord · Notion · 팀원 연결

| 화면 | 호출 | 상태 |
|---|---|---|
| 연결 상태 표시 | `GET /workspaces/{id}/integrations` | **구현됨** §4.3 — `revoked` 는 안 온다 |
| Discord·Notion 연결 | `GET .../integrations/{provider}/start?state=` 로 **페이지 이동** | ❌ **없다** §4.3 |
| 연결 해제 | `DELETE .../integrations/{provider}` | **구현됨** §4.3 — 204, 봉투 아님 |
| 팀원 연결 — 목록 | `GET /workspaces/{id}/discord/members` + `GET /members?workspace_id=` | ⚠️ **스텁** §4.5 / **구현됨** §2.2 |
| 팀원 연결 — 매핑 | `POST /members` 또는 `PATCH /members/{id}` | **구현됨** §2.2 |

**팀원 연결 화면의 조립** — 두 목록을 `discord_user_id` 로 조인한다.

```
GET /workspaces/{id}/discord/members   →  Discord 서버의 사용자 전체
GET /members?workspace_id=             →  이미 만든 팀원 (discord_user_id 보유)

행 = Discord 사용자 1명
  members 에 같은 discord_user_id 가 있으면  → 연결됨, 팀원 이름 표시
  없으면                                     → 미연결, username 표시 (D-028)
members 에만 있고 Discord 목록에 없으면      → 비활성 (서버를 나감, D-031)
```

### 5.4 대시보드

**집계 API 없이 기존 API 로 조립한다** (§4.6). 진입 시 호출은 4번이다.

```
1. GET /api/v1/tasks?workspace_id=            태스크 전량
2. GET /api/v1/approvals?workspace_id=&status=pending   확인 필요 전량
3. GET /api/v1/workspaces/{id}/meetings       회의 목록        (구현됨 §4.4)
4. GET /api/v1/members?workspace_id=          담당자 이름 조인용
```

상단 요약 4개 (D-052~D-055):

| 숫자 | 계산 |
|---|---|
| 확인 대기 | 2번 응답의 `total` |
| 기한 지남 | 1번에서 `status !== "done" && due_date < 오늘` |
| 7일 이내 마감 | 1번에서 `status !== "done" && 오늘 <= due_date <= 오늘+6일` |
| 막힌 일 | 1번에서 `status === "blocked"` |

- `기한 지남` 과 `7일 이내 마감` 은 조건이 겹치지 않아 중복 집계가 없다 (D-054).

본문 세 영역:

| 영역 | 조립 |
|---|---|
| 확인이 필요한 일 | 2번을 `created_at` **오름차순**으로 정렬해 5개 (D-050, D-051) |
| 마감 임박 | 1번에서 기한 지남 먼저, 그다음 마감 가까운 순으로 5개 (D-044, D-045) |
| 최근 반영 | 아래 |

`최근 반영` 은 가장 최근 회의 1건 기준이다 (D-038).

```
3번에서 status="done" 인 최신 회의 1건
  → GET /meetings/{meeting_id}          extraction_id 획득 (구현됨 §2.3)
  → GET /extractions/{extraction_id}    항목 중 gate="auto" 인 것 = 자동 반영분
  → 상위 3개의 task_id 로
     GET /tasks/{task_id}/history        is_rolled_back 확인 (최대 3회)
```

- 되돌리기는 `POST /tasks/{task_id}/history/{history_id}/rollback` 이다. **이미 구현돼 있다** (§2.6).
- 빈 상태 원인 3갈래 (D-041, D-042):

| 원인 | 판정 |
|---|---|
| `no_meeting` | 3번이 비었다 |
| `no_applied_items` | 최신 회의에 `gate="auto"` 항목이 없다 |
| `notion_not_connected` | `GET .../integrations` 의 notion 이 `connected` 가 아니다 |

- 호출이 늘어나는 구간은 `최근 반영` 뿐이고 최대 3회다. 표시 개수가 3개로 묶여 있어 늘어나지 않는다 (D-039).

### 5.5 회의 업로드 · 정리 중 · 회의록

| 화면 | 호출 | 상태 |
|---|---|---|
| 회의 올리기 진입 가드 | `GET /workspaces/{id}/integrations` 로 Notion 연결 확인 | **구현됨** §4.3 |
| 참석자 선택 | `GET /members?workspace_id=` | **구현됨** §2.2 |
| 업로드 | `POST /workspaces/{id}/meetings/upload` (multipart) | ⚠️ **스텁** §4.4 — 파일·참석자를 저장하지 않는다 |
| 정리 중 — 폴링 | `GET /meetings/{meeting_id}` | **구현됨** §2.3 — `progress` 포함 |
| 회의록 목록 | `GET /workspaces/{id}/meetings` | **구현됨** §4.4 |
| 회의록 본문 | `GET /meetings/{meeting_id}/minutes` | ⚠️ **스텁** §4.4 — `transcript`·`summary` 가 비었다 |
| 회의록의 태스크 영역 | `GET /extractions/{extraction_id}` | **구현됨** §2.4 |

- Notion 미연결이면 업로드 화면으로 보내지 않고 차단 모달을 띄운다 (D-097).
- 회의록 상세의 `반영된 태스크` 와 `확인이 필요한 일` 은 **`minutes` 가 아니라 `extractions` 에서 온다.** 항목이 `task_id`·`approval_id` 를 배타적으로 들고 있다 (§2.4, §3.1).
- 일반 팀원에게는 `approval_id` 가 있는 항목을 화면에서 제거한다. 개수도 노출하지 않는다 (D-104).
- 정리 실패 시 회의록 페이지로 이동하고 토스트를 띄운다. 실패한 회의는 목록에 없다 (D-091~D-093).

### 5.6 태스크 목록 · 보드 · 캘린더 · 간트

| 화면 | 호출 | 상태 |
|---|---|---|
| 목록 — 전체·진행 중·완료 | `GET /tasks?workspace_id=` **전량 1회** | **구현됨** §2.6 |
| 목록 — 확인 필요 | `GET /approvals?workspace_id=&status=pending` | **구현됨** §2.5 |
| 담당자 이름 | `GET /members?workspace_id=` | **구현됨** §2.2 |
| 태스크 상세 | `GET /tasks/{task_id}` + `GET /tasks/{task_id}/history` | **구현됨** §2.6 |
| 태스크 수정 | `PATCH /tasks/{task_id}` | **구현됨** §2.6 |
| 확인 필요 상세 | `GET /approvals/{approval_id}` | **구현됨** §2.5 |
| 승인·반려 | `PATCH /approvals/{approval_id}` | **구현됨** §2.5 |
| 캘린더 | `GET /tasks?workspace_id=&due_after=&due_before=` | **구현됨** §2.6 |
| 보드 | 목록과 같다. 전량 1회 + `GET /approvals` | **구현됨** §2.6 · §2.5 |
| 간트 | `GET /tasks?workspace_id=` **전량 1회** | **구현됨** §2.6 — 시작일은 §4.8-5 |

- 탭 필터링은 클라이언트에서 한다 (D-166, §3.2).
- 승인 직후 `GET /approvals` 와 `GET /tasks` 를 모두 다시 조회한다. 승인이 태스크를 만든다 (§3.1).
- **보드는 목록 탭과 같은 3컬럼이다** (D-169, §3.2). 컬럼별로 따로 부르지 않고 목록의 전량 조회를 그대로 공유한다.
  - `확인 필요` 컬럼은 **읽기 전용**이다. `approval` 이라 `task_id` 가 없어 `PATCH /tasks` 의 대상이 아니다 (D-161). 카드를 끌 수 없고 클릭하면 승인 상세로 간다 (D-162).
  - `진행 중` → `완료` 는 `PATCH {status:"done"}`, `완료` → `진행 중` 은 `PATCH {status:"in_progress"}` 다. 되돌릴 때 `todo` 가 아닌 이유는 한 번 완료된 일이 착수 전으로 돌아가지는 않기 때문이다. 낙관적 업데이트 대상이다 (D-137).
  - `blocked` 는 컬럼이 아니라 **카드 배지**다. 컬럼에서 사라지면 대시보드의 `막힌 일 N` 과 화면이 어긋난다 (D-056). 배지를 누르면 `blocker` 를 보여준다.
- **간트의 기간은 `start_date` ~ `due_date` 다** (D-170). `start_date` 는 §4.7-6 으로 **반영됐다.** `null` 이면 `created_at` 의 날짜 부분으로 대체한다 (§4.8-5). 기존 태스크 행은 전부 `null` 이라 폴백이 여전히 주 경로다.

### 5.7 메시지

**1차에서 화면을 만들지 않는다** (D-171). 내비게이션 항목과 `/messages` 라우트는 두고 `준비 중` 안내만 표시한다.
API 요청이 없으므로 계약도 모델도 픽스처도 필요 없다. 이 화면은 M1 을 막지 않는다.
메시지 화면 정책이 서면 D-117(E2E 시나리오)과 D-136(상태 동기화)의 보류를 함께 푼다.

### 5.8 워크스페이스 관리 · 설정

| 화면 | 호출 | 상태 |
|---|---|---|
| 연결 상태·해제 | `GET`·`DELETE /workspaces/{id}/integrations` | **구현됨** §4.3 |
| 팀원 목록·수정 | `GET /members?workspace_id=`, `PATCH /members/{id}` | **구현됨** §2.2 |
| 미매칭 이름 붙이기 | `GET /members/unresolved-aliases`, `POST /members/{id}/aliases` | **구현됨** §2.2 |
| 별칭 삭제 | `DELETE /members/aliases/{alias_id}` | **구현됨** §2.2 |
| 건너뛴 온보딩 마저 하기 | 5.3 과 같다 | |

- `unresolved-aliases` 가 쓰이는 곳이 여기다. 온보딩의 팀원 연결과 목적이 다르다 (§4.5).
- 그 밖의 설정 항목은 결정 대기다.

### 착수 가능 여부 요약

| 영역 | M1 착수 | 막는 것 |
|---|---|---|
| 5.4 대시보드 | **가능** | 없음 — 회의 목록도 구현됐다 |
| 5.6 태스크 (목록·상세·확인 필요) | **가능** | 없음 — 전부 구현됨 |
| 5.8 워크스페이스 설정 (팀원 부분) | **가능** | 없음 |
| 5.2 워크스페이스 선택·온보딩 | 가능 | 온보딩 저장이 서버 스텁이라 계속 mock (§4.0-②-3) |
| 5.3 연결 화면 | 가능 | 전부 mock |
| 5.5 회의 | 가능 | 업로드·회의록 본문 mock |
| 5.1 로그인 | 가능 | 전부 mock |
| 5.6 보드·간트 | **가능** | 없음 — D-169·D-170 으로 확정 |
| 5.7 메시지 | **가능** | 없음 — 1차에서 만들지 않는다 (D-171) |

---

## 6. 도메인 모델

화면은 DTO 를 직접 참조하지 않는다. `entities` 계층에서만 DTO 를 다루고 변환한다 (D-133, D-134).
`pages`·`widgets`·`features` 에서 DTO 타입을 import 하지 않으며 ESLint `no-restricted-imports` 로 강제한다.

| 엔티티 | 비고 |
|---|---|
| `user` | ~~§4.1 이 나오기 전까지 mock 전용~~ **§4.1 이 나왔다.** M3 부터 실 API 를 붙일 수 있다 |
| `workspace` | 온보딩 진행 상태 포함 |
| `member` | `discord_user_id` 와 별칭 |
| `meeting` | `source` 로 봇·업로드를 구분 |
| `minutes` | 요약·전사문 |
| `task` | `startDate` 는 폴백으로 만든다 (§4.8-5) |
| `approval` | **`확인 필요` 를 담는다.** `task` 와 별도 엔티티다 |
| `integration` | Discord·Notion 연결 상태 |

**변환 계층이 반드시 해야 할 일.** 백엔드 응답이 평평하므로 화면이 쓰는 모양으로 만드는 비용을 여기서 전부 흡수한다.

- **담당자 이름 조인** — `task.assignee_member_id` 에 `GET /members` 결과를 붙인다. 응답에 이름이 없다.
- **`overdue` 계산** — `due_date` 와 오늘을 비교한다. 서버가 주지 않는다.
- **보완 사유 파생** — `approval.payload` 의 `assignee_member_id` 와 `due_date` 가 비었는지로 `담당자 없음` · `마감 없음` 을 만든다.
- **화자 이름 대체** — `speaker_display_name` 이 없으면 `speaker_fallback` (D-028).
- **담당자 대체** — 추출 항목의 `assignee.member_id` 가 없으면 `assignee.raw` (D-161).
- **시작일 폴백** — `start_date` 가 `null` 이면 `created_at` 의 날짜 부분을 쓴다. 간트가 이 값을 쓴다 (D-170).
- **탭 필터링** — `status` 로 클라이언트에서 거른다 (§3.2). 보드의 컬럼도 같은 함수를 쓴다 (D-169).

**PR #59 의 구현 편차를 흡수하는 곳도 여기다.** 화면이 §4.0-② 를 알 필요가 없게 mapper 가 막는다.

- **`role` 폴백** — `WorkspaceResponse.role` 이 `Optional` 이다. 알 수 없으면 `member` 로 본다. 권한을 넓히는 방향으로 틀리지 않는다.
- **`current_step` 정규화** — 완료 시 빈 문자열 `''` 이 온다 (§4.0-②-4). `null` 과 같게 다룬다.
- **`display_name` 무시** — 연동의 `display_name` 이 생성 문자열이다 (②-7). 화면은 provider 이름을 쓴다.
- **빈 `transcript`·`summary`** — `/minutes` 가 스텁이다 (②-11). 빈 배열과 `null` 이 **정상 경로**다. 오류로 다루지 않는다.
- **`확인 필요` 판정** — 승인 뒤에도 `approval_id` 가 남는다 (②-12). `entities/extraction` 의 파생 함수가
  **`approval_id != null 이고 task_id == null`** 을 `확인 필요` 로 본다. `task_id` 가 우선이다.
  이 규칙은 백엔드가 ②-12 를 고쳐도 그대로 맞는다.

---

## 7. MSW

- 로컬 개발·Vitest·Storybook 이 같은 핸들러를 공유한다. production 번들에서 제외한다 (D-146).
- 정상 응답이 기본이다. 빈 상태·권한 오류·검증 오류·서버 오류·느린 응답은 테스트와 Story 에서 개별 override 한다.
- 고정 ID·고정 날짜를 쓴다. 자동 테스트에 인위적 지연을 넣지 않는다.
- `onUnhandledRequest` 는 테스트에서 실패, 로컬에서 경고.

픽스처가 지켜야 할 값:

- **`gate` 와 식별자의 짝이 맞아야 한다.** `gate=auto` 인 추출 항목은 `task_id` 만, `review`·`hold` 는 `approval_id` 만 갖는다 (§3.1).
- 승인 픽스처의 `payload` 는 §2.5 의 11개 키를 그대로 쓴다. `task_title` 이며 `task` 가 아니다.
- **승인을 반영하면 해당 `extraction_item` 의 `task_id` 가 채워지고 `approval_id` 는 남는다.** 실 백엔드와 같은 모양이어야 §3.1 의 우회가 검증된다.
- `전체` 탭 개수가 `확인 필요 + 완료 아님 + 완료` 와 맞아야 한다. 시안 기준 `13 = 3 + 7 + 3`.
- `extraction_id` 는 `status: done` 인 회의에만 존재한다.
- 일반 팀원 픽스처에는 `approval_id` 를 가진 항목이 노출되지 않아야 한다 (D-104).
- 태스크 픽스처의 `start_date` 는 **일부만 채운다.** `null` 인 항목이 있어야 §4.8-5 의 폴백 경로가 테스트된다.
  §4.7-6 이 반영된 뒤에도 그대로다. 실제 DB 의 기존 행이 전부 `null` 이라 이쪽이 오히려 흔한 경우다.
- `blocked` 인 태스크가 최소 1건 있어야 한다. 보드의 배지와 대시보드의 `막힌 일 N` 이 같은 값을 쓴다 (D-169).

---

## 8. 결정 대기

가정으로 고정한 것은 §4.8 에 5건 있다. 답을 기다리지 않고 진행하며, 틀리면 `entities` 계층만 고친다.

**M1 을 막는 것은 없다.** 보드의 컬럼(D-169), 간트의 기간(D-170), 메시지의 1차 범위(D-171)를 정해
§5 의 착수 가능 여부 요약에서 `불가` 가 사라졌다.

**M1 을 막지 않고 남아 있는 것.**

- 태스크 목록의 정렬·페이지네이션 정책. 현재 백엔드는 페이지네이션이 없고 정렬이 고정이다.
  도입되면 §3.2 의 탭 필터링, §4.6 의 대시보드 조립, D-161 의 `전체` 탭 병합이 **함께** 깨진다.
  보드와 간트도 같은 전량 조회에 기대므로 함께 깨진다 (D-169, D-170).
- 메시지 화면의 정책. 1차에서 만들지 않기로 정했을 뿐 정책 자체는 여전히 없다 (D-171).
- 워크스페이스 관리·설정의 개별 항목. 팀원 부분은 §5.8 에서 확정했다.
- 로그아웃의 **이동 경로.** ~~동작과~~ 동작은 PR #59 로 정해졌다 — `session` 행 삭제 + 쿠키 삭제다.
  로그아웃 후 어디로 보낼지(랜딩 / 로그인)를 정한 결정이 여전히 없다 (D-165).

**2026-09-21 에 새로 열린 것.**

- **M4·M5 를 실 API 로 완결할 수 있는가.** §4.0-② 의 스텁 3건(온보딩 저장, Discord 사용자 목록, 회의록 본문)이
  그때까지 채워지지 않으면 해당 화면은 MSW 로 만들고 연결을 미룬다. 어느 쪽이든 **화면 코드는 같다** — mapper 가 형태를 이미 맞춰 뒀다.
- **actor 를 누가 싣는가.** 세션이 생겼으므로 `created_by`·`changed_by`·`resolved_by` 를 서버가 유추할 수 있다.
  바꾸면 프론트엔드의 요청 본문이 줄어든다. 백엔드가 정할 일이라 여기서는 요청만 올린다 (§4.0-③).

---

## 참고

- 결정 기록: `frontend/docs/decision/frontend-decisions.md` (특히 D-160~D-168)
- 개발 계획: `frontend/docs/plan/frontend-development-plan.md`
- 백엔드 실행과 Swagger: `backend/README.md`
