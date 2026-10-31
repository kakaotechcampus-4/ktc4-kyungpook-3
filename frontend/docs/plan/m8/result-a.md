# M8-A 구현 결과 — 태스크 보기(보드·간트·캘린더)

- 기록일: 2026-10-31
- 대상: [M8 계획](plan.md) A 절, 이슈 #243. 구현 순서 3~7과 8(이 문서)
- 상태: **AC-A-02~AC-A-06은 프론트·MSW 기준으로 충족했다. AC-A-01(보기 URL 표현)은 사용자 결정 대기라 미해결이다.** 브랜치 `feature/243-m8-task-views`의 develop 대비 9커밋(push·PR 전). 최종 게이트(2026-10-31, Node v24.11.0)는 모두 exit 0이었다. 다만 전체 Vitest는 기본 설정이 아닌 `--maxWorkers=2`로 통과했고, 기본 설정 실행은 실패 이력이 있다(아래 「전체 Vitest」). 실제 서버 연동은 검증하지 않았다. M8-A 완료나 M8 전체 완료를 선언하지 않는다.

## 작업 근거와 요약

코디네이터가 나눈 작업으로 진행했다. 구현 워커가 계획의 구현 순서 3~7을 커밋했다. 이어서 V2 리뷰가 FAIL(major 2·minor 1)을 냈고 수정 3커밋을 더했다. 최종 게이트 V3는 PASS였다. 이 문서는 그 기록을 문서 작성 워커가 정리한 것이다. 코드는 바꾸지 않았다.

- 기준: develop 공통 커밋 `ff9467e`, HEAD `824459f`.
- 계획 파일: `plan.md`의 A 절 내용은 작업 트리에만 있는 미커밋 변경이다(커밋된 파일은 0바이트). 이 브랜치의 9커밋과 이 문서 작업은 `plan.md`를 수정하지 않았다. V1·V3의 작업 시작·종료 SHA256은 `DA410FE7…C10`으로 같았다.
- 근거 보고: 구현 워커 보고, V1(수정 전 HEAD `2a44c02`의 중간 기록), V2 리뷰(정적 검토), V3 최종 게이트. 모두 코디네이터 작업 폴더의 임시 파일이며 저장소에는 없다.

| 커밋 | 계획 단계 | 내용 |
|---|---|---|
| `beca1bb` | 3 | 보드·캘린더·간트를 `React.lazy`로 나누고, 보기별 `Suspense`(key=보기)로 코드 대기 `status`를 그린다. `VIEW_LABEL`을 lib로 옮겼다 |
| `608d188` | 4 | 보기별 조회 대기·빈 응답·태스크 조회 실패와, 확인 필요·팀원·회의 부분 실패·재조회 실패 안내와 다시 시도를 둔다. `assigneeLabel`·`queryView`, 간트 `알 수 없는 담당자` 묶음, 캘린더·간트 기간 빈 안내 |
| `3f75acc` | 5 | 긴 제목·이름을 접거나 말줄임한다. 간트 왼쪽 칸 252px 고정, 날짜 칸 최소 48px과 표 영역 안 가로 스크롤(`HorizontalScroll`). MSW `tasks-long-content` 시나리오와 `e2e/task-views.e2e.ts` |
| `11fda7a` | 6 | 보드 카드·캘린더 칩·간트 행을 `memo`로 나눴다. 캘린더 날짜별 묶음은 한 번만 만들고, 간트 묶음·승인·회의 배열을 `useMemo`로 둔다. `taskViewsRender.test.tsx` |
| `574b647` | 7 | `TaskViews.stories.tsx` 12개 스토리(모두 play)와 `stories.sb.ts`의 M8 묶음 |
| `2a44c02` | 7 | 사용자 지시(코디네이터 전달)대로 E2E를 너비별 배치·가로 스크롤만 남기고 줄였다 |
| `9c89891` | V2-01 수정 | 태스크·확인 필요가 없어도 받은 회의가 있으면 캘린더 격자와 회의를 그린다 |
| `e1618a5` | V2-02 수정 | 확인 필요를 받지 못하면 캘린더·간트의 빈 기간 문구를 불러온 태스크 범위로 말하고 합계를 숨긴다 |
| `824459f` | V2-03 수정 | 렌더 회귀 테스트에 캘린더 취소선 칩·간트 완료 막대 표시 단언을 더했다 |

