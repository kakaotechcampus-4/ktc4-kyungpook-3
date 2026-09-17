# 프론트엔드 개발 계획

- 작성일: 2026-09-15
- 상태: 초안
- 근거: `frontend/docs/decision/frontend-decisions.md` (D-001~D-159)

## Context

`frontend/docs/decision/frontend-decisions.md`에 D-001~D-149의 결정이 축적되어 있고, 특히 D-107~D-149에서 기술 스택·구조·테스트·CI·접근성까지 이미 확정되었다. 반면 `frontend/` 디렉터리에는 아직 `README.md`와 `docs/`만 있고 **코드가 한 줄도 없다**.

따라서 이 계획의 목적은 "무엇을 쓸지"를 다시 정하는 것이 아니라, **확정된 결정을 실행 가능한 순서로 분해하는 것**이다. 결과물은 저장소에 `frontend/docs/plan/frontend-development-plan.md`로 남겨 결정 기록과 짝을 이루게 한다.

### 조사로 드러난 3가지 제약

1. **백엔드 API가 화면 요구를 거의 충족하지 못한다.**
   `backend/app/main.py`는 FastAPI(:8000, prefix `/api/v1`)이고 구현된 엔드포인트는 meetings / extractions / approvals 뿐이다. **인증·사용자·워크스페이스·태스크·메시지 API가 없고, `CORSMiddleware`도 없다.** → MSW 우선 개발(D-146)이 선택이 아니라 전제다.
2. **디자인 토큰이 아직 존재하지 않는다.**
   `design-system.md`와 `canvas/*.dc.html` 전체에 `var(--...)`가 **0건**이다. 모든 값이 인라인 하드코딩 hex/px다. D-112의 "토큰을 CSS 변수로 정의"는 기존 파일을 참조하는 작업이 아니라 **신규 저작 작업**이다.
3. **프로토타입을 마크업 원본으로 쓰면 안 된다.**
   `managers-manager-refined.html` / `site-runtime/`은 이전 세대 디자인(ink `#0A0A0A`, 금지된 weight 500, IBM Plex Sans KR)이라 현재 디자인 시스템과 충돌한다. **마크업·스타일 원본은 `canvas/*.dc.html`, 실측 기준은 `Foundations.dc.html`**(문서와 충돌 시 우선), 프로토타입은 **상호작용·상태 전이·시드 데이터 참고용**으로만 쓴다.

### 접근 방식 (확인된 선택)

- **계약 우선(contract-first), 단 합의 없이.** 백엔드와 API를 사전 합의하지 않는다(D-159). 프론트엔드가 필요한 요청과 응답을 **스스로 가정해 명세로 고정하고**(M1) 그 위에 화면을 올린다. 도메인 모델이 흔들리면 MSW 픽스처와 화면이 함께 재작업되므로 UI보다 먼저, 한 번에 끝낸다.
  - 다만 **결정이 있는 범위만** 확정한다. 태스크 필터·보드 컬럼·간트·캘린더·메시지·워크스페이스 설정은 제품 결정 자체가 없으므로(결정 기록이 D-106까지만 존재) 계약 문서에 **`결정 대기`로 표기만** 해 백엔드가 존재를 알되 막히지는 않게 한다. 없는 결정을 계약으로 앞질러 확정하지 않는다.
  - 계약이 고정되므로 이후 UI 슬라이스는 순서 제약이 크게 줄고, 디자인 토큰(M2)과 라우팅(M3)은 서로 병행할 수 있다.
- 모든 화면은 **MSW를 유일한 데이터 출처**로 개발한다. 실제 API가 제공되면 D-133에 따라 생성 타입으로 교체하고 **entities 계층의 변환만** 수정한다.
- 가정 명세는 회의 안건이 아니라 **백엔드에 넘길 인수인계 자료**로 유지한다. 백엔드를 향한 요청은 그 문서의 §5 한 절에 모은다(D-160).
- 이후 화면은 **수직 슬라이스**(UI + API + 테스트 동시 완성)로 진행한다.
- **대시보드는 회의·태스크 이후에 완성한다.** 계약 우선으로 바뀌면서 픽스처 재작업 위험은 사라지지만, `확인하기`·`채워 넣기`가 태스크 상세로 이동해야 하는 의존(D-034)은 남는다. M4에서는 온보딩 종료 지점(D-013)으로서 **빈 상태 중심의 껍데기**만 만든다.

---

## 마일스톤 개요

| | 마일스톤 | 산출물 | 선행 |
|---|---|---|---|
| M0 | 프로젝트 기반과 툴체인 | 실행되는 빈 Vite 앱 + CI 게이트 | - |
| **M1** | **API 가정 명세 · 데이터 모델 · MSW** | 가정 명세 + entities 타입 + 공유 mock | M0 |
| M2 | 디자인 토큰 · 폰트 · shared/ui 1차 | 시안과 일치하는 공통 컴포넌트 | M0 |
| M3 | 앱 셸 · 라우팅 · 데이터 계층 | 가드/에러 경계까지 동작하는 라우터 | M1 |
| M4 | 인증 · 온보딩 · 워크스페이스 선택 (+ 대시보드 껍데기) | 로그인 → 온보딩 → 대시보드 진입 | M1~M3 |
| M5 | 회의 업로드 · 정리 중 · 회의록 | 업로드 → 정리 → 회의록 확인 | M4 |
| M6 | 태스크 리스트 · 상세 · 확인 필요 승인 | 승인 후 `반영됨` 확인 | M5 |
| M7 | 대시보드 완성 | 대시보드 전 영역 + 빈 상태 | M6 |
| M8 | 보드 · 간트 · 캘린더 · 메시지 · 워크스페이스/설정 | (골격) 착수 전 결정 필요 | M7 + 결정 |

