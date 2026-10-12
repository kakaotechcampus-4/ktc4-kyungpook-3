# M0 구현 사양 — 프로젝트 기반과 툴체인

> **이 문서만 읽고 구현할 수 있도록 작성했다.** 결정 기록(`../decision/frontend-decisions.md`, 약 1,700줄)을 읽을 필요가 없다.
> 값이 충돌하면 결정 기록이 우선한다. 이 문서는 거기서 파생된 요약이다.
> 관련 이슈 #34 · 브랜치 `chore/34-frontend-scaffolding` · 커밋 타입 `chore(frontend):`

## 목표

`frontend/`에 React + TypeScript + Vite 앱을 세우고 CI 게이트를 건다. **화면은 만들지 않는다.** 빈 앱이 뜨고 검사가 통과하면 끝이다.

**완료 기준**

```bash
cd frontend
npm ci && npm run typecheck && npm run lint && npm run format:check && npm run test && npm run build
npm run dev   # 빈 화면이 뜬다
```

그리고 PR에서 `frontend-ci` 워크플로가 실행된다.

---

## 지금 저장소 상태

- `frontend/`에는 `README.md`와 `docs/`만 있다. **코드가 없다.**
- 백엔드는 FastAPI, 포트 `8000`, prefix `/api/v1`. **`CORSMiddleware`가 없어서** 브라우저가 직접 호출하면 막힌다. Vite proxy가 유일한 로컬 연동 경로다.
- 인증·워크스페이스·태스크 API는 아직 없다. M1에서 MSW로 대체한다.
- 로컬 확인됨 — Node v24.11.0 / npm 11.6.1

## 하지 말 것

- `frontend/docs/`를 덮어쓰거나 지우지 않는다. 스캐폴딩 도구가 디렉터리를 비우려 하면 막는다.
- `.github/workflows/`의 기존 3개(`assign-mentor`, `notify-discord`, `convention-check`)를 건드리지 않는다. 운영진(CODEOWNERS) 소유다. **새 파일만 추가한다.**
- `frontend/docs/design/canvas/`는 읽기 전용 스냅샷이다. 수정하지 않는다.
- 패키지 매니저는 **npm**만 쓴다. pnpm·yarn 잠금 파일을 만들지 않는다.

---

## 1. 스캐폴딩

`frontend/` 안에서 실행한다. `docs/`와 `README.md`가 이미 있으므로 현재 디렉터리에 생성하는 형태로 한다.

```bash
cd frontend
npm create vite@latest . -- --template react-ts
```

기존 파일 유지 여부를 물으면 **유지**를 고른다. `README.md`는 아래 10절에서 다시 쓴다.

### 설치할 패키지

```bash
# 런타임 (M0에서는 최소만. 라우터·Query·Zustand 등은 M3에서 추가)
npm i react react-dom

# 개발 도구
npm i -D typescript @types/react @types/react-dom
npm i -D vite @vitejs/plugin-react
npm i -D eslint @eslint/js typescript-eslint globals
npm i -D eslint-plugin-react-hooks eslint-plugin-react-refresh eslint-plugin-jsx-a11y
npm i -D eslint-plugin-boundaries
npm i -D prettier eslint-config-prettier
npm i -D vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event
```

> 플러그인 설정 API는 메이저 버전마다 바뀐다. 설치 후 실제 버전 기준으로 아래 설정이 동작하는지 `npm run lint`로 확인하고, 다르면 해당 플러그인 문서에 맞춰 조정한다.

---

## 2. Node 버전과 브라우저 범위

**`frontend/.nvmrc`**

```
24
```

**`frontend/package.json`** — 아래 필드를 추가하거나 수정한다.

```json
{
  "type": "module",
  "engines": { "node": ">=24 <25" },
  "browserslist": ["last 2 Chrome versions"],
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "typecheck": "tsc --noEmit",
    "lint": "eslint .",
    "lint:fix": "eslint . --fix",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

**이유** — Node 24 LTS로 로컬·CI·빌드를 통일한다. 26 Current는 쓰지 않는다. 1차 공식 지원 브라우저는 데스크톱 Chrome 최신 2개 주요 버전이다.

---

## 3. TypeScript

**`frontend/tsconfig.json`** (Vite가 `tsconfig.app.json`을 만들었다면 그쪽)

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "types": ["vitest/globals", "@testing-library/jest-dom"],

    "strict": true,
    "noImplicitAny": true,
    "useUnknownInCatchVariables": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,

    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "noEmit": true,

    "baseUrl": ".",
    "paths": { "@/*": ["src/*"] }
  },
  "include": ["src"]
}
```

