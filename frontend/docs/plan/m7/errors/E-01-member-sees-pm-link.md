# E-01 일반 팀원에게 PM 전용 `확인 필요 보기` 링크가 보인다

- 심각도: Claude 중간 / Codex P2. 두 리뷰가 같이 지적했다.
- 관련 AC: AC-05 역할별 접근
- 상태: 해결 (2026-10-17)

## 문제

`frontend/src/widgets/dashboard/ui/RecentSection.tsx:267`의 `reverted` 분기는 `canRevert`(PM 여부)를 보지 않는다. `item.approvalId`만 있으면 `paths.approval(...)` 링크를 그린다. 그런데 `/approvals/:approvalId`는 `RequirePM` 가드 아래에 있다(`frontend/src/app/router/routes.tsx`).

## 재현

1. PM이 최근 반영의 자동 항목을 되돌린다.
2. 일반 팀원이 대시보드를 연다.
3. 행에 `되돌림`과 `확인 필요 보기`가 보인다.
4. 링크를 누르면 PM 가드가 태스크 목록으로 보내고 접근 거부 토스트를 띄운다.

Codex가 member 세션과 되돌린 auto 항목 조합으로 재현했다. 기존 팀원 테스트·Storybook·E2E는 되돌린 항목이 없는 데이터라 이 경우를 잡지 못한다.

## 위반 기준

[계획](../plan.md) 구현 순서 1: "PM 전용 액션은 일반 팀원에게 렌더링하지 않는다"(D-104, D-163).

## 해결 방향

- 링크를 `canRevert`(또는 `isPm`) 조건 안으로 옮긴다. 팀원에게는 `되돌림` 배지만 남긴다.
- `dashboard-member` 시나리오나 통합 테스트에 되돌린 항목을 넣는다. 그 상태에서 링크가 없음을 단언한다.

## 원인과 결정 과정 (2026-10-17 논의)

### 원인

- 행 오른쪽 동작 칸은 세 갈래다.
  - 되돌린 행이면 `확인 필요 보기` 링크
  - 되돌리지 않은 PM 행이면 `되돌리기` 버튼
  - 그 밖에는 없음
- `되돌리기` 갈래에만 `canRevert`(PM 여부)가 붙어 있었다. 링크 갈래는 「되돌렸는가」와 「승인 ID가 있는가」만 봤다.
- 이 두 값은 서버가 모든 팀원에게 같은 추출 데이터로 준다. 그래서 PM이 한 번 되돌리면 팀원 화면에서도 조건이 참이 된다.
- 되돌리기 동작 하나가 화면 요소 둘(버튼, 되돌린 뒤 링크)을 만드는데, 권한은 버튼에만 걸었다.

### 결정

- 링크도 `isPm`으로 막는다. 다른 PM 전용 요소와 같은 조건을 쓴다.
- 함께 확인한 내용
  - 대시보드에서 `/approvals`로 가는 다른 링크 둘은 이미 PM에게만 보인다.
    - 확인 필요 영역(`isPm`일 때만 렌더)
    - 되돌리기 실패 안내(되돌리기 버튼이 PM 전용)
  - 빈 상태의 회의 업로드·Notion 설정 링크도 이미 `isPm`으로 막혀 있다.
- 데이터 노출 문제는 아니었다. 승인 내용은 서버·라우트 가드가 막는다. 누를 수 없는 링크를 보여 주는 UX·계획 위반 문제였다.

## 해결 (2026-10-17)

사용자 결정대로 되돌린 행의 `확인 필요 보기` 링크를 다른 PM 전용 요소와 같은 PM 조건으로 막았다.

- [RecentSection](../../../../src/widgets/dashboard/ui/RecentSection.tsx): 행의 PM 여부 prop을 `canRevert`에서 `isPm`으로 바꿨다. 행 동작 칸 전체를 `!isPm ? null : …`로 감싸 되돌리기 버튼과 되돌린 행의 링크가 같은 조건을 쓴다. 일반 팀원에게는 `되돌림` 배지만 남는다.
- [통합 테스트](../../../../src/app/dashboard.test.tsx) 「역할 (AC-05)」에 「일반 팀원에게 되돌린 행은 `되돌림` 배지만 있고 확인 필요 상세 링크가 없다 (E-01)」를 추가했다. 일반 팀원 + 되돌린 auto 항목(it_02: `reverted_at`·`approval_id` 있음, `task_id` 없음, 태스크 tk_02 삭제) 상태에서 배지가 보이고 링크가 없음을 단언한다.

### 검증 (Node v24.21.0, `frontend/`)

| 명령 | 결과 |
|---|---|
| 수정 전 `npx vitest run src/app/dashboard.test.tsx -t "E-01"` | 새 테스트 실패 — 링크 `not.toBeInTheDocument()` 단언 |
| 수정 후 같은 명령 | 1 passed |
| `npm run typecheck`·`npm run lint`·`npm run format:check` | 모두 exit 0 |
| `npx vitest run src/app/dashboard.test.tsx src/widgets/dashboard src/shared/mock/dashboardScenarios.test.ts src/entities/extraction src/features` | 18 files / 259 tests 통과. 기존 PM 되돌림 테스트 포함 |

전체 게이트(전체 Vitest·E2E·Storybook·빌드)는 이번 수정 뒤 다시 실행하지 않았다.