M1이 끝나면 M2와 M3은 병행 가능하다. M4 착수 시점에 M1~M3이 모두 있어야 한다.

---

## M0. 프로젝트 기반과 툴체인

### 스캐폴딩

`frontend/`의 기존 `README.md`·`docs/`를 유지한 채 그 안에 Vite 앱을 구성한다.

- `npm create vite@latest`(react-ts). 기존 `docs/`를 덮어쓰지 않도록 주의.
- Node 고정(D-127): `frontend/.nvmrc`에 `24`, `package.json`의 `engines.node`에 `>=24 <25`. (로컬 확인됨: Node v24.11.0 / npm 11.6.1)
- `browserslist: ["last 2 Chrome versions"]` (D-126).
- `tsconfig.json`: `strict: true`, `useUnknownInCatchVariables`, `noUnusedLocals`, alias `@/* → src/*` (D-121).
- ESLint flat config (D-122, D-143):
  - `typescript-eslint` type-checked, `eslint-plugin-react-hooks`, `eslint-plugin-jsx-a11y`(D-128 보조).
  - `@typescript-eslint/no-explicit-any: error` — 예외는 한 줄 disable + 사유 주석(D-121).
  - **FSD 계층 의존성 제한**: `eslint-plugin-boundaries`로 `app > pages > widgets > features > entities > shared` 단방향 강제, 동일 레이어 slice 간 직접 참조 금지.
  - **번들 규칙**(아래 "번들 크기 규칙" 참조): `no-restricted-imports`로 `date-fns` 루트 import, Radix 통합 패키지 import 금지.
  - Prettier는 포맷만, `eslint-config-prettier`로 중복 제거.
- `vite.config.ts`:
  - **dev proxy `/api` → `http://localhost:8000`** — 백엔드에 CORS가 없으므로 이게 로컬 연동의 유일한 경로다.
  - alias, Vitest 설정(`environment: 'jsdom'`, `setupFiles`).
- `frontend/.env.example`(D-139): `VITE_API_BASE_URL`, `VITE_ENABLE_MSW`. 비밀키·OAuth client secret 금지.
- `frontend/.gitignore` 보강: `storybook-static/`, `playwright-report/`, `test-results/`, `.vite/`.
- **CI 추가**: `.github/workflows/frontend-ci.yml` (`paths: ['frontend/**']`, `pull_request` 대상 `develop`).
  기존 3개 워크플로는 `@kakaotechcampus-4/pipeline-admin` CODEOWNERS 소유이므로 **건드리지 말고 새 파일만 추가**한다.
  게이트(D-143): `npm ci` → `tsc --noEmit` → `eslint` → `prettier --check` → `vitest run` → `vite build`. 정적 검사·테스트는 병렬, 빌드는 그 뒤. **빌드 산출물 `dist/`를 아티팩트로 업로드해 배포에 재사용한다**(D-152). (Storybook 빌드는 M4 말에 추가)
- `frontend/README.md`를 실행 방법 중심으로 재작성.

### FSD 디렉터리 골격 (D-114)

```
frontend/src/
  app/        providers, router, styles 진입
  pages/      라우트 단위 페이지
  widgets/    화면 조합 단위
  features/   사용자 행동 단위
  entities/   도메인 모델 + API 훅 (workspace, meeting, task, message, member)
  shared/     api, config, lib/date, ui, mock, types
```

### 번들 크기 규칙 (프로젝트 전반에 적용)

FSD의 "공개 진입점"(D-114)과 tree-shaking은 충돌한다. slice마다 만드는 `index.ts` barrel은 **필요 없는 코드까지 함께 끌고 온다.** D-143은 외부 패키지 barrel만 언급하지만 실제로는 내부 barrel이 더 큰 위험이므로 아래를 규칙으로 못 박는다.

- barrel은 **slice 경계에서만** 만든다. 레이어 전체를 모으는 `shared/index.ts` 같은 광역 barrel을 만들지 않는다.
- barrel에서 **서드파티를 재export하지 않는다.**
- `date-fns`는 함수 단위로 정적 import (D-145가 이미 요구).
- Radix는 primitive별 패키지(`@radix-ui/react-dialog` 등)로 개별 import.
- **무거운 화면은 동적 import**: 간트·캘린더·보드(M8). D-130의 "작은 컴포넌트는 분할하지 않는다"는 이들에 해당하지 않는다.

**완료 기준**: `npm run dev`로 빈 화면이 뜨고, `npm ci && npm run typecheck && npm run lint && npm run format:check && npm run test && npm run build`가 통과하며 CI가 PR에서 실행된다.

---

## M1. API 가정 명세 · 데이터 모델 · MSW

UI보다 먼저, 한 번에 끝낸다. 백엔드와 합의하지 않으므로(D-159) 이 단계의 목적은 **이후 모든 화면이 공유할 도메인 모델을 고정하는 것**이다.

> **가정 명세는 실제 API와 다를 것이 확실하다.** 그래서 M1-B의 변환 계층이 권장이 아니라 필수다. 화면이 DTO를 직접 참조하면 실제 API가 나왔을 때 화면을 전부 뒤져야 한다.

### M1-A. 가정 명세 — `frontend/docs/api/frontend-api-contract-draft.md`

