# E-02 재조회 실패가 화면에 안 보이고 polling이 조용히 멈춘다

- 심각도: Claude 낮음 / Codex P2. 두 리뷰가 같이 지적했다.
- 관련 AC: AC-03 동기화 polling, AC-05 부분 오류
- 상태: 해결 (2026-10-17)

## 문제

`frontend/src/widgets/dashboard/model/useDashboardData.ts:27`의 `loadable()`은 `query.data`를 `query.error`보다 먼저 검사한다. 한 번 성공한 Query는 재조회에 실패해도 데이터가 남아 있어서 항상 `ready`가 된다.

같은 파일 93~96줄의 태스크 `refetchInterval`은 조회 오류가 나면 polling을 멈춘다. 이 중단 규칙 자체는 M6 `notionSyncRefetchInterval`과 같은 의도된 동작이다. 문제는 멈춘 사실이 화면에 드러나지 않는다는 점이다.

## 재현

1. `dashboard-sync-pending` 시나리오처럼 반영 대기 항목이 있는 상태로 대시보드를 연다.
2. 3초 polling 중 `/tasks` 요청 하나가 500이나 네트워크 오류로 실패한다.
3. polling은 멈춘다.
4. 행은 `반영 대기`로 남는다. 오류 안내와 다시 시도 수단이 없다.
5. 창 포커스나 다른 무효화가 있기 전까지 상태가 그대로다.

Codex가 MSW에서 최초 조회 뒤 `/tasks`를 500으로 바꿔 재현했다. Query는 `status === 'error'`인데 `태스크를 불러오지 못했어요`는 표시되지 않았다.

## 위반 기준

[계획](../plan.md) 구현 순서 5: "로딩·실제 빈 데이터·조회 오류를 구분해 표시한다."

[결과 문서](../result.md)의 오류 구분 주장은 초기 조회 실패에만 맞는다.

## 해결 방향

다음 중 하나를 정한다. M6 태스크 상세가 재조회 실패를 어떻게 보이는지 확인하고 맞춘다.

- `Loadable`에 "데이터 있음 + 갱신 실패" 상태를 추가한다. 기존 데이터는 유지하고, 해당 영역에 "새로 받지 못했어요 · 다시 시도"를 표시한다.
- polling 중 실패만 한두 번 재시도한 뒤 안내한다.

## 원인과 결정 과정 (2026-10-17~18 논의)

### 배경: `반영 대기`

- 태스크는 서버 DB에 바로 생긴다. Notion 페이지는 서버 워커가 나중에 따로 만든다.
- 이 사이 태스크의 `notion_sync_status`는 `pending`이고, 화면에는 `반영 대기`로 보인다.
- 프론트는 서버가 알려 주지 않으니 3초마다 태스크 목록을 다시 받아 `synced`·`failed`로 바뀌는지 본다.

### 원인

- API 응답 한 건(봉투)은 `data`·`error` 중 하나만 담는다. 하지만 React Query의 조회 상태는 응답을 쌓아 둔다.
  - 성공하면 `data`를 바꾸고 `error`를 지운다.
  - 실패하면 `error`를 채우되 이전 `data`는 남긴다.
  - 그래서 「데이터 있음 + 오류 있음」 조합이 생긴다.
- React Query의 `status`는 이 조합과 「처음부터 실패」를 둘 다 `error`로 묶는다.
- 그래서 같은 조회를 두 쪽이 다르게 읽었다.
  - polling 중단: `status === 'error'`를 봐서 실패로 판단하고 멈췄다.
  - 화면(`loadable()`): `data`를 먼저 봐서 `ready`로 그렸다.
- 결과적으로 「멈췄는데 알리지 않는」 상태가 생겼다.
- 오류 테스트는 모두 처음부터 실패하는 경우만 다뤄서 이 경우를 놓쳤다.

### 결정 1: 데이터 유지 + 갱신 실패 표시 (A안)

- 고른 안: 데이터는 유지하고, 갱신에 실패했다는 표시를 띄운다.
- 버린 안
  - **오류 우선:** 한 번의 일시 실패로 요약·목록이 오류 화면으로 바뀐다.
  - **실패해도 polling 계속:** 고장 난 서버에 요청을 계속 보내고, 그동안에도 안내가 없다.
