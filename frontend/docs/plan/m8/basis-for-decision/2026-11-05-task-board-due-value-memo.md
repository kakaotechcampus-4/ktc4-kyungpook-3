# 태스크 보드의 `board` memo가 마감 조건을 값으로 비교하게 하는 선택

- 기록일: 2026-11-05
- 관련 작업: #391. 측정 근거는 #351의 [TaskBoard 파생 연산 기록](../../../performance/2026-11-05-taskboard-derived.md)이다.
- 관련 마일스톤: M8-A(#243)의 태스크 보기. M0~M8 계획 밖의 후속 수정이라 마일스톤 결과 문서에는 적지 않았다.

## 문제와 제약

- [TasksPage](../../../../src/pages/tasks/ui/TasksPage.tsx)는 렌더마다 `readBoardQuery(searchParams, isPm)`를 부른다. 이 함수는 마감 조건 `due`를 매번 새 배열로 만든다.
- [TaskBoard](../../../../src/widgets/task-board/ui/TaskBoard.tsx)의 `board` memo(`buildTaskBoard`, 리스트의 탭 개수와 정렬)는 `query.due`에 의존했다. 그래서 URL이 바뀔 때마다 다시 계산했다. 보기 전환, 캘린더 달 이동, 간트 주 이동이 모두 해당한다. 이 계산은 리스트 보기에서만 쓴다.
- #351 측정에서 2,000건 기준 한 번에 3.9~7.7ms였다.
- 저장소 lint는 `eslint-plugin-react-hooks`의 `exhaustive-deps`를 켜 둔다. 저장소에 이 규칙을 끄는 주석은 없다.

## 실제 검토한 선택지

이슈 #391에 적힌 두 방법이다.

1. `TasksPage`에서 `readBoardQuery` 결과를 `searchParams`에 묶어 memo한다.
2. `board`의 의존값을 `query.due.join(',')`처럼 값으로 비교되게 한다.

## 선택과 이유

2를 택했다. `TaskBoard`가 `dueParam = query.due.join(',')`를 의존값으로 쓴다. memo 안에서는 [taskBoard](../../../../src/widgets/task-board/lib/taskBoard.ts)의 `parseDue(dueParam)`로 조건 배열을 다시 만든다. `parseDue`는 `readBoardQuery`가 URL의 `due`를 읽을 때 쓰는 함수와 같다.

- **1은 그대로는 효과가 없다.** react-router 7.18의 `useSearchParams`는 `location.search`가 바뀔 때마다 새 `URLSearchParams`를 만든다(`node_modules/react-router/dist/development/chunk-HQO5H5CC.js`의 `useSearchParams`, `useMemo(..., [location.search])`). 보기 전환과 달·주 이동은 `location.search`를 바꾼다. `searchParams`에 묶은 memo도 그때마다 무효가 된다. 1이 효과를 내려면 `due`·`tab` 문자열을 따로 꺼내 의존값으로 써야 한다. 그러면 memo 안에서 쓰는 `searchParams`가 의존값에서 빠져 `exhaustive-deps`가 경고한다.
- **2는 lint를 끄지 않고 된다.** memo가 쓰는 값은 `dueParam` 문자열뿐이라 의존값과 본문이 맞는다. `useMemo(() => query.due, [dueParam])`처럼 배열을 그대로 붙잡는 방법은 `query.due`가 의존값에서 빠져 lint가 막는다.
- 문자열은 URL의 `due` 값과 같은 모양(`overdue,soon`)이다. 같은 파서를 지나므로 조건의 순서·중복 처리가 URL을 읽을 때와 같다.

## 장단점과 감수한 제약

- `board`를 다시 계산할 때마다 조건 셋 이하를 다시 거른다. 탭 개수·정렬 비용에 비하면 무시할 크기다(추정, 따로 재지 않음).
- `TaskBoard`는 여전히 렌더마다 새 `query` 객체를 받는다. `DueFilter`의 `value={query.due}` 같은 다른 사용처는 바뀌지 않았다.

## 검증

- [taskBoardRecompute.test.tsx](../../../../src/app/taskBoardRecompute.test.tsx)가 `buildTaskBoard` 호출을 센다.
  - 고치기 전 코드에서 URL만 바뀌는 세 경우가 실패했다. 캘린더 다음·이전 달, 간트 다음·이전 3주, 마감 조건을 건 채 캘린더 → 간트 → 보드다. 이동마다 1번씩, 경우마다 2번 불렸다.
  - 고친 뒤 세 경우 모두 0번이다.
  - 마감 조건·탭·정렬·담당자를 바꾸는 네 경우는 고치기 전후 모두 바뀐 조건으로 다시 계산했다.
- 화면 측정은 아래 「전후 측정」에 있다.

## 전후 측정

- 도구: #351의 [profile-nav.cjs](../../../performance/2026-11-05-taskboard-derived/profile-nav.cjs)를 고치지 않고 썼다. `VITE_ENABLE_MSW=true` 개발 서버 하나에 고치기 전(`HEAD`의 두 파일)과 후를 번갈아 넣었다. 순서는 전 → 후 → 전 → 후다. 한 번에 `SIZES=500,2000`, 3라운드다. 그래서 동작마다 전후 각 6개 표본이다. Chromium 153.0.8010.12, 2026-11-05. 측정 중 다른 워크트리 작업 4개가 같은 PC에서 돌았다.
- 값은 6개 표본의 최소~최대(ms)다. 「바쁜 시간」과 `buildTaskBoard` inclusive 시간의 정의는 #351 기록과 같다.

| 태스크 | 동작 | 전 `buildTaskBoard` | 후 `buildTaskBoard` | 전 바쁜 시간 | 후 바쁜 시간 |
|---|---|---|---|---|---|
| 2,000 | 캘린더 다음 달 | 2.1~3.2 | 0 | 332.7~372.0 | 244.4~342.5 |
| 2,000 | 캘린더 이전 달 | 1.5~3.0 | 0 | 275.4~322.2 | 219.5~281.7 |
| 2,000 | 캘린더 → 간트 | 2.2~3.1 | 0 | 680.0~858.6 | 429.3~803.6 |
| 2,000 | 간트 다음 3주 | 1.2~2.7 | 0 | 48.9~64.5 | 31.6~59.6 |
| 2,000 | 간트 이전 3주 | 0~2.3 | 0 | 126.6~136.7 | 112.5~136.9 |
| 2,000 | 간트 → 캘린더 | 1.7~2.8 | 0 | 357.9~465.4 | 349.1~537.4 |
| 500 | 캘린더 다음 달 | 0~0.9 | 0 | 47.8~190.6 | 49.2~165.9 |
| 500 | 캘린더 이전 달 | 0.5~1.0 | 0 | 67.1~225.3 | 47.8~165.7 |
| 500 | 캘린더 → 간트 | 0.6~1.3 | 0 | 139.3~220.8 | 101.1~200.1 |
| 500 | 간트 다음 3주 | 0.6~1.0 | 0 | 23.5~39.0 | 26.2~35.4 |
| 500 | 간트 이전 3주 | 0~0.7 | 0 | 29.1~133.1 | 27.6~147.6 |
| 500 | 간트 → 캘린더 | 0~1.6 | 0 | 105.3~219.3 | 61.3~161.2 |

- 고친 뒤에는 72개 표본 모두에서 `buildTaskBoard`가 프로파일에 나오지 않았다. 고치기 전에는 72개 중 63개에서 나왔다. 0인 표본은 #351 기록처럼 샘플이 그 함수에 걸리지 않은 것으로 본다. 위 테스트가 호출 0번을 따로 확인한다.
- 바쁜 시간은 전후 범위가 겹친다. 표본 사이 폭(수십~수백 ms)이 없앤 계산(1~3ms)보다 훨씬 크다. 그래서 바쁜 시간의 전후 차이를 이 변경의 효과로 읽지 않는다. 동작 비용의 대부분은 개발 빌드의 React 렌더다(#351 기록). 이 변경으로 줄어든다고 말할 수 있는 것은 이동마다 1~3ms(2,000건)인 `buildTaskBoard` 한 번이다.
- 결과 JSON과 번갈아 재는 스크립트는 작업 트리의 git 제외 경로 `frontend/.verify/perf/`에 두었다(커밋하지 않음).

## 영향 범위와 재검토 조건

- 영향: `TaskBoard`의 `board` memo 의존값, `taskBoard.ts`의 `parseDue`(새로 내보냄, `readBoardQuery`가 사용).
- 재검토: `BoardQuery.due`의 모양이 바뀌거나, 페이지가 조건 객체를 값이 같을 때 같은 참조로 넘기게 되면 이 우회는 필요 없다.
- #351 기록의 나머지 후보는 이 작업에 넣지 않았다. 보기별 memo 건너뛰기, 탭 개수 한 번에 세기, `soonUntil` 한 번만 계산하기다.