- **공통 규약**: `/api/v1` prefix, 응답 봉투 `{data, error}`, 오류 코드 목록, 인증 쿠키(D-147), 날짜(`YYYY-MM-DD`)와 timestamp(ISO 8601)를 **형식으로 구분**(D-144), 페이지네이션 표현.
- **확정 대상** (결정 D-001~D-106이 이미 정해준 범위):
  - **기존 구현**: `POST /meetings`, `PATCH /meetings/{id}/end`, `GET /meetings/{id}`, `POST|GET /extractions`, `POST|GET|PATCH /approvals`
  - **신규 요청**: auth(회원가입·로그인·로그아웃·`me`·Google OAuth), workspaces(목록/생성/상세, **온보딩 진행 상태 포함** — D-012/D-070), integrations(Discord·Notion 연결/해제/상태), Discord 사용자 목록·매핑(D-026~D-031), members, 회의 목록·음성 업로드(multipart, 진행률)·회의록 상세, tasks(목록·상세·상태 변경·확인 필요 승인/반려), 대시보드 요약(D-052~D-055), Notion 반영 되돌리기(D-036)
- **`결정 대기`로 표기만 하는 대상** — 존재를 알리되 스펙을 확정하지 않는다:
  태스크 목록의 필터·정렬·페이지네이션 파라미터, 보드·간트·캘린더 전용 조회, 메시지 전반, 워크스페이스 설정 항목. 해당 제품 결정이 나오면 계약 문서에 추가한다.
- 한 번 적은 요청·응답은 **화면 사정으로 임의로 바꾸지 않는다.** 바꾸면 MSW 픽스처와 통합 테스트가 함께 흔들린다.
- 백엔드 요청 목록을 이 명세의 §5 로 통합한다. 별도의 요청 문서를 두지 않는다(D-160).
- 명세는 최신 `origin/develop` 을 기준으로 쓰고 문서 머리에 기준 커밋을 적는다(D-160).

### M1-B. 데이터 모델 — `src/entities/*/model`

계약에 맞춰 `user`, `workspace`(온보딩 진행 상태 포함), `member`, `meeting`, `minutes`, `task`, `approval`, `integration`(Discord·Notion 연결 상태)의 프론트엔드 도메인 타입을 정의한다.
화면이 전송 DTO에 과결합되지 않도록 **DTO → 도메인 모델 변환을 `entities` 계층에 둔다**(D-133). nullable과 기본값은 이 변환 단계에서 처리한다(D-134).

**이 규칙은 백엔드 합의가 없는 상황에서 유일한 보험이다**(D-159). `pages`·`widgets`·`features`에서 DTO 타입을 import하지 않는다. 실제 API가 나왔을 때 고칠 범위를 엔티티당 파일 하나로 묶기 위한 것이며, ESLint `no-restricted-imports`로 강제한다.
OpenAPI 제공 전까지만 `shared/types`에 임시 DTO 타입을 두고, 제공되면 생성 타입으로 교체한다(D-133).
일반 API 응답 전체를 Zod로 중복 검증하지 않는다 — 사용자 입력과 URL 파라미터만 Zod, 응답은 생성 타입 + MSW 통합 테스트로 검증(D-134).

### M1-C. MSW handler — `src/shared/mock/`

- **로컬 개발 · Vitest · Storybook이 공유**한다(D-146). production 번들에서 완전히 제외(동적 import).
- 정상 응답이 기본. 빈 상태·권한 오류·검증 오류·서버 오류·느린 응답은 테스트/Story에서 개별 override.
- 고정 ID·날짜·내용. 자동 테스트에 인위적 지연 없음.
- `onUnhandledRequest`: 테스트는 실패, 로컬은 경고.
- `site-runtime/runtime.js`의 시드 데이터를 **픽스처 참고자료**로만 활용(마크업은 쓰지 않음).
- **팀 학습 항목**(D-146 열린 항목): MSW browser worker / node server / handler override / 미처리 요청 정책 사용 가이드를 `frontend/docs/`에 함께 작성.

**완료 기준**: 가정 명세가 문서로 고정되어 있고, `VITE_ENABLE_MSW=true`로 모든 확정 범위 엔드포인트가 mock으로 응답하며, 같은 handler로 Vitest가 동작한다. **화면 코드에서 DTO 타입을 직접 import하는 곳이 없다.**

---

## M2. 디자인 토큰 · 폰트 · shared/ui 1차

`design-system.md`를 기준으로, 충돌 시 `canvas/Foundations.dc.html` 실측값을 우선한다.

- **폰트**: `frontend/docs/design/canvas/_fonts.css`에 NanumSquare woff2가 base64로 박혀 있다. 이를 추출해 `src/shared/styles/fonts/*.woff2`로 저장하고 `@font-face`를 직접 작성한다. (869KB CSS를 그대로 import하면 안 된다)
  - 스택: `'NanumSquare','Apple SD Gothic Neo','Malgun Gothic',system-ui,sans-serif`.
  - **weight 500 사용 금지**(400으로 폴백). 600은 700으로 렌더되지만 문서가 사용하므로 유지.
  - **유일한 서체라 텍스트 렌더를 막으므로 `<link rel="preload" as="font" crossorigin>`으로 선로드**하고 `font-display: swap`을 건다.
  - `site-runtime/*.ttf`(IBM Plex / JetBrains / Space Grotesk)는 **폐기된 프로토타입 자산이므로 번들에 포함하지 않는다.**
