# TaskBoard 보기별 파생 연산과 탭 개수 집계 — 재 보니 체감할 수 없는 크기다

- 날짜: 2026-11-05
- 상태: 바꾸지 않음(#351). 측정 근거는 아래와 같고, 다시 잴 조건은 「고칠 때 확인할 것」에 둔다
- 영향 범위: 태스크 화면(`widgets/task-board/ui/TaskBoard.tsx`, `widgets/task-board/lib/taskBoard.ts`)

## 측정

### 무엇을 쟀나

`TaskBoard`는 보기와 관계없이 아래 파생값을 모두 `useMemo`로 만든다. 보기마다 실제로 읽는 값은 `TaskBoard.tsx`의 `body`와 `BoardTabs` 분기를 읽어 정했다.

| 파생값 | 하는 일 | 읽는 보기 |
|---|---|---|
| `names` | 팀원 ID → 이름 Map | 모두 |
| `meetingTitles` | 회의 ID → 제목 Map | 리스트 |
| `overlaid` | 진행 중인 상태 변경 겹치기 | 모두 |
| `filtered` | 담당자 거르기 | 리스트, 보드 |
| `board` (`buildTaskBoard`) | 고른 탭 목록 정렬과 탭 개수 | 리스트 |
| `createList` | 생성 승인만 고르기 | 캘린더, 간트 |
| `calendarMeetings` | 회의마다 `seoulDateOf`(`Intl.DateTimeFormat.formatToParts`) | 캘린더 |

이 memo들은 의존값이 바뀔 때만 다시 계산한다. 보기를 바꾸거나 캘린더의 달·간트의 주를 옮길 때는 다시 계산하지 않는다. 다시 계산하는 때는 화면 진입, 태스크·승인·회의 조회 결과가 바뀔 때, 담당자·탭·마감 조건·정렬을 바꿀 때, 보드에서 상태를 바꾸는 동안이다.

### 파생값 비용 (프로덕션 모양 번들, Chromium)

- 도구: [bench.ts](2026-11-05-taskboard-derived/bench.ts)를 esbuild로 minify한 IIFE 번들로 만들고(`NODE_ENV=production`, `import.meta.env.DEV=false`), Playwright의 headless Chromium 153.0.8010.12에서 돌렸다. 함수는 `frontend/src`의 지금 코드 그대로 쓴다.
- 데이터: 태스크 50 / 500 / 2,000건(상태 4가지 고르게, 마감 20% 없음, 서울 오늘 ±15~25일), 대기 승인은 태스크의 1/10, 회의는 1/5, 팀원은 픽스처 그대로. 시드를 고정했다.
- 조건: 마감 조건 없음(`plain`)과 `기한 지남 + 7일 안에 마감`(`dueFilter`) 두 가지. 정렬은 기본값 `due`, PM, 탭 `전체`.
- 반복: 한 표본이 50ms 이상이 되게 반복 수를 정하고, 15라운드를 매번 순서를 뒤집어 번갈아 쟀다. 값은 1회 계산의 중앙값이다. 같은 측정을 두 번 돌렸다(`baseline`, `rerun`). 측정 중 이 PC의 CPU 사용률은 다른 워크트리 작업으로 40~70%였다.

보기마다 지금 계산하는 것 전부에서 그 보기가 읽는 것만 뺀 차이, 곧 버리는 계산(ms)이다. 괄호 안은 두 번째 실행 값이다.

| 태스크 | 조건 | 지금 전부 | 리스트 | 보드 | 캘린더 | 간트 |
|---|---|---|---|---|---|---|
| 50 | plain | 0.06 (0.05) | 0.04 (0.03) | 0.06 (0.05) | 0.02 (0.02) | 0.06 (0.05) |
| 50 | dueFilter | 0.21 (0.16) | 0.06 (0.00) | 0.21 (0.16) | 0.18 (0.13) | 0.21 (0.16) |
| 500 | plain | 0.96 (1.04) | 0.31 (0.40) | 0.95 (1.04) | 0.70 (0.76) | 0.95 (1.04) |
| 500 | dueFilter | 1.78 (1.73) | 0.17 (0.24) | 1.78 (1.73) | 1.48 (1.48) | 1.78 (1.72) |
| 2,000 | plain | 5.28 (5.71) | 1.00 (1.72) | 5.27 (5.70) | 4.22 (4.56) | 5.27 (5.70) |
| 2,000 | dueFilter | 8.67 (7.77) | 1.79 (0.45) | 8.66 (7.76) | 7.38 (6.60) | 8.66 (7.76) |

- 버리는 계산의 대부분은 `board`다. 2,000건 plain에서 `board` 3.9~4.3ms 중 정렬(`boardItems`)이 3.7~4.1ms다. 정렬 비교 함수가 같은 마감끼리 `Date.parse`를 두 번 부른다.
- 탭 개수(`buildTaskBoard` − `boardItems`)는 마감 조건이 없으면 2,000건에서 0.16~0.17ms다. 마감 조건이 있으면 4.25~5.26ms로 커진다. `selectTab`이 탭마다 모든 태스크에 `matchesDue`를 다시 부르고, `soon` 판정이 태스크마다 `soonUntil(today)`로 `Date`를 만들기 때문이다. 이 값은 리스트 보기에서만 쓰여 버리는 계산이 아니다.
- `calendarMeetings`는 회의 400건에서 1.1~1.3ms다.

### 화면 전체에서의 비중 (개발 빌드, MSW)

- 도구: [e2e.cjs](2026-11-05-taskboard-derived/e2e.cjs), [profile.cjs](2026-11-05-taskboard-derived/profile.cjs). `VITE_ENABLE_MSW=true` 개발 서버에 `tasks-default` 시나리오로 들어간 뒤, 저장된 모의 db(`sessionStorage`의 `msw-db`)의 ws_01 태스크를 위와 같은 규칙으로 500건·2,000건으로 바꾼다.
- 보드 보기에서 담당자를 한 명으로 골랐다가 `담당자 전체`로 되돌리는 동작을 쟀다. 담당자를 바꾸면 위 memo들이 다시 계산되고, 보드 보기는 그중 `filtered`만 읽는다.

| 태스크 | Event Timing duration 중앙값 (범위) | 클릭부터 다음 두 프레임까지 중앙값 (범위) | 표본 |
|---|---|---|---|
| 500 | 88ms (64~144) | 567ms (250~1,396) | 10 |
| 2,000 | 160ms (64~296) | 1,018ms (537~1,337) | 10 |

같은 동작을 CPU 프로파일(샘플 간격 0.1ms)로 떴다. `buildTaskBoard`, `seoulDateOf`, `createApprovals`, `filterTasksByAssignee`, `withPendingStatus`의 inclusive 시간을 합하면 2,000건에서 동작 한 번에 0~1.5ms다. 같은 구간에 CPU가 바빴던 시간은 406~1,110ms다. 500건에서는 0~6.5ms 대 57~544ms다. 표본은 크기마다 6개다.

개발 빌드의 React는 프로덕션보다 느리므로 프로덕션에서는 이 비중이 더 크다(추정). 다만 위 표의 버리는 계산은 2,000건에서도 한 번에 5.3~8.7ms이고, 이는 한 프레임(16.7ms)보다 짧다. 이 값보다 더 줄일 수는 없다.

### 판정

현재 보기에 필요한 파생값만 계산하고 탭 개수를 한 번에 세도, 줄어드는 시간은 동작 한 번에 50건 0.2ms 이하, 500건 1~1.8ms, 2,000건 5.3~8.7ms다. 같은 동작의 화면 전체 비용 앞에서 사용자가 느낄 수 없는 크기라 코드를 바꾸지 않았다.

### 판단에 쓰지 않은 측정

- 같은 함수를 Vitest(jsdom 환경)와 Node 24.11.0의 `vm.runInThisContext`로 돌리면 Chromium보다 5~9배 느렸다. 예를 들어 2,000건 plain의 지금 전부는 Node에서 37.75ms였다. 같은 PC의 순수 Node 스크립트로 2,000건을 같은 비교 함수로 정렬하면 3ms 안팎이라, 하네스 쪽 원인으로 보고 있다(원인 미확인). 사용자가 쓰는 곳은 브라우저라 Chromium 수치만 판단에 썼다.
- 보드 진입 시간은 2,000건에서 약 41초, 간트 진입은 약 4초였다. 보드 진입 동안 CPU 프로파일의 self time은 모의 서버가 요청마다 db 전체(약 0.8MB)를 `sessionStorage`에 다시 쓰는 `setItem` 24.5초와 `saveDb` 3.3초가 차지했다. 모의 서버에만 있는 비용이라 화면 비용으로 보지 않았다.

### 함께 확인한 것: 막힌 카드마다 나가는 조회

보드 보기의 막힌 카드는 `useTaskAutoBlock`이 태스크마다 이력을 조회한다(`enabled: blocked`). 이력 조회는 태스크 상세도 확보한다. 태스크 500건(막힘 약 1/4)에서 간트에서 보드로 바꾸는 동안 `GET /api/v1/tasks/:id` 127회, `GET /api/v1/tasks/:id/history` 254회가 나갔다([reqs.cjs](2026-11-05-taskboard-derived/reqs.cjs)). 이력 요청이 상세 요청의 두 배인 까닭은 확인하지 않았다.

이 문제는 [#365](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/365)(태스크 응답에 자동 막힘 여부를 실어 보드의 이력 조회를 없애기)와 BE PR [#373](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/373)(`auto_blocked`)이 다룬다. 위 요청 수는 그 작업의 근거로 남긴다.

### 다시 재는 방법

`frontend/docs/performance/2026-11-05-taskboard-derived/`에서 실행한다. 결과 JSON은 [results/](2026-11-05-taskboard-derived/results/)에 있다.

```bash
sh build.sh /tmp/bench.js                      # 지금 코드로 번들
node run.cjs /tmp/bench.js out.json chromium 15 # 15라운드
node summarize.cjs out.json

# 개발 서버(다른 터미널): cd frontend && VITE_ENABLE_MSW=true npx vite --port 5291 --strictPort
node e2e.cjs http://localhost:5291 e2e.json 5
SIZES=500,2000 node profile.cjs http://localhost:5291 profile.json 3
node reqs.cjs http://localhost:5291 500
```

## 원인

보기와 무관하게 모든 파생값을 계산하는 것은 사실이다. 하지만 2,000건에서도 한 번에 수 ms라, 화면 비용은 파생값이 아니라 렌더(개발 빌드에서 동작 한 번에 수백 ms)가 정한다.

## 고칠 거리

지금은 고치지 않는다. 다시 잰 값이 아래 기준을 넘으면 이렇게 고친다.

- 보기에 필요 없는 memo는 계산 함수 안에서 보기를 보고 `null`이나 빈 배열을 돌려준다. Hook 호출 순서는 그대로다. 사용처는 위 표를 따른다.
- 탭 개수는 `selectTab`의 공통 부분(대기 승인, 마감 조건에 맞는 태스크)을 한 번 만들고 탭 나누기만 탭마다 한다. 목록과 개수가 같은 판정을 쓴다는 `taskBoard.ts`의 불변식이 그대로 유지된다.
- 마감 조건이 있을 때의 비용은 `soonUntil(today)`를 태스크마다 다시 계산하는 데서 온다. 한 번만 계산하면 탭 개수와 목록이 함께 줄어든다.

## 고칠 때 확인할 것

- 다시 잴 조건: 실제 워크스페이스의 태스크가 2,000건을 넘거나, 프로덕션 빌드에서 이 함수들이 한 동작의 한 프레임(16.7ms) 이상을 차지할 때.
- 회귀 위험: 보기 전환, 검색·필터, 담당자 필터, 탭 개수, 정렬 결과, 확인 필요 탭. `src/app/tasks.test.tsx`, `src/app/taskViews*.test.tsx`, `src/widgets/task-board/lib/taskBoard.test.ts`가 본다.
- 같은 측정 도구로 바꾸기 전후를 번갈아 잰다.
