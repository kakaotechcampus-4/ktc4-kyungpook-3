# M1 MSW 사용 가이드

## 실행

`frontend`에서 다음을 실행한다.

```bash
npm ci
cp .env.example .env
npm run dev
```

PowerShell에서는 `Copy-Item .env.example .env`를 쓸 수 있다. `.env`의 `VITE_ENABLE_MSW=true`를 확인한다. `[MSW] Mocking enabled.`가 뜬 뒤 브라우저 콘솔에서 요청한다.

```js
await (await fetch('/api/v1/tasks?workspace_id=ws_01')).json()
// data.items 10개, data.total 10
await (await fetch('/api/v1/approvals?workspace_id=ws_01&status=pending')).json()
// data.items 3개, data.total 3
await (await fetch('/api/v1/meetings/mt_09/minutes')).json()
// data.transcript 5줄
```

`VITE_ENABLE_MSW=false`면 Vite의 `/api` 프록시가 `localhost:8000`의 백엔드로 요청을 보낸다. 환경 변수를 바꾸면 개발 서버를 재시작한다.

기본 로그인은 `pm@example.com` / `mock-password`다. 실제 계정이나 비밀 정보가 아닌 로컬 픽스처다.

## worker와 server

- `src/shared/mock/browser.ts`: 브라우저 Service Worker. `main.tsx`가 개발 모드이고 환경 변수가 `true`일 때만 동적으로 불러온다. worker 시작 후 React를 렌더링한다.
- `src/shared/mock/server.ts`: Vitest의 Node 요청 가로채기. Service Worker를 띄우지 않는다. `src/shared/test/setup.ts`가 전체 테스트에 적용한다.
- 둘 다 `src/shared/mock/handlers/index.ts`의 동일한 handler 목록을 사용한다. 브라우저용 응답과 테스트용 응답을 따로 만들지 않는다.
- `public/mockServiceWorker.js`는 MSW CLI 생성물이다. 직접 수정하지 않는다. MSW를 업데이트하면 `npx msw init public/ --save`로 갱신한다.

프로덕션에서는 `import.meta.env.DEV` 조건이 제거되면서 worker와 handler가 JS 번들에 들어가지 않는다. `npm run build` 후 `dist/assets/*.js`에서 `msw`가 0건인지 확인한다.

## 픽스처와 메모리 DB

`src/shared/mock/fixtures/`는 고정 시나리오 원본이다. 기준 날짜는 `2026-09-18`, 시각은 `2026-09-18T09:00:00+09:00`이다. 기본 데이터 자체를 바꿀 때만 이 파일을 수정하고, 사양서 §9-7의 집계도 함께 확인한다.

handler는 `src/shared/mock/db.ts`의 깊은 복사본을 읽고 수정한다. 승인하면 태스크가 생기고, 다음 조회에서 확인할 수 있다. 브라우저에서는 페이지를 새로고침하면 초기 상태로 돌아간다. 테스트에서는 매 테스트 뒤 `server.resetHandlers()`와 `resetDb()`를 모두 실행한다. 전자는 override만 지우므로 DB 초기화를 대신하지 않는다.

`ws_02`에는 태스크·승인·회의가 없다. 업로드 409 확인용으로 `ws_01`에 처리 중인 `mt_10`이 있다. 정상 업로드를 검증할 때는 테스트 안에서 이 회의를 완료 상태로 바꾸고 요청한다.

## 오류·빈 목록 override

한 테스트에만 다른 응답이 필요하면 `server.use()`를 그 테스트 안에서 호출한다. 아래 예시는 엔티티 통합 테스트에 둘 수 있다. `fetch`에는 jsdom의 `location.origin`을 붙여 상대 경로 handler와 같은 origin으로 요청한다.