- `{data, error}` 조합을 하나의 판정 함수(`queryView`)로 정했다. 화면과 polling이 같은 판정을 보게 했다. 사용자가 「멈추는 쪽과 그리는 쪽이 보는 값을 맞춰야 한다」고 짚었다.
- 상태는 넷이다.

| `data` | `error` | React Query `status` | `queryView` |
|---|---|---|---|
| 없음 | 없음 | `pending` | `loading` |
| 없음 | 있음 | `error` | `error` |
| 있음 | 없음 | `success` | `ready` |
| 있음 | 있음 | `error` | `refreshFailed` |

- `refreshFailed`는 `Loadable`의 `ready`에 붙는 선택 항목이다. 그래서 `ready`를 그리던 기존 코드는 그대로 이전 데이터를 그린다.

### 결정 2: 안내를 태스크 목록 밖으로 넓힘 (a안)

- 처음 수정은 태스크 목록 조회에만 안내를 붙였다.
- 승인 대기·회의 목록·회의 상세·추출·연동도 재조회 실패가 안내 없이 남는다. 이 조회들은 창 포커스나 무효화 때 다시 받는다.
- 모든 조회로 넓혔다.

### 결정 3: 이름 변경과 중복 안내 제거 (토스트 + 남는 표시)

- **이름 변경:** `stale`은 React Query의 stale(staleTime이 지나 다시 받아도 되는 정상 상태)과 헷갈린다. 그래서 `refreshFailed`로 바꿨다.
- **중복 안내:** 영역마다 안내를 띄우면 조회 하나가 실패해도 안내가 둘 뜬다.
  - 태스크 목록 실패 → 요약, 최근 반영
  - 승인 대기 실패 → 요약, 확인 필요
- **토스트만 쓰지 않은 이유:** 사용자가 토스트를 제안했다. 하지만 공통 토스트는 5초(액션이 있으면 10초) 뒤 사라진다. 사라지면 E-02 상태로 돌아간다.
- **최종안:** 실패가 생길 때 토스트 한 번 + 제목 근처에 남는 표시 하나.
  - 남는 표시에는 영역 이름을 넣는다.
  - 다시 시도는 실패한 조회를 모두 다시 부른다.

### 남긴 것

- M6 태스크 상세도 같은 구조다. [E-06](E-06-m6-detail-refetch-error-hidden.md)으로 분리했다.
- 마감 임박과 그곳에만 쓰는 팀원 목록은 갱신 실패를 알리지 않는다.

## 해결 (2026-10-17)

사용자 결정: A안(데이터 있음 + 갱신 실패 상태를 화면에 보인다)과 판정 일치.

- **판정 일치** — [queryView](../../../../src/widgets/dashboard/lib/queryView.ts)가 Query의 `{data, error}`만 받아 `loading`·`error`·`ready`·`stale`(데이터는 있고 마지막 재조회 실패) 중 하나를 돌려준다. [useDashboardData](../../../../src/widgets/dashboard/model/useDashboardData.ts)의 `loadable()`(화면 상태)과 태스크 `refetchInterval`(실패면 polling 중단)이 모두 이 함수를 쓴다. 이전에는 polling이 `query.state.status`, 화면이 data 우선으로 서로 다른 값을 봤다.
- **A안** — `Loadable`의 `ready`에 `stale?: {error, retry, retrying}`을 더했다. 갱신에 실패하면 기존 데이터를 그대로 그리고, 같은 태스크 목록을 쓰는 요약([Dashboard](../../../../src/widgets/dashboard/ui/Dashboard.tsx))과 최근 반영([RecentSection](../../../../src/widgets/dashboard/ui/RecentSection.tsx)) 아래에 `최신 상태를 받지 못했어요 · 다시 시도`([RefreshFailedNotice](../../../../src/widgets/dashboard/ui/parts.tsx), `role="alert"`)를 띄운다. 다시 시도는 `refetch({cancelRefetch: false})`라 진행 중 조회가 있으면 새로 보내지 않고, 그동안 버튼은 진행 중(`loading`, 비활성)이다. 성공하면 `stale`이 없어져 안내가 사라지고, 반영 대기가 남아 있으면 3초 polling이 다시 돈다. 처음부터 실패한 영역의 기존 오류 표시(`QueryErrorState`)는 그대로다.
- 마감 임박 영역은 같은 태스크 목록을 쓰지만 안내를 두지 않았다. 한 실패에 안내가 세 번 겹치지 않게, 지시의 최소 범위(요약·최근 반영)만 적용했다.
- M6 태스크 상세의 같은 문제는 [E-06](E-06-m6-detail-refetch-error-hidden.md)으로 기록만 했고 고치지 않았다.

