# M8 실행 계획

- 작성일: 2026-10-30
- 작성 근거: 이슈 #243·#244·#245, 앞서 제시한 M8-A 초안과 사용자의 반영 승인, 2026-10-30 B·C 사용자 답변. 2026-11-02 세 브랜치에서 따로 쓴 절을 이 파일 하나로 합쳤다(아래 「작성 내역」).
- 상태: A·B·C 모두 실행 계획이며 구현·검증 완료를 뜻하지 않는다. 구현·검증 결과는 각 결과 문서([A](result-a.md)·[B](result-b.md)·[C](result-c.md))에 있다.
- 완료 기준: A는 프론트엔드 구현과 MSW 검증으로 판정한다. 실제 서버·외부 서비스 연동은 별도 미검증 과제로 기록하며 M8 전체 완료로 확대하지 않는다.

## 공통 범위와 진행 방식

### 이슈·브랜치·워크트리 대응

| 절 | 이슈 | 브랜치 | 워크트리 |
|---|---|---|---|
| A. 태스크 보기(보드·간트·캘린더) | #243 | `feature/243-m8-task-views` | `C:/Users/jhcho/orca/workspaces/ktc4-kyungpook-3/feature-243-m8-task-views` |
| B. 설정·팀 연결 관리 | #244 | `feature/244-m8-settings-team` | `C:/Users/jhcho/orca/workspaces/ktc4-kyungpook-3/feature-244-m8-settings-team` |
| C. 메시지 | #245 | `feature/245-m8-messages` | `C:/Users/jhcho/orca/workspaces/ktc4-kyungpook-3/feature-245-m8-messages` |

[전체 계획](../frontend-plan.md) M8과 [제품·기술 결정](../../decision/frontend-decisions.md)을 참조한다. 전체 계획과 사람이 관리하는 trouble-shooting 문서는 수정하지 않는다. 이슈 본문은 이번 문서 작성에서 변경하지 않는다.

### 브랜치 충돌 방지

세 워크트리가 같은 `m8/plan.md`를 수정하므로 병합 충돌 위험이 있다. 다음 순서를 따른다.

1. `plan.md`의 A/B/C 절 틀은 #243 브랜치가 만든다. 이 브랜치를 먼저 PR로 `develop`에 병합한다.
2. B·C 브랜치는 그 병합 뒤 `develop`을 가져와 자기 절만 수정한다. 그 전에는 B·C 워크트리에서 `plan.md`를 고치지 않는다.
3. 결정 대기가 풀리기 전까지 B·C는 자기 절의 상태 표기와 열린 질문만 갱신한다. AC와 구현 순서는 만들지 않는다.

위 내용은 후속 작업의 진행 원칙이며, PR 생성·병합이 이미 이루어졌다는 기록이 아니다.

실제 진행(2026-11-02): 세 브랜치가 병합 전에 같은 파일의 각자 절을 함께 썼다. 그래서 위 순서 대신 세 절을 이 파일 하나로 합쳐 기능 PR보다 먼저 별도 PR로 `develop`에 병합하고, 세 기능 PR에는 `plan.md`를 넣지 않는다.

## A. 태스크 보기(보드·간트·캘린더)

- 대상: 이슈 #243, M8-A.

### 목표와 배경

이미 구현된 보드·간트·캘린더를 [전체 계획](../frontend-plan.md) M8의 동적 import, 콘텐츠 영역 안 가로 스크롤, 반복 렌더 비용 관리 요건에 맞춘다. 이슈 #243의 현재 상태와 세부 작업을 범위 기준으로 삼는다.

[M6 계획](../m6/plan.md)은 세 보기를 제외 범위로 두었지만, 목록 UI 개편 커밋 `1a5f0d9`에서 `widgets/task-board`에 추가됐다. [M6 결정 기록](../m6/basis-for-decision/2026-10-11-task-list-approval-section.md)은 사용자가 새 보기와 확인 필요 카드를 유지하도록 지시했고, 기존 M6 완료조건을 현재 목록 화면에 맞춰 다시 검증한 경위를 기록한다.

[M6 결과](../m6/result.md)의 너비 검증 대상은 리스트·태스크 상세·확인 필요 상세다. 보드·간트·캘린더의 M8 요건을 검증한 기록은 아니다. 이번 작업은 세 보기를 새로 만드는 계획이 아니라, 기존 구현과 M8 요구의 차이를 보완하는 계획이다.

### 현재 상태

2026-10-30 작업 트리의 정적 코드 확인 결과다. 현재 구현을 제품 정책의 확정 근거로 간주하지 않는다. 아래 테스트 설명은 코드의 검증 범위이며 이번 문서 작성에서 테스트를 실행했다는 뜻이 아니다.

#### 보기 전환과 코드 분리

- [TasksPage](../../../src/pages/tasks/ui/TasksPage.tsx)는 `/workspaces/:workspaceId/tasks`에서 URL을 해석한다.
- [taskViews](../../../src/widgets/task-board/lib/taskViews.ts)는 `?view=list|board|calendar|gantt`를 사용한다. 기본 `list`는 URL에서 생략하고, 알 수 없는 값은 `list`로 해석한다.
- `viewSearch`는 보기 관련 파라미터를 갱신하면서 기존 `tab`·`due` 등 다른 파라미터를 보존한다. [ViewControls](../../../src/widgets/task-board/ui/ViewControls.tsx)의 보기 전환은 이 흐름으로 연결된다.
- [라우트](../../../src/app/router/routes.tsx)는 `TasksPage`와 태스크 상세를 각각 지연 로드한다. [lazyPage](../../../src/app/router/lazyPage.tsx)는 `React.lazy`·`Suspense`·페이지 스켈레톤을 사용한다.
- [TaskBoard](../../../src/widgets/task-board/ui/TaskBoard.tsx)는 `BoardView`·`GanttView`·`CalendarView`를 모두 정적 import한다. 페이지 단위 분리는 있지만 보기별 분리는 없다.
- [결정 문서](../../decision/frontend-decisions.md)의 D-132 문구는 “별도 경로로 표현된 보기 종류는 URL 파라미터에 중복하지 않는다”이다. 현재 파일에는 독립 D-132 절 없이 결정 요약에 원문이 남아 있다. 전체 계획 M8은 보기 종류를 별도 경로로 표현한다고 명시한다. 현재 구현과 어느 쪽이 의도인지 **확인 필요**다.

#### 너비와 가로 스크롤

- 세 보기의 `main`은 최대 1360px, 좌우 패딩은 각각 48px이다.
- 보드 안쪽 컬럼은 최대 1000px이고, 간트·캘린더는 안쪽 전체 폭을 사용한다.
- `widgets/task-board`에 `overflow-x` 처리는 없다. 간트 표와 캘린더 격자에는 `overflow-hidden`이 있다.
- 간트는 라벨 영역 252px과 21개의 `minmax(0, 1fr)` 날짜 열을 사용한다. 캘린더는 7열 격자다. 두 보기 모두 읽기 가능한 최소 콘텐츠 폭을 별도로 지정하지 않는다.

[TaskBoard](../../../src/widgets/task-board/ui/TaskBoard.tsx)와 [폭 토큰](../../../src/app/styles/tokens.css)으로 계산한 가용 폭은 다음과 같다.

| viewport | `main` 폭 | 간트·캘린더에 배정되는 본문 폭 |
|---|---:|---:|
| 1024px | 1024px | 928px |
| 1440px | 1360px | 1264px |
| 1920px | 1360px | 1264px |

위 값은 내부 콘텐츠가 부모를 밀어내지 않는 정상 배치 기준의 코드 계산이며 브라우저 실측이 아니다. 긴 제목·줄바꿈 불가 문자열에 따른 실제 `scrollWidth`, 잘림, 페이지 넘침은 브라우저 확인이 필요하다. 현재 코드만으로 D-124의 영역 안 가로 스크롤 충족을 확인할 수 없다.

#### 렌더 비용과 구독

| 대상 | 현재 구현 |
|---|---|
| `TaskBoard` | 담당자·회의 이름 맵, 상태 변경 반영, 담당자 필터, 목록 조립에 `useMemo` 사용 |
| [보드](../../../src/widgets/task-board/ui/BoardView.tsx) | 렌더마다 기간 필터·컬럼별 분류·정렬 수행. `TaskCard`에 `memo` 없음 |
| [간트](../../../src/widgets/task-board/ui/GanttView.tsx) | 렌더마다 날짜·팀원별 그룹·이름 맵·주말 계산. `GroupRows`·`Row`·`TaskBar`에 `memo` 없음 |
| [캘린더](../../../src/widgets/task-board/ui/CalendarView.tsx) | 42개 날짜 셀마다 태스크·승인·회의 배열 필터. 격자·날짜별 분류에 `useMemo`, `TaskChip`에 `memo` 없음 |

세 보기 컴포넌트가 직접 Zustand 전체 store나 Query를 구독하지는 않는다. 조회는 `TaskBoard`에 모여 있다.

- 태스크·팀원 조회는 모든 보기에서 사용한다.
- 승인 조회는 PM일 때 활성화한다.
- 회의 조회는 PM이거나 캘린더일 때 활성화한다.
- [상태 변경 overlay](../../../src/features/task-status/model/useTaskStatusChange.ts)는 현재 워크스페이스의 진행 중 태스크 상태 mutation을 구독한다.
- 캘린더 회의 배열, 생성 승인 배열, 기간 변경 콜백 일부는 부모 렌더마다 새로 만들어진다.
- 실제 렌더 횟수·시간은 측정하지 않았다. 메모이제이션 부재만으로 성능 장애를 단정하지 않는다.

#### 로딩·빈 상태·조회 실패

- API 로딩과 최초 조회 실패는 `TaskBoard`의 공통 스켈레톤·오류 화면으로 처리한다. 보기별로 분리되어 있지 않다.
- PM은 태스크와 승인 데이터가 모두 있어야 본문을 표시한다.
- 팀원·회의 조회 오류는 별도 오류로 표시하지 않고 빈 배열·대체 이름으로 처리한다.
- 기존 데이터가 있으면 본문 분기가 오류보다 우선하므로 재조회 실패를 별도로 표시하지 않는다.
- 보드는 빈 컬럼, 간트는 빈 일정 표와 일정 없는 일 영역, 캘린더는 빈 날짜 격자와 마감일 없음 영역을 그린다. 전체 데이터 없음과 현재 표시 범위에 항목이 없는 상태를 설명하는 전용 안내는 없다.

#### 테스트와 MSW

| 보기 | Vitest | Storybook | 앱 Playwright E2E |
|---|---|---|---|
| 보드 | `tasks.test.tsx`에서 보기 전환 후 세 컬럼 표시 확인 | 전용 스토리 없음 | 전용 검증 없음 |
| 간트 | 보기 전환 후 일정 표·일정 없는 일 영역 확인. `taskViews.test.ts`에 날짜·주 번호·제목 계산 테스트 | 전용 스토리 없음 | 전용 검증 없음 |
| 캘린더 | 보기 전환 후 격자·마감일 없음 영역 확인. `taskViews.test.ts`에 42셀 격자·월 이동 테스트 | 전용 스토리 없음 | 전용 검증 없음 |

