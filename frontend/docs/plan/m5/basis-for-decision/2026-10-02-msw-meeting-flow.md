# MSW 회의 정리 흐름 — 시간 없이 단계를 어떻게 진행시키는가

- 날짜: 2026-10-02
- 상태: 결정

## 고민

업로드한 회의는 서버에서 `processing` → `done` | `failed` 로 바뀐다. MSW 에서 이걸 흉내 내야 업로드 → 정리 → 회의록 흐름을 끝까지 볼 수 있다.

- msw-guide 의 규칙은 handler 에 `Date.now()`·`Math.random()`·`delay()` 를 넣지 말라고 한다. 시간이 흐르면 바뀌는 방식은 못 쓴다.
- Vitest 의 기존 계약 테스트는 상태를 손으로 바꾼다(`db.meetings[2].status = 'done'`). 회의가 저절로 끝나면 기존 테스트가 흔들린다.
- 브라우저 데모는 단계가 하나씩 보여야 하고, E2E 는 기다림 없이 끝나야 한다. 둘의 요구가 반대다.
- 완료 결과(회의록·추출·태스크·승인)는 서로 같은 ID 로 이어져야 한다. 따로 만들면 회의록 화면의 「반영된 태스크」·「확인 필요」 조인이 어긋난다.

## 고른 길

**상세 조회가 시계다.** `GET /meetings/{id}` 가 답하기 전에 `tickMeeting()` 으로 처리 중 회의를 한 번 진행한다.
진행 방식은 `db.meetingFlow.mode` 다(`shared/mock/db.ts`).

| mode | 상세 조회 한 번에 | 쓰는 곳 |
|---|---|---|
| `manual` | 아무것도 하지 않는다 | **Vitest 기본값**, 기존 시나리오 5개 |
| `staged` | 한 단계 (`audio_merged` → `transcribed` → `extracted` → `done`) | 브라우저 데모 |
| `instant` | 바로 `done` | E2E |
| `fail` | 바로 `failed` | 실패 흐름 |
| `fail-notion-revoked` | `failed` + 그 공간 Notion `revoked` | D-099·D-100 |

처리 화면이 3초마다 상세를 부르므로 `staged` 는 3초 간격으로 단계가 보인다. 시각은 쓰지 않는다.

**공통 도우미** — `shared/mock/meetingFlow.ts`. 모두 `state` 를 받는다(기본 `db`). 시나리오는 아직 `db` 에 넣지 않은 상태를 넘긴다.

- `advanceMeeting(id)` — 한 단계. 세 단계가 끝났으면 완료한다.
- `completeMeeting(id)` — 한 번에 만든다:
  - 회의: `done`, `extraction_id`, `progress` 셋 다 `true`, `ended_at = MOCK_NOW`
  - 회의록 본문: 업로드가 받은 참석자(`db.meetingFlow.attendees`)로 참석자·발화자를 채운다. 없으면 그 공간 팀원을 목록의 참석자 수만큼
  - 추출 결과: 항목 셋 — `auto` 1(태스크 생성, `notion_page_id` 채움 — D-101), `review`·`hold` 각 1(대기 승인 생성)
  - 연결: `item.task_id ↔ task.meeting_id`, `item.approval_id ↔ approval.payload.{extraction_item_id, meeting_id}`. 생성 승인을 승인하면 기존 승인 handler 가 그 항목에 태스크를 잇는다
  - ID: `nextId(…, 90)` — 픽스처(`ex_01`·`it_06`·`ap_03`)와 겹치지 않는다. 태스크는 `task-state.createTask` 를 그대로 쓴다
- `failMeeting(id, { notionRevoked })` — `failed`. 회의록·추출·태스크·승인을 만들지 않는다(D-091, D-099). 실패 회의는 목록 handler 가 이미 뺀다(D-093).
- `setMeetingFlowMode(mode)`