## 실제 구현 및 관련 코드

- **코드 분리** — [TaskBoard](../../../src/widgets/task-board/ui/TaskBoard.tsx)의 세 보기를 `lazy(() => import(...))`로 선언했다. 고른 보기만 keyed `Suspense` 안에서 그리며, 대기 문구는 「○○ 화면을 불러오는 중」(`status`)이다. 데이터 대기와는 다른 이름의 `status`다.
- **조회 상태** — 태스크를 처음부터 받지 못한 경우만 보기 전체를 오류로 그린다. 확인 필요(PM)·팀원·회의(캘린더) 실패와, 데이터가 있는 상태의 재조회 실패는 받은 데이터로 그린다. 그 위에 `role="alert"`의 「○○ 정보를 불러오지 못했어요. 보이는 내용이 전부가 아닐 수 있어요.」와 실패한 조회만 다시 부르는 `다시 시도`를 둔다. 받지 못한 담당자는 `담당자 없음`·`미지정`이 아니라 `알 수 없는 담당자`로 쓴다([taskViews](../../../src/widgets/task-board/lib/taskViews.ts)의 `assigneeLabel`). 리스트 보기는 기존 분기를 유지했다. 방침은 [부분 실패 결정](basis-for-decision/2026-10-31-task-views-partial-failure.md)에 남겼다.
- **확인 필요 미조회 동안의 표시** — PM이 확인 필요를 받지 못했으면(`approvalsMissing`) 표현을 바꾼다. 빈 기간은 「불러온 태스크에는 이 달에 마감인 일이 없어요.」·「불러온 태스크에는 이 3주에 일정이 있는 일이 없어요.」로 쓴다. 캘린더 마감일 없음·간트 일정이 없는 일·담당자 줄 N건 합계는 숨긴다([CalendarView](../../../src/widgets/task-board/ui/CalendarView.tsx), [GanttView](../../../src/widgets/task-board/ui/GanttView.tsx)). [합계 숨김 결정](basis-for-decision/2026-10-31-task-views-unconfirmed-approval-totals.md).
- **캘린더 빈 상태** — 태스크·확인 필요가 모두 비어도 받은 회의가 있으면 전체 빈 상태 대신 캘린더 격자와 회의를 그린다(`TaskBoard`의 `calendarMeetings.length` 판정).
- **너비** — 보드·캘린더는 긴 문자열을 칸 안에서 접어 넘침을 없앴고 최소 폭을 두지 않았다. 간트는 왼쪽 칸 252px + 날짜 21칸 × 최소 48px을 표의 최소 폭으로 둔다. 이 폭이 영역보다 크면 [viewParts](../../../src/widgets/task-board/ui/viewParts.tsx)의 `HorizontalScroll` 영역 안에서 가로로 스크롤한다. 넘칠 때만 `tabIndex=0`이며 넘침은 `ResizeObserver`로 판정한다. 48px은 시안 셸 본문 1264px에서의 칸 폭이다. 1024px의 균등 분할(약 32px)에서는 `tasks-default` 실측으로 막대 라벨이 3건 잘렸다(1440·1920px은 1건).
- **렌더** — 보드 `TaskCard`, 캘린더 `TaskChip`·`UndatedTask`, 간트 `TaskRow`·`ApprovalRow`·`UnscheduledRow`를 `memo`로 나눴다. 부모가 넘기는 이름 맵·상태 overlay·승인·회의 배열과 날짜별 묶음은 `useMemo`로 유지한다. 구독은 바꾸지 않았다(같은 데이터 재조회·다른 공간 mutation은 변경 전에도 커밋 0이었다).
- **`queryView` 사본** — `widgets/dashboard/lib/queryView.ts`와 같은 판정을 `widgets/task-board/lib/taskViews.ts`에 따로 두었다. [사본 결정](basis-for-decision/2026-10-31-task-views-queryview-copy.md).
- **테스트·스토리·MSW** — 통합 테스트는 [taskViews.test.tsx](../../../src/app/taskViews.test.tsx)(상태·역할·공간·상세 링크), [taskViewsCodeSplit.test.tsx](../../../src/app/taskViewsCodeSplit.test.tsx)(코드 분리), [taskViewsRender.test.tsx](../../../src/app/taskViewsRender.test.tsx)(렌더 횟수·변경 표시)다. 스토리는 [TaskViews.stories.tsx](../../../src/widgets/task-board/ui/TaskViews.stories.tsx) 12개로, [stories.sb.ts](../../../e2e/storybook/stories.sb.ts)가 play 회귀에 포함한다. 앱 E2E는 [task-views.e2e.ts](../../../e2e/task-views.e2e.ts) 9건이다. MSW 시나리오 `tasks-long-content`를 [scenarios.ts](../../../src/shared/mock/scenarios.ts)에 추가했다.
- **보존한 것** — `?view=` URL 해석(`readViewQuery`·`viewSearch`), 보드 세 컬럼과 상태 묶음, 상태 전이, 간트 21일과 막대 범위 계산, 캘린더 마감일·회의일 기준, 필터·정렬을 보존했다. `taskBoard.ts` 모델, `task-status` feature, `TasksPage`·라우터, `ApprovalCard`는 diff에 없다(V2·V3 확인).

