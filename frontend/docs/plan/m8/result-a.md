# M8-A 구현 결과 — 태스크 보기(보드·간트·캘린더)

- 기록일: 2026-10-31, 디자인 차이 보완 2026-11-01, 검증 VR-A 반영 2026-11-01
- 대상: [M8 계획](plan.md) A 절, 이슈 #243. 구현 순서 3~7과 8(이 문서), 그리고 계획 밖 디자인 차이 보완(아래 「디자인 차이 보완」)
- 상태: (2026-11-01 검증 VR-A 반영 뒤 기준은 아래 「검증 VR-A 반영」) **AC-A-02~AC-A-06은 프론트·MSW 기준으로 충족했다. AC-A-01(보기 URL 표현)은 사용자 결정 대기라 미해결이다.** 브랜치 `feature/243-m8-task-views`(push·PR 전). 최종 게이트(2026-10-31, Node v24.11.0)는 모두 exit 0이었고, 디자인 차이 보완 뒤 게이트(2026-11-01)는 「디자인 차이 보완」의 검증 표에 따로 적었다. 다만 전체 Vitest는 기본 설정이 아닌 `--maxWorkers=2`로 통과했고, 기본 설정 실행은 실패 이력이 있다(아래 「전체 Vitest」). 실제 서버 연동은 검증하지 않았다. M8-A 완료나 M8 전체 완료를 선언하지 않는다.

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
- **테스트·스토리·MSW** — 통합 테스트는 [taskViews.test.tsx](../../../src/app/taskViews.test.tsx)(상태·역할·공간·상세 링크), [taskViewsCodeSplit.test.tsx](../../../src/app/taskViewsCodeSplit.test.tsx)(코드 분리), [taskViewsRender.test.tsx](../../../src/app/taskViewsRender.test.tsx)(렌더 횟수·변경 표시)이고, 디자인 차이 보완에서 [taskViewsCreate.test.tsx](../../../src/app/taskViewsCreate.test.tsx)(보드 직접 추가)를 더했다. 스토리는 [TaskViews.stories.tsx](../../../src/widgets/task-board/ui/TaskViews.stories.tsx) 12개(디자인 차이 보완 뒤 14개)로, [stories.sb.ts](../../../e2e/storybook/stories.sb.ts)가 play 회귀에 포함한다. 앱 E2E는 [task-views.e2e.ts](../../../e2e/task-views.e2e.ts) 9건이다. MSW 시나리오 `tasks-long-content`를 [scenarios.ts](../../../src/shared/mock/scenarios.ts)에 추가했다.
- **보존한 것** — `?view=` URL 해석(`readViewQuery`·`viewSearch`), 보드 세 컬럼과 상태 묶음, 상태 전이, 간트 21일과 막대 범위 계산, 캘린더 마감일·회의일 기준, 필터·정렬을 보존했다. `taskBoard.ts` 모델, `task-status` feature, `TasksPage`·라우터, `ApprovalCard`는 diff에 없다(V2·V3 확인).

## 디자인 차이 보완 (2026-11-01)

### 작업 근거

코디네이터가 보드·간트·캘린더를 시안([TasksBoard](../../design/canvas/TasksBoard.dc.html)·[TasksGantt](../../design/canvas/TasksGantt.dc.html)·[TasksCalendar](../../design/canvas/TasksCalendar.dc.html))과 비교해 차이를 찾았고, 사용자가 아래 1~3의 수정을 요청했다(코디네이터 전달). 계획 A 절의 구현 순서에 없는 작업이며, 계획 파일은 바꾸지 않았다. 보드 기간 필터 기본값은 시안(「이번 달」)과 달라도 「전체 기간」으로 유지하라는 사용자 결정이 있었다. 결정과 구현 워커의 기본값 선택은 [디자인 차이 보완 결정](basis-for-decision/2026-11-01-task-views-design-gaps.md)에 남겼다.