- **토큰 정의**(D-112): `src/app/styles/tokens.css`에 Tailwind v4 `@theme`으로 CSS 변수 선언 → 유틸이 자동 생성되게 한다. (v3이면 `tailwind.config.ts`에서 `var(--...)` 참조)
  - 색: 텍스트 `#171717` `#5A5A5A` `#666666` `#999999` / 면 `#FFFFFF` `#FAFAFA` `#F0F0F0` `#EDEDED` / 선 `#E8E8E8` `#EFEFEF` `#C9C9C9` `#BDBDBD` `#949494` / 비활성 채움 `#DCDCDC` / 강조 `#FF6969` `#FF8989`. **`#000000` 금지.**
  - **`ok`/`warn`/`bad`/`pri` 같은 의미색 토큰을 만들지 않는다**(design-system.md §12 명시). 문서가 쓰는 이름(ink, 보조, 면, 선, 구분선, 컨트롤, 비활성, 입력 테두리, 강조)을 그대로 쓴다.
  - 간격: **4px 배수 스케일이 아니다**(3/5/7/9/13/14/18px 사용). 기본 스케일을 덮어쓰고 문서의 실제 값만 노출한다.
  - 반경: 4 / 6 / 7 / 8 / 9 / 10 / 11 / 12 / 16 / 999.
  - 타이포: body 13.5·400, meta 11.5·400(tabular-nums), button·label·badge 13·600, caption 12.5·400, landing lead 18·400 / body 16·400. `word-break: keep-all`, tracking 0.
  - 레이아웃: 앱 셸 max 1360px / 내부 컬럼 1000px, 랜딩 텍스트 1024px / 카드 1200px, 헤더 76px.
  - 그림자는 사용하지 않는다(문서 명시).
- **전역 스타일**: reset + `:focus-visible { outline: 2px solid #171717; outline-offset: 4px; }` — design-system.md §13의 열린 항목(포커스 링)을 **캔버스 아트보드에 이미 쓰인 이 값으로 확정 제안**한다.
- **shared/ui 1차 세트** (M4에서 실제로 필요한 것만, 이후 슬라이스에서 증분 추가):
  `Button`(주 액션 ink-fill·화면당 1개 / 기본 / 고스트 / 텍스트), `TextField`(입력 높이 3종: 제품 42px·`#949494`·r9, 온보딩 42px·`#C9C9C9`·r8, 로그인·회원가입 48px·`#C9C9C9`·r12), `Label`/`ErrorText`, `Card`/`Panel`, `Checkbox`, `SelectCard`·`Segmented`(Radix), `Modal`(Radix Dialog), `Toast`(Radix Toast), `EmptyState`, `Skeleton`.
  Radix는 동작·접근성만 사용하고 시각 스타일은 직접 입힌다(D-113). 공통 컴포넌트에 기능 전용 문구를 고정하지 않고 props로 받는다(D-149).
- **마스코트**: `frontend/docs/mascot/mascot.js`(절차적 SVG 생성기)를 `src/shared/ui/mascot/Mascot.tsx`로 포팅. 8개 포즈, viewBox `0 0 240 240`, `prefers-reduced-motion`이면 정지(`character.md`). SVG/PNG 파일이 저장소에 없으므로 인라인 생성이 유일한 방법이다.
- **Storybook은 여기서 도입하지 않는다.** 컴포넌트 API가 굳기 전에 설정 비용을 치르게 되므로 **M4 종료 시점에 도입**하고 CI에 `build-storybook`을 추가한다(D-141, D-143 충족).

**완료 기준**: 1차 컴포넌트가 시안과 육안 일치하고, 토큰 외 하드코딩 색·간격이 남아 있지 않다.

---

## M3. 앱 셸 · 라우팅 · 데이터 계층

- `app/providers`: `QueryClientProvider`, `RouterProvider`, Toast Provider, **Root Error Boundary**(D-129).
- `app/router`: `createBrowserRouter`. 공개 라우트와 보호 라우트를 **상위 레이아웃 라우트**로 분리하고 거기서 공통 검사(D-131).
  - 라우트 lazy 로드 + `Suspense` + 페이지 스켈레톤(D-130). 공통 레이아웃·헤더·기본 UI는 초기 로드.
  - 각 라우트에 **Route Error Boundary**(D-129).
  - 경로(D-108): `/`, `/login`, `/signup`, `/onboarding/*`, `/workspaces`, `/workspaces/:workspaceId/dashboard`, `/workspaces/:workspaceId/meetings/:meetingId?`, `/workspaces/:workspaceId/tasks/:taskId?`, `/workspaces/:workspaceId/messages/*`, `/workspaces/:workspaceId/members`, `/workspaces/:workspaceId/settings`.
- **가드**(D-131, D-070~D-072, D-102): `RequireAuth`, `RedirectIfAuthed`, `RequireTeamMember`, `RequireOnboardingComplete`, `RequirePM`. 페이지 일부의 PM 전용 액션은 컴포넌트 단계에서 제어. **프론트 접근 제어는 UX 목적이며 실제 권한은 API에서도 검증되어야 함**을 계약 문서에 명시.
- **가드 워터폴 방지 (중요)**: 가드를 순서대로 두면 `/me` → `/workspaces` → 페이지 데이터로 **3홉 직렬 대기**가 생겨 콜드 로드가 느려진다.
  앱 부팅 시 `/me`와 `/workspaces`를 **동시에** `queryClient.prefetchQuery`로 시작하고, 가드는 네트워크를 직접 기다리지 않고 **캐시를 읽기만** 하도록 구현한다. 페이지 데이터도 가드 통과를 기다리지 않고 라우트 진입과 함께 시작한다.