## 완료조건 확인

| 계획의 ID | 상태 | 근거 |
|---|---|---|
| AC-A-01 | 미해결(사용자 결정 대기) | 보기 URL을 `?view=`로 둘지 별도 경로로 옮길지 정하지 않았다. 코드는 develop의 `?view=` 해석을 그대로 둔다(V2·V3가 `taskViews.ts`의 `readViewQuery`·`viewSearch` 의미 불변을 확인). 계획 구현 순서 1~2의 결정 기록 `…-task-view-url.md`는 작성하지 않았다 |
| AC-A-02 | 충족 | V3가 production build를 확인했다. `BoardView`(4046 bytes)·`CalendarView`(5445)·`GanttView`(9498)는 별도 청크다. `task-board` 청크가 세 청크를 동적 import하고, `index`·`tasks`·`task-board` 청크의 정적 import 그래프에 세 보기는 없다. `src` 전체에 정적 import·barrel 재노출이 없다. `taskViewsCodeSplit.test.tsx`는 리스트 진입 때 미로드, 고를 때 로드와 코드 대기 표시, 직접 진입, 재진입을 검증하며 전체 Vitest에 포함돼 통과했다. 브라우저 네트워크 요청 확인은 E2E 축소로 하지 않았다(계획 대비 변경) |
| AC-A-03 | 충족 | `task-views.e2e.ts` 9/9 통과(V3). 세 보기 × 1024/1440/1920px에서 페이지 가로 넘침 0, 핵심 조작, 긴 내용 접기를 확인한다. 간트는 1024px에서만 영역 안 가로 스크롤, 키보드 →, 마지막 날짜 도달을 확인한다. 변경 전후 실측은 아래 「너비 측정」 |
| AC-A-04 | 충족 | 렌더 횟수 전후 측정(아래 「렌더 측정」)에서 단일 태스크 상태 변경 때 다른 항목의 재렌더가 보드 309→0, 캘린더 315→6, 간트 311→0(310건 기준)이다. 회귀 테스트 `taskViewsRender.test.tsx`는 렌더 횟수와 각 보기의 변경 표시(보드 완료 컬럼·캘린더 취소선 칩·간트 완료 막대 라벨, V2-03 보완)를 단언한다. 시간 상한은 두지 않았다 |
| AC-A-05 | 충족(MSW) | `taskViews.test.tsx`가 보기별 조회 대기, 전체 빈 응답, 태스크 실패와 다시 시도, 확인 필요·팀원 실패, 태스크 재조회 실패, 캘린더 회의 실패·빈 달, 간트 빈 3주, 태스크·확인 필요 0 + 회의 있음(V2-01), 확인 필요 실패 + 기간 밖 태스크·태스크 0과 재시도 뒤 숫자 복귀(V2-02)를 검증한다. 상태 스토리 play도 통과했다. 이 조합의 표시는 MSW로만 확인했다 |
| AC-A-06 | 충족(MSW) | 세 보기 각각에 Vitest(`taskViews.test.tsx`)·스토리·앱 E2E(`task-views.e2e.ts`의 배치)가 있다. PM 노출, 일반 팀원 확인 필요 요청 0회, 공간 전환 격리, 상세 href와 실제 이동은 통합 테스트로 단언한다. 기존 [tasks-approval.e2e.ts](../../../e2e/tasks-approval.e2e.ts) 13/13 통과(V3). 역할·상세 링크 E2E는 E2E 축소로 통합 테스트와 스토리(`간트_팀원`·`보드_PM` 등)로 대신했다 |
| AC-A-07 | 이 문서 | 명령별 종료 코드·Node 버전·범위(아래 「검증 내역」)와 프론트·MSW 결과·미검증 연동 과제의 분리를 이 문서에 기록했다. 파트 README·마일스톤 안내 갱신은 세 브랜치 병합 뒤로 미뤘다(아래 「README 반영 제안」) |