| 커밋 | 내용 |
|---|---|
| `1e76047` | 캘린더 격자가 그 달의 날이 든 주만 그린다. `calendarGrid`가 고정 42칸 대신 `(1일의 요일 + 그 달 일수)`를 7로 올림한 주 수만 만든다 |
| `dc6f9e9` | 보드 칸 아래 「직접 추가」. `entities/task`의 `createTask`(`POST /tasks`), `features/task-create`(`useTaskCreate`·`TaskQuickAdd`), 통합 테스트 `taskViewsCreate.test.tsx` |
| `1aad909` | 간트 「미지정」 묶음 보조 문구 한 줄, 「날짜 넣기」 크기·높이 |
| `320e35e` | 스토리 `보드_직접_추가`·`보드_직접_추가_실패` 추가, `캘린더_PM`·`간트_PM` play 단언 보강 |

### 시안 대비 차이와 조치

| 보기 | 시안 | 보완 전 | 보완 후 | 근거 |
|---|---|---|---|---|
| 보드 | 칸마다 맨 아래 점선 「직접 추가」(높이 38px, 1px 점선 `#BDBDBD`, 둥글기 12, 12px 600 `#666`, 14px 더하기 `#949494`) | 버튼 없음 | 같은 모양의 버튼(PM만). 누르면 그 자리에서 제목 입력이 펼쳐지고, 서버가 만든 뒤 그 칸 상태의 카드가 생긴다 | 1440px 스크린샷 비교, `taskViewsCreate.test.tsx` 9건, 스토리 2건 |
| 캘린더 | 2026-09는 5주(35칸). 10월 날만 있는 주가 없다 | 항상 6주(42칸) | 2026-09는 35칸, 6주가 필요한 2026-08은 42칸, 2026-02는 28칸 | 단위 테스트 3건, 스토리 `캘린더_PM`, Playwright 실측 gridcell 35·42 |
| 간트 | 「미지정 · 승인하면 담당자가 붙습니다 · N건」 한 줄 | 보조 문구가 두 줄(높이 38.5px = 줄 높이 19.25px × 2) | 한 줄(높이 19.25px) | Playwright 실측, 스토리 `간트_PM` |
| 간트 | 「날짜 넣기」 12.5px 600 `#171717`, 높이 32, 좌우 4px, 13px 꺾쇠 | 14px 600, 높이 24.5px, 패딩 0, 꺾쇠 있음 | 12.5px 600, 높이 32px, 좌우 4px, 꺾쇠 있음 | Playwright 실측, 스토리 `간트_PM` |

- **간트 보조 문구:** 시안 값(252px 칸, 좌우 14, 간격 9)에서 내용 폭은 223px이다. 아바타 20 + 「미지정」 34.1 + 문구 125.6 + 「2건」 16.6 + 간격 27 = 223.4px로 0.4px 모자라 줄이 바뀌었다(Chromium·NanumSquare 실측). 시안 HTML도 같은 브라우저에서는 두 줄로 그려진다. 문구 자간을 1%(`-0.01em`) 줄여 한 줄에 넣고, 건수가 길어 더 모자라면 줄바꿈 대신 말줄임한다.
- **날짜 넣기의 14px:** 기존 클래스 `text-control`이 글자 크기가 아니라 색(`--color-control`)으로만 생성된다(개발 서버 CSS 확인: `.text-control { color: var(--color-control) }`). 그래서 상속된 14px로 그려졌다. 이 링크는 `text-caption`(12.5px)으로 바꿨다. 같은 클래스를 쓰는 다른 곳(src 32곳)은 이번 범위 밖이라 그대로 두었다(아래 「남은 작업」).
- **굵기·아이콘:** 시안의 「날짜 넣기」는 600에 꺾쇠가 있다. 보완 전에도 600·꺾쇠였으므로 크기·높이·패딩만 바꿨다.

### 직접 추가의 동작 — MSW 기준

**실제 API로는 확인하지 않았다. 동작 근거는 MSW다.** 대표 계약 §2.6의 `POST /tasks`를 재사용했고 계약 문서는 바꾸지 않았다. 서버 코드(`backend/app/api/tasks.py`)는 PM 전용이라 버튼은 PM에게만 둔다.

