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

화면 단위 검사는 `npm run test`(Vitest + React Testing Library, 앱과 같은 MSW handler)로, 사용자 흐름은 아래 E2E 로 본다. Storybook 은 쓰지 않는다(#482).

## E2E

```bash
npx playwright install chromium  # 처음 한 번
npm run test:e2e                  # Vite 개발 서버(MSW)를 5211 포트로 띄워 Chromium 으로 돈다
```

E2E 는 매번 자기 개발 서버를 새로 띄운다 — 이미 떠 있는 서버를 재사용하지 않는다. 여러 worktree 를 함께 띄운 환경에서
다른 worktree 의 서버가 5211 을 쓰고 있으면 시작이 실패한다. 그때는 `E2E_PORT=5212 npm run test:e2e` 처럼 다른 포트를 준다.

테스트마다 `?msw-scenario=` 로 모의 데이터를 초기화한다 (`e2e/support.ts`). 실패하면 `playwright-report/`·`test-results/` 에 스크린샷이 남는다 — `npx playwright show-report`. trace 는 다시 돌릴 때만 기록한다(`on-first-retry`, CI 는 retries 1). 로컬에서 trace 가 필요하면 `npx playwright test <파일> --trace on`.

## 개발 모드의 모의 데이터

모의 데이터는 `VITE_ENABLE_MSW=true`를 명시했을 때만 쓴다. E2E·Vitest는 이 설정과 상관없이 MSW를 쓴다. 실제 API 호출이 실패해도 모의 응답으로 자동 전환하지 않는다.

`VITE_ENABLE_MSW=true` 면 브라우저는 **비로그인**으로 시작하고, 가입·워크스페이스·온보딩 진행이 같은 탭의 sessionStorage 에 남는다(새로고침·OAuth 왕복).
픽스처 계정은 `pm@example.com` / `mock-password` 다. 시작 상태를 고르려면 주소에 `?msw-scenario=` 를 붙인다 —
`signed-out` · `no-workspace` · `single-workspace` · `multiple-workspaces` · `incomplete-workspace`.
Discord·Notion 연결은 모의 OAuth 화면(`/__mock/oauth/...`)으로 흉내 낸다 (`docs/plan/m4/basis-for-decision/2026-09-29-msw-storage-oauth-mock.md`).

## 백엔드 연동

백엔드 FastAPI는 `:8000`, 경로 prefix는 `/api/v1`이다. CORS가 없으므로 브라우저는 백엔드를 직접 호출하지 않는다.

개발 서버는 기본으로 실제 API를 부른다(`VITE_ENABLE_MSW=false`). `VITE_API_BASE_URL`은 비워 두고 Vite proxy를 쓴다. `/api` 요청은 `API_PROXY_TARGET`으로 전달되며, 비워 두면 `http://localhost:8000`이다. 이 값은 개발 서버만 읽고 브라우저 번들에는 들어가지 않는다.

로컬 백엔드에 붙일 때:

```bash
cd ../backend && ./run.sh
```

배포 백엔드에 붙일 때:

```bash
API_PROXY_TARGET=https://managers-manager.duckdns.org npm run dev
```

프록시 확인: `http://localhost:5173/api/v1/auth/me`가 백엔드의 `401 UNAUTHENTICATED` 봉투를 돌려주면 연결된 것이다. 백엔드 `/health`는 `/api` 밖이라 프록시로 확인할 수 없다.

예전에 MSW로 띄운 브라우저에는 mock worker가 남아 있을 수 있다. 실제 API로 띄우면 앱이 시작할 때 그 worker를 해제하고 한 번 다시 불러온다. 이미 만든 `.env`가 `VITE_ENABLE_MSW=true`이면 실제 API로 바뀌지 않으니 값을 확인한다.

환경 변수 예시는 `.env.example`. 비밀키와 OAuth client secret은 프론트엔드 환경 변수에 두지 않는다.

## 디렉터리

프론트엔드는 인증·공간 선택·온보딩·회의 업로드·처리 추적·회의록, 태스크 목록·보드·간트·캘린더·승인, 대화·알림, 팀·연동 설정과 계정 탈퇴 화면을 담당한다. 백엔드와의 API 경계는 [대표 계약](docs/contracts/frontend-api-contract.md), 파트 간 처리 순서는 [전체 흐름](../docs/파트별%20전체%20흐름.md)에 정리한다.

`src/`는 Feature-Sliced Design이다. 의존은 위에서 아래로만 흐른다.

`app` → `pages` → `widgets` → `features` → `entities` → `shared`

## 문서

- [문서 안내](docs/README.md): 대표 경로, 기존 문서 대응과 유지한 자료.
- [API 계약](docs/contracts/frontend-api-contract.md): 기존 백엔드 요청과 현재 코드 차이를 한 문서에서 관리.
- [전체 계획](docs/plan/frontend-plan.md) · [마일스톤 상태·기록](docs/plan/README.md): M0~M8. M0~M5는 기존 계획 원문을 각 `plan.md`로 이동했다. M6·M7·M8은 작성된 계획과 결과가 있다. 결과는 [M6](docs/plan/m6/result.md), [M7](docs/plan/m7/result.md), [M8 태스크 보기](docs/plan/m8/result-a.md)·[설정](docs/plan/m8/result-b.md)·[메시지](docs/plan/m8/result-c.md)에서 확인한다.
- 후속 수정과 refactor는 [실제 작업 이력](docs/plan/README.md)에서 기능별로 찾는다. 결과는 담당 마일스톤 또는 refactor의 `work-items/<식별자>-<이름>/`에 둔다. 이 README에 작업별 줄을 더하지 않는다. [과거 후속 목록](docs/plan/history/2026-11-07-followups.md)은 역사 기록으로 보존한다.
- [공통 작업 규칙](../docs/agent-rules.md) · [문서 양식](../docs/README.md).
- `docs/requests/`: 실제 독립 요청 발생 시 기록. 기존 백엔드 요청은 API 계약 §4에 유지.
- [제품·기술 결정](docs/decision/frontend-decisions.md) · [구현 결정 안내](docs/plan/basis-for-decision-guide.md): 구현 결정 원문은 해당 마일스톤의 `basis-for-decision/`에 있다.
- [디자인](docs/design/design-system.md) · [캔버스](docs/design/canvas/README.md) · [마스코트](docs/mascot/mascot.md).
- [성능 개선 거리](docs/performance/README.md): 측정했지만 아직 고치지 않은 것.

### 마일스톤 상태

M0~M3은 대응 코드가 있으나 이번 문서 작업에서 완료조건을 재검증하지 않았다. M4·M5는 기존 계획·인수인계에 MSW 기준 완료 판정이 기록돼 있다. M5 인수인계가 남긴 실제 백엔드 미검증은 그 기록 시점의 상태다.

M6는 [계획](docs/plan/m6/plan.md)의 구현 순서 1~5와 [결과](docs/plan/m6/result.md)가 있다. 결과의 Node v22.17.1 게이트와 당시 실 API 보완·승인 권한·Notion의 미검증 기록을 보존한다. 후속 코드와 API 규약은 [대표 계약](docs/contracts/frontend-api-contract.md)에서 확인한다. 이 문서 작업은 당시 테스트를 재실행하지 않았다.

M7은 [계획](docs/plan/m7/plan.md)과 [결과](docs/plan/m7/result.md)에 프론트·MSW AC, E-01~E-05 수정, 2026-10-18 Node v24.21.0 게이트 기록이 있다. 실제 Notion 반영·되돌리기 검증과 구분한다.

M8은 태스크 보기·설정·메시지 구현과 결과 기록이 있다. [마일스톤 안내](docs/plan/README.md)는 과거 MSW 검증과 후속 API 연결 기록을 구분한다. 빈 구조나 착수 전 상태로 표시하지 않으며, M8 전체 완료를 선언하지 않는다.
