# E-03 재생성 승인을 처리해도 행이 `되돌림`과 낡은 링크에 머문다

- 심각도: Claude 중간 / Codex 지적 없음
- 관련 AC: AC-03 동기화 상태 구분
- 상태: 해결 (2026-10-18)

## 문제

`frontend/src/widgets/dashboard/lib/dashboard.ts:105`의 `recentSyncState`는 `revertedAt`이 있으면 무조건 `reverted`를 돌려준다. 이번에 매핑한 `approvalStatus`는 모델에만 있고, 화면에서 읽는 곳이 없다.

백엔드는 재생성 승인이 승인되면 항목의 `task_id`에 새 태스크를 다시 잇는다(`backend/app/api/approvals.py:141`). 이때도 `reverted_at`은 지우지 않고 남긴다.

## 재현

1. PM이 자동 항목을 되돌려 새 확인 필요를 만든다.
2. 그 확인 필요를 승인한다. 태스크가 다시 생긴다.
3. 대시보드 행은 계속 `되돌림`으로 보인다.
4. `확인 필요 보기`는 이미 처리된 승인으로 이동한다.
5. 새 태스크의 Notion 반영 상태도 보이지 않는다.

반려한 경우에도 화면이 같아서 둘을 구분할 수 없다.

## 기준

[계획](../plan.md) 구현 순서 3은 "`reverted_at`이 있으면 `되돌림`을 우선 표시한다"만 정했다. 재생성 승인이 처리된 뒤의 표시는 계획에 없다. 따라서 계획 위반이 아니라 **빈칸**이다.

## 결정할 것

- **(a) 상태별로 나눠 보여 주기:** `되돌림`은 유지하고 `approvalStatus`로 링크·보조 문구를 나눈다.
  - `pending`: `확인 필요 보기`
  - `approved`: 새 태스크 링크. 가능하면 반영 상태도 보인다.
  - `rejected`: 링크 없이 `되돌림(반려)`
- **(b) 이번 M7에서는 손대지 않기:** [결과 문서](../result.md)의 위험·남은 작업에 기록만 한다.

## 원인과 결정 과정 (2026-10-18 논의)

### 원인: 이력 값으로 판정을 끝냈다

행의 지금 상태는 서버 값 세 개를 함께 읽어야 한다. 기존 판정은 이력 값인 `revertedAt` 하나만 보고 바로 끝냈다.

| 값 | 알려 주는 것 | 성격 |
|---|---|---|
| `revertedAt` | 되돌린 적이 있다 | 이력. 지워지지 않는다 |
| `approvalStatus` | 연결된 승인이 지금 대기·승인·반려 중 무엇인가 | 지금 상태 |
| `appliedTaskId` | 지금 연결된 태스크. 서버 `task_id`를 매퍼가 이름만 바꾼 같은 값이다 | 지금 상태. 승인되면 새 태스크로 바뀐다 |

`task_id`는 시점마다 바뀐다.

| 시점 | `task_id` |
|---|---|
| 자동 반영 | 자동 생성 태스크 |
| 되돌린 뒤 | `null` |
| 승인한 뒤 | 새 태스크 |
| 반려한 뒤 | `null` |

### 확인한 전제

승인하면 새 태스크가 다시 연결된다. 되돌리기가 만드는 승인 payload에 `extraction_item_id`가 들어 있기 때문이다(`backend/app/api/extractions.py`의 `approval_payload`). MSW도 같다.

### 함께 고칠 것: polling 조건

- polling은 태스크별로 묻지 않는다. 3초마다 태스크 목록 전체를 받는다.
- `hasPendingSync`는 polling을 켤지만 정하는 스위치다. 이 스위치가 「되돌린 적 없음」인 행만 봤다.
- 그래서 승인으로 다시 생긴 태스크는 경우에 따라 결과가 달랐다.
  - 다른 행이 반영 대기면 우연히 함께 갱신됐다.
  - 혼자 반영 대기면 polling이 켜지지 않아 멈췄다.
- 행 판정을 고치면 이 차이가 화면에 드러난다. 그래서 polling도 「지금 연결된 태스크가 반영 대기인가」라는 같은 기준으로 바꿨다.
- 되돌리기 자체는 서버 응답 한 번으로 끝난다. 그래서 polling 대상이 아니다. 대상은 승인 뒤 다시 생긴 태스크의 Notion 반영이다.

### 결정

- (a)를 다듬었다.
  - 승인된 행: 새 태스크 반영 상태 + 보조 문구
  - 반려된 행: `되돌림` + `반려됨`
  - 처리된 승인으로 가는 링크를 두지 않는다.
  - 승인된 행에는 되돌리기 버튼을 두지 않는다.
- 팀원에게는 승인 존재·상태를 드러내지 않는다(D-104, E-01). 결과 배지만 보인다.
- 원칙: 화면 상태는 지금 상태 값으로 정하고, 이력 값은 보조 표시에만 쓴다.

## 해결 (2026-10-18)

