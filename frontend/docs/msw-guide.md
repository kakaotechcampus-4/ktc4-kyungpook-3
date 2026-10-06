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

업로드한 회의가 `processing` → `done` | `failed` 로 바뀌는 흐름이다. 시간이 아니라 **상세 조회(`GET /meetings/{id}`)가 시계**다 — handler 가 답하기 전에 `tickMeeting()` 으로 처리 중 회의를 한 번 진행한다. 결정과 이유는 [구현 결정 2026-10-02-msw-meeting-flow](impl-decision/2026-10-02-msw-meeting-flow.md)에 있다.

### 흐름 방식

`db.meetingFlow.mode` 가 한 번의 상세 조회에 무엇을 할지 정한다.

| mode | 상세 조회 한 번에 | 쓰는 곳 |
|---|---|---|
| `manual` | 아무것도 하지 않는다 | Vitest 기본값, M4 시나리오 5개 |
| `staged` | 한 단계 (`audio_merged` → `transcribed` → `extracted` → `done`) | 브라우저 데모 |
| `instant` | 바로 `done` | E2E |
| `fail` | 바로 `failed` | 실패 흐름 |
| `fail-notion-revoked` | `failed` + 그 공간 Notion `revoked` | 끊김 실패(D-099·D-100) |

처리 화면과 앱 수준 추적기가 3초마다 상세를 부르므로 `staged` 는 3초 간격으로 단계가 보인다.

### 브라우저에서 고르기

주소에 `?msw-scenario=<이름>` 을 붙인다. 저장값을 버리고 그 시나리오로 시작하며 파라미터는 주소에서 바로 지워진다(`shared/mock/browserDb.ts`). 모두 `pm@example.com` / `mock-password` 로 `ws_01` 하나에 로그인한다.

| 시나리오 | 역할 | mode | Notion | 해 볼 것 |
|---|---|---|---|---|
| `meeting-demo` | PM | `staged` | 연결됨 | 올리고 처리 화면에서 세 단계가 차례로 끝나는 것, 다른 화면으로 가서 완료 토스트 |
| `meeting-instant` | PM | `instant` | 연결됨 | 올리자마자 회의록으로 |
| `meeting-fail` | PM | `fail` | 연결됨 | 재업로드 토스트, 목록에서 빠진 회의 |
| `meeting-fail-notion-revoked` | PM | `fail-notion-revoked` | 실패 때 끊김 | 재연결 모달 |
| `meeting-notion-not-connected` | PM | `instant` | 미연결 | 회의 올리기 진입 차단 모달 → 설정 Notion 영역 → 모의 OAuth → 복귀 |
| `meeting-notion-revoked` | PM | `instant` | 끊김 | 재연결 차단 모달 |
| `meeting-member` | 일반 팀원 | `instant` | 연결됨 | 헤더 `정리 중`·회의록. 업로드 주소는 막힌다 |

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

### Storybook·E2E 에서 고르기

- Storybook: `parameters.scenario` 에 시나리오 이름, `parameters.setup` 에 그 위의 손질(`() => void completeMeeting('mt_10')`, `() => setMockRole('member')`)을 준다(`.storybook/preview.tsx`). 스토리를 열 때마다 db 를 다시 만든다.
- E2E: `start(page, 'meeting-instant', '/workspaces/ws_01/meetings/upload')`(`e2e/support.ts`). 테스트마다 새 컨텍스트라 서로 상태를 나누지 않는다. 정리 중에 다른 화면으로 떠날 틈이 필요하면 `meeting-demo`(3초 × 4회)를 쓴다 — `instant` 는 처리 화면이 첫 조회에서 끝을 보고 회의록으로 옮긴다.

승인 요청에는 계약 §2.5의 `resolved_by`도 보낸다.

```js
await fetch('/api/v1/approvals/ap_01', {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ status: 'approved', resolved_by: 'mb_01' }),
})
// 다음 tasks 조회는 11개, pending approvals는 2개. 같은 승인 재처리는 409.
```

## 미처리 요청 읽기

테스트는 `onUnhandledRequest: 'error'`이므로 등록하지 않은 요청이 실패한다. 로그의 method와 URL을 보고 `/api/v1` prefix, origin, handler 등록, 동적 경로 순서를 확인한다. `/members/aliases`와 `/members/unresolved-aliases`는 `/members/:id`보다 먼저 등록해야 한다.

로컬 브라우저는 `warn`으로 경고하고 실제 네트워크로 보낸다. 의도한 mock에서 경고가 나면 handler 누락을 먼저 확인한다. OAuth `start`·`callback` 같은 302 네비게이션, AI→BE 전용 생성 경로, 메시지 API는 M1 mock 범위 밖이다.

## 실 백엔드와 다른 점

`VITE_ENABLE_MSW=false`로 붙일 때 어긋나는 것들이다. 전체 현황은 [계약 §4.0](api/frontend-api-contract-draft.md)에 있다.

- **로그인이 쿠키 세션이다.** 실 백엔드는 `Set-Cookie: session_token`(HttpOnly·Secure·SameSite=Lax)으로 응답하고, 이후 요청은 쿠키로 인증한다. MSW는 쿠키를 심지 않는다. 브라우저에서 두 모드를 오가면 로그인 상태가 이어지지 않는다.
- **온보딩·Discord 사용자 목록·회의록 본문·회의 업로드가 실 API에서 스텁이다.** 엔드포인트는 응답하지만 값이 하드코딩이거나 저장을 하지 않는다. MSW 쪽이 더 완전하므로 이 네 화면은 mock으로 개발한다.
  회의록 본문은 비어 있는 게 아니라 **안내 문구 1줄**이 온다. extraction이 없을 때만 빈 배열이다.
- **OAuth `start`·`callback`은 실 백엔드에도 MSW handler 에도 없다.** 실 백엔드에서는 Google 로그인과 Discord·Notion 연결이 동작하지 않는다.
  MSW 모드(개발)에서는 Discord·Notion 연결만 프론트의 모의 OAuth 화면(`shared/mock/oauth/`, `devPaths.mockOAuth`)이 콜백을 흉내내 연결·취소·실패 뒤 원래 화면으로 돌려보낸다(위 「회의 정리 흐름」의 `meeting-notion-not-connected`).
  Google 로그인은 MSW 모드에서도 비활성 버튼이다(D-007).
- 실 백엔드는 업로드한 **파일을 저장하지 않고 큐에도 보내지 않는다.** 회의가 `processing`에 머물러 다음 업로드를 409로 막는다. MSW는 위 「회의 정리 흐름」으로 정상 흐름을 낸다.
- 실 백엔드는 **업로드를 PM 에게만 허용하지 않는다**(소속만 본다). 프론트의 PM 가드는 화면만 막는다 — [계약 §4](api/frontend-api-contract-draft.md) 백엔드 요청 17.

**세션 인증을 흉내낸다.** 로그아웃하면 보호된 엔드포인트가 401 을 낸다. 소속이 아닌 워크스페이스는 403 이다.
`db.authenticated` 기본값이 `true` 라 평소에는 로그인 상태다. 붙인 곳은 [M1 사양서 §10-2](plan/m1-domain-model-and-msw.md)에 있다.
`tasks`·`approvals`·`extractions`·`members` 에는 **일부러 붙이지 않았다** — 백엔드에 인증이 없다.

handler 35개를 실 API 와 대조한 결과는 [M1 사양서 §10-1](plan/m1-domain-model-and-msw.md)에 표로 있다.

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

엔드포인트와 픽스처 전체 목록은 [M1 사양서](plan/m1-domain-model-and-msw.md)의 §9~§11을 본다.
