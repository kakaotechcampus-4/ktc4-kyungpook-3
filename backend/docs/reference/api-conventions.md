# 응답 형식·에러 코드·권한

[Backend README](../../README.md)로 돌아가기

API 공통 응답 봉투, 에러 코드, 권한, 아직 없는 기능을 정리한다.

## 응답 형식

모든 엔드포인트는 아래 봉투(envelope)로 응답한다(`app/core/errors.py`의 `Envelope`).

```json
// 성공
{ "data": { ... }, "error": null }

// 실패
{ "data": null, "error": { "code": "TASK_NOT_FOUND", "message": "...", "details": { ... } } }
```

`data` 모양은 엔드포인트마다 다르며 `/docs`의 응답 스키마에서 확인한다. `error.details`는 없을 수도 있고, 있다면 보통 실패 원인 ID들을 담는다(`{"task_id": "..."}` 등).

## 에러 코드

`error.code` 값과 HTTP 상태다(원본은 같은 파일). *(아직 미구현 경로)* 코드는 음성 전사·회의 분석이 실제로 붙기 전까지 내려오지 않는다.

### 공통·서버 오류

| 코드 | HTTP | 뜻 |
|---|---|---|
| `INVALID_REQUEST` | 400 | 요청 형식이 올바르지 않음(필드 검증 실패 등) |
| `WORKSPACE_MISMATCH` | 400 | 요청한 workspace_id가 대상 리소스의 실제 workspace와 다름 |
| `PRIVACY_VERSION_CHANGED` | 409 | 서비스 쓰기의 명단 세대가 현재 공간과 다름. 이전 계산 결과를 새 세대로 바꿔 재전송하지 않음 |
| `DATABASE_UNAVAILABLE` | 503 | DB 에 연결할 수 없음. `GET /api/v1/health/ready` 에서만 나오며 원인 예외 문구는 넣지 않음 |
| `INTERNAL_ERROR` | 500 | 그 외 서버 내부 오류 |

### 계정·가입·로그인

| 코드 | HTTP | 뜻 |
|---|---|---|
| `CONSENT_VERSION_MISMATCH` | 400 | 동의 요청의 약관·개인정보처리방침 버전이 현재 BE 설정과 다름. 둘 다 저장하지 않음. `details.current_versions`(현재 값)·`received`(받은 값) |
| `CONSENT_ACCOUNT_CHANGED` | 409 | 동의 GET·POST의 선택 `X-Consent-Account-ID`와 쿠키 계정이 다름. 조회·저장 없이 반환. 헤더 없는 기존 소비자는 호환 |
| `WITHDRAWAL_ACCOUNT_CHANGED` | 409 | 탈퇴 요청이 가리킨 계정과 현재 쿠키 계정이 다름. 어느 계정도 삭제하지 않음 |
| `PASSWORD_RESET_TOKEN_INVALID` | 400 | 재설정 링크를 쓸 수 없음(없는·무효화된·이미 쓴·만료된 토큰). `details.reason`: `invalid`·`used`·`expired` |
| `MAIL_UNAVAILABLE` | 503 | SMTP 설정이 없어 메일을 보낼 수 없음. 재설정·가입 코드 요청에서 나오며 발송 실패는 응답에 안 드러남 |
| `SIGNUP_CODE_RATE_LIMITED` | 429 | 가입 코드를 너무 자주 요청함 |
| `SIGNUP_CODE_INVALID` | 400 | 가입 코드를 쓸 수 없음 |
| `SIGNUP_VERIFICATION_INVALID` | 400 | 가입에 이메일 증명이 없거나 쓸 수 없음. 코드 인증부터 다시 함 |
| `KAKAO_LINK_EXPIRED` | 400 | 카카오 대기 쿠키가 없거나 만료됨. 카카오 로그인부터 다시 함 |
| `KAKAO_ALREADY_LINKED` | 409 | 대기 중인 카카오 계정이 이미 다른 계정에 이어져 가입하지 않음 |
| `USERNAME_TAKEN` | 409 | 가입이나 아이디 변경에서 다른 계정이 이미 쓰는 아이디. 대소문자만 달라도 같은 아이디 |
| `TOO_MANY_LOGIN_ATTEMPTS` | 429 | 같은 이메일 10회·같은 공인 IP 50회 실패가 15분 안에 쌓여 로그인이 막힘(맞는 비밀번호도 막음). `Retry-After` 헤더와 `details.retry_after_seconds` 는 같은 정수 초 |

