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