- 칸별 상태: 시작 전 `todo`, 진행 중 `in_progress`, 완료 `done`. 본문은 `{workspace_id, title, status}`이고, 담당자 조건으로 걸러 보는 중이면 `assignee_member_id`를 더한다. `created_by`는 보내지 않는다.
- 서버 성공 뒤에만 반영한다. 돌려받은 태스크를 목록 캐시 끝에 넣고 목록을 다시 받는다. 응답 전에는 카드가 없다(테스트가 응답을 붙잡아 확인).
- 빈 제목·공백만 있는 제목은 보내지 않는다(「추가」 비활성). 같은 칸의 요청은 mutation 캐시로 세어 Enter·「추가」를 거듭 눌러도 한 번이다. 실패하면 입력을 남기고 칸 안에 `role="alert"` 「태스크를 추가하지 못했어요. …」를 보이며, 다시 보내 성공하면 닫힌다. Esc·「취소」는 보내지 않고 닫는다. Esc는 폼 어디서든(입력·취소·추가) 받고, 보내는 중에는 닫지 않는다. 닫히면 포커스가 「직접 추가」로 돌아온다. 입력 이름은 칸마다 다르다(「진행 중 새 태스크 제목」).
- MSW handler 권한: 검증 VR-09 반영(`c0080ce`)으로 서버와 같은 순서가 됐다. 인증(401) → 본문 검사(400) → 공간 존재(404) → 그 공간 PM(403) → 담당자·회의 소속 검사 순이고, 생성자는 본문 `created_by`가 아니라 세션 팀원(ws_01은 mb_01)이다. 세션 팀원 대응이 없는 공간(ws_02 등)의 생성은 PM이어도 403이다.
- 렌더: 다른 카드는 같은 태스크 객체를 받아 다시 그려지지 않는다(기존 `taskViewsRender.test.tsx` 통과, 아래 검증).

### 보완 뒤 검증 (2026-11-01, Node v24.11.0)

`frontend/`에서 HEAD `320e35e`(코드 4커밋 뒤)로 실행했다. 무거운 명령은 다른 워크트리와 함께 쓰는 직렬화 래퍼(`heavy.sh`) 아래에서 하나씩 실행했다.

| 명령 | exit | 결과 |
|---|---|---|
| `node --version` | 0 | v24.11.0 |
| `npm run typecheck` | 0 | |
| `npm run lint` | 0 | |
| `npm run format:check` | 0 | |
| 관련 파일 `npx vitest run src/app/taskViewsCreate.test.tsx src/app/taskViews.test.tsx src/app/taskViewsRender.test.tsx src/app/taskViewsCodeSplit.test.tsx src/widgets/task-board src/entities/task src/shared/mock/taskApprovalFlow.test.ts --maxWorkers=2` | 0 | 11 files / 196 tests 통과 |
| `npm run test -- --maxWorkers=2` | **1** | 163 files 중 4 실패 / 1849 tests 통과·4 실패, 2476.89초. 실패 4건은 모두 이번 변경이 닿지 않는 파일의 5초 타임아웃이다(아래) |
| `npm run build` | 0 | `BoardView` 7.04kB(직접 추가 포함, 이전 4.04kB)·`CalendarView` 5.44kB·`GanttView` 9.55kB 별도 청크 유지 |
| `STORYBOOK_E2E_PORT=6211 npm run test:storybook` | 0 | 119 통과(이전 117 + 새 스토리 2) |

- **전체 Vitest 실패 4건:** `appShell.test.tsx` 「다른 마일스톤의 임시 화면도…」, `meetingProcessing.test.tsx` 「StrictMode 에서도…」, `landing.test.tsx` 「`시작하기` 는 모두 로그인으로 간다…」, `scenarios.test.ts` 「시나리오끼리 독립적이다」. 실행 동안 다른 워크트리의 무거운 명령이 이어졌고 빈 메모리가 약 2~3GB였다.
- **단독 재실행(`--maxWorkers=1`):** `appShell`·`landing`은 통과했다. `meetingProcessing`·`scenarios`는 단독에서도 5초 타임아웃으로 실패했다. 이 둘은 위 「전체 Vitest」 절에서 기준 커밋 `ff9467e`에서도 단독 실패한다고 보고된 테스트다. 이번 변경은 MSW 시나리오·handler와 회의 처리 화면을 바꾸지 않았다. 무관한 테스트의 한도·기대값은 고치지 않았다.
- **중단된 첫 실행:** 첫 전체 Vitest는 하네스가 시스템 메모리 부족으로 셸을 중단시켰다. 남은 프로세스가 29 files만 마치고 끝나(3 실패, 모두 타임아웃) 근거로 쓰지 않는다. 다시 실행은 래퍼 대기 뒤 위 실행 하나다.
- build·Storybook 빌드의 `Unexpected token Delim('.')` 경고와 Storybook 500kB 초과 청크 안내는 이전 게이트와 같다.

