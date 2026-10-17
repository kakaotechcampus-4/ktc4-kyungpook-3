# E-04 키보드로 되돌리기에 성공하면 포커스가 사라진다

- 심각도: Claude 지적 없음 / Codex P2
- 관련 AC: AC-06 키보드 이동·모달 포커스
- 상태: 해결 (2026-10-18)

## 문제

되돌리기에 성공하면 `frontend/src/widgets/dashboard/ui/RecentSection.tsx:269`에서 되돌리기 버튼이 새 `확인 필요 보기` 링크로 바뀐다.

공통 `Modal`의 포커스 복귀(`frontend/src/shared/ui/modal/Modal.tsx`의 `onCloseAutoFocus`)는 모달을 연 요소가 문서에 남아 있을 때만 작동한다. 성공 시에는 캐시 갱신으로 그 버튼이 먼저 사라진다. 그래서 포커스가 `document.body`로 떨어진다.

## 재현

1. 키보드로 되돌리기 버튼에 이동해 Enter로 모달을 연다.
2. 확인 버튼에서 Enter를 누른다.
3. 모달이 닫힌 뒤 `document.activeElement === document.body`가 된다.
4. 같은 행에서 키보드로 다음 작업을 이어갈 수 없다.

Codex가 실제 앱·MSW에서 재현했다. 기존 통합 테스트는 Esc·취소 후 복귀만 검사한다. E2E 성공 경로도 모달이 닫힌 뒤의 포커스를 검사하지 않는다.

## 위반 기준

[계획](../plan.md) AC-06: "키보드 이동·모달 포커스"

## 해결 방향

- 성공하면 해당 행의 새 `확인 필요 보기` 링크로 포커스를 옮긴다.
- E-01을 해결하면 팀원에게는 이 링크가 없다. 다만 되돌리기는 PM만 하므로 이 경로에 영향은 없다.
- 취소·실패 시에는 기존처럼 원래 버튼으로 복귀한다.
- 통합 테스트나 E2E에 다음 단언을 추가한다: 성공 후 포커스가 새 링크에 있다.

## 원인과 결정 과정 (2026-10-18 논의)

### 원인: 성공 처리 순서

`useAutoItemRevert`의 `onSuccess`는 다음 순서로 진행된다.

1. 추출 캐시에 `revertedAt`·새 `approvalId`를 바로 쓴다.
2. 행이 다시 그려지며 되돌리기 버튼이 `확인 필요 보기` 링크로 바뀐다. 버튼은 DOM에서 빠진다.
3. 그다음 모달이 닫힌다.

공통 `Modal`은 닫힐 때 연 요소로 포커스를 돌려준다. 하지만 그 요소가 DOM에 없으면 아무것도 하지 않는다(`!target.isConnected`). 모달은 대신 갈 곳을 모르고, 행에도 포커스를 받아 가는 코드가 없다.

### 결정: 행에서 옮긴다 (A안)

- 공통 `Modal`에 「연 요소가 사라지면 갈 곳」 옵션을 넣는 B안은 쓰지 않았다. 모든 모달의 공통 동작을 바꿔야 해서 범위가 크다.
- 옮기는 곳은 새 `확인 필요 보기` 링크다. 같은 자리에 생기고, 되돌린 뒤 PM이 다음에 할 일이 그 확인 필요 처리다. 되돌리기는 PM만 하므로 링크는 늘 있다.
- 경계 조건
  - 포커스가 `body`일 때만 옮긴다. 사용자가 옮겼으면 뺏지 않는다.
  - 링크가 없는 응답이면 행 자체로 옮긴다.
  - 취소·Esc·실패에서는 버튼이 남는다. 그래서 공통 모달이 지금처럼 원래 버튼으로 돌린다.

## 해결 (2026-10-18)

사용자 결정 A안: 공통 `Modal`은 바꾸지 않고, 행이 포커스를 옮긴다.