### 검증 (Node v24.21.0, `frontend/`)

| 명령 | 결과 |
|---|---|
| 수정 전 `npx vitest run src/app/dashboard.test.tsx -t "E-02"` | 새 테스트 실패 — `최신 상태를 받지 못했어요`를 찾지 못함 |
| 수정 후 같은 명령 | 1 passed |
| `npm run typecheck`·`npm run lint`·`npm run format:check` | 모두 exit 0 |
| `npx vitest run src/app/dashboard.test.tsx src/widgets/dashboard src/shared/mock/dashboardScenarios.test.ts src/entities/extraction src/features` | 19 files / 265 tests 통과 |
| `npx vitest run src/app/dashboard.test.tsx` 3회 반복 | 3회 모두 36 passed |

새 테스트: [dashboard.test.tsx](../../../../src/app/dashboard.test.tsx) 「반영 대기 polling」의 E-02 — 첫 조회 성공 → `/tasks`를 500으로 바꿔 polling 재조회 실패 → `반영 대기`·요약 숫자 유지, 안내 2개(요약·최근 반영), 초기 오류 문구 없음, polling 중단 → 서버 회복 후 다시 시도를 두 번 눌러도 요청 1회 → 안내 사라짐 → 3초 polling 재개. 판정 단위 테스트 [queryView.test.ts](../../../../src/widgets/dashboard/lib/queryView.test.ts)(4가지 상태).

전체 게이트(전체 Vitest·E2E·Storybook·빌드)는 PR 직전에 하기로 해 이번에는 실행하지 않았다.

## 후속: 태스크 밖 조회로 넓힘 (2026-10-18)

> 아래 「세 번째 수정」에서 영역별 안내를 없애고 제목 근처 표시 하나 + 토스트로 바꿨다. 이 절의 조회·영역 매핑과 `refreshFailure` 묶음은 그대로 쓴다. 이 절과 첫 해결 절의 `stale` 이름은 이후 `refreshFailed`로 바뀌었다.

사용자 결정 a: 갱신 실패 안내를 태스크 목록 밖의 조회까지 넓힌다. 판정은 그대로 `queryView` 하나이고 새 판정 경로는 없다.

- **묶음** — [useDashboardData](../../../../src/widgets/dashboard/model/useDashboardData.ts)에 `refreshFailure(...loadables)`를 더했다. 각 `Loadable`의 `ready.stale`(= `queryView`의 `stale`)만 모아, 하나라도 있으면 안내 하나를 돌려준다. 다시 시도는 실패한 조회를 모두 다시 부르고, 묶인 조회 중 하나라도 다시 받는 중이면 `retrying`이다.
- **영역별 묶음** — 한 영역에 안내는 최대 하나다.

| 영역 | 묶는 조회 | 위치 |
|---|---|---|
| 요약 | 태스크, 승인 대기(PM) | 요약 숫자 아래([Dashboard](../../../../src/widgets/dashboard/ui/Dashboard.tsx)) |
| 확인 필요(PM) | 승인 대기 | 영역 머리 아래 |
| 최근 반영 | 태스크, 회의 목록, 회의 상세, 추출, 연동 | 영역 맨 아래([RecentSection](../../../../src/widgets/dashboard/ui/RecentSection.tsx)). 제목 아래 최근 처리 회의 안내도 회의 목록을 쓰므로 여기서 함께 알린다 |
| 마감 임박 | — | 안내 없음(이전과 같다) |

