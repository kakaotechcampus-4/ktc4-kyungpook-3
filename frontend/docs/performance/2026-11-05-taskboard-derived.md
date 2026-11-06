# TaskBoard 보기별 파생 연산과 탭 개수 집계 — 확인한 범위에서는 동작 비용의 몇 %라 코드 변경을 보류한다

- 날짜: 2026-11-05
- 상태: 코드 변경 보류(#351). 확인한 범위와 확인하지 못한 범위는 「판정」에, 다시 잴 조건은 「고칠 때 확인할 것」에 둔다
- 후속: 「고칠 거리」 첫 후보(`board` memo의 무효화)는 #391에서 반영했다(→ [plan/m8/basis-for-decision/2026-11-05-task-board-due-value-memo.md](../plan/m8/basis-for-decision/2026-11-05-task-board-due-value-memo.md)). 나머지 후보는 보류 그대로다
- 영향 범위: 태스크 화면(`pages/tasks/ui/TasksPage.tsx`, `widgets/task-board/ui/TaskBoard.tsx`, `widgets/task-board/lib/taskBoard.ts`)

## 측정

### 무엇을 쟀나

`TaskBoard`는 보기와 관계없이 아래 파생값을 모두 `useMemo`로 만든다. 보기마다 실제로 읽는 값은 `TaskBoard.tsx`의 `body`와 `BoardTabs` 분기를 읽어 정했다.

| 파생값 | 하는 일 | 의존값 | 읽는 보기 |
|---|---|---|---|
| `names` | 팀원 ID → 이름 Map | `members.data` | 모두 |
| `meetingTitles` | 회의 ID → 제목 Map | `meetings.data` | 리스트 |
| `overlaid` | 진행 중인 상태 변경 겹치기 | `tasks.data`, `pending` | 모두 |
| `filtered` | 담당자 거르기 | `overlaid`, `view.assignee` | 리스트, 보드 |
| `board` (`buildTaskBoard`) | 고른 탭 목록 정렬과 탭 개수 | `filtered`, `approvalList`, `query.due`, `query.tab`, `today`, `isPm`, `view.sort` | 리스트 |
| `createList` | 생성 승인만 고르기 | `approvalList` | 캘린더, 간트 |
| `calendarMeetings` | 회의마다 `seoulDateOf`(`Intl.DateTimeFormat.formatToParts`) | `meetings.data` | 캘린더 |

### 언제 다시 계산하나

- 화면에 들어올 때와 태스크·승인·회의·팀원 조회 결과가 바뀔 때는 그 결과에 기대는 memo가 다시 계산된다. 태스크가 바뀌면 `overlaid`, `filtered`, `board`가 다시 돈다.
- 보드에서 상태를 바꾸는 동안에는 `pending`이 바뀌어 `overlaid`, `filtered`, `board`가 다시 돈다.
- 담당자를 바꾸면 `filtered`와 `board`가 다시 돈다. `names`, `meetingTitles`, `overlaid`, `createList`, `calendarMeetings`는 다시 돌지 않는다.
- **URL이 바뀔 때마다 `board`가 다시 돈다.** `TasksPage.tsx:44`가 렌더마다 `readBoardQuery(searchParams, isPm)`를 부르고, 이 함수는 `taskBoard.ts:48`에서 `DUE_CONDITIONS.filter(...)`로 매번 새 `due` 배열을 만든다. `board`의 의존값 `query.due`가 매번 달라지므로, 보기 전환, 캘린더의 달 이동, 간트의 주 이동, 기간·정렬·탭 변경 모두 `buildTaskBoard`를 다시 부른다. 이 계산은 리스트 보기에서만 쓰인다. 나머지 memo는 URL 변경으로는 다시 돌지 않는다.

URL 경로는 실제 앱으로 확인했다. 임시 Vitest(`renderApp`으로 `?view=calendar&month=2026-09`에 들어가 `buildTaskBoard`를 `vi.fn`으로 감쌈, 커밋하지 않음)에서 `다음 달`, `캘린더 → 간트`, `간트 → 보드`가 각각 `buildTaskBoard`를 1번씩 더 불렀다.

### 파생값 비용 (프로덕션 모양 번들, Chromium)

- 도구: [bench.ts](2026-11-05-taskboard-derived/bench.ts)를 esbuild로 minify한 IIFE 번들로 만들고(`NODE_ENV=production`, `import.meta.env.DEV=false`), Playwright의 headless Chromium 153.0.8010.12에서 돌렸다. 함수는 `frontend/src`의 지금 코드 그대로 쓴다.
- 데이터: 태스크 50 / 500 / 2,000건(상태 4가지 고르게, 마감 20% 없음, 서울 오늘 ±15~25일), 대기 승인은 태스크의 1/10, 회의는 1/5, 팀원은 픽스처 그대로. 시드를 고정했다.
- 조건: 마감 조건 없음(`plain`)과 `기한 지남 + 7일 안에 마감`(`dueFilter`) 두 가지. 정렬은 기본값 `due`, PM, 탭 `전체`, 담당자 전체, 진행 중인 상태 변경 없음.
- 반복: 한 표본이 50ms 이상이 되게 반복 수를 정하고, 15라운드를 매번 순서를 뒤집어 번갈아 쟀다. 값은 15개 표본의 중앙값(8번째 값)이고 1회 계산 시간이다. 같은 측정을 두 번 돌렸다(`baseline`, `rerun`). 측정 중 이 PC의 CPU 사용률은 다른 워크트리 작업으로 40~70%였다.

모든 memo가 다시 계산될 때(화면 진입, 태스크 변경) 보기마다 버리는 계산(ms)이다. 지금 계산하는 것 전부에서 그 보기가 읽는 것만 뺐다. 괄호 안은 두 번째 실행 값이다.

| 태스크 | 조건 | 지금 전부 | 리스트 | 보드 | 캘린더 | 간트 |
|---|---|---|---|---|---|---|
| 50 | plain | 0.06 (0.05) | 0.04 (0.03) | 0.06 (0.05) | 0.02 (0.02) | 0.06 (0.05) |
| 50 | dueFilter | 0.21 (0.16) | 0.06 (0.00) | 0.21 (0.16) | 0.18 (0.13) | 0.21 (0.16) |
| 500 | plain | 0.96 (1.04) | 0.31 (0.40) | 0.95 (1.04) | 0.70 (0.76) | 0.95 (1.04) |
| 500 | dueFilter | 1.78 (1.73) | 0.17 (0.24) | 1.78 (1.73) | 1.48 (1.48) | 1.78 (1.72) |
| 2,000 | plain | 5.28 (5.71) | 1.00 (1.72) | 5.27 (5.70) | 4.22 (4.56) | 5.27 (5.70) |
| 2,000 | dueFilter | 8.67 (7.77) | 1.79 (0.45) | 8.66 (7.76) | 7.38 (6.60) | 8.66 (7.76) |

URL 변경 때는 `board` 하나만 다시 돈다. 보드·캘린더·간트에서 그때 버리는 계산은 `board`의 비용이다.

| 태스크 | plain | dueFilter |
|---|---|---|
| 50 | 0.02 (0.02) | 0.15 (0.15) |
| 500 | 0.67 (0.64) | 1.65 (1.53) |
| 2,000 | 4.25 (3.91) | 7.69 (6.85) |

- 버리는 계산의 대부분은 `board`다. 2,000건 plain에서 `board` 3.9~4.3ms 중 정렬(`boardItems`)이 3.7~4.1ms다. 정렬 비교 함수가 같은 마감끼리 `Date.parse`를 두 번 부른다.
- 탭 개수(`buildTaskBoard` − `boardItems`)는 마감 조건이 없으면 2,000건에서 0.16~0.17ms다. 마감 조건이 있으면 4.25~5.26ms로 커진다. `selectTab`이 탭마다 모든 태스크에 `matchesDue`를 다시 부르고, `soon` 판정이 태스크마다 `soonUntil(today)`로 `Date`를 만들기 때문이다.
- `calendarMeetings`는 회의 400건에서 1.1~1.3ms다.

### 화면 동작에서의 비중 (개발 빌드, MSW)

- 도구: [e2e.cjs](2026-11-05-taskboard-derived/e2e.cjs), [profile.cjs](2026-11-05-taskboard-derived/profile.cjs), [profile-nav.cjs](2026-11-05-taskboard-derived/profile-nav.cjs). `VITE_ENABLE_MSW=true` 개발 서버에 `tasks-default` 시나리오로 들어간 뒤, 저장된 모의 db(`sessionStorage`의 `msw-db`)의 ws_01 태스크를 위와 같은 규칙으로 500건·2,000건으로 바꾼다. 마감 조건은 걸지 않았다.
- 프로파일은 CDP `Profiler`(샘플 간격 0.1ms)로 떴다. 「바쁜 시간」은 idle과 `(program)`을 뺀 샘플 시간의 합이다. 「파생 함수」는 `buildTaskBoard`, `seoulDateOf`, `createApprovals`, `filterTasksByAssignee`, `withPendingStatus`의 inclusive 시간 합이다. 범위는 동작마다 3회 표본의 최소~최대다.

보드에서 담당자를 한 명으로 골랐다가 `담당자 전체`로 되돌리는 동작이다. 중앙값은 10개 표본의 가운데 두 값의 평균이다.

| 태스크 | Event Timing duration 중앙값 (범위) | 클릭부터 다음 두 프레임까지 중앙값 (범위) |
|---|---|---|
| 500 | 88ms (64~144) | 557.3ms (250~1,396) |
| 2,000 | 144ms (64~296) | 844.5ms (537~1,337) |

| 동작 | 500건 바쁜 시간 / 파생 함수 | 2,000건 바쁜 시간 / 파생 함수 |
|---|---|---|
| 보드 담당자 바꾸기 (6회) | 57~544ms / 0~6.5ms | 406~1,110ms / 0~1.5ms |
| 캘린더 다음 달 | 59~169ms / 0.5~1.4ms | 349~382ms / 2.1~2.6ms |
| 캘린더 이전 달 | 171~213ms / 0.5~1.0ms | 308~344ms / 2.5~3.2ms |
| 캘린더 → 간트 | 186~227ms / 0.6~0.7ms | 735~866ms / 2.5~2.6ms |
| 간트 다음 3주 | 27~34ms / 0.5~1.2ms | 53~68ms / 2.5~3.1ms |
| 간트 이전 3주 | 70~127ms / 0~0.9ms | 108~133ms / 0~2.4ms |
| 간트 → 캘린더 | 171~224ms / 0~0.6ms | 425~469ms / 2.5~2.6ms |

달·주 이동과 보기 전환에서 파생 함수 시간은 모두 `buildTaskBoard`였다. 비중이 가장 큰 동작은 2,000건의 간트 다음 3주로, 바쁜 시간 53~68ms 중 2.5~3.1ms(약 4~5%)다. 몇몇 표본의 0ms는 프로파일 샘플이 그 함수에 걸리지 않은 것이다. 위 Vitest 확인에서 이동마다 `buildTaskBoard`가 불렸다.

### 판정

확인한 범위는 두 가지다.

1. 프로덕션 모양 번들에서 잰 파생값의 독립 비용. 모든 memo가 다시 돌 때 보드·간트에서 버리는 계산은 2,000건에서 5.3~8.7ms, 500건에서 1~1.8ms다. URL이 바뀔 때마다 다시 도는 `board`는 2,000건에서 3.9~7.7ms다.
2. 개발 빌드 화면에서 파생 함수가 동작 CPU 시간에서 차지하는 비중. 담당자 바꾸기, 달·주 이동, 보기 전환에서 최대 약 5%(2,000건 간트 다음 3주)였다.

이 범위에서는 파생 계산이 동작 비용의 작은 부분이라, 이번 PR에서는 코드 변경을 보류한다. 프로덕션 빌드 화면에서 이 계산을 없앤 효과는 재지 않았다. MSW가 개발 서버에서만 켜져 프로덕션 빌드에 같은 데이터를 넣을 수 없었다. 프로덕션의 React 렌더는 개발 빌드보다 빨라 비중이 더 클 수 있다(추정). 한 동작의 다른 작업과 합쳐 프레임 예산(16.7ms)을 넘는지는 이 계산의 크기만으로 정할 수 없다. 그래서 「체감할 수 없다」고 단정하지 않는다.

### 판단에 쓰지 않은 측정

- 같은 함수를 Vitest(jsdom 환경)와 Node 24.11.0의 `vm.runInThisContext`로 돌리면 Chromium보다 5~9배 느렸다. 예를 들어 2,000건 plain의 지금 전부는 Node에서 37.75ms였다. 같은 PC의 순수 Node 스크립트로 2,000건을 같은 비교 함수로 정렬하면 3ms 안팎이라, 하네스 쪽 원인으로 보고 있다(원인 미확인). 사용자가 쓰는 곳은 브라우저라 Chromium 수치만 판단에 썼다.
- 보드 진입 시간은 2,000건에서 약 41초, 간트 진입은 약 4초였다. 보드 진입 동안 CPU 프로파일의 self time은 모의 서버가 요청마다 db 전체(약 0.8MB)를 `sessionStorage`에 다시 쓰는 `setItem` 24.5초와 `saveDb` 3.3초가 차지했다. 모의 서버에만 있는 비용이라 화면 비용으로 보지 않았다.

### 함께 확인한 것: 막힌 카드마다 나가는 조회

보드 보기의 막힌 카드는 `useTaskAutoBlock`이 태스크마다 이력을 조회한다(`enabled: blocked`). 이력 조회는 태스크 상세도 확보한다. 태스크 500건(막힘 약 1/4)에서 간트에서 보드로 바꾸는 동안 `GET /api/v1/tasks/:id` 127회, `GET /api/v1/tasks/:id/history` 254회가 나갔다([reqs.cjs](2026-11-05-taskboard-derived/reqs.cjs)). 이력 요청이 상세 요청의 두 배인 까닭은 확인하지 않았다.

이 문제는 [#365](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/365)(태스크 응답에 자동 막힘 여부를 실어 보드의 이력 조회를 없애기)와 BE PR [#373](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/373)(`auto_blocked`)이 다룬다. 위 요청 수는 그 작업의 근거로 남긴다.

후속(#365로 해소, 2026-11-06): 보드와 상세가 이력 대신 태스크 응답의 `auto_blocked` 로 자동 막힘을 가린다. 막힌 카드마다 나가던 단건·이력 조회가 없어졌다. [taskAutoBlock.test.tsx](../../src/app/taskAutoBlock.test.tsx)의 「막힌 카드가 여럿이어도 카드마다 태스크·이력을 따로 받지 않는다」가 막힌 카드 셋(자동 막힘 둘, 사람의 막힘 하나)인 보드에서 태스크 목록 조회 한 번과 단건·이력 조회 0회를 확인한다. 500건 조건의 `reqs.cjs` 는 다시 재지 않았다.

### 다시 재는 방법

측정 명령은 `frontend/docs/performance/2026-11-05-taskboard-derived/`에서 실행한다. 결과 JSON은 [results/](2026-11-05-taskboard-derived/results/)에 있다.

```bash
sh build.sh /tmp/bench.js                      # 지금 코드로 번들
node run.cjs /tmp/bench.js out.json chromium 15 # 15라운드
node summarize.cjs out.json
```

화면 측정은 개발 서버가 필요하다. 다른 터미널에서 저장소 루트를 기준으로 개발 서버를 띄운다.

```bash
cd frontend && VITE_ENABLE_MSW=true npx vite --port 5291 --strictPort
```

그다음 다시 도구 폴더에서 실행한다.

```bash
node e2e.cjs http://localhost:5291 e2e.json 5
SIZES=500,2000 node profile.cjs http://localhost:5291 profile.json 3
SIZES=500,2000 node profile-nav.cjs http://localhost:5291 profile-nav.json 3
node reqs.cjs http://localhost:5291 500
```

## 원인

보기와 무관하게 모든 파생값을 계산하는 것은 사실이다. 그중 `board`는 `query.due`가 렌더마다 새 배열이라 URL이 바뀔 때마다 다시 돈다. 2,000건에서도 한 번에 수 ms이고, 개발 빌드 화면에서는 동작 비용의 대부분을 렌더가 차지했다.

## 고칠 거리

이번 PR에서는 코드를 바꾸지 않는다. 고친다면 아래 후보가 있다. 비용이 작은 순서다.

- **`board` memo의 무효화.** (반영됨, #391) `query.due`가 렌더마다 새 배열이라 URL이 바뀔 때마다 `buildTaskBoard`가 다시 돈다. `TasksPage`에서 `readBoardQuery` 결과를 `searchParams`에 묶어 memo하거나, `board`의 의존값을 `query.due.join(',')`처럼 값으로 비교되게 하면 보기 전환과 달·주 이동에서는 다시 돌지 않는다. 이것만으로 URL 변경 때 버리는 계산(2,000건 3.9~7.7ms)이 없어진다.
- **보기에 필요 없는 memo 건너뛰기.** 계산 함수 안에서 보기를 보고 `null`이나 빈 배열을 돌려준다. Hook 호출 순서는 그대로다. 사용처는 위 표를 따른다.
- **탭 개수를 한 번에 세기.** `selectTab`의 공통 부분(대기 승인, 마감 조건에 맞는 태스크)을 한 번 만들고 탭 나누기만 탭마다 한다. 목록과 개수가 같은 판정을 쓴다는 `taskBoard.ts`의 불변식이 그대로 유지된다.
- **`soonUntil(today)` 한 번만 계산하기.** 마감 조건이 있을 때의 비용이 여기서 온다. 탭 개수와 목록이 함께 줄어든다.

## 고칠 때 확인할 것

- 다시 잴 조건: 실제 워크스페이스의 태스크가 수천 건에 이르거나, 프로덕션 빌드 화면에서 보기 전환·달·주 이동이 느리다는 보고가 있을 때. 프로덕션 화면 비중을 재려면 실제 API나 프로덕션 빌드에 대량 데이터를 넣을 방법이 먼저 필요하다.
- 회귀 위험: 보기 전환, 검색·필터, 담당자 필터, 탭 개수, 정렬 결과, 확인 필요 탭. `src/app/tasks.test.tsx`, `src/app/taskViews*.test.tsx`, `src/widgets/task-board/lib/taskBoard.test.ts`가 본다.
- 같은 측정 도구로 바꾸기 전후를 번갈아 잰다.