## 검증 내역

### 최종 게이트 V3 (2026-10-31, HEAD `824459f`, Node v24.11.0)

V3 보고 기준이다. `frontend/`에서 실행했다. 무거운 명령은 다른 워크트리와 함께 쓰는 직렬화 래퍼(`heavy.sh`) 아래에서 하나씩 실행했다. `node_modules`가 이미 있어 `npm ci`는 생략했다.

| 순서 | 명령 | exit | 결과 |
|---|---|---|---|
| 1 | `node --version` | 0 | v24.11.0 |
| 2 | `npm run typecheck` | 0 | |
| 3 | `npm run lint` | 0 | |
| 4 | `npm run format:check` | 0 | |
| 5 | `npm run test -- --maxWorkers=2` | 0 | 162 files / 1842 tests 통과, 766.24초. `testTimeout`은 바꾸지 않았다 |
| 6 | `npm run build` | 0 | 세 보기 별도 청크(AC-A-02) |
| 7 | `STORYBOOK_E2E_PORT=6211 npm run test:storybook` | 0 | 117 통과(M8 play 12건과 index 검사 포함) |
| 8 | `E2E_PORT=5211 npx playwright test e2e/task-views.e2e.ts e2e/tasks-approval.e2e.ts` | 0 | 22 통과(9 + 13) |

- build·Storybook 빌드에는 생성 CSS의 `color: var(...)`에 대한 `Unexpected token Delim('.')` 경고가 있었고, Storybook에는 500kB 초과 청크 안내도 있었다. 모두 exit 0이며 V1에도 같은 경고가 기록돼 있다.
- V3는 `git diff --check develop...HEAD`(exit 0, 출력 없음)와 수정 3커밋의 diff 검토로 기존 URL·정책 보존을 확인했다.

### 전체 Vitest — 기본 설정과 `--maxWorkers=2`의 차이

이 기계에서 기본 설정의 `npm run test`(전역 한도 5초, 기본 워커 수)는 한 번에 통과하지 못했다. 병렬 부하로 이번 변경과 무관한 테스트가 타임아웃했다. 기본 설정 실행은 모두 V2 수정 3커밋 **전**이며, 최종 HEAD `824459f`에서는 실행하지 않았다. 일부 파일(`tasks.test.tsx`·`taskViews*.test.tsx`)은 파일 안에서 한도를 15초로 둔다.

| 실행 | 설정 | exit | 결과 |
|---|---|---|---|
| 구현 워커 1차 | 기본 | 1 | 31 실패 / 1805 통과, 1081초, 모두 5초 타임아웃 |
| 구현 워커 2차 | 기본 | 1 | 6 실패 / 1830 통과, 807초, 모두 타임아웃 |
| 구현 워커 3차 | `--testTimeout=20000 --maxWorkers=2` | 0 | 162 files / 1836 tests 통과, 674초. **한도도 바꾼 실행이라 게이트 근거로 쓰지 않는다** |
| V1 (HEAD `2a44c02`) | 기본 | 1 | 4 실패 / 1832 통과(158/162 files), 772.85초 |
| V3 (HEAD `824459f`) | `--maxWorkers=2`, 한도 그대로 | 0 | 162 files / 1842 tests 통과, 766.24초 |