- 디자인 비교: 개발 서버(5221, 이 워크트리)를 Playwright Chromium 1440px로 열어 시안 HTML과 나란히 캡처했다(`?view=board`, `?view=calendar&month=2026-09`, `?view=gantt&from=2026-09-07`). 캡처는 작업 폴더의 임시 파일이며 저장소에는 없다.
- 기존 단언 변경: `taskViews.test.ts`의 「캘린더 격자는 일요일부터 6주다」(42칸, 마지막 10/10)를 35칸·마지막 10/3으로 바꿨다. 사용자가 요청한 동작 변경이다. 나머지 기존 단언은 바꾸지 않았다.

### 시안과 아직 다른 점

- 보드 기간 필터 기본값: 시안 「이번 달」, 구현 「전체 기간」. **사용자 결정으로 유지한다.**
- 보드 완료 칸의 보조 문구: 시안 「최근 2주」, 구현 「최근 완료순」(기존 구현, 정책 미확정).
- 「직접 추가」를 누른 뒤의 입력 모양은 시안에 없다. 시안 카드 틀을 따른 구현 워커의 선택이다.

## 검증 VR-A 반영 (2026-11-01)

### 작업 근거

검증 에이전트가 HEAD `59932ec`를 검증해 FAIL(major 1·minor 11)을 냈다(보고서 VR-A, 코디네이터 작업 폴더의 임시 파일이며 저장소에는 없다). 코디네이터가 수정 대상과 방향을 정해 수정 워커에게 맡겼다. VR-04의 문구 유지와 링크 범위는 코디네이터 지시다. 발견마다 코드에서 원인을 다시 확인하고 그 결함을 잡는 테스트·스토리 play를 함께 더했다. 계획 파일은 바꾸지 않았다.

### 발견별 처리