**규칙** — 암묵적 `any`를 허용하지 않는다. 명시적 `any`도 ESLint로 막고, 타입이 제공되지 않는 외부 라이브러리 등 불가피한 경우에만 한 줄 단위로 예외 처리하며 **사유를 주석으로 남긴다**. API 응답과 `catch` 오류처럼 신뢰할 수 없는 값은 `unknown`으로 받고 검사 후 사용한다.

---

## 4. ESLint

**`frontend/eslint.config.js`**

```js
import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import boundaries from 'eslint-plugin-boundaries'
import prettier from 'eslint-config-prettier'

export default tseslint.config(
  { ignores: ['dist', 'coverage', 'storybook-static', 'playwright-report', 'test-results'] },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
      'jsx-a11y': jsxA11y,
      boundaries,
    },
    settings: {
      'boundaries/elements': [
        { type: 'app', pattern: 'src/app/*' },
        { type: 'pages', pattern: 'src/pages/*' },
        { type: 'widgets', pattern: 'src/widgets/*' },
        { type: 'features', pattern: 'src/features/*' },
        { type: 'entities', pattern: 'src/entities/*' },
        { type: 'shared', pattern: 'src/shared/*' },
      ],
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],

      '@typescript-eslint/no-explicit-any': 'error',

      'boundaries/element-types': ['error', {
        default: 'disallow',
        rules: [
          { from: 'app', allow: ['pages', 'widgets', 'features', 'entities', 'shared'] },
          { from: 'pages', allow: ['widgets', 'features', 'entities', 'shared'] },
          { from: 'widgets', allow: ['features', 'entities', 'shared'] },
          { from: 'features', allow: ['entities', 'shared'] },
          { from: 'entities', allow: ['shared'] },
          { from: 'shared', allow: ['shared'] },
        ],
      }],

      'no-restricted-imports': ['error', {
        paths: [
          {
            name: 'date-fns',
            message: 'date-fns 는 함수 단위로 import 한다. 예: import { addDays } from "date-fns/addDays"',
          },
          {
            name: 'radix-ui',
            message: 'Radix 는 primitive 별 패키지로 import 한다. 예: @radix-ui/react-dialog',
          },
        ],
      }],
    },
  },

  prettier,
)
```

**왜 이 규칙들인가**

- **FSD 단방향 의존성** — 계층이 한 번 섞이면 되돌리기 어렵다. 코드가 없는 지금 고정한다.
- **`no-explicit-any`** — API 데이터 누락, 회의 처리 상태 전환, 역할별 권한 분기, 컴포넌트 props 오류를 컴파일 단계에서 잡기 위해서다.
- **`no-restricted-imports`** — FSD의 공개 진입점(`index.ts`)과 tree-shaking은 충돌한다. **barrel은 slice 경계에서만** 만들고, barrel에서 서드파티를 재export하지 않으며, 레이어 전체를 모으는 광역 barrel(`shared/index.ts`)을 만들지 않는다.

> **M1 이후 추가할 규칙** — `pages`·`widgets`·`features`에서 DTO 타입 import 금지. 백엔드와 API를 합의하지 않고 프론트가 가정한 명세로 개발하므로, 실제 API가 오면 반드시 달라진다. **DTO는 `entities` 계층에서만 다뤄야** 수정 범위가 엔티티당 파일 하나로 묶인다. M0에는 해당 코드가 없으므로 지금은 넣지 않는다.

---

## 5. Prettier

**`frontend/.prettierrc.json`**

```json
{
  "semi": false,
  "singleQuote": true,
  "printWidth": 100,
  "trailingComma": "all",
  "endOfLine": "lf"
}
```

**`frontend/.prettierignore`**

```
dist
coverage
storybook-static
playwright-report
test-results
docs/design/canvas
docs/design/managers-manager-refined.html
```

**역할 분리** — Prettier는 들여쓰기·줄바꿈·따옴표만 담당한다. **포맷 규칙을 ESLint와 중복 적용하지 않는다.** `eslint-config-prettier`를 설정 배열 마지막에 두어 충돌하는 규칙을 끈다.

---

## 6. Vite

**`frontend/vite.config.ts`**

```ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'src') },
  },
  server: {
    port: 5173,
    proxy: {
      // 백엔드에 CORS 가 없다. 이 프록시가 로컬 연동의 유일한 경로다.
      '/api': { target: 'http://localhost:8000', changeOrigin: true },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/shared/test/setup.ts'],
    css: false,
  },
})
```

**`frontend/src/shared/test/setup.ts`**