- `shared/api/client.ts`(D-120): Axios 인스턴스 — `baseURL`, `withCredentials: true`, **응답 봉투 `{data, error}` 해제**, 오류를 `AppError { code, message, status, details }`로 정규화. 인터셉터에 비즈니스 로직·재요청을 넣지 않는다(D-120, D-135).
- `shared/api/errorMessages.ts`(D-149): 백엔드 `ErrorCode`(`MEETING_NOT_FOUND`, `NOTION_WRITE_FAILED` 등)를 사용자용 한국어 문구로 변환. 백엔드 기술 문구를 그대로 노출하지 않는다.
- `QueryClient` 기본값:
  - 재시도(D-135): 취소 오류와 400/401/403/404/422/429는 재시도 없음. 네트워크 오류·408·5xx만 exponential backoff로 **최대 1회**. mutation·파일 업로드는 재시도 없음.
  - 캐시(D-136): 대시보드·태스크·회의록 목록 `staleTime` 30초, 워크스페이스 목록·팀원·설정·완료된 회의록 상세 5분, `gcTime` 5분.
  - **모든 워크스페이스 범위 Query Key에 `workspaceId` 포함**, 워크스페이스 전환 시 다른 워크스페이스 캐시 비노출.
- `shared/config`(D-139): 환경 변수 접근 일원화 + Zod 형식 검증.
- `shared/lib/date`(D-144, D-145): 표시는 `Intl.DateTimeFormat`(`ko-KR`, `Asia/Seoul`), 계산은 `date-fns`(함수 단위 정적 import). 날짜 전용 값은 `YYYY-MM-DD` **문자열로 유지**. **단위 테스트 대상**(D-115).
- `shared/lib/validation`: 워크스페이스 이름 정규화·검증(앞뒤 공백 제거 → 연속 공백 축약 → 1~20자, 대소문자 구분, 특수문자·이모지 허용 — D-016~D-020). **순수 함수 + 단위 테스트**(D-115).
- Zustand store: `authStore`, `uiStore`. 서버 데이터 복제 금지(D-110). persist는 `partialize`로 비민감 값만, 버전 포함 key(D-147).
- **공통 이탈 확인**(D-138, D-067): 미저장 폼 변경·미전송 선택 파일이 있을 때만. 앱 내부 이동·뒤로가기·워크스페이스 전환은 모달, 새로고침·탭 닫기는 브라우저 기본 경고. URL에 즉시 반영되는 검색·필터·정렬은 제외.
- **URL 검색 파라미터 정책**(D-132): 검색·필터·정렬·페이지네이션·캘린더 기준 날짜는 URL로 관리, Zustand 중복 저장 금지. 페이지 경계에서 한 번 검증·해석해 하위에 원시값만 전달. 검색어는 debounce + `replace`.

**완료 기준**: 로그인 여부를 모킹한 상태에서 보호 라우트 진입·리다이렉트·에러 경계·이탈 확인이 통합 테스트로 검증되고, 콜드 로드에서 `/me`·`/workspaces`가 **동시에** 요청되는 것이 확인된다.

---

## M4. 인증 · 온보딩 · 워크스페이스 선택 (+ 대시보드 껍데기)

관련 결정: D-002~D-031, D-066~D-076, D-142
화면: `Landing` / `Login` / `Signup` / `SetupTeam` / `SetupDiscord` / `SetupNotion` / `SetupMembers` / 워크스페이스 선택(= `Main.dc.html` 내부 드롭다운, 전용 아트보드 없음)

- 랜딩: 주요 CTA `시작하기` → 로그인(D-003). **`1분 데모 보기` 없음**(D-002), 회원가입 직접 링크 없음(D-004).
- 로그인/회원가입: 이메일+비밀번호, Google(D-007). `비밀번호를 잊으셨나요?`는 **제거하지 않고 비활성**, 안내 문구·배지 없음(D-005, D-006).
- 폼 공통 정책(D-142): `mode: 'onTouched'`, `reValidateMode: 'onChange'`, `shouldFocusError: true`. 필드 오류는 입력 아래, 비필드 서버 오류는 폼 상단. 서버 필드 오류는 `setError`로 반영. 제출 중 로딩·중복 제출 방지. 오류 문구를 입력과 접근성 속성으로 연결.
- 온보딩 파이프라인: `워크스페이스 만들기 → Discord → Notion → 팀원 연결`(D-008, D-009). 워크스페이스 만들기만 필수(D-011). 단계별 완료·건너뜀 저장, 다음 미완료 단계부터 재개(D-012). 종료 시 새 워크스페이스 대시보드로 이동(D-013).
- 워크스페이스 만들기: 워크스페이스 이름만(D-014). M3의 정규화·검증 함수 사용(D-016~D-020), 계정 기준 중복 금지(D-015).
- Discord 연결 건너뛰면 팀원 연결도 자동 `건너뜀`(D-073).
- 팀원 연결: Discord 사용자 목록 자동 로드 후 PM이 팀원 이름 입력(D-026). 1:1 매핑 강제(D-027), 부분 매핑 저장·완료 허용(D-029), 미매핑 화자는 Discord 아이디로 표시(D-028).
- 기존 사용자 로그인 분기(D-010): 워크스페이스 0개 → 온보딩 / 1개 → 대시보드 / 2개 이상 → 워크스페이스 선택.
- 워크스페이스 전환(D-066, D-067): 항상 선택한 워크스페이스 대시보드로. 미저장 변경 시 M3의 공통 이탈 확인 경유.
- 새 워크스페이스 만들기(D-068~D-072): 동일 파이프라인, 좌측 상단 뒤로가기로 진행 상태 저장 후 기존 워크스페이스 대시보드 복귀. 미완료 워크스페이스은 전환 메뉴에 `설정 미완료`, 선택 시 마지막 미완료 단계로, 대시보드 접근 차단. 재로그인 시에도 동일.
- **대시보드 껍데기**: 온보딩 종료 지점(D-013)이 필요하므로 앱 셸·헤더·5개 탭과 **빈 상태만** 구현한다. 요약 숫자·목록·되돌리기는 M7에서 채운다.
- **Storybook 도입** + CI `build-storybook` 추가(D-141, D-143).
- **E2E**(D-116, D-117): ① 이메일 가입/로그인 → 온보딩 완료 ② 기존 사용자 워크스페이스 선택·워크스페이스 전환. Google은 테스트 서버가 세션을 발급하고 실제 인증은 수동 검증.