**참석자만 남기고 파일은 남기지 않는다.** 업로드 handler 는 `attendee_member_ids` 를 `db.meetingFlow.attendees[meetingId]` 에 적는다. 실 API 는 버리지만(계약 §4.0-②-9) 회의록을 만들려면 필요하다. 파일은 `formData()` 로 읽고 버린다 — db 에도 sessionStorage 에도 원본이 없다.

**시나리오** — `?msw-scenario=<이름>` (`shared/mock/scenarios.ts`). 모두 픽스처 계정 `pm@example.com` / `mock-password`, `ws_01` 하나에 로그인한다.

| 시나리오 | 역할 | mode | Notion | mt_10 |
|---|---|---|---|---|
| `meeting-demo` | PM | `staged` | connected | 완료해 둠 |
| `meeting-instant` | PM | `instant` | connected | 완료해 둠 |
| `meeting-fail` | PM | `fail` | connected | 완료해 둠 |
| `meeting-fail-notion-revoked` | PM | `fail-notion-revoked` | connected → 실패 때 revoked | 완료해 둠 |
| `meeting-notion-not-connected` | PM | `instant` | not_connected | 완료해 둠 |
| `meeting-notion-revoked` | PM | `instant` | revoked | 완료해 둠 |
| `meeting-member` | 일반 팀원 | `instant` | connected | 처리 중(첫 조회에 끝남) |

PM 시나리오는 픽스처의 처리 중 회의 `mt_10` 을 `completeMeeting` 으로 먼저 끝낸다 — 처리 중 회의가 있으면 업로드가 409 이고 진입이 처리 화면으로 바뀐다(D-088, D-090).

**세션 역할** — `shared/mock/sessions.ts` 의 `setMockRole('member' | 'pm', workspaceId = 'ws_01')`. MSW 는 계정이 하나라 역할이 워크스페이스 행의 `role` 이다. 통합 테스트는 이 함수로, E2E 는 `meeting-member` 로 고른다.

**영속.** `meetingFlow` 는 `MockDb` 의 한 칸이라 기존 sessionStorage 영속에 그대로 들어간다. 모양이 바뀌어 `MOCK_DB_VERSION` 을 2 로 올렸다. `isMockDb` 가 `mode` 값과 `attendees` 모양까지 본다.

## 왜

- 조회 횟수는 결정적이다. 같은 조회 순서면 같은 결과다 — 테스트가 「네 번째 조회에 done」 을 단언할 수 있다. 시간 기반이면 fake timer 와 MSW 응답 타이밍이 얽힌다.
- `manual` 을 기본으로 두면 기존 테스트와 기존 시나리오(`expect(db).toEqual(initialDb())`)가 한 줄도 바뀌지 않는다. 진행이 필요한 테스트만 도우미를 부르거나 mode 를 바꾼다.
- 완료 결과를 한 함수가 만들어야 ID 연결이 한 곳에서 보장된다. 테스트는 이 함수를 그대로 부르고, 브라우저는 handler 를 거쳐 같은 함수를 탄다.
- 시나리오 조합(역할 × mode × Notion)을 파라미터 여러 개로 열지 않았다. E2E 가 실제로 쓰는 조합만 이름으로 둔다 — 시작 상태가 이름 하나로 읽힌다.

## 다시 고민할 때

- 실 백엔드가 파일 저장·큐를 구현해 실제로 정리가 돌면: MSW 흐름은 개발용으로 남긴다. 실 API 의 `progress` 전이 순서가 다르면 `MEETING_STAGES` 를 맞춘다.
- `failed_stage` 가 Notion 끊김을 구분하게 되면(계약 §4.7-3): `failMeeting` 의 `'NOTION'` 을 그 값으로 바꾼다. 화면은 지금 연동 상태 재조회로 판단한다.
- E2E 가 「업로드 후 다른 페이지로 이동」 사이에 정리가 끝나 버려 불안정하면: `instant` 대신 N 번째 조회에 끝나는 방식을 하나 더 둔다.