- V1 실패 4건: `appShell.test.tsx` 「다른 마일스톤의 임시 화면도…」, `meetingProcessing.test.tsx` 「StrictMode 에서도…」, `scenarios.test.ts` 「시나리오끼리 독립적이다」는 5초 타임아웃이었다. `meetingUpload.test.tsx` 「정리 중 회의가 있으면…」은 `정리하고 있어요` 제목을 찾지 못했다(4349ms). V1은 단독 재실행을 하지 않아 부하 때문인지 결함인지 분류하지 못했다.
- 구현 워커 보고의 분류: 새 테스트 파일 세 개는 두 기본 실행의 실패 목록에 없었다. 2차 실패 6건 중 4건(`scenarios` 독립성, `tasks` 「PM 은 네 탭을 보고…」, `appShell`, `meetingProcessing`)은 기준 커밋 `ff9467e`의 `src/`로 단독 실행해도 같은 타임아웃으로 실패했다. 나머지(`router/pages`·`logout`, 1차의 `authFlow`·`lateAsyncRaces`·`onboardingMembers`·`router/guards` 등)는 단독 재실행에서 통과했다. `meetingUpload`는 현재 코드 단독에서 2건 실패하고 기준 커밋 단독에서는 통과했다고 보고했다. 이 화면은 이번 변경이 닿지 않는다. `scenarios` 독립성 테스트는 시나리오 쌍을 모두 비교하므로, `tasks-long-content` 추가로 비교 쌍이 31²→32²(약 6.6%) 늘었다.
- 위 기준 커밋 단독 실패는 구현 워커의 보고다. V1·V3는 기준 커밋을 다시 실행하지 않아 독립 재현하지 않았다.
- 따라서 기록할 수 있는 사실은 두 가지다. 한도를 바꾸지 않은 `--maxWorkers=2` 전체 실행이 최종 HEAD에서 exit 0이었다. 기본 설정 전체 실행은 수정 전 HEAD들에서 exit 1이었다. 기본 설정의 단독 통과를 전체 통과로 쓰지 않는다. 무관한 테스트의 한도·기대값과 저장소 설정은 고치지 않았다.

### 수정 전 검증 (구현 워커, Node v24.11.0)

V2 수정 3커밋 전의 기록이다. 최종 판정은 위 V3를 쓴다.

| 명령 | exit | 결과 |
|---|---|---|
| `npm run typecheck`·`npm run lint`·`npm run format:check` | 0 | |
| `npm run build` | 0 | BoardView 4.04kB · CalendarView 5.35kB · GanttView 9.36kB 별도 청크 |
| `npm run test:storybook` | 0 | 117 통과. E2E 축소 커밋 전에 실행했다(이후 소스 변경은 `task-views.e2e.ts` 축소뿐) |
| `E2E_PORT=5211 npm run test:e2e -- e2e/task-views.e2e.ts e2e/tasks-approval.e2e.ts e2e/dashboard.e2e.ts` | 0 | 26 통과 |

V1(HEAD `2a44c02`)에서는 typecheck·lint·format:check·build·`test:storybook`(117)·`task-views.e2e.ts`(9)가 모두 exit 0이었다.

### 너비 측정 (AC-A-03)

구현 워커가 Playwright로 측정했다(시계는 2026-09로 고정). 측정 스크립트 `zz-measure.e2e.ts`는 커밋하지 않았다.

