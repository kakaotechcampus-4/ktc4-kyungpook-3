# 인터페이스 명세

Backend API 묶음, 대표 요청·응답, AI↔BE 계약을 요약한다. 경로별 세부는 [API 문서](../api/index.md), 서버 `/docs`(OpenAPI), 계약 문서에 있다.

## 공통 규약

| 항목 | 내용 |
|---|---|
| 접두어 | `/api/v1` (헬스 체크 `/health`) |
| 응답 봉투 | 성공 `{"data": {...}, "error": null}`, 실패 `{"data": null, "error": {"code", "message", "details"}}` |
| 오류 코드 | `error.code` 로 분기. 원본 `backend/app/core/errors.py`, 표는 [backend README 에러 코드](../../backend/README.md#에러-코드) |
| 웹 인증 | 세션 쿠키 `session_token`(7일, DB 에는 해시) |
| 봇·AI 인증 | `X-Service-Token` 헤더. 사용자 세션으로 대신할 수 없음 |
| 실시간 | 메시지 스레드 웹소켓 신호(`message_socket`, #557), 그 밖은 polling |

## API 묶음

| 묶음 | 대표 경로 | 인증 | 쓰는 쪽 |
|---|---|---|---|
| 인증 | `POST /auth/signup`, `/auth/login`, `/auth/logout`, `GET /auth/me`, 가입 인증 코드, 카카오 로그인, 비밀번호 재설정 3단계, 탈퇴 `DELETE /auth/me` | 세션 | 웹 |
| 약관 동의 | `GET /consents/me`, `POST /consents` | 세션 | 웹 |
| 워크스페이스·온보딩 | `POST/GET /workspaces`, `PATCH /workspaces/{id}/onboarding`, `GET /workspaces/{id}/meetings` | 세션 | 웹 |
| 팀원·별칭·초대 | `/members` CRUD·별칭·미매칭 이름, `/workspaces/{id}/invitations`, `/invitations/{id}/accept\|decline\|cancel\|revoke` | 세션 | 웹 |
| 회의(웹) | `GET /meetings/{id}`, `/minutes`, `GET/PUT /meetings/{id}/speakers`, 원본 재생, `DELETE /meetings/{id}` | 세션 | 웹 |
| 업로드(웹) | `POST /workspaces/{id}/meetings/upload` → 202 | 세션(PM) | 웹 |
| 회의(봇) | `POST /meetings`, `PATCH /meetings/{id}/end\|stage\|fail`, `POST /meetings/{id}/sources` | 서비스 토큰 | AI |
| 업로드(AI) | `GET /uploads/pending`, `PATCH /uploads/{id}/claim`, `GET .../file`, `POST .../speakers`, `GET /uploads/assigned`, `PATCH .../resume` | 서비스 토큰 | AI |
| 유사 검색 | `POST /workspaces/{id}/tasks/similar` | 서비스 토큰 | AI |
| 추출 | `POST /extractions`(매칭·게이트·태스크 또는 승인 요청), `GET /extractions/{id}`, auto 되돌리기 | 서비스 토큰 / 세션 | AI / 웹 |
| 승인 | `GET /approvals`, `GET/PATCH /approvals/{id}`(값 고쳐 승인·반려), `POST /approvals` | 세션(처리는 PM) | 웹 |
| 태스크 | `/tasks` CRUD, `/history`·이력 되돌리기, `/timeline`, `/auto-block/undo`, `/reply-changes/{id}/undo`, `/notion-sync/retry` | 세션 | 웹 |
| 연동 | `/workspaces/{id}/integrations`, Notion·Discord OAuth 시작·콜백, Discord 서버 사용자·채널, 채팅 수집 채널 | 세션 | 웹 |
| 메시지·리마인드 | `/workspaces/{id}/messages`: 받은편지함, 스레드, 리마인드·묶음 생성·수정·승인·취소, 웹 답장, 답장 귀속 | 세션 | 웹 |
| 알림·설정 | `/workspaces/{id}/notifications`, `/push` 구독, `/workspaces/{id}/message-settings` | 세션 | 웹 |
| 요약·프로젝트 맵 | `GET /workspaces/{id}/project-map`, `/topics/{id}`, `/meetings/{id}/summary.md`, `/project-bundle.md` | 세션 | 웹 |
| 봇용 조회 | `GET /integrations/discord/guilds/{guild_id}/workspace`, `GET /bot/chat-channels`, `GET /workspaces/{id}/chat-cursor`, `GET /workspaces/{id}/members/names`, `GET/POST /workspaces/{id}/asr-terms` | 서비스 토큰 | AI |
| 봇 메시지 | `POST /bot/drafts/claim`, `/bot/drafts/{id}`, `/bot/messages/claim`, `/bot/messages/{id}/result`, `/bot/replies`, `/bot/replies/claim`, `/bot/replies/{id}/judgment` | 서비스 토큰 | AI |
| 봇 요약·정리 | `POST /summaries/claim`, `GET/PUT /extractions/{id}/summary(-input)`, `/bot/meeting-purges`, `/bot/privacy-cleanups` | 서비스 토큰 | AI |

## 대표 요청·응답

### 1. AI → BE 추출 등록 `POST /api/v1/extractions` → 201

judge 새 항목 하나의 예. 전체 필드는 [계약](../../backend/docs/contracts/backend-ai-contract.md#추출-등록-post-extractions--201).

```json
{
  "meeting_id": "m_123",
  "workspace_id": "w_1",
  "items": [
    {
      "action": "create",
      "task_title": "결제 환불 기능 개발",
      "assignee_raw": "지민님",
      "assignee_type": "thirdname",
      "due_date": "2026-10-11",
      "due_raw": "다음 주까지",
      "evidence_quote": "결제 환불 기능은 지민님이 다음 주까지",
      "evidence_seqs": [12, 13],
      "category": "scope",
      "doc_text": "결제 환불 기능 개발을 지민님이 10/11(일)까지 하기로 함",
      "task_status": "certain",
      "due_status": "inferred",
      "similar_count": 0,
      "top_similarity": null,
      "asr_suspects": []
    }
  ]
}
```

```json
{ "data": { "extraction_id": "e_456", "meeting_id": "m_123", "item_count": 1 }, "error": null }
```

담당자 "지민님"이 팀원으로 매칭되면, 이 항목은 `due_status` 가 inferred 라 `due_not_certain` 으로 review 가 된다. 못 찾으면 담당자 확신도가 기준 미만이라 hold 다. 이미 `done` 인 회의에 다시 보내면 같은 `extraction_id` 를 돌려준다(멱등).

### 2. AI → BE 유사 task 검색 `POST /api/v1/workspaces/{id}/tasks/similar` → 200

```json
{ "text": "로그인 마감을 다음 주 화요일로 미룸" }
```

```json
{
  "data": {
    "items": [
      { "task_id": "t_9", "approval_id": null, "notion_page_id": "abc", "title": "로그인 API 연동",
        "content_snippet": "", "assignee_member_id": "mem_2", "due_date": "2026-10-03",
        "status": "in_progress", "similarity": 0.83, "updated_at": "2026-10-01T09:00:00Z" }
    ]
  },
  "error": null
}
```

기본 `k=3`, `min_similarity=0.4`. 임베딩 실패는 빈 목록이 아니라 502 `EMBEDDING_UNAVAILABLE`.

### 3. 웹 → BE 값 고쳐 승인 `PATCH /api/v1/approvals/{id}`

```json
{ "status": "approved", "task_overrides": { "task_title": "로그인 API 연동", "assignee_member_id": null } }
```

반려는 `{"status": "rejected"}` 만 보낸다. 생성 승인은 제목·담당·마감, 수정 승인은 상태·마감만 고칠 수 있다.

### 4. 승인 충돌 409 `APPROVAL_CONFLICT`

```json
{
  "data": null,
  "error": {
    "code": "APPROVAL_CONFLICT",
    "message": "제안 이후 태스크가 바뀌었습니다.",
    "details": {
      "approval_id": "a_1",
      "task_id": "t_9",
      "task_version": 7,
      "conflicts": [ { "field": "due_date", "base": "2026-10-03", "current": "2026-10-05", "proposed": "2026-10-06" } ]
    }
  }
}
```

PM 이 확인한 뒤 같은 수정값에 `"confirm_task_version": 7` 을 더해 다시 보낸다. 그사이 또 바뀌면 다시 409. (예시의 `message` 문구는 실제 서버 문구와 다를 수 있다 **[확인 필요]**.)

자세히: [승인과 충돌](../design/backend/approval-conflict.md)

## AI ↔ BE 계약 요약

| 항목 | 규약 |
|---|---|
| 경계 | AI 는 BE DB 를 직접 만지지 않고 HTTP API 로만. 공유 타입은 `ai/shared/schemas.py` 와 BE `app/schemas/` |
| 호출 순서 | `POST /meetings` → `PATCH end` → `PATCH stage`(stt·sources·extract·handoff) → `POST sources` → `POST tasks/similar`(finding 마다) → `POST /extractions`. 실패는 `PATCH fail` |
| 워크스페이스 | 봇이 회의마다 Discord 서버 ID 로 찾아 매니페스트에 고정 |
| 근거 연결 | 발화 `seq` → `evidence_seqs`. BE 가 원문·화자·시각을 잇고, 없는 seq 는 그 seq 만 건너뜀 |
| 경로 판별 | BE 가 항목 키로 판별: `action`·`category`·`doc_text` 가 있으면 judge, 확신도만 있으면 legacy |
| judge 게이트 입력 | `task_status`, `due_status`, `similar_count`, `asr_suspects`, `assignee_type` |
| 충돌 기준값 | update 항목의 `target_snapshot`(AI 가 본 값) |
| 멱등·재전송 | 추출 등록은 멱등, 업로드는 claim/resume 로 한 워커만 |
| 합의 절차 | 계약 변경은 이슈 라벨 `contract`·`합의됨`, 계약 문서를 같은 PR 에서 갱신 |

계약 원문:

- [백엔드 ↔ AI 계약](../../backend/docs/contracts/backend-ai-contract.md)
- [프론트엔드 API 계약](../../frontend/docs/contracts/frontend-api-contract.md)
- [API 문서](../api/index.md)

자세히: [담당자 매칭과 게이트](../design/backend/gate-matching.md)