- **팀원 목록 결정** — 팀원 목록은 마감 임박의 담당자 이름에만 쓴다. 마감 임박은 안내를 두지 않는 원칙이라 팀원 목록의 갱신 실패도 안내하지 않는다. 마지막으로 받은 이름이 그대로 보인다.
- 최근 반영의 태스크 안내는 이전에는 목록 아래(`RecentList`)에 있었다. 영역 단위로 옮겨 빈 상태·오류 분기에서도 한 번만 뜬다.

### 후속 검증 (Node v24.21.0, `frontend/`, 2026-10-18)

| 명령 | 결과 |
|---|---|
| 수정 전 `npx vitest run src/app/dashboard.test.tsx -t "E-02 후속"` | 새 테스트 4개 모두 실패 |
| 수정 후 `npx vitest run src/app/dashboard.test.tsx` | 40 passed. 기존 E-02 테스트 포함. 2회 더 반복해 모두 40 passed |
| `npm run typecheck`·`npm run lint`·`npm run format:check` | 모두 exit 0 |
| `npx vitest run src/app/dashboard.test.tsx src/widgets/dashboard src/shared/mock/dashboardScenarios.test.ts src/entities/extraction src/features` | 20 files / 272 tests 통과 |

새 테스트: [dashboard.test.tsx](../../../../src/app/dashboard.test.tsx) 「갱신 실패 안내 — 영역마다 하나」 4개.

- 승인 대기 재조회 실패 → 확인 필요·요약에 안내 1개씩, 목록·확인 대기 숫자 유지 → 다시 시도로 회복
- 추출 재조회 실패 → 최근 반영에만 안내 1개, 행 유지 → 다시 시도로 회복
- 회의 상세·추출 동시 실패 → 최근 반영 안내 1개
- 태스크·승인 대기 동시 실패 → 요약 안내 1개, 다시 시도 한 번이 두 조회를 각 1회 다시 받음

묶음 단위 테스트는 [refreshFailure.test.ts](../../../../src/widgets/dashboard/model/refreshFailure.test.ts)다.

전체 게이트는 PR 직전에 하기로 해 이번에도 실행하지 않았다.

## 세 번째 수정: 이름 변경과 중복 안내 제거 (2026-10-18)

사용자 결정 두 가지.

1. **이름 변경** — React Query의 stale(최신 시간이 지난 정상 상태)과 헷갈리지 않게, 갱신 실패를 뜻하던 `stale`을 `refreshFailed`로 바꿨다. `queryView`의 반환값 `'refreshFailed'`, `Loadable` `ready`의 `refreshFailed` 필드, 변수·주석·테스트 이름이다. 판정 로직은 그대로다.
2. **중복 안내 제거 — 토스트 + 남는 표시(A안)** — 요약·확인 필요·최근 반영의 영역별 `RefreshFailedNotice`를 없앴다.
   - **남는 표시:** 대시보드 제목 아래(최근 처리 회의 안내 밑)에 하나만 둔다([Dashboard](../../../../src/widgets/dashboard/ui/Dashboard.tsx), [RefreshFailedNotice](../../../../src/widgets/dashboard/ui/parts.tsx)). 문구는 `요약·최근 반영의 최신 상태를 받지 못했어요` + `다시 시도`다. 갱신 실패한 조회가 하나라도 있으면 보이고, 회복하면 사라진다.
   - **영역 이름:** [dashboardRefreshFailure](../../../../src/widgets/dashboard/model/useRefreshFailure.ts)가 대시보드 전체 조회를 기존 `refreshFailure` 하나로 묶는다. 영역 이름은 어느 조회가 실패했는지로 정한다. 요약 = 태스크·승인 대기, 확인 필요 = 승인 대기(PM), 최근 반영 = 태스크·회의 목록·회의 상세·추출·연동이다. 마감 임박·팀원 목록은 계속 제외한다.
   - **다시 시도:** 실패한 조회를 모두 다시 부른다. 묶인 조회 중 하나라도 다시 받는 중이면 버튼이 잠긴다.
   - **토스트:** [useRefreshFailureToast](../../../../src/widgets/dashboard/model/useRefreshFailure.ts)가 기존 `toast.show`로 띄운다. key는 `dashboard-refresh-failed` 하나로 고정해 합치고, `다시 시도` 액션을 단다. 띄우는 때는 다음 셋이다. 실패가 이어지는 동안, 그리고 다시 받는 중에는 띄우지 않는다.
     - 갱신 실패가 없던 상태에서 생길 때 한 번
     - 사용자가 다시 시도했는데 또 실패하면 한 번 더
     - 회복한 뒤 다시 실패하면 다시 한 번
   - **토스트 규칙:** 공통 토스트 저장소와 표시 시간(액션이 있어 10초)은 바꾸지 않았다. 그래서 대시보드를 떠난 뒤에도 남은 표시 시간 동안 토스트가 다른 화면에 보일 수 있다. 공통 토스트 동작으로 둔다.
   - **토스트 원칙과의 관계:** [Toast](../../../../src/shared/ui/toast/Toast.tsx) 주석은 「오류는 토스트로 처리하지 않는다 — 사라지면 대체 경로를 놓친다」라고 적는다. 이번 토스트는 알림일 뿐이고, 대체 경로는 제목 근처 표시로 화면에 남는다.
   - **처음부터 실패한 영역:** 기존 오류 표시(`QueryErrorState` 등)는 그대로다.