| 경우 | 변경 전 | 변경 후 |
|---|---|---|
| 보드 `tasks-long-content` 1024px | 문서 가로 넘침 7px, 줄바꿈 불가 제목이 카드 밖(scroll 667 / client 297) | 넘침 0, 잘림 0 |
| 보드 long 1440·1920px | 카드 밖 넘침(667/321), 담당자 이름이 날짜와 겹침 | 잘림 0 |
| 캘린더 long 1024/1440/1920px | 격자 내용 1375/1663px이 `overflow-hidden`으로 잘림 | 격자 scroll = client, 잘림 0 |
| 간트 default 1024px | 막대 라벨 잘림 3 | 영역 928px 안에서 표 1262px 가로 스크롤, 잘림 1(1440px과 같음) |
| 간트 long 1024/1440px | 잘림 6/4, 긴 제목이 왼쪽 칸을 늘림 | 잘림 4/4(왼쪽 칸 말줄임은 별도), 칸 252px |
| 모든 보기·너비 | — | `documentElement.scrollWidth - clientWidth = 0` |

### 렌더 측정 (AC-A-04)

- **방식:** Vitest·jsdom에서 앱 라우트로 `?view=board|calendar|gantt`에 직접 진입했다. 상세 링크 `GuardedLink`를 mock으로 감싸 주소별 렌더 횟수를 셌다. 카드·칩·행마다 상세 링크가 하나라서 이 횟수가 반복 단위의 재렌더 수다. 데이터는 fixture의 `ws_01` 태스크 10건, 그리고 같은 fixture에 측정 태스크 300건(담당자·상태·날짜를 돌려 가며)을 더한 310건이다.
- **조작:** 세 가지를 순서대로 했다. 같은 데이터 재조회, `tk_01`을 `done`으로 바꾸는 끝나지 않는 상태 mutation(단일 태스크 상태 변경 overlay), 다른 공간(`ws_02`)의 상태 mutation이다. 조건마다 2회 실행했다. 측정 스크립트 `taskViewsRender.measure.test.tsx`와 원시 자료 `measure-premem.jsonl`(변경 전)·`measure-after.jsonl`(변경 후)은 구현 워커의 임시 폴더에 있고 커밋하지 않았다. V2·V3가 원시 자료 12행씩이 보고 수치와 일치함을 대조했다.

| 보기 | 10건: 다른 항목 재렌더 전 → 후 | 310건: 다른 항목 재렌더 전 → 후 | 대상 항목 |
|---|---|---|---|
| 보드 | 9 → 0 | 309 → 0 | 1회 |
| 캘린더 | 15 → 6 | 315 → 6 | 1회 |
| 간트 | 11 → 0 | 311 → 0 | 1회 |

- 캘린더에 남은 6회는 확인 필요·회의 칩의 링크이며, 태스크 수와 무관하다.
- 같은 데이터 재조회와 다른 공간 mutation은 변경 전에도 커밋 0이었다. 그래서 `useTaskStatusChange` 구독은 바꾸지 않았다.
- 이 수치는 링크 렌더 호출 수다. 전체 DOM 변경이나 보기 전체의 계산량이 0이라는 뜻은 아니다.
- React Profiler 시간은 jsdom과 기계 부하 때문에 같은 조건에서도 20~1188ms로 흔들려 근거로 쓰지 않았다(참고: 보드 310건 변경 전 565·1188ms, 후 151~352ms).
- 한계: 보고서는 변경 전을 「변경 전(HEAD)」이라고만 적었고, 원시 자료에 기준 커밋 해시가 없다. V2는 재현할 때 성능 커밋 `11fda7a`와 그 부모 `3f75acc`를 명시하라고 권했다. V3는 전후 측정을 다시 하지 않고 원시 자료 대조와 현재 회귀 테스트 실행만 했다.

### 수행하지 않은 검증

- 실제 서버의 태스크·확인 필요·팀원·회의 조회를 조합한 화면, 실제 서버의 권한·오류·데이터 규모에서의 동작: MSW로만 확인했다.
- 실제 Notion 반영 결과, M6에서 남긴 승인 보완·승인 조회 PM 제한: 이번 작업에서 다루지 않았다.
- 브라우저 네트워크 요청으로 본 코드 분리(AC-A-02): build 청크 관계와 통합 테스트로 대신했다.
- 계획 게이트의 `e2e/dashboard.e2e.ts`: 최종 HEAD에서는 실행하지 않았다. 수정 3커밋 전 구현 워커의 실행에서만 통과했다.
- 기본 설정의 전체 Vitest: 최종 HEAD에서 실행하지 않았다(위 절).

