# 결과 — 첫 방문 인트로 빼기, 스플래시만 남긴다 (#465)

- 기록일: 2026-11-06
- 대상: [#465](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/465)의 할 일 6개
- 기준: develop `c7c7e514`. PR은 아직 만들지 않았다.
- 상태: **할 일을 모두 반영했다.** MSW 개발 서버(Chromium)로 검증했다. 실서버는 미검증이다.

## 작업 근거와 요약

마일스톤 계획에 없는 작업이다. 근거는 이슈 #465와 사용자 결정(2026-11-06)이다. [#430](../430-splash/result.md)(PR #452)은 스플래시와 함께 매스 인트로를 두 자리에 넣었다. 랜딩 `시작하기` 를 이 기기에서 처음 누를 때, 그리고 온보딩을 마친 계정이 처음 대시보드에 들어올 때다. 사용자는 서비스 소개를 랜딩(A-1)이 이미 다 하므로 인트로가 필요 없다고 정했다. 「시작하기」와 「건너뛰기」가 같은 일을 하던 문제도 함께 사라진다.

이번 작업으로 두 자리의 인트로를 모두 뺐다. 랜딩 `시작하기` 는 #430 이전처럼 바로 `/login` 으로 간다(D-003). 온보딩을 마친 PM, 「내 팀 확인」에서 처음 공간을 고른 팀원, 시작 화면에서 초대를 받은 팀원 모두 바로 대시보드를 본다. 스플래시는 그대로다.

## 실제 구현 및 관련 코드

#430 뒤에 이 파일들을 바꾼 다른 PR은 없었다(`git diff --stat 025c9dd2 HEAD`). 그래서 #430이 인트로만 더한 파일은 #430 이전(`025c9dd2^1`) 모양으로 되돌렸고, #430이 새로 만든 스플래시 파일은 인트로 연결 부분만 지웠다.

- 지운 것
  - 인트로 컴포넌트 `widgets/first-visit-intro`(컴포넌트·스토리·테스트).
  - 본 기록 `entities/user/model/introRecord.ts`(기기 `first-visit-intro:device`, 계정 `first-visit-intro:account:<사용자 ID>`)와 테스트, `entities/user` 의 export.
  - 랜딩 `StartLink.tsx`. 헤더·히어로·마무리의 `시작하기` 는 다시 `GuardedLink` 로 `/login` 을 연다([LandingHeader.tsx](../../../src/pages/landing/ui/LandingHeader.tsx), [LandingHero.tsx](../../../src/pages/landing/ui/LandingHero.tsx), [LandingClosing.tsx](../../../src/pages/landing/ui/LandingClosing.tsx)).
  - 대시보드의 인트로 상태와 대화상자([DashboardPage.tsx](../../../src/pages/dashboard/ui/DashboardPage.tsx)).
  - 인트로 신호. 온보딩 완료 저장의 `markPending`([useOnboardingSave.ts](../../../src/features/onboarding/model/useOnboardingSave.ts)), 「내 팀 확인」 첫 선택([WorkspaceChoiceList.tsx](../../../src/widgets/app-shell/ui/WorkspaceChoiceList.tsx)), 시작 화면 초대 수락([MyInvitations.tsx](../../../src/widgets/app-shell/ui/MyInvitations.tsx), [OnboardingStartPage.tsx](../../../src/pages/onboarding-start/ui/OnboardingStartPage.tsx)). `MyInvitations` 의 `onboarding` prop은 이 신호에만 쓰였으므로 지웠다. 레이아웃용 `variant` 는 남는다.
  - 스플래시의 「덮는 중」 신호 `setSplashCovering`·`useSplashCovering`([splashSignal.ts](../../../src/shared/lib/splash/splashSignal.ts), [SplashHost.tsx](../../../src/app/splash/SplashHost.tsx)). 덮는 동안 인트로를 열지 않으려고만 있었다. `SplashHost.test.tsx` 의 「첫 방문 인트로와 함께」 테스트도 지웠다.
  - 테스트 준비. `app/test/firstVisitIntro.ts`, `app/firstVisitIntro.test.tsx`, 랜딩·온보딩 테스트 6개의 인트로 준비, E2E `first-visit-intro.e2e.ts`, `e2e/support.ts` 의 `deviceIntroSeen`·`closeFirstIntro`, `signup-onboarding.e2e.ts` 의 인트로 닫기.
- 남긴 것
  - 스플래시(로딩, 0.3초 번쩍임 방지, 끝맺음 0.6+0.4초, 움직임 줄이기, `#root` inert), iOS 시작 이미지, 탭 제목, 마스코트 눈웃음·속도 옵션.
  - `e2e/support.ts` 의 「스플래시가 걷힐 때까지 기다림」과 E2E 전역 `reducedMotion`.
  - `shared/test/setup.ts` 의 `localStorage.clear()`. #411의 알림 띠 기록도 `localStorage` 에 있어 테스트 사이 격리에 필요하다. 주석만 고쳤다.
- 문서: [결정 기록](../../plan/m2/basis-for-decision/2026-11-06-splash-direction-a-smile.md#이후-변경-첫-방문-인트로를-뺐다-465)에 제거와 이유를 더했다. [#430 결과](../430-splash/result.md)와 README #430 줄의 인트로 설명을 고쳤다.

## 완료조건 확인

| 이슈 #465의 할 일 | 상태 | 근거 |
|---|---|---|
| 랜딩 `시작하기` 첫 클릭의 인트로 경로를 지우고 바로 로그인으로 | 충족(MSW) | `landing.test.tsx`, 브라우저 확인(데스크톱·휴대폰) |
| 온보딩 완료·「내 팀 확인」 첫 선택 신호와 첫 대시보드 인트로를 지운다 | 충족(MSW) | 브라우저 확인(PM 온보딩 완료, 팀원 첫 선택), E2E `signup-onboarding`·`onboarding-start`·`member-invitations` |
| 인트로 컴포넌트, `localStorage` 기록, 테스트·E2E·스토리를 지운다. 정리 코드는 두지 않는다 | 충족 | 아래 `git grep`. 기존 키 정리 코드는 없다 |
| 스플래시, iOS 시작 이미지, 탭 제목, 마스코트 옵션은 그대로. 「덮는 중」 연결은 정리 | 충족 | `SplashHost.test.tsx`·`staticSplash.test.tsx`·`splash.test.tsx`, 브라우저 확인(스플래시 단계) |
| 결정 기록에 제거와 이유, README·결과 문서의 인트로 설명 고침 | 충족 | 위 문서 링크 |
| 세 경로에서 인트로가 뜨지 않고 스플래시는 그대로 뜬다 | 충족(MSW) | 아래 검증 |

## 설계 결정

| 결정 | 고른 길 | 대안과 버린 이유 |
|---|---|---|
| 되돌리는 방법 | 파일마다 #430 이전과 비교해 인트로 부분만 되돌림 | `git revert` 로 #430 전체: 스플래시·시작 이미지·마스코트 옵션까지 사라진다 |
| 이미 저장된 `first-visit-intro:*` 키 | 지우는 코드를 두지 않는다 | 시작할 때 지우기: 읽는 코드가 없어 남아도 해가 없고, 정리 코드만 계속 남는다(이슈 결정) |
| 스플래시 「덮는 중」 신호 | 지운다 | 남겨 두기: 쓰는 곳이 인트로뿐이었다. 다음에 필요하면 그때 다시 만든다 |
| `MyInvitations` 의 `onboarding` prop | 지운다 | 남겨 두기: 인트로 신호에만 쓰였다 |
| 테스트의 `localStorage.clear()` | 남긴다 | 지우기: #411 알림 띠 기록이 같은 저장소에 있어 테스트 사이로 샌다 |

## 검증

| 범위 | 명령·방법 | 결과 |
|---|---|---|
| 흔적 | `git grep -i -E "first-visit-intro\|FirstVisitIntro\|firstVisitIntro\|introRecord\|매스 소개\|SplashCovering\|StartLink\|deviceIntroSeen\|closeFirstIntro\|IntroSeen\|AccountIntro\|안녕하세요, 저는 매스예요"`(문서 제외), 인트로 문구 세 줄 | 일치 없음 |
| 바꾼 곳 단위 | `npx vitest run` 랜딩·온보딩 5개·스플래시 3개 `--maxWorkers=1` | 9개 파일, 129개 통과 |
| 브라우저 | `.verify/465-browser.mjs`(로컬 전용, MSW 개발 서버 5263, Chromium, 움직임 허용) | 아래 표 |
| E2E | `E2E_PORT=5264 npx playwright test` `signup-onboarding`·`layout`·`onboarding-start`·`member-invitations`·`login-return` `--workers=1` | 33개 통과 |
| 전체 | `npm run typecheck`·`lint`·`build` | 통과 |
| 전체 | `npm run format:check` | git에서 제외한 `.verify/brief.md` 만 걸렸다. 그 밖은 통과 |
| 전체 | `npm run test -- --maxWorkers=1` | 233개 파일 중 231개, 2,852개 중 2,849개 통과. 실패는 `tasks.test.tsx`·`taskViewsRender.test.tsx`(이번에 바꾸지 않은 태스크 화면, 다른 워커와 함께 돌아 63분 걸린 부하 실행)이고 둘만 다시 돌리면 40개 모두 통과해 부하로 인한 시간 초과로 봤다 |

브라우저 확인(새 컨텍스트, `localStorage` 비어 있는 첫 방문):

- 랜딩 `시작하기`(데스크톱 1280×800, 휴대폰 390×844): 첫 클릭에 바로 `/login`. 1.5초 동안 대화상자 0개, `first-visit-intro:*` 키 없음.
- PM 온보딩 완료(`incomplete-workspace`, Discord·Notion·팀원 연결 건너뛰기): `/workspaces/ws_03/dashboard`. 3초 동안 대화상자 0개. 새로고침 뒤에도 0개.
- 팀원 「내 팀 확인」 첫 선택(`single-workspace`, `/onboarding/member`): `/workspaces/ws_01/dashboard`. 3초 동안 대화상자 0개.
- 스플래시(`msw-auth-delay=4000`): 판이 보이고 「로그인 확인 중」, 그동안 `#root` inert, 준비 뒤 「준비됐어요」, 사라짐, inert 해제, 대시보드. 대화상자 0개.
- 페이지 오류 없음. 검증 서버는 끝에 닫았다(포트 닫힘 확인).

## 미검증

- 실서버 연동.
- Storybook play와 나머지 E2E는 CI에서 돈다.