| ID | 발견 | 처리 | 커밋 | 잡는 검증 |
|---|---|---|---|---|
| VR-10 (major) | 간트 주말 음영·오늘 선이 높이 0 | 수정. `tokens.css`가 `--spacing: initial`로 동적 간격을 꺼 `inset-0`·`top-0`·`bottom-0`이 생성되지 않았다(빌드 CSS에 없음을 확인). Modal과 같이 `inset-[0px]`·`top-[0px]`·`bottom-[0px]`으로 바꿨다. 1360px 실측: 층 높이 706.6px = 표 안쪽 높이 707px, 오늘 선 가운데 x 517.9 ↔ 머리의 18일 원 가운데 517.4 | `3e0e172` | 스토리 `간트_PM` play(실제 브라우저에서 선 높이·위치) |
| VR-02 | Esc가 입력에서만 닫힘 | 수정. Esc를 폼 `onKeyDown`으로 옮기고 보내는 중에는 무시한다. 닫히면 「직접 추가」로 포커스가 돌아온다 | `f009530`, `06220b3`(접근성 린트 예외와 까닭) | `taskViewsCreate.test.tsx` 「취소·추가에 포커스가 있어도 Esc」, 「보내는 동안」에 Esc 무시 단언 |
| VR-03 | 입력 포커스 표시 없음 | 수정. 장식형 TextField와 같은 방식([포커스 결정](../m2/basis-for-decision/2026-09-23-focus-outline-over-border.md))으로 폼이 `has-[input:focus-visible]` 때 테두리 위에 2px 먹 outline(-1px)을 겹친다. 입력 자체는 `outline-none` 그대로다. 취소·추가로 옮기면 폼 outline은 없어지고 버튼 자기 표시가 남는다(브라우저 확인) | `f009530` | 스토리 `보드_직접_추가` play(계산된 outline) |
| VR-12 | 같은 이름 컨트롤 | 수정. 입력 이름 `${칸} 새 태스크 제목`, 간트 링크 이름 `${제목} 날짜 넣기`(보이는 문구는 「날짜 넣기」 그대로) | `f009530`, `2673931` | `taskViewsCreate.test.tsx` 「두 칸을 함께 펼쳐도」, `taskViews.test.tsx` 날짜 넣기 링크 |
| VR-09 | MSW `POST /tasks` 권한·생성자 | 수정. 인증 → 본문 → 공간 존재 → `requirePm` → 소속 검사, 생성자는 세션 팀원 | `c0080ce`, `e5b6848`(전체 실행에서 찾은 기존 테스트 전제 정비) | `taskApprovalFlow.test.ts`(팀원 403·db 무변경, 비로그인 401, 세션 팀원 없는 공간 403, 본문 `created_by` 무시), `taskViewsCreate.test.tsx`(팀원 직접 POST 403·db 무변경). 새 단언 5건은 이전 handler에서 실패함을 확인했다 |
| VR-08 | grid/table 구조 누락 | 수정. 캘린더는 링크를 담은 읽기 전용 표라 `grid`(방향키 이동 필요)를 버리고 `table` + 요일 머리 `row`(columnheader 7) + 주마다 `row`(cell 7)로 했다. 보이는 배치는 바깥 7열 격자를 `grid-cols-subgrid` 줄로 잇는다. 간트는 머리 `row`(columnheader 4: 담당자 · 태스크 + 주 셋), 줄마다 `rowheader` + `cell`(`aria-colspan=3`). 날짜 숫자 줄은 눈금이라 `aria-hidden` | `dffe60b` | `taskViews.test.tsx` 「표 구조」 2건 |
| VR-04 | 날짜 넣기 목적지 | 부분 수정(지시 범위). 문구 유지, 확인 필요 행만 `paths.approval(공간, 승인)`으로 보낸다. 태스크 행은 태스크 상세 그대로이며 상세가 마감을 고칠 수 없는 한계는 「남은 작업」에 적었다. 캘린더의 확인 필요 칩·마감일 없음 링크는 이 발견 범위가 아니라 그대로 `?tab=needs_review`다 | `2673931` | `taskViews.test.tsx`(href와 실제 이동), 스토리 `간트_PM` |
| VR-05 | 보드 시안 값 | 수정. 보드만 블록 간격 22px(리스트 28·캘린더/간트 20 유지), 필터 `min-h-36`(리스트 시안도 같은 값이라 공용 트리거에 둠), 칸 머리 표식 둥글기 2px 네모·시작 전 1.5px 실선 `#BDBDBD`·완료 `#E8E8E8`, 완료 칸 제목 `#666`, 진행 중 칸 카드는 모두 `#C9C9C9` | `63cff0d` | 스토리 `보드_PM` play |
| VR-06 | 날짜 이동·`text-control` | 수정. 날짜 이동 30×36(`min-h-36`), 꺾쇠 15px `#5A5A5A`. 캘린더 「마감일 없음」은 `text-[13px]`로 적었다. `text-control` 전역 변경은 하지 않았다 | `5bdb3ec` | 스토리 `캘린더_PM` play |
| VR-07 | 간트 「일정이 없는 일」 | 수정. 목록 위 14px·간격 10, 제목 14px, 줄 간격 12·위아래 13·아래선 `#EFEFEF`, 「일정 없음」 21px·11px `#5A5A5A`, 일 제목 13.5px. 이름 없는 담당자 원은 채우지 않은 1px 점선 `#BDBDBD`·10px `#666` `?`(간트 묶음 머리·보드 카드에도 같이 적용) | `5bdb3ec` | 스토리 `간트_PM` play |
| VR-11 | 캘린더 칩 굵기·주말 숫자 | 수정. 마감 임박 칩 제목 600, 그 달의 일·토 숫자 `#666`(평일 `#5A5A5A`, 다른 달은 그대로 `#BDBDBD`) | `5bdb3ec` | 스토리 `캘린더_PM` play |
| VR-01 | 전체 Vitest 부하성 실패 | 코드 수정 대상이 아니다. 아래 검증 표의 전체 실행 결과로 기록한다 | — | — |

