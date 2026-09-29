# 브라우저 MSW 의 상태를 새로고침·OAuth 왕복 너머로 어떻게 남기고, 없는 OAuth 를 어떻게 흉내 낼 것인가

- 날짜: 2026-09-29
- 상태: 결정

## 고민

M3 까지의 MSW 는 로그인된 상태로 시작했고 모듈 메모리에만 상태가 있었다. 그러면

- 가입해 만든 계정·세션·워크스페이스·온보딩 진행이 새로고침 한 번에 사라진다.
- Discord·Notion 연결은 현재 탭 이동이다(D-158). 탭이 OAuth 로 나갔다 돌아오면 새 문서라 역시 사라진다.
- 실 API 에는 연동 `start`·`callback` 이 없다(계약 §4.3). 브라우저가 옮겨 갈 OAuth 화면 자체가 없다.

Vitest 는 반대로 테스트마다 같은 픽스처(로그인된 `us_01`, ws_01·ws_02)에서 시작해야 한다. 이 둘을 섞으면 기존 테스트가 깨진다.

## 고른 길

**브라우저에만 영속을 둔다.** Vitest 경로(`server.ts`·`setup.ts` 의 `resetDb()`)는 건드리지 않는다.

- 시작: `startMockWorker()`(`shared/mock/browser.ts`) → `prepareBrowserDb()`(`browserDb.ts`)
  1. 주소에 `?msw-scenario=<이름>` 이 있으면 저장값을 버리고 그 시나리오로 시작한다. 주소에서는 바로 지운다(E2E 초기화).
  2. 없으면 sessionStorage 의 저장값을 복원한다.
  3. 저장값이 없거나, 버전이 다르거나, 손상됐으면 **비로그인**으로 시작한다.
- 저장: 키 `msw-db`, 값 `{ version: 1, db }` (`persistence.ts`). 모의 응답을 보낼 때마다(`response:mocked`) 쓴다.
  픽스처나 `MockDb` 모양을 바꾸면 `MOCK_DB_VERSION` 을 올린다 — 옛 저장값은 버려진다.
- 시나리오: `signed-out` · `no-workspace` · `single-workspace` · `multiple-workspaces` · `incomplete-workspace`(`scenarios.ts`).
  모두 픽스처 계정 `pm@example.com` / `mock-password` 다. 매번 `initialDb()` 에서 새로 만들어 서로 새지 않는다.
- sessionStorage 인 이유: 같은 탭의 새로고침·현재 탭 OAuth 이동에는 남고, 새 탭·새 Playwright 컨텍스트에서는 비어 있다.
  localStorage 면 E2E 가 서로 상태를 물려받는다.

**OAuth 는 앱 안의 모의 화면으로 흉내 낸다.**

- `integrationStartUrl()`(`entities/integration/api/oauth.ts`) 은 실 API 라면 `…/integrations/{provider}/start?state=<복귀 경로>` 를,
  개발·MSW 모드(`import.meta.env.DEV && config.mswEnabled`)면 `/__mock/oauth/:workspaceId/:provider?state=` 를 준다.
- 모의 화면(`shared/mock/oauth/MockOAuthPage.tsx`)은 같은 조건에서만 라우트에 등록된다(`app/router/routes.tsx`).
  `DEV` 를 먼저 봐서 프로덕션 번들에서 분기와 화면 chunk 가 빠진다.
- `연결 허용` · `취소` · `실패 재현` 을 고르면 콜백이 할 일(연동 행 `connected`)을 흉내 내고, sessionStorage 에 쓴 뒤
  `location.replace()` 로 `state` 의 경로에 `?oauth=<provider>&oauth_result=success|cancelled|failed` 를 붙여 돌아간다.
  `state` 는 앱 안 경로만 받는다 — 외부 주소는 `/` 로 보낸다(열린 리다이렉트 방지).
- 돌아온 화면(`useIntegrationStep`)은 복귀 표시를 읽고 바로 주소에서 지운다. `success` 여도 **연동 상태를 다시 조회해**
  `connected` 일 때만 단계를 완료한다.

**복귀 파라미터 `?oauth=&oauth_result=` 는 프론트엔드 가정이다.** 실 API 에 콜백이 없어(계약 §4.3) 백엔드가 어떤 이름으로
돌려보낼지 정해진 것이 없다. 이름은 `shared/lib/oauth/returnParams.ts` 한 곳에만 있고, 읽는 쪽은 `readIntegrationReturn()` 하나다.

## 왜

- 브라우저 흐름(가입 → 온보딩 → OAuth 왕복 → 새로고침)을 MSW 만으로 끝까지 확인할 수 있어야 E2E ①·③ 이 성립한다.
  Vitest 와 영속을 공유하면 테스트 순서에 따라 결과가 바뀐다.
- 서비스 워커는 페이지 이동(navigation) 요청을 가로채지 않는다. `start` 를 MSW handler 로 만들어도 현재 탭 이동이 그 handler 에 닿지 않는다.
  그래서 OAuth 제공자 화면 자리를 앱 라우트로 둔다.
- 복귀 결과만 믿지 않고 다시 조회하는 규칙은 실 API 가 와도 그대로 맞다 — 콜백 성공과 연동 행 존재는 다른 사실이다.

## 다시 고민할 때

- 실 API 에 `start`·`callback` 이 생기면: `integrationStartUrl()` 의 실 API 분기가 그대로 쓰인다. 콜백이 돌려보내는 파라미터 이름이
  다르면 `returnParams.ts` 의 두 이름만 바꾼다. 모의 화면은 개발용으로 남겨도 된다.
- 백엔드 콜백이 결과를 쿼리가 아니라 다른 방식(예: 조회 전용 상태)으로 알리면 `readIntegrationReturn()` 을 그 방식으로 바꾼다.
- `MockDb` 에 칸을 더하거나 픽스처를 바꾸면 `MOCK_DB_VERSION` 을 올린다.
