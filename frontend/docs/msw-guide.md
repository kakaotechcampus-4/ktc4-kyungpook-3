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

## 지킬 규칙

- handler나 테스트에서 픽스처 원본을 직접 변경하지 않는다. 시나리오 변경은 DB 복사본이나 `server.use()`로 한다.
- handler에 `Date.now()`·`Math.random()`을 넣지 않는다. 고정 시각과 충돌하지 않는 결정적 ID를 쓴다.
- `delay()`로 로딩 상태를 만들지 않는다. M1은 데이터 계약을 검증한다.
- `server.resetHandlers()`만으로 테스트 상태를 초기화했다고 생각하지 않는다. `resetDb()`도 필요하다.
- 화면 계층은 DTO를 직접 import하지 않는다. 엔티티의 공개 매퍼·도메인 타입과 파생 함수를 사용한다.

엔드포인트와 픽스처 전체 목록은 [M1 사양서](plan/m1-domain-model-and-msw.md)의 §9~§11을 본다.