```ts
import '@testing-library/jest-dom/vitest'
```

> `rewrite`는 쓰지 않는다. 백엔드 경로가 이미 `/api/v1/...`이라 앞을 떼면 맞지 않는다.

---

## 7. 환경 변수

**`frontend/.env.example`** — 저장소에 커밋한다.

```
# 개발 중에는 비워 두고 Vite proxy 를 사용한다
VITE_API_BASE_URL=

# MSW mock 사용 여부. M1 이후 의미를 가진다
VITE_ENABLE_MSW=true
```

**금지** — 브라우저에 노출되면 안 되는 비밀키와 OAuth client secret을 프론트엔드 환경 변수에 두지 않는다. 실제 로컬 설정(`.env`, `.env.local`)은 Git에서 제외한다. 루트 `.gitignore`에 이미 규칙이 있다.

---

## 8. gitignore

**`frontend/.gitignore`** — 아래를 추가한다. `node_modules`, `dist`, `coverage`는 루트 `.gitignore`에 이미 있다.

```
.vite/
storybook-static/
playwright-report/
test-results/
```

---

## 9. FSD 디렉터리 골격

```
frontend/src/
  app/        providers, router, styles 진입
  pages/      라우트 단위 페이지
  widgets/    화면 조합 단위
  features/   사용자 행동 단위
  entities/   도메인 모델 + API 훅
  shared/     api, config, lib, ui, mock, types, test
```

각 레이어에 `.gitkeep`을 두어 빈 디렉터리를 커밋한다. **의존 방향은 위에서 아래로만** 흐른다(`app` → `pages` → `widgets` → `features` → `entities` → `shared`). 같은 레이어의 서로 다른 slice끼리 직접 참조하지 않는다.

`src/App.tsx`는 Vite 기본 화면 대신 최소한의 빈 화면으로 교체한다. 실제 레이아웃은 M2·M3에서 만든다.

---

## 10. CI

**`.github/workflows/frontend-ci.yml`** — 새 파일로 추가한다. 기존 3개 워크플로는 건드리지 않는다.

```yaml
name: frontend-ci

on:
  pull_request:
    branches: [develop]
    paths:
      - 'frontend/**'
      - '.github/workflows/frontend-ci.yml'

defaults:
  run:
    working-directory: frontend

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
          cache-dependency-path: frontend/package-lock.json
      - run: npm ci
      - run: npm run typecheck
      - run: npm run lint
      - run: npm run format:check
      - run: npm run test

  build:
    needs: check
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
          cache-dependency-path: frontend/package-lock.json
      - run: npm ci
      - run: npm run build
      - uses: actions/upload-artifact@v4
        with:
          name: frontend-dist
          path: frontend/dist
          retention-days: 7
```

**왜 아티팩트를 남기나** — 배포 서버가 t3.medium(4GB)이고 백엔드·DB·STT 모델이 함께 동작한다. 서버에서 `npm run build`를 돌리면 메모리가 위험하다. **빌드는 CI에서만** 하고 서버는 산출물만 받는다. IAM 액세스 키 생성이 제한되어 CI가 서버로 직접 배포할 수 없으므로, 1차에는 Session Manager 터미널에서 이 아티팩트를 내려받아 배치한다.

**CI는 코드를 자동 수정하지 않는다.** `--fix`나 `--write`를 CI에서 실행하지 않는다.

---

## 11. README

`frontend/README.md`를 실행 방법 중심으로 다시 쓴다. 현재 내용은 2026-09-11 기준 메모라 유효하지 않다.

포함할 것 — 요구 Node 버전, 설치·실행·검사 명령어, Vite proxy로 백엔드(`:8000`)와 연동하는 방법, 디렉터리 구조 한 줄 설명, 문서 위치(`docs/decision`, `docs/plan`, `docs/design`).

---

## 검증

```bash
cd frontend
npm ci
npm run typecheck      # 오류 0
npm run lint           # 오류 0
npm run format:check   # 전부 포맷됨
npm run test           # 테스트가 0개여도 통과
npm run build          # dist/ 생성
npm run dev            # http://localhost:5173 에 빈 화면
```

백엔드 연동 확인(선택):

```bash
cd ../backend && ./run.sh          # :8000
# 브라우저에서 http://localhost:5173/api/v1/health 가 응답하면 프록시 정상
```

PR을 열면 `frontend-ci`의 `check`와 `build`가 모두 초록이어야 한다.

---

## 다음

M1 — API 가정 명세 · 데이터 모델 · MSW. 별도 이슈로 진행한다.
