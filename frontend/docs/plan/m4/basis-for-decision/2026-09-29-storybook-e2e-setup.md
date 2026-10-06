# Storybook·Playwright 를 Vite 8·React 19·TS 6 에 어떻게 붙일 것인가

- 날짜: 2026-09-29
- 상태: 결정 (trace 기록 방식은 2026-10-02 에 바꿈, CI 업로드 조건은 2026-10-06 에 점검 — 아래 두 절)

## 고민

M4 끝에 Storybook(D-141)과 브라우저 E2E(D-116, D-117)를 들인다. 갈림길이 네 개였다.

1. 버전 — 이 저장소는 Vite 8 · React 19 · TypeScript 6 이다.
2. 스토리가 데이터를 어떻게 받나 — M4 폼·메뉴·온보딩은 Query 와 `request` 를 탄다. 로딩·오류 상태를 보여야 한다.
3. E2E 를 무엇 위에서 돌리나 — MSW 는 개발 모드에서만 돈다(`main.tsx`).
4. 도구 설정이 기존 검사(ESLint·tsc·Vitest)와 부딪히는 곳.

## 고른 길

1. **Storybook 10.6**(`storybook` · `@storybook/react-vite`) — peer 가 `vite ^8`, `react ^19`, `typescript >=4.9` 라 우회가 필요 없다.
   **Playwright 1.63**(`@playwright/test`), Chromium 만.
