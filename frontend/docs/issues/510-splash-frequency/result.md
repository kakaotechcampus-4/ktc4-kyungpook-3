# 결과 — 스플래시는 12시간에 한 번, 다시 온 사람은 랜딩 대신 로그인으로 (#510)

- 기록일: 2026-11-08
- 대상: [#510](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/510)의 결정 1~4와 할 일
- 기준: develop `41b554fc`(#508 1단계 병합 뒤). PR은 아직 만들지 않았다.
- 상태: **결정 1~4를 반영했다.** 남은 일은 하나다. 스플래시를 건너뛸 때 보이는 라우트 뼈대를 화면별 틀로 나누는 일은 #508 2단계(화면 안 스켈레톤 맞춤) 병합 뒤에 이어서 한다. MSW 개발 서버(Chromium)로 확인했고, 실서버·실제 iOS 기기는 확인하지 않았다.

## 작업 근거와 요약

마일스톤 계획에 없는 작업이다. 근거는 이슈 #510과 사용자 결정(2026-11-07)이다. 「시작하기」 스플래시 길이는 관리 세션이 정했다(2026-11-08, 안 1).

사용자 말: 새로고침할 때마다 스플래시가 뜨고, 바로 띄울 수 있는 화면도 스플래시 뒤에 가려진다.

1. 전체 스플래시는 12시간에 한 번 보인다. 12시간 안에 다시 오면 `index.html` 의 정적 판을 첫 페인트 전에 숨기고, 가드 대기는 화면 뼈대, 준비되면 바로 화면이다.
2. 설치한 앱은 건너뛸 때도 정적 판을 그리지만, 준비되면 끝맺음 없이 0.2초에 사라진다.
3. 랜딩 `시작하기` 는 같은 12시간 규칙으로 약 2.5초짜리 스플래시를 띄우며 로그인으로 간다. 누르면 건너뛴다.
4. 스플래시 기록이 있는 브라우저가 바깥에서 `/` 로 오면 랜딩 대신 로그인이다(D-183).

## 실제 구현 및 관련 코드

### 기록과 판정

- [splashRecord.ts](../../../src/shared/lib/splash/splashRecord.ts): 키 `splash-last-shown:v1`, 값은 epoch ms. `isSplashDue()`(값 없음·숫자 아님·12시간 지남·시계가 뒤로 감·읽기 예외면 보일 차례), `hasSplashRecord()`(값이 있기만 하면 써 본 사람, 읽기 예외면 처음 온 사람), `markSplashShown()`(쓰기 예외는 넘긴다). try/catch 는 `pushPromptRecord.ts` 의 방식이다.
- 기록은 [SplashHost.tsx](../../../src/app/splash/SplashHost.tsx) 한 곳에서 한다. 단계가 `hidden` 을 벗어나 실제로 보인 순간이다. 0.3초 안에 준비돼 보이지 않은 채 끝나면 기록하지 않는다. 랜딩의 바로 걷힘과 설치한 앱의 짧은 사라짐은 전체 스플래시가 아니라 기록하지 않는다.

### 정적 스플래시 건너뛰기

- [index.html](../../../index.html) `<head>` 에 인라인 스크립트를 더했다. localStorage 를 동기로 읽어 12시간 안이면 `<html data-splash="skip">`(설치한 앱이면 `"quick"`)을 붙인다. 읽기 예외는 표시 없이 지나간다.
  - CSS `html[data-splash='skip'] #boot-splash { display: none }` 이 정적 판을 그리지 않는다.
  - 판정은 JS 번들보다 먼저여야 해서 `splashRecord.ts` 를 옮긴 사본이다. [staticSplash.test.tsx](../../../src/app/splash/staticSplash.test.tsx)가 이 스크립트를 그대로 돌려 일곱 가지 기록 시각에서 `isSplashDue` 와 같은지, 키가 같은지 본다.
- `SplashHost` 의 `bootRun()` 은 `skip` 이면 판을 지우고 아무것도 띄우지 않는다. `quick` 이면 정적 판을 이어받아 quick 모드로 돈다.

### 상태 기계의 모드

[splashMachine.ts](../../../src/app/splash/splashMachine.ts)에 `mode` 를 더했다.

| 모드 | 언제 | 순서 |
|---|---|---|
| `full` | 새로 접속(12시간에 한 번), 로그인 직후 | 이전과 같다 |
| `quick` | 12시간 안에 다시 연 설치한 앱 | 정면·다이얼로 준비를 기다리다 준비되면 `QUICK_FADE_MS`(200)에 사라진다. 둘러보기·눈웃음·상태 문구 없음 |
| `start` | 랜딩 `시작하기` | 0에 정면, `GLANCE_AT_MS`(100)에 모자 누르고 왼쪽 보기(`glance`), `GLANCE_END_MS`(800)에 눈웃음 1.1초 → 사라짐 0.6초. 약 2.5초 |

- `start` 는 glance 가 끝나기 전에 온 준비를 미뤘다가 glance 끝에 눈웃음으로 간다(`readyEarly`). 0.8초까지 로그인 화면이 준비되지 않으면 새로 접속처럼 둘러보며 기다린다.
- `skip` 이벤트는 바로 `done` 이다. `start` 실행만 문서의 `pointerdown`·`keydown`(Enter·Escape)을 듣는다. 판이 화면 전체를 덮어 어디를 눌러도 판을 누른 것이다.
- 움직임 줄이기: `quick` 은 준비되면 바로 걷힌다. `start` 는 정면으로 0.8초 머문 뒤 걷힌다.
- `start` 판은 `data-instant` 로 CSS 등장(0.3초 대기 + 올라옴)을 끈다. 누른 순간 정적 판과 같은 정면이다. `quick` 판은 `data-fade="quick"` 으로 사라짐이 0.2초다(`staticSplash.test.tsx` 가 `QUICK_FADE_MS` 와 비교).
- 모자 누르기는 둘러보기 0단계에서 「glance 또는 look 이 시작될 때」로 바꿨다. 새로 접속 순서는 그대로다.
- 끝맺음 값(`SMILE_MS` 1100, `FADE_MS` 600, `splash-out 0.6s`)은 바꾸지 않았다.

### 신호

- [splashSignal.ts](../../../src/shared/lib/splash/splashSignal.ts): 띄우기 신호에 종류(`session`·`start`)를 더하고 `showStartSplash()` 를 만들었다. `start` 는 잡지 않는다. 로그인 화면 코드를 기다리는 동안은 그 뼈대가 잡는다.
- `SplashHost` 는 `start` 를 받으면 랜딩의 사라짐이 남아 있어도 이어받는다. 다른 실행이 떠 있으면 무시한다.
- 로그인 직후([useEnterSession.ts](../../../src/features/auth/model/useEnterSession.ts)의 `showSplash()`)는 고치지 않았다. 12시간 규칙과 상관없이 보이고, 보이면 기록된다.

### 랜딩 `시작하기`

- [StartLink.tsx](../../../src/pages/landing/ui/StartLink.tsx): 헤더·히어로·마무리의 세 `시작하기` 가 쓴다. `<a href="/login">` 그대로이고, 보조 키 없는 왼쪽 클릭(키보드 Enter 포함)이면서 `isSplashDue()` 일 때만 `showStartSplash()` 를 부른 뒤 평소처럼 옮긴다. 새 탭 열기는 가로채지 않는다. #430 의 `StartLink`(#465 로 지웠다)와 같은 방식이다.

### 다시 온 사람은 로그인으로

- [RootLayout.tsx](../../../src/app/router/layouts/RootLayout.tsx)가 처음 그린 주소의 key 와 그때 기록이 있었는지를 기억한다([entryVisit.ts](../../../src/app/router/entryVisit.ts)).
- [LandingEntry.tsx](../../../src/app/router/LandingEntry.tsx)가 랜딩 칸을 감싼다. 지금 주소가 처음 그린 주소이고 그때 기록이 있었으면 `<Navigate to="/login" replace>` 다. 랜딩 화면 코드(lazy)를 받기 전이다.
  - 앱 안 이동은 새 key 라 랜딩이다(로그인 로고 등).
  - 처음 온 사람이 `시작하기` 로 기록을 남긴 뒤 뒤로 가기로 돌아와도 랜딩이다. 판정은 들어올 때의 기록으로 한다.
  - 새로고침은 같은 key 를 다시 쓰지만 문서가 새로 뜨며 그때의 기록으로 다시 정하므로 「바깥에서」다.
- `bootRun()` 의 랜딩 바로 걷힘은 `/` 이면서 기록이 없을 때만이다. 기록이 있는 사람은 로그인으로 가므로 전체 스플래시 규칙을 따른다.

### 문서

- [결정 기록](../../plan/m2/basis-for-decision/2026-11-06-splash-direction-a-smile.md#이후-변경-스플래시는-12시간에-한-번-다시-온-사람은-로그인으로-510)에 「이후 변경 (#510)」 절과 시작하기 길이의 안 1·2·3을 적었다.
- [제품·기술 결정](../../decision/frontend-decisions.md)에 D-183(다시 온 사람은 로그인으로, D-003 관련)을 더하고, D-147 요약에 허용 키 `splash-last-shown:v1` 을 덧붙였다.
- [#430 결과](../430-splash/result.md) 머리의 「이후 변경」에 한 줄을 더했다.

## 완료조건 확인

| 이슈 #510의 할 일 | 상태 | 근거 |
|---|---|---|
| 1. 12시간 기록·판정, 정적 스플래시 건너뛰기, 로그인 직후 그대로, 저장소 예외, 움직임 줄이기 | 충족 | `splashRecord.test.ts`, `staticSplash.test.tsx`, `SplashHost.test.tsx` 「12시간 안에 다시 옴」·「기록 시점」, E2E 둘째 |
| 2. 설치한 앱 0.2초 사라짐 | 충족(matchMedia 흉내) | `SplashHost.test.tsx`, E2E 셋째. CSS `@media (display-mode: standalone)` 는 흉내 내지 못했다(아래 확인 못 한 것) |
| 3. `시작하기` → 로그인 스플래시, 12시간 규칙, 누르면 건너뜀, 새 탭 비가로채기 | 충족 | `SplashHost.test.tsx` 「랜딩 시작하기」, `landingEntry.test.tsx`, E2E 첫째 |
| 4. 다시 온 사람 `/` → `/login`, 앱 안 이동은 랜딩, 랜딩 JS 전 판단 | 충족 | `landingEntry.test.tsx`, E2E 첫째(랜딩 모듈 요청이 없다) |
| 단위 테스트(12시간 판정·기록 시점·첫 진입·앱 안 이동·시작하기·건너뛰기·새 탭) | 충족 | 아래 검증 |
| E2E(MSW, 시계 고정) | 충족 | [splash-frequency.e2e.ts](../../../e2e/splash-frequency.e2e.ts) 3개 |
| 결정 기록·D-147 허용 키·결과 문서, 스토리·README 줄 없음 | 충족 | 위 문서. `*.stories.tsx`·`frontend/README.md` 는 건드리지 않았다 |
| 건너뛸 때의 뼈대를 화면별로 | **남음** | #508 2단계 병합 뒤 이어서 한다 |

## 설계 결정

| 결정 | 고른 길 | 대안과 버린 이유 |
|---|---|---|
| `시작하기` 스플래시 길이 | 안 1: 정면 → 0.1초 왼쪽 보기 → 0.8초 눈웃음 → 사라짐, 약 2.5초 | 안 2(등장 0.8초 포함, 약 3.1초)와 안 3(새로 접속 순서 그대로 2.5초에 준비, 약 4.2초)은 「약 2.5초 안쪽」을 넘는다. 안 3은 2.5초 안에 머리를 돌리지 않아 둘러보기도 아니다 |
| 12시간 판정 위치 | `<head>` 인라인 스크립트(첫 페인트 전) + 같은 판정의 TS 모듈, 둘을 테스트로 묶음 | Vite 플러그인으로 TS 상수를 HTML 에 찍기: 판정 한 줄을 위해 빌드 장치가 는다. React 에서만 판정: 정적 판이 이미 그려진 뒤라 번쩍인다 |
| 건너뛸 때 정적 판 처리 | `<html data-splash>` 표시 + CSS `display: none`, React 가 노드를 지움 | 인라인 스크립트로 노드 지우기: `<head>` 시점에는 body 노드가 아직 없다. body 끝 스크립트로 지우면 그 사이 페인트가 생길 수 있다 |
| 기록 시점 | 판이 실제로 보인 순간(`hidden` 을 벗어남), 전체 스플래시만 | 걷힐 때 기록: 보는 도중 탭을 닫으면 본 것을 놓친다. 짧은 사라짐·랜딩 걷힘까지 기록: 전체 스플래시를 12시간 넘게 안 보게 된다 |
| 바깥에서 들어옴 판정 | 문서가 처음 그린 주소의 라우터 key 와 그때의 기록을 `RootLayout` 이 기억 | `history.state` key 가 `default`: 앱 안에서 간 `/` 를 새로고침하면 저장된 key 가 남아 「바깥」을 놓친다. 이동 종류(POP): 뒤로 가기도 POP 이라 앱 안 이동을 바깥으로 본다 |
| 들어온 뒤 생긴 기록 | 보지 않는다 | 지금 기록으로 판정: 처음 온 사람이 `시작하기` 뒤 뒤로 가기로 랜딩에 돌아오지 못한다 |
| `시작하기` 의 움직임 줄이기 | 정면으로 0.8초 머문 뒤 걷힘 | 준비되면 바로 걷힘: 로그인 화면이 이미 준비돼 있어 0.1초 번쩍인다. 0.3초 대기 뒤 보이기: 대부분 보이지 않아 기록이 남지 않고 다시 온 사람 판정이 어긋난다 |
| 설치한 앱의 짧은 사라짐 | 기록하지 않는다 | 기록: 설치한 앱은 전체 스플래시를 다시 보지 못한다 |
| `start` 의 준비 처리 | glance 끝까지 미룬다(`readyEarly`) | 바로 눈웃음: 로그인 화면이 0.1초 안에 준비돼 정면 → 눈웃음이 되고 둘러보기가 없다 |

## 검증

| 범위 | 명령·방법 | 결과 |
|---|---|---|
| 바꾼 곳 단위 | `npx vitest run src/app/splash src/shared/lib/splash src/app/landingEntry.test.tsx src/app/landing.test.tsx src/app/splash.test.tsx` | 6개 파일 91개 통과 |
| 관련 앱 테스트 | `npx vitest run src/app/landing.test.tsx src/app/splash.test.tsx src/app/boot.test.tsx src/app/authFlow.test.tsx src/app/logout.test.tsx src/app/loginReturn.test.tsx …`(기본 병렬) | 병렬 실행에서 6개가 5초 시간 초과. 실패한 파일만 단독으로 다시 돌려 `splash.test.tsx` 2개, `logout.test.tsx` 5개, `loginReturn.test.tsx` 9개 모두 통과. 부하로 본다 |
| E2E | `E2E_PORT=5231 npx playwright test e2e/splash-frequency.e2e.ts` | 3개 통과 |
| 타입·린트·포맷·빌드 | `npm run typecheck`, `npx eslint . --ignore-pattern .verify`, `npx prettier --check .`, `npm run build` | 통과. 포맷 경고 1개는 git 제외 로컬 파일 `.verify/brief.md` 다. `dist/index.html` 에 인라인 스크립트가 남는다 |
| 전체 단위·E2E | — | 미실행. 감독 규칙대로 CI 에 맡긴다 |
| 브라우저 | MSW 개발 서버(5232), Chromium 1280×800·390×844, 시계 고정, 로컬 스크립트 | 아래 |

브라우저 확인(스크린샷 `frontend/.verify/510/`, git 제외):

- 처음 방문 `/`: 정적 판 → 랜딩. `시작하기`(키보드 Enter): 정면(50ms) → 왼쪽 보기(650ms) → 눈웃음 「준비됐어요」(1.35초) → 로그인. 기록이 남는다.
- 12시간 안 새로고침(`/login`): `data-splash="skip"`, `#boot-splash` 없음, 80ms 에 뼈대만 보이고 로그인 화면으로 바뀐다. 스플래시 판 없음.
- 주소로 `/`: 로그인으로 바뀐다. 로그인 로고(앱 안 링크): 랜딩.
- 설치한 앱(`matchMedia` 를 standalone 으로 흉내, 기록 1시간 전, 390): `data-splash="quick"`, 150ms 에 정적 판, 로그인 화면으로 걷힌다. 짧은 사라짐(`data-fade="quick"`)은 E2E 의 관찰기로 확인했다.

## 확인하지 못한 것

- 실제 설치한 앱·iOS 시작 이미지. Chromium CDP 의 `Emulation.setEmulatedMedia` 가 `display-mode` 를 받지 않아 JS `matchMedia` 만 흉내 냈다. CSS `@media (display-mode: standalone)`(등장 없음)는 이 변경에서 바꾸지 않았다.
- 프로덕션 번들의 첫 페인트 타임라인(인라인 스크립트가 페인트 전에 도는지). 개발 서버에서 판이 그려지지 않는 것만 봤다.
- 390 폭 로그인 화면은 이 변경과 무관하게 가로로 넘친다(새 컨텍스트에서 `scrollWidth` 549). `AuthShell`·`LoginPage` 는 건드리지 않았다.
- 건너뛸 때 보이는 뼈대가 화면 틀과 맞는지(로그인은 지금 일반 `PageSkeleton`). #508 2단계 뒤 이어서 한다.
