# 프론트엔드 API 계약

## 후속 구현 상태 대조 (2026-11-09, #362)

제공자 BE와 소비자 FE를 develop `70534a85`의 소스에서 다시 대조했다. 아래 표는 과거 §4.0(2026-09-21), §4.7의 초기 요청 상태와 「착수 가능 여부」보다 최신인 구현 사실이다. 기존 합의·제품 결정은 해당 절에 보존한다. 이번 작업에서 API 호출·OAuth·메일·실제 AI 처리·운영 배포를 실행 검증하지 않았다.

| 경계 | 현재 구현과 소비 코드 | 확인을 남긴 범위 |
|---|---|---|
| 가입·카카오 로그인 | [BE 인증](../../../backend/app/api/auth.py)에 이메일 코드 발급·확인·증명 기반 가입과 카카오 start·callback·pending이 있다. [FE 인증](../../src/entities/user/api/auth.ts), [코드·카카오 API](../../src/entities/user/api/signupCode.ts), [가입 화면](../../src/features/auth/ui/SignupSteps.tsx)이 소비한다. Google 로그인은 이번 범위에서 제외됐다. | 실제 카카오 앱 설정·redirect URI·메일·운영 성공은 별도. 판본별 동의 API와 최종 정책 공개는 이 확인에 포함하지 않음 |
| 온보딩 | [BE workspaces](../../../backend/app/api/workspaces.py)의 `update_onboarding`이 PM 권한·행 잠금 안에서 단계별 상태를 저장한다. [FE onboarding](../../src/entities/workspace/api/onboarding.ts)은 PATCH 뒤 상세를 새로 읽는다. | API가 존재한다는 사실과 실제 계정의 단계 재개 검증을 구분 |
| Discord·Notion 연결 | [BE integrations](../../../backend/app/api/integrations.py)에 두 provider의 start와 `/integrations/{provider}/callback`이 있다. [FE OAuth 주소](../../src/entities/integration/api/oauth.ts)와 [연결 기능](../../src/features/integration-connection/model/useIntegrationConnection.ts)이 소비한다. Notion 상태는 not_connected·connecting·connected·revoked를 다룬다. | 실제 공급사 권한·토큰·DB 준비와 운영 성공은 별도 |
| 팀원 초대 | [BE invitations](../../../backend/app/api/invitations.py)와 [FE 조회](../../src/entities/invitation/api/invitationQueries.ts)·[명령](../../src/entities/invitation/api/invitationMutations.ts)이 연결돼 있다. [내 초대](../../src/widgets/app-shell/ui/MyInvitations.tsx)는 수락·거절, [PM 초대 기능](../../src/features/member-invite/ui/MemberInviteControl.tsx)은 생성·취소·연결 끊기를 소비한다. | FE 미연결이라는 초기 설명을 현재 상태로 쓰지 않는다. 화면 합의·실제 초대 왕복의 신규 완료 판정은 하지 않음 |
| 업로드·회의록 | [BE 업로드](../../../backend/app/api/workspaces.py)는 반복 `attendee_member_ids`를 `list[str]`로 받고 파일·참석자를 저장한다. [회의록](../../../backend/app/api/meetings.py)은 Source를 전사·참석자로 구성하고 Extraction.summary JSON을 읽는다. [FE 업로드](../../src/entities/meeting/api/uploadMeeting.ts)·[회의록 조회](../../src/entities/minutes/api/minutesQuery.ts)가 소비한다. [AI 워커](../../../ai/capture/worker.py)·[업로드 가져오기](../../../ai/upload/intake.py) 코드도 있다. | summary는 저장된 유효 객체가 없으면 null이다. 전체 처리의 성공을 코드 존재로 단정하지 않음 |
| 메시지 | [FE 메시지 API](../../src/entities/message/api/messageQueries.ts)의 목록·대화·쓰기와 [웹소켓 신호](../../src/widgets/message-inbox/model/useMessageSignals.ts)가 [BE messages](../../../backend/app/api/messages.py)·[소켓](../../../backend/app/api/message_socket.py)을 소비한다. 세부 동작은 §5.7이다. | 실서버 DM·서로 다른 계정·재접속·푸시 검증은 별도 |

`frontend/docs/requests/`에는 별도 요청 본문이 없으므로 대표 요청·합의 기록은 이 문서 §4에 유지한다. 과거 검증 기록을 이번 정적 대조의 실행 결과로 바꾸지 않는다.

## 계정 탈퇴와 정리 상태 (#575, 2026-11-09)

### 합의 상태

사용자는 계정·세션과 개인 연결·프로필·별칭을 삭제하고, 다른 구성원이 남은 공동 기록은 `탈퇴한 사용자`로 보존하도록 확정했다. 마지막 PM은 권한 이전이 필요하며 유일한 활성 멤버인 공간은 기록과 함께 삭제한다. 같은 이메일·카카오로 즉시 새 계정을 만들 수 있지만 새 초대가 필요하다. AI 정리 지연 중에는 `개인정보 정리 중`, 실제 정리 확인 후에는 `탈퇴 완료`를 표시한다. 취소 유예기간은 없다.

아래 HTTP 형식은 생산자·소비자를 함께 구현한 현재 규약이다. 코드·격리 검증과 운영 배포를 구분하며, 별도 파트 합의나 법률 검토를 추정하지 않는다.

### 요청과 응답

경로는 `/api/v1` 기준이며 기존 `{data, error}` 봉투를 사용한다.

| 요청 | 권한·헤더와 동작 |
|---|---|
| `GET /auth/withdrawal-plan` | 본인 세션. `workspaces[{workspace_id,workspace_name,disposition}]`, `blocked_workspace_ids` 반환. disposition은 preserve, delete, transfer_pm |
| `DELETE /auth/me` | 최초 요청은 본인 세션과 `X-Withdrawal-Key`, `X-Withdrawal-Account-ID` 필요. 실제 쿠키 계정과 expected ID를 비교하고 모든 공간 조건을 잠금 안에서 다시 검사. 성공 202 |
| `GET /auth/withdrawals/{withdrawal_id}` | 같은 `X-Withdrawal-Key`의 소지로 자기 영수증을 200 조회. 삭제된 세션을 요구하지 않음 |

DELETE와 영수증의 `data`는 `{withdrawal_id,account_deleted_at,cleanup_status}`다. account_deleted_at는 UTC 시각이며 cleanup_status는 pending 또는 complete다. User·세션·푸시·프로필 정리는 계정 트랜잭션에서 끝내고, backend와 AI 파일 정리의 실제 확인은 영수증 상태로 구분한다.

FE는 crypto.getRandomValues로 만든 256비트 키를 sessionStorage에 보관한다. API는 영문·숫자·밑줄·하이픈 32~128자 형식을 받으며 원문 대신 SHA-256만 저장한다. 같은 키의 성공 재시도는 같은 영수증을 반환한다. 이전 영수증을 새 계정 로그인 뒤 다시 조회하거나 DELETE로 재요청해도 새 계정이나 그 쿠키는 지우지 않는다.

| 오류 | 의미 |
|---|---|
| 400 `INVALID_REQUEST` | 키 누락·형식 오류 또는 최초 요청의 expected 계정 ID 누락 |
| 401 `UNAUTHENTICATED` | 최초 요청의 세션이 없거나 만료됨. 영수증 ID·키가 맞지 않음 |
| 409 `WITHDRAWAL_ACCOUNT_CHANGED` | 최초 요청의 쿠키 계정과 expected 계정 ID가 다름. 어느 계정도 변경하지 않음 |
| 409 `LAST_PM_REQUIRED` | 다른 로그인 가능한 PM이 없는 공유 공간이 있음. `details.workspace_ids` 반환. 어느 공간도 부분 처리하지 않음 |

계정이 없는 활성 Discord 팀원도 단독 멤버 판정에 포함한다. 계획은 예약·승인 토큰이 아니며 실제 명령이 재검사한다. FE는 `/account/withdrawal`에서 계획·PM 이전 링크·삭제 범위 확인·명령·응답 유실 재시도·정리 영수증을 표시한다. 성공 전에 브라우저 푸시 구독을 먼저 해제하지 않는다. 서버 성공 후 이전 사용자 캐시와 해당 브라우저 구독을 정리하며 다른 로그인 세대로 바뀌었으면 새 계정의 상태를 바꾸지 않는다.

### 익명 기록과 범위

`GET /members?workspace_id=...`의 기본 목록은 활성 팀원이다. `include_withdrawn=true`를 명시하면 영구 탈퇴의 비식별 Member도 포함한다. 기존 명단 비활성화만 된 Member는 이 옵션으로 복원하지 않는다. FE는 별도 기록용 query를 태스크·이력·승인·화자 표시에서만 사용하며 새 담당자 선택·팀 카드·초대·재촉에는 활성 목록을 사용한다.

영구 탈퇴자의 대화는 PM 목록·상세·읽음에 남는다. 팀원 발신 이름은 thread.name, PM 발신 이름은 author_name의 기존 규약으로 익명 표시한다. 기존 is_deleted만 있는 명단 비활성화의 상세 200·unread 0·읽음 POST 404는 유지한다. 새 발송·프로필 수정·초대와 늦은 봇 결과로 영구 탈퇴 주체를 되살리지 않는다.

정확한 소유 관계로 확인되는 구조화 이름·별칭·외부 ID와 로컬 AI 사본을 정리한다. 공동 음성·본문 전체를 임의로 익명화하거나 이미 게시된 Notion·Discord 결과를 회수했다는 뜻은 아니다. 과거 AI 자료의 소유 근거가 없어 안전하게 정리할 수 없으면 pending으로 남기며 완료를 먼저 표시하지 않는다. 파일·AI 작업 계약은 [BE 대표 계약](../../../backend/docs/contracts/backend-ai-contract.md)에 있다.

## 응답 검증과 새 값 배포 순서 (#348, 2026-11-08)

근거는 [이슈 #348](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/348)의 정책 결정(2026-11-05)·추가 항목(2026-11-07)과 [D-184](../decision/frontend-decisions.md)다. FE 는 성공 응답의 `data` 를 entity 경계에서 zod 스키마로 읽는다. 스키마에 맞지 않으면 `INVALID_RESPONSE` 다. entity 묶음마다 PR 을 나눠 적용하고, 이 절은 적용한 entity 를 적는다. 실 API 호출로는 확인하지 않았다. BE 응답 스키마(`backend/app/schemas/task.py`·`reply.py`)를 읽어 대조했다.

### 합의된 규약

- **새 값 배포 순서.** 응답에 새 enum 값(상태·종류·출처)을 더할 때는 FE 가 먼저 그 값을 받도록 배포하고, BE 가 그 뒤에 내보낸다. FE 쪽 결정이다(#348 정책 결정 3). BE 합의 여부 확인 필요.
- 이 순서가 지켜지면 상태 판단 필드에 모르는 값이 와서 생긴 `INVALID_RESPONSE` 는 계약 위반 신호다. 표시용 분류는 모르는 값이 와도 응답이 실패하지 않고 `알 수 없는 ○○` 로 보인다. 그래도 새 값의 문구는 FE 배포 뒤에 생긴다.

### 현재 구현

| 응답 | FE 가 거절하는 것 (`INVALID_RESPONSE`) | FE 가 받고 따로 다루는 것 |
|---|---|---|
| `TaskResponse` (조회·목록·생성·`PATCH`·Notion 재시도·자동 막힘 풀기·답장 변경 되돌리기) | `status` 가 `todo`·`in_progress`·`blocked`·`done` 밖, `version` 이 정수가 아님, `meeting_deleted` 가 불리언이 아님, 그 밖의 필수 필드 누락·타입 오류. 목록은 한 건만 틀려도 전체 | `start_date` 가 없으면 `created_at` 날짜(옛 응답). `meeting_deleted` 가 없으면 지우지 않은 회의(false, #576 전 BE). 모르는 `notion_sync_status` 는 반영 상태 없음(null). `auto_blocked` 가 불리언이 아니거나 없으면 풀 수 없음(false) |
| `TaskHistoryResponse` 목록 | 필수 필드 누락·타입 오류. 요청한 태스크가 아닌 `task_id`(`items[n].task_id`) | 모르는 `changed_field` 는 `알 수 없는 항목`, 모르는 `change_source` 는 `알 수 없는 출처` |
| `GET /tasks/{task_id}/timeline` | 모르는 `kind`, 필수 필드 누락·타입 오류 | 답장 줄의 모르는 `field` 는 `알 수 없는 변경이에요`, 모르는 `result` 는 `알 수 없는 결과`. 종류나 결과를 모르는 줄은 읽기 전용이라 서버 `undoable` 이 true 여도 되돌리기가 없다(표시용 분류에는 행동이 없다). 아는 줄은 서버 `undoable` 을 따른다. 모르는 `channel`·`evidence_status` 는 없음(null) |

- 쓰기 응답(`PATCH`·생성·Notion 재시도·자동 막힘 풀기·답장 변경 되돌리기)이 `INVALID_RESPONSE` 면 FE 는 서버에 반영됐을 수 있다고 보고 실패라 하지 않는다. 토스트 `변경 결과를 확인하지 못했어요` 와 `새로고침`(그 공간의 태스크 목록·상세·이력을 다시 받음)을 보인다. 다른 실패는 기존 문구다(D-184).
- 오류의 `details` 는 `{entity, path}` 다(예: `{"entity": "task", "path": "items[3].status"}`). 받은 값은 넣지 않는다. 개발 모드만 콘솔에 경로와 값을 남긴다.
- 스키마는 FE 가 읽는 필드만 본다. BE 가 필드를 더해도 실패하지 않는다. `total` 은 읽지 않는다.
- 남은 entity(approval, meeting·minutes·extraction, message·notification, integration·invitation·workspace·member·user)는 아직 이전 방식(타입 단언과 `enumValue` 폴백)이다.
- 근거 코드: `frontend/src/shared/api/parseResponse.ts`, `frontend/src/shared/api/unknownValue.ts`, `frontend/src/shared/types/api/task.ts`, `frontend/src/shared/types/api/reply.ts`, `frontend/src/entities/task/api/taskApi.ts`.

### 합의 필요 변경

- 위 배포 순서를 BE 와 합의한다(#348 정책 결정 3). 합의 여부 확인 필요.
- BE 응답 스키마의 `status: str` 을 enum 타입으로 바꿔 OpenAPI 에 값 목록이 드러나게 해 달라(#348 정책 결정 4). `TaskFields.status`, `TaskHistoryResponse.changed_field`·`change_source`, `TimelineChange.field`·`evidence_status`, `TimelineReply.channel` 이 지금 `str` 이다. 합의 여부 확인 필요.

## 회의 삭제와 보존 태스크 (#576, 2026-11-09)

### 합의 상태

사용자가 #572 정책 확인에서 회의 원문·회의록·추출·근거 삭제와 기존 태스크 보존을 확정했다. 여러 회의가 합쳐진 승인 대기 카드는 삭제한 회의의 기여만 제거하고 남은 회의로 재구성한다. 아래 HTTP 형식과 done/failed 제한은 이번 구현의 기술 경계이며, 운영 배포 완료를 뜻하지 않는다.

### 현재 구현

경로는 `/api/v1` 기준이며 응답은 기존 `{data, error}` 봉투를 사용한다.

| 요청 | 권한과 응답 |
|---|---|
| `DELETE /meetings/{meeting_id}` | 해당 공간 PM. 본문 없음. 원문 제거 후 파일 정리가 남으면 202, 계보 전체 정리가 끝나면 200 |
| `GET /meetings/{meeting_id}/deletion` | 해당 공간 PM. 현재 삭제 접수 결과를 200으로 반환 |

두 응답의 `data`는 다음 형식이다.

```json
{
  "meeting_id": "요청한 회의 ID",
  "deleted_meeting_ids": ["같은 녹음의 원본과 재처리 회의 ID"],
  "deleted_at": "2026-11-09T00:00:00Z",
  "cleanup_status": "pending"
}
```

- `deleted_meeting_ids`는 정렬된 비어 있지 않은 목록이며 요청 ID를 포함한다. `deleted_at`은 시간대를 포함하고 반복 요청에서도 같다. `cleanup_status`는 `pending` 또는 `complete`다.
- 같은 원본의 재처리 계보 중 `created`, `processing`, `awaiting_speakers`가 하나라도 있으면 409 `MEETING_DELETE_BLOCKED`다. `error.details.status`에 해당 상태를 반환하며 원문은 바꾸지 않는다.
- 삭제된 회의의 상세·회의록·화자·오디오는 410 `MEETING_DELETED`다. 실제 없는 ID는 404 `MEETING_NOT_FOUND`다. 권한 없는 사용자는 기존 403을 따른다.
- 태스크 목록·상세는 `meeting_id`를 유지하고 `meeting_deleted: boolean`을 추가한다. 태스크 ID·업무 필드·버전·이력·Notion 작업은 보존한다.
- FE는 `meeting_deleted=true`일 때 **원본 회의가 삭제되어 근거를 볼 수 없음**을 표시한다. 회의 목록에 없다는 이유로 삭제를 추정하지 않는다.
- 성공 receipt를 받으면 같은 세션의 이전 원문 요청을 취소한다. 계보 상세·회의록·추출·승인의 비활성 캐시는 제거하고, 활성 화면은 원문 데이터를 비운 뒤 다시 조회한다. 화면을 이미 떠났으면 이동과 토스트만 생략한다. 세션이 바뀌면 이전 응답을 반영하지 않는다.
- `pending`은 삭제 접수와 DB 원문 제거를 뜻한다. 파일 정리 완료로 안내하지 않는다. 자동 DELETE 재시도는 하지 않고 실패 시 원본 화면에서 수동 재시도를 허용한다.

### 운영 활성화 경계

`MEETING_DELETION_ENABLED`는 기본 비활성이다. 명시적으로 `true`일 때만 DELETE를 허용하며, 그 외에는 503 `MEETING_DELETION_UNAVAILABLE`다. 과거 Discord 계보 중 검증되지 않은 행이 있으면 409 `MEETING_LINEAGE_UNVERIFIED`로 거절한다. 이 두 경계에서도 원문과 태스크는 바꾸지 않는다. 이미 접수한 receipt 조회·파일 정리와 삭제 후 410은 gate를 꺼도 유지한다.

회의 상세의 `deletion_available: boolean`은 gate 활성화, 계보 전체 준비 상태와 terminal 여부를 반영한다. FE는 해당 필드가 정확히 `true`이고 PM일 때만 삭제 CTA를 표시한다. 이전 서버가 필드를 생략하면 false로 다룬다. 과거 계보 복구와 구 봇 교체 확인은 [운영 절차](../../../deploy/README.md#회의-삭제-활성화-576)를 따른다.

### 구현과 검증 근거

- 서버 경계는 [삭제 서비스](../../../backend/app/services/meeting_deletion.py), [회의 API](../../../backend/app/api/meetings.py), [Task 응답](../../../backend/app/schemas/task.py)에 있다.
- FE는 [삭제 기능](../../src/features/meeting-delete/ui/MeetingDelete.tsx), [Task 변환](../../src/entities/task/model/mapper.ts), [라우팅 테스트](../../src/app/meetingDelete.test.tsx), [Chromium E2E](../../e2e/meeting-delete.e2e.ts)로 검증한다.
- 실제 실행 결과와 남은 환경 검증은 [#576 FE 결과](../issues/576-meeting-delete/result.md)와 [BE M3 결과](../../../backend/docs/plan/m3/result.md)에 기록한다. 봇 파일 정리 규약은 [BE·AI 대표 계약](../../../backend/docs/contracts/backend-ai-contract.md)에 둔다.

## Notion 선택 기능 (#507, 2026-11-07)

근거는 [이슈 #507](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/507)의 사용자 결정(2026-11-07)과 [D-182](../decision/frontend-decisions.md)다. 프론트엔드는 회의 올리기·정리·회의록·태스크·승인에 Notion 연결을 요구하지 않는다. 아래 서버 동작은 정적 코드 확인이고, 실 API 호출과 실제 Notion 반영은 실행하지 않았다.

### 합의된 규약

- Notion 은 선택 기능이다. 연결하면 태스크가 Notion 에도 반영된다(확실한 태스크는 바로, 확인 필요는 승인 뒤). 연결하지 않아도 회의 올리기·정리·회의록·태스크를 웹에서 모두 쓴다 — 사용자 결정(#507).
- 회의록 본문은 Notion 에 올리지 않는다. 반영 대상은 태스크뿐이다 — 서버 구현 사실(`backend/app/services/notion_sync.py`)을 사용자 결정 기록(D-182)에 적었다. 회의록 반영을 다시 넣을지는 합의 여부 확인 필요.

### 현재 구현

| 쪽 | 확인한 사실 |
|---|---|
| BE 업로드 | `POST /workspaces/{id}/meetings/upload`(`api/workspaces.upload_meeting`)는 정리 중 회의(409 `MEETING_PROCESSING_IN_PROGRESS`)·참석자·형식·크기만 검사한다. Notion 연결 검사가 없다 |
| BE 정리 실패 | `failed_stage` 는 AI 의 `PATCH /meetings/{id}/fail`(`stt`·`sources`·`extract`·`handoff`·`diarize`)과 멈춤 정리(`diarize`·`speaker_assignment_expired`·`upload_unclaimed`·`chat_stalled`)에서만 온다. Notion 때문에 실패하는 경로가 없다 |
| BE 태스크 | 미연동 공간의 태스크는 `notion_sync_status = null` 이다(`enqueue_task_sync`). 반영 잡은 「Notion 연동이 없습니다」로 SKIPPED 된다 |
| FE 회의 올리기 | 진입 판정은 회의 목록만 본다. `GET /integrations` 를 부르지 않고 차단 모달이 없다. 업로드 응답 409 `INTEGRATION_NOT_CONNECTED`·`INTEGRATION_REVOKED` 는 특별 처리하지 않고 폼 오류로 보인다(서버가 내지 않는다) |
| FE 정리 실패 | 알 수 없는 `failed_stage` 도 일반 실패 안내(D-092)다. 연동 상태를 다시 묻지 않고 재연결 모달(D-100)이 없다 |
| FE 설정 Notion 연결 | OAuth 복귀 경로는 `settings?section=notion` 하나다. `next`(업로드 복귀, D-098)를 싣지 않고 연결 뒤 설정에 머문다 |
| MSW | 업로드 handler 가 Notion 상태로 409 를 내지 않는다. `fail-notion-revoked` 흐름과 `meeting-fail-notion-revoked`·`meeting-notion-revoked` 시나리오를 지웠다. `meeting-notion-not-connected` 는 미연결 공간에서 업로드·정리가 끝나는 시나리오다 |

### 합의 필요 변경

없음. 서버는 이미 Notion 없이 동작한다. 아래 기존 요청 중 Notion 차단·끊김 모달을 근거로 한 것은 프론트엔드가 철회한다(§4.0-②-6 의 이유 변경, ②-9 의 Notion 409, ③-3). 각 줄에 「2026-11-07(#507)」로 적었다.

## 진행률 제거와 보완 승인 경계 (#311, 2026-11-04)

작업 근거는 [FE 요청 #305](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/305)와 [구현 이슈 #311](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/311)이다. 서버 규약은 [BE PR #307](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/307)의 스키마·승인 처리·계약 변경을 대조했다. 확인 당시 PR은 OPEN이며, 아래 규약이 로컬 백엔드나 배포 서버에 적용됐다고 가정하지 않는다. 아래의 예전 M6 필수값·MSW 전용 보완 기록보다 이 절의 후속 요구사항이 우선한다.

### 제안 값을 고쳐 승인 `task_overrides`

`PATCH /api/v1/approvals/{approval_id}` 한 번에 PM 수정값과 승인을 보낸다. 승인 뒤 별도 태스크 수정 요청을 보내지 않는다.

| 항목 | 규약과 FE 처리 |
|---|---|
| 생성 승인 | `task_title`, `assignee_member_id`, `due_date`만 수정한다. 상태는 선택하지 않으며 항상 `todo`로 생성한다 |
| 수정 승인 | `status`, `due_date`만 수정한다. 원래 제안의 다른 변경 필드와 근거는 보존한다. 예외로 담당자 줄이 있는 답장 카드는 `assignee_member_id`(팀원 또는 미정 `null`)도 받는다(BE #460, PR #503). FE 는 담당자를 찾지 못한 답장 카드(§5.7)에서만 보낸다 |
| 키 생략 | 해당 필드는 원래 제안을 유지한다. 편집하지 않은 현재 태스크 값을 보완값으로 채워 보내지 않는다 |
| 명시적 `null` | 담당자·마감을 미정으로 확정한다. `task_title`·`status`는 `null`을 허용하지 않는다 |
| 최종 생성값 검증 | 제목은 trim 후 1~300 코드 포인트, 지정된 담당자는 현재 공간 팀원, 지정된 마감은 유효한 `YYYY-MM-DD`다. 담당자·마감 미정만으로 승인을 막지 않는다 |
| 반려 | `{status: "rejected"}`만 전송한다. 보완값과 확인 버전을 섞지 않는다 |
| 실 API와 MSW | 같은 요청 매핑과 승인 판정을 사용한다. 보완값을 제거한 status-only 요청으로 자동 재시도하지 않는다 |
| 400·404 | 잘못된 키·날짜·상태는 400 `INVALID_REQUEST`, 다른 공간 담당자는 400 `WORKSPACE_MISMATCH`, 없는 팀원은 404 `MEMBER_NOT_FOUND`다. 서버 승인은 pending으로 남고 FE 입력도 유지한다 |
| 409 충돌 | 서버는 PM 수정값을 적용한 최종 값으로 검사한다. 응답 `conflicts[].proposed`를 반영 예정값으로 표시한다 |
| 명시적 재승인 | 충돌을 확인한 PM이 다시 누를 때 같은 수정값과 응답의 `details.task_version`을 `confirm_task_version`으로 보낸다. 재충돌은 새 정보를 표시하고 다시 확인받는다. 자동 재승인은 없다 |
| 확인 해제 | 충돌 후 승인 입력을 바꾸면 이전 확인 버전을 해제한다. 입력을 원래대로 되돌려도 과거 확인을 복원하지 않는다 |
| 이미 처리됨 | 기존 `APPROVAL_ALREADY_RESOLVED` 재조회와 중복 전송·세션 보호를 유지한다 |
| 승인 응답 | 원래 제안·근거는 유지하고 제안과 다른 값만 `payload.task_overrides`에 남는다. 완료 화면은 서버 응답의 원래 값에 보완값을 적용하며, `null`을 원래 값으로 대체하지 않는다 |
| 이력 | 채팅 회의(`source: "chat"`)에서 나온 항목을 승인하면 이력 `change_source`가 `"chat"`으로 남는다(구현됨, BE 담당 리뷰 대기). 이 값이 처음으로 실제로 쓰인다. 채팅 회의 항목은 자동 반영되지 않고 모두 승인 대기다. PM 수정 필드는 `change_source: "manual"`, `changed_by`는 승인한 PM이다. 다른 필드의 출처는 서버의 payload `change_source`와 생성·수정별 기본값을 따른다. FE는 서버 이력을 표시한다 |

요청 예시는 다음과 같다. 실행 검증 결과는 아래 연결한 M6 결과에서 별도로 구분한다.

```json
{"status":"approved","task_overrides":{"task_title":"로그인 API 연동","assignee_member_id":null}}
{"status":"approved","task_overrides":{"status":"done","due_date":null},"confirm_task_version":7}
```

### Task 진행률과 과거 이력

Task DTO·모델·생성 및 변경 요청·MSW와 현재 태스크 화면에서 `progress`를 제거한다. `in_progress` 상태, 회의 처리·업로드·온보딩 진행은 별개다. 과거 `changed_field: "progress"` 이력은 읽기 전용으로 표시하고 되돌리기를 제공하지 않는다. MSW 되돌리기도 이 필드를 400으로 거절한다. 노션의 기존 Progress 속성을 삭제하거나 기록하는 작업은 없다.

### 구현과 검증의 구분

FE 변경과 실제 검증은 [M6 후속 결과](../plan/m6/result.md)에 기록한다. 요청 경계는 [승인 DTO](../../src/shared/types/api/approval.ts), [도메인 판정](../../src/entities/approval/model/resolution.ts), [mapper](../../src/entities/approval/model/mapper.ts), [승인 훅](../../src/features/approval-resolve/model/useApprovalResolve.ts), [MSW 승인](../../src/shared/mock/handlers/approval.ts)에서 확인한다. MSW 성공은 실제 서버 승인·DB·Notion 반영의 증거가 아니다. 공개 서버의 `/openapi.json`은 확인 시 SPA HTML을 반환해 새 스키마·배포 상태를 검증하지 못했다. BE 변경을 배포한 환경에서 실 API 검증이 남는다.

## 현재 코드 대조 (2026-10-07)

이 파일은 프론트엔드–백엔드 API의 대표 계약이다. 제공자는 [백엔드 API](../../../backend/app/api), 소비자는 [프론트엔드 entities](../../src/entities)이며, 개발·테스트에서는 [MSW handlers](../../src/shared/mock/handlers)가 서버 응답을 모의한다. 아래는 현재 작업 트리 소스의 정적 확인 결과다. 실제 서비스 호출·OAuth·STT 성공이나 팀 간 신규 합의를 뜻하지 않는다.

기존 §1~§8의 명세·요청·결정 근거는 보존했다. 그 내용은 아래에 표시한 현재 구현과 다를 수 있으므로 과거 구현 상태를 현재 사실로 읽지 않는다. 기존 D-159·D-160에 따른 프론트엔드 가정과 요청을 새 합의로 승격하지 않는다.

### 공통 입출력과 소비 경계

| 항목 | 현재 프론트엔드 구현 | 코드 근거 |
|---|---|---|
| API 루트·인증 | 기본 `/api/v1`, `VITE_API_BASE_URL`로 변경, 쿠키 포함 요청 | [환경 설정](../../src/shared/config/env.ts), [클라이언트](../../src/shared/api/client.ts) |
| 성공·오류 | `{data, error}` 봉투에서 data 반환. 오류는 `ApiError`, 잘못된 봉투·네트워크·취소를 구분. 204는 `undefined` | [봉투](../../src/shared/api/envelope.ts), [오류 타입](../../src/shared/api/errors.ts), [서버 봉투](../../../backend/app/core/errors.py) |
| 목록·표기 | DTO는 `snake_case`, 목록 `{items, total}`. 엔티티 mapper에서 화면 도메인 모델로 변환 | [DTO](../../src/shared/types/api), [회의 mapper](../../src/entities/meeting/model/mapper.ts) |
| 캐시 | 업무 데이터 Query Key에 workspaceId 포함. 회의 상세 요청 경로에 공간이 없으므로 상세 Query가 응답 `workspace_id`를 key의 공간과 비교하고, 다르면 `WORKSPACE_MISMATCH`(kind `invalid_response`, 재시도 안 함)로 던져 성공 캐시에 넣지 않는다. 화면(회의록·처리·화자 지정·대시보드 최근 반영)은 받아 둔 정상 상세가 있어도 이 오류나 403·404를 받으면 그 상세를 쓰지 않고(`viewableMeeting`, `isMeetingUnavailable`) 볼 수 없는 회의·오류로 그리며 후속 조회를 끈다. 회의록 본문·화자 목록의 403·404도 받아 둔 값을 쓰지 않는다. 대시보드 최근 반영은 404면 그 회의를 고르기에서 빼고 회의 목록을 다시 받아 다음 완료 회의를 보이고, 403·다른 공간이면 오류로 그린다. 처리 추적은 다른 공간 응답이면 받아 둔 상태가 없을 때만, 403·404면 바로 추적을 끝낸다 (#349, #405). 서버의 상태 코드 규약은 그대로다 | [Query Key](../../src/shared/api/queryKeys.ts), [회의 Query](../../src/entities/meeting/api/meetingQueries.ts), [공간 불일치 오류](../../src/shared/api/errors.ts), [처리 판정](../../src/features/meeting-processing/model/trackerOutcome.ts), [대시보드 조회](../../src/widgets/dashboard/model/useDashboardData.ts) |
| 오류·권한 | 요청의 401을 현재 세션에 한해 알림. 소속·온보딩·PM 가드는 화면 접근을 제한하며 서버 권한 검사와 별개 | [클라이언트](../../src/shared/api/client.ts), [라우트](../../src/app/router/routes.tsx), [서버 권한](../../../backend/app/api/deps.py) |

### 주요 API와 데이터 형식

세부 필드와 화면별 요구는 아래 §2·§4·§5·§6에 유지한다. 현재 소비하는 주요 경계는 다음과 같다.

| API (`/api/v1` 아래) | 입력·출력 | 소비 코드 |
|---|---|---|
| `POST /auth/signup`, `POST /auth/login`, `POST /auth/logout`, `GET /auth/me` | 가입 `{verification_token?,password,name,link_kakao}`, 로그인 `{email,password}`. 이메일 증명·카카오 대기 조건은 §4.1.4다. 세션 DTO를 도메인 세션으로 변환, 토큰을 화면에 전달하지 않음 | [인증](../../src/entities/user/api/auth.ts), [세션](../../src/entities/user/api/session.ts), [인증 DTO](../../src/shared/types/api/auth.ts) |
| `/workspaces` 목록·생성·상세, `PATCH /workspaces/{id}/onboarding` | 공간·역할·단계 상태를 사용. 단계 갱신 후 상세 재조회 | [공간 API](../../src/entities/workspace/api), [공간 DTO](../../src/shared/types/api/workspace.ts) |
| `GET /workspaces/{id}/integrations`, `DELETE /workspaces/{id}/integrations/{provider}` | Discord·Notion 상태. 해제는 204 무본문. Discord 의 `chat_channel` 과 채팅 채널 목록·저장·해제는 §4.3.1 | [연동 API](../../src/entities/integration/api/integrations.ts), [연동 DTO](../../src/shared/types/api/integration.ts) |
| `POST /workspaces/{id}/meetings/upload` | multipart `title`, ISO `started_at`, 참석자별 반복 `attendee_member_ids`, `file`. 202 data `{meeting_id,status}` | [업로드](../../src/entities/meeting/api/uploadMeeting.ts), [회의 DTO](../../src/shared/types/api/meeting.ts) |
| `GET /workspaces/{id}/meetings`, `GET /meetings/{id}` | 목록은 `{items,total}`, nullable title. 상세는 workspace_id·status·progress·extraction_id·failed_stage | [회의 조회](../../src/entities/meeting/api/meetingQueries.ts), [회의 DTO](../../src/shared/types/api/meeting.ts) |
| `GET /meetings/{id}/minutes` | nullable summary·title, 참석자 배열, 전사 배열, permissions `{can_review,can_undo}` | [회의록 조회](../../src/entities/minutes/api/minutesQuery.ts), [회의록 DTO](../../src/shared/types/api/minutes.ts) |
| 회의 추출·대기 승인 조회 | 반영 항목과 확인 필요 항목을 조합. 일반 팀원은 대기 승인 조회·확인 필요 영역 제외 | [추출 조회](../../src/entities/extraction/api/extractionQuery.ts), [승인 조회](../../src/entities/approval/api/pendingApprovals.ts), [회의록 화면](../../src/pages/meetings) |

업로드 화면의 형식·한도는 [uploadPolicy](../../src/entities/meeting/model/uploadPolicy.ts)의 MP3·WAV·M4A·OGG·WebM, 200 MiB·2시간이다. 브라우저 검증이 서버의 동일 검증을 보장하지 않는다. 전송 진행률 100%와 서버의 처리 완료는 다르며, 409 `MEETING_PROCESSING_IN_PROGRESS`는 `details.meeting_id`로 기존 처리 화면에 연결한다. 처리 상세는 3초 간격으로 추적하며 완료·실패·접근 상실 시 중단한다.

### 기존 명세와 현재 서버의 차이

| 기존 문서의 상태·요청 | 현재 코드에서 확인한 사실 | 남은 제약·합의 상태 |
|---|---|---|
| §4.2 온보딩 저장 스텁 | [workspaces.py](../../../backend/app/api/workspaces.py)의 `update_onboarding`은 PM 검사·행 잠금·단계 저장·완료 상태 갱신을 수행 | 실 API 재개 흐름은 이번 작업에서 실행 검증하지 않음 |
| §4.3 OAuth start·callback 없음 | [integrations.py](../../../backend/app/api/integrations.py)에 Notion·Discord start와 `/integrations/{provider}/callback` 구현. [main.py](../../../backend/app/main.py)에 callback router 등록 | Google 로그인은 제외. Discord·Notion의 실제 설정·외부 인증 성공은 이번 작업에서 미검증 |
| §4.0-②-17 업로드 PM 권한 강제 요청 | [workspaces.py](../../../backend/app/api/workspaces.py)의 업로드 의존성이 `get_current_pm` | 기존 요청은 과거 기록으로 보존. 서버 권한 동작은 실행 검증하지 않음 |
| §4.4 반복 참석자 multipart 필드 | 프론트는 참석자마다 필드를 반복. 서버는 `attendee_member_ids: list[str] = Form(...)`로 받고 중복 제거·소속 검사 후 `MeetingUpload`에 저장 | 과거 형식 차이는 현재 코드에 없음. 실제 파일 처리 성공은 별도 검증 |
| §4.4 파일 저장 | 업로드는 processing 회의 행을 만들고 녹음 파일과 참석자(`meeting_upload`)를 저장한다. 화자 지정은 §2.3.1 | 실제 업로드부터 처리 완료까지 성공을 선언하지 않음 |
| §4.0-②-11 회의록 본문 하드코딩·summary 미생성 | [meetings.py](../../../backend/app/api/meetings.py)는 Source에서 전사·참석자를 구성하고 Extraction.summary JSON을 읽음 | summary 저장 여부·실제 파이프라인 성공은 이 정적 확인만으로 검증하지 않음 |
| §4.5 Discord 사용자 목록 스텁 | 연동과 봇 토큰을 확인한 뒤 `discord.list_guild_members`로 외부 목록을 조회 | 토큰·봇 권한·실제 서버 응답은 별도 검증 |

이번 문서 구조화로 요청·합의 상태를 변경하지 않는다. 신규 확인은 정적 코드 대조이고, 실 연동 검증 결과와 담당 파트 합의는 별도 근거가 필요하다. 백엔드 요청 목록은 계속 이 문서 §4를 사용하며 [request 디렉터리](../requests)에 복제하지 않는다.

### M6 태스크·승인 처리 경계 (2026-10-11 코드 대조)

M6 S1에서 프론트 계약·데이터 계층을 현재 서버 코드에 맞췄다. 아래 「현재 서버 구현」은 [tasks.py](../../../backend/app/api/tasks.py), [approvals.py](../../../backend/app/api/approvals.py), [task 스키마](../../../backend/app/schemas/task.py), [approval 스키마](../../../backend/app/schemas/approval.py)의 정적 확인이다. 실 API 호출·실제 Notion 반영은 실행하지 않았다. 「미합의 요청안」은 프론트가 고정한 요청 형태일 뿐이며 백엔드와 합의된 사실이 아니다(합의 여부 확인 필요). 이 절은 §2.5·§2.6·§4.0-③·§4.8-1·§8의 처리자·Notion 판단 기록보다 최신 코드 대조이며, 이전 기록은 과거 상태로 보존한다.

#### 현재 서버 구현

| 항목 | 서버 코드에서 확인한 사실 |
|---|---|
| `TaskResponse.version` | 정수, 생성 시 1. 서버의 태스크 변경마다 1씩 오른다 (`services/tasks.py`) |
| `TaskResponse.notion_sync_status` | `pending` \| `synced` \| `failed`, 미연동이면 `null` (`NotionSyncStatus`). `notion_page_id`와 별개 필드다 |
| `PATCH /tasks/{task_id}` | PM 전용(`require_pm`). 변경자는 세션 팀원으로 기록하고 본문 `changed_by`는 무시한다(하위 호환 필드) |
| `POST /tasks/{task_id}/notion-sync/retry` | PM 전용, 본문 없음. 응답은 `TaskResponse`. Notion 미설정이면 409 `INTEGRATION_NOT_CONNECTED`, 재시도할 실패 건이 없으면 400 `INVALID_REQUEST` |
| `GET /tasks/{task_id}`, `GET /tasks/{task_id}/history` | 태스크 공간의 소속 팀원만 조회(`require_task_member`). 경로에 공간이 없고, 이력 응답에는 `workspace_id`가 없다 |
| `PATCH /approvals/{approval_id}` 본문 | `ApprovalResolveRequest` = `status`(`approved`·`rejected`), `task_overrides?`(아래 「제안 값을 고쳐 승인」), `confirm_task_version?`(정수 ≥ 1), `save_alias?`(불리언, 기본 false. 2026-11-08 #523, §2.5 「승인 때 별칭 학습」), `resolved_by?`(하위 호환, 무시). 처리자는 세션 PM으로 정한다 |
| 409 `APPROVAL_CONFLICT` | `task_update` 승인에서 제안 뒤 같은 필드가 바뀌면 반영하지 않고 pending으로 되돌린다. `details = {approval_id, task_id, task_version, conflicts: [{field, base, current, proposed}]}` (`_find_conflicts`). PM이 그 `task_version`을 `confirm_task_version`으로 보내면 태스크가 그 버전 그대로일 때만 덮어쓴다. 그 사이 또 바뀌면 다시 409다 |
| 409 `APPROVAL_ALREADY_RESOLVED` | `details = {approval_id, current_status}` |
| 승인 목록·상세 조회 | 목록은 `get_current_member`, 상세는 `require_member`. 공간 소속만 검사하고 PM 제한은 없다 |
| 생성 승인 반영 | payload의 `task_title`·`assignee_member_id`·`due_date`에 `task_overrides`를 덮어 쓴다. 상태는 payload와 상관없이 항상 `todo`다. 담당자·마감 필수 검사는 없다(미정 허용, M6-3 은 받지 않음) |

`APPROVAL_CONFLICT`는 [서버 오류 코드](../../../backend/app/core/errors.py)에 있으나 프론트의 [오류 코드 목록](../../src/shared/api/errors.ts)과 §1의 31개 목록에는 아직 없다. 프론트는 승인 엔티티가 코드 문자열로 판별한다.

#### 현재 프론트 구현

| 항목 | 구현 | 코드 근거 |
|---|---|---|
| 태스크 Query | 목록 `['workspace', id, 'tasks', 'list']`, 상세 `[…, 'detail', taskId]`, 이력 `[…, 'history', taskId]`. 접두어 `taskKeys(workspaceId)`를 공유한다 | [taskApi](../../src/entities/task/api/taskApi.ts) |
| 공간 확인 | 목록·상세·상태 변경·재시도 응답의 `workspace_id`가 요청 공간과 다르면 `WORKSPACE_MISMATCH`(kind `invalid_response`)로 던져 캐시에 성공 데이터로 넣지 않는다. 이력은 같은 태스크 상세(캐시 재사용)로 공간을 확인하고, 항목의 `task_id`가 다르면 `INVALID_RESPONSE`다 | [taskApi](../../src/entities/task/api/taskApi.ts) |
| 상태 변경·재시도 본문 | 상태 변경은 `{status}`만, 재시도는 본문 없음. `changed_by`를 보내지 않는다 | [taskApi](../../src/entities/task/api/taskApi.ts) |
| Task 매핑 | `version`이 정수가 아니거나 `status`가 네 값 밖이면 응답 스키마가 거절해 `INVALID_RESPONSE`다. mapper 까지 오지 않는다(2026-11-08 #348, 맨 위 「응답 검증과 새 값 배포 순서」). `notionSyncStatus`는 세 값과 `null`만, 모르는 문자열은 `null`. 반영 완료 판단은 `isNotionSynced` = `synced`뿐이며 `notion_page_id` 존재로 판단하지 않는다 (§4.8-1을 대체) | [Task mapper](../../src/entities/task/model/mapper.ts), [Task DTO](../../src/shared/types/api/task.ts) |
| 승인 처리 본문 | `resolveApproval`이 `planApprovalResolution` 판정을 통과한 본문만 보낸다. `resolved_by`를 보내지 않는다. `confirm_task_version`은 `task_update` 승인에서 호출자가 서버 버전(정수 ≥ 1)을 줄 때만 싣는다 | [resolveApproval](../../src/entities/approval/api/resolveApproval.ts), [판정](../../src/entities/approval/model/resolution.ts), [승인 DTO](../../src/shared/types/api/approval.ts) |
| 409 해석 | `toApprovalResolveFailure`가 `conflict`(`taskVersion`, `conflicts[]`)와 `already_resolved`(`currentStatus`)를 구분한다. details 모양이 틀리면 null(일반 오류) | [승인 mapper](../../src/entities/approval/model/mapper.ts) |
| 생성 승인 판정 | 제목 trim 후 1~300자(코드 포인트), 담당자는 호출자가 넘긴 현재 공간 팀원 ID 목록에 포함, 마감은 유효한 `YYYY-MM-DD`. 하나라도 아니면 승인 본문을 만들지 않고 이유 문자열을 돌려준다. 반려 본문은 `{status: "rejected"}`로 항상 만들 수 있다. 지원하지 않는 종류와 pending이 아닌 승인은 승인·반려 모두 만들지 않는다 | [판정](../../src/entities/approval/model/resolution.ts) |

#### 제안 값을 고쳐 승인 `task_overrides` (#303 에서 서버 구현)

아래 요청안의 이름과 생성 승인 키를 그대로 받아 서버가 구현했다. 요청안과 다른 점은 수정 제안(`task_update`)도 받는 것과, 담당자·마감을 필수로 하지 않는 것(M6-3 미채택)이다. 근거는 [결정 기록 0032](../../../ai/docs/basis_for_decision/ai/2026-11-04-0032-approval-overrides-and-progress-drop.md).

| 항목 | 서버 동작 |
|---|---|
| 받는 때 | `status: "approved"` 일 때만. 반려와 같이 보내거나 `reminder_dm` 에 보내면 400 `INVALID_REQUEST` 이고 승인 상태도 바뀌지 않는다 |
| `task_create` 키 | `task_title`, `assignee_member_id`, `due_date`. 상태는 고를 수 없고 항상 `todo` |
| `task_update` 키 | `status`, `due_date`. 담당자 줄이 있는 답장 카드(답장 판단의 변경 줄에 담당자가 있는 카드)는 `assignee_member_id` 도 받는다(`null` 이면 미정, #460). 상태·마감만 있는 답장 카드, 회의 추출 카드, 수동 생성 카드에 보내면 400 `INVALID_REQUEST` 다. 카드는 payload 가 아니라 답장 판단 기록으로 고른다 |
| 키가 없을 때 | 그 필드는 제안 그대로 |
| `null` | `assignee_member_id`·`due_date` 는 "미정"(담당자 없음, 마감 없음). `task_title`·`status` 의 `null` 은 400 |
| 그 밖의 키, 잘못된 날짜·상태 | 400 `INVALID_REQUEST`. 새 태스크 승인에 `title` 키를 보내도 400(`task_title` 을 쓴다). 승인은 pending 으로 남는다 |
| 다른 공간 담당자, 없는 팀원 | 400 `WORKSPACE_MISMATCH`, 없거나 탈퇴한 팀원 id 는 404 `MEMBER_NOT_FOUND`. 승인은 pending 으로 남는다. 제안의 담당자가 그사이 탈퇴했어도 같고, `task_overrides` 로 다른 담당자나 미정을 고르면 승인된다. `PATCH /tasks` 와 이력 되돌리기도 탈퇴한 팀원을 담당자로 새로 넣지 못한다(지금 담당자를 그대로 보내는 것은 된다) |
| 충돌 검사 | 고친 값을 반영한 최종 값으로 기존 `APPROVAL_CONFLICT` 검사를 한다. 제안에 없던 필드를 PM 이 고치면 `base_values` 가 없어 이 검사를 하지 않는다. PM 이 지금 값을 보고 고른 값으로 보고 그대로 덮어쓴다. 예외로 담당자를 찾지 못한 답장 카드는 제안에 담당자가 없어도 `base_values.assignee_member_id`(제안 시점 담당자)로 검사한다. #460 배포 전에 만들어진 카드는 이 기준값이 없어 검사하지 않는다. 충돌을 값 검증보다 먼저 보므로, 그사이 담당자가 바뀐 카드에 탈퇴자를 고르면 먼저 409 이고 다시 승인할 때 404 다 |
| 이력 | 고친 필드는 `change_source: "manual"`, `changed_by` 는 승인한 PM. 수정 제안은 지금 값에서 PM 값으로, 새 태스크는 생성 줄 다음에 제안 값에서 PM 값으로. 고치지 않은 필드는 승인 요청의 출처(payload `change_source`). 없으면 수정 제안은 `meeting`, 새 태스크는 `meeting_id` 가 있으면 `meeting` 없으면 `manual` |
| 승인 기록 | payload 의 원래 제안과 근거는 그대로 두고, 제안과 다른 값만 `payload.task_overrides` 에 남는다. 조회 응답에서 볼 수 있다 |
| `POST /approvals` | payload 에 `task_overrides` 키가 있거나 `change_source` 가 정해진 값(`meeting`·`chat`·`checkin`·`notion`·`reminder_reply`·`manual`)이 아니면 400. `change_source` 는 PM 만 보낼 수 있고 일반 팀원이 보내면 400 |

#### (기록) 미합의 요청안: 생성 승인 보완 `task_overrides`

현재 서버가 받는 입력이 아니다. 기존 `PATCH /approvals/{approval_id}`에 다음 필드를 추가하는 형태로 프론트가 고정했다. `status: "approved"`이고 승인 종류가 `task_create`일 때만 쓴다.

```json
{
  "status": "approved",
  "task_overrides": {
    "task_title": "확정할 제목",
    "assignee_member_id": "현재 공간의 팀원 ID",
    "due_date": "2026-10-15"
  }
}
```

- 실 API(transport `live`)에는 이 필드를 보내지 않는다. 호출자가 보완값을 넘겨도 본문에서 제거하고, 기존 payload 값으로만 판정한다. 필수값이 이미 충족되면 보완 없이 `{status: "approved"}`로 승인하고, 아니면 승인 본문을 만들지 않는다. 미지원 필드가 조용히 무시된 채 승인되는 요청을 만들지 않기 위해서다.
- transport가 `msw`일 때만 approved `task_create` 본문에 싣는다. transport 인자가 빠지거나 모르는 값이면 `live`로 본다. 반려 본문과 `task_update`에는 싣지 않는다.
- 현재 MSW 승인 handler는 이 필드를 아직 읽지 않고 `resolved_by`를 요구한다. MSW의 서버 의미 맞춤과 보완 적용은 M6 S2 범위이며 이 절의 구현 사실이 아니다.

> 2026-10-11 S5 코드 대조: 바로 위 MSW 문장은 S1 시점 기록이다. 현재 [MSW 승인 handler](../../src/shared/mock/handlers/approval.ts)는 아래처럼 동작한다. 이는 개발·테스트용 모의 서버의 구현 사실이며, 실제 서버 구현이나 백엔드 합의가 아니다(아래 M6-1~M6-3은 여전히 합의 여부 확인 필요).
>
> - 본문 `resolved_by`를 요구하지 않는다. 처리자는 세션 팀원([sessions.ts](../../src/shared/mock/sessions.ts)의 고정 대응)이고 PM이 아니면 403이다. `confirm_task_version`은 정수 ≥ 1 또는 생략·`null`만 받는다.
> - approved `task_create`에서 `task_overrides`를 읽는다. 세 필드가 모두 문자열인 객체가 아니면 400 `INVALID_REQUEST`(`details.field = "task_overrides"`)다. 보완값이 있으면 payload의 제목·담당자·마감을 대신한다.
> - 보완값이 **없어도** 최종 제목(trim 후 1~300자)·담당자·마감(유효한 `YYYY-MM-DD`)을 검사하고, 실패하면 400 `INVALID_REQUEST`(`details.field`)다. 위 「현재 서버 구현」의 생성 승인 반영(필수 검사 없음)과 다르며, 요청안 M6-3을 모의한 동작이다.
> - 추출 항목의 공간·연결 승인, 담당자·회의 소속을 모두 검증한 뒤에만 태스크 생성·이력·추출 항목 `task_id` 연결·승인 상태 변경을 한꺼번에 적용한다. 실패하면 아무것도 바꾸지 않는다(요청안 M6-2 모의). 추출 항목의 `approval_id`는 서버처럼 남긴다.
> - 승인 목록·상세 조회는 서버처럼 공간 소속만 검사한다. PM 제한(요청안 M6-4)은 모의하지 않는다.
> - 화면의 처리 경로(transport)는 개발 서버이고 `VITE_ENABLE_MSW=true`일 때만 `msw`다(당시 `transport.ts`, #311에서 삭제). production 빌드와 Storybook 빌드는 `live`라 `task_overrides`를 보내지 않는다.

#### 백엔드 요청 (합의 여부 확인 필요)

| # | 요청 | 이유 |
|---|---|---|
| M6-1 | 요청: `ApprovalResolveRequest`에 위 `task_overrides`를 추가하고 approved `task_create`에서만 받는다. 결과: #303 에서 반영했고 `task_update` 까지 받는다 | 담당자·마감이 없는 생성 승인을 PM이 보완 후 승인할 경로가 없다 |
| M6-2 | 보완값 적용·승인 상태 변경·태스크 생성·추출 항목 `task_id` 연결을 한 트랜잭션으로 처리한다 | 일부만 반영되면 승인·태스크·회의록이 어긋난다 |
| M6-3 | 요청: 생성 승인의 최종 제목(trim 후 1~300자)·담당자(같은 공간 팀원)·마감(유효 날짜)을 필수로 검증한다. 결과: #303 에서 받지 않았다. 제목은 검증하지만 담당자·마감은 미정을 허용한다 | M6 제품 규칙. 현재 서버는 담당자·마감 없이 태스크를 만든다 |
| M6-4 | 승인 목록·상세 조회를 PM으로 제한한다 | 프론트 가드와 요청 차단만으로는 일반 팀원의 직접 호출을 막지 못한다 |

이 요청은 프론트 계약에 기록한 것이며 백엔드에 전달·합의된 근거는 이 문서에 없다. 실 API 보완 승인, 승인 조회 PM 제한, 실제 Notion 반영은 미검증 연동 과제로 남는다.

#### 검증 범위

S1에서 실행한 검증은 프론트 단위·MSW 테스트다([taskApi 테스트](../../src/entities/task/api/taskApi.test.ts), [Task mapper 테스트](../../src/entities/task/model/mapper.test.ts), [판정 테스트](../../src/entities/approval/model/resolution.test.ts), [승인 처리 테스트](../../src/entities/approval/api/resolveApproval.test.ts), [승인 mapper 테스트](../../src/entities/approval/model/mapper.test.ts)). 서버 응답 모양은 테스트 안의 MSW override로 재현했으며 실 백엔드 호출로 확인하지 않았다.

### M7 대시보드·항목 되돌리기 경계 (2026-10-17 코드 대조)

M7 구현에서 소비하기 시작한 서버 인터페이스다. 「현재 서버 구현」은 [extractions.py](../../../backend/app/api/extractions.py)의 `revert_auto_item`·`get_extraction`, [meeting 스키마](../../../backend/app/schemas/meeting.py)의 `ExtractionItemResponse`·`ExtractionItemRevertResponse`, [태스크 삭제](../../../backend/app/services/tasks.py)의 정적 확인이다. 실 API 호출·실제 Notion 페이지 보관은 실행하지 않았다(미검증). 이 절은 아래 §2.4·§5.4의 이전 기록보다 최신이다.

#### 현재 서버 구현

| 항목 | 서버 코드에서 확인한 사실 |
|---|---|
| `ExtractionItemResponse.reverted_at` | auto로 만든 태스크를 PM이 되돌린 시각. 없으면 `null`. 되돌려도 `gate`는 `auto`로 남는다 |
| `ExtractionItemResponse.approval_status` | 연결된 승인 요청의 지금 상태(`pending`·`approved`·`rejected`). 승인이 없으면 `null`. 항목과 한 쿼리로 읽는다(#211) |
| `ExtractionItemResponse.alias_candidate`·`alias_text` | 2026-11-08 코드 대조(#523). 승인 응답과 같은 규칙의 별칭 학습 후보다. §2.5 「승인 때 별칭 학습」 |
| 지운 태스크의 `task_id` | 조회 시 지운 태스크를 가리키면 `task_id`를 `null`로 내린다 |
| `POST /extractions/{extraction_id}/items/{item_id}/revert` | 본문 없음. 추출 404 `EXTRACTION_NOT_FOUND` → 그 회의 공간의 PM(`require_pm`, 아니면 403 `FORBIDDEN`) → 항목 404 `EXTRACTION_ITEM_NOT_FOUND` 순서다. 통과하면 태스크를 지움 표시(`version` +1, Notion 동기화 요청 → 워커가 페이지 보관)하고, 같은 내용의 `TASK_CREATE` 승인(`gate: "review"`, 표시용 `reverted_task_id`)을 만들고, 항목의 `task_id`를 비우고 `approval_id`를 새 승인으로, `reverted_at`·`reverted_by`를 기록한다 |
| 응답 | `{item_id, reverted_task_id, approval_id, reverted_at}`. 새 승인은 `pending`이다 |
| 409 `AUTO_TASK_NOT_REVERTIBLE` | `details = {item_id, reason, …}`. `reason`은 `already_reverted`, `not_auto_created`(gate·action·task_id 조건), `task_missing`(+`task_id`), `task_changed`(태스크 `version != 1`, +`task_id`·`task_version`), `pending_approval`(그 태스크 대상 대기 승인, +`task_id`·`approval_id`) |
| 새 승인을 승인하면 | 승인 반영이 그 항목에 새 태스크를 잇는다. `reverted_at`은 남는다 |

#### 현재 프론트 구현

| 항목 | 구현 | 코드 근거 |
|---|---|---|
| 추출 DTO·모델 | `reverted_at` → `revertedAt`, `approval_status` → `approvalStatus`. 필드가 없던 응답과 모르는 승인 상태는 `null` | [추출 DTO](../../src/shared/types/api/extraction.ts), [추출 mapper](../../src/entities/extraction/model/mapper.ts) |
| 되돌리기 요청 | `revertAutoItem(extractionId, itemId)`. 경로 칸을 인코딩하고 본문을 보내지 않는다. 409 `AUTO_TASK_NOT_REVERTIBLE`만 `toAutoItemRevertRejection`이 사유로 읽고, 모르는 사유는 `unknown`이다. 나머지 실패는 공통 오류 문구다 | [revertAutoItem](../../src/entities/extraction/api/revertAutoItem.ts), [오류 코드](../../src/shared/api/errors.ts) |
| 되돌리기 화면 | PM만. 확인 모달 → 서버 성공 뒤에만 반영(낙관적 업데이트 없음). 성공 응답을 그 추출 캐시 항목에 쓰고 태스크·승인·추출 캐시를 무효화한다. 실패(거절·403·404·네트워크)도 같은 캐시를 다시 받는다. 자동 재시도 없음 | [useAutoItemRevert](../../src/features/auto-item-revert/model/useAutoItemRevert.ts) |
| 대시보드 조회 | 집계 API 없이 기존 조회를 조립한다(§4.6 철회 유지). 아래 §5.4 | [useDashboardData](../../src/widgets/dashboard/model/useDashboardData.ts) |
| 프론트 오류 코드 | `EXTRACTION_ITEM_NOT_FOUND`·`AUTO_TASK_NOT_REVERTIBLE`을 추가해 서버 38개와 같다 | [오류 문구](../../src/shared/api/errorMessages.ts) |

`approval_status`는 M7 대시보드의 되돌림 결과(`revertOutcome`)에 쓴다. #419(2026-11-06)부터 회의록 태스크 영역의 반영 판정에도 쓴다. 확인 필요 판정은 계속 대기 승인 목록과의 조인이다(§3.1, `pendingItems`).

#### 모의 서버(MSW)

[추출 handler](../../src/shared/mock/handlers/extraction.ts)가 위 순서·거절 사유·403/404를 재현한다. 차이는 다음과 같다(개발·테스트용 사실이며 서버 계약이 아니다).

- 지운 태스크는 지움 표시 대신 목록에서 뺀다. 조회에서 빠지는 결과는 같다. Notion 페이지 보관은 흉내내지 않는다.
- MSW 항목에 `action`이 없어 `not_auto_created`는 `gate`·`task_id`로만 판정한다.
- 조회의 `approval_status`는 저장값이 아니라 지금 승인 상태로 채운다.

#### 합의 상태

새 요청은 없다. 서버가 이미 구현한 인터페이스에 프론트가 맞췄다(D-160). 실 API 되돌리기 성공·거절과 Notion 페이지 보관은 실행 검증하지 않았다. 검증 범위는 [M7 결과](../plan/m7/result.md)에 있다.

---

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
- 비밀번호 재설정(BE PR #398, 2026-11-06 병합)이 `PASSWORD_RESET_TOKEN_INVALID(400)`·`MAIL_UNAVAILABLE(503)` 을 더했다. 위 31개에는 넣지 않았고 쓰임새는 §4.1.1 에 있다. 프론트 [오류 코드 목록](../../src/shared/api/errors.ts)과 [문구](../../src/shared/api/errorMessages.ts)에도 있다.
- 회의 채팅 채널(#428)이 `DISCORD_CHANNEL_NOT_FOUND(404)`·`DISCORD_CHANNEL_NOT_ACCESSIBLE(409)` 를 더했다. 위 목록의 개수는 이 절을 처음 쓴 때 기준이며 전체 목록은 `core/errors.py` 가 원천이다 → §4.3.1.
- 본 뒤 바뀐 승인 카드 `APPROVAL_CHANGED(409)` 는 BE #547 이 더했다 → §2.5.
- 로그인 시도 제한(BE PR #456, 2026-11-07 병합)이 `TOO_MANY_LOGIN_ATTEMPTS(429)` 를 더했다. 위 목록에는 넣지 않았고 쓰임새는 §4.1.3 에 있다.
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
- ~~**`GET /workspaces/{workspace_id}` 에 멤버십 검사가 없다.** 로그인만 하면 남의 워크스페이스를 ID 로 읽는다.~~
  **2026-09-29 `backend/` 기준 고쳐졌다.** 로그인(401) → 공간 존재(404) → `require_member`(비소속 403) 순서다 → §4.0-②-1.
- 이름 중복은 409 `WORKSPACE_NAME_DUPLICATED` 다. 다만 **완전일치 + 전역** 비교라 D-015~D-020 과 다르다 → §4.0-②-2.

### 2.2 members · aliases

| Method | Path | 비고 |
|---|---|---|
| POST | `/api/v1/members` | 201 |
| GET | `/api/v1/members?workspace_id=` | `workspace_id` 필수 |
| GET · PATCH | `/api/v1/members/{member_id}` | 대기 초대가 있는 팀원을 PM 으로 올리면 409 (§5.9) |
| POST | `/api/v1/members/{member_id}/aliases` | 별칭 추가 |
| GET | `/api/v1/members/aliases?workspace_id=` | 별칭 목록 |
| GET | `/api/v1/members/unresolved-aliases?workspace_id=` | **미매칭 이름** |
| DELETE | `/api/v1/members/aliases/{alias_id}` | 204 |

```jsonc
// MemberResponse
{"member_id": "mb_01", "workspace_id": "ws_01", "display_name": "김서연",
 "discord_user_id": "1123...", "notion_name": null,
 "role": "member", "has_login_account": true, "created_at": "2026-09-15T04:10:00Z"}
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

2026-11-09 #575 구현은 `MemberResponse.has_login_account: boolean`을 추가한다. 활성 팀원에 로그인 계정이 연결됐는지 나타내며 User ID는 반환하지 않는다. FE는 `hasLoginAccount`로 옮기고, PM에게 로그인 연결된 일반 팀원의 `PM 권한 부여`를 제공한다. 기존 `PATCH /members/{id}`의 `{role:"pm"}`를 사용하며 기존 PM의 권한은 유지한다. 대기 초대의 `MEMBER_HAS_PENDING_INVITATION` 등 서버 오류는 그대로 따른다. 생산자·소비자 코드를 함께 변경한 현재 구현이며, 별도 파트 합의·병합·배포 완료 기록은 아니다.

계정 영구 탈퇴용 익명 기록 주체는 기존 명단 비활성화와 구분한다. 영구 탈퇴자의 대화는 PM 목록·상세·읽음에 남고 표시명은 `탈퇴한 사용자`, `web_reply_available`은 false다. 프로필 수정·별칭 추가·초대·새 발송과 늦은 봇 결과는 거절한다. 기존 `is_deleted`만 있는 명단 비활성화의 unread 0·읽음 POST 404는 유지한다. [익명 주체 결정](../../../backend/docs/plan/m1/basis-for-decision/2026-11-09-withdrawn-record-actor.md)에 첫 구현의 범위를 기록했고, 본인 탈퇴 API·화면과 기록용 목록은 위 [계정 탈퇴 규약](#계정-탈퇴와-정리-상태-575-2026-11-09)을 따른다. 실제 외부 제공자·운영 계정의 삭제를 확인한 기록은 아니다.

- `alias_type` 은 `realname` \| `nickname` \| `mention` \| `inferred`, `source` 는 `manual` \| `discord_profile` \| `learned` \| `display_name`.
  **2026-11-08 코드 대조(#523, BE #463·#464):** `display_name` 은 서버가 팀원 이름과 성 뗀 이름으로 자동으로 넣는 별칭이다(확인됨, 1.0). 이름을 바꾸면 옛 이름에서 만든 `display_name` 별칭만 지워진다. 한글 디스코드 닉네임은 `discord_profile`(미확인, 0.8)로 들어간다. `learned` 는 PM 이 승인하며 배운 별칭이다(§2.5 「승인 때 별칭 학습」).
- **2026-11-08 코드 대조(#523):** `POST /members/{member_id}/aliases` 와 `DELETE /members/aliases/{alias_id}` 는 PM 전용이다(아니면 403 `FORBIDDEN`). 별칭 목록 조회는 소속 팀원 누구나 한다. `POST` 는 `alias_text` 의 공백을 정리해 저장하고, 비었거나 100자를 넘으면 400 `INVALID_REQUEST` 다. `source=display_name` 도 400 `INVALID_REQUEST` 로 거절한다. 같은 팀원에게 같은 글자가 이미 있으면 그 행을 201 로 돌려준다. 그 행이 자동 별칭(`display_name`·`discord_profile`)이고 요청 `source` 가 `manual`·`learned` 면 요청 값으로 올린다. 다른 팀원이 같은 글자를 가져도 오류가 아니다. 지울 별칭이 없으면 404 `MEMBER_ALIAS_NOT_FOUND` 다. 수정 API 는 없다(지우고 다시 추가). 근거: [members.py](../../../backend/app/api/members.py) `create_alias`·`delete_alias`, [member 스키마](../../../backend/app/schemas/member.py) `MemberAliasCreateRequest`.
- **`unresolved-aliases` 는 Discord 서버의 사용자 목록이 아니다.** 회의 전사에서 감지됐지만 매칭되지 않은 **이름 문자열**이다. `alias_resolution_log` 에서 집계한다.
  **빠지는 조건이 「등록되면」이 아니다** — ~~같은 이름의 별칭이 검증 여부와 상관없이 **정확히 1개**이고 그 1개가 `verified` 일 때만 해결된 것으로 본다 (`services/matching.py` `resolved_alias_texts`).
  미검증 별칭뿐이거나, 여러 팀원에 붙어 중의적이면(검증 1 + 미검증 1 도 후보가 둘이다) 목록에 **남는다** (§4.0-②-15).~~
  **2026-11-08 코드 대조(#523, BE #463):** 위 취소선은 과거 판정이다. 지금은 이름에서 님·조사를 뗀 후보(`name_candidates`, 긴 것부터)로 찾고, **처음 걸린 후보**의 별칭이 1개이고 확인된(`verified`) 것이면 해결로 본다. 한 글자 별칭은 PM 이 직접 등록한(`manual`·`learned`) 것만 해결로 본다. 탈퇴한 팀원의 별칭은 세지 않는다. 승인으로 배운 별칭은 확인된 별칭이라 이 목록에서 빠진다 (`services/matching.py` `resolved_texts`, §4.0-②-15).
- 따라서 **팀원 연결 화면의 데이터 출처가 D-026 의 전제와 다르다** → §4.5 에서 엔드포인트 하나를 요청한다.
- Discord 사용자 식별자는 `member.discord_user_id` 에 팀원당 하나씩 붙는다.

### 2.3 meetings — 봇 경로

| Method | Path | 비고 |
|---|---|---|
| POST | `/api/v1/meetings` | 201 |
| PATCH | `/api/v1/meetings/{meeting_id}/end` | 202 |
| GET | `/api/v1/meetings/{meeting_id}` | |

```jsonc
// POST 요청 {"workspace_id", "title"?, "source"?, "started_at"?}   source: discord | manual_upload | chat
//      응답 {"meeting_id", "workspace_id", "status", "started_at"}
// PATCH /end 응답 {"meeting_id", "status", "ended_at"}

// GET /{meeting_id}
{"meeting_id": "mt_09", "workspace_id": "ws_01", "title": "3주차 정기회의",
 "status": "done",
 "started_at": "2026-09-15T14:00:00Z", "ended_at": "2026-09-15T14:45:00Z",
 "extraction_id": "ex_01",
 "failed_stage": null,
 "progress": {"audio_merged": true, "transcribed": true, "extracted": true}}
```

- `status` 는 `created` → `recording` → `processing` → `done` \| `failed`.
- 웹 업로드 회의에는 상태가 하나 더 있다. `awaiting_speakers`(화자 지정 대기)다. 업로드 회의는 `processing` 에서 시작해, AI 가 화자 라벨을 보내면 `awaiting_speakers` 가 되고, PM 이 지정을 제출하면 `processing` 으로 돌아와 `done` \| `failed` 로 끝난다. 이 상태에서는 추출이 등록되지 않고, 같은 공간의 새 업로드를 막지도 않는다. 자세한 흐름과 PM 용 API 는 아래 §2.3.1 이다.
- `extraction_id` 는 `status: done` 일 때만 채워진다.
- ~~`progress` 가 응답에서 빠졌다.~~ **PR #59 가 §4.7-1 을 반영했다.** `progress`(audio_merged·transcribed·extracted)가 **필수 필드**로 온다. 진행률 UI 가 이 값을 쓴다.
- `progress` 세 값이 true 가 되는 시점 (#384). 키·타입은 그대로이고 시점만 바뀐다.

  | 값 | 현재 develop BE | BE PR #383 병합 뒤 |
  |---|---|---|
  | `audio_merged` | 회의에 발화(source)가 저장되면 true | AI 워커가 전사(`stt`)를 시작하면 true. 발화가 있어도 true |
  | `transcribed` | `audio_merged` 와 같은 값 | 전사가 끝나 발화 저장(`sources`)에 들어가면 true. 발화가 있어도 true |
  | `extracted` | 최신 추출에 항목이 1개 이상이면 true. 사실상 `done` 과 함께 | 추출이 끝나 인계(`handoff`)에 들어가면 true. 항목이 있는 최신 추출이 있어도 true |

  - 근거: 현재 판정은 [meetings.py](../../../backend/app/api/meetings.py)의 `_compute_progress`. 병합 뒤 판정은 BE·AI PR #383(#381)의 같은 함수와 `services/meeting_stage.py`의 `stage_rank`다. AI 는 `ai/capture/recorder.py` `process_session` 의 단계 시작(`begin`)에서 `PATCH /meetings/{id}/stage` 로 알린다. 이 경로는 서비스 토큰 전용이라 FE 는 부르지 않는다.
  - 상태: #383 은 2026-11-05 기준 열려 있다. 병합 뒤 열의 내용은 PR 코드와 #384 명세에서 확인한 것이며 실서버로 확인하지 않았다.
  - 단계를 알리지 않는 회의는 병합 뒤에도 현재 develop 열처럼 데이터로 판정한다. 옛 회의, 웹 업로드 회의(업로드 처리 소비자 #254·#255 가 보고를 붙이기 전까지), 채팅 회의(PR #378, 병합 전)가 그렇다. 이 회의들은 `audio_merged`·`transcribed` 가 함께 바뀌어 처리 화면의 둘째 단계가 진행 중으로 보이지 않는다.
  - 병합 뒤 달라지는 두 경우. 항목 0개로 `done` 된 회의와 인계 단계에서 `failed` 된 회의도 `extracted` 가 true 다(단계 값이 `done`·`failed` 뒤에도 남는다). FE 는 `done` 이면 `progress` 와 관계없이 세 단계를 끝난 것으로 보고, `failed` 이면 단계 목록을 그리지 않고 `failed_stage` 로 실패 안내를 고른다. 그래서 화면은 같다. [단계 테스트](../../src/entities/meeting/lib/processingSteps.test.ts)와 [처리 화면 테스트](../../src/app/meetingProcessingProgress.test.tsx)가 두 경우를 확인한다.
  - ~~처리 화면의 세 단계 이름은 바꾸지 않는다. 병합 뒤 단계 구간은 1단계 「음성 파일 준비하기」가 워커 대기·모델 준비, 2단계 「음성을 텍스트로 옮기기」가 전사, 3단계 「결정사항과 할 일 뽑아내기」가 발화 저장과 추출이다. 인계 중에는 `status: processing` 인 채 세 단계가 모두 끝난 것(`3 / 3 단계 완료`)으로 보인다.~~ #483 B안(2026-11-07 사용자 결정, AI·BE 변경 없음)으로 FE 표시만 바뀌었다. 응답 키·시점은 위 표 그대로다.
  - 현재 구현(#483): 녹음·업로드 회의는 1단계 「차례 기다리는 중」(`audio_merged` 로 끝), 2단계 「음성을 텍스트로 옮기기」(`transcribed` 로 끝), 3단계 「결정사항과 할 일 뽑아내기」다. 채팅 회의(`source: chat`)는 「대화 모으기」(`transcribed` 로 끝) → 「결정사항과 할 일 뽑아내기」 두 단계다. 채팅 수집([chat_poll.py](../../../ai/capture/chat_poll.py))은 단계를 알리지 않고 `/end` → `sources` → 판단 → `/extractions` 순서라, 발화가 저장되면 `_compute_progress` 가 앞 두 값을 함께 true 로 만든다. 마지막 단계는 `extracted` 와 관계없이 `status` 가 `done` 이 될 때까지 진행 중이다 — 인계 중은 녹음 `2 / 3`, 채팅 `1 / 2` 단계 완료로 보인다. 진행 토스트의 단계 수(`n/3`·`n/2`)도 같은 목록이다. 구현: [processingSteps.ts](../../src/entities/meeting/lib/processingSteps.ts).
  - `source` 는 상세 응답(`MeetingDetailResponse`)에 없다. FE 는 처리 화면이 이미 참석 인원 때문에 읽는 회의 목록 요약(`GET /workspaces/{id}/meetings` 의 `source`)에서 가져온다. 받아 둔 목록에 그 회의가 없으면(목록을 받은 뒤 생긴 회의, 오래된 목록) 회의마다 한 번 목록을 새로 받는다. 출처를 모르는 동안(목록 대기·재조회 중·조회 실패·새로 받아도 없음)은 처리 화면과 진행 토스트 모두 단계 수를 정하지 않고 정리 중이라고만 보인다. 녹음 단계로 짐작하지 않는다. 구현: [meetingSources.ts](../../src/entities/meeting/api/meetingSources.ts). 상세에 `source` 를 더해 달라는 BE 요청은 하지 않았다.
  - FE 는 현재 처리 단계 값(`processing_stage`)을 요청하지 않는다. 화면의 단계는 `progress` 값과 `status` 로 정해지고, 마지막 단계 안의 발화 저장·추출·인계는 나눠 보이지 않는다. 단계를 알리는 회의의 인계 구간은 `processing` + `extracted: true` 로 이미 알 수 있다.
- 이미 종료된 회의에 `/end` 를 호출하면 409 `MEETING_ALREADY_ENDED`.

### 2.3.1 업로드 회의 화자 지정 — PM 경로 (#266)

> **상태: BE 구현됨, FE 방향 합의(#256), FE 구현(2026-11-05, MSW 기준).** 아래는 `backend/app/api/meetings.py` 와 `backend/app/services/speaker_assignment.py` 의 구현 사실이다. #256 에서 FE 가 원본 + 구간 재생, 같은 멤버 다중 지정 허용, 외부 참석자 선택지(`null`)를 받아들였다(2026-11-03). 지정 후보를 업로드 때 고른 참석자로 제한할지는 FE 가 2026-11-05 에 「제한하지 않는다」로 정했고 BE 확인은 남았다(아래 「FE 구현」). AI 쪽 경로는 [backend-ai-contract.md](../../../backend/docs/contracts/backend-ai-contract.md) 에 있고 프론트는 호출하지 않는다. 실제 서버를 띄운 호출은 검증하지 않았고 테스트([test_speaker_assignment_api.py](../../../backend/tests/api/test_speaker_assignment_api.py))로 확인했다.

세 경로 모두 로그인 세션이 필요하고 그 회의 워크스페이스의 PM 만 쓴다. 미로그인은 401, PM 이 아니면(일반 팀원, 다른 공간의 PM) 403 `FORBIDDEN`. 회의가 없거나 웹 업로드 회의가 아니거나 `meeting_upload` 행이 없으면 404 `MEETING_NOT_FOUND`.

| Method | Path | 용도 |
|---|---|---|
| GET | `/api/v1/meetings/{meeting_id}/speakers` | 화자 라벨·후보 참석자·저장된 지정 조회 |
| PUT | `/api/v1/meetings/{meeting_id}/speakers` | 라벨별 팀원 지정 제출 |
| GET | `/api/v1/meetings/{meeting_id}/audio` | 원본 녹음 재생 |

```
// GET /meetings/{meeting_id}/speakers  → 200 (봉투 data)
{"meeting_id": "...", "status": "awaiting_speakers",
 "speakers": [{"label": "SPEAKER_01", "total_sec": 120.5, "samples": [{"start": 10.0, "end": 14.0}]}],
 "candidates": [{"member_id": "...", "display_name": "지민"}],
 "mapping": null,
 "audio": {"content_type": "audio/wav", "size_bytes": 1234}}   // 재생할 녹음이 없으면 null
```

- `speakers` 는 `total_sec` 내림차순, 같으면 `label` 오름차순이다. AI 가 아직 라벨을 보내지 않았으면 `[]` 다. `samples` 의 `start`·`end` 는 초 단위이고 원본 녹음 안의 위치다.
- `candidates` 는 업로드할 때 고른 참석자 중 이 워크스페이스에서 탈퇴하지 않은 멤버다. 업로드 뒤 탈퇴한 참석자는 빠진다. 제출이 탈퇴 멤버를 400 으로 막으므로 같은 기준으로 뺀 것이다.
- `audio` 는 녹음 파일이 있을 때만 주고, 처리가 `done`·`failed` 로 끝나 녹음 폴더가 지워졌으면 `null` 이다. `null` 이면 플레이어를 그리지 않는다. 이때 `/audio` 는 404 다.
- `mapping` 은 지정을 제출하기 전에는 `null`, 제출한 뒤에는 `{label: member_id | null}` 이다.

```
// PUT /meetings/{meeting_id}/speakers
{"mapping": {"SPEAKER_00": "<member_id>", "SPEAKER_01": null}}
  → 200 {"meeting_id": "...", "status": "processing"}
```

- `mapping` 의 키는 `speakers` 의 라벨과 정확히 같아야 한다. 일부 라벨만 보내면 안 된다. 지정하지 않을 라벨은 값을 `null` 로 보낸다. 같은 멤버를 두 라벨에 지정하는 것은 허용한다.
- 값이 `null` 이면 외부 참석자(멤버 아님)로 지정한 것이다. `null` 이 아니면 그 회의 워크스페이스의 탈퇴하지 않은 멤버여야 한다. 지금은 `candidates` 밖의 멤버도 받는다(참석자로 제한할지 미정).
- 400 `INVALID_REQUEST`, `details` 에 이유: `unknown_labels`(모르는 라벨), `missing_labels`(빠진 라벨), `member_ids`(틀린 멤버 ID). 이때 아무것도 바뀌지 않는다.
- 409 `MEETING_NOT_AWAITING_SPEAKERS`, `details.status` — 회의가 대기 상태가 아니다(이미 처리 중·종료, 또는 이미 저장된 것과 다른 지정을 다시 냄).
- 이미 저장된 지정과 같은 `mapping` 을 다시 보내면 409 가 아니라 200 이고 `status` 는 회의의 현재 상태다. 요청이 겹치거나 응답이 유실돼 다시 보내도 안전하다.

```
// GET /meetings/{meeting_id}/audio  → 200 (또는 Range 요청에 206)
본문: 녹음 원본 바이트. 봉투로 감싸지 않는다. 오류만 봉투다.
Content-Type: 서버가 저장한 확장자로 정한 audio/* 값(wav→audio/wav, mp3→audio/mpeg, m4a→audio/mp4, ogg→audio/ogg, webm→audio/webm). 목록 밖은 application/octet-stream. 업로드 때 클라이언트가 보낸 값은 쓰지 않는다
X-Content-Type-Options: nosniff, Cache-Control: private, no-store
Content-Disposition: 없음(내려받기 아님). Accept-Ranges: bytes
```

- `<audio>` 로 재생하고 `samples` 구간으로 이동해 들려준다. 서버는 구간을 자르지 않는다. 요청한 `Range` 에는 206 과 `Content-Range` 로 답한다.
- 상태는 보지 않는다. 녹음 폴더가 있는 동안은 받을 수 있다. 처리가 `done`·`failed` 로 끝나 폴더가 지워지면 404 `MEETING_NOT_FOUND` 다.
- 쿠키 세션으로 인증하므로 같은 출처에서 `<audio src>` 로 바로 쓸 수 있다. 헤더를 붙여야 하는 방식은 쓸 수 없다.

프론트가 맞춰야 할 것(2026-11-05 반영, 아래 「FE 구현」):

- `awaiting_speakers` 를 회의 상태로 표시한다. 알 수 없는 상태를 `created` 처럼 읽으면 안 된다.
- 처리 추적이 이 상태에서 멈추면 안 된다. 2026-11-05 전의 [trackerOutcome.ts](../../src/features/meeting-processing/model/trackerOutcome.ts) 는 `processing`·`done`·`failed` 외의 상태를 `lost` 로 보고 polling 을 멈췄다. `awaiting_speakers` 는 PM 의 지정을 기다리는 정상 진행이므로 계속 지켜보거나 지정 화면으로 안내해야 한다.
- 이 경로를 쓰는 화면은 PM 에게만 보인다.
- 새 오류 코드 중 PM 경로에서 오는 것은 `MEETING_NOT_AWAITING_SPEAKERS` 하나다. `UPLOAD_NOT_CLAIMED`·`SPEAKERS_ALREADY_REPORTED`·`SPEAKERS_NOT_ASSIGNED` 는 AI 경로 코드다. 위 「오류 코드」 목록의 개수(31개)에는 이 새 코드들이 들어 있지 않다.

#### FE 구현 (#256·#342, 2026-11-05)

> **상태: FE 구현, MSW 기준 검증.** 실제 서버를 띄운 호출과 실제 m4a 재생 시각은 확인하지 않았다. 아래 「후보 범위」는 사용자가 2026-11-05에 정한 FE 방향이며, BE가 #256에서 물은 「후보를 참석자로 제한할지」에 대한 답을 이슈에 남기는 일과 BE 확인은 남아 있다(합의 여부 확인 필요).

- 상태: `MeetingStatus` 에 `awaiting_speakers` 를 더했다. 상세·목록·업로드 응답 모두 이 값을 정상 상태로 읽는다. 그 밖의 알 수 없는 상태 처리는 바꾸지 않았다(#348 범위). 구현: [types.ts](../../src/entities/meeting/model/types.ts), [mapper.ts](../../src/entities/meeting/model/mapper.ts).
- 처리 추적: `awaiting_speakers` 는 `lost` 가 아니라 지켜보는 상태다. polling 간격은 `processing` 3초, `awaiting_speakers` 30초다. 처음 대기가 보이면 회의마다 세션당 한 번 PM 에게만 안내한다. 그 회의의 처리 화면을 보고 있으면 지정 화면으로 옮기고, 다른 화면이면 `화자 지정이 필요해요` 토스트의 `화자 지정하기` 로 옮긴다. 지정 뒤 `processing` → `done`·`failed` 는 기존 완료·실패 처리가 잇는다. 새로고침 뒤의 발견은 지금처럼 `processing` 회의만 등록한다. 구현: [trackerOutcome.ts](../../src/features/meeting-processing/model/trackerOutcome.ts), [useProcessingTracker.ts](../../src/features/meeting-processing/model/useProcessingTracker.ts).
- 지정 화면 주소: `/workspaces/{workspace_id}/meetings/{meeting_id}/speakers`. 새로고침·직접 진입에 열린다. 라우터 PM 가드를 걸지 않고, 팀원에게는 「PM이 화자를 지정하고 있어요」를 보이며 화자 API 를 부르지 않는다. 진입점은 처리 화면, 토스트, 회의록 목록의 `화자 지정 필요` 행, 회의록 상세다. 대기 회의의 상세는 회의록·추출을 조회하지 않고 PM 에게 `화자 지정하기` 링크를, 팀원에게 PM 이 지정 중이라는 안내를 보인다. 구현: [MeetingMinutes.tsx](../../src/widgets/meeting-minutes/ui/MeetingMinutes.tsx), [MinutesDetail.tsx](../../src/widgets/meeting-minutes/ui/MinutesDetail.tsx). 구현: [MeetingSpeakersPage.tsx](../../src/pages/meeting-speakers/ui/MeetingSpeakersPage.tsx).
- 라벨 표시: `speakers` 응답 순서대로 `화자 1`, `화자 2` 로 보이고 총 발화 시간을 함께 보인다. 라벨 문자열을 해석하지 않는다.
- 후보 범위: `candidates`(업로드 때 고른 참석자)를 위에 보이고, 펼치는 「다른 팀원」 묶음에 워크스페이스 팀원 목록 중 `candidates` 밖의 팀원을 보인다. 「외부 참석자」를 고르면 `null` 을 보낸다. 같은 팀원을 여러 라벨에 고를 수 있고 다른 라벨의 선택을 알려만 준다. 지금 BE 제출 검증(워크스페이스의 탈퇴하지 않은 멤버면 받음)과 맞는다. BE 가 제출을 참석자로 제한하면 「다른 팀원」 선택은 400 `member_ids` 가 된다.
- 제출 규칙: 모든 라벨을 직접 골라야 제출할 수 있다. 「외부 참석자」도 직접 고른다. 남은 라벨이 있으면 제출 버튼 옆에 `아직 고르지 않은 화자 n명` 을 보인다. 따라서 FE 는 「지정하지 않은 라벨을 `null` 로 보내는」 경우를 만들지 않는다. 구현: [assignmentDraft.ts](../../src/features/speaker-assignment/model/assignmentDraft.ts).
- 샘플 재생: 화면에 `<audio preload="metadata" src=/api/v1/meetings/{id}/audio>` 하나를 두고 샘플마다 재생 버튼을 둔다. 누르면 그 `start` 로 옮겨 재생하고 `end` 에서 멈춘다. `timeupdate` 간격으로는 0.5초 구간을 넘기므로 화면 갱신마다와 남은 시간 타이머로 끝을 확인한다. 샘플이 1개, 2초 미만, 0개여도 그린다. `audio` 가 `null` 이거나 녹음을 불러오지 못하면 플레이어를 쓰지 않고 안내한다. 구현: [samplePlayback.ts](../../src/features/speaker-assignment/model/samplePlayback.ts), [useSamplePlayer.ts](../../src/features/speaker-assignment/model/useSamplePlayer.ts).
- 제출 오류: 400 `INVALID_REQUEST` 의 `unknown_labels`·`missing_labels` 는 화자 목록을 다시 받고 다시 고르게 한다. `member_ids` 는 그 선택만 지우고 다시 받는다. 409 `MEETING_NOT_AWAITING_SPEAKERS` 는 `details.status` 가 `failed` 일 때만 만료로 보고 상세를 다시 받아 그 `failed_stage` 의 안내와 PM 재업로드 링크를 보이며 다시 낼 수 없다. 그 밖의 `details.status` 는 이미 지정됐다고 안내하고 처리 화면이나 회의록으로 잇는다. 403·404·네트워크 오류는 각각 문구로 안내한다. 제출 성공 뒤에는 처리 화면으로 옮겨 기존 추적이 끝까지 따라간다. 구현: [submitRejection.ts](../../src/features/speaker-assignment/model/submitRejection.ts), [useSpeakerSubmit.ts](../../src/features/speaker-assignment/model/useSpeakerSubmit.ts).
- MSW: GET·PUT `/meetings/{id}/speakers`, GET `/meetings/{id}/audio`(코드로 만든 무음 WAV)와 `meeting-speakers*` 시나리오 다섯 개. 계약의 403·404·400 `details`·409 `details.status`·같은 지정 재제출 200을 흉내 낸다. 목록: [MSW 안내](../msw-guide.md).

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

- `confidence` 는 **언급된 값들의 최솟값**이다. `assignee_raw` · `due_raw` 가 `null` 이면 **그 값은 계산에서 빠진다**
  (`services/matching.py` 의 `item_confidence`). 담당자·마감이 아예 언급되지 않은 항목을 `0.0` 으로 보고 무조건 `hold` 로 떨어뜨리지 않기 위해서다.
  따라서 **「담당자 미언급 = 신뢰도 0 = hold」 가 아니다.** 나머지 값만 높으면 `auto` 로 갈 수 있다. 픽스처를 만들 때 이것을 전제로 한다.
- `gate` 는 `auto`(≥0.8) / `review`(≥0.5) / `hold`. 임계값은 `services/matching.py`.
  **`≥0.8` 이 `auto` 의 충분조건이 아니다.** `needs_check` 면 점수와 무관하게 `review` 로 내려간다 (PR #55) → §3.1.
- **생성 시점에는** `task_id` 와 `approval_id` 가 배타적으로 채워진다. `gate=auto` 면 `task_id`, `review`·`hold` 면 `approval_id`.
- **승인 뒤에는 배타적이지 않다.** `PATCH /approvals/{id}` 로 승인하면 백엔드가 `extraction_item.task_id` 를 채우면서
  **`approval_id` 를 비우지 않는다.** 같은 항목이 두 ID 를 동시에 갖는다 → §3.1, §4.0-②-12.
  화면은 `task_id` 를 우선으로 읽어 `task_id` 가 있으면 `반영됨` 으로 다룬다 (§6). 아래 #419 대조로 바뀌었다.
- `assignee.member_id` 가 `null` 이면 `raw` 로 대체 표시한다.
- **2026-11-06 코드 대조(#419):** 수정 항목(`action: update`)은 생성 시점부터 `task_id` 가 수정 대상 태스크이고, 바꿀 값이 있으면 `TASK_UPDATE` 승인의 `approval_id` 도 함께 있다. 승인 전에도 `task_id` 가 있으므로 `task_id` 만으로는 반영 여부를 알 수 없다. 서버 스키마 설명은 "반영 여부는 `approval_status` 로 본다" 이다([BE 스키마](../../../backend/app/schemas/meeting.py)의 `ExtractionItemResponse.task_id`).
  화면은 `task_id` 가 있고, `approval_id` 가 없거나 `approval_status` 가 `approved` 일 때만 `반영됨` 으로 다룬다. `approval_id` 가 있는데 `approval_status` 가 `null`(모르는 값)이면 반영으로 보지 않는다. 구현: [extractionView.ts](../../src/entities/extraction/lib/extractionView.ts). MSW 기준 검증, 실서버 미검증.
- **2026-11-05 코드 대조(#256 A1):** `evidence` 에 `speaker_member_id: string | null` 이 더 온다([BE 스키마](../../../backend/app/schemas/meeting.py)의 `EvidenceInfo`). 업로드 회의는 Discord uid(`speaker`)가 `null` 이고 이 값만 온다. FE 는 근거 화자 이름을 이 팀원 ID 로 먼저 찾고, 없거나 팀원 목록에 없으면 `speaker` uid 로 찾는다. 둘 다 못 찾으면 `알 수 없음` 이다. 구현: [speakerName.ts](../../src/entities/member/lib/speakerName.ts). MSW 기준 검증, 실서버 미검증.
- **2026-11-08 코드 대조(#512·#533):** 다른 회의의 항목이 대기 중인 생성 카드에 합쳐지면 그 항목의 `approval_id` 는 합친 카드다. 한 승인에 여러 회의의 항목이 이어질 수 있다. 회의록은 항목 자신의 제목·마감·gate·근거를 그대로 쓰고 같은 `approval_id` 로 승인 상세에 잇는다. 이 응답에는 `payload_version` 이 없다 → §2.5 「합쳐진 카드와 본 뒤 바뀐 카드」.
- **2026-10-17 코드 대조:** 항목에 `reverted_at`·`approval_status` 가 더 온다. auto 항목을 되돌리면 `gate` 는 `auto` 그대로, `task_id` 는 `null`, `approval_id` 는 새 생성 승인이다 — 생성 시점 배타성의 예외다. 되돌리기는 `POST /extractions/{extraction_id}/items/{item_id}/revert` 다 (위 「M7 대시보드·항목 되돌리기 경계」).

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

> 2026-10-11 코드 대조: 위 `resolved_by`는 과거 기록이다. 현재 서버는 처리자를 세션으로 정하고 `confirm_task_version`·409 `APPROVAL_CONFLICT`를 지원한다. 상단 「M6 태스크·승인 처리 경계」를 따른다.

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

- `task_create` → `task_title`(없으면 `title`), `meeting_id`, `assignee_member_id`, `due_date`. #303 부터 `status` 는 읽지 않고 항상 `todo` 이며 `progress` 는 없다. `task_overrides` 가 있으면 그 값이 먼저다. 생성 이력 출처는 payload `change_source`, 없으면 `meeting_id` 유무로 `meeting`·`manual`. `validate_task_fields` 를 거치므로 **잘못된 값이면 승인이 400 으로 실패한다.**
  반영 뒤 `extraction_item.task_id` 도 채워진다 (§3.1).
  `extraction_item_id` 는 Task 를 만들기 **전에** 검증한다. 항목의 워크스페이스가 승인과 다르면 400 `WORKSPACE_MISMATCH`, 항목의 `approval_id` 가 이 승인이 아니면 400 `INVALID_REQUEST` 이고 아무것도 바뀌지 않는다.
  항목이 없으면 연결 없이 Task 만 만든다. 이 검사가 제목 검증보다 먼저다.
- `task_update` → `title`, `assignee_member_id`, `status`, `blocker`, `due_date` 중 존재하는 것만. 이력 출처는 payload `change_source`(없으면 `meeting`)
  - 현재 BE 구현: 회의에서 만드는 `task_update` payload 에는 반영 키 말고도 표시용 `task_title`·`base_title`·`doc_text`·`category`(`schedule`·`assignee`·`status`·`scope`·`decision`·`none`)·`evidence_quote`·`evidence_speaker`·`evidence_speaker_member_id`·`evidence_at_ms`·`meeting_id` 가 온다. `category` 가 `scope`(범위 결정)면 바뀌는 필드가 없어도 승인 요청을 만든다([extractions.py](../../../backend/app/api/extractions.py)). 승인해도 반영 키가 없으면 태스크·이력에 아무것도 남지 않는다.
  - 합의됨, BE 미구현(#205): `category` 가 `scope` 인 승인을 승인하면 필드 반영과 별개로 `changed_field: "scope"` 이력 한 줄을 남긴다. 바뀌는 필드가 함께 있으면 필드 이력과 범위 이력을 둘 다 남긴다. 범위 이력만 남는 승인은 Task `version` 과 Notion 동기화를 건드리지 않는다. 반려하면 이력을 남기지 않는다. FE 가 먼저 배포된 뒤 BE 를 배포한다.
  - FE 구현(#205): 승인 매퍼가 `doc_text`·`category`·근거 발화·`meeting_id` 를 읽는다. 모르는 `category` 는 `null` 이다. 승인 상세는 `scope` 면 「범위 변경」 절에 `doc_text` 와 근거를 보이고, 바뀌는 필드가 있을 때만 변경 표를 보인다. 대시보드 확인 필요 목록과 보드 승인 카드는 `범위 변경을 확인해야 해요` 로 보인다. MSW 는 합의대로 승인 때 범위 이력을 남긴다(시나리오 `approval-scope`).
- `reminder_dm` → 태스크에 반영하지 않는다. 발송은 Discord 봇의 책임이다

**프론트엔드가 지킬 규칙**

- **보완 사유는 서버가 주지 않는다.** `assignee_member_id` 가 `null` 이면 `담당자 없음`, `due_date` 가 `null` 이면 `마감 없음` 으로 프론트엔드가 파생한다.
- `assignee_raw` 와 `due_raw` 는 회의에서 나온 원문이다. 확정 값이 아니므로 보조 표시한다.
- `evidence_quote` · `evidence_speaker` · `evidence_at_ms` 로 근거를 보여준다. 생성·수정 승인 payload 에는 `evidence_speaker_member_id` 도 온다(BE [extractions.py](../../../backend/app/api/extractions.py)). 화자 이름은 이 값을 먼저 쓰고 `evidence_speaker` uid 로 돌아간다(2026-11-05, #256 A1, 위 §2.4).
- `type` 마다 화면이 다르므로 **`type` 으로 분기한 뒤 payload 를 읽는다.** 공통 필드를 가정하지 않는다.
- 목록 정렬이 `created_at` 내림차순 고정이다. **대기 오래된 순(D-050)은 클라이언트에서 뒤집는다.**

#### 승인 때 별칭 학습 (2026-11-08 코드 대조, #523)

BE #464 가 병합·배포한 인터페이스다(메인 이슈 #459). 「현재 서버 구현」은 [approval 스키마](../../../backend/app/schemas/approval.py)의 `ApprovalResponse`·`ApprovalResolveRequest`, [meeting 스키마](../../../backend/app/schemas/meeting.py)의 `ExtractionItemResponse`, [alias_learning.py](../../../backend/app/services/alias_learning.py)의 정적 확인이다. 실 API 호출은 하지 않았다(미검증).

**합의 상태.** 필드 이름·위치(`alias_candidate`·`alias_text`·`save_alias`)는 #523 FE 답(2026-11-08)에서 그대로 받기로 했다. BE 수정은 없다. #512(카드 합치기)가 배포되면 한 카드에 추출 항목이 여럿 붙을 수 있다. 그때 두 필드가 어느 항목 기준인지는 BE 가 #512 로 다시 알리기로 했다(합의 대기). 2026-11-08 BE 스키마 설명은 담당자를 정한 항목(`assignee_item_id`, 없으면 `extraction_item_id`)에만 후보가 나온다고 적는다 → 아래 「합쳐진 카드와 본 뒤 바뀐 카드」.

| 항목 | 서버 코드에서 확인한 사실 |
|---|---|
| 응답 필드 | `GET /extractions/{id}` 의 각 항목, `GET /approvals`, `GET /approvals/{id}`, `POST /approvals`, `PATCH /approvals/{id}` 응답에 `alias_candidate: boolean`(기본 false)과 `alias_text: string \| null` 이 온다 |
| `alias_candidate=true` 조건 | 모두 만족할 때다. 새 항목(create), 추출 때 담당자를 못 찾음(못 찾음·애매함), 이름 지목(`thirdname`), 승인이 pending, 같은 공간의 탈퇴하지 않은 팀원 누구도 그 글자(님·조사를 뗀 찾기 후보 포함)를 별칭으로 갖지 않음, 1인칭이 아님. 아니면 false 이고 `alias_text` 는 `null` 이다 |
| 값이 바뀌는 때 | 추출 때 정해진다. PM 이 카드에서 담당자를 바꿔도 그대로다. 담당자가 이미 찾아졌던 항목은 false 다. 승인·반려 뒤 응답은 항상 false 다. 누가 그 글자를 별칭으로 가지게 되면 다음 조회부터 false 다 |
| `alias_text` | 저장될 글자다. 원문에서 끝 조사·님을 뗀 것이다(`trim_alias_text`) |
| `PATCH` 본문 `save_alias` | 불리언, 기본 false. 승인(`approved`)하는 `task_create` 에만 쓰인다. `alias_text` 를 **최종 담당자**(`task_overrides.assignee_member_id` 로 고른 값 포함)의 별칭으로 저장한다(`source=learned`, `verified=true`, `confidence=0.9`, `alias_type=nickname`) |
| `save_alias` 를 무시하는 경우 | 반려와 함께 올 때, `task_update`(답장 담당자 변경 포함), 담당자 미정으로 승인할 때, `alias_candidate` 가 false 일 때, 같은 글자를 이미 누가 가질 때. 모두 오류 없이 넘어가고 승인은 성공한다 |

**현재 프론트 구현 (#523).** MSW 기준으로 검증했고 실서버는 미검증이다.

| 항목 | 구현 | 코드 근거 |
|---|---|---|
| DTO | 승인·추출 항목 DTO 에 `alias_candidate`·`alias_text`(필수), 승인 요청 DTO 에 `save_alias?` | [승인 DTO](../../src/shared/types/api/approval.ts), [추출 DTO](../../src/shared/types/api/extraction.ts) |
| 모델 | 생성 승인의 `aliasCandidate: string \| null`. `alias_candidate` 가 true 이고 `alias_text` 가 빈 글자가 아닐 때만 그 글자다. 추출 항목 모델에는 옮기지 않았다(쓰는 화면이 없다) | [승인 mapper](../../src/entities/approval/model/mapper.ts) |
| 보낼지 판정 | `aliasToLearn(승인, 최종 값)` 이 담당자가 있으면 `aliasCandidate` 를, 미정이면 null 을 준다. 승인 계획은 체크가 켜져 있고 이 값이 있을 때만 `save_alias: true` 를 싣는다. 아니면 키를 보내지 않는다. 반려·`task_update` 는 보내지 않는다 | [resolution.ts](../../src/entities/approval/model/resolution.ts) |
| 화면 | 승인 상세와 태스크 목록의 생성 승인 카드에서 담당자 고르기 바로 아래 체크박스 「'{alias_text}'을(를) {담당자 이름}의 별칭에도 등록」. 기본 켜짐. 같은 판정에 담당자 이름을 아는지를 더해 보인다. 담당자 고르기 선택지는 팀원 이름과 미정뿐이다 | [AliasSaveField](../../src/features/approval-resolve/ui/AliasSaveField.tsx) |
| 캐시 | 승인 처리 뒤 별칭 목록(`['workspace', id, 'member-aliases']`)도 다시 받는다 | [useApprovalResolve](../../src/features/approval-resolve/model/useApprovalResolve.ts) |
| MSW | 후보를 저장하지 않고 응답마다 BE 규칙으로 구한다. 모의 추출 항목에 담당자 표현 유형(`assignee_type`, 응답에는 싣지 않음)과 원문을 두고, 대기 중인 생성 승인이며 담당자를 못 찾은 이름 지목(`thirdname`)이면 끝 조사·님을 뗀 글자가 후보다. 1인칭이거나 공간의 누가 그 글자를 별칭으로 가지면 아니다. 막던 별칭을 지우면 다시 후보가 된다. `save_alias: true` 로 담당자를 골라 승인하면 `learned` 별칭을 최종 담당자에게 더한다. 불리언이 아니면 400 `INVALID_REQUEST`. 찾기 후보(님·조사를 뗀 여러 꼴)로 막는 것과 탈퇴한 팀원은 흉내 내지 않고 같은 글자만 본다 | [aliasLearning](../../src/shared/mock/aliasLearning.ts), [승인 handler](../../src/shared/mock/handlers/approval.ts) |

#### 합쳐진 카드와 본 뒤 바뀐 카드 (2026-11-08 코드 대조, #512·#533·#547)

근거는 [#512](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/512) 의 BE 답(2026-11-08)과 FE 확정 댓글(2026-11-08)이다. 「서버 코드에서 확인한 사실」은 develop `fad77196` 의 [approval 스키마](../../../backend/app/schemas/approval.py), [approvals.py](../../../backend/app/api/approvals.py) `resolve_approval`·`_payload_version`, [pending_merge.py](../../../backend/app/services/pending_merge.py) 의 정적 확인이다. 실 API 호출은 하지 않았다(미검증). BE 답에 따르면 실제 합치기는 AI 가 켠 뒤부터 일어난다.

**합의된 규약.**

- 1번(본 뒤 바뀐 카드): PM 이 본 카드의 `payload_version` 을 `PATCH` 에 싣고, 서버가 처리할 때 비교해 다르면 409 `APPROVAL_CHANGED` 로 막는다. FE 는 상세를 다시 받아 바뀐 칸을 보이고, PM 이 고친 값을 보존한 채 다시 처리하게 한다 (BE 답·FE 확정).
- 2번: 목록 카드에 합쳐진 회의·항목 수를 간단히 보이고, 상세에서 `merged_items` 의 근거를 펼쳐 본다. 카드를 만든 회의의 대표 근거와 뒤에 합쳐진 근거를 나누고, 담당자 근거는 `assignee_item_id` 로 표시한다. 반려하면 합쳐진 항목이 모두 반려된다는 안내를 둔다 (FE 확정).
- 3번: 합쳐져도 목록의 자리를 유지한다. 위치 이동 대신 병합 표시로 알린다 (FE 확정).
- 4번: 회의록 항목은 그 항목 자신의 제목·마감·gate·근거, 승인 상세는 합친 뒤의 값이다. 같은 `approval_id` 로 잇는다 (FE 확정).
- `save_alias` 는 이 검사로 PM 이 본 글자만 저장되므로 `alias_text` 를 따로 보내지 않는다(#535 는 #547 로 닫힘).
- 보내지 않으면 지금과 같다. FE 반영이 배포되면 필수로 바꿀지는 BE 가 따로 본다(합의 대기).

| 항목 | 서버 코드에서 확인한 사실 |
|---|---|
| 응답 `payload_version` | `GET /approvals`, `GET /approvals/{id}`, `POST /approvals`, `PATCH /approvals/{id}` 응답의 각 승인 최상위. `task_create` 만 저장된 payload 문자열의 sha256 앞 16자 hex, 그 밖은 `null`. 화면은 같은지만 비교하고 형식에 기대지 않는다 |
| 요청 `payload_version` | `PATCH` 본문의 선택 필드, 1~64자. 빈 문자열은 400 이고 값이 없으면 키를 뺀다. `task_create` 에서만 비교한다 |
| 409 `APPROVAL_CHANGED` | 처리 시점 값과 다르면 승인·반려 모두 되돌린다. `details = {approval_id, payload_version(지금 값)}`, 메시지 「보신 뒤 승인 요청 내용이 바뀌었습니다. 새 내용을 확인한 뒤 다시 처리해 주세요.」 카드는 대기로 남고 태스크·별칭은 생기지 않는다. 어느 칸이 바뀌었는지는 주지 않는다 |
| 검사 순서 | 없는 승인 404 → PM 403 → 이미 처리됨 409 `APPROVAL_ALREADY_RESOLVED` → `task_overrides` 검증 400 → 조건부 UPDATE 뒤 최신 payload 로 비교해 409 `APPROVAL_CHANGED` → 반영(`task_update` 충돌은 409 `APPROVAL_CONFLICT`) |
| 추출 조회 | `GET /extractions/{id}` 에는 `payload_version` 이 없다. 회의록에서 처리하려면 승인 상세에서 받는다 |
| 합친 payload | 대기 중인 `task_create` 카드에 다른 회의의 항목을 합치면 제목·대표 근거(`evidence_*`)·`meeting_id`·`extraction_item_id`·`category` 는 그대로다. 마감은 새 값이 있을 때만, 상태는 값이 있을 때만 덮는다. 담당자는 그 항목이 담당자를 말한 항목(`category=assignee`)일 때만 바꾸고 `assignee_item_id` 를 그 항목으로 둔다. `doc_text` 는 ` / ` 로 잇는다. `merged_items[]` 에 `extraction_item_id`·`meeting_id`·`evidence_quote`·`evidence_speaker`·`evidence_speaker_member_id`·`evidence_at_ms`·`doc_text`·`merged_at` 을 합친 차례대로 더한다 |
| 합친 항목의 연결 | 합쳐진 추출 항목의 `approval_id` 는 그 카드다([extractions.py](../../../backend/app/api/extractions.py)). 승인하면 같은 태스크로 이어지고 반려하면 함께 반려된다 |
| 별칭 후보 | 합친 카드의 `alias_candidate` 는 담당자를 정한 항목(`assignee_item_id`, 없으면 `extraction_item_id`)에서만 구한다 |

**현재 프론트 구현 (#512).** MSW 기준으로 검증했고 실서버는 미검증이다.

| 항목 | 구현 | 코드 근거 |
|---|---|---|
| DTO | 승인 DTO 에 `payload_version?: string \| null`(#547 이전 서버는 없다), 요청 DTO 에 `payload_version?`, 409 details DTO | [승인 DTO](../../src/shared/types/api/approval.ts) |
| 모델 | 생성 승인에 `payloadVersion`, `mergedItems[]`(회의·근거·`docText`·`mergedAt`), `assigneeItemId`(`assignee_item_id`, 없으면 `extraction_item_id`). 모양이 틀린 `merged_items` 항목은 버린다. 실패 종류에 `changed` 를 더해 `APPROVAL_CONFLICT` 와 나눈다 | [승인 mapper](../../src/entities/approval/model/mapper.ts), [merged.ts](../../src/entities/approval/model/merged.ts) |
| 보낼 값 | 승인 계획이 처리할 카드의 `payloadVersion` 을 승인·반려 본문에 싣는다. 값이 없거나 `task_update` 면 보내지 않는다. 상세는 폼이 맞춰진 카드(`seen`)를, 목록 카드는 그 카드를 그린 목록 응답을 보낸다. 별칭 후보는 payload 밖에서 구하므로 지문이 같아도 바뀐다. 상세의 `save_alias` 판단은 최신 응답의 후보를 쓴다 | [resolution.ts](../../src/entities/approval/model/resolution.ts) |
| 409 뒤 | 승인 목록·상세를 다시 받는다. 상세 폼은 같은 승인의 `payloadVersion` 이 달라진 응답을 받으면 고치지 않은 칸만 새 값으로 바꾸고 PM 이 고친 칸은 둔다(`reset(…, {keepDirtyValues, keepDirty})`). 409 없이 다시 받은 응답이 새 카드여도 같다. 「바뀐 내용」 안내에 처음 본 값·새 제안·승인할 값과 새로 합쳐진 항목 수를 보이고, 승인 버튼은 「새 내용을 확인했어요, 승인」이다. 목록 카드는 문구만 보이고 새 목록으로 다시 그린다 | [useTaskCreateOverrides](../../src/features/approval-resolve/model/useTaskCreateOverrides.ts), [ApprovalReview](../../src/widgets/approval-review/ui/ApprovalReview.tsx) |
| 근거 표시 | 상세는 합쳐진 카드면 「대표 근거 · 카드를 만든 회의」와 「합쳐진 근거 N건 보기」(펼치기)를 나누고, 담당자를 정한 근거에 「담당자 근거」를 붙인다. 처리 버튼 위에 「반려하면 합쳐진 항목 N개가 모두 반려돼요.」 목록 카드는 「회의 M곳 · 항목 N개 합침」. 합친 카드의 `assignee_raw`·`due_raw` 는 담당자·마감을 정한 다른 회의의 원문일 수 있어, 대표 근거(인용) 아래가 아니라 그 밖에 「합친 제안의 원문 담당자 … · 원문 마감 …」으로 보인다. 카드를 만든 항목의 원래 원문은 합친 payload 에 남지 않는다 | [ApprovalReview](../../src/widgets/approval-review/ui/ApprovalReview.tsx), [ApprovalCard](../../src/widgets/task-board/ui/ApprovalCard.tsx) |
| 자리·회의록 | 목록은 `created_at` 으로 정렬해 합쳐도 자리가 그대로다. 회의록 항목은 추출 항목 값을 쓰고 `approval_id` 로 상세에 잇는다(바꾸지 않았다) | [sortByWaiting](../../src/entities/approval/lib/sortByWaiting.ts), [extractedTasks](../../src/widgets/meeting-minutes/lib/extractedTasks.ts) |
| MSW | 응답마다 payload 지문(16자 hex, 같은 성질만 흉내)을 구한다. `PATCH` 는 `payload_version` 이 문자열 1~64자가 아니면 400, 다르면 409 `APPROVAL_CHANGED` 다. 합치기는 BE `merge_into_pending` 과 같다(분류가 `assignee` 일 때만 담당자 변경, 못 찾은 원문만 있는 hold 카드 보존, 찾아 둔 담당자를 지우면 hold·`assignee_item_id` 갱신, 마감·상태·`doc_text` 규칙). 분류·상태·문서 글은 추출 응답에 없어 모의 항목에 따로 둔다. 이미 처리됨 409 를 보완 값 400 보다 먼저 본다(BE 순서). 승인하면 카드에 이어진 항목 모두의 `task_id` 를 채운다(BE 와 같다). 시나리오 `approval-merged`(ap_03 에 mt_07 의 it_21 이 합쳐짐), `approval-merged-after-view`(같은 합치기가 첫 처리 요청 직전에 일어나 409) | [approvalMerge](../../src/shared/mock/approvalMerge.ts), [승인 handler](../../src/shared/mock/handlers/approval.ts) |

### 2.6 tasks · task history

| Method | Path | 비고 |
|---|---|---|
| POST | `/api/v1/tasks` | 201 |
| GET | `/api/v1/tasks?workspace_id=&status=&assignee_member_id=&due_before=&due_after=` | |
| GET · PATCH | `/api/v1/tasks/{task_id}` | |
| GET | `/api/v1/tasks/{task_id}/history` | |
| POST | `/api/v1/tasks/{task_id}/history/{history_id}/rollback?changed_by=` | **되돌리기** |
| POST | `/api/v1/tasks/{task_id}/auto-block/undo` | PM 전용. 무응답 자동 막힘 풀기 → §5.7 |

```jsonc
// TaskResponse — 평평하다. 중첩 객체가 없다
{"task_id": "tk_01", "workspace_id": "ws_01", "meeting_id": "mt_09",
 "title": "로그인 API 연동",
 "assignee_member_id": "mb_01",
 "status": "todo",                      // todo | in_progress | blocked | done
 "blocker": null,
 "start_date": "2026-09-15",            // §4.7-6 반영됨. nullable
 "due_date": "2026-09-20",
 "notion_page_id": null,
 "auto_blocked": false,                 // 지금 auto-block/undo 가 성공하면 true. 7개 응답 경로 모두 (#365, PR #373) → §5.7
 "created_at": "...", "updated_at": "..."}
// 2026-10-11 코드 대조: 현재 TaskResponse 에는 "version"(정수)과
// "notion_sync_status"(pending|synced|failed|null)도 있다 → 상단 「M6 태스크·승인 처리 경계」

// POST 요청 {workspace_id, title, meeting_id?, assignee_member_id?, start_date?, due_date?,
//            status?, blocker?, created_by?}   (#303 부터 progress 는 보내도 무시)
// PATCH 요청 {title?, assignee_member_id?, status?, blocker?,
//            start_date?, due_date?, changed_by?}

// TaskHistoryResponse — created_at 내림차순
{"history_id": "hs_01", "task_id": "tk_01",
 "changed_field": "due_date",           // assignee|start_date|due_date|status|title|blocker (#303 전 이력에는 progress 가 남아 있고 되돌리기는 400). scope 는 합의됨·BE 미구현(#205), 아래 참고
 "old_value": "2026-09-13", "new_value": "2026-09-20",
 "change_source": "meeting",            // meeting|chat|checkin|notion|reminder_reply|manual|scheduler
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
- **`changed_field: "scope"` (합의됨, BE 미구현, #205).** `scope` 승인(§2.5)을 승인하면 생기는 범위 변경 이력이다. `old_value` 는 `null`, `new_value` 는 범위 변경 문장이다. 이슈는 문장의 출처를 정하지 않았고 MSW 는 payload `doc_text` 를 쓴다(합의 여부 확인 필요). 되돌릴 Task 필드가 없어 되돌리기는 400 `INVALID_REQUEST`(`되돌릴 수 없는 변경 항목입니다`)다.
  FE 구현: 이력 매퍼가 `scope` 를 받고(~~모르는 값은 지금처럼 `title`~~ 2026-11-08 #348 부터 모르는 값은 `알 수 없는 항목`), 이력 줄을 `범위 변경: <new_value>` 로 보인다. `이전 → 이후` 형식을 쓰지 않는다. FE 화면에는 이력 되돌리기 버튼이 없다.

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
  confidence = min(언급된 값들)          assignee_raw·due_raw 가 null 이면 그 값은 빠진다
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
> - **반려는 더 나쁘다.** 백엔드가 반려 시 `extraction_item` 을 **아예 건드리지 않아**
>   반려된 항목과 대기 중인 항목이 **응답에서 완전히 같은 모양**이다(`task_id` 없음, `approval_id` 있음).
>   `extraction` 응답만으로는 구분할 방법이 없다 — 승인 상태 필드가 없다.
> - **프론트엔드 대응** — 답을 기다리지 않는다. 화면별로 나눈다.
>   - **일반 팀원** — `task_id` 가 없고 `approval_id` 가 있으면 숨긴다. 대기든 반려든 보여줄 태스크가 없어 이 규칙으로 충분하다.
>   - **PM** — `GET /approvals?status=pending` 과 조인한다. 그 목록에 있는 `approval_id` 만 `확인 필요` 다.
>     승인이든 반려든 닫힌 승인은 목록에서 빠지므로 자동으로 제외된다. 백엔드가 ②-12 를 고쳐도 그대로 맞는다 (§6).

> **2026-11-06 코드 대조(#419).** 위 인용의 두 전제가 지금 서버와 다르다.
>
> - 응답에 `approval_status`(`pending`·`approved`·`rejected`, 승인이 없으면 `null`)가 있다. 대기와 반려를 항목만으로 구분할 수 있다.
> - 수정 항목은 승인 전에도 `task_id` 가 수정 대상 태스크다(§2.4). `task_id` 가 있다고 반영된 것이 아니다.
>
> 프론트엔드 판정은 다음과 같다. 구현: [extractionView.ts](../../src/entities/extraction/lib/extractionView.ts).
>
> - **반영됨** — `task_id` 가 있고, `approval_id` 가 없거나 `approval_status` 가 `approved` 다.
> - **일반 팀원** — `approval_id` 가 있고 반영되지 않은 항목을 숨긴다. 생성·수정 어느 쪽이든 대기·반려는 보이지 않는다.
> - **PM** — `확인 필요` 는 반영되지 않았고 `approval_status` 가 `rejected` 가 아닌 항목 중 `GET /approvals?status=pending` 의 ID 와 조인한 것이다. 조인은 그대로 둔다. 항목마다 승인의 빠진 값(`missing`)이 필요하기 때문이다. 반려 뒤 추출만 다시 받고 대기 목록이 아직 낡았어도 항목 쪽 `rejected` 로 빠진다. `approval_status` 가 `null` 이면 대기 목록을 따른다.

**따라서 생성 항목의 `확인 필요` 에는 `task_id` 가 없다.** 승인 전까지 태스크 행이 존재하지 않는다.
식별자는 `approval_id` 뿐이며, 이것이 D-161·D-162 의 근거다. 수정 항목은 `task_id` 가 있지만 `확인하기` 는 똑같이 `approval_id` 로 간다.

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

이 절은 초기 구현과 요청의 기록이다. 뒤에 붙인 날짜별 정정은 유지하며, OAuth·온보딩·업로드·회의록·초대의 현재 상태는 문서 앞 「후속 구현 상태 대조」를 먼저 본다.

PR #59 가 §4.1~§4.5 를 구현했다. **요청의 성격이 바뀌었다** — 이제 대부분은 「만들어 달라」가 아니라
「만들어진 것이 계약과 다르다」다. 세 갈래로 나눈다.

**① 계약대로 구현됨 — 프론트엔드가 그대로 쓴다**

| 계약 | 구현 |
|---|---|
| §4.1 `signup` · `login` · `logout` · `me` | `api/auth.py`. PBKDF2, `session` 테이블 |
| §4.1 세션 요구 3가지 (D-165) | **3개 다 충족.** `httponly` · `samesite=lax` · `secure`, 로그아웃 즉시 삭제, 토큰은 opaque random 이라 역할이 안 담긴다. ~~단 그 세션을 요구하는 라우터가 절반뿐이다~~ → ②-1 (2026-09-29 해소) |
| §4.2 `GET /workspaces` 사용자 스코프 | `Member.user_id` 조인으로 소속만 반환 |
| §4.2 `role` | `MemberRole` = `pm` \| `member`. 제안 그대로 |
| §4.4 `GET /workspaces/{id}/meetings` | `started_at` 내림차순, `failed` 제외까지 맞다 (D-093, D-106) |
| §4.4 `POST .../meetings/upload` | multipart, 202, 409 `MEETING_PROCESSING_IN_PROGRESS` + `details.meeting_id` |
| §4.5 Discord 유일 제약 (D-027) | `UniqueConstraint(workspace_id, discord_user_id)` + 409 `DISCORD_USER_ALREADY_MAPPED` |
| §4.7-1 `progress` | `MeetingProgress{audio_merged, transcribed, extracted}` 복구 |
| §4.7-2 `started_at` 사용자 지정 | 업로드 요청 값을 그대로 저장 |
| §4.7-6 `task.start_date` | 모델 · 응답 · POST · PATCH · `ChangedField` 전부 |
| §4.9 오류 코드 11개 | 이름과 상태 코드까지 제안 그대로 |

**② 구현됐지만 계약과 다르다 — 이 17건이 새 요청 목록이다** (②-17 은 2026-10-02 M5 에서 추가)

> ### 먼저 읽을 것 — ②-1 은 나머지 15건과 급이 다르다
>
> **2026-09-29 갱신 — ②-1 은 해소됐다.** 프론트가 쓰는 엔드포인트는 모두 로그인 + 소속을 확인한다(아래 「②-1 의 실제 범위」).
> 아래 상자는 PR #59 시점의 기록이다.
>
> **지금 로그인하지 않은 사람이 워크스페이스 ID 만 알면 태스크·승인·팀원·추출 결과를 전부 읽고 고칠 수 있다.**
>
> ```
> curl 'http://localhost:8000/api/v1/tasks?workspace_id=ws_01'          # 남의 태스크 전량
> curl -X PATCH 'http://localhost:8000/api/v1/tasks/tk_01' -d '{...}'   # 남의 태스크 수정
> ```
>
> `tasks` · `approvals` · `members` · `extractions` 네 라우터에 **인증 의존성이 하나도 없고** 전역 미들웨어도 없다.
> `GET /tasks` 는 `workspace_id` 로 필터만 하고 **요청자가 누구인지 보지 않는다.**
>
> **프론트엔드가 막을 수 없다.** 라우터 가드는 화면을 감출 뿐 API 는 열려 있고 `curl` 한 줄로 우회된다.
> 나머지 15건은 화면 일정과 함께 가도 되지만 **이것은 그렇지 않다.**

| # | 대상 | 현재 | 요청 |
|---|---|---|---|
| 1 | **인증 전반** | ~~**절반만 걸려 있다.** 미인증으로 데이터를 읽고 쓸 수 있다.~~ **2026-09-29 해소** — 아래 표 참조 | 프론트가 쓰는 모든 엔드포인트에 `get_current_user` · `get_current_member` 를 걸어 달라 |
| 2 | 워크스페이스 이름 중복 | 완전일치 + **전역** 비교 | 앞뒤 공백 제거 · 연속 공백 축약 후 **대소문자는 구분한 채** **같은 계정 안에서만** 비교 (D-015~D-020) |
| 3 | `onboarding` | **스텁이다.** `current_step` 이 하드코딩, `steps` 가 고정, `skipped` 가 절대 안 나온다 | 단계별 상태를 실제로 저장. `PATCH .../onboarding` 의 `skip` 이 동작해야 한다 (D-008, D-012) |
| 4 | `onboarding.current_step` | 완료 시 **빈 문자열** `""` | 완료 시 `null` |
| 5 | 온보딩 미완료 대시보드 접근 | 검사가 없다 | 403 `ONBOARDING_INCOMPLETE` + `details.current_step` (D-071) |
| 6 | `GET /integrations` | `status` 가 `connected` \| `not_connected` **둘뿐.** `revoked` 가 절대 안 나온다 | **`revoked` 를 구분해 달라.** 미연결과 끊김은 다른 모달이다 (D-097, D-100). **2026-11-07(#507):** 두 모달을 없앴다. 구분은 설정 카드의 `연결 안 됨`·`연결 실패` 표시에만 쓴다 (D-182) |
| 7 | `integration.display_name` | `"Discord 연결됨"` 같은 **생성 문자열** | 실제 서버 · 워크스페이스 이름 |
| 8 | `DELETE .../integrations/{provider}` | **204, 본문 없음** | 봉투로 (§1) |
| 9 | `POST .../meetings/upload` | `attendee_member_ids` 를 **받고 버린다.** 파일도 저장하지 않는다(TODO). 게다가 **`str = Form(...)` 단일 값**이라 같은 이름을 반복해 보내도 하나만 잡는다 | 참석자 저장 (D-085, D-086). **받는 형식을 `list[str] = Form(...)` 로** — 프론트는 같은 이름 필드를 반복해 보낸다(impl-decision 2026-09-18). 지금 형식으로 저장을 구현하면 **참석자 일부만 저장된다.** Notion 미연결 409 `INTEGRATION_NOT_CONNECTED` (D-096), 용량 초과 413 `AUDIO_TOO_LARGE`. **2026-11-07(#507):** Notion 미연결 409 요청은 철회한다 — 업로드는 Notion 을 요구하지 않는다 (D-182) |
| 10 | `GET .../discord/members` | **하드코딩 2명** (`disc_01`, `disc_02`) | 연결된 서버의 실제 사용자 목록 |
| 11 | `GET /meetings/{id}/minutes` | `transcript` 가 **하드코딩 1줄.** `attendees` 는 `audio_segment` 에서 역산 | §4.7-5 의 구조화 응답. 참석자는 회의 참석자 명단에서 |
| 12 | 승인·반려 처리 | `extraction_item.approval_id` 를 **어느 쪽으로 닫혀도 비우지 않는다.** 반려는 `extraction_item` 을 아예 건드리지 않는다 | **승인이든 반려든 닫히면 `approval_id` 를 `null` 로.** 안 되면 프론트가 `GET /approvals?status=pending` 과 조인해 우회한다 (§3.1) |
| 13 | 승인 `task_create` | ~~payload 의 `status` · `progress` 도 읽어 반영한다~~ #303 부터 둘 다 읽지 않는다. 상태는 항상 `todo` | 요청이 아니라 **기록**이다. §2.5 의 payload 설명에 빠져 있었다 |
| 14 | `GET /workspaces/{id}/meetings` | `title` 이 nullable 인데 `items: list[dict]` 라 스키마에 안 드러난다 | 목록 `title` 의 nullable 여부를 스키마로 고정해 달라. **프론트 DTO 는 nullable 로 맞췄고 매퍼가 빈 문자열로 폴백한다** |
| 15 | `GET /members/unresolved-aliases` | ~~해결 판정이 **별칭 후보 정확히 1개 + 그 1개가 `verified`** 다(`matching.py` `resolved_alias_texts`). 미검증뿐이거나 후보가 여럿(검증 1 + 미검증 1 포함)이면 목록에 남는다~~ **2026-11-08(#523):** 님·조사를 뗀 후보 중 처음 걸린 후보의 별칭이 1개이고 `verified` 면 해결이다. 한 글자는 `manual`·`learned` 만, 탈퇴한 팀원의 별칭은 세지 않는다(`matching.py` `resolved_texts`, §2.2) | 요청이 아니라 기록이다. ~~**MSW 도 같은 규칙으로 계산하게 맞췄다**~~ **MSW 는 아직 옛 규칙(같은 글자 정확히 1개 + `verified`)이다.** 후보 떼기·한 글자·탈퇴 규칙이 없어 님·조사가 붙은 이름은 실서버와 결과가 다를 수 있다. #523 은 이 차이를 고치지 않았다(이슈의 「필수 아님」) |
| 16 | `GET /workspaces/{id}/meetings` 의 `attendee_count` | `audio_segment` 의 화자에서 역산한다(`# attendee_count 로직 개선 필요`). **말하지 않은 참석자는 빠지고, 로컬 업로드는 세그먼트가 없어 늘 0** 이다 | 업로드가 받은 `attendee_member_ids` 를 저장하고 그것으로 세 달라 (②-9 와 한 쌍이다) |
| 17 | `POST .../meetings/upload` 의 권한 | `get_current_member` 로 **소속만** 본다. 일반 팀원도 올릴 수 있다 | **업로드 PM 권한 강제.** `member.role != pm` 이면 403 `FORBIDDEN`. M5 는 업로드를 PM 전용으로 정했다(D-090 의 보류 조건 해소, impl-decision 2026-10-02-meeting-upload-policy). 프론트는 PM 가드로 화면을 막지만 가드는 UX 장치다 — API 는 열려 있다 |

**MSW 가 일부러 더 엄격한 곳 두 군데.** 요청이 아니라 기록이다. 어느 쪽도 「mock 은 되는데 실 API 에서 깨지는」 방향이 아니라
「실 API 는 받아 주는데 mock 이 막는」 방향이라 화면을 잘못 만들 위험이 없다. 맞출 실익이 없어 그대로 둔다.

| 항목 | 백엔드 | MSW |
|---|---|---|
| `progress` | 아래 표 참조 — **두 경로 모두** MSW 가 더 엄격하다 | 정수형 `number` 만 받는다 |
| `title` 300자 | Python `len()` — 유니코드 **코드 포인트** | JS `.length` — UTF-16 **코드 단위**. 이모지 등 비-BMP 가 많으면 MSW 가 먼저 막는다 |

> 2026-11-04 #303: 서버에서 Task `progress` 를 뺐다. 아래 두 표의 `progress` 는 그 전 기록이다.

**`progress` 를 값별로 보면 이렇다.** pydantic 이 **lax 모드**라 직접 API 도 문자열·불리언을 받아 준다.

| 보낸 값 | `POST`·`PATCH /tasks` | 승인 payload | MSW |
|---|---|---|---|
| `30` | 30 | 30 | 30 |
| `"30"` | **30** | 30 | **거절** |
| `30.0` | **30** | 30 | 30 — JS 에서 `30.0` 은 `30` 과 같은 `number` 다 |
| `30.9` | **거절** | **30** | 거절 |
| `true` | **1** | 1 | **거절** |

두 경로가 갈리는 것은 `30.9` 하나이고, MSW 가 더 엄격한 것은 `"30"` 과 `true` 두 값이다.

- `POST` · `PATCH /tasks` — 본문이 `TaskCreateRequest` · `TaskUpdateRequest` 의 `progress: int` 를 먼저 통과한다.
  pydantic lax 는 소수부가 있는 실수를 정수로 바꾸지 않으므로 `30.9` 만 여기서 거절된다.
- `PATCH /approvals/{id}` 의 반영 — `approval.payload` 가 `Text` 컬럼이라 `json.loads` 한 **타입 없는 dict** 다.
  pydantic 을 거치지 않아 `validate_task_fields` 의 `int(value)` 가 그대로 돌고, `30.9` 도 `30` 으로 잘린다.

**어느 경우든 MSW 가 더 엄격하다.** 「mock 은 되는데 실 API 에서 깨지는」 방향이 아니므로 맞추지 않는다.

**워크스페이스 이름 길이 — 제품 결정과 서버가 다르다.** 요청이 아니라 기록이다.

| | 값 | 기준 |
|---|---|---|
| D-017 (제품 결정) | **1~20자** | 앞뒤 공백을 제거한 뒤 |
| 백엔드 | **1~100자** | `Field(min_length=1, max_length=100)` — 원본 그대로 |

**서버를 20자로 좁혀 달라고 요청하지 않는다.** D-160 이 이미 구현된 스키마의 변경을 요청하지 않기로 정했고, `100 → 20` 은 변경이다.
**D-017 은 폼이 막는다** — M3 의 `shared/lib/validation` 이 정규화 후 1~20자를 검사한다(개발 계획 M3).
MSW 는 **API 를 흉내내므로 100자 기준을 그대로 쓴다.** 여기에 20자를 넣으면 「mock 은 막는데 실 API 는 받는」 반대 방향 불일치가 생긴다.

**②-1 의 실제 범위 — 2026-09-29 `backend/` 재확인.** 프론트가 부르는 엔드포인트는 **모두** `get_current_user` 로 로그인을,
`get_current_member` · `require_member` 로 소속(비소속 403 `FORBIDDEN`)을 본다. 전역 미들웨어는 여전히 없고 엔드포인트마다 건다.

| 라우터 | 지금 |
|---|---|
| `workspaces.py` | 생성·목록은 로그인, 상세·온보딩·회의 목록·업로드는 소속까지. **상세도 `require_member`** (공간이 없으면 먼저 404) |
| `integrations.py` | 3개 모두 소속 |
| `members.py` | 생성·목록·별칭·단건·수정 모두 소속 (`POST` 는 본문의 `workspace_id` 로 `require_member`) |
| `tasks.py` | 생성·목록은 소속, `/{task_id}/...` 는 라우터 단위 `require_task_member` |
| `approvals.py` | 생성·목록·단건·승인·반려 모두 소속 |
| `extractions.py` | 단건은 소속. `POST` 는 AI → BE 경로라 열려 있다 |
| `meetings.py` | `/minutes` 는 소속. `POST` · `GET /{meeting_id}` · `/end` 는 봇 경로(§2.3)라 열려 있다 |

아래 표는 **PR #59 시점의 기록**이다. 숫자는 `Depends(get_current_user)` · `Depends(get_current_member)` 를 실제로 건 **엔드포인트 수**다.

| 라우터 | 보호된 엔드포인트 | 상태 |
|---|---|---|
| `workspaces.py` | 6 | 걸려 있다. 단 `GET /{workspace_id}` 는 **멤버십을 안 본다** |
| `integrations.py` | 3 | 걸려 있다 |
| `meetings.py` | 1 | `/minutes` 만. `GET /meetings/{id}` 등은 열려 있다 |
| `tasks.py` | **0** | 조회 · 생성 · 수정 · 되돌리기 전부 **비로그인 가능** |
| `approvals.py` | **0** | 조회 · 승인 · 반려 전부 비로그인 가능 |
| `extractions.py` | **0** | 열려 있다 |
| `members.py` | **0** | `get_current_member` 를 **import 만 하고 쓰지 않는다** |

**이 사실이 프론트엔드 설계에 주는 것.** 라우터 가드는 **UX 장치이지 보안 경계가 아니다.** 권한은 API 가 요청마다 확인한다.
서버가 막아 준다고 가정하고 가드를 느슨하게 만들지 않고, 가드를 보안 대책으로 보고하지도 않는다.

**③ 아직 없다**

| 계약 | 상태 |
|---|---|
| §4.1 Google OAuth `start` · `callback` (302) | 미구현. 로컬 이메일·비밀번호 경로만 있다 |
| §4.3 integrations `start` · `callback` (302) | 미구현. 연결을 만들 방법이 API 에 없다 |
| §4.7-3 `failed_stage` 값 구분 | 자유 문자열 유지. #256의 `diarize`·`speaker_assignment_expired`는 §4.4.1대로 구분. Notion 원인 전용 값은 미확정 |
| §4.7-4 요약 저장 | **절반.** `Extraction.summary` 컬럼은 생겼고 `/minutes` 가 읽지만, 채우는 쪽이 없다 |
| §4.7-5 transcript 구조화 | 미구현 (②-11) |
| §2.6 actor 유추 | 미구현. `created_by` · `changed_by` · `resolved_by` 를 여전히 프론트엔드가 실어 보낸다 |

**프론트엔드에 주는 영향**

- **M1 산출물은 그대로 유효하다.** `entities` 타입과 mapper 는 §4.1~§4.5 를 미리 가정해 두었고, 실제 구현이 그 가정과 이름·형태가 맞다.
- 스텁(②-3, ②-10, ②-11)에 걸리는 화면은 **M4 · M5 다.** 그때까지 채워지지 않으면 MSW 로 개발하고 실 API 연결을 뒤로 미룬다.
- ②-1 은 보안 문제이므로 화면 일정과 무관하게 먼저 올린다.
- ①의 `WorkspaceResponse.role` 은 `Optional` 이고 **현재 사용자 기준**이다. 목록은 소속만 반환해 항상 채워진다.
  ~~**상세는 비소속 사용자에게 `null` 을 준다** — `GET /workspaces/{id}` 가 멤버십을 안 보기 때문이다(②-1).~~
  **2026-09-29 기준 상세도 비소속에게 403 이라 `null` 이 오지 않는다.** 타입은 스키마대로 `string | null` 로 둔다.
  **`null` 은 「역할 모름」이 아니라 「이 워크스페이스에 없음」이다.** 백엔드가 `Member` 행을 못 찾으면 `role` 을 채우지 않는다.
  프론트엔드 DTO 를 `string | null` 로 두고 mapper 가 `member` 로 폴백한다 (§6).
  ~~권한을 넓히는 방향으로 틀리지 않는다.~~ **틀린 설명이었다** — `member` 는 `null`(비소속)보다 넓다.
  **가드가 `role` 하나로 접근을 판단하면 안 된다.** ②-1 이 고쳐져 비소속은 403 이 되고 이 폴백에 닿지 않는다(2026-09-29).

### 4.1 auth

~~세션과 사용자 개념이 백엔드에 전혀 없다.~~ **PR #59 로 생겼다.** `user` · `session` 테이블과 `api/auth.py`.

| Method | Path | 비고 | 구현 |
|---|---|---|---|
| POST | `/api/v1/auth/signup` | **201**. 본문이 바뀌었다 (§4.1.4) | ✅ |
| POST | `/auth/login` · `/auth/logout` | | ✅ |
| GET | `/api/v1/auth/me` | | ✅ |
| ~~GET~~ | ~~`/api/v1/auth/google/start?state=` · `/auth/google/callback`~~ | Google 로그인은 이번 범위에서 하지 않는다 (D-182). 카카오는 §4.1.4 | 해당 없음 |

```jsonc
// signup 요청 {"verification_token"?, "name", "password", "link_kakao"} (§4.1.4)   login 요청 {"email", "password"}
// signup · login · me 의 응답 data
{"user": {"user_id": "us_01", "email": "pm@example.com", "name": "최진호", "avatar_url": null},
 "workspace_count": 2,
 "last_workspace_id": "ws_01"}
```

- `workspace_count` 로 로그인 후 이동을 분기한다. `0` 이면 온보딩, `1` 이면 대시보드, `2` 이상이면 선택 화면 (D-010).
  구현은 `Member` 행 수를 센다. `last_workspace_id` 는 가장 최근에 들어간 멤버십이다. 초대로 들어간 곳은 수락 시각, 그 밖에는 멤버십을 만든 시각으로 비교한다.
- **세션 요구사항 3가지** (D-165) — **셋 다 충족됐다.** 토큰 형식은 백엔드가 정하며 **JWT 를 요구하지 않았다.**
  1. Secure·HttpOnly 쿠키, `SameSite=Lax`. 응답 본문에 토큰을 담지 않는다. → ✅ `set_cookie(httponly, samesite="lax", secure=True)`
  2. 로그아웃 시 즉시 무효화한다. → ✅ `session` 행을 삭제하고 쿠키를 지운다
  3. **토큰과 세션에 역할·권한을 담지 않는다.** → ✅ `secrets.token_urlsafe(32)` 의 opaque 값이라 담길 수 없다.
     권한은 `get_current_member` · `require_member` 가 요청마다 멤버십에서 조회한다. ~~`tasks` · `approvals` · `extractions` · `members` 에는 걸려 있지 않다~~ — 2026-09-29 기준 모두 걸려 있다 (②-1)
- OAuth 는 본문 없는 302 다. ~~`state` 에 복귀 경로를 담는다 (D-158). → ❌ 미구현. 로그인 화면의 Google 버튼은 M4 에서 비활성으로 둔다.~~ → 카카오 로그인이 이 방식이다 (§4.1.4). Google 버튼은 없앴다.
- 미인증 요청은 401 `UNAUTHENTICATED`. → ✅ `deps.get_current_user`
- 쿠키가 `secure=True` 라서 **HTTPS 가 아니면 브라우저가 저장하지 않는다.** `localhost` 는 예외로 허용되므로 Vite 프록시 경유 개발은 된다.
- **만료는 서버 세션에만 있다.** `session.expires_at` 이 발급 후 7일이고 `get_current_user` 가 지나면 401 을 낸다. `set_cookie` 에는 `max_age` · `expires` 가 없어
  쿠키는 브라우저 세션 쿠키다 — 브라우저를 닫으면 7일 전이어도 사라진다 (2026-09-29 `auth.py` `_create_session`).

#### 4.1.1 비밀번호 재설정 (#356·#451) — 구현됨(BE PR #398 병합), 운영 메일 확인됨

제공자는 BE, 소비자는 FE 요청 화면 `/forgot-password`와 변경 화면 `/reset-password`다. 합의 근거는 [BE 제안](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/356#issuecomment-6636865795), [FE 답변](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/356#issuecomment-6639046611), [BE 설계 확정](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/356#issuecomment-6652505200) 댓글이다. 서버 구현은 [BE PR #398](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/398)이고 2026-11-06 develop에 병합됐다. 2026-11-06(#451)에 develop `41d81d68`의 [auth.py](../../../backend/app/api/auth.py), [schemas/auth.py](../../../backend/app/schemas/auth.py), [password_reset.py](../../../backend/app/services/password_reset.py), [errors.py](../../../backend/app/core/errors.py), [main.py](../../../backend/app/main.py)를 다시 읽고 대조했다. BE는 운영 서버 메일 설정을 마친 뒤 알리기로 했다. 2026-11-08 [#451 댓글](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/451)에서 운영 서버(`https://managers-manager.duckdns.org`)의 request 200 `{}`, Gmail 수신, 메일 링크로 변경, 새 비밀번호 로그인을 확인했다고 알렸다. 메일은 Gmail 스팸함으로 들어갔고, 같은 이메일의 재요청은 60초 안에 메일이 가지 않는다(응답은 같은 200). FE는 실서버를 직접 부르지 않았다.

**규약 (develop 코드 기준).** 세 경로 모두 로그인이 필요 없다.

| Method | Path | 요청 | 성공 | 실패 |
|---|---|---|---|---|
| POST | `/api/v1/auth/password-reset/request` | `{"email"}` | 200 `{"data": {}}` | 400 `INVALID_REQUEST`(이메일 형식), 503 `MAIL_UNAVAILABLE`(서버 메일 설정 없음) |
| POST | `/api/v1/auth/password-reset/verify` | `{"token"}` | 200 `{"data": {"expires_at", "email_masked"}}` | 400 `PASSWORD_RESET_TOKEN_INVALID` |
| POST | `/api/v1/auth/password-reset/confirm` | `{"token", "new_password"}` | 200 `{"data": {}}` | 400 `INVALID_REQUEST`(규칙 위반), 400 `PASSWORD_RESET_TOKEN_INVALID` |

- `PASSWORD_RESET_TOKEN_INVALID`의 `details.reason`은 `invalid`(없는 토큰이거나 새 요청으로 밀림), `used`(이미 사용), `expired`(만료)다. 이 순서로 판정한다. verify와 confirm이 같다.
- `email_masked`는 아이디 앞 2자 + `***`이다. 아이디가 2자 이하면 앞 1자만 남긴다. 도메인은 그대로다. 예: `ab***@gmail.com`, `pm@example.com` → `p***@example.com`.
- `INVALID_REQUEST`는 본문 검증(pydantic) 오류다. `details.fields`는 `[{"loc": ["body", "new_password"], "msg": "..."}]` 모양이다. 본문 검증이 토큰 확인보다 먼저라, 규칙 위반이면 토큰이 무엇이든 400 `INVALID_REQUEST`이고 토큰을 쓰지 않는다.
- 메일 설정 확인이 가입 여부 판단보다 먼저다. 설정이 없으면 모든 요청이 503이다. 설정이 있으면 가입하지 않은 이메일과 제한에 걸린 요청도 같은 200이고 메일은 나가지 않는다.
- 요청 제한은 계정마다 60초에 1번, 1시간에 5번이다. 발급 기록으로 세므로 재시작해도 유지된다. 새 토큰을 실제로 발급할 때만 이전 미사용 토큰이 `invalid`가 된다. 제한에 걸린 요청은 이전 링크를 그대로 둔다.
- 토큰은 30분, 1회용이다. DB에는 sha256 해시만 둔다.
- 이메일은 로그인과 같이 대소문자까지 정확히 일치해야 찾는다.
- 메일 링크는 `{APP_BASE_URL}/reset-password#token=...`이다. 토큰이 서버 접근 로그와 Referer에 남지 않도록 fragment로 보낸다. 메일은 응답 뒤 백그라운드로 보내고 실패하면 3번까지 다시 보낸다.
- 새 비밀번호 규칙은 8자 이상(코드 포인트 수), ASCII 숫자 0-9 하나 이상이다. confirm이 변경, 토큰 사용 처리, 그 계정의 세션 전부 삭제를 한 트랜잭션으로 한다. 새 세션은 만들지 않는다.
- 회원가입 변화. `POST /auth/signup`도 같은 규칙을 어기면 400 `INVALID_REQUEST`다. 약한 비밀번호와 이미 있는 이메일이 함께 오면 409 대신 400이다. FE 회원가입 폼(`signupProfileSchema`)은 같은 규칙(길이는 코드 포인트)을 먼저 검사하므로 화면에서 이 400에 닿지 않는다. 그래도 400이 오면 폼 상단에 「요청 내용을 다시 확인해 주세요.」를 보인다. 409 `EMAIL_ALREADY_EXISTS`는 지금처럼 이메일 칸 아래에 보인다.

**FE가 맞추기로 한 동작.** 화면 동작이며 API 형태가 아니다.

- 변경 화면은 `location.hash`에서 토큰을 읽고, verify를 부르기 전에 주소에서 지운다(`history.replaceState`). 이후 토큰은 verify·confirm 본문으로만 보낸다.
- `/reset-password`는 `RedirectIfAuthed` 밖이다. 로그인된 브라우저에서 열어도 변경 화면이 보인다. `/forgot-password`는 다른 공개 화면처럼 안에 둔다.
- 변경 화면은 `email_masked`로 「{가린 이메일} 계정의 비밀번호를 바꿔요.」를 보인다.
- 변경 성공 뒤 그 브라우저의 FE 세션 상태를 비우고 `/login`으로 보내 안내 문구를 띄운다. 응답을 기다리는 사이 이 브라우저에서 다른 계정으로 로그인했으면 그 요청은 취소되고, 늦은 응답이 와도 새 계정의 세션·화면·푸시 구독을 건드리지 않는다(#451).
- 같은 변경 화면에 새 메일 링크(`#token=`)가 오면 그 링크를 새로 확인하고 그 토큰으로 바꾼다. 앞 링크의 확인 결과와 변경 거절은 버리고, 진행 중인 앞 확인은 취소한다(#451).
- `reason`별로 문구를 나눈다. 세 경우 모두 「다시 요청하기」로 `/forgot-password`에 보낸다.
- 요청을 보낸 뒤 60초 동안 「다시 보내기」를 막고 남은 초를 보인다. 1시간 5회 제한은 화면에서 막지 않는다.
- 로그인 화면의 「비밀번호를 잊으셨나요?」는 `/forgot-password`로 가는 링크다(#451). BE가 2026-11-08 운영 메일 수신을 확인해 병합 조건(request가 503이 아님)을 채웠다.
- 요청 완료 화면은 「링크는 30분 동안 쓸 수 있어요. 메일이 오지 않으면 스팸함을 확인해 주세요.」를 보인다(#356부터). BE가 #451에서 운영 메일이 스팸함으로 간다며 요청한 안내와 같다.

**합의와 구현의 차이.** 없다. 2026-11-05에 적은 두 차이는 #451(2026-11-06)에서 FE를 BE에 맞춰 없앴다.

- 길이 세는 단위. 전에는 FE `signupProfileSchema`·`resetPasswordSchema`가 UTF-16 단위로 세어, 이모지처럼 BMP 밖 문자가 섞인 비밀번호가 FE를 통과하고 BE에서 400이 될 수 있었다. 이제 FE도 BE처럼 코드 포인트로 센다.
- MSW 회원가입. 전에는 비밀번호 규칙을 보지 않고 이미 있는 이메일이면 409를 먼저 냈다. 이제 BE처럼 본문 검증(비밀번호 규칙)을 먼저 해 400 `INVALID_REQUEST`(`details.fields`)를 내고, 그다음에 409를 낸다. 규칙은 MSW 재설정 confirm과 한 곳에서 같이 쓴다.

**현재 구현 (2026-11-06, #451).** FE는 위 규약대로 만들었고 MSW로만 확인했다.

- 요청: [DTO](../../src/shared/types/api/auth.ts), [요청 함수](../../src/entities/user/api/passwordReset.ts), [reason 해석](../../src/entities/user/model/passwordReset.ts). `details.reason`이 없거나 모르는 값이면 `invalid`로 읽는다. verify의 `expires_at`은 읽어 두지만 화면에 쓰지 않는다. `details.fields`는 읽지 않고 confirm의 `INVALID_REQUEST`를 새 비밀번호 칸의 오류로 보인다.
- 오류 코드: `PASSWORD_RESET_TOKEN_INVALID`, `MAIL_UNAVAILABLE`을 [오류 코드 목록](../../src/shared/api/errors.ts)과 [문구](../../src/shared/api/errorMessages.ts)에 더했다. 서버의 같은 이름·상태 코드는 §1 「오류 코드」 아래에 적었다.
- 화면: [링크 상태](../../src/features/auth/model/useResetLink.ts), [변경 폼](../../src/features/auth/ui/ResetPasswordForm.tsx), [요청 폼](../../src/features/auth/ui/ForgotPasswordForm.tsx), [변경 뒤 정리](../../src/features/auth/model/useFinishPasswordReset.ts), [라우트](../../src/app/router/routes.tsx). 토큰은 첫 렌더의 주소에서 읽고, 주소를 replace로 비운 뒤에야 verify가 시작된다.
- 로그인 화면: [LoginForm](../../src/features/auth/ui/LoginForm.tsx)의 「비밀번호를 잊으셨나요?」가 `paths.forgotPassword()`로 가는 링크다(#451). 비밀번호 규칙은 [schemas.ts](../../src/features/auth/model/schemas.ts)의 `newPassword` 하나를 가입과 재설정이 같이 쓴다.
- MSW: [handler](../../src/shared/mock/handlers/passwordReset.ts), [시나리오](../../src/shared/mock/passwordResetScenarios.ts). 정상·만료·재사용·재요청 무효·재요청 제한·서버 오류(500)·메일 미설정(503)을 고정 토큰으로 재현한다. 개발·MSW 모드에서만 모의 메일함 `/__mock/mail`이 보낸 링크를 보여 준다. 본문 검증(필수 문자열, 비밀번호 규칙)과 400 `details.fields` 모양은 [validation.ts](../../src/shared/mock/validation.ts) 한 곳에서 재설정과 회원가입 handler가 같이 쓴다.
- 검증 (2026-11-06, #451): Vitest 단위·통합, 실제 Chromium E2E [password-reset.e2e.ts](../../e2e/password-reset.e2e.ts) 6개(로그인 링크 → 요청 → 모의 메일함 링크 → 변경 → 새 비밀번호 로그인, 만료·사용한·무효 링크, 규칙 위반 뒤 같은 링크로 변경, 메일 불가 503). 서버의 400 `INVALID_REQUEST` 뒤 같은 토큰으로 다시 바꾸는 경로는 클라이언트 규칙이 BE와 같아 실제 handler로는 닿지 않으므로 Vitest에서 한 번만 400을 주는 override로 확인했다. BE 코드는 읽어서 대조만 했다. FE는 실서버 왕복, 실제 메일 발송, 서버 세션 끊김을 직접 확인하지 않았다. 운영 서버의 요청·메일·변경·로그인은 BE가 2026-11-08에 확인했다.

#### 4.1.2 가입 이름 규칙 (#446) — BE PR #445 병합됨

제공자는 BE `POST /api/v1/auth/signup`, 소비자는 FE 회원가입 폼이다. 근거는 [#446 요청](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/446)과 [FE 반영 방침](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/446#issuecomment-6690116872) 댓글이다. 서버 구현은 [BE PR #445](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/445)이고 2026-11-06 develop에 병합됐다. 아래 규약은 develop의 `backend/app/schemas/auth.py` `validate_name`을 읽고 대조했다. 배포 서버에 적용됐는지는 확인하지 않았다.

**규약 (BE 코드 기준).** 경로·필드·오류 코드는 그대로다.

- 앞뒤 공백을 지운 이름을 저장한다. 응답 `user.name`도 지운 값이다.
- 지운 뒤 비었거나, 100자(코드 포인트)를 넘거나, 제어문자(Cc)·서로게이트(Cs)·줄 구분자(Zl·Zp)·글자 방향 제어 문자(U+202A~202E, U+2066~2069)가 있거나, 보이지 않는 글자(Cf·Mn·Me)와 공백(Z*)만 있으면 400 `INVALID_REQUEST`다. `details.fields`는 `[{"loc": ["body", "name"], "msg": "Value error, 이름은 앞뒤 공백을 뺀 1~100자이고 제어문자를 포함할 수 없습니다."}]` 모양이다.
- 본문 검증이 이메일 중복 확인보다 먼저다. 규칙을 어긴 이름과 이미 있는 이메일이 함께 오면 409 대신 400이다.
- ZWJ·ZWNJ는 허용한다.

**현재 구현 (2026-11-07).**

- 폼: [signupProfileSchema](../../src/features/auth/model/schemas.ts)가 앞뒤 공백을 지운 뒤 비었으면 「이름을 입력해 주세요.」, 100자를 넘으면 「이름은 100자 이하로 입력해 주세요.」를 이름 칸 아래에 보이고 요청을 보내지 않는다. 길이는 UTF-16 단위로 센다. BE(코드 포인트)보다 엄격해서 폼을 통과한 이름이 길이로 400이 되지 않는다. 이모지 같은 BMP 밖 글자가 많은 이름은 100 코드 포인트 안이어도 폼에서 막힐 수 있다.
- 폼은 보이지 않는 글자·제어문자를 검사하지 않는다. 그런 이름은 BE 400을 받아 폼 상단에 「요청 내용을 다시 확인해 주세요.」가 보인다. 입력창으로 넣기 어려운 글자라 이번에는 폼 검사를 더하지 않았다.
- MSW: [가입 handler](../../src/shared/mock/handlers/auth.ts)가 위 규칙과 순서를 따른다. 공백 제거는 Python `str.strip()`과 같은 글자 집합이고 길이는 코드 포인트로 센다. 비밀번호 규칙도 같은 본문 검증으로 먼저 본다(§4.1.1, #451).
- 검증: Vitest(스키마, MSW handler 규칙, 회원가입 화면 통합)와 MSW 모드 브라우저 확인. 실서버 왕복은 확인하지 않았다.

#### 4.1.3 로그인 시도 제한 429 (#457) — 합의됨, BE PR #456 병합

제공자는 BE `POST /api/v1/auth/login`, 소비자는 FE 로그인 폼이다. 근거는 [#457 요청](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/457)과 [FE 반영 방침](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/457#issuecomment-6690117714) 댓글이다. 서버 구현은 [BE PR #456](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/456)이다. 2026-11-07 develop에 병합됐고, BE가 [#554](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/554)에서 배포됐다고 알렸다. 아래 규약은 그 PR의 `backend/app/api/auth.py`, `services/login_limit.py`, `core/errors.py`를 읽고 대조했고, 2026-11-08(#451)에 develop의 같은 파일에서 429 상태·code·message·`details.retry_after_seconds`·`Retry-After`, 한도(이메일 10회·IP 50회, 15분)를 다시 확인했다. FE는 배포 서버를 부르지 않았다.

**규약 (BE 코드 기준).**

| 상태 | code | message | details | 헤더 |
|---|---|---|---|---|
| 429 | `TOO_MANY_LOGIN_ATTEMPTS` | 로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요. | `{"retry_after_seconds": <정수 초>}` | `Retry-After: <같은 값>` |

- 같은 이메일로 15분 안에 10번 실패하거나 같은 IP에서 15분 안에 50번 실패하면 15분 동안 막힌다. 막힌 동안에는 맞는 비밀번호도 429다.
- 시간이 지나면 풀린다. 비밀번호 재설정(§4.1.1 confirm)을 마치면 그 이메일의 막힘만 풀린다(`login_limit.clear_email`). 같은 IP의 막힘은 풀리지 않고, 응답은 이메일 막힘과 IP 막힘을 구분하지 않는다(#554). 이미 로그인한 세션은 영향이 없다.
- 있는 이메일과 없는 이메일의 응답이 같다. 화면은 계정이 잠겼다고 단정하면 안 된다.
- 로그인의 오류는 이로써 400 `INVALID_REQUEST`(본문 검증), 401 `INVALID_CREDENTIALS`, 429 `TOO_MANY_LOGIN_ATTEMPTS`다.

**FE가 정한 동작.** [FE 반영 방침](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/457#issuecomment-6690117714)은 감독 세션이 사용자 대신 정한 기본값이고 사용자 확인 전이다.

- 서버 문구를 그대로 폼 상단 오류로 보인다. 다른 오류 문구의 해요체와 다르다. 남은 시간은 보이지 않는다. `retry_after_seconds`와 `Retry-After`는 읽지 않는다.
- 로그인 화면의 「비밀번호를 잊으셨나요?」는 이 작업에서 켜지 않았다. #451(PR #458)이 켰다.
- 429 뒤 재설정 안내([#554](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/554), BE 요청). 서버 문구 뒤에 「비밀번호가 기억나지 않으면 재설정해 주세요.」를 붙이고, 같은 오류 패널 안에 `/forgot-password`로 가는 「비밀번호 재설정하기」 링크를 둔다. 계정이 잠겼다고 말하지 않고(가입 여부 노출 방지), 재설정하면 풀린다고 약속하지 않는다(IP 막힘은 재설정으로 풀리지 않는다). 남은 시간 표시와 재설정 화면 이메일 미리 채우기는 하지 않는다. 다른 오류(401 등)에는 붙이지 않는다.

**현재 구현 (2026-11-07).**

- 오류 코드: `TOO_MANY_LOGIN_ATTEMPTS`를 [오류 코드 목록](../../src/shared/api/errors.ts)과 [문구](../../src/shared/api/errorMessages.ts)에 더했다. 401처럼 비필드 오류라 [LoginForm](../../src/features/auth/ui/LoginForm.tsx)의 폼 상단에 보인다. 2026-11-09(#554)부터 LoginForm이 이 코드일 때만 재설정 안내 문장과 링크를 붙인다. 서버의 같은 이름·상태 코드는 §1 「오류 코드」 아래에 적었다.
- 재시도: [queryClient](../../src/shared/api/queryClient.ts)는 네트워크 오류·408·5xx만 다시 보내고 mutation은 다시 보내지 않는다. 429를 다시 보내지 않는 것은 기존 테스트가 확인한다.
- MSW: [로그인 handler](../../src/shared/mock/handlers/auth.ts)가 BE처럼 앞뒤 공백을 지우고 소문자로 바꾼 이메일별로 실패를 센다. 첫 실패부터 15분 안에 10번째 실패는 401이고, 그 뒤 15분 동안은 맞는 비밀번호도 429이며 `retry_after_seconds`와 `Retry-After`를 같은 값으로 준다. 막히기 전에 첫 실패부터 15분이 지나면 횟수를 새로 센다. 성공하면 그 이메일의 횟수를 지우고, 재설정 confirm을 마쳐도 지운다. IP 제한은 흉내 내지 않는다. BE는 공인 IP만 세고 사설·루프백 주소는 세지 않아 로컬 개발 요청은 IP 제한에 닿지 않고, 모의 요청에는 클라이언트 IP도 없다. 시나리오 `login-rate-limited`는 `pm@example.com`이 이미 막힌 상태로 시작하고 남은 시간은 900초다.
- 검증: Vitest(MSW handler 규칙, 로그인 화면 통합)와 MSW 모드 브라우저 확인. #554 안내는 `authFlow.test.tsx`(문장, 링크 이동, 401에는 없음)와 E2E `auth-limits.e2e.ts`로 확인한다. FE는 실서버 왕복을 확인하지 않았다.

#### 4.1.4 가입 이메일 인증과 카카오 로그인 (#427): 코드 구현, 실제 로그인·메일 수신 미확인

제공자는 BE, 소비자는 FE `/signup`과 `/login`이다. 아래 규약은 이슈 #427 명세(2026-11-06 사용자 결정)와 같은 브랜치 `feature/427-kakao-login-signup`의 `backend/app/api/auth.py`, `schemas/auth.py`, `services/signup_codes.py`, `services/kakao_oauth.py`, `core/errors.py`를 읽고 대조했다. 팀 합의를 마쳤다.

**규약 (같은 브랜치 BE 코드 기준).** 모두 로그인이 필요 없다. 응답은 기존 봉투다.

| Method | Path | 요청 | 성공 | 실패 |
|---|---|---|---|---|
| POST | `/api/v1/auth/signup/code` | `{"email"}` | 200 `{"expires_in": 600, "resend_after": 60}` | 400 `INVALID_REQUEST`, 409 `EMAIL_ALREADY_EXISTS`, 429 `SIGNUP_CODE_RATE_LIMITED`, 503 `MAIL_UNAVAILABLE` |
| POST | `/api/v1/auth/signup/code/confirm` | `{"email", "code"}` | 200 `{"verification_token", "expires_in": 1800}` | 400 `INVALID_REQUEST`(코드가 6자리 숫자가 아님), 400 `SIGNUP_CODE_INVALID` |
| POST | `/api/v1/auth/signup` | `{"verification_token"?, "name", "password", "link_kakao": false}` | 201 §4.1 응답, 세션 쿠키, 대기 쿠키 삭제 | 400 `INVALID_REQUEST`, 400 `SIGNUP_VERIFICATION_INVALID`, 400 `KAKAO_LINK_EXPIRED`, 409 `EMAIL_ALREADY_EXISTS`, 409 `KAKAO_ALREADY_LINKED` |
| GET | `/api/v1/auth/kakao/start?next=` | 전체 이동 | 302 카카오 동의 화면 | 설정 오류면 302 `/login?...oauth_result=failed` |
| GET | `/api/v1/auth/kakao/callback` | 카카오가 부른다 | 항상 302 | 아래 복귀 주소 |
| GET | `/api/v1/auth/kakao/pending` | 없음 | 200 `{"email": string\|null, "nickname": string\|null}` | 400 `KAKAO_LINK_EXPIRED` |

- `POST /auth/signup`은 이메일을 받지 않는다. `link_kakao`가 거짓이면 증명 토큰의 이메일로 만든다. 참이면 대기 쿠키가 있어야 하고, 쿠키에 인증된 이메일이 있으면 그 값으로 만들고 토큰은 무시한다. 없으면 토큰이 있어야 한다.
- 이메일은 앞뒤 공백을 빼고 소문자로 비교한다. 코드 요청과 카카오 충돌 판단, 로그인이 같은 규칙이다.
- 코드는 10분 유효, 코드당 5회 입력, 재발송 60초, 시간당 5회다. 증명 토큰과 대기 쿠키는 30분이다.
- `SIGNUP_CODE_RATE_LIMITED`의 `details`는 `{"reason": "cooldown" | "hourly" | "global", "retry_after": 초}`다. 재발송 제한 중에는 앞 코드가 그대로 유효하다.
- `SIGNUP_CODE_INVALID`의 `details`는 `{"reason": "wrong", "attempts_left": n}`, `{"reason": "expired"}`, `{"reason": "too_many"}`다. 다섯 번째 틀린 입력은 `wrong`에 `attempts_left: 0`이고 그 뒤가 `too_many`다.
- 대기 쿠키 `kakao_pending`은 HttpOnly이고 Path가 `/api/v1/auth`다. 카카오 신원은 URL에 싣지 않는다. 인증되지 않은 카카오 이메일은 쿠키에 담지 않아 `pending.email`이 null이다.

복귀 주소. 결과 이름은 §4.3의 연동 복귀와 같다.

| 경우 | 주소 |
|---|---|
| 이어진 카카오, 또는 인증 이메일이 빈 계정과 같아 이었다 | `/login?next=&oauth=kakao&oauth_result=success` + 세션 쿠키. 새로 이었으면 계정 이메일로 연결 알림을 보낸다 |
| 동의 취소 | `/login?...oauth_result=cancelled` |
| state·nonce 오류, 토큰·사용자 조회 실패 | `/login?...oauth_result=failed` |
| 이메일이 기존 계정과 같은데 인증되지 않았거나 다른 카카오에 이어져 있다 | `/login?...oauth_result=failed&oauth_reason=email_exists` |
| 그 밖의 새 사용자 | `/signup?kakao=1&next=` + 대기 쿠키 |

`next`가 없으면 BE는 `next=/`를 붙인다. FE `parseReturnPath`는 이 값을 보호 경로가 아니라고 버린다.

**FE가 맞추기로 한 동작.** 화면 동작이며 API 형태가 아니다.

- 가입 단계는 `email`, `code`, `profile` 합집합이다. 증명 토큰은 `profile`에만 있다. 카카오 연결 여부는 URL의 `kakao=1`에서 읽어 새로고침에도 풀리지 않는다.
- 429 `cooldown`은 실패로 보지 않고 코드 단계로 간다. 다시 보내기 초는 `resend_after`나 `retry_after`를 따른다. 429 `hourly`·`global`과 503은 폼 상단에 알린다. `global`은 전체 주소 합계가 시간당 20통을 넘었다는 뜻이다.
- `wrong`은 남은 횟수를 보인다. `expired`와 `too_many`는 코드 단계에 남아 다시 보내기로 이어 간다. `SIGNUP_VERIFICATION_INVALID`는 이메일 단계로 돌아간다.
- `kakao=1`이면 pending을 읽는다. 이메일이 있으면 프로필부터 시작하고 이메일은 고칠 수 없다. 이름은 닉네임으로 채우고 고칠 수 있다. 이메일이 없으면 코드 인증을 거치고 이름만 채운다. 이 모드의 가입은 모두 `link_kakao: true`다. `카카오 없이 가입`은 URL에서 모드를 지운다.
- 이 모드의 코드 요청 409는 이메일 칸에 다른 이메일을 입력하라고 알린다. 프로필의 409는 어느 모드든 로그인 경로를 보인다. `KAKAO_LINK_EXPIRED`는 카카오로 다시 시작하는 버튼을 보인다.
- 로그인 화면은 카카오 결과를 한 번 읽고 주소에서 지운다. `next`는 남긴다. `oauth_reason`은 허용 목록으로만 읽고 URL 값을 화면에 싣지 않는다.
- 성공 복귀는 새 문서라 `useEnterSession`을 거치지 않는다. 가드가 복귀 표시를 보고 이메일 로그인과 같은 공간 개수 분기로 보낸다(D-010). 카카오 버튼은 떠나기 전에 복귀 공간을 지운다.

**현재 구현 (2026-11-06).** FE는 위 규약대로 만들었고 MSW로만 확인했다.

- 요청: [DTO](../../src/shared/types/api/auth.ts), [가입 요청](../../src/entities/user/api/auth.ts), [코드·카카오 요청](../../src/entities/user/api/signupCode.ts), [details 해석](../../src/entities/user/model/signupCode.ts).
- 화면: [가입 폼](../../src/features/auth/ui/SignupForm.tsx), [단계 전이](../../src/features/auth/ui/SignupSteps.tsx), [대기 상태](../../src/features/auth/model/useKakaoLink.ts), [로그인 안내](../../src/features/auth/model/useLoginNotice.ts), [복귀 문구](../../src/features/auth/model/kakaoLogin.ts), [가드](../../src/app/router/guards/RedirectIfAuthed.tsx).
- MSW: [가입 코드 handler](../../src/shared/mock/handlers/signupCode.ts), [가입 handler](../../src/shared/mock/handlers/auth.ts), [모의 카카오](../../src/shared/mock/oauth/mockKakao.ts). 개발·MSW 모드에서만 `/__mock/kakao`가 새 사용자, 이어진 계정, 이메일 없음, 이메일 충돌, 취소, 실패를 고르게 하고 `/__mock/mail`이 코드를 보인다.
- 검증: Vitest 단위·통합, 실제 Chromium E2E [signup-kakao.e2e.ts](../../e2e/signup-kakao.e2e.ts).

**돌아갈 경로.** 로그인 화면의 회원가입 링크와 `/signup`은 `next`를 들고 있어 로그인으로 옮겨도 이어진다. 가입을 마친 새 계정은 `next`를 쓰지 않고 시작 화면으로 간다(#411, D-182).

**확인하지 않은 것.** 실제 카카오 로그인, 실제 메일 수신, 실서버 왕복은 하지 않았다. BE 코드는 읽어서 대조만 했다. `Secure` 쿠키와 카카오 redirect URI, 비즈 앱 이메일 동의 설정은 배포 환경에서 확인해야 한다. 배포 순서상 BE의 새 signup이 먼저 나가면 지금 배포된 FE의 가입이 400이 되므로 FE와 함께 내보낸다.

#### 4.1.5 이용약관·개인정보처리방침 동의 (#564): BE 제안, FE 합의 전

제공자는 BE, 소비자는 FE 가입·로그인 뒤 동의 화면이다. 근거는 [#564](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/564)와 FE 요청 [#566](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/566)이다. 아래는 2026-11-09 최신 develop을 통합한 #569의 `backend/app/api/consents.py`, `services/consents.py` 기준 구현 규약이다. FE 화면 연결과 최종 공개 정책의 승인은 아직 별도이며, 이 API 구현을 FE 합의·법률 검토·배포 완료로 표현하지 않는다.

| 메서드 | 경로 | 요청 | 응답 `data` |
|---|---|---|---|
| GET | `/api/v1/consents/me` | 없음 | `{required, documents: [{kind, current_version, agreed_version, agreed_at}]}` |
| POST | `/api/v1/consents` | `{terms_version, privacy_version}` | GET 과 같은 모양 |

- 둘 다 로그인 세션이 필요하다. 없으면 401 `UNAUTHENTICATED`.
- `kind` 는 `terms`(이용약관)와 `privacy`(개인정보처리방침) 둘이다. 지금 버전은 둘 다 `2026-11-08` 이다.
- `required` 는 한 문서라도 지금 버전에 동의하지 않았으면 true 다. 가입 직후, 카카오 첫 로그인, 기존 사용자, 문서 버전이 오른 경우가 모두 true 다.
- `agreed_version`·`agreed_at` 은 가장 최근에 동의한 버전과 그 시각이다. 동의한 적이 없으면 null 이다.
- POST 는 두 문서를 함께 받는다. 하나라도 지금 버전이 아니면 아무것도 저장하지 않고 400 `CONSENT_VERSION_MISMATCH` 이며 `details` 는 `{current_versions, received}` 다. 이미 동의한 버전을 다시 보내면 행을 더하지 않고 200 이다.
- 동시 POST도 `(user_id, kind, version)` 유일키의 충돌만 무시한다. 처음 저장한 시각과 과거 판본을 보존하며, 다른 저장 실패를 성공으로 처리하지 않는다. 응답은 해당 요청이 commit한 동의 상태다.
- 본문에 사용자 ID를 받지 않는다. 인증된 사용자만 기록하며 탈퇴와 같은 User 잠금 경계를 사용한다. 탈퇴가 먼저 끝나면 옛 세션의 POST는 401이고, 동의가 먼저 끝나도 뒤이은 탈퇴가 FK CASCADE로 동의 행을 지운다. 같은 이메일로 재가입한 새 User는 이전 동의를 이어받지 않는다.
- 가입 요청(`POST /auth/signup`) 모양은 바꾸지 않았다. 가입 직후 동의 기록이 없더라도 다른 API를 일괄 차단하지 않는 현재 동작을 유지한다. 공개용 FE 강제 흐름과 가입 시 원자적 동의 수집 여부는 #566의 후속 통합·공개 검토 사항이다.
- 문서 내용을 바꾸면 FE 문서 화면의 버전과 BE `CURRENT_VERSIONS` 를 같이 올린다.
- `2026-11-08`은 정책 초안·BE 제안의 판본이다. 최종 공개 시 검토 완료한 새 판본으로 문서·BE·FE를 함께 맞춰 초안 판본의 동의 행을 유효 동의로 재사용하지 않는다. `required=false`는 서버 설정 판본의 두 기록이 있다는 뜻이며 법률 검토 완료·정책 공개 승인·다른 API의 접근 권한 판정을 뜻하지 않는다.

### 4.2 워크스페이스의 사용자 스코프 · 역할 · 온보딩

~~`GET /workspaces` 가 **전체 워크스페이스**를 반환한다.~~ **세 가지 모두 PR #59 가 넣었다.** 초기 온보딩 스텁은 후속 구현에서 단계별 저장으로 바뀌었다(2026-11-09 소스 대조).

| 필요한 것 | 형태 | 구현 |
|---|---|---|
| 로그인 사용자의 소속만 반환 | `GET /workspaces` 의 동작 변경 | ✅ |
| 워크스페이스별 내 역할 | `WorkspaceResponse` 에 `"role": "pm" 또는 "member"` | ✅ 단 `Optional` |
| 온보딩 진행 상태 | 아래 | 단계별 상태 저장·조회 구현. 초기 스텁 기록은 §4.0-②-3 |

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
  초기 구현은 단계별 상태를 저장하지 않았다(§4.0-②-3). 현재 `WorkspaceOnboardingStepState`가 각 단계를 저장한다. pending 단계의 `skip`은 skipped로 바꾸고, 이미 완료한 단계는 skip으로 되돌리지 않는다. `create_workspace`의 skip은 400 `INVALID_REQUEST`다.
- `current_step` 은 완료 시 `null` 을 기대했는데 **빈 문자열** `""` 이 온다 (§4.0-②-4).
  프론트엔드 mapper 는 `''` 를 `null` 과 같게 다룬다 (§6).
- **이름 중복 검증이 없다.** → ⚠️ **409 는 생겼지만 비교 방식이 다르다.** 완전일치 + **전역** 비교다.
  같은 계정 안에서 앞뒤 공백 제거·연속 공백 축약 후 중복을 막아 달라 (D-015~D-020). 409 `WORKSPACE_NAME_DUPLICATED`.
  지금은 **남이 쓴 이름도 막힌다.** 반대로 `"팀 A"` 와 `"팀  A"` 는 둘 다 통과한다.
  **대소문자는 구분한다.** D-019 가 `Alpha` 와 `alpha` 를 서로 다른 이름으로 정했다. 이전 판이 `대소문자 무시` 를 요청한 것은 **D-019 와 어긋난 오류**였다.
  이 점에서는 백엔드의 완전일치 비교가 이미 맞다.
- 온보딩 미완료 워크스페이스의 대시보드 접근은 403 `ONBOARDING_INCOMPLETE` 와 `details.current_step` (D-071).
  → ❌ 코드는 정의됐지만 던지는 곳이 없다. **가드는 M3 에서 프론트엔드가 `onboarding.completed` 로 먼저 판단한다.**

#### 4.2.1 내 팀원 ID `member_id` (#367, 2026-11-05)

- **합의된 규약.** [#367](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/367) 댓글의 BE 설계 확정과 구현 완료(PR #374, develop 병합)에 따른다. `POST /workspaces`, `GET /workspaces` 의 각 항목, `GET /workspaces/{id}` 응답의 `role` 바로 뒤에 `member_id: string | null` 이 온다.
- 값은 로그인 계정이 연결된, 탈퇴하지 않은 이 공간의 팀원 행이다. 같은 응답의 `role` 과 같은 행이고, 메시지 답장 API 가 대화 주인을 판정하는 행과 같다(§5.7). `null` 은 `role` 이 `null` 인 경우와 같은 뜻(이 공간 팀원이 아님)이고 정상 경로에서는 오지 않는다.
- **현재 서버 구현.** [schemas/workspace.py](../../../backend/app/schemas/workspace.py)의 `WorkspaceResponse.member_id` 는 `Optional[str]`, 기본값 `None` 이다. [api/workspaces.py](../../../backend/app/api/workspaces.py)의 `_build_workspace_response` 가 팀원 행이 있을 때만 채운다.
- **현재 프론트 구현.** DTO [workspace.ts](../../src/shared/types/api/workspace.ts)는 이 필드를 선택(`member_id?: string | null`)으로 받는다. 이 필드가 없는 BE 배포 전 응답도 깨지지 않게 하려는 것이다. 매퍼는 필드가 없거나 `null` 이면 `memberId: null` 로 둔다. 화면은 이 값을 메시지 대화 주인 판정(답장 칸, #417 의 PM 자기 대화 구역과 표시 규칙)에만 쓴다(§5.7). 소속 판정은 지금처럼 목록에 있는지로 한다(§4.0-①).
- **모의 서버(MSW).** 목록·상세·생성 응답에 세션의 팀원 ID(`sessionMemberId`)를 싣는다. 계정과 팀원 행의 대응은 수락한 초대, 아니면 모의 DB 계정의 `memberIds` 다. 픽스처 계정은 `ws_01` 에서 PM 이면서 팀원 행 `mb_01` 이다. 공간을 만들면 BE 처럼 생성자 계정이 새 PM 행과 이어진다. 그래서 생성·목록·상세의 `member_id` 가 그 행 ID 이고, 그 행 대화의 답장은 201 이다. 같은 대응 때문에 생성자 PM 행을 초대하면 BE 처럼 409 `MEMBER_ALREADY_LINKED` 다.

### 4.3 integrations

~~Discord·Notion 연결 상태를 다루는 API 가 없다.~~ **현재는 조회·해제와 Discord·Notion 연결 start·callback이 모두 있다.**
`integration` 테이블이 `UniqueConstraint(workspace_id, provider)` 로 워크스페이스당 provider 하나를 보장한다.

| Method | Path | 구현 |
|---|---|---|
| GET | `/api/v1/workspaces/{workspace_id}/integrations` | 구현. Notion은 connecting·revoked도 반환 |
| GET | `/api/v1/workspaces/{workspace_id}/integrations/{provider}/start?state=` (**302**) | Discord·Notion 구현 |
| GET | `/api/v1/integrations/{provider}/callback` (**302**) | Discord·Notion 구현. workspace 경로가 아님 |
| DELETE | `/api/v1/workspaces/{workspace_id}/integrations/{provider}` | ⚠️ 204, 본문 없음 |

초기 기록에서는 start·callback이 없어 연결을 MSW로만 진행했다. 현재 FE는 production에서 start 주소로 이동하고 복귀 뒤 연결 상태를 다시 조회한다. 개발·MSW 모드는 모의 OAuth 경로를 사용한다. 이 코드 연결을 실제 공급사 인증 성공으로 해석하지 않는다.

```jsonc
{"discord": {"status": "connected", "display_name": "카테캠 3팀 서버",
             "connected_at": "2026-09-15T05:00:00Z"},
 "notion":  {"status": "not_connected", "display_name": null, "connected_at": null}}
```

- FE의 `status`는 `not_connected`, `connecting`, `connected`, `revoked`를 구분한다. Notion은 DB 연결 준비와 토큰 상태에 따라 네 상태를 반환하고 Discord는 현재 조회에서 연결 행 유무로 connected·not_connected를 반환한다.
  **`not_connected` 와 `revoked` 를 구분해 달라.** 미연결은 `Notion 연결이 필요해요`(D-097), 끊김은 `Notion 연결이 끊어졌어요`(D-100) 로 다른 모달을 띄운다.
  **2026-11-07(#507):** 두 모달을 없앴다. 프론트엔드는 이 값을 설정 카드 표시에만 쓴다 (D-182).
  초기 구현은 연결 행의 존재 여부만 봤다. 현재 Notion의 `_notion_status`는 토큰·DB 식별자·준비 시간을 읽어 connecting·revoked도 반환한다. 연결 상태 조회와 재시도는 [현재 API 소비 코드](../../src/entities/integration/api/integrations.ts)에 있다.
- `display_name` 이 `"Discord 연결됨"` 같은 **생성 문자열**이다 (§4.0-②-7). 화면에 그대로 쓸 수 없다.
  연동 카드는 provider 이름을 프론트엔드가 쓰고, `display_name` 은 실제 값이 올 때까지 표시하지 않는다.
- 연결 요청은 본문 없는 페이지 이동이다. 현재 Notion start·callback과 연결 뒤 DB 준비 경로가 있다. FE는 데이터베이스 선택 화면을 만들지 않고(D-154) 연결 상태를 조회한다.
- 복귀 주소의 결과 이름 `oauth`, `oauth_result`는 카카오 로그인(§4.1.4)도 같다. 그쪽에만 `oauth_reason`이 더 있고, 연동 화면은 이 값을 읽지 않는다. [복귀 주소 코드](../../src/shared/lib/oauth/returnParams.ts)가 한 곳에서 다룬다.

#### 4.3.1 회의 채팅 채널 (#428·#429, 2026-11-07)

- **합의된 규약.** [#428](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/428) 댓글의 BE 설계 확정과 구현(PR #432, 2026-11-06 develop 병합)에 따른다. PM 이 설정에서 디스코드 서버의 텍스트 채널 하나를 고르면 매일 09:00(KST)에 그 채널 대화를 읽어 task 제안을 만든다. 채널은 워크스페이스마다 하나이고 별도 봇 초대는 없다. FE 위치(설정 연결 탭의 Discord 항목 아래, PM 만)와 저장 전 안내 문구는 [#429](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/429) 의 FE 진행 기본값 댓글(2026-11-07)을 따른다. 그 댓글은 이견이 있으면 이슈에 남기라고 했으므로 PM·디자인의 최종 확인은 **합의 여부 확인 필요**로 둔다.

| Method | Path | 권한 | 응답 `data` |
|---|---|---|---|
| GET | `/api/v1/workspaces/{workspace_id}/integrations` | 소속 팀원 | `discord.chat_channel: {channel_id, name} \| null` 이 더해졌다. `notion` 에는 없다 |
| GET | `/api/v1/workspaces/{workspace_id}/discord/channels` | PM | `{items: [{channel_id, name}], total}`. 일반 텍스트 채널(type 0)만이다 |
| PUT | `/api/v1/workspaces/{workspace_id}/integrations/discord/chat-channel` | PM | 요청 `{channel_id}`, 응답 `{channel_id, name}` |
| DELETE | `/api/v1/workspaces/{workspace_id}/integrations/discord/chat-channel` | PM | 200 `{off_notice_sent: boolean}`. 이미 꺼져 있거나 연결이 없어도 200 이다 |

- **저장 순서와 실패.** 서버는 연결 행을 잠그고 (1) 연결한 서버의 텍스트 채널인지 (2) 봇이 읽을 수 있는지(`GET /channels/{id}/messages?limit=1`) (3) 켬 공지를 보낼 수 있는지를 거친 뒤에만 저장한다. 하나라도 실패하면 저장하지 않는다. 같은 채널을 다시 저장하면 Discord 를 부르지 않고 성공한다. 채널 이름은 저장 시점 값이다.
- **오류.** `channel_id` 가 숫자 1~20자가 아니면 400 `INVALID_REQUEST`. 연결이 없으면 409 `INTEGRATION_NOT_CONNECTED`(`details.provider`). 서버의 텍스트 채널이 아니면 404 `DISCORD_CHANNEL_NOT_FOUND`(`details.channel_id`). 봇이 읽거나 보낼 수 없으면 409 `DISCORD_CHANNEL_NOT_ACCESSIBLE`(`details.need` 가 `read` 또는 `send`, `channel_id`, `discord_code`). Discord 장애·봇 토큰 없음은 502 `DISCORD_API_FAILED`. 목록에 보이는 채널도 비공개면 저장이 실패할 수 있다.
- **해제.** 채널을 바꾸거나 끄거나 Discord 연결을 해제하면 서버가 옛 채널에 끔 공지를 시도한다. 공지 실패는 끄기를 되돌리지 않고 `off_notice_sent: false` 로만 알린다. `DELETE /integrations/discord`(§4.3)도 채팅 채널을 함께 지운다. 다른 서버로 다시 연결하면 공지 없이 채널 값만 비운다.
- **현재 서버 구현.** [api/integrations.py](../../../backend/app/api/integrations.py)의 `get_integrations`·`list_discord_channels`·`set_discord_chat_channel`·`clear_discord_chat_channel`·`delete_integration`, [services/chat_channel.py](../../../backend/app/services/chat_channel.py), [schemas/integration.py](../../../backend/app/schemas/integration.py), [core/errors.py](../../../backend/app/core/errors.py)다.
- **현재 프론트 구현(#429).** DTO [integration.ts](../../src/shared/types/api/integration.ts), 엔티티 [연동 API](../../src/entities/integration/api/integrations.ts)가 조회·목록·저장·해제를 맡고 매퍼가 `discord.chatChannel` 로 바꾼다. 설정 연결 탭의 Discord 카드 아래 `회의 채팅 채널` 칸은 PM 에게만 보이고, Discord 가 연결돼 있지 않으면 비활성이며 목록을 부르지 않는다. 채널을 고르면 저장 전에 칸 아래 안내를 보이고 `저장` 으로 PUT, `사용 안 함` 저장은 DELETE 다. 쓰기는 세션 범위(`captureSessionScope`)를 잡아 세션이 바뀐 뒤 보내지 않는다. 오류 코드별 문구는 기능 안의 문구 표가 정하고, `need=read`·`need=send` 는 채널 권한에서 고칠 방법을 알린다. `DISCORD_CHANNEL_NOT_FOUND` 면 채널 목록을 다시 받는다. Discord 연결 해제 확인 창은 채팅 채널이 있을 때 함께 꺼진다고 알린다. 선택 칸은 공용 선택 상자(`shared/ui/select`, #471)다.
- **모의 서버(MSW).** [integration handler](../../src/shared/mock/handlers/integration.ts)가 위 세 경로와 오류를 BE 모양으로 흉내낸다. 모의 채널마다 접근 상태(`ok`·`no_read`·`no_send`)를 두어 409 `need` 두 경우를 재현한다.
- **검증 한계.** 실제 Discord 서버와 BE 를 붙인 저장·공지는 확인하지 않았다. FE 확인은 MSW 기준이다.

### 4.4 meetings 웹 경로

봇 경로(§2.3)와 같은 리소스를 쓴다. `source` 로만 구분한다 (D-157).

| Method | Path | 비고 |
|---|---|---|
| GET | `/api/v1/workspaces/{workspace_id}/meetings` | 회의록 목록 |
| POST | `/api/v1/workspaces/{workspace_id}/meetings/upload` | **multipart**, 202 |
| GET | `/api/v1/meetings/{meeting_id}/minutes` | 회의록 본문 |

```jsonc
// GET .../meetings — started_at 내림차순, 일반 실패 제외·수동 업로드 화자 지정 만료 이력 유지 (D-093 개정, D-106)
{"items": [{"meeting_id": "mt_09", "title": "3주차 정기회의",
            "started_at": "2026-09-15T14:00:00Z", "source": "discord",
            "status": "done", "duration_ms": 2730000,
            "attendee_count": 5, "processed_at": "2026-09-15T06:12:00Z", "failed_stage": null}],
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
- 409 `INTEGRATION_NOT_CONNECTED` — Notion 미연결 (D-096, D-097). → ❌ 검사가 없다. **2026-11-07(#507):** 요청 철회. 업로드는 Notion 을 요구하지 않는다 (D-182)
- 413 `AUDIO_TOO_LARGE`는 서버가 파일 크기와 `UPLOAD_MAX_BYTES` 설정을 비교해 반환한다. `details`는 `{size_bytes,max_bytes}`다. 형식은 파일 확장자·내용 검사로 검증하고 지원하지 않으면 `AUDIO_FORMAT_UNSUPPORTED`다.
- `attendee_member_ids`는 반복 multipart 필드를 `list[str]`로 받는다. 중복을 제거하고 같은 공간의 활성 팀원인지 검사한 뒤 `MeetingUpload.attendees`에 ID·표시 이름을 저장한다. FE는 1명 이상을 선택하게 한다. 이번 문서 작업은 빈 목록의 별도 HTTP 요청을 실행하지 않았다.
- 업로드 의존성은 `get_current_pm`이다. 초기 일반 팀원 허용 상태(§4.0-②-17)와 달리 현재는 PM 권한을 요구한다.
- 업로드는 파일과 `processing` 회의·업로드 정보를 저장한다. [AI 가져오기](../../../ai/upload/intake.py)·[워커](../../../ai/capture/worker.py)·[BE sweeper](../../../backend/app/services/upload_sweeper.py)가 후속 처리와 멈춘 작업을 다룬다. 초기 무저장·영구 processing 설명은 현재 구현에 해당하지 않는다. 외부 공급사까지 포함한 전체 성공을 이번 정적 대조로 선언하지 않는다.
- `source` 가 `"manual_upload"` 로 고정된다. `MeetingSource` = `discord` \| `manual_upload` \| `chat`이다 (D-157). `chat`은 디스코드 채팅 자동 수집이 만들고(구현됨, BE 담당 리뷰 대기) 웹 업로드는 계속 `manual_upload`다. `chat` 회의가 `processing`이어도 업로드는 막히지 않는다.
- FE 구현(#450, 2026-11-07): 업로드 진입 판정과 응답을 잃은 업로드의 복구도 `processing` 인 `chat` 회의를 세지 않는다. 채팅 회의만 정리 중이면 업로드 화면에 머물고, 응답을 잃으면 채팅 회의를 방금 올린 회의로 보지 않는다. 정리 중 토스트는 채팅 회의도 그대로 따라간다. 구현: [업로드를 막는 회의](../../src/entities/meeting/lib/uploadBlockingMeeting.ts), [진입 판정](../../src/features/meeting-upload/model/useUploadEntry.ts), [업로드](../../src/features/meeting-upload/model/useMeetingUpload.ts). MSW 기준 검증이며 실서버는 미검증이다.
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
- `transcript`는 해당 회의의 Source를 seq 순서로 읽어 시각·화자·문장을 구성한다. Source가 없으면 빈 배열이다. 초기 하드코딩 상태는 §4.0-②-11의 과거 기록이다.
  `extraction` 이 없으면 빈 배열이다. 필드 **이름과 형태는 계약대로**이므로 mapper 는 그대로 쓸 수 있고, 값만 비어 있다.
- `attendees`는 같은 Source에서 `member_id`가 있는 팀원을 처음 발화한 순서로 중복 제거해 구성한다. 말하지 않았거나 팀원에 연결되지 않은 참석자는 포함하지 않는다. 업로드 때 선택한 전체 참석자 목록을 그대로 반환하는 것은 아니다.
- `summary`는 최신 Extraction.summary JSON을 읽고 유효한 객체일 때 반환한다. 값이 없거나 잘못된 JSON·객체가 아닌 값이면 null이다. 생성 파이프라인의 실제 저장 성공 여부는 별도 검증한다.
- 비소속 사용자는 403 `FORBIDDEN` 이다. `MEETING_NOT_FOUND` 가 아니라 존재는 드러난다.

#### 4.4.1 수동 업로드 실패 사유와 만료 이력 (#256, 2026-11-04)

- 제공자는 BE, 소비자는 FE 회의 목록·상세·처리 추적기다. 경로는 기존 목록과 상세를 사용한다.
- 목록 항목에 `failed_stage: string | null`을 추가한다. 상세의 기존 필드는 유지한다. 구버전 BE 목록이 이 필드를 생략하면 FE는 `null`로 읽는다.
- `failed_stage`는 자유 문자열이다. 알려진 값만 아래와 같이 구분하고, 알 수 없는 값과 `null`에는 기존 일반 실패·Notion 연결 재조회 처리를 적용한다.

| 알려진 값 | 의미와 FE 안내 |
|---|---|
| `diarize` | 음성 화자 분리 단계 실패. 음성 처리를 완료하지 못했다는 안내와 재업로드 안내를 표시한다. 이 값만으로 3시간 초과라고 단정하지 않는다. |
| `speaker_assignment_expired` | 화자 지정 대기가 7일을 넘어 종료됐다. 사유와 원본 파일 재업로드 안내를 표시한다. |
| `chat_stalled` | 채팅 회의가 `/end` 뒤 7시간 넘게 `processing` 이라 BE sweeper 가 실패로 바꿨다([BE·AI 계약](../../../backend/docs/contracts/backend-ai-contract.md) 「회의」). 재업로드를 권하지 않고 「채팅 대화를 정리하다 멈췄어요. 다음 수집 때 다시 정리해요.」를 표시한다. 다음 수집 시각은 계약에 없어 말하지 않는다. Notion 끊김 재조회를 하지 않는다. FE 구현(#450, 2026-11-07). 문구는 [이슈 댓글](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/450#issuecomment-6690118831)의 감독 기본값이며 사용자 확인 전이다. |
| `upload_unclaimed` | AI 가 업로드를 24시간 동안 가져가지 않아 BE sweeper 가 실패로 바꿨다(#563, BE 구현 2026-11-08). 녹음은 지워졌다. PM 이 다시 올려야 하므로 BE 목록은 이 회의를 남긴다. FE 는 아직 이 값을 따로 구분하지 않아 일반 실패 안내(D-092)로 보이고, 목록 필터(`minutesList.ts`)도 아직 `speaker_assignment_expired` 만 남긴다. |

- 목록은 `source=manual_upload`, `status=failed`이고 `failed_stage`가 `speaker_assignment_expired` 또는 `upload_unclaimed`(BE 구현 2026-11-08, #563)인 회의를 보존한다. 나머지 실패 회의는 기존처럼 제외한다. 상세는 `GET /meetings/{meeting_id}`로 읽으며 만료된 회의의 회의록·추출은 조회하지 않는다. 멤버십 제한은 유지한다.
- FE 합의 근거는 [이슈 결정 댓글](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/256#issuecomment-6609243822)과 D-091~D-093의 2026-11-04 보완이다. BE 목록 변경은 이 작업의 구현 제안이며 파트 간 리뷰·합의와 실서버 배포 확인은 별도다.
- 현재 구현 근거: [BE 목록](../../../backend/app/api/workspaces.py), [FE DTO](../../src/shared/types/api/meeting.ts), [매퍼](../../src/entities/meeting/model/mapper.ts), [실패 안내](../../src/entities/meeting/lib/meetingFailure.ts), [목록 구분](../../src/entities/meeting/lib/minutesList.ts), [추적기](../../src/features/meeting-processing/model/useProcessingTracker.ts).
- 자동 실패 전환은 미병합 [BE PR #301](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/301)의 동작이다. 이 작업은 sweeper나 화자 지정 기능을 구현하지 않는다.
- 예정 계약: [BE 알림 댓글](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/256#issuecomment-6604969982)에 따라 지정 제출 직후 만료되면 `409 MEETING_NOT_AWAITING_SPEAKERS`, `details.status=failed`가 온다. FE는 상세를 다시 조회해 실제 사유를 안내하고 재제출을 막는 방향이다. 2026-11-05 화자 지정 화면에 연결했다(§2.3.1 「FE 구현」의 제출 오류, MSW 기준). 모든 409를 만료로 해석하지 않는다.


### 4.5 Discord 서버 사용자 목록

초기에는 고정 사용자 두 명을 반환했다. 현재는 연결된 Discord 서버의 실제 사용자 목록 조회 코드가 있으며 FE 팀원 연결 화면이 소비한다(2026-11-09 소스 대조).

| Method | Path | 구현 |
|---|---|---|
| GET | `/api/v1/workspaces/{workspace_id}/discord/members` | 연동·봇 토큰 확인 후 Discord 목록 조회 |

```jsonc
{"items": [{"discord_user_id": "1123...",
            "username": "seoyeon_01",
            "display_name": "서연",        // Discord 서버 별명, 없으면 null
            "avatar_url": "https://cdn.discordapp.com/...",
            "is_bot": false}],
 "total": 7}
```

- 연결된 Discord 서버의 현재 사용자 목록이다. 봇은 `is_bot: true` 로 표시해 프론트엔드가 거른다.
  서버의 `discord.list_guild_members`가 외부 목록을 조회한다. 봇 토큰 누락·공급사 오류는 `DISCORD_API_FAILED`로 안내한다. 실제 토큰·봇 권한과 서버 응답은 이번 문서 작업에서 확인하지 않았다.
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

아래 표는 초기 요청과 PR #59 당시 반영 상태를 보존한 기록이다. 전사 하드코딩·요약 읽기 등 후속 구현은 문서 앞 「후속 구현 상태 대조」와 §5.5가 우선한다.

**6건 중 3건이 반영됐다** (PR #59). 1 · 2 · 6 이 끝났고 4 는 절반, 3 · 5 는 그대로다.

| # | 대상 | 요청 | 상태 | 이유 |
|---|---|---|---|---|
| 1 | `GET /meetings/{id}` | `audio_merged` · `transcribed` · `extracted` 를 다시 내려 달라 | ✅ **반영.** `MeetingProgress` 로 **필수** 필드다 | 모델에는 있는데 API 에 없었다. `status` 만으로는 진행률 UI 를 그릴 수 없다 (D-094) |
| 2 | `meeting.started_at` | 업로드 요청의 사용자 지정 날짜를 그대로 저장 | ✅ **반영.** `started_at or now` | 지난 녹음을 나중에 올리면 회의 날짜가 업로드 날짜가 된다. 목록 정렬이 깨진다 (D-079, D-106, D-164) |
| 3 | `meeting.failed_stage` | Notion 연결 끊김을 구분할 수 있는 값 포함 | ❌ 자유 문자열 그대로. 봇이 `"STT"` · `"LLM"` 같은 값을 보낸다. **2026-11-07(#507): 철회** — 서버에 Notion 때문에 정리가 실패하는 경로가 없다 | 차단 모달(D-100)과 오류 토스트(D-092)로 화면이 갈린다. 지금은 일반 실패 안내 하나다 (D-182) |
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
| 1 | Notion 반영 여부 | ~~`task.notion_page_id` 가 `null` 이 아니면 반영 완료로 본다~~ 2026-10-11: 서버 `notion_sync_status` 가 `synced` 일 때만 반영 완료로 본다 (상단 「M6 태스크·승인 처리 경계」) | ~~다른 판단 근거가 스키마에 없다~~ 서버에 `notion_sync_status` 가 생겼다 |
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
**2026-11-07(#507):** MSW 업로드 handler 도 Notion 상태로 409 를 내지 않는다. 세 코드 모두 `server.use()` override 로만 만든다.

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
| 로그인 | `POST /auth/login` | **구현됨** §4.1 — 429 시도 제한 §4.1.3(BE PR #456 병합) |
| 회원가입 | `POST /auth/signup` | **구현됨** §4.1 — 201, 이름 규칙 §4.1.2, 이메일 인증 §4.1.4 |
| 비밀번호 재설정 요청·변경 | `POST /auth/password-reset/request` · `verify` · `confirm` | **구현됨** §4.1.1 — BE PR #398 병합. BE 가 2026-11-08 운영 서버에서 메일 수신까지 확인 |
| 카카오 로그인 | `GET /auth/kakao/start`로 페이지 이동, callback 뒤 필요하면 pending 조회 | FE·BE 구현 §4.1.4. Google 버튼은 제거. 실제 카카오 설정·인증 성공은 별도 |
| 앱 부팅 | `GET /auth/me` | **구현됨** §4.1 |

- 랜딩은 데모 기능을 넣지 않으므로 호출이 없다 (D-002).
- 로그인 응답의 `workspace_count` 로 이동을 분기한다. `0` 이면 온보딩, `1` 이면 대시보드, `2` 이상이면 선택 화면 (D-010).

### 5.2 워크스페이스 선택 · 온보딩

| 화면 | 호출 | 상태 |
|---|---|---|
| 워크스페이스 선택 | `GET /workspaces` | **구현됨** §4.2 — 사용자 스코프·`role`·`onboarding` 다 온다 |
| 워크스페이스 만들기 | `POST /workspaces` `{name}` | **구현됨** §2.1 |
| 온보딩 진행 상태 | `GET /workspaces/{id}`의 `onboarding` | 단계별 저장 상태 조회 구현 §4.2 |
| 단계 건너뛰기·완료 | `PATCH /workspaces/{id}/onboarding` | PM 권한으로 저장 후 상세 재조회. 생성 단계 skip은 400 §4.2 |
| 내 초대·수락·거절 | `GET /invitations/me`, `POST /invitations/{id}/accept`·`decline` | FE·BE 구현. 소비 코드와 미검증 범위는 §5.9 |

- 생성은 이름 하나만 보낸다. **이미 그렇게 구현돼 있다** (D-014, D-153).
- 미완료 워크스페이스는 목록에서 표시를 달리하고 대시보드 접근을 막는다 (D-070, D-071).

### 5.3 Discord · Notion · 팀원 연결

| 화면 | 호출 | 상태 |
|---|---|---|
| 연결 상태 표시 | `GET /workspaces/{id}/integrations` | FE·BE 구현. Notion은 connecting·revoked도 구분 §4.3 |
| Discord·Notion 연결 | `GET .../integrations/{provider}/start?state=`로 페이지 이동 | FE·BE 구현 §4.3. 실 OAuth 성공은 별도 |
| 연결 해제 | `DELETE .../integrations/{provider}` | **구현됨** §4.3 — 204, 봉투 아님 |
| 팀원 연결 — 목록 | `GET /workspaces/{id}/discord/members` + `GET /members?workspace_id=` | Discord 외부 목록 조회·회원 목록 소비 구현. 실 봇 권한·공급사 호출은 별도 |
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

> **2026-10-17 정정 (M7 구현).** 이전 판은 최근 반영을 태스크 이력의 `is_rolled_back` 으로 판정하고 필드 이력 rollback 으로 되돌린다고 적었다. 현재 구현은 **추출 항목 되돌리기**(`reverted_at`, `POST /extractions/{id}/items/{id}/revert`)와 **태스크의 `notion_sync_status`** 로 판정한다. 필드 이력 rollback(§2.6)은 대시보드에서 쓰지 않는다. 또 `gate="auto"` 는 승인 없이 태스크를 만들었다는 뜻이지 **Notion 반영 완료가 아니다** — 반영 여부는 따로 표시한다.

**집계 API 없이 기존 API 로 조립한다** (§4.6). 서로 기다리지 않고 함께 시작하는 조회는 다섯이다. 일반 팀원은 2번을 부르지 않는다 (D-104, D-163).

```
1. GET /api/v1/tasks?workspace_id=                       태스크 전량
2. GET /api/v1/approvals?workspace_id=&status=pending    확인 필요 전량 (PM 만)
3. GET /api/v1/workspaces/{id}/meetings                  회의 목록
4. GET /api/v1/members?workspace_id=                     담당자 이름 조인용
5. GET /api/v1/workspaces/{id}/integrations              Notion 연결 (빈 상태 판정)
```

상단 요약 4개 (D-052~D-055). 네 숫자 모두 그 수만큼 보이는 태스크 목록으로 가는 링크다 (D-178, D-061 개정) — `확인 대기` `?tab=needs_review`, `기한 지남` `?tab=in_progress&due=overdue`, `7일 이내 마감` `?tab=in_progress&due=soon`, `막힌 일` `?tab=in_progress&due=blocked`. 숫자를 안 뒤에만 링크이며 0 도 링크다. 불러오는 중이거나 실패한 조회는 링크가 아니다. 실패한 조회의 숫자는 `0` 이 아니라 `–` 다.

| 숫자 | 계산 |
|---|---|
| 확인 대기 | 2번의 대기 항목 수 (PM 만) |
| 기한 지남 | 1번에서 `status !== "done" && due_date < 오늘` |
| 7일 이내 마감 | 1번에서 `status !== "done" && 오늘 <= due_date <= 오늘+6일` |
| 막힌 일 | 1번에서 `status === "blocked"` |

- 오늘은 서울 날짜다. 날짜 계산은 태스크 목록과 같은 [shared/lib/date](../../src/shared/lib/date/days.ts)를 쓴다. `기한 지남` 과 `7일 이내 마감` 은 겹치지 않는다 (D-054).

본문 세 영역:

| 영역 | 조립 |
|---|---|
| 확인이 필요한 일 (PM) | 2번을 대기 시작(`created_at`) **오름차순**으로 5개 (D-050, D-051). 이동은 `/approvals/{approval_id}` (D-162). 전부 보기는 태스크 `?tab=needs_review` |
| 마감 임박 | 1번에서 기한 지남 먼저, 그다음 마감 가까운 순으로 5개 (D-044, D-045). 넘치면 태스크 `?tab=in_progress&due=overdue,soon` (D-046) |
| 최근 반영 | 아래 |

`최근 반영` 은 시작 시각 기준 최신 완료 회의 1건이다 (D-038).

```
3번에서 status="done" 인 최신 회의 1건
  → GET /meetings/{meeting_id}          extraction_id 획득 (응답 workspace_id 가 지금 공간인지 확인)
  → GET /extractions/{extraction_id}    gate="auto" 항목 전부, 응답 순서 (D-038). 화면이 첫 화면 높이로 재서 3~8개를 보인다 (D-176)
  → 상태: reverted_at 이 있으면 `되돌림`, 아니면 1번에서 task_id 의 notion_sync_status
          (pending 반영 대기 · failed 반영 실패 · synced 반영 완료 · null 반영 상태 없음)
```

- 보이는 행보다 auto 항목이 많으면 목록 아래 `외 N건 · 회의록에서 보기` 가 그 회의의 회의록(`/meetings/{meeting_id}`)으로 간다. N 은 보이지 않는 auto 항목 수다 (D-176).
- 반영 대기 행이 있으면(보이지 않는 auto 항목 포함) 1번을 3초마다 다시 받는다. 모두 끝나거나 조회가 실패하거나 화면을 떠나면 멈춘다. 태스크 상세·이력을 행마다 부르지 않는다.
- 되돌리기는 PM 만, `POST /extractions/{extraction_id}/items/{item_id}/revert` 다. 성공한 행은 자리를 지키고 `되돌림` 과 새 확인 필요 링크(`approval_id`)를 보인다 (D-036, D-037). 거절 사유별 안내는 위 「M7 대시보드·항목 되돌리기 경계」.
- 빈 상태는 다음 순서로 판정한다 (D-040~D-042). 회의 업로드·Notion 설정 이동은 PM 에게만 보인다.

| 순서 | 원인 | 판정 | 이동 |
|---|---|---|---|
| 1 | `no_meeting` | 3번에 정리 끝난 회의가 없다 | 회의 업로드 |
| 2 | `notion_not_connected` | 5번의 notion 이 `connected` 가 아니다(연결 중·끊김 포함) | 설정 Notion 영역 |
| 3 | `no_applied_items` | 최신 회의에 `gate="auto"` 항목이 없다 | 최근 회의록 |

### 5.5 회의 업로드 · 정리 중 · 회의록

| 화면 | 호출 | 상태 |
|---|---|---|
| 회의 올리기 진입 가드 | `GET /workspaces/{id}/meetings` 로 정리 중 회의만 확인. Notion 연결은 보지 않는다 (D-182) | **구현됨** §4.4 |
| 참석자 선택 | `GET /members?workspace_id=` | **구현됨** §2.2 |
| 업로드 | `POST /workspaces/{id}/meetings/upload` (multipart) | **구현됨** — 파일·참석자 저장, 화자 지정은 §2.3.1 |
| 정리 중 — 폴링 | `GET /meetings/{meeting_id}` | **구현됨** §2.3 — `progress` 포함 |
| 화자 지정(`awaiting_speakers`) | `GET`·`PUT /meetings/{id}/speakers`, `GET /meetings/{id}/audio` | BE 구현됨, **FE 구현**(MSW 기준, 실서버 미검증) §2.3.1 |
| 회의록 목록 | `GET /workspaces/{id}/meetings` | **구현됨** §4.4 |
| 회의록 본문 | `GET /meetings/{meeting_id}/minutes` | 저장된 Source의 전사·참석자와 Extraction.summary 객체를 읽음. 유효 요약이 없으면 null |
| 회의록의 태스크 영역 | `GET /extractions/{extraction_id}` | **구현됨** §2.4 |

- ~~Notion 미연결이면 업로드 화면으로 보내지 않고 차단 모달을 띄운다 (D-097).~~ **2026-11-07(#507):** Notion 연결과 상관없이 업로드 화면을 연다 (D-182).
- 회의록 상세의 `반영된 태스크` 와 `확인이 필요한 일` 은 **`minutes` 가 아니라 `extractions` 에서 온다** (§2.4, §3.1).
  - `반영된 태스크` — `task_id` 가 있고, `approval_id` 가 없거나 `approval_status` 가 `approved` 인 항목. 수정 항목은 승인 전에도 `task_id` 가 있어 `task_id` 만으로는 고르지 않는다 (#419, §2.4).
  - `확인이 필요한 일` — **PM 전용이다.** 반영되지 않은 항목 중 `GET /approvals?workspace_id=&status=pending` 과 조인해
    그 목록에 있는 `approval_id` 만 고른다. 행에 승인의 빠진 값으로 만든 이유를 보이려고 조인을 유지한다 (§3.1, §4.0-②-12).
- 일반 팀원에게는 `approval_id` 가 있고 반영되지 않은 항목(대기·반려된 생성·수정)을 화면에서 제거한다. 개수도 노출하지 않는다 (D-104).
  `approval_status` 로 조인 없이 판정되며, D-163 대로 승인 목록을 부르지 않아도 된다.
- 정리 실패 시 사유를 안내한다. 화자 지정 만료는 해당 회의의 실패 상세로 이동하고 목록에 이력을 남긴다. 나머지 실패 회의는 목록에서 제외한다 (D-091~D-093 개정, §4.4.1).

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
- **보드는 `시작 전`·`진행 중`·`완료` 3컬럼이다** (D-175 가 D-169 를 개정). 컬럼별로 따로 부르지 않고 목록의 전량 조회를 그대로 공유한다.
  - 컬럼의 상태는 `시작 전` = `todo`, `진행 중` = `in_progress`·`blocked`, `완료` = `done` 이다.
  - 확인 필요는 컬럼이 아니라 보드 아래의 안내 줄로만 알린다. `approval` 은 `task_id` 가 없어 `PATCH /tasks` 의 대상이 아니다 (D-161).
  - ~~`확인 필요` 컬럼은 **읽기 전용**이다.~~ ~~`진행 중` → `완료` 는 `PATCH {status:"done"}`, `완료` → `진행 중` 은 `PATCH {status:"in_progress"}` 다.~~ D-169 의 컬럼 규칙이며 D-175 로 바뀌었다. 상태 변경은 낙관적 업데이트 대상이다 (D-137).
  - `blocked` 는 컬럼이 아니라 **카드 배지**다. 컬럼에서 사라지면 대시보드의 `막힌 일 N` 과 화면이 어긋난다 (D-056). 배지를 누르면 `blocker` 를 보여준다. 2026-11-03 기준으로 배지는 아직 구현되지 않았다 (D-175).
- **정렬 선택과 조회 범위** (D-175). 리스트와 보드의 정렬(`마감 빠른 순`·`최근 생성순`·`최근 변경순`)은 클라이언트에서만 한다. 서버 요청은 바뀌지 않는다. 1차에서는 전량 조회만 하고 페이지네이션과 검색은 없다.
- **간트의 기간은 `start_date` ~ `due_date` 다** (D-170). `start_date` 는 §4.7-6 으로 **반영됐다.** `null` 이면 `created_at` 의 날짜 부분으로 대체한다 (§4.8-5). 기존 태스크 행은 전부 `null` 이라 폴백이 여전히 주 경로다.

### 5.7 메시지

~~**1차에서 화면을 만들지 않는다** (D-171).~~ D-171 은 D-174 로 대체됐다(2026-11-03).

**현재 구현 (#315, 2026-11-04).** 프론트엔드는 아래 백엔드 메시지 API 를 production 을 포함한 모든 모드에서 부른다. `준비 중` 안내와 MSW 모드 분기는 지웠다([M8-C 결과](../plan/m8/result-c.md#2026-11-04-실제-메시지-api-연결-315)).

- 쓰는 경로: `GET /messages`, `GET /messages/threads/{thread_id}`, `PATCH /messages/bundles/{bundle_id}`(`body` 또는 `scheduled_at` 하나), `POST /messages/bundles/{bundle_id}/approve`(`{draft_version}`), `POST /messages/bundles/{bundle_id}/cancel`, `POST /messages/threads/{thread_id}/replies`, #519 에서 더한 `POST /messages/threads`(`{member_id}`), 그리고 #370 에서 더한 `POST /messages/reminders`, `PATCH /messages/reminders/{reminder_id}`(`note` 만), `POST /messages/reminders/{reminder_id}/cancel`. 리마인드의 시각만 옮기는 `PATCH …/reminders/{id}`(`scheduled_at`)는 부르지 않는다. 시각은 묶음 단위로 옮긴다.
- 응답 타입은 [message.ts](../../src/shared/types/api/message.ts)가 `schemas/message.py` 와 칸을 1:1 로 맞춘다. 매퍼는 목록을 `bundles` 가 `null` 인지로 PM·팀원 두 모양으로 나누고, 묶음의 화면 단계(승인 대기·승인함·초안 대기)를 `status`·`approved`·`draft_status` 에서 한 번 정한다. `scheduled` 가 아닌 묶음은 그리지 않는다.
- 보낼 시각은 마감 기준 시각과 `직접 정한 시각` 둘이고, 화면이 시각을 계산해 `scheduled_at` 으로 보낸다. 마감 기준 시각은 묶은 태스크 중 가장 이른 `due_date` 에 공간의 재촉 규칙(아래 **메시지·알림 설정** 의 `nudge_rule`)을 적용한 KST 시각이다. 카드 제목도 규칙을 따른다(`마감 당일`·`마감 하루 전`·`마감 2일 전`·`마감 3일 전`). 기본 규칙이면 전날 09:00 이다(#340, 2026-11-05). 재촉 규칙을 불러오는 중이거나 불러오지 못했을 때, 마감이 없거나 그 시각이 지났을 때는 이 카드를 고를 수 없다. 시안의 `지금 바로` 는 대응 경로가 없어 지웠다.
- 재촉 만들기와 태스크 빼기·메모 고치기(#370, 2026-11-05). 모두 PM 에게만 보인다. 팀원 화면에는 진입점이 없고 `?new=reminder` 주소도 무시한다.
  - 진입점은 둘이다. 태스크 상세의 `재촉` 영역은 그 태스크의 담당자에게 만든다. 메시지 화면의 `새 재촉`(`?new=reminder`)은 팀원과 그 팀원이 맡은 끝나지 않은 태스크를 고른다. 보낼 시각은 묶음과 같은 두 카드(마감 기준·직접 정하기)이고 메모는 선택이다. 빈 메모는 `null` 로 보낸다.
  - 서버는 담당자 여부와 Discord 연결을 보지 않는다(`services/messages.py` `create_reminder`). 화면은 담당자가 없는 태스크와 완료한 태스크에서 만들기를 막고 이유를 보인다(완료 태스크는 FE 기본값). Discord 가 연결되지 않은 팀원은 막지 않고, 보낼 때 DM 이 실패로 남는다고 알린다.
  - 만들면 응답의 `bundle` 로 간다. 메시지 화면은 그 묶음의 보내기 전 확인으로 주소를 바꿔 끼우고, 태스크 상세는 결과와 `메시지 화면에서 확인하기` 링크를 보인다. 알림 문구는 돌려받은 묶음으로 고른다. 승인돼 있으면 같은 재촉이 이미 있어 그대로 돌려받은 것이고, 태스크가 둘 이상이면 같은 시각의 메시지에 합쳐진 것이다.
  - 보내기 전 확인의 `묶은 태스크` 행마다 `메모 고치기`·`빼기` 가 있다. 빼기는 그 자리에서 확인을 받는다. 마지막 태스크면 `빼면 {이름}님에게 이 메시지를 보내지 않아요` 로 묻고, 응답 `bundle.status` 가 `cancelled` 면 보내지 않음처럼 그 항목을 떠난다. 나머지는 문구를 다시 만들고, 승인한 묶음이면 승인이 풀린다고 먼저 알린다. 메모는 바뀐 값만 저장할 수 있고(서버는 같은 메모면 아무것도 하지 않는다) 비우고 저장하면 `null` 로 지운다.
  - 만들기 실패 중 409 `REMINDER_SCHEDULED_AT_PASSED`, 404 `TASK_NOT_FOUND`·`MEMBER_NOT_FOUND` 는 다시 시도 없이 이유를 보인다([createMessages.ts](../../src/features/reminder-create/lib/createMessages.ts)). 빼기·메모의 404 `REMINDER_NOT_FOUND` 는 아래 표의 `이미 처리된 메시지예요` 와 같다.
- 오류 코드 처리는 한 표([actionMessages.ts](../../src/features/message-action/lib/actionMessages.ts)의 `KNOWN_FAILURES`)에 있다.

| 코드 | 화면 | 다음 |
|---|---|---|
| 409 `BUNDLE_CHANGED` | 행동 자리에 `보낼 메시지가 바뀌었어요. 다시 확인해 주세요.` | 메시지 캐시를 다시 받는다. 다시 시도는 없다 |
| 409 `REMINDER_SCHEDULED_AT_PASSED` | 승인이면 `예정 시각이 지났어요` 와 승인 잠금 | 그 묶음의 시각 저장이 성공할 때까지 승인을 잠근다 |
| 409 `REMINDER_NOT_EDITABLE`, 404 `REMINDER_BUNDLE_NOT_FOUND`·`REMINDER_NOT_FOUND` | 토스트 `이미 처리된 메시지예요. 목록을 다시 불러올게요.` | 메시지 캐시를 다시 받는다 |
| 대화 조회 403·404 | `대화를 찾을 수 없어요` | 다시 시도 없음 |
| 그 밖 | 행동 자리에 오류 문구와 `다시 시도` | 같은 요청을 다시 보낸다 |

- 화면 표시: `draft_status` 가 `needed`·`claimed` 면 `문구 다듬는 중`, `body` 는 줄바꿈 그대로(`whitespace-pre-line`), `body_source` 는 미리보기 밑단의 작은 글자(`직접 고친 문구`·`AI 초안`·`기본 문구`)다. 봇 메시지 `dm_status: failed` 는 말풍선 아래 `DM 못 보냄 · {이유}`(`dm_blocked` 서버 DM 이 막혀 있어요, `discord_not_linked` Discord 계정이 연결되지 않았어요, `unknown` 이유를 알 수 없어요), 목록 행의 `dm_failed` 는 `DM 못 보냄` 표시다. 팀원 메시지 `reply_channel: web` 은 `웹에서 답장` 을 붙인다.
- 대화 화면은 메시지와(PM 에게만) 예정 묶음을 나갈 시각 순으로 섞는다. 취소·만료된 재촉 줄은 응답에 없어 그리지 않는다.
- 팀원 화면: 자기 대화를 보고 웹 답장을 쓴다. 답장 칸 아래에 봇 DM 창에 쓴 글은 전달되지 않는다는 안내를 보인다(#515). 문구는 #525 에서 바꿨다(아래 **PM·팀원 메시지** 의 프론트엔드 연결).
- 대화 주인 판정(#367, 2026-11-05): 화면은 워크스페이스 응답의 `member_id`(§4.2.1)를 대화의 `member_id` 와 비교한다. 같으면 PM 이어도 자기 대화라 답장 칸을 보인다. BE 답장 API 는 대화 주인과 PM 의 글을 201 로 받는다. 일반 팀원이 남의 대화에 쓰면 403 이다([api/messages.py](../../../backend/app/api/messages.py)의 답장 경로). ~~PM 이 남의 대화를 열면 지금처럼 답장 칸 대신 안내 바를 보인다. 워크스페이스 응답에 `member_id` 가 없거나 `null` 이면 PM 에게는 답장 칸을 숨긴다.~~ #519(2026-11-09)부터 PM 은 남의 대화에도 입력칸을 본다. `member_id` 가 없거나 `null` 이면 PM 에게는 모든 대화가 남의 대화이고 입력칸이 있다. 서버가 쓴 사람으로 `pm`·`member` 를 정한다. 팀원은 자기 대화만 받으므로 이 값과 상관없이 답장 칸을 보인다.
- PM 자기 대화의 표시(#417, 2026-11-07): 위 판정으로 PM 의 자기 대화로 가려진 대화는 메시지 목록 맨 위의 별도 구역 `내 리마인드`(이름은 사용자 결정, 2026-11-07)에 두고, 그 아래 `보내기 전 확인`·`대화` 는 그대로다. `대화` 목록과 `답장 기다리는 중 N` 에서는 뺀다. 상세는 팀원 화면 규칙이다. 봇 말풍선이 왼쪽, 자기 답장이 오른쪽이고, 답장 기다림 배지·목록 점·`여기서부터 답장이 없습니다` 가 없으며, #411 기기 알림 띠를 보인다. 예정 묶음과 `확인하기`, 답장의 태스크 고르기 같은 PM 권한 기능은 그대로다. 워크스페이스 응답에 `member_id` 가 없거나 `null` 이면 구역을 만들지 않고 전처럼 `대화` 에 PM 화면 규칙으로 둔다. 표시 규칙은 (역할, 대화 주인)으로 고르는 표 하나([viewer.ts](../../src/widgets/message-inbox/model/viewer.ts)의 `threadPolicy`)가 정하고 답장 칸도 그 표의 값이다. 새 경로·필드는 없다. **FE 화면 규칙이며 BE 합의가 필요한 변경은 없다.**
- 다시 받기(#371, 2026-11-06, D-136): 화면 재진입·탭 복귀·행동 성공 뒤 다시 받기는 그대로다. 받은 `GET /messages` 나 `GET /messages/threads/{thread_id}` 응답에 `draft_status` 가 `needed`·`claimed` 인 묶음이 있으면 그 조회만 10초마다 다시 부르고, 없으면 멈춘다. 탭이 백그라운드면 부르지 않는다. 알림 목록(30초 polling)에 메시지 알림(`reminder_sent`·`nudge_suggested`·`nudge_reapprove`·`reminder_auto_cancelled`)이 새로 들어오면 그 공간의 메시지 조회를 다시 부른다. 알림 목록은 `limit=50` 으로 부르고, 꽉 찬 목록이 지난 목록과 하나도 겹치지 않으면 놓친 알림이 있을 수 있어 메시지 조회를 한 번 다시 부른다. 메시지 조회는 시작한 세션이 끝나면 보내지 않는다. 새 경로·필드는 없고 BE 가 받는 요청 수만 는다. 구현: [messageQueries.ts](../../src/entities/message/api/messageQueries.ts), [알림 종류](../../src/entities/notification/model/display.ts).
- 재촉 이유·근거·목록 요약(#394, 2026-11-08). BE 가 #418 에서 묶음 응답에 `summary` 와 리마인드마다 `reason`·`evidence` 를 더했다(아래 묶음 응답 줄). 화면 규칙은 사용자 결정(#394, 2026-11-05·2026-11-08)이다.
  - 보내기 전 확인의 `묶은 태스크` 행마다 제목·마감·메모 아래에 그 리마인드의 `reason` 문장과 근거 링크를 둔다. `reason` 이 `null`(태스크가 지워진 리마인드)이면 그 행에 이유 줄이 없고, `evidence` 가 `null`(소식 없음)이면 문장만 보인다. 문장은 BE 가 준 그대로 쓴다.
  - 근거 링크는 앱 안 링크다. `evidence.kind` 가 `reply` 면 `답장 보기` 로 묶음의 `thread_id` 대화를 열고 `evidence.message_id` 메시지가 보이게 스크롤한다(대화 주소의 `?message=`). `task_change` 면 `변경 보기` 로 리마인드의 `task_id` 태스크 상세를 연다.
  - 목록의 `보내기 전 확인` 행은 `summary` 를 보인다. `summary` 가 없는 #418 이전 응답이면 예전처럼 태스크 제목(`API 명세서`, `퍼블리싱 외 1건`)이다. `reason`·`evidence` 가 없는 응답은 `null` 로 읽는다.
  - 구현: [message.ts](../../src/shared/types/api/message.ts), [mapper.ts](../../src/entities/message/model/mapper.ts), [ReviewTasks.tsx](../../src/widgets/message-inbox/ui/ReviewTasks.tsx). 새 경로·요청은 없고 BE 와 합의한 응답 칸만 읽는다(#394 BE 댓글 「BE 구현 (PR #418)」).
- 화면에서 뺀 것은 [결정 기록](../plan/m8/basis-for-decision/2026-11-04-messages-real-api-drop-unbacked-ui.md)에 있다: 답장의 태스크 판정, `지금 바로`, 채널 대화, 팀 역할, Discord 대화 주소, ~~재촉 이유 문장·근거 링크·요약~~(#394 에서 되살림), 취소·만료 재촉 줄, 승인자 이름.
- 검증: MSW 기준 단위·화면 테스트와 브라우저 확인만 했다. 실제 서버(배포 BE)에 붙인 확인은 하지 않았다.

**백엔드 메시지 API** (#310 에서 BE 구현, #315 에서 프론트엔드 연결). 결정 근거는 [결정 0034](../../../ai/docs/basis_for_decision/ai/2026-11-04-0034-reminder-and-thread-message.md). 봇·AI 쪽 경로는 [backend-ai 계약](../../../backend/docs/contracts/backend-ai-contract.md)의 「리마인드 DM」에 있다. 경로 prefix 는 `/api/v1/workspaces/{workspace_id}/messages` 다.

| 요청 | 누가 | 하는 일 |
|---|---|---|
| `GET /messages` | 소속 팀원 | 대화 목록. PM 은 모든 대화와 예정인 보낼 메시지(`bundles`), 팀원은 자기 대화만(`bundles: null`) |
| `GET /messages/threads/{thread_id}` | PM, 대화 주인 | 대화 하나의 메시지(시각 순). PM 에게만 그 대화의 예정 `bundles` 를 싣는다. 남의 대화는 403 |
| `POST /messages/reminders` → 201 | PM | 재촉 만들기 `{member_id, task_id, scheduled_at, note?}`. `{reminder, bundle}` 을 돌려준다 |
| `PATCH /messages/reminders/{reminder_id}` | PM | 태스크 메모·시각 고치기 `{note?, scheduled_at?}`. `{reminder, bundle}` |
| `POST /messages/reminders/{reminder_id}/cancel` | PM | 이 태스크만 빼기. `{reminder, bundle}` |
| `PATCH /messages/bundles/{bundle_id}` | PM | 보낼 문구·시각 고치기 `{body?, scheduled_at?}` |
| `POST /messages/bundles/{bundle_id}/approve` | PM | 승인 `{draft_version}`. 화면에 보이는 묶음의 `draft_version` 을 보낸다(없으면 400). 이미 승인했으면 판과 상관없이 그대로 200 |
| `POST /messages/bundles/{bundle_id}/cancel` | PM | 보내지 않음(안의 리마인드 모두 취소) |
| `POST /messages/threads` | PM, 자기 대화를 여는 팀원 | 대화 열기 `{member_id}`. 있으면 그 대화, 없으면 만들어 대화 목록 한 줄을 돌려준다 |
| `POST /messages/threads/{thread_id}/replies` → 201 | PM, 대화 주인 | 글 쓰기 `{body}`. 대화 주인의 글은 디스코드로 보내지 않고, PM 이 남의 대화에 쓴 글은 바로 봇 DM 으로 나간다 |

**읽지 않은 수와 PM 글 통합의 현재 BE 구현** (#480, #518, 2026-11-08). 아래는 코드와 API 테스트로 확인한 사실이며 FE 연결·합의 완료를 뜻하지 않는다.

- 대화 요약 `unread_count`는 목록·상세·대화 열기 응답에 들어간다. `GET /messages/unread-count`는 내게 보이는 대화 전체의 `{unread_count}`를 반환한다.
- 자기 대화는 `sender=bot`과 `sender=pm`을 상대편 메시지로 센다. 남의 대화를 보는 PM은 `sender=member`만 센다. 내가 쓴 글은 내 읽지 않은 수를 늘리지 않는다.
- 대화 주인이 나중에 답장하면 앞선 봇·PM 글은 읽은 것으로 간주한다. `POST /messages/threads/{thread_id}/read`는 도착 시각 기준 가장 늦은 메시지까지 읽음 처리하고 `{thread_id, unread_count: 0, total_unread_count, last_read_at}`를 반환한다. 조회만으로는 읽음 처리하지 않는다.
- 기존 읽음 위치 또는 팀원 가입 시각 뒤 도착한 메시지만 센다. 권한·탈퇴 처리 등은 현재 BE의 읽음 API를 따른다. FE의 호출 시점과 배지 표시는 후속 연결 범위다.

- 리마인드(`reminder`)는 태스크 하나 × 받는 사람 한 명이다. 같은 받는 사람·같은 발송 시각의 리마인드는 보낼 메시지(`bundle`) 하나로 모인다. PM 이 보고 고치고 승인하는 단위는 묶음이고, 승인된 묶음 문구는 대화에 그대로 저장된다. 봇 DM 에는 이 문구 대신 워크스페이스 이름, 답장을 기다리는 리마인드 수, 대화 링크를 담은 안내가 나간다(#515).
- 상태는 둘 다 `scheduled`(예정)·`sent`(발송됨)·`cancelled`(취소됨)·`expired`(만료됨)이다. 승인 여부는 묶음의 `approved`(boolean)로 따로 준다. 승인 전과 승인 뒤 예정이 모두 `scheduled` 다.
- 묶음 응답은 `{bundle_id, thread_id, member_id, recipient_name, scheduled_at, status, approved, approved_at, body, body_source, draft_status, draft_version, summary, reminders[]}` 이고, `reminders[]` 는 `{reminder_id, bundle_id, task_id, task_title, due_date, note, status, kind, origin, created_at, reason, evidence}` 이다. 리마인드 생성·수정·취소 응답의 `reminder` 도 같은 모양이다.
  - `summary`·`reason`·`evidence` 는 #418 에서 더했다. 묶음이 나가는 모든 응답(PM 의 `GET /messages`·`GET /messages/threads/{thread_id}`, 리마인드 생성·수정·취소, 묶음 수정·승인·취소)에 있고, 응답할 때마다 계산한다. 팀원 화면은 `bundles: null` 이라 나가지 않는다. 근거: [reminder_reason.py](../../../backend/app/services/reminder_reason.py), [api/messages.py](../../../backend/app/api/messages.py).
  - `summary`: string. 태스크 1건이면 `API 명세서 진행 상황 확인`, 여러 건이면 `API 명세서 외 2건 진행 상황 확인`. 첫 제목은 `reminders[0]` 이고 지운 태스크면 `지워진 태스크` 다.
  - `reason`: string | null. 날짜는 KST `M/D(요일)` 이다. 스케줄러 재촉은 `'API 명세서' 마감이 11/14(토)인데, 11/5(목) 이후로 진행 소식이 없어요.`, 마감이 없으면 뒤 문장만, PM 이 만든 재촉은 `김PM님이 직접 만든 재촉이에요. 11/5(목) 이후로 진행 소식이 없어요.` 다. 소식이 없으면 `11/2(월)에 태스크를 만든 뒤로 진행 소식이 없어요.` 이다. `task_id` 가 `null` 이면 `null`.
  - `evidence`: `{kind: "reply"|"task_change", at, message_id}` | null. 이유 문장이 가리키는 마지막 소식이다. `reply` 는 그 대화의 팀원 메시지(`message_id` 있음), `task_change` 는 그 태스크의 상태·마감 변경(스케줄러·답장 판정이 바꾼 것 제외, `message_id: null`)이다. `at` 은 UTC ISO. 태스크 생성 이전 소식은 세지 않고, 소식이 없거나 `task_id` 가 `null` 이면 `null`.
  - 한계(BE 댓글): 같은 대화에서 다른 태스크에 대해 한 답장도 소식으로 센다. 지운 태스크(소프트 삭제)의 예정 리마인드는 발송 직전에 빠질 때까지 원래 제목과 문장이 보인다.
- 문구(`body`)와 출처(`body_source`)
  - `pm`: PM 이 묶음 문구를 직접 고쳤거나, 리마인드가 하나뿐이고 PM 메모(`note`)가 있어 메모가 그대로 문구가 됐다.
  - `ai`: AI 가 PM 말투로 쓴 초안이다. PM 이 쓰거나 고쳐 승인한 최근 문구의 말투를 따르고, 없으면 같은 팀 동료가 가볍게 묻는 존댓말로 쓴다.
  - `rule`: AI 초안이 아직 없거나 못 쓴 경우의 기본 문구다. 예: `재환님, 동우예요.\n'API 명세서' 마감이 11/14(토)이라 한번 여쭤봐요.\n지금 어디까지 됐는지 편하게 알려 주세요!`
  - `body` 는 웹 대화에 저장될 전체 글이다. 봇 DM 에는 이 글 대신 안내가 나간다. 메모·AI 초안·규칙 문구에는 BE 가 틀을 씌운다. 그 팀원에게 아직 나간 리마인드가 없으면 워크스페이스 이름과 PM 소개, 맺음 안내가 붙고, 있으면 `{팀원}님, {PM}이에요.` 로 시작한다. PM 이 고친 문구에는 틀을 다시 씌우지 않는다. 그 팀원의 첫 리마인드가 나가면 승인 전 묶음은 소개 없는 틀로 바뀐다(PM 이 고친 글은 그대로). `body` 에 줄바꿈이 들어 있으므로 화면은 줄을 그대로 보여야 한다.
  - `draft_status` 가 `needed`·`claimed` 이면 AI 초안이 아직 오는 중이고 문구가 바뀔 수 있다. `done` 은 AI 초안이 끝났다는 뜻이다. 그 뒤에도 PM 조작이나 첫 DM 발송으로 문구가 바뀔 수 있으며, 그때는 `draft_version` 이 오른다. 초안을 기다리는 중에도 승인할 수 있고, 승인하면 그때 보이는 문구로 정해지며 `draft_status` 는 `done` 이 된다.
  - `draft_version` 은 보이는 문구와 구성의 판이다. AI 초안이 들어오거나, PM 이 문구를 고치거나, 묶음 구성이 바뀌거나, 그 팀원의 첫 리마인드가 나가 틀이 바뀌면 오른다. 묶음 시각만 옮기면 그대로다. 승인할 때 보낸 판이 지금 판과 다르면 409 `BUNDLE_CHANGED` 이고 `details.draft_version` 에 지금 판을 준다. 화면은 `보낼 메시지가 바뀌었어요. 다시 확인해 주세요.` 를 보이고 묶음을 다시 불러와 PM 이 새 문구를 보고 승인하게 한다.
- 같은 받는 사람·태스크·발송 시각의 예정 리마인드가 이미 있으면 `POST /messages/reminders` 는 새로 만들지 않고 있던 것을 201 로 돌려준다. 이때 보낸 `note` 는 쓰지 않고 승인도 풀리지 않는다.
- 묶음 구성이 바뀌면(리마인드를 더하거나 빼거나, 태스크 메모를 고치거나, 다른 시각으로 옮기면) 문구를 다시 만들고 **승인이 풀린다.** PM 이 묶음 문구를 직접 고치면 승인은 그대로다.
- 묶음 시각을 옮긴 곳에 이미 예정 묶음이 있으면 둘이 합쳐지고 합쳐진 묶음을 돌려준다. 이때 문구를 같이 고치면 400 이다. 시각부터 옮기고 문구를 고친다.
- 리마인드가 모두 빠진 묶음은 `cancelled` 가 된다. 취소된 묶음의 `reminders[]` 에는 묶음과 함께 취소된 리마인드만 있고, 그 전에 뺀 리마인드는 없다.
- 고치기·승인·취소는 `scheduled` 에서만 된다. 다른 상태면 409 `REMINDER_NOT_EDITABLE`. 없는 묶음은 404 `REMINDER_BUNDLE_NOT_FOUND`, 없는 리마인드는 404 `REMINDER_NOT_FOUND`.
- `scheduled_at` 은 시간대가 있는 ISO 시각이어야 하고(없으면 400) UTC 로 돌려준다. 지금보다 이른 시각으로 만들거나 고치거나, 시각이 지난 묶음을 승인하면 409 `REMINDER_SCHEDULED_AT_PASSED` 다. 지금과 같은 시각을 문구·메모와 같이 보내는 것은 시각을 고친 것으로 보지 않는다. 화면은 `예정 시각이 지났어요` 를 보이고 시각을 다시 고르게 한다(D-174 정책 3).
- 발송 시각이 된 승인된 묶음은 대화 메시지 한 통이 되고, 묶음과 리마인드는 `sent` 가 된다. 스케줄러가 시각에 맞춰 만들므로 봇이 꺼져 있어도 웹 대화에는 나타난다. 나갈 때 응답이 있었던 재촉이 있으면 자동 취소하고 나머지는 승인을 풀어 PM 이 다시 확인한다. 탈퇴한 팀원의 승인된 묶음은 메시지를 만들지 않고 `cancelled` 가 된다.
- 승인되지 않은 채 시각이 지난 묶음은 `scheduled` 로 남고 AI 초안도 오지 않는다. PM 이 시각을 옮기거나 보내지 않음을 고른다. 승인된 묶음의 태스크 메모를 고쳐 승인이 풀린 경우도 같다. 마감이 지나면 스케줄러가 `expired` 로 닫는다. 마감 없는 태스크의 리마인드는 PM 이 고를 때까지 남는다. 이런 리마인드는 재촉 제안을 막지 않는다.
- 대화 메시지(`messages[]`)는 `{message_id, thread_id, sender: "bot"|"pm"|"member", body, created_at, reply_channel: "discord"|"web"|null, dm_status, dm_failure_reason, scheduled_at, author_member_id, author_name}` 이다. `bot` 은 리마인드 묶음이 나간 글, `pm` 은 PM 이 남의 대화에 쓴 글, `member` 는 대화 주인이 쓴 글이다. `author_member_id`·`author_name` 은 `pm` 글에만 있고 나머지는 `null` 이다. `pm` 글의 `reply_channel`·`scheduled_at` 은 `null` 이다.
  - 팀원 메시지의 `reply_channel` 이 `web` 이면 `웹에서 답장` 표시를 붙인다.
  - 봇 DM 으로 나가는 글(`bot`·`pm`)의 `dm_status` 는 `pending`·`claimed`(봇이 보내는 중)·`delivered`·`failed` 다. `failed` 면 `dm_failure_reason` 이 `dm_blocked`(팀원이 서버 DM 을 막음)·`discord_not_linked`(디스코드 미연결)·`unknown` 중 하나이고, 화면은 `DM 못 보냄` 을 보인다. 웹 대화에는 들어갔으므로 상태는 `sent` 다.
- 대화 목록 한 줄은 `{thread_id, member_id, name, last_message, awaiting_reply_since, dm_failed, web_reply_available, unread_count}` 다. 대화 상세의 `thread` 도 같다. `last_message` 는 `{message_id, sender, body, created_at, author_member_id, author_name}` 이다. `dm_failed` 는 그 팀원에게 마지막으로 나간 봇 DM(`bot`·`pm`)이 `failed` 인지다. `awaiting_reply_since` 는 리마인드(`bot`)만 센다. `web_reply_available` 은 그 팀원에게 계정이 연결됐는지(`member.user_id`)를 읽는 시점에 판정한 값이다. `false` 면 그 팀원은 PM 초대를 수락하기 전까지 웹 답장을 할 수 없다. 화면 표시는 아래 **PM·팀원 메시지** 의 프론트엔드 연결(#525)에 있다. 최근 메시지 순이고, 메시지가 없는 대화는 아래에 둔다.
- 팀원이 봇 DM 창에 쓴 글은 저장하지 않고 PM 에게도 보이지 않는다. 봇이 웹 답장 안내를 돌려준다(같은 사람에게 1시간에 한 번, #515). 이미 저장된 디스코드 답장은 대화에 남는다.
- 팀원 권한은 로그인 계정이 연결된 팀원(`member.user_id`) 기준이다. 계정이 연결되지 않은 팀원은 웹 답장을 할 수 없다. 대화 주인은 팀원 행으로 판단하므로, 탈퇴했다가 새 팀원 행으로 돌아온 계정은 예전 행의 대화를 열 수 없다.
- 아직 없는 것: ~~웹의 답장 판정 입력(`답장 확인 필요`)과 판정 결과 표시~~(#344 에서 연결, 아래 「리마인드 답장 판단」의 FE 연결), 태스크 안내 DM·#회의록 요약, `지금 바로` 5분 합치기, AI 초안 워커, 시안의 `지금 바로`(`send_timing: now`)에 대응하는 BE 경로. 프론트엔드는 #315 에서 MSW 임시 경로 `reviews/{id}/send|dismiss` 를 `bundles/{id}/approve|cancel` 로 옮겼다.

**PM·팀원 메시지** (#470 에서 BE 구현, #519·#525 에서 프론트엔드 연결, FE 화면 규칙은 사용자 확정·BE 와의 합의 여부 확인 필요). 리마인드 없이 PM 과 팀원이 글을 주고받는다. PM 글은 예약·승인 없이 쓰는 즉시 봇 DM 대기로 가고, 팀원은 웹에서 먼저 쓸 수 있다. 범위는 PM 과 팀원 사이이고 팀원끼리는 대화가 없다. 봇 쪽은 [backend-ai 계약](../../../backend/docs/contracts/backend-ai-contract.md)의 「리마인드 DM」에 있다.

| 쓰는 사람 | 대화 | `POST …/replies` 결과 |
|---|---|---|
| 대화 주인(PM 의 자기 대화 포함) | 자기 대화 | 201. `sender: "member"`, `reply_channel: "web"`, DM 없음. 리마인드가 나간 적 있으면 답장 판단을 탄다 |
| PM | 남의 대화 | 201. `sender: "pm"`, 작성자는 세션에서 정한다. 대화 주인에게 봇 DM 이 나간다. 대화 주인이 다른 PM 이어도 같다 |
| 그 밖의 팀원 | 남의 대화 | 403 `FORBIDDEN` |
| PM | 탈퇴한 팀원의 대화 | 404 `MEMBER_NOT_FOUND` |
| 누구든 | 다른 공간의 대화 | 404 `MESSAGE_THREAD_NOT_FOUND` |

- `POST /messages/threads` 는 멱등이다. 언제나 200 이고 대화가 없을 때만 만든다. PM 은 공간의 팀원 누구든 열 수 있고, 다른 PM 의 대화도 열 수 있다. PM 도 팀원 행이 있어 자기 대화를 갖기 때문이다. 팀원은 자기 `member_id`(§4.2.1)만 낼 수 있고 남의 id 는 있든 없든 403 `FORBIDDEN` 이다. 없는 팀원, 다른 공간의 팀원, 탈퇴한 팀원은 404 `MEMBER_NOT_FOUND` 다. 공간 소속이 아니면 403 이다.
- 봇 DM 에는 글 본문이 나가지 않는다. `{공간 이름} {PM 이름} PM 이 메시지를 보냈어요.` 와 웹 답장 안내가 나간다(#515). 계정이 연결된 팀원은 대화 링크, 연결되지 않은 팀원은 PM 초대 요청과 가입 링크를 받는다. `APP_BASE_URL` 이 없으면 링크를 뺀다. 안내는 봇이 가져갈 때 만들어 저장하지 않으므로 웹의 `body` 에는 PM 이 쓴 글 전체가 보인다. PM 글을 리마인드 개수 안내로 바꾸지 않는다.
- 디스코드가 연결되지 않은 팀원에게 쓴 글은 201 로 저장하고 `dm_status: "failed"`, `dm_failure_reason: "discord_not_linked"` 로 둔다. 나중에 연결해도 다시 보내지 않는다. 다른 실패도 자동으로 다시 보내지 않고 PM 이 다시 쓴다.
- 서버는 같은 글 두 번 제출을 막지 않는다. 화면이 전송 중 버튼을 막고 mutation 재시도를 끈 것에 기댄다. 나간 DM 은 지울 수 없다.
- PM 글은 시계, 재촉 제안, 답장 판단 후보를 바꾸지 않는다. 팀원 글은 지금처럼 응답으로 친다.
- 알림은 표의 `message_received` 다. PM 글은 대화 주인에게, 팀원 글(웹·디스코드)은 쓴 사람을 뺀 PM 전원에게 간다. `text` 는 `{이름}: {미리보기}` 다. 미리보기는 첫 줄 60자다. 글 하나에 알림 하나다. 판단 행이 생기지 않은 글은 바로 알리고, 판단을 타는 글은 결과가 `reply_judged` 면 그것만, 바꿀 것이 없으면 그때 `message_received` 를, 판단 실패·시간 초과면 `reply_unjudged` 만 낸다. 대화·방향마다 5분 구간에 한 번이라 이어 쓴 글은 첫 글의 미리보기만 보인다.
- ~~실시간 신호는 없다. 화면은 기존 조회와 알림 목록 polling 으로 새 글을 받는다.~~ #520 에서 아래 **대화 신호 웹소켓** 이 생겼고 #558 에서 화면에 이었다. 알림 목록 polling 은 그대로다.

**프론트엔드 연결** (#519·#525, 2026-11-09). 위 BE 동작에 화면을 이었다. 화면 규칙은 #519·#525 의 FE 안(2026-11-08)이고 사용자가 같은 날 확정했다(#525 마지막 댓글). 아래는 코드와 MSW 기준 테스트·브라우저로 확인한 사실이다. 실제 서버(배포 BE)에 붙인 확인은 하지 않았다.

- 타입: [message.ts](../../src/shared/types/api/message.ts) 의 `sender` 에 `pm`, 메시지와 `last_message` 에 `author_member_id`·`author_name`, 대화 요약에 `web_reply_available?`(옛 응답에 없을 수 있어 선택 칸)을 더했다. [mapper.ts](../../src/entities/message/model/mapper.ts) 는 `pm` 글을 따로 읽고 `dm_status` 가 없으면 조회 오류로 본다. 작성자가 `null` 이면 이름을 `PM` 으로 보인다. `web_reply_available` 은 `available`·`unavailable`·`unknown`(칸 없음) 셋으로 읽는다. `unread_count` 는 아직 읽지 않는다.
- 대화 열기: `POST /messages/threads` `{member_id}` 를 부르고([messageQueries.ts](../../src/entities/message/api/messageQueries.ts) `openThread`), 메시지 캐시를 다시 받은 뒤 돌려받은 대화로 간다. 자동 재시도는 없고 진행 중에는 다시 누를 수 없다.
  - PM: 목록 머리의 `새 대화`, 그리고 빈 메시지 화면의 `새 대화` 가 오른쪽 칸 `?new=thread` 를 연다. 칸은 자기 팀원 행을 뺀 공간 팀원 목록이고, 한 번 누르면 그 대화로 주소를 바꿔 끼운다. 다른 PM 도 고를 수 있다.
  - 팀원: 대화가 없는 빈 화면의 `PM에게 메시지 보내기` 가 자기 `member_id` 로 연다. 워크스페이스 응답에 `member_id` 가 없거나 `null` 이면 버튼을 그리지 않는다. 팀원은 `?new=thread` 를 무시한다.
- 말풍선 자리: 한 표([viewer.ts](../../src/widgets/message-inbox/model/viewer.ts) `OWN_SIDE`)가 말풍선 자리와 목록의 `나:` 를 함께 정한다.
  - PM 이 남의 대화를 볼 때: 봇 재촉과 예정 묶음은 지금처럼 오른쪽이다. `pm` 글은 `author_member_id` 가 내 `member_id` 면 오른쪽(`나`), 아니면 왼쪽에 작성자 이름을 붙인다. 팀원 글은 왼쪽이다.
  - 팀원 화면과 PM 자기 대화: 자기 글이 오른쪽이고 봇·`pm` 글은 왼쪽이다. `pm` 글 위에는 `author_name` 을 보인다.
  - `pm` 글의 `dm_status: failed` 는 봇 글처럼 `DM 못 보냄 · {이유}` 다.
- 입력칸: 모든 대화에 있다. PM 이 남의 대화를 열 때 나오던 안내 바는 지웠다.
  - 팀원·PM 자기 대화: `PM에게 메시지`, 아래 `답장은 이 웹 대화에 남아요. 봇 DM 창에 쓴 글은 전달되지 않아요. 여기에 써 주세요.`
  - PM 이 남의 대화: `{팀원 이름}님에게 메시지`, 아래 `내용은 웹 대화에 저장돼요. Discord에는 새 메시지 안내만 보내요.` 보내기 버튼은 `메시지 보내기` 다.
  - 전송 중 입력칸·버튼 잠금, mutation 재시도 끔, 실패 시 글 보존과 `다시 보내기` 는 그대로다. 서버가 같은 글 두 번을 막지 않으므로 이 잠금에 기댄다.
- 웹 답장 불가: PM 이 남의 대화를 볼 때 `web_reply_available === false` 면 목록 행에 회색 `웹 답장 불가`(빨간 `DM 못 보냄` 과 다른 표시), 대화 안 입력칸 위에 `웹 계정이 연결되지 않아 이 팀원은 웹에서 답장할 수 없어요. 팀원을 초대하고 초대를 수락하도록 안내해 주세요.` 와 팀 화면(팀원별 초대 조작) 링크 `팀원 초대하기` 를 보인다. PM 입력칸은 그대로다. `true` 와 칸 없음은 아무것도 보이지 않는다. 답장 가능으로 확정해 표시하지 않는다. 이미 저장된 Discord 답장은 그대로 보인다.
- 기기 알림 띠(#411)는 팀원 화면과 PM 자기 대화에서 봇 또는 `pm` 글이 있으면 보인다. PM 이 남의 대화를 보는 화면에는 없다.
- 알림: [display.ts](../../src/entities/notification/model/display.ts) 의 `message_received` 는 제목 `새 메시지가 왔어요` 이고 메시지 조회를 다시 부른다.
- 실패 안내: PM 이 남의 대화에 쓴 글을 보내지 못하면 입력칸 위 제목은 `메시지를 보내지 못했어요` 다. 팀원·PM 자기 대화는 행동 표([actionMessages.ts](../../src/features/message-action/lib/actionMessages.ts))의 `답장을 보내지 못했어요` 를 그대로 쓴다.
- MSW: PM 글을 저장하면 BE `notify_new_message` 처럼 대화 주인에게 `message_received` 를 만든다. 본문은 `{작성자}: {첫 줄 60자}`, 링크는 그 대화이고, 같은 대화·5분 구간에는 하나만 만든다. 팀원 글의 알림은 BE 가 답장 판단을 거쳐 내므로 MSW 는 만들지 않는다.

**대화 신호 웹소켓** (#520 에서 BE 구현, #558 에서 프론트엔드 연결, 합의 여부 확인 필요). 대화에 새 줄이 생겼음을 열린 화면에 바로 알린다. 소켓은 신호만 보내고 본문은 보내지 않는다. 화면은 신호를 받으면 기존 조회를 다시 부르므로 권한 검사는 조회 한 곳에 있다. 30초 polling 은 그대로 돈다.

- 경로: `GET /api/v1/workspaces/{workspace_id}/messages/ws` 업그레이드. 인증은 로그인과 같은 `session_token` 쿠키다. 소켓용 토큰이나 쿼리 값은 없다.
- 서버가 보내는 프레임은 하나다. `{"type":"thread_updated","thread_id":"..."}`. 클라이언트가 보낸 프레임은 읽고 버린다.
- 받는 사람은 그 대화의 주인과 신호 시점의 PM 전원이고, 글을 쓴 사람도 포함한다(다른 탭을 맞춘다). 역할이 바뀌면 다음 신호부터 다시 붙지 않아도 바뀐 범위로 간다. 다른 공간에는 가지 않는다.
- 신호가 나가는 일은 커밋된 웹 답장, PM 글, 봇이 넘긴 디스코드 글, 예약 리마인드 발송, 봇의 발송 결과 보고(`dm_status`·`dm_failure_reason` 이 실제로 바뀔 때), 봇이 가져갈 때 못 보냄으로 닫힌 글(가져간 뒤 10분 안에 보고가 없거나, 보내기 전에 Discord 연결이 풀렸거나 탈퇴했다)이다. 같은 디스코드 글이나 같은 결과를 다시 보고한 요청은 신호가 없고, 묶음 수정과 AI 초안 도착도 신호가 없다. 롤백된 글은 신호가 없다. 한 트랜잭션에서 같은 대화는 신호 하나다.
- 재전송은 없다. 소켓이 열릴 때마다 화면은 조회를 한 번 부른다. 서버는 소켓을 받기 전에 연결을 등록하므로 그 조회 뒤의 글은 신호로 온다.
- 끊겨도 화면에 표시하지 않는다. polling 이 돌고 다시 붙으면 조회로 맞춰진다.

| 닫힘 | 뜻 | 화면 |
|---|---|---|
| 4401 | 세션 없음, 만료, 로그아웃, 비밀번호 재설정으로 세션 삭제 | 다시 붙지 않는다 |
| 4403 | 이 공간 소속이 아님, 탈퇴 | 다시 붙지 않는다 |
| 1013 | 신호가 밀려 서버가 끊음, 또는 계정이 이 공간의 다른 팀원 행으로 옮겨짐(초대 연결을 끊고 다른 이름으로 다시 초대) | 간격을 늘려 다시 붙고 조회한다 |
| 그 밖의 1000번대, 네트워크 끊김 | 서버 재시작(1012), ping 시간 초과(1011) 등 | 간격을 늘려 다시 붙고 조회한다 |

- 4401·4403 은 연결을 받은 뒤 닫는다. 거절된 핸드셰이크의 코드는 브라우저가 읽지 못해서다. 열린 소켓도 30초마다 세션과 소속을 다시 확인해 같은 코드로 닫으므로, 로그아웃 뒤 닫힐 때까지 최대 30초 걸린다.
- `Origin` 이 없거나 그 `host:port` 가 `Host` 헤더와 다르면 받기 전에 HTTP 403 으로 거절한다. 스킴은 보지 않는다.
- 로컬 Vite: 지금의 `/api` 규칙은 `ws` 가 없고 `changeOrigin: true` 라 `Host` 가 바뀌어 위 검사에 걸린다. 이 경로만 `ws: true, changeOrigin: false` 인 규칙을 따로 둬야 한다.
- 연결표가 프로세스 메모리에 있어 BE `--workers 1` 에서만 모든 소켓에 닿는다.
- 검증: `backend/tests/api/test_message_socket.py`(sqlite·PostgreSQL)와 로컬 uvicorn(`--workers 1`, PostgreSQL, websockets 17.4) 실제 연결로 확인했다. 실제 POST 뒤 PM·대화 주인 소켓에 프레임이 201 응답보다 먼저 나갔고, 잘못된 세션 4401, 비소속 4403, 다른 `Origin`·`Origin` 없음·다른 포트는 HTTP 403 이었다. 열린 소켓 30개가 있어도 POST 는 201 이었다. 클라이언트 프로세스를 강제 종료하면 0.03초 안에 연결이 빠졌고, 응답 없이 멈춘 클라이언트는 uvicorn 기본 ping(20초 간격, 20초 대기)으로 30.6초 뒤 1011 로 닫혔다. 서버 SIGTERM 은 소켓이 열린 채 0.12초에 끝났고 클라이언트는 1012 를 받았다. Caddy 를 거친 운영 연결, 브라우저, Vite 프록시는 확인하지 않았다.

**프론트엔드 연결** (#558, 2026-11-09). 아래는 코드와 MSW 기준 테스트·브라우저, 가짜 백엔드에 붙인 Vite 프록시 확인으로 본 사실이다. 실제 BE(로컬·배포)에 붙인 확인은 하지 않았다.

- 메시지 화면(`MessageInbox`)이 떠 있는 동안 소켓 하나를 연다([messageSignals.ts](../../src/entities/message/api/messageSignals.ts), [useMessageSignals.ts](../../src/widgets/message-inbox/model/useMessageSignals.ts)). 주소는 REST 와 같은 API 기준 주소에 `/workspaces/{workspace_id}/messages/ws` 를 붙이고, 경로뿐이면 `window.location` 의 출처를 쓴다. `https:` 면 `wss:` 다. 라우터의 `useLocation()` 은 쓰지 않는다. 화면은 소켓으로 아무것도 보내지 않는다.
- 열릴 때마다(처음과 다시 붙을 때) 그 공간의 메시지 조회(`messageKeys(workspaceId)`)를 한 번 다시 부른다. 열릴 때 받는 중인 조회가 있으면 끊지 않고, 그 조회가 끝난 뒤 한 번 더 부른다. 받는 중인 조회는 신호 전의 서버 상태일 수 있어서다. `thread_updated` 를 받으면 받는 중인 조회를 데이터가 없는 첫 조회까지 끊고 다시 부른다. TanStack Query 는 데이터가 없는 조회를 `cancelRefetch` 로 끊지 않고 그 결과로 무효 표시를 지우므로, 끊기(`cancelQueries`)를 먼저 한다(#558 리뷰). 화면을 떠났거나 세션이 바뀌었으면 다시 부르지 않는다. JSON 이 아니거나 모양이 다른 프레임은 버린다.
- 닫힘 코드는 한 표로 정한다. 4401·4403 은 다시 붙지 않는다. 그 밖의 코드(1000·1011·1012·1013, 네트워크 끊김 1006, 핸드셰이크 HTTP 403)는 1·2·4·8·16·30초, 그 뒤 30초마다 다시 붙고, 열리면 간격이 처음으로 돌아간다. 끊김은 화면에 보이지 않고 polling 은 그대로다.
- 화면을 떠나거나 공간을 바꾸면 닫고 다시 붙지 않는다. 연결을 연 세션이 끝나면(로그아웃·계정 전환) 화면이 떠 있어도 바로 닫는다. 그 뒤 이전 소켓의 이벤트는 캐시에 닿지 않는다.
- 로컬 Vite: [vite.config.ts](../../vite.config.ts) 에 `'^/api/v1/workspaces/[^/]+/messages/ws$': { ws: true, changeOrigin: false }` 규칙을 `/api` 보다 앞에 두었다. 가짜 백엔드로 확인했을 때 업그레이드(101)가 그대로 넘어갔고, 백엔드가 받은 `Host` 와 `Origin` 이 둘 다 개발 서버 주소였다. 같은 때 일반 `/api` 요청은 지금처럼 `Host` 가 백엔드 주소로 바뀌었다. `API_PROXY_TARGET` 을 배포 서버로 두면 `Host` 가 맞지 않아 소켓은 계속 다시 붙기만 하고 polling 으로 동작한다.
- MSW: `ws.link` 로 같은 경로를 흉내 낸다([messageSocket.ts](../../src/shared/mock/handlers/messageSocket.ts)). 세션이 없으면 4401, 공간 소속이 아니면 4403 으로 닫는다. 답장 쓰기 경로가 글을 저장하면 그 대화의 주인과 PM 전원(쓴 사람 포함)의 소켓에 `thread_updated` 를 보낸다.

**스케줄러** (#318 에서 BE 구현). 결정 근거는 [결정 0038](../../../ai/docs/basis_for_decision/ai/2026-11-04-0038-reminder-scheduler-and-notifications.md). 시각 기준은 한국 시간이다.

- 마감 전날 09:00 에 나갈 재촉을 그 3일 전에 만들고 PM 에게 알린다(발송 시각은 기본값. 메시지·알림 설정 항목 참조). 3일이 안 남았으면 바로 만들고, 발송 시각이 지났으면 만들지 않는다. 만든 재촉은 PM 승인 전까지 나가지 않는다(기본값. 자동 승인을 켜면 발송 시각에 승인해 보낸다. 메시지·알림 설정 항목 참조). PM 이 취소한 제안은 같은 마감에 다시 만들지 않고, 마감이 바뀌면 새로 제안한다.
- 응답은 대화의 팀원 답장(디스코드·웹)과 사람이 바꾼 태스크 상태·마감이다. 스케줄러 자신의 변경(`change_source: scheduler`)은 응답이 아니다. 누가 바꿨는지는 가리지 않아서 PM 의 수정과 회의 자동 반영도 응답이다. PM 이 재촉을 만든 뒤 마감을 고치면 그 재촉은 취소되고 새 마감으로 다시 제안된다.
- 재촉을 만든 뒤 응답이 있으면 그 재촉은 발송 전에 `cancelled` 가 되고 PM 에게 알린다. 태스크가 지워져도 같다. 묶음의 나머지는 승인이 풀려 문구를 다시 만들고 PM 이 다시 승인한다(기본값. 자동 승인이 켜져 있으면 켠 뒤 발송 시각이 오는 묶음은 발송 시각에 다시 승인된다. 메시지·알림 설정 항목 참조). 시각이 지났으면 `예정 시각이 지났어요` 로 시각을 다시 고른 뒤 승인한다.
- 마감이 지난 예정 재촉은 `expired` 가 된다. 서버가 멈췄던 경우도 같고, 마감 전이면 응답을 다시 확인한 뒤 보낸다. 묶음의 나머지가 남아 승인이 풀리면 PM 에게 알린다.
- 담당자가 바뀌면 처음부터 다시 시작한다. 예정 재촉은 승인된 것까지 취소하고 PM 에게 알리며, 열린 시계는 막지 않고 닫는다. 같은 마감이어도 새 담당자에게 다시 제안하고 PM 이 다시 승인한다(기본값. 메시지·알림 설정 항목 참조). 이미 걸린 자동 막힘은 그대로 두며, PM 이 풀거나 새 재촉에 대한 답장으로 풀린다(답장이 막혔다는 내용이면 풀지 않는다). 담당자가 바뀐 뒤 옛 담당자 대화에 온 답장은 응답으로 세지 않는다.
- DM 전달 보고 시각부터 72시간 안에 응답이 없으면 태스크를 `blocked` 로 바꾸고 사유를 `리마인드에 72시간 동안 응답이 없어요` 로 적고 PM 에게 알린다(기본값. `silence_alert` 를 끄면 알리지 않는다. 메시지·알림 설정 항목 참조). 새 재촉이 나가면 처음부터 다시 잰다. DM 이 실패했거나 전달 보고 전이면 막지 않는다. 자동 막힘이 걸린 채 새 재촉이 나간 경우도 완료, 담당자 변경, 사람의 상태·마감 변경이 있으면 다시 막지 않는다. 이미 막힘이면 상태와 사유는 그대로 두고 PM 에게만 알린다.
- 대화에 답장이 오면 판단이 끝나기를 기다렸다가 그 결과를 따른다(#331 에서 BE 구현, #344 에서 FE 연결, 아래 「리마인드 답장 판단」). 그 태스크를 말했거나 바꿀 것이 없는 답장이면 재촉이 나갔던 태스크의 막힘을 풀고 사유를 비운다. 판단이 실패했거나 10분 안에 끝나지 않은 답장도 같다. 막혔다는 답장이면 막힘을 풀지 않고 시계만 닫으며(D-179, 2026-11-06 확정), 사유가 비었거나 무응답 문구일 때만 답장 근거로 바꾼다. PM 이 쓴 사유는 둔다. 다른 태스크만 말한 답장이면 시계는 계속 간다. 이력 출처는 `reminder_reply` 다. 답장보다 뒤에 사람이 건 막힘은 풀지 않는다.

**자동 막힘 풀기.** 카톡이나 회의로 이미 들은 경우를 위해 PM 이 한 번에 되돌리는 경로다.

- `POST /api/v1/tasks/{task_id}/auto-block/undo`: 상태와 사유를 막히기 전 값으로 되돌린다. 응답은 `TaskResponse`, 이력 출처는 `manual` 이다. PM 이 아니면 403.
- 지금 풀 수 없으면(`auto_blocked` 가 false) 409 `AUTO_BLOCK_NOT_FOUND`. 성공 응답의 `auto_blocked` 는 false 다.
- ~~자동 막힘 여부는 `blocker` 문구로 가르지 말고 태스크 이력의 `status` 변경 중 `change_source: scheduler` 로 가린다.~~ #365 에서 아래 `auto_blocked` 로 바꿨다.

**자동 막힘 판정 `auto_blocked`** (#365).

- 합의된 규약: 자동 막힘 여부는 `TaskResponse.auto_blocked` 하나로 가린다. 값은 「지금 `POST /tasks/{task_id}/auto-block/undo` 를 부르면 성공하는가」와 정확히 같다. `TaskResponse` 를 돌려주는 7개 경로(`POST /tasks`, `GET /tasks`, `GET /tasks/{task_id}`, `PATCH /tasks/{task_id}`, 이력 되돌리기, 자동 막힘 풀기, Notion 반영 재시도)에 항상 온다. PM·팀원이 같은 값을 받고, 풀기는 계속 PM 전용이라 버튼은 역할로 가린다. 409 를 받으면 다시 불러오는 처리는 그대로 둔다. 근거는 [#365 설계 확정 댓글](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/365#issuecomment-6637008816)과 같은 이슈의 BE 구현 댓글이다.
- 현재 서버 구현: [BE PR #373](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/373)(병합)을 코드로 확인했다. [scheduler.py](../../../backend/app/services/scheduler.py) 의 `auto_blocked_ids` 와 `undo_auto_block` 이 같은 판정 조각(`_auto_block_state`·`_undoable_watches`)을 쓴다. 태스크가 `blocked` 이고, 사유가 스케줄러 문구이고, 막힘을 직접 건(applied) 열린 무응답 감시 기록이 있고, 지워지지 않았으면 true 다. 이력은 보지 않는다. 목록은 잠금 없이 읽어서 스케줄러가 같은 순간에 커밋하면 잠깐 어긋날 수 있다.
- 이전 이력 기준과 답이 다른 경우는 둘이다. 자동 막힘 뒤 PM 이 사유만 고치면 이력 기준은 자동 막힘이지만 `auto_blocked` 는 false(풀기 409)다. 자동 막힘 뒤 상태를 진행 중으로 바꿨다가 다시 막으면 이력 기준은 사람의 막힘이지만 `auto_blocked` 는 true(풀기 200, 막히기 전 값으로 되돌림)다.
- FE 구현(#365): 매퍼가 `Task.autoBlocked` 로 싣고, 불리언이 아니면 던지지 않고 false(풀기 숨김)로 읽는다. 보드 배지와 상세 안내가 이 값만 본다. 막힌 카드마다 내던 `GET /tasks/{task_id}`·`GET /tasks/{task_id}/history` 를 없앴고, 이력 조회 실패 안내도 함께 지웠다. 풀기에 성공하면 응답의 태스크를 목록 행과 상세 캐시에 바로 쓰고 다시 받는다.
- MSW: 막힘을 건 때의 막기 전 상태·사유를 `autoBlocks` 칸에 남기고, 이 기록과 상태·사유로 BE 와 같은 판정을 한다. 이미 막힌 태스크를 무응답으로 막으면 아무것도 바꾸지 않고 기록도 남기지 않는다. 지운 태스크 상태는 MSW 에 없다. 응답 7개 경로가 모두 이 판정을 싣는다. 모의 DB 버전이 13 이 되었다.

**알림·푸시** (#318 에서 BE 구현, 프론트엔드 요청은 #330). 받는 사람은 팀원(`member`) 단위이고, 푸시 구독은 로그인 계정 단위다.

| 요청 | 누가 | 하는 일 |
|---|---|---|
| `GET /api/v1/workspaces/{workspace_id}/notifications?limit=` | 소속 팀원 | 내 알림 최근 순(`limit` 기본 50, 최대 200). `{items, unread_count}`. `unread_count` 가 배지 숫자다 |
| `POST /api/v1/workspaces/{workspace_id}/notifications/{notification_id}/read` | 받은 사람 | 읽음 표시. 다시 불러도 200. 남의 알림은 404 `NOTIFICATION_NOT_FOUND` |
| `GET /api/v1/push/vapid-public-key` | 로그인 사용자 | `{public_key}`. 서버에 키가 없으면 `null` 이고 그때는 구독하지 않는다 |
| `POST /api/v1/push/subscriptions` → 201 | 로그인 사용자 | 브라우저 구독 등록 `{endpoint, keys: {p256dh, auth}}`. 브라우저 푸시 서비스(FCM, Apple, Mozilla, Windows) 주소만 받고 나머지는 400 이다. 같은 `endpoint` 를 다시 보내면 지금 계정으로 옮긴다. 계정마다 최근 10개 기기만 남는다 |
| `DELETE /api/v1/push/subscriptions` → 204 | 로그인 사용자 | 구독 해제 `{endpoint}`. 내 구독만 지운다. 로그아웃할 때 부른다 |

- 알림 한 건은 `{notification_id, kind, text, link: {type, id}, read_at, created_at}` 이다.
- 푸시로 오는 내용(서비스 워커 `push` 이벤트의 JSON)은 `{notification_id, workspace_id, kind, text, link: {type, id}}` 다. 제목은 화면에서 정한다.

| `kind` | 받는 사람 | `link.type` | 누르면 가는 곳 | 설정 키(#316) |
|---|---|---|---|---|
| `reminder_sent` | 재촉 받은 팀원 | `thread` | 그 대화 | |
| `nudge_suggested` | PM 전원 | `bundle` | 보내기 전 확인 | |
| `nudge_reapprove` | PM 전원 | `bundle` | 보내기 전 확인 | |
| `reminder_auto_cancelled` | PM 전원 | `bundle` · `thread` | 남은 묶음이 있으면 보내기 전 확인, 없으면 대화 | |
| `silence_blocked` | PM 전원 | `task` | 태스크 상세 | `silenceAlert`(`silence_alert`) |
| `message_received` | PM 글은 대화 주인, 팀원 글은 쓴 사람을 뺀 PM 전원 | `thread` | 그 대화. BE 구현(#470), 프론트엔드 연결(#519, 제목 `새 메시지가 왔어요`, 메시지 조회 다시 받기). 위 **PM·팀원 메시지** 참조 | |

- `link.type` 은 `thread`·`bundle`·`task` 중 하나다. 모르는 `kind` 가 와도 `text` 와 `link` 로 표시한다. 답장 판정 결과처럼 뒤에 종류가 더해진다.
- 설정 저장 API 는 §5.7 의 **메시지·알림 설정** 항목에 있다. `silence_blocked` 는 `silence_alert` 를 끄면 PM 에게 나가지 않는다. `reminder_sent` 는 설정과 무관하게 나간다. 재촉 제안 토글(`due_reminder`)은 스케줄러의 제안만 막고, PM 이 만든 재촉이 나갈 때의 `reminder_sent` 에는 영향이 없다.
- 계정이 연결되지 않은 팀원은 목록에만 쌓인다. 푸시가 실패해도 목록에는 남는다.
- 일시 오류는 최대 3번 다시 보낸다. 기기가 꺼져 있으면 푸시 서비스가 24시간까지 붙잡아 두고, 그 뒤에는 버린다. 푸시 서비스가 구독이 없어졌다고 답하면(404·410) 그 구독을 지운다. 요청을 거절하면(400·401·403) 다시 보내지 않고 구독은 남긴다. VAPID 키를 바꾸면 기존 구독이 이렇게 거절되니 브라우저에서 다시 구독한다.

**리마인드 답장 판단** (#331 에서 BE 구현, #344 에서 FE 연결. 경로·모양은 #344 이슈 본문의 BE 요청 그대로 쓴다). 봇 쪽 경로는 [backend-ai 계약](../../../backend/docs/contracts/backend-ai-contract.md)의 「리마인드 답장 판단」에 있다. 시계는 판단이 끝난 뒤 판단 결과대로 움직이고, 10분 안에 끝나지 않으면 답장을 응답으로 친다.

- 상태 변경이면서 근거가 확실한 변경만 자동 반영하고, 나머지는 기존 `task_update` 승인 요청으로 간다. 승인 payload 는 추출 경로와 키가 같고 `change_source: "reminder_reply"`, `reply_message_id` 가 더해지며 `meeting_id`, `extraction_item_id` 가 없다.
- 답장 하나에 알림 하나다. 바꿀 것이 없는 답장은 알리지 않는다.
- 답장이 말한 태스크의 시계만 닫는다. 바꿀 것이 없는 답장은 후보 시계를 모두 닫는다. 어느 태스크인지 모르면 후보 시계를 멈추고, PM 이 고르지 않은 태스크는 남은 시간부터 다시 센다.

| 요청 | 누가 | 하는 일 |
|---|---|---|
| `GET /api/v1/workspaces/{workspace_id}/messages/threads/{thread_id}/attributions` | PM | 그 대화에서 태스크를 골라야 하거나 고른 답장 `{items, total}` |
| `POST /api/v1/workspaces/{workspace_id}/messages/replies/{message_id}/attribution` | PM | `{task_id}` 로 고른다. null 은 해당 없음이다. 응답 `{message_id}` |
| `GET /api/v1/tasks/{task_id}/timeline` | 소속 팀원 | 답장과 변경을 묶은 태스크 기록. 최신순 `{items, total}` |
| `POST /api/v1/tasks/{task_id}/reply-changes/{change_id}/undo` | PM | 자동 반영을 되돌린다. 응답 `TaskResponse` |

```jsonc
// attributions items[]
{ "message_id": "…", "status": "needs_pm", "candidates": [{ "task_id": "…", "title": "…" }], "task": null }
{ "message_id": "…", "status": "resolved", "candidates": null, "task": { "task_id": "…", "title": "…" } | null }   // task 가 null 이면 해당 없음

// timeline items[]
{ "kind": "reply", "at": "…", "message_id": "…", "member_name": "재환", "channel": "discord" | "web", "body": "…",
  "changes": [{ "change_id": "…", "field": "status" | "due_date" | "assignee" | "scope" | "due_clear" | "failed" | "none", "new_value": "done",
                "evidence_status": "certain" | "inferred" | null, "summary": "…", "evidence_quote": "…",
                "result": "applied" | "undone" | "pending" | "approved" | "rejected" | "noted" | "recorded",
                "undoable": true }] }
{ "kind": "history", "at": "…", "history_id": "…", "changed_field": "due_date", "old_value": "…", "new_value": "…",
  "change_source": "manual" }
```

- 고르면 그 태스크만 후보로 다시 판단한다. 해당 없음이면 닫는다. 지운 태스크는 후보에 나오지 않는다. 후보 밖이거나 지운 태스크는 400 `INVALID_REQUEST`, 판단 기록이 없거나 다른 워크스페이스면 404 `REPLY_JUDGMENT_NOT_FOUND`, 고를 차례가 아니거나 이미 골랐으면 409 `REPLY_ATTRIBUTION_NOT_NEEDED` 다.
- 타임라인에서 답장에 이어진 이력은 답장 아래에만 나오고 `history` 줄이 되지 않는다. 승인은 줄이 아니라 `result` 로 읽는다. 승인하면서 PM 이 고친 값도 같은 줄에 묶이고 `new_value` 는 고친 값이다. `GET /tasks/{id}/history` 는 그대로다.
- `due_clear`·`failed` 는 그 태스크를 말했지만 값을 정하지 못한 줄이다. 값이 없고 `result` 는 `noted` 다.
- 담당자를 찾지 못한 카드를 담당자를 고르지 않고 승인하거나 지금 담당자와 같은 사람을 고르면 `noted` 다. 다른 팀원이나 미정을 고르면 `approved` 이고 `new_value` 는 고른 값(미정이면 `null`)이다. `approved` 는 값이 실제로 바뀐 승인이다. 같은 사람을 고른 경우에도 `payload.task_overrides` 에는 고른 값이 남는다. 담당자를 찾은 카드(payload 에 `assignee_member_id` 가 있음)는 이력이 없어도 `noted` 로 바꾸지 않아, 지금 담당자로 덮어써도 `approved` 다(BE `services/replies.py` 의 `_result`).
- 답장 글(`body`, `summary`, `evidence_quote`)은 대화 주인과 PM 에게만 내려간다. 그 밖의 팀원에게는 null 이다. 답장이 막힘을 뜻해 채운 `Task.blocker` 는 예외다. 원문이 아니라 AI 해석(`summary`)이나 `팀원이 막혔다고 답했어요` 이고 모든 팀원에게 보인다.
- 되돌리기는 `undoable: true` 인 변경만 받는다. 이어진 이력 중 하나라도 그 뒤 바뀌었으면 하나도 되돌리지 않고 409 `REPLY_CHANGE_NOT_UNDOABLE` 이다. 되돌린 이력은 새 `history` 줄로 남고 닫힌 시계는 다시 열리지 않는다. 무응답 자동 막힘을 넘어온 변경을 되돌리면 막힘이 아니라 막기 전 상태와 사유로 돌아가고, 그 값도 `history` 줄로 남는다.
- 알림 `kind` 는 둘이 더해진다.

| `kind` | 받는 사람 | `link.type` | 누르면 가는 곳 |
|---|---|---|---|
| `reply_judged` | PM 전원 | `task` · `thread` | 변경 한 건이면 태스크 상세, 그 밖은 대화. PM 이 고른 뒤 바꿀 내용을 못 찾아도 대화로 온다 |
| `reply_unjudged` | PM 전원 | `thread` | 그 대화. 판단 실패는 바로, 끝나지 않으면 10분 뒤 한 번 |

- ~~MSW 와 다른 점(합의 필요). 메시지 DTO 의 `attribution`, 대화 요약의 `needs_attribution` 은 BE 응답에 없고 새 `…/attributions` 경로로 준다. 고를 차례가 아닌 답장은 MSW 의 404 `MESSAGE_REPLY_NOT_FOUND` 대신 위 오류 코드다. 답장 승인 카드에는 `meeting_id` 가 없다.~~ #315 가 MSW 의 두 칸을 이미 지웠고, #344 에서 MSW 가 위 경로·모양·오류 코드를 그대로 쓴다(아래).

FE 연결 (#344, 2026-11-06). 응답 타입은 [reply.ts](../../src/shared/types/api/reply.ts)가 `schemas/reply.py` 와 칸을 1:1 로 맞춘다.

- 태스크 고르기. PM 이 대화를 열면 `…/attributions` 를 받는다(쿼리 키 `['workspace', id, 'messages', 'threads', thread_id, 'attributions']`, 메시지 행동이 무효화하는 `messages` 접두어 안). 팀원은 부르지 않는다. `needs_pm` 답장 아래에 후보와 `해당 없음` 라디오, `정하기` 가 있고(라디오만 옮겨서는 보내지 않는다), `resolved` 답장 아래에는 `태스크: {제목}` 또는 `해당 없음으로 정했어요` 가 붙는다([ThreadDetail](../../src/widgets/message-inbox/ui/ThreadDetail.tsx)·[AttributionPicker](../../src/widgets/message-inbox/ui/AttributionPicker.tsx)). 고르기는 메시지 쓰기 행동 `attribute` 다. 다른 쓰기처럼 세션을 잡아 끝난 세션이면 보내지 않고, 한 공간에서 한 번에 하나만 나간다. 404 `REPLY_JUDGMENT_NOT_FOUND`·409 `REPLY_ATTRIBUTION_NOT_NEEDED` 는 `이미 처리된 답장이에요. 대화를 다시 불러올게요.` 토스트 뒤 다시 받는다. 고르기를 받지 못해도 대화는 보이고 위에 다시 시도가 붙는다. 대화 목록의 `답장 확인 필요` 표시는 두지 않았다. 목록 응답에 칸이 없고 대화마다 부르면 요청이 대화 수만큼 늘어난다. PM 은 `reply_judged` 알림(`어느 태스크인지 골라 주세요`)으로 그 대화에 온다.
- 태스크 기록. 태스크 상세의 `변경 이력` 이 `/history` 와 `/timeline` 을 함께 받아 `/timeline` 순서대로 그린다. 타임라인의 `history` 칸에는 변경자·되돌림이 없어서 같은 `history_id` 의 `/history` 행으로 채운다. 두 응답은 기존 이력 쿼리 키 `['workspace', id, 'tasks', 'history', task_id]` 하나에 둔다. 상태 변경·승인 처리가 이 키를 정확히 무효화하기 때문이다([taskApi](../../src/entities/task/api/taskApi.ts)). 답장 칸은 `{이름} 답장 · Discord|웹 · 시각`, 답장 글, 바뀐 값 줄(값과 결과 표시 `자동 반영`·`되돌림`·`승인 대기`·`승인함`·`반려함`·`반영하지 않음`·`기록함`, AI 해석)이다. `body` 가 null 이면 `답장 내용은 PM과 답장한 팀원만 볼 수 있어요.` 다. 모르는 `field` 는 `failed`, 모르는 `result` 는 `noted` 로 읽는다.
- 되돌리기. `undoable` 이 true 인 줄에 PM 에게만 `되돌리기` 가 있다. 줄 종류(`field`)나 결과(`result`)를 FE 가 모르면 `undoable` 과 상관없이 없다(#348)([useReplyChangeUndo](../../src/features/reply-change-undo/model/useReplyChangeUndo.ts)). 누를 때 세션을 잡고, 성공하면 응답 태스크를 상세·목록 캐시에 쓰고 `tasks` 접두어 전체(상세·목록·이력)를 무효화한다. 409 `REPLY_CHANGE_NOT_UNDOABLE` 이면 같은 무효화 뒤 `되돌리지 못했어요` 토스트다. 404 `TASK_NOT_FOUND`(보는 사이 지워짐)면 상세를 비우고 다시 받아 `이 태스크를 볼 수 없어요` 로 바꾸고, 이력을 지우고 목록을 다시 받는다.
- 승인. 답장에서 온 `task_update` 는 `replyMessageId` 로 읽는다(`change_source` 가 `reminder_reply` 일 때만). 승인 상세는 `팀원 답장` 칸에 AI 해석(`doc_text`)과 근거 인용, `리마인드 답장 · {이름}` 을 보이고 회의 링크·회의 시각을 만들지 않는다.
- 담당자를 찾지 못한 답장 카드(#344 사용자 결정 2026-11-06, BE #460·PR #503 구현).
  - 판별: payload 에 `reply_message_id` 가 있고, `assignee_member_id` 키가 없고, `assignee_raw` 가 비지 않은 문자열이면 이 카드다([mapper](../../src/entities/approval/model/mapper.ts)의 `assigneePick`). `category` 로 판별하지 않는다. 상태와 담당자가 섞인 카드는 `category` 가 첫 줄 기준이라 다른 값이 오기 때문이다.
  - 화면: 승인 상세에 `답장에서 말한 담당자 {assignee_raw}를 팀원에서 찾지 못했어요. 담당자를 골라 주세요.`(을/를은 이름 받침을 따른다)와 담당자 고르기(미정 포함)가 있다. 고르기는 승인 확인(E-6)의 담당자 칸과 같은 공용 `Select` 조립이다. 고르기 전과 팀원 목록을 받기 전에는 승인이 막히고, 반려는 언제나 된다. 상태와 섞인 카드도 같다(#460 확인할 것 1번, 2026-11-08 결정). 대시보드·태스크 보드의 요약 줄은 `담당자를 골라야 하는 답장이에요` 다.
  - 요청: `PATCH /approvals/{id}` 에 `{"status":"approved","task_overrides":{"assignee_member_id":"<팀원>" | null}}` 를 보낸다. 같은 승인 처리 mutation 이라 세션 경계(끝난 세션의 응답 뒷처리를 버림)도 다른 승인과 같다.
  - 실패: 400 `INVALID_REQUEST`(받지 않는 카드·문자열이 아닌 값), 400 `WORKSPACE_MISMATCH`, 404 `MEMBER_NOT_FOUND`(빈 문자열·없는 팀원·탈퇴자)는 공통 오류 문구로 알리고 카드는 pending 으로 남아 다시 고를 수 있다. 409 `APPROVAL_CONFLICT` 는 기존 충돌 재승인 흐름이다.
  - 범위 밖: 담당자를 찾은 카드에서 다른 사람으로 고치기. BE 는 받지만 화면은 아직 없다.
  - MSW: 답장 판단의 변경 줄에 담당자가 있는 카드만 `assignee_member_id` 를 받고, 그 밖의 `task_update` 는 400 이다. 고른 값은 `manual` 이력으로 남고 답장 줄(`rc`)에 이어진다.
- 알림. `reply_judged` 제목은 `팀원 답장을 판단했어요`, `reply_unjudged` 는 `답장을 자동으로 판단하지 못했어요` 다. 종이 처음 보면 그 공간의 캐시를 다시 받는다. `reply_judged` 는 메시지·태스크(상세·목록·기록)·승인을, `reply_unjudged` 는 메시지·태스크를 받는다. BE 는 태스크를 바꾸고 승인 요청을 만든 뒤 알리고, 판단하지 못한 답장도 막힘을 풀 수 있다. 같은 이유로 `silence_blocked` 는 태스크를 받는다([display.ts](../../src/entities/notification/model/display.ts)의 종류 표). 링크는 기존 `task`·`thread` 경로다.
- 검증. MSW 기준 단위·화면 테스트와 E2E `reply-judgment.e2e.ts` 3개. 실제 서버와 봇의 다시 판단은 확인하지 않았다.

**MSW 동작 (리마인드 답장 판단).** [reply-state.ts](../../src/shared/mock/reply-state.ts)가 판단 결과(`judgments`·`changes`)와 답장 줄에 이어진 이력(`historyLinks`)을 들고 BE `attributions`·`attribute`·`timeline`·`undo_change`·`link_history` 를 따른다. 판단 자체(봇·AI)와 PM 이 고른 뒤의 다시 판단, 무응답 자동 막힘을 넘어온 변경의 막기 전 상태 복원은 흉내 내지 않는다. 시나리오 `reply-judgment`(PM)·`reply-judgment-member`(팀원)가 결과를 넣는다. 모의 DB 버전이 14 가 되었다.

**MSW 동작 (임시, 합의 전).** 아래는 개발 서버 목의 현재 구현이다. 백엔드와 합의한 규약이 아니고, 합의 여부 확인 필요. 재촉 자동 승인은 목에서 꺼져 있으며, 예약 시각이 지나도 스스로 나가지 않는다.

**메시지·알림 설정** (#339 에서 BE 구현, #340 에서 FE 설정 화면 연결). 결정 근거는 [결정 기록](../../../backend/docs/plan/m6/basis-for-decision/2026-11-04-message-settings.md).

| 요청 | 누가 | 하는 일 |
|---|---|---|
| `GET /api/v1/workspaces/{workspace_id}/message-settings` | 소속 팀원 | 현재 설정. 소속이 아니면 403 |
| `PATCH /api/v1/workspaces/{workspace_id}/message-settings` | PM | 보낸 키만 바꾸고 바뀐 설정 전체를 돌려준다. 일반 팀원은 403 `FORBIDDEN` |

- 요청(PATCH). 아래 6개 중 보낸 키만 바꾼다.
  - `due_reminder`, `minutes_summary`, `silence_alert`, `reminder_auto_approve`: bool
  - `nudge_rule`: `{days_before: 0~3, hour: 0~23}` 객체째 보낸다. 한국 시간이고 마감 `days_before` 일 전 `hour` 시에 나간다
  - `pm_alert_method`: `web` · `discord_dm` · `both`
- 400 `INVALID_REQUEST`: 빈 본문, `null`, 범위 밖 값, 모르는 값, 모르는 키(`nudge_rule` 안 포함). 새 오류 코드는 없다.
- 응답 `data`(GET·PATCH 같다):

```json
{
  "due_reminder": true,
  "minutes_summary": true,
  "silence_alert": true,
  "nudge_rule": {"days_before": 1, "hour": 9},
  "pm_alert_method": "both",
  "reminder_auto_approve": false,
  "saved": false,
  "updated_at": null,
  "updated_by": null,
  "pms": [{"member_id": "…", "name": "…", "discord_linked": false}]
}
```

- 저장한 적이 없으면 위 기본값이고 `saved: false`, `updated_at`·`updated_by` 는 null 이다. `updated_by` 는 바꾼 PM 의 `member_id` 다.
- `pms` 는 PM 알림 방식 화면에 쓴다. `discord_linked` 는 워크스페이스에 Discord 연동이 있고 그 PM 의 `discord_user_id` 가 있을 때 true 다.

현재 구현.

- `due_reminder` 를 끄면 스케줄러가 재촉을 제안하지 않고 제안 기록도 남기지 않는다. 다시 켜면 제안 창 안의 태스크부터 제안한다. PM 이 직접 만든 재촉과 그 `reminder_sent` 알림은 영향이 없다.
- `nudge_rule` 은 스케줄러가 만드는 재촉의 발송 시각을 정한다. 제안 시점(발송 3일 전)은 고정이다.
- `silence_alert` 를 끄면 72시간 무응답 막힘 알림(`silence_blocked`)만 PM 에게 나가지 않는다. 막힘 전환·되돌리기는 그대로다.
- 설정을 바꿔도 이미 만든 제안·묶음은 그대로다. 새 설정은 아직 제안되지 않은 것부터 적용한다. 예외는 자동 승인이 켜진 채 `due_reminder` 를 끈 경우다. 끄기 전에 만든 스케줄러 제안만 든 묶음은 발송 시각에 자동으로 나가지 않는다. PM 이 직접 넣은 재촉과 한 묶음이면 스케줄러 제안은 취소되고 PM 재촉만으로 문구를 다시 만들어 나간다(#341 리뷰, #340 의 2026-11-05 BE 댓글, [결정 기록](../../../backend/docs/plan/m6/basis-for-decision/2026-11-04-message-settings.md)).
- `reminder_auto_approve` 를 켜면 승인 전 묶음을 발송 시각에 승인해 보낸다. 켠 뒤 발송 시각이 오는 재촉만 대상이고, 켜기 전에 시각이 지난 묶음은 보내지 않는다. PM 이 직접 만든 재촉이 든 묶음도 포함한다. 자동 승인된 묶음은 `approved_by` 가 null 이다. 켜진 동안 제안 알림 문구는 "발송 시각에 자동으로 나가요" 계열로 바뀐다.
- AI 초안이 발송 시각 전에 오지 않으면 자동 승인 때 규칙 문구가 나간다.
- PM 알림 방식은 지금 항상 웹이다. PM DM 경로가 없어서 `pm_alert_method` 는 저장만 하고 알림이 달라지지 않는다.
- `minutes_summary` 는 저장만 한다. #회의록 요약을 게시하는 봇이 읽는 경로가 없다.

FE 연결 (#340, 2026-11-05).

- 설정 화면의 알림 절([NotificationSection](../../src/pages/settings/ui/NotificationSection.tsx))이 `GET` 으로 값을 읽고, PM 이 바꾸면 `PATCH` 로 바꾼 키만 보낸다. `nudge_rule` 은 객체째 보낸다. 응답 타입은 [messageSettings.ts](../../src/shared/types/api/messageSettings.ts)가 `schemas/message_settings.py` 와 칸을 1:1 로 맞추고, 매퍼([entities/message-settings](../../src/entities/message-settings/model/mapper.ts))가 화면 이름(camelCase)으로 바꾼다. 쿼리 키는 `['workspace', id, 'message-settings']` 다. 메시지 행동이 무효화하는 `messages` 접두어 밖에 둔다.
- 변경은 한 공간에서 한 번에 하나씩 순서대로 나간다(TanStack mutation `scope`). 응답 전에는 진행 중인 변경을 서버 값 위에 겹쳐 보인다. 실패(403·400·5xx 등)하면 그 변경의 겹침만 사라져 값이 돌아오고 토스트 `알림 설정을 저장하지 못했어요` 가 뜬다. 성공하면 응답 전체를 캐시에 쓴다.
- 일반 팀원은 모든 토글·재촉 규칙·PM 알림 방식이 비활성(읽기 전용)이다.
- 재촉 규칙은 `며칠 전`(마감 당일·하루 전·2일 전·3일 전)과 `몇 시`(00:00~23:00 정시 24개, 야간 제한 없음) 두 선택이다. 토글 제목이 규칙을 따른다(`마감 2일 전 18:00에 담당자에게 DM`). 메시지 화면의 마감 기준 보낼 시각도 같은 규칙을 쓴다(§5.7 위 `현재 구현 (#315…)`).
- `웹으로만` 안내(D-177)는 `pms[].discord_linked` 로만 정한다. 모든 PM 이 false 면 `Discord가 연결되지 않아 웹으로만 알려요`, 일부만이면 그 PM 이름을 붙인다(`김PM님은 …`).
- 이미 만든 제안이 그대로라는 안내를 절 설명에 둔다. 자동 승인이 켜진 채 `due_reminder` 가 꺼져 있으면 위 예외 문구로 바꾼다.
- 저장만 되는 두 항목(`pm_alert_method`·`minutes_summary`)에는 준비 중이라 저장만 된다는 짧은 문구를 붙였다.
- 자동 승인된 묶음의 `approved_by: null` 을 보일 곳은 없다. 메시지 화면은 승인자를 보이지 않는다(위 `현재 구현 (#315…)`).

합의 상태. D-174 가 설정 항목과 권한(PM 만 변경)을 정했고 이 절의 경로·모양은 #339 설계 확정 댓글에서 정했다. 재촉 규칙 범위(0~3일 전, 0~23시 정시, 야간 제한 없음)와 이미 만든 제안 안내는 FE 결정으로 2026-11-05 사용자가 정했다. PM DM 과 요약 게시가 생길 때 위 두 저장 항목이 동작에 쓰이는지는 합의 필요.

**MSW 동작 (메시지·알림 설정).** [handlers/messageSettings.ts](../../src/shared/mock/handlers/messageSettings.ts)가 위 경로를 흉내 낸다. 저장 전에는 기본값과 `saved: false`, 처음 `PATCH` 때 행을 만든다. `GET` 은 소속 팀원, `PATCH` 는 PM(아니면 403 `FORBIDDEN`)이다. 빈 본문·모르는 키(`nudge_rule` 안 포함)·`null`·범위 밖 값·`"true"`·`1`·`9.0` 같은 다른 타입은 400 `INVALID_REQUEST` 다. `pms[].discord_linked` 는 공간의 Discord 연동이 `not_connected` 가 아니고 그 PM 의 `discord_user_id` 가 있을 때 true 다. 스케줄러 동작(제안·자동 승인)은 흉내 내지 않는다. 모의 DB 버전이 10 이 되었다.

**MSW 동작.** 개발 서버·테스트의 목([handlers/message.ts](../../src/shared/mock/handlers/message.ts))은 위 백엔드 경로·응답 모양·오류 코드를 그대로 쓴다(#315).

- 흉내 내는 것: 승인 때 `draft_version` 비교(다르면 409 `BUNDLE_CHANGED`, 이미 승인했으면 그대로 200), 지난 시각 승인·시각 고치기 409 `REMINDER_SCHEDULED_AT_PASSED`, 예정이 아닌 묶음 409 `REMINDER_NOT_EDITABLE`, 없는 묶음 404 `REMINDER_BUNDLE_NOT_FOUND`, 문구를 고치면 `body_source: pm`·판 올림·승인 유지, 시각만 옮기면 판 그대로, 팀원에게 `bundles: null`, 남의 대화 조회·답장 403 `FORBIDDEN`(PM 의 답장 포함), 시간대 없는 `scheduled_at` 400, 시각은 UTC 로 응답.
- 흉내 내는 것(묶음 합치기, #368): 옮긴 시각에 같은 대화의 예정 묶음이 있으면 리마인드를 그 묶음으로 옮기고 합쳐진 묶음을 돌려준다. 두 묶음 모두 문구를 규칙대로 다시 만들고 판을 올리고 승인을 푼다. 리마인드가 남지 않은 옮긴 묶음은 `cancelled` 다. 합쳐지는 시각으로 옮기면서 문구를 같이 보내면 400 `INVALID_REQUEST` 다. 시나리오 `messages-merge` 가 합치기를 재현한다.
- 흉내 내는 것(재촉 만들기·리마인드 고치기·빼기, #370): 세 경로 모두 PM 만(403 `FORBIDDEN`), 본문 검사 400 `INVALID_REQUEST`, 없는 태스크·팀원 404 `TASK_NOT_FOUND`·`MEMBER_NOT_FOUND`, 없는 리마인드 404 `REMINDER_NOT_FOUND`, 예정이 아닌 리마인드 409 `REMINDER_NOT_EDITABLE`, 지난 시각 409 `REMINDER_SCHEDULED_AT_PASSED` 를 백엔드 순서대로 낸다. 만들기는 그 팀원의 대화가 없으면 만들고 같은 시각의 예정 묶음에 넣는다. 같은 태스크가 이미 있으면 그 리마인드를 그대로 돌려준다. 빼기·메모·더하기는 문구를 다시 만들고 판을 올리고 승인을 푼다. 리마인드가 다 빠진 묶음은 `cancelled` 이고 마지막에 함께 뺀 리마인드만 싣는다. 리마인드에 `cancelled_at` 을 두어 모의 DB 버전이 11 이 되었다.
- 흉내 내지 않는 것: 스케줄러의 발송·만료·자동 취소, AI 초안 도착, 봇 경로. 목의 시각은 늘 고정 시각이라 연달아 뺀 리마인드의 취소 시각이 같다.

**프론트엔드가 정한 정책** (D-174, 백엔드·AI 합의 여부 확인 필요). 서버가 해 줘야 하는 일만 적는다. 정책 전문은 D-174 에 있다.

- 메시지 기록이 원본이다. 백엔드가 기록을 만들면 웹은 그 기록을 조회해 보여 주고, Discord 봇은 같은 기록을 DM 으로 전달한다. 웹 답장은 웹에만 기록하고 Discord 로 보내지 않는다.
- 발송 대상과 시점
  - 태스크 안내: `gate=auto` 태스크는 생성 즉시 보내고, 확인 필요는 승인했을 때 보낸다. 한 회의록의 자동 반영분은 수신자별로 묶어 한 통으로 보낸다.
  - 진행 재촉: AI 가 제안하고 PM 이 승인하면 보낸다. 설정에서 자동 승인을 켤 수 있다. 수신자와 발송 시각이 같은 재촉은 합치고, `지금 바로` 는 5분 동안 모아 보낸다.
  - #회의록 요약: 정리가 끝나면 올린다. 확인 필요 항목은 개수만 싣는다.
- 스케줄러는 백엔드에 둔다. 맡는 일은 다음과 같다.
  - 발송 예정 3일 전에 재촉 제안
  - 발송 직전 응답 재확인과 자동 취소
  - 72시간 무응답 시 막힘 전환과 PM 알림(웹 / DM / 둘 다)
  - 서버가 멈춰 놓친 예약: 마감일 전이면 다시 확인한 뒤 보내고, 지났으면 만료
- 답장이 어느 태스크에 대한 것인지는 AI 가 판정한다. 판정하지 못하면 PM 이 확인하는데, 그동안 72시간 시계를 멈춘다.
- 권한
  - 재촉의 승인·수정·취소·시각 선택, 답장 판정, 메시지 설정 변경은 PM 만 할 수 있다.
  - 일반 팀원은 자기 대화만 조회하고 답장할 수 있다.
- 화면에 필요한 메시지 상태: `예정` · `발송됨` · `취소됨` · `만료됨`, 그리고 `답장 확인 필요`.

실제 API 는 #315 에서 연결했다. ~~D-117(메시지 E2E)과 D-136(polling)은 이번에도 하지 않았다.~~ **2026-11-06(#371).** D-136 은 위 `다시 받기` 로, D-117 은 MSW 기준 E2E 로 정했다.

### 5.8 워크스페이스 관리 · 설정

| 화면 | 호출 | 상태 |
|---|---|---|
| 연결 상태·해제 | `GET`·`DELETE /workspaces/{id}/integrations` | **구현됨** §4.3 |
| 팀원 목록·수정 | `GET /members?workspace_id=`, `PATCH /members/{id}` | **구현됨** §2.2 |
| 미매칭 이름 붙이기 | `GET /members/unresolved-aliases`, `POST /members/{id}/aliases` | **구현됨** §2.2 |
| 별칭 삭제 | `DELETE /members/aliases/{alias_id}` | **구현됨** §2.2 |
| 팀원별 별칭 보기·추가·삭제 | `GET /members/aliases`, `POST /members/{id}/aliases`, `DELETE /members/aliases/{alias_id}` | **구현됨(#523, 2026-11-08).** 설정 목차의 「팀원」이 여는 팀 화면에서 팀원 줄의 「별칭 N」을 펼친다. 칩마다 출처 꼬리표(`learned` 회의에서 배움, `display_name` 이름, `discord_profile` 디스코드, `manual` 직접 추가, 미확인이면 「· 미확인」). 추가·삭제는 PM 만 보인다. 본문은 `alias_text` 만 보낸다. 실패 문구는 오류 코드별이다([aliasMessages](../../src/features/member-alias/lib/aliasMessages.ts)). 같은 글자를 다시 넣으면 서버가 기존 행을 돌려주므로 「이미 있는 별칭이에요.」 로 보인다. MSW 기준 검증, 실서버 미검증 |
| 건너뛴 온보딩 마저 하기 | 5.3 과 같다 | |
| 팀원 초대·취소·연결 끊기 | `GET`·`POST /workspaces/{id}/invitations`, `POST /invitations/{id}/cancel`·`revoke` | FE·BE 구현. 소비 코드와 미검증 범위는 §5.9 |
| 알림(메시지·알림 설정) | `GET`·`PATCH /workspaces/{id}/message-settings` | **구현됨** §5.7 (#340) |
| 회의 채팅 채널(PM) | `GET /workspaces/{id}/discord/channels`, `PUT`·`DELETE .../integrations/discord/chat-channel` | **구현됨** §4.3.1 (#428, #429) |

- `unresolved-aliases` 가 쓰이는 곳이 여기다. 온보딩의 팀원 연결과 목적이 다르다 (§4.5).
- 그 밖의 설정 항목은 결정 대기다.

### 5.9 팀원 초대

**현재 초대 API·FE 연결** (2026-11-09 소스 대조). #319에서 BE를 구현했고 현재 FE도 아래 API를 소비한다. 화면 쪽 합의 여부와 실제 계정 검증은 코드 연결과 구분한다. 결정 근거는 [결정 0036](../../../ai/docs/basis_for_decision/ai/2026-11-04-0036-member-invite-by-email.md). FE 요청 이슈는 #320, 제품 흐름은 #302.

현재 소비 근거는 [초대 Query](../../src/entities/invitation/api/invitationQueries.ts), [초대 명령](../../src/entities/invitation/api/invitationMutations.ts), [PM 제어](../../src/features/member-invite/ui/MemberInviteControl.tsx), [내 초대](../../src/widgets/app-shell/ui/MyInvitations.tsx), [수락·거절 처리](../../src/features/invitation-respond/model/useInvitationResponse.ts)다. PM 목록은 팀원별 최신 초대를 고르고 생성·취소·연결 끊기 뒤 목록을 다시 받는다. 내 초대는 수락 뒤 공간 목록을 새로 받아 이동한다. 코드와 [화면 회귀](../../src/app/invitationRespond.test.tsx)를 대조했으며 이번 문서 작업에서 이를 다시 실행하거나 실서버 성공으로 판정하지 않았다.

온보딩에서 디스코드 명단으로 만든 팀원은 로그인 계정과 이어져 있지 않다(`member.user_id` 가 null). PM 이 그 팀원에게 가입 이메일로 초대를 만들고, 그 이메일로 로그인한 사람이 내 초대에서 수락하면 팀원과 계정이 이어져 워크스페이스 목록에 나타난다. 수락 전에는 그 워크스페이스의 API 가 모두 403 이다. 초대 메일은 보내지 않는다. PM 이 디스코드 등으로 알리고, 팀원은 로그인하면 내 초대에서 본다.

| 요청 | 누가 | 하는 일 |
|---|---|---|
| `POST /workspaces/{workspace_id}/invitations` → 201 | PM | 초대 만들기 `{member_id, email}`. 같은 팀원에게 대기 중인 초대가 있으면 그 초대를 취소하고 새로 만든다 |
| `GET /workspaces/{workspace_id}/invitations` | PM | 이 워크스페이스의 초대 전부, 최근 것부터 |
| `POST /invitations/{invitation_id}/cancel` | PM | 수락 전 초대 취소 |
| `POST /invitations/{invitation_id}/revoke` | PM | 수락한 계정과 팀원의 연결 끊기 |
| `GET /invitations/me` | 로그인 사용자 | 내 가입 이메일로 온 대기 중 초대, 최근 것부터 |
| `POST /invitations/{invitation_id}/accept` | 받는 사람 | 수락. `{workspace_id, member_id}` 를 돌려준다 |
| `POST /invitations/{invitation_id}/decline` | 받는 사람 | 거절. `{invitation_id, status: "declined"}` |

- PM 쪽 응답(만들기·목록 한 줄·취소·연결 끊기)은 `{invitation_id, member_id, member_display_name, email, status, invited_by_name, accepted_user, created_at, responded_at}` 이다.
  - `accepted_user` 는 수락한 계정 `{user_id, name, email}` 이고 수락 전에는 null 이다. 연결을 끊은 뒤에도 남아 누가 들어왔었는지 보인다. PM 은 이 이름·이메일을 보고 엉뚱한 계정이면 연결을 끊는다.
  - `responded_at` 은 마지막으로 상태가 바뀐 시각이다. 연결을 끊으면 수락 시각 대신 끊은 시각이 된다.
- 내 초대 한 줄은 `{invitation_id, workspace_id, workspace_name, member_display_name, invited_by_name, created_at}` 이다. 초대보다 먼저 가입했든 나중에 가입했든 같은 기준(가입 이메일)으로 찾는다.
- 이메일은 대소문자와 앞뒤 공백을 무시하고 비교한다. 초대의 `email` 은 소문자로 바꿔 저장하고 돌려준다. 이메일 형식이 아니면 400 `INVALID_REQUEST`.
- 상태와 화면 표기(제안)

  | `status` | 화면 | 뜻 |
  |---|---|---|
  | `pending` | 대기 | 받는 사람이 아직 답하지 않았다 |
  | `accepted` | 수락 | 팀원과 계정이 이어졌다 |
  | `declined` | 거절 | 받는 사람이 닫았다. PM 이 그 사람에게 확인할 신호다 |
  | `canceled` | 취소 | PM 이 수락 전에 닫았거나, 같은 팀원에게 새 초대를 만들어 닫혔다 |
  | `revoked` | 연결 끊김 | PM 이 수락 뒤 연결을 끊었다. 팀원 행과 태스크·이력은 그대로고 `member.user_id` 만 null 로 돌아간다 |

- 만료는 없다. 이메일 고치기 API 는 없고, 같은 팀원에게 다시 초대하면 대기 중인 초대가 `canceled` 가 된다. 거절·취소·연결 끊김 뒤에는 다시 초대할 수 있다. 연결을 끊은 팀원의 역할이 PM 이면 팀원으로 되돌린 뒤 초대한다.
- 수락한 팀원의 권한은 기존 팀원 권한 그대로다. 기존 API 에서 바뀐 것은 아래 `PATCH /members/{id}` 의 역할 변경 하나다.
- 탈퇴한 팀원의 초대는 내 초대에 나오지 않고 수락할 수 없다(409 `INVITATION_NOT_PENDING`). PM 목록에는 남는다.
- 대기 초대가 있는 팀원은 PM 으로 올릴 수 없다. `PATCH /members/{id}` `{role: "pm"}` 이 409 `MEMBER_HAS_PENDING_INVITATION` 이고 역할과 초대는 그대로다. 받는 사람이 수락한 뒤 올리거나, 초대를 취소한 뒤 올린다. 역할 외의 수정은 막지 않는다.
- 오류

  | 코드 | 상태 | 언제 |
  |---|---|---|
  | `FORBIDDEN` | 403 | PM 이 아닌 사람이 PM 쪽 요청을 했다 |
  | `MEMBER_NOT_FOUND` | 404 | 만들기에서 팀원이 없거나, 이 워크스페이스 팀원이 아니거나, 탈퇴했다 |
  | `MEMBER_ALREADY_LINKED` | 409 | 이미 로그인 계정이 이어진 팀원이다(만들기·수락) |
  | `ALREADY_WORKSPACE_MEMBER` | 409 | 그 이메일의 계정, 또는 수락하려는 내가 이미 이 워크스페이스의 팀원이다 |
  | `EMAIL_ALREADY_INVITED` | 409 | 같은 이메일로 다른 팀원에게 보낸 초대가 대기 중이다 |
  | `PM_MEMBER_NOT_INVITABLE` | 409 | 이 워크스페이스에서 역할이 PM 인 팀원을 초대하려 했다. 팀원으로 초대하고, 수락한 뒤 PM 으로 바꾼다. 다른 워크스페이스의 역할과는 상관없다 |
  | `MEMBER_HAS_PENDING_INVITATION` | 409 | 대기 초대가 있는 팀원을 PM 으로 올리려 했다(`PATCH /members/{id}`) |
  | `INVITATION_NOT_FOUND` | 404 | 초대가 없다. 수락·거절에서는 내 이메일로 온 초대가 아니어도, 취소·연결 끊기에서는 그 워크스페이스 소속이 아니어도 이 코드다(소속이지만 PM 이 아니면 403 `FORBIDDEN`) |
  | `INVITATION_NOT_PENDING` | 409 | 대기 중이 아닌 초대를 수락·거절·취소했다 |
  | `INVITATION_NOT_ACCEPTED` | 409 | 수락하지 않은 초대의 연결을 끊으려 했다 |
  | `LAST_PM_REQUIRED` | 409 | 끊으면 로그인할 수 있는 PM 이 없어진다 |

- 한 계정이 한 워크스페이스에서 두 팀원이 되지 않는다. 한 팀원에 대기 초대 하나, 한 워크스페이스에서 같은 이메일의 대기 초대 하나만 DB 가 허용하고, 수락할 때 이미 소속인지 다시 확인한다. 같은 초대를 동시에 수락하면 한 계정만 이어진다. 같은 이메일의 다른 초대가 수락되는 순간 새 초대를 만들면 드물게 수락할 수 없는 대기 초대가 생긴다. 그 초대를 수락하면 409 `ALREADY_WORKSPACE_MEMBER` 이고, PM 이 취소하면 된다. 연결을 끊으면 같은 이메일의 대기 초대도 함께 `canceled` 가 된다.
- 팀원이 온보딩(워크스페이스 만들기)을 건너뛰고 초대를 기다리는 데 새 백엔드 API 는 필요 없다. 초대를 기다리는 사용자는 `GET /auth/me` 의 `workspace_count` 가 0 이고 `GET /workspaces` 가 빈 목록 `{"items": [], "total": 0}` 이다.

### 착수 가능 여부 요약

아래는 M1 착수 당시의 판단 기록이다. 로그인·연결·온보딩·회의·메시지의 현재 구현 여부는 문서 앞 「후속 구현 상태 대조」와 각 §5의 갱신된 표를 기준으로 확인한다.

| 영역 | M1 착수 | 막는 것 |
|---|---|---|
| 5.4 대시보드 | **가능** | 없음 — 회의 목록도 구현됐다 |
| 5.6 태스크 (목록·상세·확인 필요) | **가능** | 없음 — 전부 구현됨 |
| 5.8 워크스페이스 설정 (팀원 부분) | **가능** | 없음 |
| 5.2 워크스페이스 선택·온보딩 | 가능 | 온보딩 저장이 서버 스텁이라 계속 mock (§4.0-②-3) |
| 5.3 연결 화면 | 가능 | 전부 mock |
| 5.5 회의 | 가능 | 업로드·회의록 본문 mock |
| 5.1 로그인 | 가능 | 전부 mock |
| 5.6 보드·간트 | **가능** | 없음 — D-170·D-175 로 확정 |
| 5.7 메시지 | 가능 | 메시지 API 는 BE 구현(§5.7), #315 에서 production 화면을 실제 API 에 연결했다 (D-174) |
| 5.9 팀원 초대 | 가능 | 없음. 초대 API 는 BE 구현(§5.9) |

---

## 6. 도메인 모델

화면은 DTO 를 직접 참조하지 않는다. `entities` 계층에서만 DTO 를 다루고 변환한다 (D-133, D-134). 2026-11-08 부터 DTO 타입은 zod 응답 스키마에서 만들고 entity 경계에서 검증한다(D-184 가 D-134 대체, 맨 위 「응답 검증과 새 값 배포 순서」).
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
- **`확인 필요` 판정** — 승인·반려 어느 쪽으로 닫혀도 `approval_id` 가 남고(②-12), 수정 항목은 승인 전에도 `task_id` 가 있다(#419). 반영 여부는 `approval_status` 로 본다.
  - `appliedItems(extraction)` — `task_id != null && (approval_id == null || approval_status == 'approved')`.
  - `isUnresolved(item)` = `approval_id != null` 이고 반영되지 않았다. 대기와 반려를 모두 포함한다.
    일반 팀원 화면(`visibleItems`)은 이것으로 숨긴다. 둘 다 숨기는 것이 맞기 때문이다.
  - `pendingItems(extraction, openApprovalIds)` — PM 전용. 반영되지 않았고 `approval_status != 'rejected'` 인 항목 중 `GET /approvals?status=pending` 의 ID 집합에 있는 것만 고른다. 두 조회의 갱신 시점이 달라 대기 목록에 반려된 ID 가 남아도 빠진다. `null` 은 대기 목록을 따른다.
    `entities → entities` 를 피해 **`ReadonlySet<string>` 만 받고**, 그 집합은 두 엔티티를 모두 보는 `widgets` 가 만든다.

---

## 7. MSW

- 로컬 개발·Vitest·E2E 가 같은 핸들러를 공유한다. production 번들에서 제외한다 (D-146, Storybook 은 #482 에서 지웠다).
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

- ~~태스크 목록의 정렬·페이지네이션 정책.~~ **2026-11-03 해소** (D-175).
  1차는 전량 조회이고 정렬 선택은 클라이언트에서만 한다. 백엔드에 요청할 것은 없다.
  나중에 페이지네이션을 도입하면 §3.2 의 탭 필터링, §4.6 의 대시보드 조립, D-161 의 `전체` 탭 병합, 보드·간트가 **함께** 깨진다는 경고는 그대로 유효하다.
- ~~메시지 화면의 정책.~~ **2026-11-03 프론트엔드 입장 확정** (D-174). 백엔드·AI 에 요청할 것은 아래 「2026-11-03 에 새로 열린 것」에 있다.
- 워크스페이스 관리·설정의 개별 항목. 팀원 부분은 §5.8 에서 확정했다.
- ~~로그아웃의 **이동 경로.**~~ **2026-11-03 해소.** 로그인 화면으로 보낸다 (D-177). 동작은 PR #59 로 정해졌다 — `session` 행 삭제 + 쿠키 삭제다.

**2026-09-21 에 새로 열린 것.**

- **M4·M5 를 실 API 로 완결할 수 있는가.** §4.0-② 의 스텁 4건(온보딩 저장, Discord 사용자 목록, 회의록 본문, 업로드)이
  그때까지 채워지지 않으면 해당 화면은 MSW 로 만들고 연결을 미룬다. 어느 쪽이든 **화면 코드는 같다** — mapper 가 형태를 이미 맞춰 뒀다.
- **actor 를 누가 싣는가.** 세션이 생겼으므로 `created_by`·`changed_by`·`resolved_by` 를 서버가 유추할 수 있다.
  바꾸면 프론트엔드의 요청 본문이 줄어든다. 백엔드가 정할 일이라 여기서는 요청만 올린다 (§4.0-③).

**2026-11-03 에 새로 열린 것.** 아래는 모두 D-174·D-177 에서 나온 요청이다. **합의 여부를 확인해야 한다.** 엔드포인트 모양은 정하지 않았다.

- **백엔드**
  - 메시지 기록 API: 대화 목록과 사람별 대화 조회, 재촉 제안의 승인·수정·취소·시각 변경, 팀원의 웹 답장, 답장의 태스크 판정 입력. 권한은 D-174 정책 4 를 따른다.
    2026-11-04 #310 에서 답장의 태스크 판정 입력을 뺀 나머지를 BE 가 구현했다(§5.7).
  - 스케줄러: 예약 발송, 5분 합치기, 3일 전 제안, 발송 직전 재확인, 72시간 판정과 시계 멈춤, 놓친 예약 처리.
  - ~~알림 설정 저장 API: 알림 세 토글, 재촉 규칙, PM 알림 방식(웹 / DM / 둘 다), 재촉 자동 승인.~~
    **2026-11-04 BE 구현** (#339, §5.7 의 **메시지·알림 설정** 항목). **2026-11-05 FE 설정 화면 연결** (#340). 그 전에는 설정 화면이 이 값들을 화면 안에서만 바꿨다([M8-B 근거](../plan/m8/basis-for-decision/2026-10-31-settings-team-follow-design-canvas.md)).
  - PM 의 Discord 가 연결되지 않았을 때 PM 알림을 웹으로만 보내는 판정 (D-177).
- **AI·봇**
  - 봇의 DM 발송과 DM 답장 수신, 그리고 받은 답장을 백엔드로 넘기는 일. 현재 봇(`ai/capture/notify.py`)은 녹음 채널에 진행 알림만 보낸다.
  - 답장 내용으로 대상 태스크를 판정하고, 판정하지 못한 경우를 표시하는 일.
  - 재촉 문안 제안과 #회의록 요약 게시.

---

## 참고

- 결정 기록: `frontend/docs/decision/frontend-decisions.md` (특히 D-160~D-168)
- 개발 계획: [프론트엔드 전체 계획](../plan/frontend-plan.md)
- 백엔드 실행과 Swagger: `backend/README.md`