- [앱 테스트](../../../src/app/tasks.test.tsx)에 세 보기 전환 검증이 있다.
- [taskViews 테스트](../../../src/widgets/task-board/lib/taskViews.test.ts)는 URL 기본값·왕복·다른 조건 보존도 검증한다.
- [taskBoard 테스트](../../../src/widgets/task-board/lib/taskBoard.test.ts)는 목록의 정렬·탭·날짜 조건·상태 overlay를 검증한다.
- [기존 스토리](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/ed2585631203156d789a0acb57561e4eaaeaee16/frontend/src/widgets/task-board/ui/TaskBoard.stories.tsx)는 리스트 기본·팀원·키보드·빈 상태·로딩·오류를 다룬다.
- [기존 E2E](../../../e2e/tasks-approval.e2e.ts)의 1024/1440/1920px 검증에는 세 보기가 포함되지 않는다.
- [MSW 시나리오](../../../src/shared/mock/scenarios.ts)에 `tasks-default`·`tasks-empty`·`tasks-member` 등이 있다. 세 보기의 긴 콘텐츠·다량 데이터·부분 조회 실패를 위한 전용 시나리오는 없다. 기존 스토리의 느린 응답·실패는 handler override로 만든다.

### 구현 범위와 제외 범위

#### 구현 범위

- 보기 URL 표현과 D-132의 차이를 확인하고 합의한 방향을 반영한다.
- 세 보기의 동적 import와 코드 로딩 대기를 구현한다.
- 가용 폭보다 넓은 콘텐츠를 해당 영역 안에서 가로 스크롤하도록 보완한다.
- 반복 계산·카드·행 렌더와 구독 범위를 측정하고 필요한 곳을 최적화한다.
- 보기별 API 로딩·빈 상태·조회 실패·재시도와 부분 실패 표시를 보완한다.
- Vitest·Storybook·Playwright E2E와 MSW 시나리오의 빈 곳을 채운다.
- 구현 후 결과와 파트 진행 상태를 기록한다.

#### 제외 범위 — 선행 결정 대기

다음 내용은 A에서 확정하거나 확장하지 않는다.

- 보드 컬럼 정의·상태 전이 규칙과 그에 따른 드래그 동작
- 간트 기간 단위
- 캘린더 기준
- 필터·정렬·페이지네이션 규격
- 상세 진입 시 검토·편집 상태 자동 오픈
- 메시지 화면 정책·구현(C에서 별도 관리)
- 워크스페이스·설정 화면의 항목 범위·권한·구현(B에서 별도 관리)

현재 코드의 컬럼·21일 간트·마감일 캘린더·필터 동작은 기존 구현 사실로만 취급한다. 이번 작업의 회귀 확인이 해당 제품 정책의 최종 승인을 뜻하지 않는다.

### 의존 사항과 관련 문서

- [전체 계획 M8](../frontend-plan.md), [D-124·D-132·D-034](../../decision/frontend-decisions.md)
- [M6 계획](../m6/plan.md), [M6 결과](../m6/result.md), [목록 UI 변경 결정](../m6/basis-for-decision/2026-10-11-task-list-approval-section.md)
- [M7 계획](../m7/plan.md): 문서 구성과 검증 기록 기준
- [대표 API 계약](../../contracts/frontend-api-contract.md) §2.6 및 상단 최신 M6 코드 대조
- [MSW 안내](../../msw-guide.md), [파트 README](../../../README.md)

태스크 조회는 기존 [taskApi](../../../src/entities/task/api/taskApi.ts)를 재사용한다. 현재 프론트는 `/tasks`에 `workspace_id`를 보내 전체 목록을 받고 `entities/task` 모델로 변환한다. 담당자 이름은 별도 팀원 조회로 조립하고, Query key와 응답의 워크스페이스 검사를 유지한다.

새 API·서버 필터·페이지네이션 규격을 추가하지 않는다. 계약 변경 필요성이 발견되면 구현 사실과 합의 여부를 구분해 별도로 확인한다.

### 구현 순서

각 단계는 작은 커밋 단위로 진행하고, 해당 변경의 테스트를 함께 포함한다. 아래 경로는 `frontend/` 기준이며 신규 파일은 예정 경로다.

| 순서 | 작업 | 변경 대상 |
|---|---|---|
| 1 | 승인된 M8-A 계획 기록, URL 표현 질문 해결 및 근거 기록 | `docs/plan/m8/plan.md`, `docs/plan/m8/basis-for-decision/YYYY-MM-DD-task-view-url.md`(신규) |
| 2 | 합의된 URL 표현 반영. 직접 진입·새로고침·뒤로가기·기존 링크 처리를 검증 | `src/pages/tasks/ui/TasksPage.tsx`, `src/widgets/task-board/lib/taskViews.ts`, `lib/taskViews.test.ts`, `ui/ViewControls.tsx`, `src/app/tasks.test.tsx`. 별도 경로 선택 시 `src/app/router/routes.tsx`, `src/shared/config/routes.ts` |
| 3 | 세 보기 동적 import와 보기 영역의 코드 로딩 대기 추가. 정적 import로 다시 묶이지 않는지 확인 | `src/widgets/task-board/ui/TaskBoard.tsx`, `BoardView.tsx`, `GanttView.tsx`, `CalendarView.tsx`, 필요 시 `index.ts`, 관련 통합 테스트 |
| 4 | 보기별 API 로딩·빈 상태·오류·재시도와 부분 실패 보완 | `src/widgets/task-board/ui/TaskBoard.tsx`, 세 보기 파일, `src/app/taskViews.test.tsx`(신규), `src/shared/mock/scenarios.ts`, 필요한 조회 handler override |
| 5 | 콘텐츠 영역의 축소·최소 폭·가로 스크롤 보완 | `src/widgets/task-board/ui/TaskBoard.tsx`, 세 보기 파일, 필요 시 `ui/viewParts.tsx`, `e2e/task-views.e2e.ts`(신규) |
| 6 | 반복 렌더 측정 후 필요한 계산·카드·행 메모이제이션 및 구독 최소화 | `src/widgets/task-board/ui/TaskBoard.tsx`, 세 보기 파일, `lib/taskViews.ts`, `lib/taskBoard.ts`, 필요 시 `src/features/task-status/model/useTaskStatusChange.ts`, 관련 테스트 |
| 7 | 보기별 스토리·E2E 검증 행렬 보완 및 최종 게이트 | `src/widgets/task-board/ui/TaskViews.stories.tsx`(신규), `src/app/taskViews.test.tsx`, `e2e/task-views.e2e.ts`, `e2e/storybook/stories.sb.ts`, `e2e/support.ts`, `src/shared/mock/scenarios.ts` |
| 8 | AC별 결과·측정 근거·미검증 연동 과제 기록 | `docs/plan/m8/result.md`(신규), `README.md`, 실제 기술 선택이 있으면 `docs/plan/m8/basis-for-decision/` |

단계 1 중 계획 본문은 이번 작성으로 반영한다. URL 표현의 결론과 결정 기록은 아직 남아 있다. 단계 2의 방향은 사용자 확인 전 결정하지 않는다. URL 결정과 독립적인 동적 import·상태·레이아웃 점검은 먼저 진행할 수 있다.

코드를 유지하고 결정 쪽을 정리하는 결론이면 단계 2의 불필요한 코드 변경을 생략하고, 그 근거를 `basis-for-decision`에 기록한다. 전체 계획은 수정하지 않는다.

### 완료조건과 검증

아래 AC는 이슈 #243의 요구를 관찰 가능한 조건으로 구체화한다. M8의 후속 절과 구분하도록 `AC-A` 접두어를 사용한다.

| ID | 완료조건 | 검증 방법 |
|---|---|---|
| AC-A-01 | 보기 URL 표현의 결론·근거·기존 URL 처리 방침을 기록하고 코드와 일치시킨다. 사용자 확인 전에는 미해결로 둔다 | 결정 기록 대조, URL Vitest, 직접 진입·새로고침·뒤로가기 E2E |
| AC-A-02 | 보드·간트·캘린더가 각각 동적 import 대상이며, 리스트 진입 때 세 보기 코드가 정적으로 함께 로드되지 않는다. 코드 로딩 중 해당 영역에 대기를 표시한다 | production build의 import·청크 관계 확인, 브라우저 요청 확인, 지연 로딩 통합 테스트 |
| AC-A-03 | 1024/1440/1920px에서 페이지 전체의 가로 넘침 없이 핵심 조작을 사용할 수 있다. 콘텐츠가 영역보다 넓으면 그 영역에서 가로 스크롤로 끝까지 접근할 수 있다 | 세 보기 × 세 너비 E2E. 페이지·영역의 `clientWidth`/`scrollWidth`, 스크롤 이동, 우측 콘텐츠·포커스 접근 확인 |
| AC-A-04 | 반복 렌더의 측정 근거를 남기고 필요한 카드·행·계산에 메모이제이션과 구독 최소화를 적용한다. 관련 없는 변경으로 전체 반복 단위가 다시 렌더되는 원인을 줄인다 | 동일 데이터·조작의 전후 React Profiler 또는 렌더 계측, 변경 대상·비대상 항목 비교, 기존 상태 반영 회귀 |
| AC-A-05 | 각 보기에서 코드 로딩·API 로딩·성공한 빈 응답·조회 실패를 구분한다. 부분 조회 실패를 실제 빈 데이터로 오인시키지 않고 재시도할 수 있다 | 보기별 MSW 지연·빈 응답·태스크/승인/팀원/회의 실패 통합 테스트와 Storybook play |
| AC-A-06 | 세 보기 각각에 Vitest·Storybook·앱 E2E 검증이 있다. 기존 PM/팀원 노출·팀원 승인 미호출·워크스페이스 격리·상세 링크를 유지한다 | 테스트 목록 대조, 요청 횟수·표시·이동 단언, 기존 태스크·승인 회귀 |
| AC-A-07 | Node 24 최종 게이트와 AC별 실제 결과를 기록하고 프론트·MSW 완료와 미검증 연동 과제를 분리한다 | 명령별 종료 결과·Node 버전·검증 범위를 `result.md`에 기록, 파트 README 대조 |

성능 시간·번들 크기의 수치 상한은 근거가 없으므로 임의로 정하지 않는다. 측정 데이터 규모와 조작을 기록해 전후 비교가 재현 가능하도록 한다.

#### 검증 행렬

- **세 보기 공통:** 정상, 로딩, 전체 데이터 없음, 조회 실패·재시도, PM·팀원.
- **간트·캘린더:** 데이터는 있지만 현재 표시 기간에 항목 없음, 날짜 없는 항목, 부분 조회 실패.
- **레이아웃:** 1024/1440/1920px, 긴 제목·담당자명·줄바꿈 불가 문자열, 영역보다 넓은 콘텐츠.
- **렌더:** 같은 입력의 부모 재렌더, 단일 태스크 변경, 다른 워크스페이스 mutation, 보기 전환.
- **URL·접근성:** 합의된 주소 직접 진입, 새로고침·뒤로가기, 키보드 보기 전환·상세 진입·스크롤 영역 접근.

MSW는 기존 handler와 시나리오를 재사용하고 필요한 상태만 추가한다. Storybook의 새 스토리가 실제 회귀 실행 대상에 포함되는지도 확인한다.