## 계획 대비 변경

- **E2E 범위 축소(`2a44c02`):** 사용자 지시(코디네이터 전달)로 E2E를 실제 브라우저에서만 잴 수 있는 너비별 배치·가로 스크롤 9건으로 줄였다. 계획은 AC-A-02에 「브라우저 요청 확인」을, AC-A-06에 세 보기 각각의 앱 E2E를 두었다. 대신 보기 모듈 요청은 `taskViewsCodeSplit.test.tsx`와 build 청크 확인으로 검증했다. 역할·확인 필요 미호출·상세 링크는 `taskViews.test.tsx`와 스토리로 검증했다.
- **V2 리뷰 FAIL과 수정 3커밋:** 구현 순서 3~7을 마친 HEAD `2a44c02`를 V2가 정적으로 검토해 FAIL(blocking 0, major 2, minor 1)을 냈다.
  - V2-01(major) — 태스크·확인 필요가 비면 받은 회의가 있어도 캘린더 전체를 빈 상태로 바꿨다. 이번에 넣은 빈 상태 분기가 만든 회귀다. 당시 새 테스트도 「격자가 없어야 한다」고 그 동작을 굳혀 두었다. `9c89891`이 캘린더의 전체 빈 상태 판정에 회의를 넣었고, 빈 응답 테스트는 회의도 지운 완전 빈 입력과 회의만 있는 입력으로 나눴다.
  - V2-02(major) — PM 확인 필요 조회가 실패하면 캘린더·간트가 실패를 성공한 빈 배열처럼 다뤘다. 그래서 상단 실패 안내와 함께 「이 달에는 마감인 일이 없어요」 같은 확정 문구가 나왔다. `e1618a5`가 고쳤다([합계 숨김 결정](basis-for-decision/2026-10-31-task-views-unconfirmed-approval-totals.md)).
  - V2-03(minor) — 렌더 회귀 테스트가 캘린더·간트의 변경 결과를 화면에서 확인하지 않았다. `824459f`가 단언을 더했다.
  - V3가 세 건의 해결을 확인하고 PASS를 냈다. V1은 수정 전 HEAD에서 기본 설정 전체 Vitest 실패(V1-01)를 기록하던 중, V3로 대체돼 중단됐다.
