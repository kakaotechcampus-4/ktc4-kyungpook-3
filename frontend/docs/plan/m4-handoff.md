# M4 인수인계

- 작성일: 2026-09-29
- 브랜치: `feature/108-m4-auth-onboarding-workspace`
- 계획: `m4-auth-onboarding-and-workspace.md` · 완료 조건: `m4-done-criteria.md`
- 상태: **U1~U5 검증 PASS, 최종 게이트 F 1회차 FAIL(major 1건) → 수정 2회차 진행 중에 중단.** 이 커밋은 중단 시점 작업 트리 그대로이며 lint·format 이 실패한다.

## 1. 지금까지

구현 에이전트와 분리된 검증 에이전트가 단위마다 `m4-done-criteria.md` 로 판정했다(구현 → 검증 → 수정 루프).

| 단위 | 범위 | 판정 |
|---|---|---|
| U1 | API·MSW 기반(entities 함수, 브라우저 MSW sessionStorage 영속, 모의 OAuth, E2E 시나리오 초기화) | PASS (r1) |
| U2 | 랜딩·로그인·회원가입, 폼 공통 정책, 로그인/재방문 이동 | PASS (r1) |
| U3 | 워크스페이스 생성·온보딩 4단계·팀원 연결 | PASS (r1) |
| U4 | 워크스페이스 선택·앱 셸(헤더·5개 탭·Radix 메뉴)·대시보드 빈 상태 | PASS (r1) |
| U5 | Storybook 10.6, Playwright 1.63 E2E(28건), CI, 구현 결정 문서, 실 API 제약 표 | PASS (r1) + minor 3건 후속 수정 |
| — | 테스트 유틸 `RouterProbe` 위치 기록 경합(flaky) 근본 수정 — `expectPath`/`expectSearch` | 완료(test 5회 연속 통과) |
| F | 최종 게이트 r1 | **FAIL**: F1·F3 PASS, F2 는 U5-1 만 FAIL |

F r1 에서 확인된 것: `npm ci` 뒤 typecheck·lint·format·build·build-storybook 통과, test 3회 839/839, e2e 2회 28/28, 프로덕션 빌드에 모의 코드 문자열 0건, 계획 4절 34항목 전부 테스트 대응, `backend/`·`ai/` 변경 0.

사용자 결정(구현에 반영됨):
- 랜딩: 제품 미리보기는 정적 마크업으로 구현, 요금제·FAQ 제외 → `docs/impl-decision/2026-09-28-landing-scope.md`
- 온보딩: 하단 이전/다음 버튼 없이 `n / 4` 만, 나가기는 좌측 상단 뒤로가기. Notion DB 선택 없음, 연동 완료 줄은 이름 없이 → `docs/impl-decision/2026-09-28-onboarding-layout.md`

## 2. 중단 시점 상태 (이 커밋)

| 검사 | 결과 |
|---|---|
| typecheck | PASS |
| lint | **FAIL 5건** — `e2e/storybook/serve.mjs` node 전역(`process`·`URL`·`console`) no-undef 3건, `playwright.storybook.config.ts` 가 tsconfig/eslint project 에 없음, `widgets/onboarding/ui/MembersStep.tsx:143` react-hooks/refs(렌더 중 ref 접근) |
| format:check | **FAIL** — `src/widgets/onboarding/ui/MembersStep.tsx` |
| test | PASS 846/846 (1회) |
| build | PASS |
| build-storybook · test:e2e · test:storybook | 중단 후 미실행(`test:storybook` 은 중단 전 1회 passed 기록) |

## 3. 남은 일 — F 수정 2회차

항목 번호는 F r1 검증 보고서 기준이다. 상태는 중단 시점 파일 변경으로 추정한 것이니 이어받는 쪽이 확인한다.