```ts
import { http } from 'msw'
import { server } from '@/shared/mock/server'
import { fail, list } from '@/shared/mock/envelope'
import { unwrap } from '@/shared/api/envelope'
import type { Envelope, ListDto } from '@/shared/types/api/envelope'
import type { TaskDto } from '@/shared/types/api/task'

it('권한 오류의 코드와 상태를 보존한다', async () => {
  server.use(
    http.get('/api/v1/tasks', () => fail('FORBIDDEN', '접근 권한이 없습니다.', 403)),
  )
  const response = await fetch(`${location.origin}/api/v1/tasks?workspace_id=ws_01`)
  const body = (await response.json()) as Envelope<ListDto<TaskDto>>
  expect(() => unwrap(body, response.status)).toThrow('접근 권한이 없습니다.')
})

it('빈 목록의 total도 0이다', async () => {
  server.use(http.get('/api/v1/tasks', () => list<TaskDto>([])))
  const response = await fetch(`${location.origin}/api/v1/tasks?workspace_id=ws_01`)
  const body = (await response.json()) as Envelope<ListDto<TaskDto>>
  expect(unwrap(body, response.status)).toEqual({ items: [], total: 0 })
})
```

## 회의 정리 흐름 (M5)

업로드한 회의가 `processing` → `done` | `failed` 로 바뀌는 흐름이다. 시간이 아니라 **상세 조회(`GET /meetings/{id}`)가 시계**다 — handler 가 답하기 전에 `tickMeeting()` 으로 처리 중 회의를 한 번 진행한다. 결정과 이유는 [구현 결정 2026-10-02-msw-meeting-flow](plan/m5/basis-for-decision/2026-10-02-msw-meeting-flow.md)에 있다.

### 흐름 방식

`db.meetingFlow.mode` 가 한 번의 상세 조회에 무엇을 할지 정한다.