#### 최종 게이트

Node 24에서 `frontend/` 기준으로 실행한다.

```bash
node --version
npm ci
npm run typecheck
npm run lint
npm run format:check
npm run test
npm run build
npm run test:storybook
npm run test:e2e -- e2e/task-views.e2e.ts e2e/tasks-approval.e2e.ts e2e/dashboard.e2e.ts
```

`test:storybook`은 현재 스크립트에서 Storybook 빌드와 Playwright 회귀를 함께 실행한다. 라우트·공통 셸 변경 시 영향받는 기존 E2E도 추가한다.

명령 실행 결과와 브라우저 너비별 결과를 따로 기록한다. 실패 후 재실행이 통과해도 최초 실패와 원인을 지우지 않는다.

### 완료 판정과 미검증 연동 과제

**M8-A 프론트·MSW 완료**는 AC와 Node 24 게이트의 근거로 판정한다. M8 전체 완료로 확대하지 않는다.

다음은 별도 연동 과제로 남긴다.

- 실제 서버의 태스크·승인·팀원·회의 조회 응답을 조합한 화면 검증
- 실제 서버의 권한·오류·데이터 규모에서의 동작 확인
- 실제 Notion 반영 결과
- M6에서 남긴 승인 보완 지원·승인 조회 PM 제한 등 기존 미검증 과제

MSW 성공으로 실제 서버·Notion 연동 완료를 선언하지 않는다.

### 위험과 열린 질문

#### 1. 보기 URL 표현 — 해결(2026-11-02, `?view=` 유지)

현재 구현은 한 경로의 `?view=`이고, 전체 계획 M8은 별도 경로를 요구한다. D-132 원문은 별도 경로로 표현한 보기의 파라미터 중복을 금지한다. 현재 코드가 의도적인 변경인지 확인할 근거는 없다.

공유 URL·새로고침·뒤로가기의 기준을 정하고 라우트 변경 범위를 확정하려면 다음 질문을 해결해야 한다.

> 현재 `?view=` 방식을 유지하고 결정 근거를 보완할지, 전체 계획 M8대로 별도 경로로 옮길지 확인이 필요하다. 별도 경로를 선택하면 구체 경로와 기존 `?view=` 링크 처리 방침도 함께 정한다.

**확정된 답변 — 2026-11-02.** 현재 `?view=` 방식을 유지한다(사용자 결정). 별도 경로로 옮기지 않으므로 기존 `?view=` 링크 처리 방침은 필요 없다. 결정 근거는 A의 결정 기록과 [결과](result-a.md)의 AC-A-01에 남긴다.

#### 2. 콘텐츠 최소 폭과 잘림

1360px 셸을 유지하는 것과 D-124의 영역 안 스크롤은 별개다. 현재 `overflow-hidden`과 균등 열 분할은 스크롤 대신 콘텐츠 축소·잘림을 만들 수 있다. 보기별 최소 폭은 실제 콘텐츠와 세 viewport 검증을 통해 정하며, 근거 없이 공통 고정 폭을 도입하지 않는다.

#### 3. 메모이제이션 효과

부모에서 배열·맵·콜백을 매번 새로 만들면 반복 단위에 `memo`만 추가해도 효과가 제한된다. 날짜·역할·공간·상태 변경을 놓치지 않도록 의존성을 확인한다. 구조 변경 전후를 측정하고 불필요한 최적화는 추가하지 않는다.

#### 4. 조회 상태와 기존 데이터

PM 승인 조회가 모든 보기를 막는 현재 구조와 팀원·회의 실패를 숨기는 동작을 함께 점검해야 한다. 최초 실패와 기존 데이터가 있는 재조회 실패를 구분하고, 성공한 데이터의 사용 가능 여부와 오류 안내를 테스트로 확인한다.

#### 5. 제품 정책 미확정

보드 컬럼·상태 전이, 간트 기간, 캘린더 기준, 필터·정렬·페이지네이션, 상세 자동 오픈은 선행 결정 대기다. 기존 구현 보존과 테스트 추가를 정책 확정으로 해석하지 않는다.

### 이슈 #243 체크리스트 대응

| 이슈 항목 | 구현 순서 | 완료·검증 근거 |
|---|---|---|
| `m8/plan.md`에 계획 기록 | 1 | 이번 작성으로 A 절 반영 |
| `?view=`와 별도 경로 결론 및 결정 근거 | 1~2 | AC-A-01 |
| 세 보기 동적 import | 3 | AC-A-02 |
| 영역 안 가로 스크롤 | 5 | AC-A-03 |
| 반복 렌더 비용·메모이제이션·구독 최소화 | 6 | AC-A-04 |
| 보기별 로딩·빈 상태·조회 실패 보완 | 4 | AC-A-05 |
| Vitest·Storybook·E2E 빈 곳 보완 | 2~7 | AC-A-06 및 AC별 테스트 |
| `result.md`·파트 README 갱신 | 8 | AC-A-07 |
| Node 24 정적 검사·Vitest·build·Storybook·관련 E2E | 7~8 | AC-A-07, 최종 게이트 기록 |

## B. 설정·팀 연결 관리

