# 계획 — 태스크 상세 재조회 실패 안내 수정 (#236)

- 작성일: 2026-10-18
- 상태: 구현 전 계획. 완료 판정과 테스트 성공 기록은 포함하지 않는다.
- 근거: 이슈 #236, 현재 작업 트리의 코드, 사용자 지시(2026-10-18: `plan/refactor/`에 작업 계획 파일 작성, 안내는 본문에만 추가).
- 위치: [전체 계획](../frontend-plan.md)의 M0~M8 번호에 속하지 않는 수정 계획이다. 원 구현은 [M6 계획](../m6/plan.md)이고, 같은 문제를 대시보드에서 먼저 고친 기록은 [E-02](../m7/errors/E-02-refetch-error-hidden.md), 이 건의 분리 기록은 [E-06](../m7/errors/E-06-m6-detail-refetch-error-hidden.md)이다. 전체 계획·기존 마일스톤 계획은 수정하지 않는다.

## 목표와 배경

태스크 상세를 연 채 Notion `반영 대기`를 3초마다 확인하는 도중 재조회가 실패하면 polling이 멈추는데, 화면은 마지막으로 받은 `반영 대기`를 안내 없이 계속 보여 준다.

원인은 같은 조회를 두 곳이 다르게 읽는 데 있다.

- 화면([TaskDetail.tsx](../../../src/widgets/task-detail/ui/TaskDetail.tsx))은 `task.data`가 있으면 `task.error`를 보지 않고 본문을 그린다.
- polling([notionSyncRefetchInterval](../../../src/features/task-notion-sync/model/useTaskNotionSync.ts))은 `status === 'error'`면 멈춘다. 이 중단 자체는 의도된 동작이다([결정 기록](../m6/basis-for-decision/2026-10-11-notion-polling-stops-on-query-error.md)).

기존 데이터는 유지하면서 **`최신 상태를 받지 못했어요 · 다시 시도`**를 보여 주고, 재조회가 성공하면 정상 동작으로 복구한다. 화면과 polling이 같은 판정 함수를 보게 한다. 안내는 상세 본문에만 둔다(사용자 선택).

## 현재 구현과 차이

| 경계 | 현재 | 필요한 변경 |
|---|---|---|
| 판정 함수 | 대시보드에만 있다([queryView.ts](../../../src/shared/lib/query-view/queryView.ts)) | `shared/lib/query-view`로 이동하고 공개 진입점을 만든다. 대시보드도 공통 함수를 참조한다 |
| 상세 화면 | `data`가 있으면 오류를 무시한다 | `queryView`로 판정해 `refreshFailed`면 본문 위에 안내·다시 시도를 둔다 |
| polling 입력 | `{ state: { status, data } }` | `{ state: { data, error } }`로 바꾸고 `queryView(state) === 'ready'`이면서 `pending`일 때만 3초 |
| 복구 | 없음 | 다시 시도 버튼이 `task.refetch({ cancelRefetch: false })`를 호출한다 |

백엔드 API·DTO 변경은 없다. 바뀌는 것은 공통 함수의 위치와 polling 함수의 내부 입력 타입뿐이다.

## 구현 범위와 제외 범위

- 포함: 판정 함수 이동, 상세의 갱신 실패 안내, polling 판정 변경, 단위·통합 테스트, 구현 후 M6 결과·Frontend README 기록.
- 제외
  - 변경 이력·팀원·회의 조회의 오류 처리 확대. 이번 수정은 태스크 상세 조회의 갱신 실패에 한정한다.
  - 대시보드의 토스트·조회 묶음(`refreshFailure`) 공통화. 안내 UI는 상세 위젯에 둔다.
  - 안내 토스트, 영역별 안내.
  - 전체 계획·기존 마일스톤 계획·사람이 관리하는 트러블슈팅 원문 수정.

## 의존 사항과 관련 문서

- 선행: 대시보드의 `queryView`와 `refreshFailed` 의미(E-02), M6의 Notion polling·재시도([useTaskNotionSync.ts](../../../src/features/task-notion-sync/model/useTaskNotionSync.ts)).
- [M6 결과](../m6/result.md), [Frontend README](../../../README.md): 구현 후 기록 대상.
- 동작 기준: `queryView`는 기존 `loading | error | ready | refreshFailed` 의미를 그대로 유지한다.

| `data` | `error` | `queryView` |
|---|---|---|
| 없음 | 없음 | `loading` |
| 없음 | 있음 | `error` |
| 있음 | 없음 | `ready` |
| 있음 | 있음 | `refreshFailed` |

## 작업 순서

1. **판정 함수 이동.** `queryView`와 단위 테스트를 `shared/lib/query-view`로 옮기고 공개 진입점(`index.ts`)을 만든다. 대시보드([useDashboardData.ts](../../../src/widgets/dashboard/model/useDashboardData.ts) 등)의 import를 공통 경로로 바꾸고 기존 위치의 파일은 남기지 않는다. 판정 로직은 바꾸지 않는다. 저장소의 경계 규칙(import 해석기)에서 `shared/lib` 아래 폴더 구조·진입점 규약을 먼저 확인한다.
2. **polling 판정.** `notionSyncRefetchInterval`의 입력을 `{ state: { data, error } }`로 바꾸고 `queryView(state) === 'ready'`이면서 Notion 상태가 `pending`일 때만 `NOTION_SYNC_POLL_MS`를 돌려준다. `refreshFailed`·`error`·`loading`과 `synced | failed | null`은 `false`다. 호출하는 `useTaskNotionSync`의 타입을 맞춘다.
3. **상세 화면 판정.** `TaskDetail`이 같은 함수로 조회 상태를 판정한다.
   - `ready`·`refreshFailed`: 기존 본문(`TaskBody`)을 그린다.
   - `error`: 접근 불가면 기존 화면, 아니면 기존 `QueryErrorState`.
   - `loading`: 기존 로딩 화면.
