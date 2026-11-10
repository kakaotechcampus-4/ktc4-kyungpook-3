# 결과 — 스플래시는 12시간에 한 번, 다시 온 사람은 랜딩 대신 로그인으로 (#510)

- 기록일: 2026-11-08
- 대상: [#510](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/510)의 결정 1~4와 할 일
- 기준: develop `41b554fc`(#508 1단계 병합 뒤). (4)는 #508 2단계(PR #534) 병합 뒤 develop `1b0d3f7a` 를 merge 하고 진행했다. PR은 아직 만들지 않았다.
- 상태: **결정 1~4와 (4) 라우트 뼈대 화면별 분리를 반영했다.** MSW 개발 서버(Chromium)로 확인했고, 실서버·실제 iOS 기기는 확인하지 않았다.

## 작업 근거와 요약

마일스톤 계획에 없는 작업이다. 근거는 이슈 #510과 사용자 결정(2026-11-07)이다. 「시작하기」 스플래시 길이는 관리 세션이 정했다(2026-11-08, 안 1).

사용자 말: 새로고침할 때마다 스플래시가 뜨고, 바로 띄울 수 있는 화면도 스플래시 뒤에 가려진다.

1. 전체 스플래시는 12시간에 한 번 보인다. 12시간 안에 다시 오면 `index.html` 의 정적 판을 첫 페인트 전에 숨기고, 가드 대기는 화면 뼈대, 준비되면 바로 화면이다.
2. 설치한 앱은 건너뛸 때도 정적 판을 그리지만, 준비되면 끝맺음 없이 0.2초에 사라진다.
3. 랜딩 `시작하기` 는 같은 12시간 규칙으로 약 2.5초짜리 스플래시를 띄우며 로그인으로 간다. 누르면 건너뛴다.
4. 스플래시 기록이 있는 브라우저가 바깥에서 `/` 로 오면 랜딩 대신 로그인이다(D-183).

## 실제 구현 및 관련 코드

### 기록과 판정

- [splashRecord.ts](../../../../../src/shared/lib/splash/splashRecord.ts): 키 `splash-last-shown:v1`, 값은 epoch ms. `isSplashDue()`(값 없음·숫자 아님·12시간 지남·시계가 뒤로 감·읽기 예외면 보일 차례), `hasSplashRecord()`(값이 있기만 하면 써 본 사람, 읽기 예외면 처음 온 사람), `markSplashShown()`(쓰기 예외는 넘긴다). try/catch 는 `pushPromptRecord.ts` 의 방식이다.
- 기록은 [SplashHost.tsx](../../../../../src/app/splash/SplashHost.tsx) 한 곳에서 한다. 단계가 `hidden` 을 벗어나 실제로 보인 순간이다. 0.3초 안에 준비돼 보이지 않은 채 끝나면 기록하지 않는다. 랜딩의 바로 걷힘과 설치한 앱의 짧은 사라짐은 전체 스플래시가 아니라 기록하지 않는다.

### 정적 스플래시 건너뛰기

- [index.html](../../../../../index.html) `<head>` 에 인라인 스크립트를 더했다. localStorage 를 동기로 읽어 12시간 안이면 `<html data-splash="skip">`(설치한 앱이면 `"quick"`)을 붙인다. 읽기 예외는 표시 없이 지나간다.
  - CSS `html[data-splash='skip'] #boot-splash { display: none }` 이 정적 판을 그리지 않는다.
  - 판정은 JS 번들보다 먼저여야 해서 `splashRecord.ts` 를 옮긴 사본이다. [staticSplash.test.tsx](../../../../../src/app/splash/staticSplash.test.tsx)가 이 스크립트를 그대로 돌려 일곱 가지 기록 시각에서 `isSplashDue` 와 같은지, 키가 같은지 본다.
- `SplashHost` 의 `bootRun()` 은 `skip` 이면 판을 지우고 아무것도 띄우지 않는다. `quick` 이면 정적 판을 이어받아 quick 모드로 돈다.

### 상태 기계의 모드

[splashMachine.ts](../../../../../src/app/splash/splashMachine.ts)에 `mode` 를 더했다.

| 모드 | 언제 | 순서 |
|---|---|---|
| `full` | 새로 접속(12시간에 한 번), 로그인 직후 | 이전과 같다 |
| `quick` | 12시간 안에 다시 연 설치한 앱 | 정면·다이얼로 준비를 기다리다 준비되면 `QUICK_FADE_MS`(200)에 사라진다. 둘러보기·눈웃음·상태 문구 없음 |
| `start` | 랜딩 `시작하기` | 0에 정면, `GLANCE_AT_MS`(100)에 모자 누르고 왼쪽 보기(`glance`), `GLANCE_END_MS`(800)에 눈웃음 1.1초 → 사라짐 0.6초. 약 2.5초 |

- `start` 는 glance 가 끝나기 전에 온 준비를 미뤘다가 glance 끝에 눈웃음으로 간다(`readyEarly`). 0.8초까지 로그인 화면이 준비되지 않으면 새로 접속처럼 둘러보며 기다린다.
- 미뤄 둔 준비는 다시 잡히면(`held`) 지운다. 다시 잡힌 로딩이 풀리고 `SETTLE_MS` 가 지난 새 준비만 스플래시를 끝낸다(리뷰 반영). 그렇지 않으면 다시 로딩 중인데도 0.8초에 눈웃음으로 가거나, 움직임 줄이기에서 준비되지 않은 화면을 드러냈다.
- `skip` 이벤트는 바로 `done` 이다. `start` 실행만 문서의 `pointerdown`·`keydown`(Enter·Escape)을 듣는다. 판이 화면 전체를 덮어 어디를 눌러도 판을 누른 것이다.
- 움직임 줄이기: `quick` 은 준비되면 바로 걷힌다. `start` 는 정면으로 0.8초 머문 뒤 걷힌다.
- 접근성(리뷰 반영): `start` 판은 `role="dialog"`·`aria-modal`, 이름은 워드마크 「Manager's Manager」, 설명은 화면에 보이지 않는(sr-only) 안내 「로그인 화면을 준비하고 있어요. Enter 나 Esc 를 누르면 건너뛰어요.」다. 누른 `시작하기` 링크는 로그인으로 옮기며 사라지므로 판이 뜨는 순간 판에 포커스를 둔다. 판이 걷히기 시작하거나(사라짐) 끝나거나 건너뛰면 로그인 화면의 시작점 — 인증 틀이 표시한 폼 제목(숨은 `로그인`, `data-focus-start`) — 으로 포커스를 넘긴다. 처음에는 첫 입력(이메일)이었는데, 빈 칸에서 다른 곳을 누르면 검증 오류가 떠 아래 링크가 밀렸다(아래 「리뷰·CI 반영 2차」). 건너뛰어 아직 뼈대면 시작점이 나타날 때까지(최대 10초) 기다리고, 그 사이 사람이 포커스를 옮겼으면 그만둔다. 판에 포커스를 두는 동안은 움직임 줄이기여도 앱을 `inert` 로 둔다. 화면 전체 판의 포커스 테두리는 그리지 않는다(`.splash:focus`). 보이는 건너뛰기 버튼은 디자인 결정이라 더하지 않았다.
- `start` 판은 `data-instant` 로 CSS 등장(0.3초 대기 + 올라옴)을 끈다. 누른 순간 정적 판과 같은 정면이다. `quick` 판은 `data-fade="quick"` 으로 사라짐이 0.2초다(`staticSplash.test.tsx` 가 `QUICK_FADE_MS` 와 비교).
- 모자 누르기는 둘러보기 0단계에서 「glance 또는 look 이 시작될 때」로 바꿨다. 새로 접속 순서는 그대로다.
- 끝맺음 값(`SMILE_MS` 1100, `FADE_MS` 600, `splash-out 0.6s`)은 바꾸지 않았다.

### 신호

- [splashSignal.ts](../../../../../src/shared/lib/splash/splashSignal.ts): 띄우기 신호에 종류(`session`·`start`)를 더하고 `showStartSplash()` 를 만들었다. `start` 는 잡지 않는다. 로그인 화면 코드를 기다리는 동안은 그 뼈대가 잡는다.
- `SplashHost` 는 `start` 를 받으면 랜딩의 사라짐이 남아 있어도 이어받는다. 다른 실행이 떠 있으면 무시한다.
- 로그인 직후([useEnterSession.ts](../../../../../src/features/auth/model/useEnterSession.ts)의 `showSplash()`)는 고치지 않았다. 12시간 규칙과 상관없이 보이고, 보이면 기록된다.

### 랜딩 `시작하기`

- [StartLink.tsx](../../../../../src/pages/landing/ui/StartLink.tsx): 헤더·히어로·마무리의 세 `시작하기` 가 쓴다. `<a href="/login">` 그대로이고, 보조 키 없는 왼쪽 클릭(키보드 Enter 포함)이면서 `isSplashDue()` 일 때만 `showStartSplash()` 를 부른 뒤 평소처럼 옮긴다. 새 탭 열기는 가로채지 않는다. #430 의 `StartLink`(#465 로 지웠다)와 같은 방식이다.

### 다시 온 사람은 로그인으로

- [RootLayout.tsx](../../../../../src/app/router/layouts/RootLayout.tsx)가 처음 그린 주소의 key 와 그때 기록이 있었는지를 기억한다([entryVisit.ts](../../../../../src/app/router/entryVisit.ts)).
- [LandingEntry.tsx](../../../../../src/app/router/LandingEntry.tsx)가 랜딩 칸을 감싼다. 지금 주소가 처음 그린 주소이고 그때 기록이 있었으면 `<Navigate to="/login" replace>` 다. 랜딩 화면 코드(lazy)를 받기 전이다.
  - 앱 안 이동은 새 key 라 랜딩이다(로그인 로고 등).
  - 처음 온 사람이 `시작하기` 로 기록을 남긴 뒤 뒤로 가기로 돌아와도 랜딩이다. 판정은 들어올 때의 기록으로 한다.
  - 새로고침은 같은 key 를 다시 쓰지만 문서가 새로 뜨며 그때의 기록으로 다시 정하므로 「바깥에서」다.
- `bootRun()` 의 랜딩 바로 걷힘은 `/` 이면서 기록이 없을 때만이다. 기록이 있는 사람은 로그인으로 가므로 전체 스플래시 규칙을 따른다.

### 라우트 뼈대 화면별 분리 ((4), #508 2단계 뒤)

12시간 안에 다시 오면 스플래시 없이 라우트 뼈대가 바로 보인다. 이전 라우트 뼈대는 모든 화면이 같은 `PageSkeleton`(240×32 막대 + 줄 넷)이라, 화면 코드를 받으면 화면 안 뼈대(#508 2단계)로 바뀌며 제목·틀이 크게 움직였다. 이제 [RouteSkeleton.tsx](../../../../../src/app/router/RouteSkeleton.tsx)가 경로마다 **그 화면이 데이터를 기다릴 때와 같은 틀**을 그린다. 스플래시 잡기(`useSplashHold`)는 그대로다.

- 같은 틀을 두 번 적지 않으려고, 화면과 뼈대가 같이 쓰는 클래스 상수를 슬라이스마다 작은 모듈로 옮겼다(`ui/frame.ts`·`ui/styles.ts`). 화면 안 뼈대 컴포넌트(#508)는 그대로 다시 쓴다.
- 뼈대는 슬라이스마다 `skeleton.ts` 입구로 낸다. 라우트 뼈대는 첫 번들에 들어가므로 화면 코드·Radix 를 끌어오지 않게 index 와 나눴다(예: `Segmented` 대신 모양만 그리는 `SegmentedFrame`).
- 정해진 글자(제목·칸 이름·탭·버튼 글자)는 글자로, 받아야 아는 값은 막대로 그린다. 뼈대 전체가 `aria-hidden` 이고 `main` 의 `aria-busy` 가 기다림을 알린다. 제목·링크·버튼은 스크린리더에 나오지 않는다.
- 역할(PM·팀원)에 따라 틀이 다른 화면은 캐시에 있는 소속 목록으로 역할을 읽는다. 목록을 새로 부르지 않는다(가드가 세션을 기다리는 동안 비로그인에게 401 을 만들지 않는다). 모르면 PM 틀이다.

| 경로 | 뼈대 | 같은 틀의 근거 |
|---|---|---|
| `/login` · `/signup` · `/forgot-password` | `AuthShellSkeleton` + `*FormSkeleton` | 인증 틀이 세로 가운데라 폼 칸 높이까지 같게 칸·간격을 맞췄다(라벨은 `Label` 그대로) |
| `/workspaces` | `WorkspaceSelectSkeleton` | 머리 줄 · 제목 · 안내, 목록이 기다릴 때의 세 줄 |
| `…/dashboard` | `DashboardSkeleton` | 중립 제목 `워크스페이스 현황` · 회의 안내 줄 · 오늘 · 요약 칸 · 영역 머리와 행 뼈대(`SectionSkeleton`) |
| `…/tasks` | `TaskBoardSkeleton` | 주소의 보기·탭·조건을 읽어 제목·설명 · 보기 고르기 · 탭·조건 줄 · `TaskViewSkeleton` |
| `…/tasks/:id` · `…/approvals/:id` | `TaskDetailRouteSkeleton` · `ApprovalRouteSkeleton` | `태스크 목록` 돌아가기 줄 + 상세 뼈대 |
| `…/messages` | `MessageInboxSkeleton` | 목록 칸(제목 · PM 의 `새 재촉` · 목록 뼈대) + 상세 칸(PM 보낼 메시지 · 팀원·대화 주소는 대화 모양). 휴대폰 목록 칸은 목록만 |
| `…/members` | `TeamOverviewSkeleton` | 제목·안내 · PM 의 `팀원 관리` · 팀원 목록 뼈대 · `연결되지 않은 계정` 카드 |
| `…/settings` | `SettingsSkeleton` | 제목·목차 · `일반`(이름 칸 · `되돌리기`) · `연결`(Discord·Notion 카드 뼈대). 그 아래 절은 화면이 그릴 때 아래에 붙는다 |
| `…/meetings/upload` · `…/processing` · `…/speakers` | 각 `*RouteSkeleton` | 제목·안내 + 업로드 폼 뼈대, 정리 상태 네 줄, 제목 + 네 줄 |
| `…/meetings` · 온보딩 | 그대로(#508) | 이미 화면 안 뼈대와 같았다 |
| `/` · 404 · `/reset-password` · 휴대폰에서 메시지 상세를 바로 여는 주소 | 일반 `PageSkeleton` | 아래 「남긴 것」 |

- 리뷰·검증 중 함께 고친 것: (1)~(3) 커밋의 `LandingEntry` 가 랜딩 칸을 감싸 경로 표 검사(`routes.test.tsx` — 모든 화면 칸이 Route Error Boundary, 지연 로드 21개)를 깨뜨리고 있었다. 감싸는 대신 경로 없는 바깥 칸(`<Outlet>`)으로 바꿨다. 화면 안 메시지 뼈대를 찾던 테스트는 라우트 뼈대도 같은 컴포넌트를 그리게 되어, 화면의 목록 칸·상세 칸 랜드마크 안에서 찾도록 좁혔다(`messageScreen.listSkeleton`).

남긴 것:

- 가드가 세션·소속을 기다리는 동안은 역할을 몰라 PM 틀이다. 팀원의 대시보드·메시지는 그 동안만 틀이 다르다(화면 코드를 기다리는 동안은 역할을 알아 팀원 틀이다).
- 랜딩·404·비밀번호 재설정은 일반 뼈대다. 랜딩은 처음 온 사람에게 스플래시가 덮고, 다시 온 사람은 로그인으로 간다. 재설정은 메일 링크로만 온다.
- 휴대폰에서 메시지 상세를 바로 여는 주소는 셸을 걷은 전체 화면이라 일반 뼈대다.
- 설정의 이름 칸은 소속 목록을 받아야 알아 막대다. 그 아래 절(자동 반영 · 알림 · 팀 삭제)은 뼈대에 없다 — 화면이 그릴 때 아래에 붙고 위는 움직이지 않는다.
- 첫 번들(`index-*.js`)이 362.28 kB(gzip 114.92) → 400.95 kB(gzip 123.61), 약 +8.7 kB gzip 늘었다. 화면별 뼈대와 같이 쓰는 틀 상수가 첫 번들로 옮겨 왔다(화면 묶음은 그만큼 줄었다). Radix(Segmented)는 끌어오지 않게 뺐다(-3.4 kB).

### 리뷰·CI 반영 2차 (PR #537)

- **고른 표시(Codex P2).** 보기 고르기(`SegmentedFrame`)·태스크 탭·설정 목차 뼈대가 기본색과 고른 색을 클래스로 나란히 붙여, 같은 우선순위에서 CSS 순서로 기본색(투명 면·투명 밑줄·`text-sub`)이 이겼다. 고른 칸의 흰 면·탭 밑줄·목차 글자색이 화면이 뜰 때 생겼다. 화면의 컨트롤과 같은 상태 선택자로 칠한다 — `data-state`(Segmented 의 `ITEM_TONE` 을 `styles.ts` 로 옮겨 같이 쓴다), 탭은 `data-selected`(`TAB` 에 `data-selected:` 를 더했다), 목차는 `aria-current="location"`. `route-skeleton.e2e.ts` 가 고른 항목의 글자색·면·밑줄을 화면 안 뼈대와 비교한다(`리스트`·`전체`·`보드`·`일반`). 고친 것을 되돌리면 실패하는 것을 확인했다.
- **경로 판정(Codex P3).** 라우터는 대소문자를 가리지 않고 끝 슬래시를 받는다(`caseSensitive` 기본 false). 뼈대 판정이 문자열 비교·정규식이라 `/login/`·`/LOGIN`·`…/tasks/tk_01/`·`…/processing/` 이 일반 뼈대였다. routes.tsx 와 같은 패턴을 차례로 `matchPath` 로 본다(동적 ID 는 그대로, 공간 ID 모양은 `parseRouteId`). `RouteSkeleton.test.tsx` 에 대문자·끝 슬래시·공간 ID 사례 13개를 더하고, 지웠던 온보딩·회의록의 `aria-busy` 단언을 되살렸다.
- **CI `signup-onboarding.e2e.ts:15` — 동작을 고쳤다.** 랜딩 `시작하기` 스플래시가 걷히면 포커스를 로그인 첫 입력(이메일)에 두었다. 테스트가 `회원가입` 을 누르는 순간 빈 이메일 칸을 떠난 것이 되어(`onTouched`) 오류 문구가 생기고, 그 아래 링크가 밀려 눌린 자리가 빗나갔다 — `/login` 그대로였다. 스플래시가 덮는 동안 누른 입력은 아니다(판이 걷힌 뒤 눌렀다, 로컬 시간표로 확인). 사람이 다른 곳을 눌러도 같은 오류가 뜨므로 테스트가 아니라 포커스 자리를 고쳤다 — 인증 틀의 숨은 폼 제목(`data-focus-start`)이 시작점이고, 없으면 첫 입력이다.
- **CI `settings-notifications.e2e.ts:28` — 테스트를 고쳤다.** 재촉 토글을 끄면 화면은 고른 값을 먼저 보이고, 저장은 공간마다 하나씩 차례로 나간다(며칠 전 → 시각 → 토글). 테스트가 화면만 보고 바로 새로고침해 마지막 저장과 경주했다. 새로고침 뒤 며칠 전·시각은 남고 토글만 켜져 있던 것이 그 증거다. #510 은 설정 저장 경로를 바꾸지 않았고, 라우트 뼈대는 토글 값을 그리지 않으며(뼈대에 없다) 새로고침 뒤 값은 서버(MSW) 조회로만 온다 — 옛 값을 보이는 경로가 없다. 로컬에서는 재현하지 못했다(연속 4회 통과). 테스트가 토글 저장(`due_reminder:false` PATCH) 응답을 기다린 뒤 새로고침한다. CI 에서 드러난 것은 이 PR 의 E2E 가 늘어 부하가 커진 영향으로 본다(추정).

### 문서

- [결정 기록](../../../m2/basis-for-decision/2026-11-06-splash-direction-a-smile.md#이후-변경-스플래시는-12시간에-한-번-다시-온-사람은-로그인으로-510)에 「이후 변경 (#510)」 절과 시작하기 길이의 안 1·2·3을 적었다.
- [제품·기술 결정](../../../../decision/frontend-decisions.md)에 D-183(다시 온 사람은 로그인으로, D-003 관련)을 더하고, D-147 요약에 허용 키 `splash-last-shown:v1` 을 덧붙였다.
- [#430 결과](../430-splash/result.md) 머리의 「이후 변경」에 한 줄을 더했다.

## 완료조건 확인

| 이슈 #510의 할 일 | 상태 | 근거 |
|---|---|---|
| 1. 12시간 기록·판정, 정적 스플래시 건너뛰기, 로그인 직후 그대로, 저장소 예외, 움직임 줄이기 | 충족 | `splashRecord.test.ts`, `staticSplash.test.tsx`, `SplashHost.test.tsx` 「12시간 안에 다시 옴」·「기록 시점」, E2E 둘째 |
| 2. 설치한 앱 0.2초 사라짐 | 충족(matchMedia 흉내) | `SplashHost.test.tsx`, E2E 셋째. CSS `@media (display-mode: standalone)` 는 흉내 내지 못했다(아래 확인 못 한 것) |
| 3. `시작하기` → 로그인 스플래시, 12시간 규칙, 누르면 건너뜀, 새 탭 비가로채기 | 충족 | `SplashHost.test.tsx` 「랜딩 시작하기」, `landingEntry.test.tsx`, E2E 첫째 |
| 4. 다시 온 사람 `/` → `/login`, 앱 안 이동은 랜딩, 랜딩 JS 전 판단 | 충족 | `landingEntry.test.tsx`, E2E 첫째(랜딩 모듈 요청이 없다) |
| 단위 테스트(12시간 판정·기록 시점·첫 진입·앱 안 이동·시작하기·건너뛰기·새 탭) | 충족 | 아래 검증 |
| E2E(MSW, 시계 고정) | 충족 | [splash-frequency.e2e.ts](../../../../../e2e/splash-frequency.e2e.ts) 4개 |
| 결정 기록·D-147 허용 키·결과 문서, 스토리·README 줄 없음 | 충족 | 위 문서. `*.stories.tsx`·`frontend/README.md` 는 건드리지 않았다 |
| 건너뛸 때의 뼈대를 화면별로 | 충족 | 아래 「라우트 뼈대 화면별 분리」, `RouteSkeleton.test.tsx`, E2E `route-skeleton.e2e.ts` 14개 |

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
| 라우트 뼈대의 틀 | 화면이 데이터를 기다릴 때의 틀과 같게 — 같은 클래스 상수(`frame.ts`)와 화면 안 뼈대 컴포넌트를 다시 쓴다 | 일반 뼈대 유지: 12시간 안 새로고침마다 일반 뼈대 → 화면 틀로 크게 튄다. 화면 컴포넌트를 그대로 그리기: 화면 코드가 첫 번들로 들어와 지연 로드(D-130)가 무너진다 |
| 라우트 뼈대의 역할 판정 | 캐시에 있는 소속 목록만 읽고, 모르면 PM 틀 | 목록을 구독: 가드가 세션을 기다리는 동안 비로그인에게 401 을 만든다 |
| 라우트 뼈대 입구 | 슬라이스마다 `skeleton.ts` | index 로 내기: 첫 번들이 화면 코드까지 끌어온다 |
| `start` 의 준비 처리 | glance 끝까지 미룬다(`readyEarly`). 다시 잡히면 버린다 | 바로 눈웃음: 로그인 화면이 0.1초 안에 준비돼 정면 → 눈웃음이 되고 둘러보기가 없다. 다시 잡혀도 유지: 다시 로딩 중인 화면을 드러낸다 |
| `start` 의 포커스 | 뜰 때 판(대화상자)에, 걷히기 시작하면 로그인 폼 제목(`data-focus-start`, tabindex -1)에 | 그대로 두기: 누른 링크가 사라져 포커스가 body 로 떨어진다. 첫 입력: 빈 칸에서 다른 곳을 누르면 칸을 떠난 것이라(`onTouched`) 오류가 뜨고 그 아래 `회원가입` 링크가 밀려 누른 자리가 빗나갔다 — 키보드 사용자에게도 누르지 않은 오류가 보인다 |
| 건너뛰는 법 안내 | 판의 설명으로 붙인 sr-only 문장 | 보이는 「건너뛰기」 버튼: 디자인 결정이라 이번에 하지 않았다. `role="status"` 에 넣기: 뜰 때 이미 있는 내용은 읽히지 않을 수 있다. 판에 포커스를 두면 설명이 함께 읽힌다 |
| 표시 여부를 보는 E2E | 세션 확인을 `msw-auth-delay` 로 2.5초 붙잡아 둘러보기(「로그인 확인 중」)까지 보인 뒤 기록을 본다. 빠른 경우는 앱이 읽는 `performance.now` 를 30초 늦춰 등장 시각 전 준비를 만든다 | 개발 서버 속도에 맡기기: 빠른 환경에서 정상 동작을 실패로 판정한다(리뷰 지적) |

## 검증

| 범위 | 명령·방법 | 결과 |
|---|---|---|
| 바꾼 곳 단위 | `npx vitest run src/app/splash src/shared/lib/splash src/app/landingEntry.test.tsx src/app/landing.test.tsx src/app/splash.test.tsx` | 6개 파일 96개 통과(리뷰 반영 뒤) |
| 라우트 뼈대 단위 | `npx vitest run src/app/router/RouteSkeleton.test.tsx` | 51개 통과 — 경로별 틀·정해진 글자, 제목·링크·버튼이 읽히지 않음, 스플래시 잡기, 캐시 역할(팀원 틀), 목록을 새로 부르지 않음, 일반 뼈대 경로 |
| 관련 앱 테스트 | `npx vitest run src/app/landing.test.tsx src/app/splash.test.tsx src/app/boot.test.tsx src/app/authFlow.test.tsx src/app/logout.test.tsx src/app/loginReturn.test.tsx …`(기본 병렬) | 병렬 실행에서 6개가 5초 시간 초과. 실패한 파일만 단독으로 다시 돌려 `splash.test.tsx` 2개, `logout.test.tsx` 5개, `loginReturn.test.tsx` 9개 모두 통과. 부하로 본다 |
| E2E | `E2E_PORT=5231 npx playwright test e2e/splash-frequency.e2e.ts e2e/route-skeleton.e2e.ts` | 18개 통과(빈도 4 · 라우트 뼈대 14). 라우트 뼈대 E2E 는 대시보드 뼈대 제목에 4px 를 일부러 더하면 실패하는 것을 확인했다 |
| 타입·린트·포맷·빌드 | `npm run typecheck`, `npx eslint . --ignore-pattern .verify`, `npx prettier --check .`, `npm run build` | 통과. 포맷 경고 1개는 git 제외 로컬 파일 `.verify/brief.md` 다. `dist/index.html` 에 인라인 스크립트가 남는다 |
| 전체 단위·E2E | — | 미실행. 감독 규칙대로 CI 에 맡긴다 |
| 브라우저 | MSW 개발 서버(5232), Chromium 1280×800·390×844, 시계 고정, 로컬 스크립트 | 아래 |
| 라우트 뼈대 | 로컬 스크립트(`.verify/510/skel/`, git 제외)로 20개 화면 × 1280·390 의 라우트 뼈대(세션 붙잡음) · 화면 안 뼈대(데이터 붙잡음) · 다 그린 화면을 찍고 글자·막대 상자를 비교 | 위 표의 화면은 글자·막대 위치가 같다. 팀원의 대시보드·메시지는 가드 대기 동안만 다르다(PM 틀) |

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