- `CONSENT_ACCOUNT_CHANGED` 를 받으면 새로고침 후 계정을 다시 확인한다.
- `SIGNUP_CODE_RATE_LIMITED` 의 `details.reason`: `cooldown`(60초 재발송 제한)·`hourly`(시간당 5회)·`ip`(공인 IP 시간당 10회, #691)·`global`(전체 시간당 20통). `details.retry_after` 는 기다릴 초다.
- `SIGNUP_CODE_INVALID` 의 `details.reason`: `wrong`(`details.attempts_left` 함께)·`expired`(만료, 요청한 적 없음, 이미 씀)·`too_many`(5회 초과).

### 팀원·초대

| 코드 | HTTP | 뜻 |
|---|---|---|
| `WORKSPACE_NOT_FOUND` | 404 | 워크스페이스가 없음 |
| `MEMBER_NOT_FOUND` | 404 | 팀원이 없음 |
| `MEMBER_ALIAS_NOT_FOUND` | 404 | 담당자 별칭이 없음 |
| `USER_NOT_FOUND` | 404 | 초대할 가입자가 없음(탈퇴 포함). PM 이 아니면 이 코드 대신 403. `details.user_id` |
| `INVITATION_NOT_FOUND` | 404 | 초대가 없음. 나에게 온 초대가 아니거나(수락·거절) 그 워크스페이스 소속이 아니어도(취소·연결 끊기) 같음. `details.invitation_id` |
| `MEMBER_NAME_DUPLICATED` | 409 | 팀원 추가나 이름 고치기에서 같은 워크스페이스의 활성 팀원과 이름이 같음(앞뒤 공백만 지우고 견줌). `details.display_name`·`member_id`(그 이름을 쓰는 팀원) |
| `LAST_PM_REQUIRED` | 409 | 마지막 PM(로그인 계정이 있는 PM)을 member로 내리려 함. 다른 팀원을 먼저 PM으로 지정함 |
| `INVITATION_NOT_PENDING` | 409 | 대기 중이 아닌 초대를 수락·거절·취소하려 함. `details.invitation_id` |
| `INVITATION_NOT_ACCEPTED` | 409 | 수락하지 않은 초대의 연결을 끊으려 함. `details.invitation_id` |
| `MEMBER_ALREADY_LINKED` | 409 | 이미 계정이 연결된 팀원을 초대하거나 수락하려 함. `details.member_id` |
| `ALREADY_WORKSPACE_MEMBER` | 409 | 초대할 계정이나 수락하는 내가 이미 이 워크스페이스 팀원임. 초대할 때 `details.user_id`, 수락할 때 `details.workspace_id` |
| `USER_ALREADY_INVITED` | 409 | 같은 사용자에게 다른 팀원으로 보낸 초대가 대기 중임. `details.user_id` |
| `PM_MEMBER_NOT_INVITABLE` | 409 | 역할이 PM 인 팀원을 초대하려 함. 팀원으로 초대해 수락한 뒤 PM 으로 바꿈. `details.member_id` |
| `MEMBER_HAS_PENDING_INVITATION` | 409 | 대기 초대가 있는 팀원을 PM 으로 올리려 함. `details.member_id` |

### 회의·녹음

| 코드 | HTTP | 뜻 |
|---|---|---|
| `MEETING_NOT_FOUND` | 404 | 회의가 없음 |
| `TRANSCRIPT_LINE_NOT_FOUND` | 404 | 그 회의에 해당 번호의 발화가 없음(발화 고치기). `details.meeting_id`, `details.seq` |
| `AUDIO_NOT_AVAILABLE` | 404 | 들을 수 있는 회의 녹음이 없음(`GET /meetings/{id}/audio`). `details.meeting_id` |
| `MEETING_ALREADY_ENDED` | 409 | 이미 종료된 회의 |
| `MEETING_NOT_PROCESSING` | 409 | 회의가 PROCESSING 상태가 아닌데 추출을 시도함 |
| `MEETING_PROCESSING_IN_PROGRESS` | 409 | 같은 워크스페이스에 처리 중인 회의가 있어 업로드를 받지 않음. `details.meeting_id` |
| `UPLOAD_NOT_CLAIMED` | 409 | AI가 아직 가져가지(claim) 않은 업로드에 화자를 보고하려 함. `details.status`(그 시점의 회의 상태) |
| `SPEAKERS_ALREADY_REPORTED` | 409 | 이미 화자 목록을 받은 업로드에 다른 목록을 보고하려 함(같은 목록 재전송은 200). `details.status` |
| `MEETING_NOT_AWAITING_SPEAKERS` | 409 | 회의가 화자 지정 대기(`awaiting_speakers`) 상태가 아닌데 화자를 지정하려 함. `details.status` |
| `SPEAKERS_NOT_ASSIGNED` | 409 | PM이 화자 지정을 안 끝낸 업로드의 처리를 AI가 이어 가려 함. `details.status` |
| `AUDIO_TOO_LARGE` | 413 | 업로드한 녹음이 한도(기본 700MiB, `UPLOAD_MAX_BYTES`)를 넘음. `details.size_bytes`·`max_bytes` |
| `AUDIO_UPLOAD_FAILED` | 422 | 오디오 저장·병합 실패 |
| `AUDIO_FORMAT_UNSUPPORTED` | 422 | 지원하지 않는 오디오 형식. `details.filename`·`supported` |
| `TRANSCRIPTION_FAILED` | 502 | 음성 전사 실패 *(아직 미구현 경로)* |

- `AUDIO_NOT_AVAILABLE` 의 `details.reason`: `expired`(보관 기간 지남)·`no_recording`(녹음이 없거나 지워졌거나 failed 회의).

### 추출·주제·태스크·승인

| 코드 | HTTP | 뜻 |
|---|---|---|
| `EXTRACTION_NOT_FOUND` | 404 | 추출 결과가 없음 |
| `EXTRACTION_ITEM_NOT_FOUND` | 404 | 그 추출 결과에 해당 항목이 없음(auto 되돌리기) |
| `TOPIC_NOT_FOUND` | 404 | 주제가 없음(프로젝트 맵 주제 상세) |
| `SUMMARY_NOT_FOUND` | 404 | 그 회의의 요약본이 아직 없음(`summary.md`) |
| `DECISION_NOT_FOUND` | 404 | 결정이 없음(결정 고치기). 다른 워크스페이스나 삭제된 회의의 결정도 같음. `details.decision_id` |
| `TOPIC_NAME_TAKEN` | 409 | 바꾸려는 이름(정규화한 값)을 다른 주제가 쓰고 있음(주제 이름 고치기). `details.topic_id` 가 그 주제 |
| `EXTRACTION_FAILED` | 502 | 회의 분석 실패 *(아직 미구현 경로)* |
| `TASK_NOT_FOUND` | 404 | 태스크가 없음 |
| `TASK_HISTORY_NOT_FOUND` | 404 | 반영 로그(태스크 히스토리)가 없음 |
| `APPROVAL_NOT_FOUND` | 404 | 승인 요청이 없음 |
| `TASK_HISTORY_ALREADY_ROLLED_BACK` | 409 | 이미 되돌린 변경을 다시 되돌리려 함 |
| `AUTO_TASK_NOT_REVERTIBLE` | 409 | auto로 만든 태스크를 되돌릴 수 없음(태스크를 직접 고침) |
| `APPROVAL_ALREADY_RESOLVED` | 409 | 이미 승인/반려 처리된 요청을 다시 처리하려 함 |
| `APPROVAL_CONFLICT` | 409 | task_update 제안 이후 같은 필드가 바뀌었거나 대상 task 제목이 바뀌어 승인하지 않음 |
| `APPROVAL_CHANGED` | 409 | task_create 승인·반려 요청의 `payload_version`이 지금 카드 값과 달라(본 뒤 다른 회의 항목이 합쳐짐) 처리하지 않음 |
| `EMBEDDING_UNAVAILABLE` | 502 | 임베딩 서버 호출 실패 또는 임베딩 키 미설정(유사 task 검색) |

- `AUTO_TASK_NOT_REVERTIBLE` 의 `details.reason`: `already_reverted`(이미 되돌림)·`not_auto_created`(auto로 만든 항목이 아님)·`task_missing`(태스크가 없음)·`task_changed`(만든 뒤 바뀜, `details.task_version`)·`pending_approval`(처리 대기 승인 요청이 있음, `details.approval_id`).
- `APPROVAL_CONFLICT`: `details.conflicts`에 필드별 기준값·지금 값·제안 값(`field: "title"`은 대상 확인용이라 `proposed`가 null). 확인 후 `details.task_version`을 `confirm_task_version`에 담아 다시 승인하면 반영한다(그 사이 또 바뀌었으면 다시 409).
- `APPROVAL_CHANGED`: 카드는 대기로 남고 `details.approval_id`, `details.payload_version`(지금 값)을 준다. 상세를 다시 받아 확인한 뒤 새 값으로 보낸다.

### 메시지·Discord·Notion

| 코드 | HTTP | 뜻 |
|---|---|---|
| `REMINDER_NOT_FOUND` | 404 | 리마인드가 없음. `details.reminder_id` |
| `REMINDER_BUNDLE_NOT_FOUND` | 404 | 보낼 메시지(묶음)가 없음. `details.bundle_id` |
| `MESSAGE_THREAD_NOT_FOUND` | 404 | 대화가 없음. `details.thread_id` |
| `MESSAGE_NOT_FOUND` | 404 | 봇 메시지가 없음. `details.message_id` |
| `REMINDER_NOT_EDITABLE` | 409 | 예정 상태가 아닌 리마인드·묶음을 고치거나 승인·취소하려 함. `details`에 `reminder_id` 또는 `bundle_id`와 `status` |
| `REMINDER_SCHEDULED_AT_PASSED` | 409 | 지난 시각으로 만들거나 고치거나, 시각이 지난 묶음을 승인하려 함 |
| `BUNDLE_CHANGED` | 409 | PM 이 본 뒤 묶음 문구나 구성이 바뀌어 승인하지 않음. `details.bundle_id`, `details.draft_version`(지금 판) |
| `DRAFT_STALE` | 409 | 초안을 맡긴 뒤 묶음이 바뀌었거나 이미 승인·발송돼 초안을 받지 않음. `details.bundle_id`, `details.draft_version`, `details.status` |
| `MESSAGE_RESULT_CONFLICT` | 409 | 이미 다른 결과가 보고됐거나 아직 가져가지 않은 메시지에 결과를 보고함. `details.message_id` |
| `DISCORD_CHANNEL_NOT_FOUND` | 404 | 연결한 서버에 그 텍스트 채널이 없음. `details.channel_id` |
| `DISCORD_USER_NOT_IN_GUILD` | 409 | 팀원에 붙이려는 디스코드 계정이 연결한 Discord 서버에 없음. `details.discord_user_id` |
| `DISCORD_USER_ALREADY_MAPPED` | 409 | 같은 워크스페이스에서 탈퇴하지 않은 다른 팀원에 이미 연결된 디스코드 계정. `details.discord_user_id` |
| `DISCORD_CHANNEL_NOT_ACCESSIBLE` | 409 | 봇이 그 채널을 읽거나 메시지를 보낼 수 없음. `details`는 `{channel_id, need: "read"\|"send", discord_code}` |
| `DISCORD_API_FAILED` | 502 | Discord 요청 실패(봇 토큰 미설정·권한·네트워크). `details.status`에 Discord 응답 상태(응답이 없으면 null), 채널 API 는 `details.reason` 도 |
| `NOTION_WRITE_FAILED` | 502 | Notion 페이지 생성/갱신 실패. Task API는 더 이상 내려주지 않음([Notion 연동](notion.md#notion-연동)) |

- `DISCORD_USER_NOT_IN_GUILD`: 연결한 서버가 없으면 대신 409 `INTEGRATION_NOT_CONNECTED`, 봇 토큰이 없거나 Discord 가 답하지 않으면 502 `DISCORD_API_FAILED`.
- `DISCORD_USER_ALREADY_MAPPED`: 탈퇴(`is_deleted`)한 팀원의 계정은 다시 연결할 수 있다. `PATCH` 에 `move_discord_link: true` 를 같이 보내면 이 오류 대신 계정을 옮긴다([팀원 디스코드 연결 옮기기](discord.md#팀원-디스코드-연결-옮기기)).
- `discord_user_id`의 앞뒤 공백은 지우고 빈 값은 연결 없음(null)으로 저장한다. 64자를 넘으면 400 `INVALID_REQUEST` 다.

## 권한

로그인한 사용자가 요청한 워크스페이스의 팀원인지(소속) 확인하고, 아래 쓰기 API 는 PM 인지까지 확인한다. 아니면 403 `FORBIDDEN`. 원본은 `app/api/deps.py`의 `require_pm`.

- 승인·반려(`PATCH /approvals/{id}`), 할일 생성·수정(`POST /tasks`, `PATCH /tasks/{id}`), 되돌리기, auto 되돌리기(`POST /extractions/{id}/items/{item_id}/revert`)
- 팀원 생성·수정·삭제(`DELETE /members/{id}`), 별칭 생성·삭제, 회의 업로드, 온보딩 저장, 메시지 설정 변경(`PATCH /workspaces/{workspace_id}/message-settings`)
- Notion 재시도, Notion 연결 시작·콜백(`GET .../integrations/notion/start`, `GET /integrations/notion/callback`), Discord 연결 시작·콜백(`GET .../integrations/discord/start`, `GET /integrations/discord/callback`)
- Discord 채널 목록·채팅 수집 채널 저장·해제(`GET .../discord/channels`, `PUT`·`DELETE .../integrations/discord/chat-channel`), 연동 해제

회의 녹음 재생 `GET /meetings/{id}/audio` 는 done 회의면 소속 누구나, 그 밖의 상태(처리 중 등)면 PM 만 듣는다. 팀원이 done 이 아닌 회의를 요청하면 403 `FORBIDDEN`(PM 만 할 수 있는 작업)이다. 이때 `GET /meetings/{id}/minutes` 는 403 이 아니라 항상 200 이고, `audio` 는 호출자가 지금 들을 수 있을 때만 값이라 null 이다. 조회 API 전부(메시지 설정 조회 `GET .../message-settings` 포함)와 승인 요청 생성(`POST /approvals`)은 소속이면 누구나 한다.

- Notion 연결 시작·콜백은 브라우저 페이지 이동이라 403 대신 앱 화면의 `?oauth=notion&oauth_result=failed`로 돌려보낸다.
- 일반 팀원은 할일을 직접 바꾸지 못하고 승인 요청을 올린다. 요청자(`requested_by`)는 바디 값이 아니라 로그인한 팀원으로 기록한다.
- PM 역할은 `PATCH /members/{id}`의 `role`로 바꾼다. PM을 넘길 때는 다른 팀원을 먼저 PM으로 올리고 자기를 내리며, 로그인 계정이 있는 PM이 없어지면 409 `LAST_PM_REQUIRED`.
- 팀원 삭제(`DELETE /members/{id}`, 204)는 행을 남기고 `is_deleted` 만 켠다. 이름·디스코드 계정·로그인 연결은 이력용으로 남는다.
- 마지막 PM 이 자기를 지우면 409 `LAST_PM_REQUIRED`, 없거나 탈퇴했거나 이미 지운 팀원은 404 `MEMBER_NOT_FOUND`.
- 끝나지 않은 태스크의 담당은 태스크 이력으로 비우고, 대기 초대와 예약 재촉·안 나간 DM 을 닫는다([결정 기록](../plan/m1/basis-for-decision/2026-11-10-member-delete-decision.md)).
- 봇 경로(회의 생성·종료·단계 보고·실패, 발화 저장, 유사 task 검색, 추출 등록, 서버로 워크스페이스 찾기, 전사 힌트 조회, 채팅 수집 대상 목록 `GET /bot/chat-channels`)는 사용자 세션 대신 서비스 토큰(`X-Service-Token`, `deps.require_service_token`)으로 막는다. 없거나 틀리면 401 `UNAUTHENTICATED`([AI(녹음 봇) 계약](../contracts/backend-ai-contract.md#인증)).

## 아직 없는 것

- 워크스페이스 초대
- 업로드 녹음을 AI가 처리하는 경로(BE 가져가기 API는 있고 AI 쪽이 없다, [M5 결과](../plan/m5/result.md))
- 메시지 로그
- PM 알림을 DM 으로 보내는 경로와 #회의록 요약 게시를 읽는 경로. 설정의 PM 알림 방식·요약 값은 저장만 하고 PM 알림은 항상 웹으로 간다.