사용자 결정: 행의 지금 상태는 `revertedAt`(이력)만으로 끝내지 않고 `approvalStatus`(연결 승인의 지금 상태)와 `appliedTaskId`(서버 `task_id`, 지금 연결된 태스크)를 함께 읽어 정한다. 위 (a)를 다듬은 안이다.

- **판정** — [dashboard.ts](../../../../src/widgets/dashboard/lib/dashboard.ts)에 `revertOutcome(item)`을 더했다. 되돌리지 않았으면 `null`이다. 되돌린 항목은 셋으로 나눈다.
  - `waiting`: 승인이 대기 중이거나 상태를 모름. 승인됐지만 태스크가 아직 없는 경우도 여기다
  - `approved`: 승인됐고 태스크가 다시 연결됨
  - `rejected`: 반려됨
  
  `recentSyncState`는 `waiting`·`rejected`일 때만 `되돌림`이다. `approved`면 새 태스크의 `notion_sync_status`로 판정한다. 결과는 반영 대기·완료·실패·상태 없음이고, 태스크를 모르면 상태 알 수 없음이다.
- **polling** — `hasPendingSync`에서 「되돌린 적 없음」 조건을 없앴다. 이제 같은 `recentSyncState`가 `pending`인 행이 있는지로 판정한다. 그래서 행 표시와 polling이 같은 기준을 본다(E-02 판정 일치 원칙). 되돌린 뒤 승인돼 다시 생긴 태스크가 반영 대기면 3초 polling이 돈다.
- **표시** — [RecentSection](../../../../src/widgets/dashboard/ui/RecentSection.tsx) 행.
  - PM
    - 승인됨: 새 태스크 반영 상태 배지 + 보조 문구 `되돌린 뒤 승인돼 다시 만들었어요`
    - 반려됨: `되돌림` 배지 + `반려됨` 배지
  - 팀원(D-104·E-01 유지): 승인 존재·상태를 드러내지 않는다. 승인된 행은 반영 상태 배지만, 반려·대기 행은 `되돌림` 배지만 본다.
- **동작(PM)**
  - 대기: 지금처럼 `확인 필요 보기` 링크
  - 승인·반려: 처리된 승인 링크를 두지 않는다
  - 승인으로 태스크가 다시 생긴 행: 되돌리기 버튼을 두지 않는다. 서버가 `already_reverted`로 거부한다
  - 태스크 상세 링크: 되돌리지 않은 행의 기존 패턴(태스크 링크 없음)을 따라 두지 않았다
- 승인·반려 뒤 대시보드가 새 상태를 받는 것은 M6 승인 처리(`useApprovalResolve`의 `syncAfterResolve`)가 태스크·승인·추출 캐시를 무효화하기 때문이다. 코드는 바꾸지 않았고, 아래 통합 테스트가 이 경로를 실제로 탄다. 대시보드 캐시의 최신 시간은 30초라, 무효화가 없으면 돌아와도 이전 값이 보인다.

### 검증 (Node v24.21.0, `frontend/`, 2026-10-18)

| 명령 | 결과 |
|---|---|
| 수정 전 `npx vitest run src/app/dashboard.test.tsx -t "E-03"` | 새 테스트 3개 모두 실패. 승인·반려까지 진행한 뒤 행 상태 단언에서 실패 |
| 수정 후 `npx vitest run src/app/dashboard.test.tsx` | 42 passed. 2회 더 반복해 모두 42 passed |
| `npm run typecheck`·`npm run lint`·`npm run format:check` | 모두 exit 0 |
| `npx vitest run src/app/dashboard.test.tsx src/widgets/dashboard src/shared/mock/dashboardScenarios.test.ts src/entities/extraction src/features` | 20 files / 282 tests 통과 |

[dashboard.test.tsx](../../../../src/app/dashboard.test.tsx)의 「되돌린 뒤 승인·반려 (E-03)」 묶음에 통합 테스트 셋을 추가했다(MSW).

- **승인**
  - 흐름: 대시보드에서 되돌리기 → `확인 필요 보기` → 확인 필요 상세에서 승인 → 대시보드로 복귀
  - 결과: 새 태스크(tk_90) `반영 대기` 배지와 보조 문구, 링크·버튼 없음
  - polling: 이 행만 반영 대기여도 3초 polling이 돌고, `synced`가 되면 `반영 완료`로 바뀐 뒤 멈춘다
- **반려**: 같은 흐름으로 반려하면 `되돌림`+`반려됨`, 링크·버튼 없음
- **팀원**: 승인된 행(it_01)은 `반영 완료` 배지만, 반려(it_02)·대기(it_03) 행은 `되돌림`만 본다. 승인·반려 문구와 링크가 없다

단위 테스트는 [dashboard.test.ts](../../../../src/widgets/dashboard/lib/dashboard.test.ts)에 두었다. `revertOutcome` 6가지 조합, 되돌린 행의 `recentSyncState` 조합, `hasPendingSync`와 행 판정의 일치를 본다.

전체 게이트는 PR 직전에 하기로 해 이번에는 실행하지 않았다.