OAuth는 **현재 탭 이동**으로 구현하고 복귀 경로를 `state`에 담는다(D-158). Discord·Notion 모두 동일하다.

---

## M5. 회의 업로드 · 정리 중 · 회의록

관련 결정: D-077~D-106 (`Upload` / `Processing` / `Meetings` / `EmptyMeetings`)

- 업로드: **음성 파일만 지원.** 디자인의 `텍스트 회의록` 탭과 관련 입력 영역을 **구현에서 제거**(D-084). 회의당 파일 1개(D-078), 드래그앤드롭 + 파일 선택기(D-077).
- 기본값: 제목은 확장자 포함 전체 파일명(D-081), 날짜는 Discord 녹음 날짜 또는 로컬 파일 `lastModified`(D-079). 둘 다 수정 가능.
- 검증: 제목 필수(D-087), 로컬 음성 파일은 참석자 최소 1명 필수(D-085)이며 **워크스페이스 등록 팀원 중에서만 선택**(D-086). Discord 녹음은 참석자 자동 입력(D-082).
- Notion 미연결 차단(D-096~D-098): `Notion 연결이 필요해요` 모달(`취소` / `Notion 연결하기`). 연결 성공 시 **원래 진입 경로를 기억해 회의 올리기로 자동 복귀**, 취소·실패 시 복귀하지 않음.
- 동시 실행 제한: **워크스페이스 전체 기준** 1건(D-088, D-089).
- 정리 중: 처리 상태만 별도 polling(D-136). 앱 내부 이동 허용, 백그라운드 계속 진행(D-094). `올리는 동안 창을 닫아도 됩니다` 문구를 **앱의 다른 페이지를 이용할 수 있다는 의미로 수정**. 완료 시 전역 토스트 `회의 정리가 끝났어요` + `회의록 보기`(D-095).
- 실패 처리(D-091~D-093): 원본 미보관. 회의록 페이지 이동 후 토스트 `회의를 정리하지 못했어요. 파일을 다시 올려 주세요.` 실패한 회의는 목록에 남기지 않음.
- Notion 연결 끊김(D-099, D-100): `Notion 연결이 끊어졌어요` 차단 모달 + `Notion 다시 연결하기`. 재연결 성공 시 회의 올리기로.
- 회의록: 회의 날짜 최신순, 최초 진입 시 최신 회의록 자동 선택(D-106).
- **권한 분기**(D-102~D-105): 일반 팀원에게 회의록의 `확인이 필요한 일` 영역 자체를 숨김(존재·개수도 비노출). 요약·전사문·반영 태스크는 읽기 전용, 변경 액션은 PM만.
- Notion 반영 시점(D-101): 회의록 본문과 확실한 태스크는 즉시 반영, `확인 필요`는 승인 시. **디자인의 `확인이 끝나기 전에는 Notion에 아무것도 쓰지 않아요` 문구를 이 정책에 맞게 수정.**
- 긴 전사문 목록에는 `content-visibility`를 적용해 초기 렌더 비용을 줄인다.
- **E2E**: 음성 업로드 → 정리 완료 → 회의록 확인. 테스트 서버는 정리를 즉시 완료(D-117).

**미결**: PM 외 업로드 권한, 정리 중 `회의 올리기` 진입 동작(D-090), 상단 내비게이션 `정리 중` 표시 여부, 일반 팀원의 `원본 듣기` 권한. 회의 파일 최대 용량·길이는 **프론트가 클라이언트 상수로 먼저 정하고**(D-159) 실제 서버 한도가 생기면 맞춘다.

---

## M6. 태스크 리스트 · 상세 · 확인 필요 승인

관련 결정: D-034, D-046, D-102~D-105, D-137 (`Tasks` / `EmptyTasks`)
보드·간트·캘린더는 결정이 없으므로 M8로 미룬다. 여기서는 **대시보드와 회의록이 링크하는 지점**을 먼저 만든다.

- M1에서 확정한 `entities/task` 모델을 화면에 적용한다. M7 대시보드와 M8의 모든 보기가 같은 모델을 공유한다.
- 태스크 리스트: 필터 상태를 URL로 관리(D-132). D-046의 "기한 지남 + 7일 이내" 필터 조합을 URL로 표현 가능해야 한다. **일반 필터·정렬·페이지네이션 파라미터는 M1에서 `결정 대기`로 남긴 항목이므로, 여기서는 D-046이 요구하는 조합만 구현하고 나머지는 M8에서 확장한다.**
- 태스크 상세: 대시보드의 `확인하기`·`채워 넣기` 도착 지점(D-034). **진입 직후 검토·편집 상태 자동 오픈 여부는 보류 항목이므로 열지 않는 것을 기본값으로** 구현하고, 결정되면 변경한다.
- 확인 필요 승인·반려: **PM만**(D-102). 일반 팀원의 상태 범위는 `전체`/`진행 중`/`완료`뿐이고 `전체`에 확인 필요를 포함하지 않는다.
- 비인가 직접 접근(D-103): `태스크 > 리스트`로 이동 + `접근 권한이 없어요` 토스트.
- 낙관적 업데이트(D-137): **상태 변경만** 적용(변경 전 캐시 보관, 실패 시 복구 + 오류 토스트, 완료 후 재조회, 동일 태스크 중복 조작 차단). **생성·삭제·확인 필요 승인은 서버 성공 후 반영.**
- **E2E**: 확인 필요 승인 후 화면에 Notion `반영됨` 표시(D-117). 실제 Notion 반영은 수동 검증.