### 세 번째 수정 검증 (Node v24.21.0, `frontend/`, 2026-10-18)

| 명령 | 결과 |
|---|---|
| 수정 전 `npx vitest run src/app/dashboard.test.tsx -t "E-02"` (새 동작으로 고친 테스트) | 4개 모두 실패 |
| 수정 후 `npx vitest run src/app/dashboard.test.tsx` | 39 passed. 2회 더 반복해 모두 39 passed |
| `npm run typecheck`·`npm run lint`·`npm run format:check` | 모두 exit 0 |
| `npx vitest run src/app/dashboard.test.tsx src/widgets/dashboard src/shared/mock/dashboardScenarios.test.ts src/entities/extraction src/features` | 20 files / 271 tests 통과 |
| `grep -rn -i "stale" src/widgets/dashboard src/app/dashboard.test.tsx` | 1건. [queryView](../../../../src/widgets/dashboard/lib/queryView.ts)의 「React Query 의 stale … 과 다른 뜻」 설명 주석뿐이다. 갱신 실패 의미의 이름은 남지 않았다 |

[dashboard.test.tsx](../../../../src/app/dashboard.test.tsx)의 E-02 테스트를 새 동작으로 고쳤다.

- 「반영 대기 polling」의 E-02 흐름
  - 태스크 재조회가 실패하면 본문 표시 1개(`요약·최근 반영의 최신 상태를 받지 못했어요`), 토스트 1번, 기존 값 유지, polling 중단
  - 실패가 이어지는 동안 토스트는 반복하지 않는다
  - 다시 시도가 또 실패하면 토스트 1번 더
  - 서버 회복 뒤 다시 시도를 두 번 눌러도 요청 1회. 표시가 사라지고 polling이 재개된다
- 「갱신 실패 표시 — 대시보드에 하나」
  - 승인 대기 실패: `요약·확인 필요의…` 표시 1개, 토스트 1번, 목록 유지, 다시 시도로 회복
  - 회의 상세·추출 동시 실패: `최근 반영의…` 표시 1개, 토스트 1번
  - 태스크·승인 대기 동시 실패: `요약·확인 필요·최근 반영의…` 표시 1개, 토스트 1번, 다시 시도 한 번에 두 조회가 각 1회

토스트는 본문 밖 전역 토스터에 같은 문구로 뜬다. 그래서 테스트는 남는 표시를 본문(`main`)에서 찾고, 토스트는 `toast.show` 호출 수(key 기준)로 센다. 스파이는 테스트마다 복원한다.

판정·묶음 단위 테스트([queryView.test.ts](../../../../src/widgets/dashboard/lib/queryView.test.ts), [refreshFailure.test.ts](../../../../src/widgets/dashboard/model/refreshFailure.test.ts))는 이름 변경에 맞췄다.

전체 게이트는 PR 직전에 하기로 해 이번에도 실행하지 않았다.
