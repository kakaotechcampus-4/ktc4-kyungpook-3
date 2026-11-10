# 접근성·성능

디자인 토큰, 접근성(대비·키보드·포커스), 휴대폰 360px, 로딩 표시, 성능 측정을 다룬다. 기준은 D-128(WCAG 2.2 AA 를 구현 기준으로, 완전 준수는 선언하지 않음), D-180(최소 폭 360px), [디자인 시스템](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/docs/design/design-system.md) v0.6 이다.

## 문제

| 문제 | 근거 |
|---|---|
| 강조색 `#ff6969`·흐린 글자 `#999999` 가 흰 바탕 2.8:1 로 대비 미달 | 2026-10-30 접근성 보고서(KWCAG 2.2) |
| 글만 있는 탭 패널·기본 날짜 입력에서 Tab 순서가 어긋남 | 같은 보고서(#337) |
| 캘린더 상태를 색으로만 구분 | 같은 보고서(#338) |
| 설치한 앱이 휴대폰에서 열리는데 로그인 뒤 화면 대부분이 360px 에서 옆으로 넘침 | #455 측정(286px 넘침) |
| 네트워크가 빠르면 스켈레톤이 한두 프레임 번쩍임 | #508 |
| 태스크 하나 상태를 바꾸면 보드 전체가 다시 그려짐 | M8-A 렌더 측정 |

## 동작

### 디자인 시스템과 토큰

| 항목 | 내용 |
|---|---|
| 토큰 위치 | [`tokens.css`](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/src/app/styles/tokens.css) 의 Tailwind `@theme`. 색·글자·간격·반경을 CSS 변수로. 값마다 대비 근거를 주석으로 단다 |
| 실측 원본 | `frontend/docs/design/canvas/Foundations.dc.html`. 문서 표와 어긋나면 캔버스가 맞다 |
| 톤 | 라이트·무채색. 콘텐츠 면은 흰색, 회색 면은 누를 수 있거나 상태를 말하는 것에만(§1-2). 그림자 없음 |
| 유채색 | 강조 레드 한 계열 다섯 값뿐. `ok`·`warn` 같은 의미색 토큰을 만들지 않는다(§3-3) |
| 글꼴 | NanumSquare Regular·Bold. 잉크는 `#171717` 하나(순수 검정 금지) |
| 마스코트 | 절차적 SVG. 움직임 줄이기 설정을 구독한다 |

강조 레드는 자리마다 필요한 대비가 달라 다섯 값으로 나눴다([2026-11-06 결정](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/docs/plan/m2/basis-for-decision/2026-11-06-accent-red-r2.md)).

| 토큰 | 값 | 자리 | 필요 | 실제 |
|---|---|---|---|---|
| `accent` | `#C62828` | 작은 글자, 오류 입력 라벨·경계, 배지 글자 | 4.5:1 | 회색 면 4종 위 4.80~5.62 |
| `accent-point` | `#E62E2D` | 글자 아닌 표식(안 읽음 점, 강조 포커스 선) | 3:1 | 3.74~4.38 |
| `accent-solid` | `#D32F2F` | 흰 글자를 얹는 면 | 4.5:1 | 4.98 |
| `accent-badge` | `#FBE9E7` | 글자 있는 배지 바탕 | 4.5:1 | 4.80 |
| `accent-chip` | `#F4D9D7` | 캘린더 칩, 안내 띠 바탕 | 4.5:1 | 먹 13.45 |

### 접근성 구현

| 항목 | 구현 | 근거 |
|---|---|---|
| 포커스 | `:focus-visible { outline: 2px solid #171717; outline-offset: -1px }`. 음수 offset 으로 테두리 위에 겹쳐 두 겹으로 보이지 않게. 먹 면 컨트롤은 안쪽 흰 선, 오류 입력은 레드 포인트 선 | D-128, [2026-09-23 결정](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/docs/plan/m2/basis-for-decision/2026-09-23-focus-outline-over-border.md) |
| 모달 | Radix Dialog 포커스 트랩, 닫히면 연 요소로 복귀 | [2026-10-06 결정](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/docs/plan/m5/basis-for-decision/2026-10-06-modal-focus-return.md) |
| 탭 패널 | 안에 누를 것이 없을 때만 `tabindex="0"`(WAI-ARIA APG). 일괄 제거하면 글만 있는 패널에 키보드로 닿지 못한다 | [#337 결정](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/docs/plan/m5/basis-for-decision/2026-11-04-tab-panel-and-date-focus.md) |
| 색 외 표현 | 확정도는 점·필·테두리, 캘린더 상태는 아이콘 + 낭독 이름 | §3-4, [#338 결정](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/docs/plan/m8/basis-for-decision/2026-11-05-calendar-status-marks.md) |
| 입력 오류 | 오류 문구를 입력에 연결하고 낭독 | [2026-09-29 결정](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/docs/plan/m4/basis-for-decision/2026-09-29-field-error-announcement.md) |
| 동적 상태 | 로딩 컨테이너 `aria-busy`, 스플래시 `role="status"`, 알림 종 `aria-label` 에 읽지 않은 수 | #508, #430 |
| 움직임 줄이기 | `prefers-reduced-motion` 이면 전환 0s, 스켈레톤·스플래시 움직임 정지 | `global.css`, #593 |
| 정적 검사 | `eslint-plugin-jsx-a11y` | [eslint.config.js](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/eslint.config.js) |

### 휴대폰 360px (D-180, #478)

- 768px 미만은 위 헤더의 탭 줄 대신 아래 탭 막대(홈·회의록·태스크·메시지·팀). 헤더에는 공간 바꾸기·알림·계정만.
- 두 셸을 CSS 로 숨기지 않고 `matchMedia` 로 **하나만** 그린다. 숨긴 쪽이 DOM 에 남으면 같은 이름 링크가 두 벌 생긴다.
- 768px 을 넘나들어도(회전) 열린 메뉴와 포커스가 남는다. 처음엔 닫히고 포커스가 body 로 갔다(독립 리뷰가 찾음).
- `env(safe-area-inset-*)` 만큼 비켜 그린다. 넓은 콘텐츠(캘린더·간트)는 그 칸 안에서만 가로 스크롤.

> 📷 **사진 자리**: 390px 휴대폰 — 아래 탭 막대, 태스크 보드 칸 고르기(H-3), 막대 위 정리 중 토스트 (파일: ../../assets/design-frontend-mobile-360.png)

### 로딩 표시 (#508)

| 구간 | 표시 |
|---|---|
| 0~200ms | 스켈레톤 없이 같은 높이의 빈 자리. `aria-busy` 는 바로 켬 |
| 200ms 안에 도착 | 스켈레톤 없이 내용 |
| 200ms 초과 | 스켈레톤, 한 번 보이면 최소 400ms |
| 내용 등장 | 150ms 불투명도 전환(움직임 줄이기면 없음) |

공통 훅 `useLoadingIndicator`(`LOADING_DELAY_MS` 200, `LOADING_MIN_MS` 400)와 `DeferredSkeleton`·`Reveal` 하나로 모든 화면이 같은 규칙을 쓴다([결정](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/docs/plan/m8/basis-for-decision/2026-11-07-skeleton-delay.md)).

> 📷 **사진 자리**: 회의록 첫 진입 스켈레톤과 내용 전환 (파일: ../../assets/design-frontend-skeleton.png)

## 왜 이 방식인가

| 결정 | 실제로 비교한 대안 | 고른 이유 | 기록 |
|---|---|---|---|
| 강조색 다섯 값 R2 | 벽돌색 `#c43636` 하나(#336) / 복숭아 파스텔 / R1(두 빨강이 거의 같음) | 한 값이 글자·면·점을 다 맡으면 가장 엄한 기준에 맞춰 어두워진다. 사용자가 벽돌색을 어색해함 | 2026-11-06 결정 |
| `faint` 는 값을 두고 쓰임을 비활성으로 줄임 | 값을 `#767676` 로 올림 | 읽어야 하는 글자에서만 빼면 회색 위계가 유지된다 | [2026-11-04 결정](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/docs/plan/m2/basis-for-decision/2026-11-04-accent-faint-contrast.md) |
| 포커스 outline 을 테두리 위에 | outline 제거(2026-09-16) / offset 4px 링 | 제거하면 SC 2.4.7 미충족. 4px 링은 틈이 생겨 두 겹으로 보임 | 2026-09-23 결정 |
| 기본 `<input type="date">` 유지 | 직접 만든 날짜 선택기 | 보고서가 지적한 `spinbutton` 은 Chrome 이 만드는 역할이라 코드에서 지울 수 없다. 기본 입력이 키보드·낭독을 브라우저 수준에서 준다 | #337 결정 |
| 스켈레톤 200ms 지연 + 400ms 최소 | 즉시 표시 | 빠른 응답에서 번쩍임이 로딩보다 거슬린다 | #508 |
| 최소 폭 360px | 데스크톱 1024px 이상만(D-123·D-124) | 설치형 앱(PWA)을 휴대폰에서 쓴다 | D-180 |

## 어떻게 검증했나

### 접근성

| 무엇 | 테스트 | 기준 |
|---|---|---|
| 실제 색 대비 | [`color-contrast.e2e.ts`](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/e2e/color-contrast.e2e.ts) | 화면의 글자마다 뒤 면을 찾아 WCAG 공식으로 계산. 로그인 오류 문구·대시보드 기한 지남·보드·캘린더·간트의 레드 면 위 글자가 4.5:1 이상 |
| 토큰 생성 | [`tokens.test.ts`](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/src/app/styles/tokens.test.ts) | `index.css` 를 Tailwind 로 직접 컴파일해 간격 토큰 클래스(`gap-0` 등)가 실제로 생기는지. 없어도 빌드·타입·jsdom 은 통과하기 때문(#497) |
| 키보드만으로 회의 올리기, 모달 포커스 트랩·복귀 | [`meeting-keyboard.e2e.ts`](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/e2e/meeting-keyboard.e2e.ts) | 마우스 없이 끝까지 |
| 키보드만으로 승인, 칸 오류가 칸에 연결 | `tasks-approval.e2e.ts` | 화살표 탭 이동이 URL 에 남음 |
| 첫 포커스부터 2px/-1px | `task-views-design.e2e.ts` | #593 회귀 |

### 휴대폰·레이아웃

- [`layout.e2e.ts`](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/e2e/layout.e2e.ts) 가 360·390·768·1024·1280·1440px 에서 화면별 가로 넘침을 잰다. 휴대폰 폭에서는 탭 막대 다섯이 화면 안, 토스트가 막대 위, CDP 로 준 좌우 안전 영역(852×393 에 59px, 667×375 에 44px) 안쪽에 누를 것이 있는지도 본다.
- #478 첫 PR 에서 공통 원인(헤더가 646px 까지 그려짐)을 없애 360px 넘침이 대시보드 286 → 116px, 태스크 286 → 19px 등으로 줄었고, 이어진 화면 PR 에서 360·390px 넘침 0 을 맞췄다(프로젝트 상세 §6.4).

### 성능 수치

개선 원인·전후 범위·측정 조건·채택하지 않은 시도는 [프론트엔드 성능 개선](performance.md)에 정리했다. 아래 표는 과거 기록의 요약이며 현재 운영 서비스에서 새로 측정한 결과가 아니다.

| 날짜 | 무엇 | 조건 | 결과 | 근거 |
|---|---|---|---|---|
| 2026-11 (M8-A) | 태스크 1건 상태 변경 때 다른 항목 재렌더 | 310건, 렌더 횟수 계측 | 보드 309 → 0, 간트 311 → 0, 캘린더 315 → 6 | [M8 결과 A](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/docs/plan/m8/result-a.md) AC-A-04, `taskViewsRender.test.tsx` |
| 2026-11-05 | Bold 폰트 preload 제거 | Chromium headless, Slow 4G(지연 562.5ms, 180KB/s), 구성마다 7회, 168회 | LCP HTTP/2 로그인 −0.49초·대시보드 −0.56초, HTTP/1.1 −1.01초·−0.57초. 굵은 글씨는 약 1.5초 폴백 글꼴 | [폰트 재측정](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/docs/performance/2026-11-05-font-loading-remeasure.md), #352 |
| 2026-11-05 | 폰트 unicode-range 분할 | 같은 조건 | 첫 화면 폰트 325 → 234KB 인데 LCP 는 오히려 92~220ms 늦음 → 채택 안 함 | 같은 문서 |
| 2026-11-05 | 대시보드 최신 완료 회의 고르기 | Node, 1만 건 | 약 61ms → 1.5ms(체감 개선은 주장하지 않음) | #350, [이슈 목록](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/docs/plan/history/2026-11-07-followups.md) |
| 2026-11-05 | 태스크 보드 파생값 | 프로덕션 모양 번들, 2,000건, 15라운드 중앙값 | 한 번에 5.3~8.7ms, 화면 비중 최대 약 5% → 코드 변경 보류 | [taskboard-derived](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/docs/performance/2026-11-05-taskboard-derived.md), #351 |

- 측정했지만 고치지 않은 것은 [성능 개선 거리](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/docs/performance/README.md)에 모은다. 고치면 결정 기록으로 옮긴다.

## 한계와 다음 단계

- **WCAG 2.2 AA 완전 준수를 선언하지 않는다**(D-128). 외부 감사는 2026-10-30 보고서 한 번이고, 디자인 시스템 §11 체크리스트는 포커스 한 줄만 완료 표시다(흑백 구분·키보드 승인 흐름 등은 E2E 로 일부 확인했지만 문서 체크는 갱신되지 않음) **[확인 필요: 체크리스트 갱신]**.
- **스크린 리더 실사용 검사 기록이 없다.** 역할·이름은 RTL `getByRole` 로 간접 확인한다.
- **첫 화면을 막는 것은 JS 다.** Slow 4G 로그인에서 메인 JS 가 3.15초에 끝나고 화면 조각을 받아 3.85초에 그린다. `modulepreload` 조각 25개의 직렬 대기는 [2026-09-29 기록](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/docs/performance/2026-09-29-font-loading.md)의 고칠 거리 3(메인 번들)으로 남았다.
- 성능 측정은 headless Chromium·API 지연 없음이다. 실제 휴대폰·실서버 왕복은 재지 않았다. 실기기 `display-mode: standalone` 도 흉내 내지 못했다(#478).
- 768~1023px 태블릿 폭의 화면 배치는 데스크톱 셸 그대로다.