- 가정: 시작 전 칸의 위험·주의 카드는 시안에 예가 없어 지금처럼 강조 테두리로 둔다. 필터 높이 36px은 리스트 시안(`Tasks.dc.html`)도 같은 값이라 보드만이 아니라 공용 트리거에 뒀다.
- 시안의 1.5px 테두리는 Chromium이 기기 픽셀로 내려 1px로 계산한다(시안 HTML도 같은 브라우저에서 같다). 그래서 스토리는 표식 테두리의 모양·색·둥글기만 본다.
- E2E는 더하지 않았다. 오늘 선은 고정 시계가 필요한데 앱 E2E는 실제 날짜를 쓰므로, 실제 브라우저에서 재는 스토리 play로 대신했다.

### 기존 단언 변경과 그 까닭

- 캘린더 역할: `getByRole('grid'|'gridcell')`를 `table`·`cell`로 바꿨다(`tasks.test.tsx`, `taskViews.test.tsx`, `taskViewsCodeSplit.test.tsx`, `taskViewsRender.test.tsx`, `TaskViews.stories.tsx`, `e2e/task-views.e2e.ts`). VR-08로 역할이 바뀌었기 때문이며 칸 수·이름 단언은 그대로다.
- 직접 추가 입력 이름: `'새 태스크 제목'` → `'${칸} 새 태스크 제목'`(VR-12).
- 간트 링크 조회: `{ name: '날짜 넣기' }` → `'알림 문구 검토 날짜 넣기'`(VR-12)이고 목적지 단언을 더했다(VR-04).
- `taskApprovalFlow.test.ts`: 「생성은 version 1이고 연동된 공간에서만 pending」의 연동 안 된 경우를 ws_02 생성에서 ws_01 연동 해제 뒤 생성으로 바꿨다. 「세션 팀원 대응이 없는 공간의 쓰기」는 ws_02 태스크를 `POST`로 만들던 준비를 db 직접 추가로 바꾸고, 그 공간의 `POST`가 403인지를 더했다. 둘 다 VR-09로 세션 팀원이 없는 공간의 생성이 403이 되어 전제가 바뀌었기 때문이다. 「일반 팀원의 네 쓰기」는 생성을 더해 이름을 바꿨다.
- `entities/task/task.integration.test.ts`: 「다른 공간 팀원을 붙이면 WORKSPACE_MISMATCH」를 ws_02 생성에서, ws_02에 둔 팀원을 ws_01 생성에 붙이는 경우로 바꿨다. 서버처럼 PM 검사가 소속 검사보다 먼저라 ws_02 생성은 403이 되기 때문이다. 그 403도 단언으로 더했다. 이 파일은 아래 전체 실행에서 처음 실패해 찾았다.

### 반영 뒤 검증 (2026-11-01, Node v24.11.0)

`frontend/`에서 실행했다. 무거운 명령은 다른 워크트리와 함께 쓰는 직렬화 래퍼(`heavy.sh`) 아래에서 하나씩 실행했다. 한도·설정은 바꾸지 않았다.

| 명령 | exit | 결과 |
|---|---|---|
| `node --version` | 0 | v24.11.0 |
| `npm run typecheck` | 0 | 마지막 커밋 `e5b6848` 뒤에도 다시 실행해 0 |
| `npm run lint` | 0 | 처음 실행에서 폼 `onKeyDown`이 `jsx-a11y/no-noninteractive-element-interactions`에 걸려 까닭과 함께 예외를 적었다(`06220b3`). 그 뒤 전체 0 |
| `npm run format:check` | 0 | |
| `npm run build` | 0 | `BoardView` 7.25kB·`CalendarView` 5.87kB·`GanttView` 9.77kB·`viewParts` 5.21kB 별도 청크 유지. 빌드 CSS에 `inset-[0px]`·`top-[0px]`·`bottom-[0px]`·`border-(--color-dashed)`·`rounded-[2px]`·`grid-cols-subgrid`·`has-[input:focus-visible]:outline-2`가 생성됨을 확인. CSS 최적화 경고 1건(`.[color:var(...)]`)은 이전 게이트와 같다 |
| `STORYBOOK_E2E_PORT=6211 npm run test:storybook -- --workers=1` | 0 | 119 통과(2.7분). `보드_PM`·`보드_직접_추가`·`캘린더_PM`·`간트_PM` play의 새 실측 단언 포함. `--workers=1`은 메모리 제약 때문의 실행 인자다 |
| `E2E_PORT=5211 npx playwright test e2e/task-views.e2e.ts e2e/tasks-approval.e2e.ts --workers=1` | 0 | 22 통과(9 + 13). 캘린더 영역 조회를 `table`로 바꾼 뒤 |
| `npm run test -- --maxWorkers=2` (첫 시도) | — | 다른 워크트리의 Storybook 잠금을 기다리던 중 하네스가 메모리 부족으로 끊었다. 로그가 비어 있어 실행 전이었다 |
| `npm run test -- --maxWorkers=2` (다시 시도, HEAD `5bdb3ec`) | **1** | 163 files 중 162 통과, 1860 tests 중 1859 통과, 535초. 실패 1건은 부하가 아니라 VR-09로 바뀐 전제다: `task.integration.test.ts`가 ws_02 생성의 `WORKSPACE_MISMATCH`(400)를 기대했는데 PM 검사가 먼저라 403이 됐다 |
| `npx vitest run src/entities/task/task.integration.test.ts --maxWorkers=1` | 0 | 전제를 고친 뒤(`e5b6848`) 11/11 통과. 전체 실행은 지시대로 다시 돌리지 않았다 |