- [RecentSection](../../../../src/widgets/dashboard/ui/RecentSection.tsx)의 `RecentRow`가 처리한다. 행이 이미 받는 되돌리기 결과(`outcome.kind === 'reverted'`)로 「방금 이 행을 되돌렸음」을 안다.
- **언제 옮기나:** 확인 모달이 닫힌 뒤(`RecentList`가 넘기는 `confirmOpen`)에 다음 태스크(`setTimeout 0`)에서 판단한다. Radix의 포커스 복귀(`onCloseAutoFocus`)는 모달이 닫히는 커밋에서 예약돼 그보다 먼저 끝난다.
- **조건:** 그때 포커스가 `document.body`(또는 없음)일 때만 옮긴다. 사용자가 이미 다른 요소로 옮겼으면 뺏지 않는다. [Modal](../../../../src/shared/ui/modal/Modal.tsx)과 같은 규칙이다.
- **옮기는 곳:** 그 행의 새 `확인 필요 보기` 링크다. 링크가 없는 응답(승인 ID 없음 등)이면 행 자체로 옮긴다. 행은 `tabIndex={-1}`이고 접근 가능한 이름은 `aria-labelledby`로 제목과 상태 배지(`자동 반영 — 제목 되돌림`)다.
- **링크 찾기:** 공통 `GuardedLink`가 ref를 받지 않아 행 안의 링크(`a[href]`)를 찾는다. 이 행의 링크는 하나뿐이다.
- **한 번만:** 같은 결과로는 한 번만 옮긴다(결과 객체를 ref에 기록). 재렌더·재조회·polling이 포커스를 뺏지 않는다.
- **그 밖의 경우:** 취소·Esc·거부·네트워크 실패에서는 버튼이 남는다. 그래서 공통 Modal이 지금처럼 원래 버튼으로 돌린다.

### 검증 (Node v24.21.0, `frontend/`, 2026-10-18)

| 명령 | 결과 |
|---|---|
| 수정 전 `npx vitest run src/app/dashboard.test.tsx -t "E-04"` | 링크·행 포커스 테스트 2개 실패. 「뺏지 않음」 테스트는 수정 전에도 통과한다(포커스를 옮기지 않던 동작과 같은 결과라 가드로만 의미가 있다) |
| 수정 후 `npx vitest run src/app/dashboard.test.tsx` | 45 passed. 2회 더 반복해 모두 45 passed. 기존 취소·Esc 복귀 테스트 포함 |
| `npm run typecheck`·`npm run lint`·`npm run format:check` | 모두 exit 0 |
| `npx vitest run src/app/dashboard.test.tsx src/widgets/dashboard src/shared/mock/dashboardScenarios.test.ts src/entities/extraction src/features` | 20 files / 285 tests 통과 |
| `npx playwright test e2e/dashboard.e2e.ts` (포트 5211) | 4 passed |

[dashboard.test.tsx](../../../../src/app/dashboard.test.tsx) 「키보드·포커스 (AC-06)」에 통합 테스트 셋을 추가했다.

- 키보드로 되돌리기 버튼 Enter → 모달 `되돌리기` Enter → 성공 후 포커스가 그 행의 `확인 필요 보기` 링크. 사용자가 다른 요소로 옮긴 뒤에는 다시 끌어오지 않는다
- 성공 응답의 `approval_id`가 없으면 포커스가 그 행이고, 행의 이름에 제목이 있다
- 응답 전후로 사용자가 다른 요소에 둔 포커스를 뺏지 않는다

[dashboard.e2e.ts](../../../../e2e/dashboard.e2e.ts) 키보드 되돌리기 시나리오에도 단언을 더했다. 성공 뒤 `확인 필요 보기` 링크에 포커스가 있고, 이어서 Enter로 확인 필요 상세에 간다.

전체 게이트는 PR 직전에 하기로 해 이번에는 실행하지 않았다.