- 대상: 이슈 #244, M8-B.
- 작성일: 2026-10-30
- 작성 근거: 이슈 #244 본문(2026-10-30 확인), [전체 계획](../frontend-plan.md) M8(읽기만), [제품·기술 결정](../../decision/frontend-decisions.md), 현재 작업 트리의 프론트·백엔드 코드와 [API 계약](../../contracts/frontend-api-contract.md), 2026-10-30 사용자 답변.
- 상태: **일부 착수 가능, 일부 선행 결정 대기.** 결정 없이 진행할 수 있는 단계(B-1)만 구현 순서와 AC를 정했다. 결정 5와 항목 배분에 걸린 단계(B-2)는 내용을 확정하지 않았다. 이 계획은 구현이나 검증의 완료를 뜻하지 않는다.
- 완료 기준: **프론트엔드 구현과 MSW 검증**으로 판정한다. 실제 Discord·Notion 연동 검증은 [미검증 연동 과제](#완료-판정과-미검증-연동-과제)로 분리한다.

### 목표와 배경

온보딩에서 건너뛴 Discord·Notion 연결과 팀원 연결을 온보딩이 끝난 뒤에도 마칠 수 있게 한다. 이를 위해 설정 화면에서 연결을 관리하고, 설정과 분리된 팀 화면에서 Discord 계정과 팀원의 연결을 다시 맞출 수 있게 한다. M4 온보딩의 연결 로직과 모의 OAuth를 재사용한다.

관련 결정은 다음과 같다.

- [D-011](../../decision/frontend-decisions.md)·D-012: 온보딩에서 건너뛴 연결은 `워크스페이스 관리·설정`에서 완료한다.
- D-029·D-030: 일부만 매핑한 뒤 남은 사용자, 그리고 새로 들어온 Discord 사용자를 이후에 매핑할 수 있다.
- D-074: 설정에서 Discord 연결을 완료하면 팀원 연결 화면으로 바로 이동한다.
- D-075: 그 화면은 아무도 매핑하지 않은 채 나갈 수 있고, 나중에 다시 들어올 수 있다.
- D-076: 미매핑 사용자는 `연결되지 않은 계정` 영역에 보이며, 제목에 인원수를 표시하지 않는다.
- D-173: Discord를 건너뛰어도 팀원 연결 단계를 자동으로 건너뛰지 않는다. 이미 `건너뜀`으로 저장된 단계는 되돌리지 않는다.
- D-158: OAuth는 현재 탭 이동이고, 복귀 경로를 `state`에 담는다.
- D-137: 연결과 설정 변경은 서버 성공 뒤에 화면에 반영한다.

전체 계획은 M8 설정 영역을 골격으로만 두었다. 착수 전 결정 5인 "워크스페이스 관리·설정 화면의 항목 범위와 권한"은 아직 정해지지 않았다. 그래서 이 절은 결정 없이 할 수 있는 부분과 결정을 기다리는 부분을 나눠 둔다.

#### 확정된 사실 — 2026-10-30 사용자 답변

- 팀 화면은 설정과 **별도 페이지**다. [라우트](../../../src/app/router/routes.tsx)에서 `workspaces/:workspaceId/members`와 `workspaces/:workspaceId/settings`가 이미 분리되어 있고, 디자인 캔버스에도 [Team](../../design/canvas/Team.dc.html)·[Settings](../../design/canvas/Settings.dc.html) 아트보드가 따로 있다.
- 완료 범위는 프론트엔드 구현과 MSW 검증이다. 실제 Discord·Notion 연동 검증은 미검증 연동 과제로 분리한다.

### 현재 상태

2026-10-30 작업 트리를 정적으로 확인한 결과다. 테스트를 실행한 결과가 아니다.

#### 화면

| 영역 | 현재 코드 |
|---|---|
| 설정 | [SettingsPage](../../../src/pages/settings/ui/SettingsPage.tsx)에는 두 가지만 있다. 하나는 `PagePlaceholder` 안의 `워크스페이스 이름` 입력 한 칸이다. 저장 API 없이 `되돌리기`만 있고, 이탈 확인을 점검하는 용도다. 다른 하나는 M5가 앞당긴 [NotionConnectionSection](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/515456fd257e66f37dd3838f81fd310594faf2ac/frontend/src/features/notion-connection/ui/NotionConnectionSection.tsx)이다. |
| Notion 연결 영역 | PM만 `연결하기`·`다시 연결하기`를 본다(`canManage`). 일반 팀원은 상태와 요청 안내만 본다. 복귀 뒤 연동 상태를 다시 조회하고, 차단 모달에서 왔으면 업로드 화면으로 돌아간다(D-098). 코드 주석에 "`속성 다시 맞추기`·`연결 끊기`·Discord 줄은 M8"이라고 적혀 있다. |
| 팀 | [MembersPage](../../../src/pages/members/ui/MembersPage.tsx)는 `GET /members` 결과의 이름 목록만 보여 주는 플레이스홀더다. 로딩·오류·다시 시도만 있다. |
| 없는 것 | 설정의 Discord 연결 관리, 건너뛴 연결을 완료하는 별도 경로나 표시(D-011), 온보딩 뒤의 팀원 연결 재진입(D-074·D-075), `연결되지 않은 계정` 영역(D-076), 연결 끊기 UI는 코드에서 찾지 못했다. |
| 온보딩 경로 | [RequireValidOnboardingStep](../../../src/app/router/guards/RequireValidOnboardingStep.tsx)이 온보딩을 마친 공간을 대시보드로 보낸다. 그래서 `/onboarding/:id/connect_members`를 온보딩 뒤의 재진입 경로로 그대로 쓸 수 없다. |

#### 재사용 후보

| 대상 | 위치 | 재사용 가능성 |
|---|---|---|
| 매핑 모델 `buildMappingRows`·`findMappingIssues`·`planRow`·`saveMemberMappings`·`MappingSaveError` | [features/onboarding/model/memberMapping.ts](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/a08f5911a1d3a13ccde2e4b61d56586a5c91df1e/frontend/src/features/onboarding/model/memberMapping.ts) | 순수 함수와 저장 순서 규칙이다. D-026~D-029, #228의 PM 연결([리팩터 계획](../refactor/work-items/228-onboarding-pm-discord-link/plan.md))을 담고 있어 그대로 쓸 수 있다. 위치가 `onboarding` 슬라이스라는 점만 다르다. |
| 연결 상태 조합 `linkDiscordUsers` | [entities/member/lib/linkDiscordUsers.ts](../../../src/entities/member/lib/linkDiscordUsers.ts) | `linked`·`unlinked`·`inactive`(D-028·D-031) 판정이 이미 있다. `연결되지 않은 계정` 목록의 출처로 쓸 수 있다. |
| 팀원 연결 화면 | [widgets/onboarding/ui/MembersStep.tsx](../../../src/widgets/onboarding/ui/MembersStep.tsx) | 폼 본문(줄·PM 체크·오류 문구·부분 실패 재시도)은 재사용할 가치가 있다. 다만 `OnboardingLayout`·`ExitLink`·`useOnboardingSave`(`connect_members` 저장)와 묶여 있어 그대로는 쓸 수 없다. |
| 연결 단계 훅 `useIntegrationStep` | [features/onboarding/model/useIntegrationStep.ts](../../../src/features/onboarding/model/useIntegrationStep.ts) | OAuth 복귀 확인 규칙은 같지만 성공 뒤 온보딩 단계를 저장한다. 설정에서는 쓰지 않는다. |
| 설정 연결 훅 `useNotionConnection` | [features/notion-connection/model/useNotionConnection.ts](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/515456fd257e66f37dd3838f81fd310594faf2ac/frontend/src/features/notion-connection/model/useNotionConnection.ts) | 단계를 저장하지 않는 설정용 복귀 확인 규칙이다. 경합 처리(세션 종료, 화면 이탈, 이탈 확인)를 갖췄지만 provider가 `notion`으로 고정되어 있다. Discord에 쓰려면 일반화가 필요하다. |
| OAuth 시작·복귀 | [entities/integration](../../../src/entities/integration/index.ts)의 `integrationStartUrl`·`readIntegrationReturn`·`waitWhileConnecting` | provider와 무관하게 쓸 수 있다. |
| 모의 OAuth | [shared/mock/oauth](../../../src/shared/mock/oauth/MockOAuthPage.tsx), [결정 기록](../m4/basis-for-decision/2026-09-29-msw-storage-oauth-mock.md) | Discord·Notion 모두 `연결 허용`·`취소`·`실패 재현`을 지원한다. |
| 필드 오류 표시 | [강조색](../m4/basis-for-decision/2026-09-29-field-error-accent.md), [낭독 방식](../m4/basis-for-decision/2026-09-29-field-error-announcement.md) | 매핑 폼의 오류는 이 규칙(`error` 강조색, `aria-describedby`만 사용)을 그대로 따른다. |

FSD 경계([eslint.config.js](../../../eslint.config.js))상 `features`는 다른 `features`를 가져올 수 없고, `pages`·`widgets`는 `features`를 가져올 수 있다.

#### MSW·테스트·Storybook

- **MSW handler**
  - [integration.ts](../../../src/shared/mock/handlers/integration.ts): 조회와 `DELETE`(204 무본문)가 있다.
  - [member.ts](../../../src/shared/mock/handlers/member.ts): `GET .../discord/members`(Discord 미연결이면 409 `INTEGRATION_NOT_CONNECTED`), `GET`·`POST`·`PATCH /members`, 별칭 API가 있다.
- **MSW와 실제 서버의 권한 차이.** MSW의 `DELETE` 연동 해제, `POST`·`PATCH /members`, 모의 OAuth 완료는 `requireMember`만 본다. 반면 백엔드는 다음처럼 PM만 허용한다(정적 확인).
  - [integrations.py](../../../../backend/app/api/integrations.py): `delete_integration`이 `get_current_pm`이다. `_start_connection`은 PM이 아니면 `failed`로 돌려보낸다.
  - [members.py](../../../../backend/app/api/members.py): `create_member`가 `require_pm`이고, `update_member`가 `_get_member(..., pm=True)`다.
- **시나리오.** [scenarios.ts](../../../src/shared/mock/scenarios.ts)에 설정·팀 전용 시나리오는 없다. 온보딩(`incomplete-workspace` 등), M5~M7 시나리오만 있다.
- **Vitest**
  - [notionConnection.test.tsx](../../../src/app/notionConnection.test.tsx): 설정 Notion 영역, 복귀, 경합, D-098 왕복.
  - [pages.test.tsx](../../../src/app/router/pages.test.tsx): 팀 목록 403·재시도, 설정 이탈 확인.
  - [onboardingMembers.test.tsx](../../../src/app/onboardingMembers.test.tsx), [onboardingModel.test.ts](../../../src/features/onboarding/model/onboardingModel.test.ts): 매핑.
  - [linkDiscordUsers.test.ts](../../../src/entities/member/lib/linkDiscordUsers.test.ts).
- **Storybook**: [NotionConnectionSection.stories.tsx](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/515456fd257e66f37dd3838f81fd310594faf2ac/frontend/src/features/notion-connection/ui/NotionConnectionSection.stories.tsx), [NotionRequiredModal.stories.tsx](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/515456fd257e66f37dd3838f81fd310594faf2ac/frontend/src/features/notion-connection/ui/NotionRequiredModal.stories.tsx), [OnboardingSteps.stories.tsx](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/9d1a8e48ca1148545b5fe20c817da271bb33b91a/frontend/src/widgets/onboarding/ui/OnboardingSteps.stories.tsx). 설정·팀 페이지 스토리는 없다.
- **E2E**
  - [signup-onboarding.e2e.ts](../../../e2e/signup-onboarding.e2e.ts): 온보딩 팀원 연결.
  - [select-switch.e2e.ts](../../../e2e/select-switch.e2e.ts): 설정 화면에서 공간 전환.
  - [meeting-keyboard.e2e.ts](../../../e2e/meeting-keyboard.e2e.ts): 차단 모달에서 설정 `section=notion`으로 이동.
  - 설정·팀 전용 E2E는 없다.

#### 백엔드 정적 확인 (실행하지 않음)

- **OAuth 시작·콜백.** [integrations.py](../../../../backend/app/api/integrations.py)에 Discord(봇 초대)와 Notion의 `start`·`callback`이 있다. 복귀 파라미터는 `?oauth=<provider>&oauth_result=`로, 프론트의 [returnParams.ts](../../../src/shared/lib/oauth/returnParams.ts)와 이름이 같다.
- **계약과 다른 점.** [계약](../../contracts/frontend-api-contract.md) §4.3 표는 아직 `start`·`callback`을 ❌로 적고 있고, 현재 코드 대조 표에도 "Discord OAuth 경로 없음"이 남아 있다. 계약 갱신 대상이다.
- **Discord 사용자 목록.** 코드 주석은 "서버 ID와 봇 토큰으로 읽는다"고 하지만 계약은 하드코딩 2명으로 적고 있다. 실제 동작은 **확인 필요**다.

### 선행 결정

| # | 항목 | 상태 | 임시 기본값 (최종 결정 아님) | 문서 근거 |
|---|---|---|---|---|
| 0 | 팀 화면과 설정 화면의 분리 | **확정**(2026-10-30) | — | 사용자 답변, 라우트, 캔버스 |
| 5 | 설정·팀 화면의 항목 범위와 권한(전체 계획 M8 결정 5) | **열림** | **범위:** 이 절은 Discord·Notion 연결 관리와 D-011·D-074~D-076 흐름만 다룬다. Settings 캔버스의 `자동 반영`·`알림`·`일반`·`이 팀 삭제하기`, Team 캔버스의 진행률·위험 표시, 워크스페이스 이름 저장, 별칭 보정은 B 범위에 넣지 않는다.<br>**권한:** 연결·재연결·연결 끊기·매핑 저장은 PM만 한다. 일반 팀원은 상태를 읽기만 한다. | 이슈 #244 범위 후보. 계약 §5.8의 "그 밖의 설정 항목은 결정 대기". 백엔드의 `start`(PM 아니면 실패)·`DELETE`(`get_current_pm`)·`POST`·`PATCH /members`(`require_pm`). D-026("PM이 입력"). 기존 Notion 영역의 `canManage` 분기 |
| 5-a | 팀원 연결 재진입과 `연결되지 않은 계정`을 팀과 설정 중 어디에 둘지 | **열림** | **설정**에는 `연결` 절(Discord·Notion 줄)을 둔다.<br>**팀**에는 `연결되지 않은 계정` 영역을 두고, 팀원 연결 재진입도 팀 화면에서 연다. 따라서 설정에서 Discord를 연결한 뒤의 이동 대상(D-074)도 팀 화면 쪽이다.<br>재진입이 팀 화면 안의 편집 상태인지 별도 경로인지는 정하지 않는다. | Settings 캔버스의 `연결` 절(Discord·Notion·`연결 끊기`·`속성 다시 맞추기`·`채널 바꾸기`). Team 캔버스의 `연결되지 않은 계정` 영역과 안내 문구("이름을 연결해 두면…"), 그리고 `연결` 버튼. D-074의 "워크스페이스 설정에서 Discord 연결을 완료하면" |
| 5-b | `연결 끊기`·`속성 다시 맞추기`·`채널 바꾸기`를 포함할지 | **열림**(결정 5의 일부) | 제안 없음. `연결 끊기`는 캔버스와 계약 §5.8(해제 API 구현됨)에 근거가 있다. 나머지 둘은 대응 API를 찾지 못했다. | Settings 캔버스, 계약 §5.8 |

임시 기본값은 B-2 착수를 빠르게 하려는 제안이다. 사용자가 확정하기 전에는 B-2의 구현 순서·AC·코드에 반영하지 않는다. B-1은 어느 결정이 나와도 바뀌지 않는 부분만 담는다.

D-011·D-012의 `워크스페이스 관리·설정`, D-076의 `워크스페이스 관리 화면`이 팀과 설정 중 어느 페이지를 가리키는지는 결정 기록만으로 정할 수 없다. 5-a 결정으로 함께 정리한다.

### 구현 범위와 제외 범위

#### B-1. 결정 없이 착수할 수 있는 범위

- **매핑 로직 이동.** 온보딩 매핑 모델을 온보딩 밖에서 쓸 수 있는 위치로 옮긴다. 동작은 바꾸지 않는다.
- **팀원 연결 폼 본문 분리.** `MembersStep`에서 폼 본문을 레이아웃·저장 후 동작과 떼어 내, 다른 화면이 담을 수 있게 한다. 온보딩 동작은 그대로 둔다.
- **설정 연결 훅의 provider 일반화.** Notion 전용 동작(D-098 업로드 복귀, `section=notion` 포커스)은 그대로 둔다.
- **설정 `연결` 절에 Discord 줄 추가.** 상태 표시, PM의 연결·재연결, 복귀 뒤 재조회로 성공을 판정하는 부분, 취소·실패 안내, 일반 팀원 안내를 넣는다. 온보딩 단계 상태는 바꾸지 않는다(D-173). 이 줄은 D-011의 "건너뛴 연결 완료 경로" 중 연결 부분이다.
  - 근거: D-074가 "워크스페이스 설정에서 Discord 연결"을 전제한다. Settings 캔버스 `연결` 절에도 Discord 줄이 있다. 연결을 PM에게만 허용하는 것은 제품 결정이 아니라 서버 제약(`start`의 PM 검사)이다.
- **MSW를 실제 서버 권한에 맞추기.** 연동 해제·팀원 생성과 수정·모의 OAuth 완료를 PM만 허용한다. 설정·팀 검증용 시나리오를 추가한다.

#### B-2. 선행 결정 대기 범위

내용은 결정 5와 5-a·5-b가 정해진 뒤 확정한다.

- 팀 화면 구성과 `연결되지 않은 계정` 영역(D-076, D-030 새 사용자, D-031 비활성)
- 온보딩 뒤의 팀원 연결 재진입 경로와 화면, 무매핑 이탈(D-074·D-075)
- 설정에서 Discord 연결이 성공한 뒤 이동할 곳(D-074)
- `연결 끊기` 등 5-b 항목
- 일반 팀원이 팀·설정에서 보는 범위

#### 제외 범위

- 백엔드 변경. 일괄 매핑 API처럼 새 API를 요청하지 않는다.
- Settings 캔버스의 `자동 반영`·`알림`·`일반`·`이 팀 삭제하기`, 워크스페이스 이름 저장. 결정 5에서 범위에 넣으면 별도로 계획한다.
- Team 캔버스의 팀원별 진행률·위험·`먼저 챙길 것`
- 회의 전사의 미매칭 이름 보정(`unresolved-aliases`, D-168·계약 §5.8). 이 절의 Discord 계정 매핑과 데이터 출처가 다르다.
- 온보딩 흐름 자체의 변경
- 실제 Discord·Notion 연동 성공 판정. MSW 결과로 판단하지 않는다.

### 의존 사항과 관련 문서

- 결정: [frontend-decisions.md](../../decision/frontend-decisions.md)의 D-011~D-013, D-026~D-031, D-073~D-076, D-097·D-098, D-102~D-105(역할 분기 선례), D-137, D-158, D-168, D-173
- 선행 마일스톤
  - [M4 계획](../m4/plan.md), [M4 인수인계](../m4/m4-handoff.md): 온보딩 연결과 실 API 제약
  - [PM 연결 리팩터 계획](../refactor/work-items/228-onboarding-pm-discord-link/plan.md)
  - [M7 계획](../m7/plan.md): 양식 기준
- 계약: [frontend-api-contract.md](../../contracts/frontend-api-contract.md) §2.2, §4.3, §4.5, §5.3, §5.8
- 디자인: [캔버스 안내](../../design/canvas/README.md)의 [Team](../../design/canvas/Team.dc.html)·[Settings](../../design/canvas/Settings.dc.html)
- MSW: [MSW 사용 안내](../../msw-guide.md)

### 구현 순서

경로는 `frontend/` 기준이다. 각 단계는 작은 커밋 하나로 하고, 그 변경의 테스트를 함께 넣는다. 신규 파일은 예정 경로다.

#### B-1 (착수 가능)

| 순서 | 작업 | 변경 대상 |
|---|---|---|
| 1 | MSW 권한을 백엔드에 맞춘다. 연동 `DELETE`, `POST`·`PATCH /members`, 모의 OAuth 완료(`settleMockOAuth`)를 PM만 허용하고, 일반 팀원은 403 또는 `failed`를 받는다. 기존 일반 팀원 시나리오의 회귀도 확인한다. | `src/shared/mock/handlers/integration.ts`, `handlers/member.ts`, `oauth/mockOAuth.ts`, 관련 `*.test.ts` |
| 2 | 설정·팀 시나리오를 추가한다. 예정 이름은 다음 셋이다(착수 시 확정). 시나리오 테스트도 함께 넣는다. 브라우저 MSW 저장 모양이 바뀌면 `MOCK_DB_VERSION`을 올린다.<br>· `settings-discord-skipped`: 온보딩 완료, Discord 미연결, 팀원 연결 건너뜀<br>· `settings-unmapped`: Discord 연결, 미매핑·비활성 사용자 포함<br>· `settings-member`: 일반 팀원 | `src/shared/mock/scenarios.ts`, `scenarios.test.ts`, 필요 시 `fixtures/member.ts`·`fixtures/integration.ts`, `persistence.ts` |
| 3 | 매핑 모델을 온보딩 밖 슬라이스로 옮긴다. 예정 위치는 `features/member-mapping`이고, 최종 위치는 착수 시 정해 `basis-for-decision`에 남긴다. `features/onboarding`의 공개 이름은 유지하거나 호출부를 갱신한다. 동작 변경은 없다. | `src/features/onboarding/model/memberMapping.ts` → 새 위치, `src/features/onboarding/index.ts`, `src/widgets/onboarding/ui/MembersStep.tsx`, `onboardingModel.test.ts`(이동) |
| 4 | `MembersStep`의 폼 본문을 분리한다. 줄·PM 체크·검증 문구·부분 실패 재시도를 담고, 제출 뒤 동작은 호출자가 넘긴다. 온보딩은 기존 `확인 완료`·`나중에 하기`·나가기 저장을 그대로 쓴다. | `src/widgets/onboarding/ui/MembersStep.tsx`, 새 폼 컴포넌트(위치는 착수 시 확정. 팀 화면이 쓸 수 있도록 `widgets` 또는 `features`), `OnboardingSteps.stories.tsx`, `onboardingMembers.test.tsx` |
| 5 | 설정 연결 훅을 provider에 대해 일반화한다. Notion 전용 동작(D-098 복귀, `section=notion`)은 Notion에만 적용한다. `useNotionConnection`과 `NotionConnectionSection`의 공개 동작과 기존 테스트 기대값은 바꾸지 않는다. | `src/features/notion-connection/**`, 또는 새 `features/integration-connection`(착수 시 확정), `src/shared/config/routes.ts`(Discord 복귀 경로가 필요한 경우) |
| 6 | 설정 `연결` 절에 Discord 줄을 추가한다. 상태 배지, PM의 연결·재연결, 복귀 확인, 취소·실패 안내, 일반 팀원 안내를 넣는다. 성공 뒤에는 설정에 머문다. D-074 이동은 B-2에서 붙인다. 설정 페이지의 플레이스홀더 설명은 바뀐 범위에 맞게 고친다. | `src/pages/settings/ui/SettingsPage.tsx`, Discord 연결 영역 컴포넌트와 스토리, `src/app/settingsConnections.test.tsx`(신규) |
| 7 | B-1 E2E와 너비 검증을 추가한다. Discord 연결의 성공·취소·실패와 새로고침 뒤 상태, 1024/1440/1920px에서 설정 화면을 확인한다. | `e2e/settings-team.e2e.ts`(신규), `e2e/support.ts`, `e2e/storybook/stories.sb.ts`(새 스토리 포함 여부) |

3·4단계는 리팩터링이다. 기존 온보딩 테스트를 기대값 변경 없이 통과하는 것이 조건이다. 기대값을 바꿔야 한다면 그 이유를 커밋과 결과 기록에 남긴다.

#### B-2 (선행 결정 대기)

결정 5와 5-a·5-b가 확정되면 아래 단계의 내용·변경 대상·AC를 이 절에 추가한다. 지금은 이름만 둔다.

| 순서 | 작업 | 상태 |
|---|---|---|
| 8 | 팀 화면 구성과 `연결되지 않은 계정` 영역 | 선행 결정 대기(5, 5-a) |
| 9 | 온보딩 뒤의 팀원 연결 재진입 화면과 경로, 무매핑 이탈 | 선행 결정 대기(5-a) |
| 10 | 설정에서 Discord 연결 성공 → 팀원 연결 이동(D-074) | 선행 결정 대기(5-a) |
| 11 | 5-b 항목(`연결 끊기` 등) | 선행 결정 대기(5-b) |
| 12 | 일반 팀원의 팀·설정 표시 범위 | 선행 결정 대기(5) |
| 13 | 계약 대조와 갱신(§4.3·§5.8 등), `result.md`·파트 README 기록 | B-1만 끝나도 할 수 있다. 계약 갱신은 `contract-update`, 결과는 `milestone-result` 절차를 따른다. |

### 권한 분기

| 조작 | PM | 일반 팀원 | 근거 |
|---|---|---|---|
| 연동 상태 보기(설정) | 가능 | 가능 | 기존 Notion 영역, `GET /integrations`는 `get_current_member` |
| Discord·Notion 연결·재연결 | 가능 | 버튼 없음, 요청 안내 | 서버 `start`의 PM 검사, 기존 Notion 영역(U3-3) |
| 연결 끊기 | 결정 대기(5-b) | 결정 대기 | 서버 `DELETE`는 PM 전용 |
| 매핑 저장(생성·수정) | 가능 | 결정 대기(5) | 서버 `POST`·`PATCH /members`는 PM 전용, D-026 |
| 팀 화면·`연결되지 않은 계정` 보기 | 결정 대기(5) | 결정 대기(5) | `GET /members`·`GET .../discord/members`는 소속 팀원이면 조회할 수 있다 |

B-1의 화면 분기는 위 표의 "가능"과 "버튼 없음"만 구현한다. 서버 권한을 프론트 분기가 대신하지 않는다. MSW도 같은 거부를 재현해야 한다(1단계).

### 완료조건과 검증

A 절과 구분하려고 `AC-B` 접두어를 쓴다. 아래는 B-1의 조건이다. B-2의 AC는 결정 뒤 `AC-B-1x`부터 부여한다.

| ID | 완료조건 | 검증 방법 |
|---|---|---|
| AC-B-01 | MSW가 연동 해제, 팀원 생성·수정, 모의 OAuth 완료를 PM만 허용한다. 일반 팀원 요청은 거부되고 데이터가 바뀌지 않는다. | handler·mockOAuth Vitest(PM·일반 팀원 각각), 기존 일반 팀원 시나리오 회귀 |
| AC-B-02 | 설정·팀 시나리오로 브라우저 MSW를 시작할 수 있고, 시나리오끼리 상태가 섞이지 않는다. | `scenarios.test.ts`, E2E의 `?msw-scenario=` 진입 |
| AC-B-03 | 매핑 모델 이동과 폼 본문 분리 뒤에도 온보딩 팀원 연결이 이전과 같다. 1:1 제약, 부분 저장, PM 체크, 부분 실패 재시도, 재진입 시 팀원이 늘지 않는 점을 포함한다. | 기존 `onboardingModel.test.ts`·`onboardingMembers.test.tsx`·`OnboardingSteps` 스토리·`signup-onboarding.e2e.ts`를 기대값 변경 없이 통과, `npm run lint`(FSD 경계) |
| AC-B-04 | 설정의 Notion 영역 동작이 바뀌지 않는다. 복귀 확인, `connecting` 대기, D-098 업로드 복귀, `section=notion` 포커스, 경합 처리를 포함한다. | 기존 `notionConnection.test.tsx`·Notion 스토리·`meeting-keyboard.e2e.ts`를 기대값 변경 없이 통과 |
| AC-B-05 | 설정에서 PM이 Discord를 연결할 수 있다. 성공 복귀 뒤 연동 상태를 다시 조회해 `connected`일 때만 연결됨으로 보인다. 취소·실패나 재조회 결과가 `connected`가 아니면 안내를 보이고 다시 시도할 수 있다. 복귀 표시는 주소에서 지워진다. | `settingsConnections.test.tsx`(성공·취소·실패·재조회 불일치·조회 오류 재시도), E2E 모의 OAuth 왕복과 새로고침 |
| AC-B-06 | 설정에서 연결해도 온보딩 단계 저장 요청(`PATCH .../onboarding`)이 나가지 않고, 저장된 단계 상태가 그대로다(D-173). | 요청 횟수 단언, 연결 전후 워크스페이스 상세 비교 |
| AC-B-07 | 일반 팀원은 Discord·Notion 상태와 요청 안내만 보고, 연결 버튼이 없다. | `settings-member` 시나리오 통합 테스트·스토리 |
| AC-B-08 | 1024/1440/1920px에서 설정 화면에 페이지 가로 넘침이 없고, 두 연결 줄과 버튼을 키보드로 다룰 수 있다. 상태는 색 말고 문구로도 구분된다(D-128). | E2E의 세 너비에서 `scrollWidth`/`clientWidth`·Tab 순서 확인, 스토리 |
| AC-B-09 | Node 24 최종 게이트와 AC별 실제 결과를 기록하고, 프론트·MSW 완료와 미검증 연동 과제를 나눠 적는다. | `result.md`에 명령별 종료 결과·Node 버전 기록, 파트 README 대조 |

#### 검증 행렬

- **역할:** PM, 일반 팀원
- **연동 상태:** `not_connected`, `connecting`(Notion), `connected`, `revoked`, 조회 실패
- **OAuth 복귀:** 성공, 취소, 실패, 성공 표시 뒤 재조회 불일치, 확인 중 화면 이탈이나 세션 종료
- **너비:** 1024, 1440, 1920px

#### 최종 게이트

Node 24에서 `frontend/` 기준으로 실행한다.

```bash
node --version
npm ci
npm run typecheck
npm run lint
npm run format:check
npm run test
npm run build
npm run test:storybook
npm run test:e2e -- e2e/settings-team.e2e.ts e2e/signup-onboarding.e2e.ts e2e/select-switch.e2e.ts e2e/meeting-keyboard.e2e.ts
```

`test:storybook`은 Storybook 빌드와 Playwright 회귀를 함께 실행한다. 라우트나 공통 셸을 바꾸면 영향받는 E2E를 추가한다. 실패 뒤 재실행으로 통과해도 처음 실패와 그 원인을 지우지 않는다. 검증 중에는 개발 서버를 끈다([M4 인수인계](../m4/m4-handoff.md) §7).

### 완료 판정과 미검증 연동 과제

**M8-B 프론트·MSW 완료**는 AC와 Node 24 게이트의 근거로 판정한다. B-1만 끝난 상태는 "B-1 완료"로 기록하고, M8-B 완료로 표시하지 않는다.

다음은 별도 연동 과제로 남긴다.

- 실제 Discord 봇 초대 OAuth와 Notion OAuth의 성공·취소·실패 복귀. 배포 도메인과 redirect URI 설정이 필요하다(전체 계획 운영 절).
- 실제 `GET .../discord/members`가 연결된 서버의 사용자를 돌려주는지. 계약은 스텁, 코드 주석은 봇 토큰 조회로 서로 다르다.
- 실제 서버의 PM 권한 거부(`start` 실패 복귀, `DELETE`·`/members`의 403)와 프론트 안내가 맞는지
- `revoked` 상태가 실제 서버에서 오는지(계약 §4.3은 Discord에 대해 "안 옴"으로 기록)
- 탈퇴(소프트 삭제)한 팀원의 Discord 사용자를 다시 연결할 때 500이 나는 문제(결정 기록 D-027 관련 메모, 계약 §4.5)

MSW 성공을 실제 연동 완료로 선언하지 않는다.

### 위험과 열린 질문

#### 일정

AWS 실습 환경은 **2026-11-20**까지다. 작성일 기준 3주가 남았다.

- B-2가 결정 5를 기다리는 동안 B-1을 먼저 진행한다.
- 실제 연동 검증은 배포 환경, 도메인, OAuth redirect URI가 갖춰진 뒤에만 할 수 있다. 11-20 이전에 검증 시점을 잡아야 한다(확인 필요).

#### 같은 파일을 쓰는 브랜치의 충돌

- 이 파일은 #243 브랜치에서도 `# M8 실행 계획` 제목과 공통 절, A·B·C 틀로 작성 중이다.
- 그쪽 문서에는 "A 병합 전에는 B·C 워크트리에서 `plan.md`를 고치지 않는다"는 원칙이 적혀 있다. 이번 작성은 사용자의 명시적 지시에 따른 것이므로 병합 때 충돌이 예상된다.
- 병합 시 이 B 절 본문을 A 브랜치의 B 자리로 옮기고, 제목과 공통 절은 한쪽으로 맞춰야 한다.

#### 재사용 리팩터링의 회귀

`MembersStep`과 `useNotionConnection`은 경합 처리와 F 수정 이력이 많다([M4 인수인계](../m4/m4-handoff.md)). 분리·일반화 중 미묘한 동작이 바뀔 수 있다. 그래서 AC-B-03·AC-B-04는 기존 테스트를 기대값 변경 없이 통과하는 것을 조건으로 둔다.

#### MSW 권한 변경의 파급

MSW를 PM 전용으로 바꾸면, 일반 팀원으로 매핑·연결을 호출하던 기존 테스트나 스토리가 있을 경우 실패한다. 1단계에서 영향 범위를 확인한다.

#### 계약 문서의 지연

계약 §4.3과 현재 코드 대조 표가 백엔드의 OAuth 구현보다 뒤처져 있다. 13단계에서 갱신하며, 이 계획에서는 수정하지 않는다.

#### 사용자에게 물을 질문

1. **결정 5 — 범위.** 설정·팀 화면의 항목 범위를 정해야 한다. 캔버스에는 B 범위 밖 항목(자동 반영, 알림, 팀 삭제, 진행률)이 많다. 정하지 않으면 무엇을 만들지 경계가 서지 않는다. 임시 기본값은 "연결 관리와 D-011·D-074~D-076만"이다.
2. **결정 5 — 권한.** 일반 팀원이 팀 화면과 `연결되지 않은 계정`을 볼 수 있는지 정해야 한다. 서버는 조회를 소속 팀원 모두에게 허용하고, 쓰기만 PM으로 제한한다. 화면 노출 범위는 그와 별개의 제품 결정이다.
3. **5-a — 배치.** 팀원 연결 재진입과 `연결되지 않은 계정`을 팀과 설정 중 어디에 둘지 정해야 한다. D-074의 이동 목적지와 라우트가 이 답으로 정해진다. 임시 기본값은 "둘 다 팀 화면"이다(Team 캔버스 근거).
4. **5-a 세부 — 재진입 형태.** 재진입을 팀 화면 안에서 편집하는 형태로 할지, 온보딩 4단계처럼 별도 화면으로 할지 정해야 한다. 완료 공간은 온보딩 경로로 들어갈 수 없으므로 어느 쪽이든 새 경로나 새 상태가 필요하다.
5. **5-b — 추가 조작.** `연결 끊기`·`속성 다시 맞추기`·`채널 바꾸기`를 이번에 넣을지 정해야 한다. 끊기는 API가 있고, 나머지 둘은 대응 API를 찾지 못했다.
6. **온보딩 뒤 PM 체크.** 온보딩 `확인 완료`가 요구하는 "PM 체크"(#228)를 온보딩 뒤 매핑 화면에도 적용할지 정해야 한다. D-075는 무매핑 이탈을 허용하지만 PM 체크에 대한 규정은 없다.

### 이슈 #244 체크리스트 대응

| 이슈 항목 | 구현 순서 | 근거 |
|---|---|---|
| 범위 후보: Discord·Notion 연결 관리 | 5~6(연결), 11(끊기 등) | AC-B-04~08, B-2는 결정 뒤 |
| 범위 후보: 건너뛴 연결 완료 경로(D-011) | 6(설정 연결), 9(팀원 연결) | AC-B-05·06, B-2는 결정 뒤 |
| 범위 후보: 팀원 연결 재진입(D-074·D-075) | 3~4(준비), 9~10 | AC-B-03, B-2는 결정 뒤 |
| 범위 후보: `연결되지 않은 계정`(D-076) | 8 | 결정 뒤 |
| 선행: 결정 5 | — | 이 절의 [선행 결정](#선행-결정) 5, 열린 질문 1·2 |
| 선행: 팀과 설정 분리 | — | 확정(2026-10-30) |
| 선행: 항목 배분 | — | 선행 결정 5-a, 열린 질문 3·4 |
| 선행: 결정 전·후 부분 구분 | — | 이 절의 B-1·B-2 구분 |
| 세부: B 절에 계획 기록 | — | 이번 작성 |
| 세부: 구현 항목·AC를 이슈에 채운다 | — | 미실행. 이 계획을 확정한 뒤 진행하며, 이번 작성에서 이슈를 수정하지 않았다 |
| 완료조건: Node 24 정적 검사·test·build·Storybook·E2E | 7, 13 | AC-B-09, 최종 게이트 |

### 작성 내역

- 2026-10-30: 0바이트 파일에 B 절을 처음 작성했다. A·C 절 내용은 쓰지 않았다. 전체 계획, trouble-shooting, 이슈 본문은 수정하지 않았다.

## C. 메시지

- 작성일: 2026-10-30
- 이슈: #245
- 상태: 구현 전 계획. 결정 전 부분만 구현 순서와 완료조건을 정한다. 결정 후 부분은 「선행 결정 대기」로 남긴다. 완료 판정과 테스트 성공 기록은 포함하지 않는다.
- 계획 근거: 이슈 #245 본문, 2026-10-30 사용자 답변, [전체 계획](../frontend-plan.md) §M8, [제품·기술 결정](../../decision/frontend-decisions.md), 현재 작업 트리의 코드와 시안.
- 완료 기준: **UI/UX 구현과 MSW 검증**으로 판정한다. 메시지 API가 없으므로 실제 서버 연동은 범위 밖이다.

### C-1. 목표와 배경

전체 계획 §M8의 메시지는 「Discord 발송 전 검토 + 개인 스레드. 발송은 외부 효과이므로 서버 성공 후 반영(D-137)」이다. 착수 전 결정 4(메시지 화면 정책 전반)는 아직 없다.

현재 상태는 다음과 같다(2026-10-30 코드 확인).

- [메시지 화면](../../../src/pages/messages/ui/MessagesPage.tsx)은 `EmptyState`로 「메시지는 준비 중이에요」 안내만 보여 준다. API는 부르지 않는다(D-171).
- [라우트](../../../src/app/router/routes.tsx)는 `messages/*` 하나다. 하위 경로가 무엇이든 같은 준비 중 화면이 나온다. [경로 함수](../../../src/shared/config/routes.ts)는 `paths.messages(workspaceId)`뿐이다.
- 메시지 엔티티, DTO 타입, MSW handler·픽스처·시나리오, 스토리는 없다. [MSW 안내](../../msw-guide.md)도 「메시지 API는 M1 mock 범위 밖」이라고 적고 있다.
- 준비 중 문구에 기대는 테스트가 있다: [라우트](../../../src/app/router/routes.test.tsx), [가드](../../../src/app/router/guards.test.tsx)(`messages/threads/1`에서 API 미호출 확인), [앱 셸](../../../src/app/appShell.test.tsx), [늦은 비동기](../../../src/app/lateAsyncRaces.test.tsx), [회의록 경합](../../../src/app/meetingMinutesRaces.test.tsx), [처리 추적](../../../src/app/meetingProcessing.test.tsx). 마지막 셋은 메시지를 「업무 조회가 없는 셸 화면」으로 쓴다.
- [헤더](../../../src/widgets/app-shell/ui/AppHeader.tsx)의 `메시지` 탭은 있고 개수 배지는 없다(집계 API 필요).
- 시안: [Messages](../../design/canvas/Messages.dc.html)·[MessagesThread](../../design/canvas/MessagesThread.dc.html)는 왼쪽 목록(`보내기 전 확인 N`, `대화`·`답장 기다리는 중 N`, 채널 `#회의록 요약`)과 오른쪽 상세(발송 검토 또는 사람별 대화)로 된 2단 구성이다. [EmptyMessages](../../design/canvas/EmptyMessages.dc.html)는 「보낼 메시지가 없어요」와 `알림 규칙 보기` 링크다.

2026-10-30 사용자 답변으로 메시지 API가 없는 상태에서 **UI/UX만** 만들고 데이터는 MSW(D-146)로 대신한다. 이는 D-171의 「엔티티도 MSW 픽스처도 만들지 않는다」와 다르다. 결정 기록의 개정은 이 계획에서 하지 않는다(C-3, C-10 참고).

### C-2. 구현 범위와 제외 범위

#### 구현 범위

- MSW 모드 전용 메시지 화면. 실 API 모드에서는 현재 준비 중 안내를 유지한다(임시 기본값, C-3).
- 결정 전 부분: 2단 레이아웃, 목록·스레드 골격(읽기 전용), 빈 상태(`EmptyMessages`), 로딩·오류 상태, 1024px 이상 반응형, 키보드·스크린리더 접근성.
- 화면이 쓰는 임시 도메인 타입과 조회 경계, 그 경계에 응답하는 MSW handler·픽스처·시나리오.
- Storybook 스토리와 Vitest 통합 테스트.
- 결정 후 부분(선행 결정 대기): 발송 검토 흐름, 권한 분기, 상태 전이와 상태 동기화, 메시지 E2E 시나리오.

#### 제외 범위

- 실제 메시지 API 호출과 서버 연동. API가 생기면 별도 연동 과제로 다룬다.
- 대표 계약 문서의 메시지 절 작성·확정. 임시 경로와 타입을 계약으로 올리지 않는다.
- 실제 Discord 발송과 그 검증.
- 헤더 `메시지` 탭의 개수 배지(집계 API 필요).
- `알림 규칙 보기`의 목적지 화면(시안·결정 없음).
- 1024px 미만 레이아웃(D-124).

### C-3. 선행 결정

| 번호 | 내용 | 상태 | 이 계획의 처리 |
|---|---|---|---|
| 결정 4 | 메시지 화면 정책: 검토 단위, 발송 권한, 스레드 구성, 발송 시점·문구 수정·반려·재발송, 자동 발송 유무 | **해결(2026-11-03, [D-174](../../decision/frontend-decisions.md))** | 아래 임시 기본값으로 결정 전 부분만 진행했다. 정해진 정책에 맞춘 화면 변경은 D-174 「영향」의 코드 과제로 따로 진행한다. C-10의 검토 장소 상충도 D-174에서 해소했다 |
| D-171 개정 | MSW 픽스처·임시 엔티티 허용 | 사용자 답변(2026-10-30)으로 방향 확정. 결정 기록 반영 여부 확인 필요 | 계획은 사용자 답변을 따른다 |
| 화면 노출 범위 | 실 API 모드(production 포함)에서 새 화면을 보일지 | **열림** | 임시 기본값: MSW 모드에서만 새 화면, 그 밖에는 준비 중 유지 |
| D-117 | 메시지 검토·Discord 발송 상태 E2E 시나리오 | 결정 4 이후 고정 | 결정 전에는 메시지 E2E를 추가하지 않는다 |
| D-136 | 메시지 상태 동기화(polling) | 결정 4 이후 결정 | 결정 전에는 polling을 두지 않는다 |
| D-137 | 발송은 서버 성공 후 반영 | 확정 | MSW 모의도 이 원칙을 따른다(C-5) |

결정 4의 임시 기본값은 **최종 결정 아님**이다. 문서 근거가 있는 항목만 둔다.

| 항목 | 임시 기본값 | 근거 |
|---|---|---|
| 화면 구성 | 「보내기 전 확인」과 「사람별 대화」 두 화면, 2단 배치 | [캔버스 주석](../../design/canvas/canvas.json)(「메시지는 승인 화면과 사람별 대화 기록, 두 화면」), 시안 2장 |
| 검토 단위 | 수신자 한 명에게 가는 DM 한 건 | [Messages](../../design/canvas/Messages.dc.html) 목록·상세 |
| 스레드 구성 | 사람별 대화 + 채널 항목 | 시안 목록의 `대화` 영역 |
| 답장 대기 표시 | 발송 뒤 같은 DM 대화에 새 답장이 없으면 「답장 기다리는 중」 | D-057·D-058. 3일 계산 방식은 별도 결정(확인 필요) |
| 발송 버튼 문구 | `이대로 발송`. 화면당 주 액션 1개 | [디자인 시스템](../../design/design-system.md) §1-3·§9-2 |
| 발송 권한 | **기본값 없음** | 문서 근거 없음. 확인 필요 태스크의 PM 전용 규칙(D-102)은 메시지에 적용된다는 근거가 없어 참고만 한다 |
| 발송 시점·문구 수정·반려 | **기본값 없음** | 시안에 `언제 보낼까요?`·`고쳐 쓰기`·`반려`가 있으나 결정 없음 |

화면 노출의 임시 기본값은 D-171의 「내비게이션 항목과 `/messages` 라우트는 유지하고 준비 중 안내」와 기존 모드 분기 선례([승인 처리 경로](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/8a8784abb151eccdb5e99aefe39b758d2b26774e/frontend/src/features/approval-resolve/model/transport.ts)의 `import.meta.env.DEV && config.mswEnabled`)에 근거한다. 이렇게 하면 production과 Vitest 기본 모드의 동작이 바뀌지 않아 위 테스트 6개가 그대로 유지된다.

### C-4. 의존 사항과 관련 문서

- [전체 계획](../frontend-plan.md) §M8, [제품·기술 결정](../../decision/frontend-decisions.md)(D-057, D-058, D-117, D-124, D-128, D-136, D-137, D-146, D-171).
- [대표 계약](../../contracts/frontend-api-contract.md) §5.7: 「1차에서 화면을 만들지 않는다(D-171)」로 남아 있다. 이번 범위에서 고치지 않는다.
- [캔버스 안내](../../design/canvas/README.md), [디자인 시스템](../../design/design-system.md), [MSW 안내](../../msw-guide.md).
- 선례: [M5 계획](../m5/plan.md)(MSW 기반 화면), [M7 계획](../m7/plan.md)(로딩·빈 데이터·부분 오류 구분), [회의록 화면](../../../src/pages/meetings/ui/MeetingsPage.tsx)(목록·상세를 한 화면과 URL로 묶은 예), [MSW 모드 테스트](../../../src/app/approvalsMsw.test.tsx)(`config.mswEnabled`를 테스트 파일 안에서만 바꾸는 예).
- 재사용할 공통 UI: [EmptyState](../../../src/shared/ui/empty-state/EmptyState.tsx), [QueryErrorState](../../../src/shared/ui/query-error-state/QueryErrorState.tsx), [Skeleton](../../../src/shared/ui/skeleton/Skeleton.tsx), [Panel](../../../src/shared/ui/panel/Panel.tsx), [Button](../../../src/shared/ui/button).
- MSW 구조: [시나리오](../../../src/shared/mock/scenarios.ts), [handler 목록](../../../src/shared/mock/handlers/index.ts), [메모리 DB](../../../src/shared/mock/db.ts), [픽스처](../../../src/shared/mock/fixtures).
- 일정: AWS 실습 환경이 **2026-11-20**까지다(전체 계획 「일정 제약」).

### C-5. 발송(D-137)의 MSW 표현

D-137은 확정이므로 원칙만 먼저 정한다. 어떤 조작이 발송을 일으키는지(즉시·예약·승인)는 결정 4 이후 정한다.

- handler는 **성공 응답을 낼 때만** 메모리 DB를 바꾼다. 검토 항목을 지우고 해당 대화에 보낸 메시지를 더한다. 실패 응답은 DB를 건드리지 않는다.
- 화면은 낙관적 업데이트를 하지 않는다. 요청 중에는 `이대로 발송`을 비활성으로 두고 중복 제출을 막는다. 성공 뒤 목록·대화 Query를 무효화해 서버 데이터로 다시 그린다.
- 실패하면 검토 항목을 그대로 두고 해요체 오류(원인 + 다음 행동)를 보여 준다. 성공 표시는 하지 않는다.
- 테스트는 `delay()` 대신 응답을 붙잡아 두는 방식([deferred](../../../src/shared/test/deferred.ts))으로 「응답 전에는 목록이 그대로」를 확인한다([MSW 안내](../../msw-guide.md) 「지킬 규칙」).

### C-6. 구현 순서

결정 전 단계는 순서대로 작은 커밋으로 나눈다. 경로·파일 이름은 제안이며 구현 중 기존 관례에 맞춰 조정할 수 있다.

#### 1. 모드 분기와 라우트 골격 (결정 전)

- `MessagesPage`가 MSW 모드일 때만 새 화면을, 아니면 기존 준비 중 안내를 그린다.
- `messages`(목록, 상세 비움)와 `messages/threads/:threadId`(대화) 하위 경로를 둔다. 검토 항목의 경로는 결정 4 이후 정한다.
- 대상: [MessagesPage](../../../src/pages/messages/ui/MessagesPage.tsx), [경로 함수](../../../src/shared/config/routes.ts)와 그 테스트. `messages/*` 라우트는 그대로 둔다.

#### 2. 임시 엔티티와 MSW 데이터 (결정 전)

- `entities/message`에 임시 도메인 타입(검토 항목, 대화, 메시지), DTO→도메인 매퍼, 조회 Query를 둔다. Query Key에 `workspaceId`를 넣는다(D-136 개정분).
- 조회만 만든다. 발송·반려 요청은 결정 후 단계에서 만든다.
- MSW: 메시지 픽스처, handler, 메모리 DB 항목, 시나리오를 더한다. 경로는 임시이며 계약이 아니라는 주석을 단다. 기준 시각은 기존 `MOCK_NOW`를 쓴다.
- 대상: `src/entities/message/`, `src/shared/mock/fixtures/message.ts`, `src/shared/mock/handlers/message.ts`, [handler 목록](../../../src/shared/mock/handlers/index.ts), [메모리 DB](../../../src/shared/mock/db.ts), [시나리오](../../../src/shared/mock/scenarios.ts), [MSW 안내](../../msw-guide.md)의 메시지 범위 문장.

#### 3. 2단 레이아웃과 목록 골격 (결정 전)

- 왼쪽 목록: `보내기 전 확인`과 `대화` 두 영역. 항목은 아바타(이름 1~2자, 회색 원), 이름, 요약 한 줄, 날짜.
- 오른쪽 상세: 선택 없음, 검토 항목 자리, 대화 자리. 검토 항목 상세는 읽기 전용 미리보기까지만 그린다. 행동 버튼은 결정 후 단계에서 붙인다.
- 선택은 URL로 표현해 새로고침·뒤로가기에서 복원한다.
- 대상: `src/widgets/message-inbox/`(신규), [MessagesPage](../../../src/pages/messages/ui/MessagesPage.tsx).

#### 4. 대화 골격 (결정 전)

- 날짜 구분선, 보낸 쪽(봇·상대) 구분, 시각을 그린다. 본문의 이모지는 그대로 보여 준다(디자인 시스템 표).
- 「답장 기다리는 중」은 임시 기본값으로 표시한다. 자동 발송·승인자·예정 같은 상태 문구는 결정 후 단계에서 정한다.
- `Discord에서 열기`는 목적지 규칙이 없어 두지 않는다(확인 필요).
- 대상: `src/widgets/message-inbox/`.

#### 5. 빈·로딩·오류 상태 (결정 전)

- 빈 상태: `EmptyState`로 「보낼 메시지가 없어요」와 시안 설명문. `알림 규칙 보기`는 목적지가 없어 두지 않는다(확인 필요).
- 로딩: 목록·상세 각각 스켈레톤. 오류: `QueryErrorState`로 다시 시도.
- 목록 오류와 대화 오류를 따로 다룬다. 빈 데이터를 오류로, 오류를 빈 데이터로 보이지 않는다.

#### 6. 반응형·접근성과 스토리 (결정 전)

- 1024/1440/1920px에서 페이지 가로 스크롤 없이 목록과 상세가 각자 세로로 스크롤한다(D-124).
- 키보드로 목록 이동·선택, 포커스 표시, 선택 항목의 `aria-current`, 영역 제목과 접근 가능한 이름, 색에 기대지 않는 상태 표현(D-128).
- 스토리: 기본, 빈 상태, 로딩, 목록 오류, 대화 오류, 긴 대화.
- 대상: `src/widgets/message-inbox/` 스토리, Vitest 통합 테스트(`src/app/` 아래 MSW 모드 파일).

#### 7. 발송 검토 흐름 (선행 결정 대기)

결정 4 이후 내용을 정한다. C-5의 원칙을 따른다.

#### 8. 권한 분기 (선행 결정 대기)

발송 권한과 일반 팀원 노출 범위가 정해지면 정한다.

#### 9. 상태 전이와 동기화 (선행 결정 대기)

검토·예약·발송·실패·반려 상태와 polling 여부는 결정 4와 D-136 이후 정한다.

#### 10. E2E 시나리오 고정 (선행 결정 대기)

D-117에 따라 결정 4 이후 고정한다.

### C-7. MSW 시나리오 제안

기존 시나리오처럼 `ws_01` 하나에 PM으로 로그인한다. 결정 후 시나리오는 이름만 예약하고 내용은 정하지 않는다.

| 시나리오 | 단계 | 내용 |
|---|---|---|
| `messages-default` | 결정 전 | 검토 2건, 대화 4건(답장 대기 1건 포함), 채널 1건 |
| `messages-empty` | 결정 전 | 검토·대화 모두 없음 → `EmptyMessages` |
| `messages-list-error` | 결정 전 | 목록 조회 5xx |
| `messages-thread-error` | 결정 전 | 목록 정상, 특정 대화 조회 5xx |
| `messages-send-success` | 선행 결정 대기 | 발송 성공 뒤 반영 |
| `messages-send-fail` | 선행 결정 대기 | 발송 실패, DB 변경 없음 |
| `messages-member` | 선행 결정 대기 | 일반 팀원 시점 |

로딩은 시나리오로 만들지 않고 테스트·스토리에서 응답을 붙잡아 재현한다.

### C-8. 실제 API가 생겼을 때 바꿀 지점

화면 계층은 DTO를 직접 import하지 않고 엔티티의 도메인 타입만 쓴다([MSW 안내](../../msw-guide.md) 「지킬 규칙」). 연동 때 바뀌는 곳은 다음으로 한정한다.

- `entities/message`의 요청 경로·DTO 타입·매퍼. DTO는 실제 OpenAPI 생성 타입으로 바꾼다(D-146).
- MSW handler·픽스처를 실제 경로와 응답에 맞춘다.
- `MessagesPage`의 모드 분기를 없애고 실 API 모드에서도 새 화면을 그린다. 준비 중 문구에 기대는 테스트 6개를 함께 고친다.
- [대표 계약](../../contracts/frontend-api-contract.md) §5.7을 갱신한다(contract-update).

### C-9. 완료조건과 검증

결정 전 부분의 완료조건만 정한다. 결정 후 부분의 완료조건은 결정 4 이후 이어지는 번호로 더한다.

| ID | 완료조건 | 검증 방법 |
|---|---|---|
| AC-01 | 실 API 모드에서 메시지 경로는 기존 준비 중 안내를 그대로 보이고 메시지 요청을 보내지 않는다 | 기존 라우트·가드·앱 셸 테스트 통과, `build` 뒤 `dist/assets/*.js`에서 `msw`·메시지 픽스처 문자열 0건 |
| AC-02 | MSW 모드에서 목록 두 영역과 상세 영역이 시안 배치대로 그려지고, 선택이 URL로 복원된다 | MSW 모드 Vitest 통합 테스트, Storybook |
| AC-03 | 대화 골격이 날짜 구분·보낸 쪽·시각·답장 대기를 구분해 보인다 | 통합 테스트, Storybook |
| AC-04 | 빈 상태·로딩·목록 오류·대화 오류가 서로 구분되고, 한쪽 오류가 다른 쪽을 막지 않는다 | 통합 테스트(`messages-empty`·`messages-list-error`·`messages-thread-error`, 응답 대기), Storybook |
| AC-05 | 워크스페이스를 바꾸면 이전 공간의 메시지가 보이지 않는다 | 통합 테스트 |
| AC-06 | 1024/1440/1920px에서 페이지 가로 스크롤이 없고 목록·상세가 각자 스크롤된다 | 수동 화면 확인(결과를 result.md에 기록) |
| AC-07 | 키보드만으로 목록 이동·선택·상세 확인이 되고, 포커스 표시·접근 가능한 이름·색 외 상태 표현이 있다 | 통합 테스트(역할·이름 조회), 수동 키보드 확인 |

#### 최종 게이트

Node 24에서 다음을 실행하고 Node 버전과 결과를 `result.md`에 기록한다.

- `typecheck`, `lint`, `format:check`, `test`, `build`
- Storybook 회귀(`build-storybook`, `test:storybook`)
- 기존 E2E(`test:e2e`) 회귀. 메시지 E2E 시나리오는 D-117에 따라 결정 4 이후 추가한다.

### C-10. 위험 및 미결 사항

- **D-171과 지시의 불일치**: D-171은 「엔티티·MSW 픽스처를 만들지 않는다」로 확정돼 있다. 2026-10-30 사용자 답변은 이를 바꾼다. 결정 기록에 반영할지 확인이 필요하다.
- **MSW와 「API 호출 코드를 만들지 않는다」의 관계**: MSW는 HTTP 요청을 가로채므로 화면이 임시 경로로 요청을 보내야 한다. 이 계획은 「실 API 호출·계약을 만들지 않는다」로 해석했다. 다른 뜻이면 C-6의 2단계를 바꿔야 한다(확인 필요).
- **배포 화면**: 임시 기본값에서는 production이 계속 준비 중을 보인다. 2026-11-20까지의 시연에서 메시지 화면을 보여야 하는지 확인이 필요하다.
- **임시 모델 재작업**: 시안 기반 타입이 결정 4나 실제 API와 크게 다를 수 있다(D-171의 우려). 조회 전용·최소 필드로 줄여 위험을 낮춘다.
- **시안 안의 상충**: 보내기 전 확인 화면(`이대로 발송`·`보내지 않음`)과 대화 화면(`승인`·`반려`)에 각각 승인 행동이 있다. 어느 쪽이 검토 장소인지는 결정 4의 범위다.
- **일정**: 2026-11-20까지 약 3주다. 결정 4가 늦어지면 결정 후 부분이 기간 안에 들어오지 못할 수 있다.
- **경로 이름**: `messages/threads/:threadId`는 기존 가드 테스트가 쓰는 하위 경로 예와 맞췄을 뿐 확정된 규약이 아니다.
- **병합**: 같은 파일의 A·B 절이 다른 브랜치에서 작성된다. 파일 머리말이 겹칠 수 있다.

### C-11. 이슈 #245 체크리스트 대응

| 이슈 항목 | 이 계획의 위치 |
|---|---|
| 범위 후보: Discord 발송 전 검토 화면 | C-6 3단계(골격), 7단계(흐름, 선행 결정 대기) |
| 범위 후보: 개인 스레드 | C-6 4단계 |
| 범위 후보: 발송은 서버 성공 후 반영(D-137) | C-5, C-6 7단계 |
| 범위 후보: 빈 상태 `EmptyMessages` | C-6 5단계, AC-04 |
| 선행 결정: 메시지 화면 정책(결정 4) | C-3 (열림) |
| 선행 결정: 메시지 API 없음, UI/UX만 | C-1, C-2, C-8 |
| 선행 결정: D-117 E2E 범위 | C-3, C-6 10단계 |
| 세부 작업: 계획을 plan.md C 절에 기록 | 이 절. 결정 전 부분만 정했다 |
| 세부 작업: 구현 항목·AC를 이슈에 채움 | AC-01~AC-07을 이슈에 옮기는 일은 남아 있다 |
| 완료조건: Node 24 게이트, Storybook, E2E | C-9 최종 게이트 |

## M8 2차 결정 대기 항목

후속 결정과 계획을 추가할 자리다. 이번 작성에서 내용을 확정하지 않는다.

## 작성 내역

- 2026-10-30: 대상 파일이 0바이트임을 확인한 뒤, 사용자의 “반영해서 작성” 승인에 따라 앞선 M8-A 초안을 최초 반영했다. 공통 이슈·브랜치·워크트리 대응표와 충돌 방지 원칙을 추가하고, B·C에 같은 날짜의 사용자 답변과 남은 질문을 기록했다. B·C의 AC·구현 순서는 만들지 않았다.
- 2026-11-02: 세 브랜치(#243·#244·#245)에서 따로 쓴 계획을 이 파일 하나로 합쳤다. A의 머리말·공통 범위·A 절을 바탕으로, 10/30 자리 표시였던 B·C 절을 각 브랜치의 실제 B·C 절로 바꿨다. B 절 안의 「작성 내역」은 그 브랜치의 기록이라 그대로 두었다. 머리말의 근거·상태, 브랜치 충돌 방지의 실제 진행, A 절의 보기 URL 답변(`?view=` 유지)만 고쳤고 나머지 문장은 바꾸지 않았다.