| mode | 상세 조회 한 번에 | 쓰는 곳 |
|---|---|---|
| `manual` | 아무것도 하지 않는다 | Vitest 기본값, M4 시나리오 5개 |
| `staged` | 녹음 회의는 AI 보고 하나 — 대기 → 전사 시작(수치 없음) → 0/5 → 3/5 → 5/5(끝낸 음성 트랙 수, AI #653 순서) → 저장 → 추출 → 넘기기 → `done`. `progress` 는 서버처럼 단계 순위에서 얻고 `processing` 을 준다(#483). 채팅 회의는 `progress` 한 단계 | 브라우저 데모 |
| `staged-legacy` | 한 단계 (`audio_merged` → `transcribed` → `extracted` → `done`). 응답에 `processing` 키가 없다(#542 전 BE) | 옛 응답 확인 |
| `instant` | 바로 `done` | E2E |
| `fail` | 바로 `failed` | 실패 흐름 |
| `fail-chat-stalled` | 채팅 회의만 `failed`(`chat_stalled`), 업로드 회의는 그대로 | 멈춘 채팅 회의(#450) |

처리 화면과 앱 수준 추적기가 3초마다 상세를 부르므로 `staged` 는 3초 간격으로 단계가 보인다.

### 브라우저에서 고르기

주소에 `?msw-scenario=<이름>` 을 붙인다. 저장값을 버리고 그 시나리오로 시작하며 파라미터는 주소에서 바로 지워진다(`shared/mock/browserDb.ts`). 모두 `pm@example.com` / `mock-password` 로 `ws_01` 하나에 로그인한다.

| 시나리오 | 역할 | mode | Notion | 해 볼 것 |
|---|---|---|---|---|
| `meeting-demo` | PM | `staged` | 연결됨 | 올리고 처리 화면에서 대기부터 세 단계가 차례로 진행되는 것(넘기는 중에도 마지막 단계 진행 중, #483), 전사 단계의 `음성 트랙 0/5 → 3/5 → 5/5` 와 단계 경과, 다른 화면으로 가서 완료 토스트. 단계 시작 시각은 MOCK_NOW(2026-09-18 09:00 서울) 직전이라, 실제 날짜로 열면 경과가 큰 수다 — 브라우저 시계를 MOCK_NOW 로 두면 `5분째`·`2분째`·`1분째`·`방금 시작` 이 보인다 |
| `meeting-demo-legacy` | PM | `staged-legacy` | 연결됨 | `meeting-demo` 와 같지만 #542 전 서버라 `processing` 이 없다. 진행 수·경과 없이 단계만 보인다 (#483) |
| `meeting-instant` | PM | `instant` | 연결됨 | 올리자마자 회의록으로 |
| `meeting-fail` | PM | `fail` | 연결됨 | 재업로드 토스트, 목록에서 빠진 회의 |
| `meeting-notion-not-connected` | PM | `instant` | 미연결 | Notion 없이 회의 올리기 → 정리 → 회의록·태스크(D-182). 설정 Notion 영역 → 모의 OAuth → 설정 복귀 |
| `meeting-member` | 일반 팀원 | `instant` | 연결됨 | 헤더 `정리 중`·회의록. 업로드 주소는 막힌다 |
| `meeting-chat-processing` | PM | `manual` | 연결됨 | 채팅 회의 `mt_11` 이 정리 중이어도 업로드 화면에 머물고 올릴 수 있다 (#450) |
| `meeting-chat-stalled` | PM | `fail-chat-stalled` | 연결됨 | 채팅 회의 `mt_11` 이 첫 상세 조회에 `chat_stalled` 로 실패한다. 토스트·처리 화면·회의록 상세의 안내가 업로드를 권하지 않는다 (#450) |
| `meeting-chat-demo` | PM | `staged` | 연결됨 | 채팅 회의 `mt_11` 이 상세 조회마다 대화 모으기 → 결정사항과 할 일 뽑아내기로 진행하고 끝난다. 처리 화면·토스트가 두 단계다 (#483) |
| `meeting-speakers` | PM | `speakers` | 연결됨 | 업로드 회의 `mt_11` 이 화자 지정 대기. 목록의 `화자 지정 필요` 행 → 지정 화면 → 제출 → 처리 재개 (#256) |
| `meeting-speakers-flow` | PM | `speakers` | 연결됨 | 올리면 첫 상세 조회에 화자 지정 대기가 된다. 처리 화면 → 지정 화면 이동, 다른 화면이면 `화자 지정하기` 토스트 |
| `meeting-speakers-expired` | PM | `speakers` | 연결됨 | 지정을 내면 409 `details.status=failed`. 만료 안내와 재업로드 링크, 다시 낼 수 없다 |
| `meeting-speakers-member` | 일반 팀원 | `speakers` | 연결됨 | 지정 화면에서 `PM이 화자를 지정하고 있어요` 안내만 본다. 화자 API 를 부르지 않는다 |
| `meeting-speakers-no-audio` | PM | `speakers` | 연결됨 | 녹음이 없어(`audio: null`) 샘플 버튼 없이 고른다 |

```text
http://localhost:5173/workspaces/ws_01/meetings/upload?msw-scenario=meeting-demo
```

PM 시나리오는 픽스처의 처리 중 회의 `mt_10` 을 먼저 끝내 둔다 — 처리 중 회의가 있으면 업로드가 409 이고 진입이 처리 화면으로 바뀐다(D-088·D-090). 파일은 아무 짧은 음원이면 된다. 브라우저가 길이를 읽을 수 있어야 폼이 받는다 — 저장소의 `e2e/fixtures/short-meeting.wav`(1초, 8 KB)를 써도 된다. 원본 파일은 db 에도 sessionStorage 에도 남지 않는다. 남는 것은 참석자 ID(`db.meetingFlow.attendees`)뿐이다.

### Vitest 에서 고르기

Vitest 는 시나리오를 거치지 않는다. 기본 db 는 `manual` 이라 회의가 저절로 끝나지 않는다. 필요한 테스트만 도우미를 부른다 — 모두 `shared/mock/` 에 있고 `state` 를 받는다(기본 `db`).

```ts
import { completeMeeting, failMeeting, setMeetingFlowMode } from '@/shared/mock/meetingFlow'
import { setMockRole } from '@/shared/mock/sessions'

completeMeeting('mt_10') // done + 회의록·추출(항목 셋)·태스크·대기 승인을 같은 ID 로 잇는다
failMeeting('mt_10', { notionRevoked: true }) // failed. 결과를 만들지 않는다. 끊김이면 그 공간 Notion 도 revoked
setMeetingFlowMode('instant') // 다음 상세 조회에 끝나게 — 실제 polling 경로로 끝내고 싶을 때
setMockRole('member') // ws_01 의 역할을 일반 팀원으로
```

`afterEach` 의 `resetDb()` 가 mode·역할까지 되돌린다.

### E2E 에서 고르기

E2E 는 `start(page, 'meeting-instant', '/workspaces/ws_01/meetings/upload')`(`e2e/support.ts`)처럼 시나리오와 주소를 함께 준다. 테스트마다 새 컨텍스트라 서로 상태를 나누지 않는다. 정리 중에 다른 화면으로 떠날 틈이 필요하면 `meeting-demo`(3초 × 9회, #483)를 쓴다 — `instant` 는 처리 화면이 첫 조회에서 끝을 보고 회의록으로 옮긴다.

승인 요청에는 계약 §2.5의 `resolved_by`도 보낸다.

```js
await fetch('/api/v1/approvals/ap_01', {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ status: 'approved', resolved_by: 'mb_01' }),
})
// 다음 tasks 조회는 11개, pending approvals는 2개. 같은 승인 재처리는 409.
```

## 메시지 화면 (M8)

메시지 화면은 모든 모드에서 실제 메시지 API(계약 §5.7)를 부른다. MSW 를 켜면 같은 경로·응답 모양·오류 코드(`BUNDLE_CHANGED`, `REMINDER_SCHEDULED_AT_PASSED`, `REMINDER_NOT_EDITABLE`, `REMINDER_BUNDLE_NOT_FOUND`, `MESSAGE_THREAD_NOT_FOUND`)로 목이 답한다(#315, [M8-C 결과](plan/m8/result-c.md)). 시나리오는 위와 같이 `?msw-scenario=<이름>` 으로 고른다. `messages-member` 만 팀원이고, 나머지는 `ws_01` 의 PM 이다. 보낼 시각을 같은 대화의 다른 예정 묶음과 같은 시각으로 옮기면 목도 BE 처럼 그 묶음으로 합치고 문구를 다시 만들고 승인을 푼다(#368). 스케줄러 발송·만료·AI 초안 도착은 흉내 내지 않는다 — 예정 시각이 지나도 스스로 나가지 않는다.

| 시나리오 | 해 볼 것 |
|---|---|
| `messages-default` | 보낼 메시지 2통(이재환 `bd_01` 마감 하루 전, 정하늘 `bd_02` 직접 정한 시각이고 `문구 다듬는 중`), 대화 4건(이재환 `th_01` 이 오늘로 3일째 답장 없음, `bd_01` 이 그 대화에서 승인 대기, 박지훈 `th_04` 는 `DM 못 보냄`). 승인·보내지 않음·문구·시각 고치기가 성공한다 |
| `messages-empty` | `ws_01` 의 묶음·대화가 모두 없음 → 빈 상태 |
| `messages-list-error` | 목록만 5xx. 대화 주소로 바로 들어오면 대화는 보인다 |
| `messages-thread-error` | 목록은 정상, `th_01` 대화만 5xx |
| `messages-send-fail` | 조회는 정상, 승인·보내지 않음·문구·시각 고치기·답장만 5xx(db 는 그대로) |
| `messages-member` | 팀원. 자기 대화 `th_06` 만 보이고 보내기 전 확인은 없다(`bundles: null`). 마지막 봇 메시지는 `DM 못 보냄`, 웹 답장은 그 대화에만 남는다. 남의 대화는 403 |
| `messages-member-push` | `messages-member` 에 서버 푸시 공개키를 더했다. `th_06` 대화 머리 아래에 `기기 알림` 띠가 보이고, `알림 켜기` 를 눌러야 브라우저 알림 허용을 묻는다(#411) |
| `messages-schedule-passed` | `bd_06` 은 승인 전에 보낼 시각이 지났고 마감은 오늘이다. 이대로 발송은 409 `REMINDER_SCHEDULED_AT_PASSED` 이고, 시각을 다시 고른 뒤에 승인할 수 있다 |
| `messages-merge` | 이재환에게 보낼 메시지가 둘이다. `bd_07`(09/21 18:00, 승인 전)에서 `마감 하루 전`(09/23 09:00)을 고르면 승인해 둔 `bd_01` 과 같은 시각이라 합쳐진다. 화면은 `?review=bd_01` 로 옮겨 가고 승인이 풀렸다고 알린다 |

```text
http://localhost:5173/workspaces/ws_01/messages?msw-scenario=messages-default
```

고른 대화는 `/messages/threads/<id>`, 고른 보낼 메시지는 `/messages?review=<묶음 id>` 다. `review` 없이 들어오면 아직 승인하지 않은 첫 묶음이 골라진다. 로딩은 시나리오가 아니라 테스트에서 응답을 붙잡아 재현한다. `답장 3일째 없음`·`지남` 같은 표기는 기기의 오늘로 계산한다 — 픽스처는 MOCK_NOW(2026-09-18) 기준이라 실제 날짜로 열면 숫자가 커진다.

## 설정·팀 (M8-B)

설정 화면(Settings 캔버스)과 팀 화면(Team 캔버스)을 확인하는 시나리오다. 위 「브라우저에서 고르기」처럼 `?msw-scenario=<이름>`을 붙인다. 결과는 [M8-B 결과](plan/m8/result-b.md)에 있다.

| 시나리오 | 역할 | 공간 | 해 볼 것 |
|---|---|---|---|
| `settings-discord-skipped` | PM | `ws_03`(온보딩 완료, Discord·팀원 연결 건너뜀, Notion 연결됨, 팀원은 생성자 PM 하나) | 설정에서 Discord 연결 → 모의 OAuth → 연결이 확인되면 팀 화면의 팀원 연결 창으로 간다(D-074). 온보딩 단계는 그대로 `건너뜀`이다(D-173). 팀 화면의 `연결되지 않은 계정`은 Discord 미연결 안내다 |
| `settings-unmapped` | PM | `ws_01` 픽스처 그대로(Discord 연결됨, 미매핑·서버를 떠난 사용자·봇 포함) | 팀 화면의 `연결되지 않은 계정`(`jihun_dev`)과 `팀원 관리`·`연결` → 팀원 연결 창. 정하늘은 서버를 떠난 팀원이다. 설정의 연결 카드에서 `연결 끊기` |
| `settings-member` | 일반 팀원 | `ws_01`(Discord 미연결, Notion 연결됨) | 설정은 상태와 요청 안내만 보이고 선택지·토글이 꺼져 있다. 팀 화면에는 `팀원 관리`·`연결`이 없다 |

```text
http://localhost:5173/workspaces/ws_03/settings?msw-scenario=settings-discord-skipped
http://localhost:5173/workspaces/ws_01/members?msw-scenario=settings-unmapped
```

**연결·매핑 쓰기는 PM만 한다.** 백엔드에 맞춰 다음 쓰기는 그 공간의 PM만 허용한다(`shared/mock/auth-guard.ts`의 `requirePmRole`).

- 연동 해제 `DELETE /workspaces/{id}/integrations/{provider}`
- 팀원 생성·수정 `POST`·`PATCH /members`
- 모의 OAuth의 연결 성공

일반 팀원은 403을 받고 데이터가 바뀌지 않는다. 모의 OAuth 성공은 `failed`로 돌아간다. 조회는 소속 팀원이면 그대로 된다. `PATCH /members/{id}`는 대상 팀원이 없으면 권한보다 404가 먼저다. 아래 「실 백엔드와 다른 점」의 "`members`에는 일부러 붙이지 않았다"에서 `POST`·`PATCH /members`의 PM 검사는 예외다. 근거는 [결정 기록](plan/m8/basis-for-decision/2026-10-31-msw-pm-only-connection-writes.md)에 있다.

## 미처리 요청 읽기

테스트는 `onUnhandledRequest: 'error'`이므로 등록하지 않은 요청이 실패한다. 로그의 method와 URL을 보고 `/api/v1` prefix, origin, handler 등록, 동적 경로 순서를 확인한다. `/members/aliases`와 `/members/unresolved-aliases`는 `/members/:id`보다 먼저 등록해야 한다.

로컬 브라우저는 `warn`으로 경고하고 실제 네트워크로 보낸다. 의도한 mock에서 경고가 나면 handler 누락을 먼저 확인한다. OAuth `start`·`callback` 같은 302 네비게이션, AI→BE 전용 생성 경로는 M1 mock 범위 밖이다. 메시지는 계약 §5.7 의 화면용 경로(조회 `/workspaces/{id}/messages`, `/workspaces/{id}/messages/threads/{id}`, 행동 `PATCH …/messages/bundles/{id}`, `POST …/bundles/{id}/approve`, `POST …/bundles/{id}/cancel`, `POST …/messages/threads/{id}/replies`, #370 의 재촉 만들기 `POST …/messages/reminders`, 리마인드 고치기 `PATCH …/messages/reminders/{id}`, 빼기 `POST …/messages/reminders/{id}/cancel`)만 둔다. 봇 경로는 화면이 부르지 않아 두지 않았다(`messages-*` 시나리오).

## 알림과 자동 막힘 시나리오 (#364)

MSW를 켠 개발 서버에서 `/workspaces/ws_01/tasks/tk_06?msw-scenario=notifications-default`로 들어간다. 이 시나리오는 ws_01의 PM으로 시작하며 읽지 않은 알림 4건과 읽은 알림 1건을 준비한다. 읽지 않은 항목에는 알 수 없는 종류 1건이 포함된다. `tk_06`은 무응답으로 자동 막힌 태스크다.

알림 종 배지·목록, 알림 이동과 태스크 상세의 **막힘 풀기**를 확인할 때 사용한다. 같은 여정의 새로고침에는 시나리오 파라미터를 다시 붙이지 않는다. 다시 붙이면 저장한 상태 대신 초기 시나리오를 준비한다.

시나리오는 `src/shared/mock/scenarios.ts`에 있고 `src/app/taskAutoBlock.test.tsx`에서 사용한다. 현재 `e2e/support.ts`의 `Scenario` 타입에는 없으므로 새 E2E에서 `start`로 사용하려면 해당 타입도 확장해야 한다. 이 모의 데이터는 실제 VAPID 설정·브라우저 푸시 수신·iOS PWA·로그아웃 후 구독 해제의 검증 근거가 아니다. 실서버 검증은 #364에 별도로 기록한다.

## 실 백엔드와 다른 점

`VITE_ENABLE_MSW=false`로 붙일 때 어긋나는 것들이다. 전체 현황은 [계약 §4.0](contracts/frontend-api-contract.md)에 있다.

- **로그인이 쿠키 세션이다.** 실 백엔드는 `Set-Cookie: session_token`(HttpOnly·Secure·SameSite=Lax)으로 응답하고, 이후 요청은 쿠키로 인증한다. MSW는 쿠키를 심지 않는다. 브라우저에서 두 모드를 오가면 로그인 상태가 이어지지 않는다.
- **온보딩·Discord 사용자 목록·회의록 본문·회의 업로드가 실 API에서 스텁이다.** 엔드포인트는 응답하지만 값이 하드코딩이거나 저장을 하지 않는다. MSW 쪽이 더 완전하므로 이 네 화면은 mock으로 개발한다.
  회의록 본문은 비어 있는 게 아니라 **안내 문구 1줄**이 온다. extraction이 없을 때만 빈 배열이다.
- **OAuth `start`·`callback`은 실 백엔드에도 MSW handler 에도 없다.** 실 백엔드에서는 Discord·Notion 연결이 동작하지 않는다.
  MSW 모드(개발)에서는 Discord·Notion 연결만 프론트의 모의 OAuth 화면(`shared/mock/oauth/`, `devPaths.mockOAuth`)이 콜백을 흉내내 연결·취소·실패 뒤 원래 화면으로 돌려보낸다(위 「회의 정리 흐름」의 `meeting-notion-not-connected`).
  Google 로그인은 없다(D-182). 카카오 로그인은 실 백엔드에 `/auth/kakao/*`가 있고(계약 §4.1.4), MSW 모드에서는 모의 카카오 화면(`/__mock/kakao`)이 결과(새 사용자·이어진 계정·닉네임 없는 새 사용자·취소·실패)를 고르게 한다. 이어진 계정은 픽스처 계정에 이어진 `kakao-pm` 이다. 이어진 카카오가 없으면 늘 가입 화면이고 카카오 가입은 아이디·이름만 받는다(#627).
- 실 백엔드는 업로드한 **파일을 저장하지 않고 큐에도 보내지 않는다.** 회의가 `processing`에 머물러 다음 업로드를 409로 막는다. MSW는 위 「회의 정리 흐름」으로 정상 흐름을 낸다.
- 실 백엔드는 **업로드를 PM 에게만 허용하지 않는다**(소속만 본다). 프론트의 PM 가드는 화면만 막는다 — [계약 §4](contracts/frontend-api-contract.md) 백엔드 요청 17.

**세션 인증을 흉내낸다.** 로그아웃하면 보호된 엔드포인트가 401 을 낸다. 소속이 아닌 워크스페이스는 403 이다.
`db.authenticated` 기본값이 `true` 라 평소에는 로그인 상태다. 붙인 곳은 [M1 사양서 §10-2](plan/m1/plan.md)에 있다.
`tasks`·`approvals`·`extractions`·`members` 에는 **일부러 붙이지 않았다** — 백엔드에 인증이 없다.

handler 35개를 실 API 와 대조한 결과는 [M1 사양서 §10-1](plan/m1/plan.md)에 표로 있다.

태스크 쓰기 경로는 실 백엔드에 맞춰 두었다. 세 가지를 기억한다.

- `PATCH`의 명시적 `null`은 **필드를 지운다.** 보내지 않을 필드는 `undefined`로 빼야 한다.
- `title`·`status`에 `null`을 보내면 400이다. 두 필드는 지울 수 없다.
- 되돌리기는 **최신 이력부터** 해야 한다. 그 이력 이후에 다른 변경이 있으면 400이다.

## 지킬 규칙

- handler나 테스트에서 픽스처 원본을 직접 변경하지 않는다. 시나리오 변경은 DB 복사본이나 `server.use()`로 한다.
- handler에 `Date.now()`·`Math.random()`을 넣지 않는다. 고정 시각과 충돌하지 않는 결정적 ID를 쓴다.
- `delay()`로 로딩 상태를 만들지 않는다. M1은 데이터 계약을 검증한다.
- `server.resetHandlers()`만으로 테스트 상태를 초기화했다고 생각하지 않는다. `resetDb()`도 필요하다.
- 화면 계층은 DTO를 직접 import하지 않는다. 엔티티의 공개 매퍼·도메인 타입과 파생 함수를 사용한다.

엔드포인트와 픽스처 전체 목록은 [M1 사양서](plan/m1/plan.md)의 §9~§11을 본다.