- 수정 중 파일 단독 실행: `taskViewsCreate.test.tsx`·`taskApprovalFlow.test.ts`(65 통과, 새 단언 5건은 이전 handler에서 실패 확인), `taskViews.test.tsx`·`taskViewsRender.test.tsx`·`taskViewsCodeSplit.test.tsx`·`tasks.test.tsx`(69 통과) 모두 0.
- 브라우저 실측: 이 워크트리 개발 서버(5211, MSW)를 자기 headless Chromium 하나로 1360px, 시계 2026-09-18 12:00 KST로 열어 위 표의 값을 쟀다(측정 스크립트는 작업 폴더의 임시 파일). 끝난 뒤 서버를 끄고 5211·6211에 LISTEN이 없음을 확인했다.
- 「직접 추가」의 「취소」·「추가」 글자는 공통 `Button` `sm`의 `text-control` 문제로 여전히 14px이다(「남은 작업」).

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
- **`text-control` 클래스:** 글자 크기 토큰 `--text-control`(13px)과 색 토큰 `--color-control`이 같은 이름이라 `text-control`이 색으로만 생성된다. 이 클래스를 쓰는 곳은 13px이 아니라 상속 크기로 그려진다. 이 화면에서는 간트 「날짜 넣기」와 캘린더 「마감일 없음」만 글자 크기를 직접 적어 고쳤다. 공통 `Button` `sm`(직접 추가의 「취소」·「추가」 포함)과 나머지 사용처(src, 테스트 제외 28줄)는 공통 컴포넌트에 걸려 별도 과제다.
- **직접 추가 실제 서버 확인:** `POST /tasks`의 실제 서버 응답·권한·Notion 반영은 확인하지 않았다. MSW handler의 권한·생성자 기록은 검증 VR-09 반영으로 서버 코드(`backend/app/api/tasks.py`)와 맞췄지만 실제 서버 실행으로 확인한 것은 아니다.
- **태스크 마감 편집 경로:** 간트 「일정이 없는 일」의 「날짜 넣기」는 시안 문구를 유지한다. 확인 필요는 승인 상세(보완·승인 화면)로 가지만, 태스크는 태스크 상세로 가며 상세는 상태 외 필드를 고칠 수 없어(`widgets/task-detail/ui/TaskDetail.tsx`는 마감을 표시만 한다) 그 자리에서 날짜를 넣을 수 없다. 태스크 마감 편집 기능은 별도 과제다.
- **`AttendeeRow`의 `inset-0`:** `widgets/meeting-minutes/ui/AttendeeRow.tsx`의 측정 상자도 생성되지 않는 `inset-0`을 쓴다(VR-10과 같은 원인). 회의록 화면이라 이번 범위 밖이며 실제 화면이 깨지는지는 확인하지 않았다. 별도 과제다.

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
- [태스크 보기의 디자인 차이 보완 — 보드 직접 추가와 기간 필터 기본값](basis-for-decision/2026-11-01-task-views-design-gaps.md)
- [M7 결과](../m7/result.md): 대시보드의 영역별 실패 표시(AC-05)와 #236 분리([E-06](../m7/errors/E-06-m6-detail-refetch-error-hidden.md))