| # | 등급 | 내용 | 상태 |
|---|---|---|---|
| 1 | **major** | `.storybook/preview.tsx` 에서 `worker.resetHandlers(...parameters.msw)` 가 MSW 2.15 의 기본 handler 를 통째로 바꿔, 오버라이드 스토리 9곳이 404 로 그려지고 같은 iframe 의 뒤 스토리도 오류가 됨 | 코드 수정됨(`resetHandlers()` 뒤 `worker.use(...)`). 회귀 확인 `e2e/storybook/*` + `playwright.storybook.config.ts` + `npm run test:storybook` + CI `storybook` job 추가. **lint 오류 2종 정리 필요** |
| 8 | minor | 개발 계획·계약 초안·MSW 주석의 소속 서술, "쿠키 7일" → 서버 세션 7일·쿠키 max_age 없음 | 진행됨. MSW 워크스페이스 상세를 실 API 처럼 비소속 403 으로 맞추는 변경(U5-r1 #4)까지 포함 — 확인 필요 |
| 4 | minor | 검증 오류에 강조색을 쓰는 결정 기록 | `impl-decision/2026-09-29-field-error-accent.md` 작성됨 |
| 9 | minor | 캔버스에 없는 아이콘 3개(`arrow-left`·`eye-off`·`logout`) 출처 기록 | `app-shell-scope.md` 수정됨 — 확인 필요 |
| 13 | minor | `ErrorText` 가 `role="alert"` + `aria-describedby` 로 이중 낭독 | 진행됨(`ErrorText`·`TextField` + `field-error-announcement.md`) |
| 5 | minor | 이미 연결된 줄로 매핑을 옮기면 동명 팀원 생성 | 진행됨(`memberMapping.ts`, 모델 테스트) |
| 6 | minor | 건너뛰기 실패 뒤 `연결하기` 차단을 "서버가 이미 skipped" 인 경우로 좁히기 | 진행됨(`useIntegrationStep.ts`) |
| 7 | minor | 팀원 연결의 `나가기` 저장과 `확인 완료` 제출 동시 진행 차단 | **작업 도중** — `MembersStep.tsx` 에 lint·format 실패 |
| 12 | minor | 가입 성공 뒤 목록 조회 실패 시 비로그인 화면에 갇히고 재제출이 409 | 미착수로 보임(`features/auth/model/useEnterSession.ts` 미변경) |
| 2 | minor | `계속 작성하기` 뒤 "머물렀다" 단언 4곳 보강(appShell·onboardingCreate·onboardingMembers·pages) | 미착수 |
| 3 | minor | 토큰이 있는데 임의값을 쓴 5곳(ProductPreview·BrandMark·WorkspaceBadge·MembersStep) | 미착수 |
| 10 | minor | 빠진 스토리 상태(회원가입 제출 중·비활성, Notion 로딩·오류·취소, 만들기 비활성, PagePlaceholder) | 미착수 |
| 11 | minor | E2E: Tab 순서를 실제 Tab 키로, 헤더 한 줄을 높이 외 방법으로 | 미착수 |
| 14 | 참고 | `dist/mockServiceWorker.js` 가 프로덕션 산출물에 포함(HEAD 부터, 등록 코드 없음) | 변경하지 않기로 함 |

다음 마일스톤으로 넘긴 것: 실제 Google·Discord·Notion OAuth 연동과 온보딩 저장 등 백엔드 스텁 구간(개발 계획 M4 "실 API 제약" 표).

## 4. 이어받는 순서

1. `frontend/` 에서 lint·format 을 먼저 복구한다. `npm run format`, `serve.mjs` 에 node 전역 설정(eslint globals), `playwright.storybook.config.ts` 를 `tsconfig.json`·eslint project 범위에 추가, `MembersStep.tsx` #7 을 렌더 중 ref 접근 없이 마무리한다.
2. 표의 "진행됨·확인 필요" 항목을 확인하고, 미착수 항목(#12·#2·#3·#10·#11)을 처리하거나 사유를 남긴다. #12 는 동작 결함이라 처리를 권한다.
3. 전체 게이트를 돌린다: `npm ci` → typecheck·lint·format:check·test(2회)·build·build-storybook·test:e2e(2회)·test:storybook. 확인용으로 띄운 개발 서버는 끝나기 전에 종료한다(남은 vite 서버가 `node_modules` 를 잡아 `npm ci` 가 EPERM 으로 실패한 적이 있다).
4. 구현자와 분리된 검증자로 최종 게이트 F 를 다시 판정한다(`m4-done-criteria.md` 의 F1~F3). 재검증 범위는 G1 전체, U5-1, 이번에 바뀐 테스트의 G3 과 동작 결함 항목이다.
5. F PASS 뒤 develop 대상 PR 을 연다.

## 5. 참고

- Windows `core.autocrlf=true` 체크아웃에서 `format:check` 를 맞추느라 작업 트리 전체가 LF 로 정규화됐다. `git status` 에 내용 변경 없는 ` M` 이 많이 보일 수 있으나 커밋에는 실제 변경만 들어간다. 스테이징 뒤 `git diff --cached --stat` 으로 확인한다.
- Orca 에서 Codex 워커를 띄우면 준비 감지(`agent_readiness`)가 `missing_status` 로 실패했다. `~/.codex/hooks.json` 의 Orca 훅이 비워지는 것이 한 원인이었는데, 복구해도 다시 비워졌다. 이번 루프의 검증은 Claude Opus 5.5 high 로 대체했다.
- 루프 운영 파일(단위별 작업 지시·검증 보고서·이월 목록)은 작성자 로컬 `.orca-loop/` 에만 있고 커밋하지 않았다. 필요한 내용은 이 문서에 옮겼다.