- **간트 담당자 묶음:** 팀원 목록에 없는 담당자(팀원 조회 실패 포함)의 일은 이제 `미지정`이 아니라 `알 수 없는 담당자` 묶음으로 간다. 전에는 삭제된 팀원의 일도 `미지정`에 섞였다. 기간 정책은 바꾸지 않았다.
- **간트 왼쪽 칸:** 원래 의도는 `truncate`였다. 그런데 flex 항목의 최소 폭 때문에 긴 제목이 칸을 늘려 막대와 어긋났다(스크린샷 확인). 그래서 `min-w-[0px]`로 252px을 유지한다.
- **최소 폭:** 계획 위험 2대로 공통 고정 폭을 두지 않았다. 간트에만 실측 근거로 날짜 칸 최소 48px을 둔다.
- **구독 최소화:** 계획 단계 6의 후보였던 `useTaskStatusChange`는 측정에서 이미 최소(다른 공간 mutation 커밋 0)라 바꾸지 않았다.
- **최종 게이트:** 계획의 게이트와 달라진 점이 셋 있다. `npm ci`는 생략했다(`node_modules` 존재). 전체 Vitest는 `--maxWorkers=2`로 실행했다. E2E는 `task-views`·`tasks-approval` 두 파일만 실행했고 `dashboard.e2e.ts`는 수정 전 실행에만 있다.
- **결과 문서 이름과 README:** 계획 단계 8은 `result.md`와 파트 README 갱신을 적었다. 세 이슈(#243·#244·#245)가 서로 다른 브랜치에서 같은 `m8/` 폴더에 쓰므로, 병합 충돌을 피하려고 이 파일 이름을 `result-a.md`로 했다. README 갱신은 세 브랜치 병합 뒤 한 번에 한다.
- **AC-A-01:** 계획 구현 순서 1~2(URL 결론·결정 기록·반영)는 사용자 결정 대기라 진행하지 않았다.

## 남은 작업과 제한 사항

- **AC-A-01 결정:** `?view=` 유지 또는 별도 경로 이동, 그리고 기존 `?view=` 링크 처리를 사용자가 정해야 한다. 결정에 따라 계획 구현 순서 1~2와 그 검증(URL Vitest, 직접 진입·새로고침·뒤로가기 E2E)이 남는다.
- **`queryView` 사본 교체:** #236에서 판정이 `shared`로 옮겨지면 `widgets/task-board/lib/taskViews.ts`의 사본을 그쪽으로 바꾼다([사본 결정](basis-for-decision/2026-10-31-task-views-queryview-copy.md)).
- **전체 Vitest 환경:** 이 기계의 기본 설정 전체 실행은 병렬 부하로 무관한 테스트가 타임아웃한다. 기준 커밋에서도 단독 실패한다고 보고된 테스트(`scenarios` 독립성, `tasks` 첫 PM 탭, `appShell`, `meetingProcessing`)는 이번 범위 밖의 별도 과제 후보다. `meetingUpload` 단독 실패(구현 워커 보고)도 원인을 확정하지 않았다.
- **미검증 연동 과제:** 실제 서버의 태스크·확인 필요·팀원·회의 조회 조합과 권한·오류·데이터 규모, 실제 Notion 반영, M6의 승인 보완·승인 조회 PM 제한. MSW 결과로 대신하지 않는다.
- **렌더 측정 재현성:** 원시 자료에 변경 전 커밋 해시가 없다. 다시 측정하면 `3f75acc`와 `11fda7a`를 명시한다.
- **제품 정책 미확정:** 보드 컬럼·상태 전이, 간트 기간, 캘린더 기준, 필터·정렬·페이지네이션, 상세 자동 오픈은 계획의 제외 범위다. 이번 회귀 확인은 정책 확정이 아니다.
- **문서:** [MSW 안내](../../msw-guide.md)에 `tasks-long-content` 시나리오가 아직 없다. 이번 쓰기 범위 밖이다.

## README 반영 제안

세 브랜치가 병합된 뒤 한 번에 반영할 문장 제안이다. 이 브랜치에서는 README를 수정하지 않았다. 아래 링크는 각 README 위치 기준이다.

[파트 README](../../../README.md)의 마일스톤 상태 문단:

```markdown
M8-A(#243)는 [계획](docs/plan/m8/plan.md) A 절의 구현 순서 3~7을 진행했고 [결과](docs/plan/m8/result-a.md)에 AC-A-02~AC-A-06의 프론트·MSW 기준 충족과 Node v24.11.0 최종 게이트 통과(전체 Vitest는 `--maxWorkers=2`, 2026-10-31)를 기록했다. AC-A-01(보기 URL 표현)은 사용자 결정 대기이고 실제 서버 조회 조합은 미검증 연동 과제다.
```

[마일스톤 안내](../README.md)의 M8 행 상태 칸:

```markdown
A(#243): [결과](m8/result-a.md) — AC-A-01 결정 대기, 완료 판정 없음
```

## 관련 기록

- [태스크 보기의 부분 조회 실패 방침](basis-for-decision/2026-10-31-task-views-partial-failure.md)
- [확인 필요 미조회 동안 합계를 숨기고 빈 기간을 확인된 범위로 말하는 선택](basis-for-decision/2026-10-31-task-views-unconfirmed-approval-totals.md)
- [`queryView` 판정을 task-board 안에 사본으로 두는 선택](basis-for-decision/2026-10-31-task-views-queryview-copy.md)
- [M7 결과](../m7/result.md): 대시보드의 영역별 실패 표시(AC-05)와 #236 분리([E-06](../m7/errors/E-06-m6-detail-refetch-error-hidden.md))
