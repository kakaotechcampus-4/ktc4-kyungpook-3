# 결과 — 휴대폰 셸: 아래 탭 막대와 360px 넘침 원인 (#478 PR ①)

- 기록일: 2026-11-07
- 대상: [#478](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/478) (요청 [#455](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/455))
- 기준: develop `5307760d`(#479 병합 뒤). PR은 아직 만들지 않았다.
- 상태: **#478 의 첫 PR(셸·넘침 검사·결정 문서)을 반영했다.** 화면 안쪽 배치(H-1~H-5, 시안 없는 화면 한 열)는 다음 PR 몫이다. MSW 기준으로 검증했다.

## 작업 근거와 요약

마일스톤 계획에 없는 작업이다. 근거는 이슈 #455·#478 과 사용자 결정(2026-11-06)이다. 최소 지원 폭을 360px 로 바꾸고(D-180, D-123·D-124 대체), 폭 768px 미만에서는 위 헤더의 탭 줄 대신 화면 아래에 탭 막대를 둔다.

360px 에서 로그인 뒤 화면이 모두 같은 폭(develop 에서 286px, #455 때 351px)만큼 넘치던 원인은 앱 헤더였다. 마크·탭 다섯·알림·공간 메뉴·아바타가 줄지 않는 한 줄이라 헤더 내용이 화면 폭과 상관없이 646px 까지 그려졌다. 이 PR 뒤 그 공통 넘침은 사라졌고, 남은 넘침은 각 화면 안쪽의 고정 폭이다(아래 표).

## 실제 구현 및 관련 코드

- [shellTabs.ts](../../../src/widgets/app-shell/model/shellTabs.ts): 다섯 탭을 표 하나(`SHELL_TABS`: 헤더 글자, 막대 글자, 아이콘, 주소)로 둔다. 헤더 탭과 아래 탭 막대가 같은 표를 읽는다. `useCompactShell` 은 `matchMedia('(max-width: 767.98px)')` 를 `useSyncExternalStore` 로 읽는다. 첫 그림부터 맞는 셸을 그리고, 폭이 바뀌면 바로 바꾼다.
- 두 셸을 CSS 로 함께 그리고 숨기지 않고 하나만 그린다. 숨긴 쪽도 DOM 에 남으면 같은 이름의 탭 링크가 두 벌 생기고, CSS 가 없는 jsdom 단위 테스트에서 둘 다 보인다.
- [AppHeader.tsx](../../../src/widgets/app-shell/ui/AppHeader.tsx): 768px 이상은 지금 헤더 그대로다. 미만은 높이 56px(+ 위 안전 영역), 좌우 20px, 아래 선 없음, 왼쪽 워크스페이스 메뉴, 오른쪽 알림 종·아바타다(PwaDashboard). 마크는 뺐다(홈 탭이 같은 곳으로 간다). 알림 종(`features/notifications`)은 고치지 않고 셸에서 자리만 옮겼다. 헤더 뼈대도 같은 두 모양이다.
- [BottomTabBar.tsx](../../../src/widgets/app-shell/ui/BottomTabBar.tsx): 화면 아래에 고정한 `nav aria-label="주요 화면"`. 아이콘 24 + 글자 11px, 지금 탭은 먹·굵게·선 1.9(`aria-current="page"`), 나머지는 흐림·선 1.7. 대시보드는 `홈` 이다. 아이콘 다섯은 시안 경로를 [Icon.tsx](../../../src/shared/ui/icon/Icon.tsx) 에 더했다.
- [global.css](../../../src/app/styles/global.css): 막대 높이 `--bottom-tab-bar` 를 막대가 있을 때만(`:root:has([data-bottom-tab-bar])`) `56px + max(8px, 아래 안전 영역)` 으로 둔다. 홈 표시줄(34px)이 있으면 시안과 같은 90px 이다. 막대가 없으면 0 이다.
- [WorkspaceLayout.tsx](../../../src/app/router/layouts/WorkspaceLayout.tsx): 셸 본문 아래 여백을 `고정 토스트 여백 + --bottom-tab-bar` 로 계산하고, 휴대폰 셸이면 막대를 그린다.
- [GlobalToaster.tsx](../../../src/shared/ui/toast/GlobalToaster.tsx): 토스트 독의 아래 위치를 `24px + --bottom-tab-bar` 로 바꿨다. 정리 중 토스트가 막대 위 24px 에 뜬다. 768px 이상은 지금처럼 24px 이다.
- [index.html](../../../index.html): viewport 에 `viewport-fit=cover` 를 더했다. 스플래시(#430)는 `position: fixed; inset: 0` 판이고 상태 글자가 이미 `env(safe-area-inset-bottom)` 을 쓴다. 덮는 판이 안전 영역까지 넓어질 뿐 배치는 같다.
- 메시지 탭의 새 글 수는 넣지 않았다. 위 탭에도 숫자가 없고 읽지 않은 수를 주는 API 가 없다. 사용자 결정으로 BE 요청 [#480](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/480)이 열렸고, 값이 생기면 위·아래 탭에 같이 붙인다.

### 테스트

- [appShell.test.tsx](../../../src/app/appShell.test.tsx): 360px 에서 아래 탭 막대의 다섯 탭(`홈`부터), 지금 탭 표시와 이동, 헤더에 탭 링크가 없고 알림·공간 메뉴·계정 메뉴(설정·로그아웃)가 있는지 본다. 폭이 1024 → 390 → 768 로 바뀔 때 셸이 바로 바뀌는지도 본다.
- [layout.e2e.ts](../../../e2e/layout.e2e.ts): 폭에 360·390px 을 더했다. 이 두 폭의 가로 넘침 검사는 지금 0 인 워크스페이스 선택·온보딩만 본다. 헤더 한 줄 검사는 768px 이상에서만 돌고, 768px 미만은 아래 탭 막대 검사(탭 다섯이 화면 안, `홈` 표시, 막대 자체 넘침 0, 막대가 화면 바닥, 헤더의 세 버튼이 화면 안, 정리 중 토스트가 막대 위, 태스크로 이동)를 돈다. [support.ts](../../../e2e/support.ts) 의 `expectNoHorizontalOverflow` 주석을 360px 기준으로 고쳤다.
- [GlobalToaster.test.tsx](../../../src/shared/ui/toast/GlobalToaster.test.tsx): 독 위치 클래스 기대값을 바꿨다.

## 검증

화면 측정과 스크린샷은 Vite 개발 서버(MSW) + Playwright Chromium 153 으로 했다. 증거는 커밋하지 않는 `frontend/.verify/reports/478-shell/` 에 있다.

- 360·390·768·1024·1280px 에서 랜딩·로그인·회원가입·워크스페이스 선택·온보딩·대시보드·태스크·회의록·회의 상세·메시지·팀·설정의 스크린샷과 넘침 값을 develop 과 이 브랜치에서 각각 쟀다.
- 768·1024·1280px: 넘침은 전후 모두 0 이다(랜딩 768px 은 전후 모두 3px). 스크린샷은 대부분 픽셀 단위로 같다. 다른 것은 글꼴이 늦게 붙은 차이였다. 같은 코드로 두 번 찍어도 같은 화면(대시보드·태스크·팀)이 같은 픽셀 수만큼 달랐고, 랜딩은 본문 글꼴만 다르고 배치는 같았다.
- 안전 영역을 CDP `Emulation.setSafeAreaInsetsOverride`(위 47, 아래 34)로 흉내 냈다. 390px 에서 헤더 103px(시안과 같음), 막대 90px(시안과 같음), 정리 중 토스트 아래 끝이 막대 위 24px 이다.
- 360px 에서 알림 창, 워크스페이스 메뉴, 계정 메뉴(로그아웃 포함)가 열리고 화면 안에 다 들어온다.
- `display-mode: standalone` 은 Playwright Chromium 에서 흉내 내지 못했다(CDP 미디어 기능으로 줘도 `matchMedia` 가 false). 셸 코드는 `display-mode` 로 갈리지 않고, 설치한 앱에서 달라지는 안전 영역은 위처럼 확인했다. 실제 기기는 확인하지 않았다.

### 360·390px 넘침 (이 PR 뒤)

| 화면 | develop 360 | 360 | develop 390 | 390 | 남은 원인 |
|---|---|---|---|---|---|
| 대시보드 | 286 | 116 | 256 | 86 | 오른쪽 단 360px 고정 |
| 태스크(리스트) | 286 | 19 | 256 | 0 | 보기 방식 세그먼트 |
| 회의록·회의 상세 | 286 | 228 | 256 | 198 | 회의 목록 aside 308px + 참석자 칩 |
| 메시지 | 286 | 20 | 256 | 0 | 목록 308px + 상세 버튼 줄 |
| 팀 | 286 | 124 | 256 | 94 | 오른쪽 단 336px 고정 |
| 설정 | 286 | 126 | 256 | 96 | 목차 + 연결 행 버튼 묶음 |
| 로그인·회원가입 | 174 | 174 | 159 | 159 | 두 칸 틀(#454 가 고친다) |
| 랜딩 | 411 | 411 | 381 | 381 | 머리 줄, 560px 고정 칸·목업 |
| 워크스페이스 선택·온보딩 | 0 | 0 | 0 | 0 | — |

## 남은 작업과 제한 사항

- 화면 안쪽 배치(H-1~H-5 시안, 시안 없는 화면 한 열)와 그 화면들의 360·390px 넘침 검사는 #478 의 다음 PR 이 한다. 시안의 화면 제목(머리 줄의 `대시보드`·`태스크` 등)과 태스크 추가 버튼도 그때 넣는다.
- 메시지 화면은 높이를 `100dvh - 헤더 76px` 로 잡는다(`MessageInbox.tsx`). 휴대폰 셸의 헤더 56px·아래 탭 막대와 맞지 않는다. 그 위젯은 #474·#344·#417 이 고치는 중이라 이 PR 에서 건드리지 않았다.
- 정리 중 토스트의 화면 자리를 바꾸는 #474 는 같은 `GlobalToaster.tsx` 의 바로 아랫줄을 고친다. 먼저 병합되는 쪽 뒤에 다른 쪽이 맞춘다.
- 768~1023px 은 데스크톱 셸 그대로다. 그 폭의 화면 배치는 다음 PR 에서 정한다.
- 가로로 눕힌 휴대폰의 좌우 안전 영역은 반영하지 않았다.

## 관련 기록

- [D-180](../../decision/frontend-decisions.md#d-180-휴대폰-폭-지원과-아래-탭-막대-d-123d-124-대체): 휴대폰 폭 지원과 아래 탭 막대
- [디자인 시스템 §7-11·§10](../../design/design-system.md)
