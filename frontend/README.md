# Frontend

React + TypeScript + Vite 앱. Node 24 LTS만 사용한다 (`engines`: `>=24 <25`). 로컬은 `frontend/.nvmrc`를 따른다.

## 설치와 실행

```bash
cd frontend
npm ci
npm run dev
```

개발 서버는 `http://localhost:5173`에서 뜬다.

## 검사

```bash
npm run typecheck
npm run lint
npm run format:check
npm run test
npm run build
```

포맷을 맞출 때는 `npm run format`, 린트 자동 수정은 `npm run lint:fix`.

## Storybook

```bash
npm run storybook        # http://localhost:6006
npm run build-storybook  # storybook-static/
npm run test:storybook   # 빌드 뒤 정적으로 띄워 스토리 handler 회귀를 본다 (포트 6211)
```

스토리는 앱과 같은 MSW handler 로 데이터를 받는다. 스토리마다 `parameters.scenario` 로 시작 상태를 고르고, `parameters.msw` 는 기본 handler 위에 얹는다 (`.storybook/preview.tsx`).

## E2E

```bash
npx playwright install chromium  # 처음 한 번
npm run test:e2e                  # Vite 개발 서버(MSW)를 5211 포트로 띄워 Chromium 으로 돈다
```

E2E 는 매번 자기 개발 서버를 새로 띄운다 — 이미 떠 있는 서버를 재사용하지 않는다. 여러 worktree 를 함께 띄운 환경에서
다른 worktree 의 서버가 5211 을 쓰고 있으면 시작이 실패한다. 그때는 `E2E_PORT=5212 npm run test:e2e` 처럼 다른 포트를 준다.

테스트마다 `?msw-scenario=` 로 모의 데이터를 초기화한다 (`e2e/support.ts`). 실패하면 `playwright-report/`·`test-results/` 에 스크린샷이 남는다 — `npx playwright show-report`. trace 는 다시 돌릴 때만 기록한다(`on-first-retry`, CI 는 retries 1). 로컬에서 trace 가 필요하면 `npx playwright test <파일> --trace on`.

## 개발 모드의 모의 데이터

`VITE_ENABLE_MSW=true` 면 브라우저는 **비로그인**으로 시작하고, 가입·워크스페이스·온보딩 진행이 같은 탭의 sessionStorage 에 남는다(새로고침·OAuth 왕복).
픽스처 계정은 `pm@example.com` / `mock-password` 다. 시작 상태를 고르려면 주소에 `?msw-scenario=` 를 붙인다 —
`signed-out` · `no-workspace` · `single-workspace` · `multiple-workspaces` · `incomplete-workspace`.
Discord·Notion 연결은 모의 OAuth 화면(`/__mock/oauth/...`)으로 흉내 낸다 (`docs/impl-decision/2026-09-29-msw-storage-oauth-mock.md`).

## 백엔드 연동

백엔드 FastAPI는 `:8000`, 경로 prefix는 `/api/v1`이다. CORS가 없으므로 브라우저는 백엔드를 직접 호출하지 않는다.

개발 중에는 `VITE_API_BASE_URL`을 비워 두고 Vite proxy를 쓴다. `/api` 요청은 `http://localhost:8000`으로 전달된다.

```bash
cd ../backend && ./run.sh
```

프록시 확인: `http://localhost:5173/api/v1/health`

환경 변수 예시는 `.env.example`. 비밀키와 OAuth client secret은 프론트엔드 환경 변수에 두지 않는다.

## 디렉터리

`src/`는 Feature-Sliced Design이다. 의존은 위에서 아래로만 흐른다.

`app` → `pages` → `widgets` → `features` → `entities` → `shared`

## 문서

- 결정 기록: `docs/decision`
- 마일스톤 계획: `docs/plan`
- 디자인: `docs/design`
- 성능 개선 거리(측정했지만 아직 고치지 않은 것): `docs/performance`