4. **갱신 실패 안내.** `refreshFailed`이면 본문 위에 `role="alert"` 안내 하나와 공통 `Button`의 `다시 시도`를 한 번 표시한다.
   - 버튼은 `task.refetch({ cancelRefetch: false })`를 호출해 진행 중인 조회가 있으면 새 요청을 보내지 않는다.
   - 요청 중에는 로딩·비활성이고, 안내는 성공할 때까지 유지한다. 재실패하면 다시 시도할 수 있다.
   - PM·일반 팀원 모두 사용한다. `failed`일 때 PM에게만 `다시 반영하기`가 나타나는 기존 권한은 그대로다.
5. **복구 동작 확인.** 재조회 성공 응답이 `pending`이면 polling이 재개되고, `synced | failed | null`이면 멈추는지 확인한다.
6. **테스트.** 아래 완료조건의 검증을 구현한다. 판정 단위 테스트는 이동한 파일에 두고, polling 테스트와 앱 통합 테스트를 갱신한다.
7. **기록.** 구현 후 #236을 근거로 [M6 결과](../m6/result.md)와 Frontend README에 변경·실제 검증 결과를 기록한다. 계획 대비 달라진 점은 결과에 이유·영향을 남긴다. 중요한 실제 선택은 `m6/basis-for-decision/`에 둔다.

## 완료조건과 검증

| ID | 완료조건 | 검증 방법 |
|---|---|---|
| AC-01 | `queryView`가 `shared/lib/query-view`의 공개 진입점에서 제공되고 4가지 상태의 의미가 이전과 같다. 대시보드는 공통 함수를 참조하며 기존 위치에는 남지 않는다. | 이동한 판정 단위 테스트(데이터·오류 유무 4조합), 대시보드 기존 회귀 테스트, import 검색 |
| AC-02 | `notionSyncRefetchInterval`이 `ready`이면서 `pending`일 때만 3초를 돌려주고, `refreshFailed`·`error`·`loading`·`synced`·`failed`·`null`에서는 `false`를 돌려준다. | polling 단위 테스트 갱신 |
| AC-03 | 첫 조회 성공 후 polling 요청이 500 또는 네트워크 오류로 실패하고 기본 1회 재시도도 실패하면, 이전 상세·Notion 상태를 유지한 채 안내가 하나만 보이고 polling이 멈춘다. | 앱 통합 테스트(500·네트워크 오류 각 1건) |
| AC-04 | `다시 시도`는 요청 중 비활성이고 연속 클릭해도 요청이 중복되지 않는다. | 통합 테스트로 요청 수 확인 |
| AC-05 | 다시 시도가 재실패하면 안내가 남아 다시 시도할 수 있고, 성공하면 안내가 사라진다. | 통합 테스트 |
| AC-06 | 성공 응답이 `pending`이면 polling이 재개되고 `synced`·`failed`면 멈춘다. `failed`면 PM에게만 `다시 반영하기`가 보인다. | 통합 테스트(PM·일반 팀원) |
| AC-07 | 최초 조회 실패의 `QueryErrorState`와 데이터 없는 접근 불가 화면이 이전과 같고, 일반 팀원도 조회 복구 버튼을 쓸 수 있다. | 기존 통합 테스트 무수정 통과, 일반 팀원 케이스 추가 |
| AC-08 | Node 24에서 타입 검사·린트·포맷 검사·전체 Vitest·빌드가 통과하고, 기존 태스크 E2E와 관련 Storybook 검증이 통과한다. | 각 명령 실행 결과를 결과 문서에 그대로 기록 |
| AC-09 | M6 결과와 Frontend README에 #236 변경과 실제 검증 결과가 기록된다. 전체 계획·기존 마일스톤 계획·트러블슈팅 원문은 바뀌지 않는다. | 문서 diff 확인, 보호 문서 시작 상태 대비 비교 |

## 위험 및 미결 사항

- 위험: `shared/lib` 아래에 새 폴더를 둘 때 경계 린트(공개 진입점·계층 규칙)가 막을 수 있다. 1단계에서 먼저 린트를 돌려 확인한다.
- 위험: 통합 테스트의 polling 재시도 타이밍(기본 재시도 간격)이 불안정할 수 있다. 가짜 타이머 사용 여부는 대시보드 E-02 테스트의 방식을 따르고, 반복 실행으로 안정성을 확인한다.
- 미결 사항: 없음. 안내를 본문에만 두는 결정은 사용자 선택이다.

## 결정 기록

- 2026-10-18, 사용자 선택: 갱신 실패 안내는 상세 본문에만 추가하고 토스트는 쓰지 않는다. 공통 토스트가 사라지면 안내가 없는 상태로 돌아가기 때문이다(E-02 기록과 같은 이유).
- 2026-10-18, 사용자 지시: 구현 결과는 이 폴더가 아니라 [M6 결과](../m6/result.md)와 Frontend README에 기록한다.