---

## M7. 대시보드 완성

관련 결정: D-032~D-065 (`Main.dc.html`)
M5·M6에서 회의·태스크 도메인이 확정된 뒤 채운다.

- 상단 요약 4개를 `확인 대기 → 기한 지남 → 7일 이내 마감 → 막힌 일` 순으로(D-055). 숫자는 화면 표시 행 수가 아니라 **워크스페이스 전체 개수**(D-052). 기한 지남은 7일 이내 마감과 중복 집계하지 않음(D-053, D-054). 앞의 3개는 클릭 불가(D-061).
- 제목: 대상이 있으면 `확인이 필요한 일이 있어요`, 없으면 `확인이 필요한 일이 없어요`. 개수 없음(D-062, D-064). 제목 아래 최근 처리 회의 안내는 클릭 불가(D-063), 처리된 회의가 없으면 `아직 정리한 회의가 없어요`(D-065).
- `확인이 필요한 일`: 워크스페이스 전체 회의의 미해결 항목(D-049), 대기 시작 시각 오래된 순(D-050), 최대 5개(D-051). `확인하기`·`채워 넣기` → **M6의 태스크 상세로 이동**(D-034).
- `마감 임박`: 기한 지남 + 오늘 포함 7일 이내 미완료(D-043, D-044), 기한 지남을 위에 경고 상태로, 최대 5개(D-045). 초과 시 `전체 보기` → **M6의 태스크 목록에 동일 조건 필터 적용**(D-046). **행 전체가 클릭 영역**(D-047). 빈 상태 `마감이 임박한 태스크가 없습니다`(D-048).
- `최근 반영`: **가장 최근 회의록 1건의 Notion 반영 항목만**(D-038). 표시 개수는 디자인의 3개를 임시 기준(D-039, 보류). `전체 로그` 버튼은 비활성 유지(D-035).
  `되돌리기`는 대시보드에서 확인 모달 후 실행(D-036), 완료 항목은 제거하지 않고 위치 유지 + `되돌림` 상태 + 피드백(D-037). 외부 효과가 있으므로 **낙관적 업데이트 없이 서버 성공 후 반영**(D-137).
  빈 상태는 **원인 3종 구분**(D-041), 각각 회의 업로드 / 최근 회의록 상세 / 워크스페이스 설정 Notion 연결 영역으로 이동(D-042).
- 7일 이내·기한 지남 판정은 `shared/lib/date`에 넣고 **단위 테스트**(D-115). 빈 상태 문구·표시 개수는 E2E가 아니라 통합 테스트로(D-115).

---

## M8. 보드 · 간트 · 캘린더 · 메시지 · 워크스페이스/설정 (골격)

아트보드(`TasksBoard` / `TasksGantt` / `TasksCalendar` / `Messages` / `MessagesThread` / `Team` / `Settings` / `EmptyMessages`)는 모두 있지만 **결정 기록이 거의 없다.** 결정 기록 원칙("아직 정하지 않은 내용은 임의로 확정하지 않는다")에 따라 골격과 선행 결정 목록만 둔다.

**골격**

- 보드·간트·캘린더: M1에서 확정한 `entities/task` 모델을 공유한다. 보기 종류는 별도 경로로 표현하고 URL 파라미터에 중복하지 않음(D-132). 1024px보다 넓은 콘텐츠는 **페이지 전체가 아니라 해당 영역 안에서 가로 스크롤**(D-124). **셋 다 동적 import 대상**이며, 보드 드래그·간트 렌더는 리렌더 비용이 크므로 행/카드 단위 메모이제이션과 전역 구독 최소화를 적용한다.
- 메시지: Discord 발송 전 검토 + 개인 스레드. 발송은 외부 효과이므로 서버 성공 후 반영(D-137).
- 워크스페이스/설정: Discord·Notion 연결 관리, 팀원 연결 재진입(D-074, D-075), `연결되지 않은 계정` 영역(제목에 인원수 미표시 — D-076), 온보딩에서 건너뛴 연결 완료 경로(D-011).

**착수 전 필요한 결정**

1. 태스크 목록의 필터·정렬·페이지네이션 규격 (page/cursor — D-132 보류)
2. 보드 컬럼 정의와 상태 전이 규칙, 간트 기간 단위, 캘린더 기준
3. 태스크 상세 진입 시 검토·편집 상태 자동 오픈 여부 (D-034 보류)
4. 메시지 화면 정책 전반 (D-117이 E2E 시나리오 고정을 이 결정 이후로 미뤄 둠)
5. 워크스페이스 관리·설정 화면의 항목 범위와 권한
6. `막힌 일 N` 클릭 가능 여부와 이동 경로 (D-060, D-061 보류)
7. `최근 반영` 최대 표시 개수 확정 및 초과 항목 확인 경로 (D-039 보류)

---

## 운영·배포 준비 (M4 이후 지속)

### 배포 구조 (D-152)

프론트엔드와 백엔드를 **카카오테크 캠퍼스가 제공하는 단일 EC2**에 함께 올린다.

```
Caddy (또는 nginx) :443
├─ /      → 프론트 빌드 산출물 (dist/)
└─ /api   → FastAPI :8000
```