2. Storybook preview 가 앱과 같은 MSW handler 를 띄운다(`.storybook/preview.tsx`).
   - `public/` 을 정적 폴더로 올려 `mockServiceWorker.js` 를 같이 낸다.
   - 스토리마다 `parameters.scenario`(U1 시나리오), `parameters.msw`(기본 handler 위에 그 스토리만 얹는 handler — 로딩
     `delay('infinite')`, 오류 `fail()`), `parameters.setup`(db 손질), `parameters.route`(MemoryRouter 시작 주소)를 고른다.
     스토리마다 새 QueryClient 다.
   - 스토리를 열 때마다 loader 가 `worker.resetHandlers()`(인자 없음)로 앞 스토리가 얹은 handler 를 걷고
     `worker.use(...parameters.msw)` 로 그 스토리 것만 얹는다. **`resetHandlers(...handlers)` 로 한 번에 하지 않는다** —
     MSW 2 에서 인자를 준 `resetHandlers` 는 기본 handler 목록 자체를 그것으로 바꾼다. 그러면 오버라이드 스토리는 나머지 요청이
     처리되지 않고, 같은 iframe 에서 뒤에 여는 스토리도 모두 404 가 된다(F-r1 #1).
   - 이 약속은 `npm run test:storybook` 이 지킨다 — `storybook build` 산출물을 정적 서버(`e2e/storybook/serve.mjs`, 프록시 없음)로 띄워
     오버라이드 스토리를 바로 열고, 사이드바로 오버라이드 → 기본 스토리를 옮기며 `/api/v1/*` 404 가 0 건이고 기본 데이터가 보이는지 본다
     (`e2e/storybook/stories.sb.ts`, `playwright.storybook.config.ts`, 포트 6211). CI 는 `storybook` 잡에서 돌린다.
     `vite preview` 로 띄우지 않는 까닭: `server.proxy` 를 물려받아 MSW 가 놓친 요청을 로컬 백엔드(:8000)로 보낸다.
   - 스토리 제목 묶음: `M2 공통 UI/*`, `M4 공통/*`, `M4 폼/*`, `M4 온보딩/단계`, `M4 메뉴/앱 셸`.
3. E2E 는 Playwright `webServer` 가 Vite 개발 서버를 `VITE_ENABLE_MSW=true` 로 띄운 위에서 돈다(`playwright.config.ts`, 포트 5211).
   테스트마다 새 브라우저 컨텍스트(빈 sessionStorage)에 `?msw-scenario=` 로 db 를 초기화해 서로 독립이다 — 그래서 병렬로 돈다.
   trace 는 `retain-on-failure`, 실패 화면 스크린샷을 남긴다(trace 는 2026-10-02 에 `on-first-retry` 로 바꿨다 — 맨 아래 절). 파일은 `e2e/*.e2e.ts` 다.
   - **서버를 재사용하지 않는다**(`reuseExistingServer: false`, 로컬·CI 모두). Playwright 는 URL 응답만 보고 재사용하므로, 여러 worktree 를
     함께 띄우는 이 저장소에서는 다른 worktree 의 서버로 E2E 가 통과할 수 있다. 포트가 차 있으면 시작이 실패하고,
     `E2E_PORT` 환경 변수로 다른 포트를 준다. 매번 서버를 띄우는 몇 초는 잘못된 코드로 통과하는 것보다 싸다.
   - 저장값을 망가뜨리는 테스트는 `page.addInitScript` 로 **다음 문서의 맨 앞**에서 쓴다. 지금 문서에서 쓰면 늦게 끝난 모의 응답의
     저장(`response:mocked`)이 reload 전에 덮어쓸 수 있다.
   - CI 는 Playwright 브라우저(`~/.cache/ms-playwright`)를 설치된 `@playwright/test` 버전 키로 캐시한다. 적중하면 `install-deps` 로
     OS 의존성만 설치하고, 빗나가면 `install --with-deps chromium` 이다.
4. 부딪힌 곳과 푼 방법
   - Vitest 가 E2E 를 집어 가지 않게 이름을 `*.e2e.ts` 로 하고 `vite.config.ts` 의 `test.exclude` 에 `e2e/**` 를 더했다.
   - `tsconfig.json` 의 `include` 에 `e2e`·`playwright.config.ts` 와 **`.storybook/*.ts`·`.storybook/*.tsx` 를 파일 패턴으로** 넣었다.
     `".storybook"` 처럼 폴더로 적으면 TypeScript 가 점으로 시작하는 폴더를 건너뛰어 ESLint 의 project service 가 파일을 못 찾는다.
   - `react-refresh/only-export-components` 를 스토리·`.storybook`·`e2e` 에서 끈다(`eslint.config.js`). 스토리는 meta·스토리 객체를,
     preview 는 설정 객체와 감싸는 컴포넌트를 함께 내보낸다 — fast refresh 대상 모듈이 아니다. `eslint-disable` 주석은 쓰지 않는다.
   - Storybook 의 `Parameters` 는 색인 시그니처라 모듈 보강 대신 preview 안의 `StoryParameters` 타입으로 좁혀 읽는다.

## 왜

- 스토리가 실제 request 경로와 MSW 를 타야 "로딩·오류" 스토리가 진짜 그 상태다. props 로 흉내 내면 화면 코드와 스토리가 따로 논다.
- MSW 가 개발 모드에서만 도는 것은 프로덕션 번들에서 모의 코드를 빼려는 M1 결정이다. E2E 를 빌드 산출물(`vite preview`) 위에서 돌리면
  MSW 가 없다. 그래서 개발 서버다.
- sessionStorage 영속 + 컨텍스트 분리 + 시나리오 파라미터로 초기화가 테스트 안에서 끝난다 — 전역 셋업·순서 의존이 없다.

## 다시 고민할 때

- 실 백엔드 E2E 가 필요해지면(연동 `start`·`callback` 이 생긴 뒤) 별도 프로젝트로 `webServer` 없이 백엔드 URL 을 받게 한다.
- Storybook 에 접근성 검사(addon-a11y)나 인터랙션 테스트 러너를 CI 에 붙이려면 그때 addon 을 더한다. 지금은 `build-storybook` 통과와
  handler 회귀 확인(`test:storybook`)까지다. 모든 스토리의 play 를 CI 에서 돌리려면 test-runner 를 들인다.
- Chromium 외 브라우저 지원이 범위에 들어오면(D-126 은 Chrome 최신 2개) `projects` 에 추가한다.

## 2026-10-02 — trace 는 다시 돌릴 때만 기록한다 (`on-first-retry`)

위 3번의 `retain-on-failure` 를 앱 E2E(`playwright.config.ts`)와 Storybook 회귀(`playwright.storybook.config.ts`) 모두
`on-first-retry` 로 바꿨다. 실패 화면 스크린샷(`only-on-failure`)과 CI 의 `retries: 1` 은 그대로다. M5 U1·U2 3회차에서 측정하고
사용자 승인을 받았다.

### 고민

전체 `npm run test:e2e` 에서 `restore.e2e.ts:10` 이 `Tearing down "context" exceeded the test timeout of 30000ms` 로 가끔 실패했다.
단독으로 다시 돌리면 통과했다. 측정해 보니 이렇다(Windows, 8코어, 4 workers, Playwright 1.63).

- Playwright 1.63 은 after-hooks(fixture 정리)에 본문과 따로 30초 슬롯을 준다. 그래서 이 오류는 본문이 느렸다는 뜻이 아니라
  **context 정리만으로 30초를 넘겼다**는 뜻이다. 통과한 실행에서도 restore:10 의 전체 시간이 30초를 넘은 적이 있다(46.6초) — 정리가
  한계 가까이 갔다.
- context 정리의 거의 전부가 trace 마무리(`tracing.stopChunk`)다. `retain-on-failure` 는 통과할 테스트도 매번 스냅샷·스크린캐스트·
  네트워크를 기록하고, 정리 때 쌓인 기록을 비운 뒤에야 버린다. trace 를 켠 전체 실행에서 restore:10 은 본문 7.2초, context 정리 15.3초였다.
  개발 서버라 문서를 한 번 열 때 모듈 요청이 200개 남짓이고, restore:10 은 문서를 네 번 열어 요청이 860개쯤 된다.
- 같은 흐름을 4 workers 로 나눠 잰 정리 비용: 스냅샷+스크린캐스트 3.7~9.0초, 스냅샷만 1.7~5.0초, 스크린캐스트만 0.7~4.8초,
  둘 다 끔 0.04~0.7초. `context.close()`·실패 대비 스크린샷은 0.03초 안팎이다.
- 전체 E2E 시간: trace 기록(그때 설정) 62~148초, restore:10 17~56초. `--trace off` 31~34초, restore:10 약 6초.
  기록 비용이 기계 부하를 키워 본문도 함께 느려진다. Storybook 회귀도 같은 꼴이다 — 정리 2.7~4.3초로 본문보다 길 때가 많고,
  전체 13.5초 대 4.8초.
- 기준 커밋 `8beab48`(M5 전)에서도 같은 간헐 실패가 났다(3회 중 1회, 복원 테스트 2개 시간 초과). M5 회귀가 아니다.
- 실행 로그의 Vite proxy `ECONNREFUSED`·`ETIMEDOUT` 은 원인이 아니다. MSW 는 `beforeunload` 에 `CLIENT_CLOSED` 를 보내고, 그 뒤
  떠나는 문서가 낸 요청이 서비스 워커를 지나쳐 프록시(:8000)로 간다. 앱이 MSW 밖에서 응답을 받은 경우는 측정 중 0건이었다.

### 고른 길

- **`trace: 'on-first-retry'`.** 첫 시도는 기록하지 않는다. CI 는 실패한 테스트를 한 번 다시 돌리며 그 재시도를 기록하고,
  기존처럼 `test-results/` 를 아티팩트로 올린다 — "실패 시 trace 보관"(M4 계획)은 재시도 trace 로 지킨다.
- 로컬은 `retries: 0` 이라 trace 가 남지 않는다. 실패를 들여다볼 때는 `npx playwright test <파일> --trace on` 으로 다시 돌린다.
- 대기 한도·retries·단언은 바꾸지 않았다.

### 왜

- 비용을 덮지 않고 없앤다. 정리 시간은 문서 수와 기계 부하에 비례해 늘어나므로, timeout 을 늘리면 다음 부하에서 다시 넘는다.
  스냅샷이나 스크린캐스트만 끄면 절반쯤 줄 뿐이다.
- `on-first-retry` 는 Playwright 의 권장 기본값이다. 첫 실패의 trace 는 잃지만, 다시 돌려도 실패하는 테스트는 trace 가 남고
  다시 돌려 통과하는 테스트는 그 자체로 불안정하다는 신호다(CI 리포트에 flaky 로 찍힌다).

### 다시 고민할 때

- CI 에서 재시도로는 재현되지 않는 첫 실패가 잦아 첫 시도 trace 가 꼭 필요하면 `retain-on-first-failure` 를 CI 에서만 쓰는 방법이 있다.
  그때는 정리 비용이 30초 슬롯 안에 드는지 CI 에서 먼저 잰다.
- E2E 가 개발 서버 대신 번들된 산출물 위에서 돌게 되면(모듈 요청이 몇 개로 준다) 기록 비용을 다시 잰다.

## 2026-10-06 — CI 아티팩트 업로드 조건 점검 (M5 U6-4)

`retries: 1` + `on-first-retry` 에서 CI 가 무엇을 올리는지 확인했다. 동작은 바꾸지 않았다.

| 결과 | Playwright 종료 | 아티팩트(`if: failure()`) | 남는 것 |
|---|---|---|---|
| 통과 | 0 | 없음 | — |
| 두 번 다 실패 | 1 | `frontend-e2e-report`(`playwright-report/`·`test-results/`) | 첫 시도 스크린샷·오류, **재시도 trace**(`*-retry1/trace.zip`)·스크린샷 |
| 첫 시도 실패, 재시도 통과(flaky) | 0 | 없음 | 실행 로그의 flaky 표시와 첫 시도 오류(`github` 리포터). 재시도 trace 는 러너에만 있고 사라진다 |

- "실패 시 trace 보관"은 두 번 다 실패한 테스트에서 지켜진다. 첫 시도 trace 는 어느 경우에도 없다(기록하지 않는다).
- flaky 의 재시도 trace 는 **통과한** 실행의 기록이라 원인을 거의 담지 않는다. 그것을 올리려고 업로드 조건을 `!cancelled()` 로 넓히면
  매 실행 리포트를 올리게 된다 — 이득에 비해 근거가 약해 그대로 둔다. flaky 는 로그의 첫 시도 오류로 보고, 로컬에서
  `npx playwright test <파일> --repeat-each=5 --trace on` 으로 재현한다.
- Storybook job(`test:storybook`)도 같다 — `playwright-report-storybook/`·`test-results-storybook/` 을 실패 때만 올린다.
- M5 의 새 E2E(`e2e/meeting-*.e2e.ts`)는 `testMatch: '**/*.e2e.ts'` 로, M5 스토리 play 검사는 `e2e/storybook/stories.sb.ts` 로
  기존 job 에서 그대로 돈다. 워크플로 파일은 고치지 않았다.

다시 고민할 때: CI 에서 flaky 가 잦아 첫 시도 기록이 필요하면 위 「다시 고민할 때」의 `retain-on-first-failure`(CI 만)와
`if: ${{ !cancelled() }}` 업로드를 함께 쓴다. 리눅스 러너에서의 기록 비용은 아직 재지 않았다.