- **같은 오리진이므로 CORS가 필요 없고 세션 쿠키는 `SameSite=Lax`다**(D-151).
- **프론트 빌드를 서버에서 돌리지 않는다.** 서버는 t3.medium(4GB)이고 백엔드·DB·STT 모델이 같이 돈다. CI가 `dist/`를 아티팩트로 남기고 서버는 그것만 받아 배치한다.
- **도메인이 필요하다.** Elastic IP가 제한되어 서버를 재시작하면 공인 IP가 바뀐다. HTTPS 인증서를 못 받고 Google·Discord·Notion OAuth redirect URI가 매번 깨진다. 확보 방법은 미정(열린 항목).
- **CI에서 서버로 직접 밀어넣을 수 없다.** IAM 액세스 키 생성이 제한된다. 1차는 Session Manager 터미널에서 아티팩트를 받아 수동 배치하고, 자동화는 이후에 검토한다.
- preview 환경(PR마다 MSW 모드)은 M4 이후 필요할 때 추가한다. D-139에 따라 **통합 검증 환경으로 간주하지 않는다.**

### 일정 제약

AWS 실습 환경 제공 기간이 **2026-11-20**까지다. 계획 수립 시점(2026-09-15) 기준 **약 9주**이며, M0부터 최종 배포·시연까지 이 안에 끝나야 한다.

- 환경은 `local` / `production`만(D-139). 배포 전 로컬에서 production 빌드 + 단위·통합 + Playwright E2E 검증.
- 오류 모니터링(D-140): production에서 Error Boundary 포착 오류·미처리 JS 오류·반복 5xx·청크 로드 실패 수집. 앱 버전·라우트·브라우저만 담고 **토큰·비밀번호·API 본문·회의 내용·파일명은 수집하지 않음**. session replay 미사용.
- 번들 크기 보고서는 M5 이후 추가하고, 기준을 측정한 뒤에만 상한을 병합 차단 조건으로 승격(D-143).
- 접근성(D-128): 키보드 조작, 포커스 표시, 의미 있는 HTML, 레이블-오류 연결, 명암 대비, 색상 외 상태 표현. 아이콘 전용 버튼과 동적 상태에 접근 가능한 이름·상태 제공. `WCAG 2.2 AA 완전 준수`는 선언하지 않음.
- 커밋·브랜치 규약(저장소 관행): 브랜치 `feature/<이슈번호>-<kebab-slug>` → `develop`. 커밋 `type(scope): 한국어 설명`. **`frontend` scope는 선례가 없으므로 하나를 정해 일관되게 사용**한다.

---

## 주요 수정·생성 파일

| 경로 | 내용 |
|---|---|
| `frontend/package.json`, `tsconfig.json`, `vite.config.ts`, `eslint.config.js`, `.prettierrc`, `.nvmrc`, `.env.example` | M0 툴체인 |
| `frontend/src/app/` | providers, router, prefetch, Error Boundary, `styles/tokens.css` |
| `frontend/src/shared/api/` | Axios 인스턴스, 봉투 해제, 오류 정규화, 오류 코드→문구 |
| `frontend/src/shared/lib/date/`, `shared/lib/validation/` | 날짜·워크스페이스 이름 규칙 (단위 테스트 대상) |
| `frontend/src/shared/ui/` | 공통 컴포넌트 + `mascot/Mascot.tsx` |
| `frontend/src/shared/mock/` | MSW handler + 픽스처 (dev·test·Storybook 공유) |
| `frontend/src/pages/`, `widgets/`, `features/`, `entities/` | 슬라이스별 화면 |
| `frontend/docs/plan/frontend-development-plan.md` | 이 계획의 저장소 사본 |
| `frontend/docs/api/frontend-api-contract-draft.md` | API 계약 문서 (M1) |
| `.github/workflows/frontend-ci.yml` | 신규 CI (기존 3개 워크플로는 건드리지 않음) |

**참조만 하고 수정하지 않는 파일**: `frontend/docs/design/canvas/*`(읽기 전용 스냅샷), `design-system.md`, `character.md`, `frontend/docs/decision/frontend-decisions.md`.

---

## 검증

**각 마일스톤 공통**

```bash
cd frontend
npm ci
npm run typecheck        # tsc --noEmit
npm run lint             # eslint (FSD 계층 + 번들 규칙 포함)
npm run format:check     # prettier --check
npm run test             # vitest (단위 + 통합, MSW)
npm run build            # production 빌드
npm run build-storybook  # M4 이후
```

**로컬 실행 확인**

```bash
npm run dev              # VITE_ENABLE_MSW=true → mock 데이터로 전 화면 확인
# 백엔드 연동 확인 (CORS 없음 → Vite proxy 경유가 유일한 경로)
cd ../backend && ./run.sh        # :8000
# 프론트에서 VITE_ENABLE_MSW=false 로 /api/v1/health 프록시 응답 확인
```

**E2E** (D-116: 기능 해피패스 완성 시점에 작성, 전체 실행은 배포 전 누적)

```bash
npx playwright test
```

- M4: 가입/로그인 → 온보딩 완료, 워크스페이스 선택·워크스페이스 전환
- M5: 음성 업로드 → 정리 완료 → 회의록 확인
- M6: 확인 필요 승인 후 `반영됨` 표시
- PM/일반 팀원 권한 차이는 대표 1~2경로만 E2E, 나머지는 통합 테스트

**수동 검증**

- 뷰포트 1024 / 1440 / 1920px 확인. 보드·간트·긴 테이블은 **해당 영역 안에서만** 가로 스크롤(D-124).
- 키보드만으로 로그인 → 온보딩 → 대시보드 순회, 포커스 표시와 모달 포커스 트랩 확인(D-128).
- Chrome Stable 최신 2개 주요 버전에서 확인(D-126).
- **콜드 로드에서 `/me`·`/workspaces`가 동시 요청되는지 Network 탭에서 확인** (워터폴 방지).
- 실제 Google / Discord / Notion / STT 연동은 자동 E2E 제외, 테스트 계정으로 배포 전 수동 검증(D-117).
