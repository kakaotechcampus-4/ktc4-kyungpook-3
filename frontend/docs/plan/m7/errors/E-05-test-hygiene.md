# E-05 테스트 이름·헬퍼 정확도

- 심각도: Claude 낮음 / Codex 지적 없음
- 관련 AC: 없음. 테스트 신뢰도 문제다.
- 상태: 해결 (2026-10-18)

## 1. 테스트 이름과 단언이 반대다

### 문제

`frontend/src/app/dashboard.test.tsx:596`의 테스트 이름과 본문이 반대다.

- 이름: "이미 되돌린 항목이면 **안내하고**, 다시 받은 상태로 `되돌림` 을 보인다"
- 본문(`:604`): `이미 되돌린 항목이에요.` 문구가 **없음**을 단언한다.

동작 자체는 [결과 문서](../result.md)의 결정과 맞는다. 결과 문서는 `already_reverted`를 문장으로 안내하지 않고 `되돌림` 상태로만 보이게 정했다.

### 해결 방향

이름을 "이미 되돌린 항목이면 따로 안내하지 않고, 다시 받은 상태로 `되돌림`을 보인다"로 고친다.

## 2. `isDashboardRequest`가 모든 추출 조회를 통과시킨다

### 문제

`frontend/src/shared/test/requests.ts:102`의 `EXTRACTION_PATH`는 모든 `GET /extractions/:id`를 대시보드 요청으로 인정한다. 최신 완료 회의의 추출만 인정해야 한다.

### 실패 시나리오

셸이나 가드가 다른 회의·공간의 추출을 잘못 부르는 회귀가 생겨도 테스트가 통과한다. 해당 테스트는 boot·guards·appShell의 "그 밖의 업무 요청 없음" 단언이다.

### 해결 방향

헬퍼가 허용할 추출 ID를 인자로 받게 한다. 테스트가 아는 최신 완료 회의의 추출만 허용한다.

## 원인과 결정 과정 (2026-10-18 논의)

### 1. 테스트 이름

- 이 테스트는 이런 상황이다. 다른 탭에서 먼저 되돌린 항목을 대시보드에서 다시 되돌린다. 서버가 409 `already_reverted`로 거부한다.
- 실제 동작은 의도된 결정이다. 거부 뒤 다시 받은 추출에서 그 행은 이미 되돌린 상태다. 그래서 안내 문장을 숨기고 `되돌림` 상태만 보인다(`RecentSection`의 `message` 계산).
- 계획은 `already_reverted`도 사유별로 안내한다고 했다. 처음에는 그 계획대로 이름을 지었다. 구현 중 「상태 우선」으로 바꾸면서 단언만 고치고 이름을 남겼다.
- 이름이 명세 역할을 하므로, 이름을 단언에 맞췄다.

### 2. `isDashboardRequest`

- 다른 대시보드 조회는 경로에 공간 ID가 있어 공간까지 맞아야 했다.
- 추출 경로(`/extractions/{id}`)에는 공간 ID가 없다. 헬퍼는 모양만 봤다.
- 그래서 다른 공간·예전 회의의 추출을 잘못 불러도 「그 밖의 업무 요청 없음」 단언이 통과했다.
- 대시보드는 추출 ID를 회의 목록 → 최신 완료 회의 상세에서 알아낸다. 헬퍼가 그 ID를 받지 않아 모양으로 대신 판단했다. 테스트는 MSW 픽스처로 그 ID를 알 수 있다.

## 해결 (2026-10-18)

테스트 코드만 고쳤다. 앱 동작은 바꾸지 않았다.

1. **테스트 이름** — [dashboard.test.tsx](../../../../src/app/dashboard.test.tsx)의 이름을 「이미 되돌린 항목이면 따로 안내하지 않고, 다시 받은 상태로 `되돌림` 을 보인다」로 바꿨다. 단언은 그대로다.
2. **`isDashboardRequest`** — [requests.ts](../../../../src/shared/test/requests.ts)에서 모양만 보던 `EXTRACTION_PATH`를 없앴다.
   - **두 번째 인자:** 이제 `{ workspaceId?, extractionId? }`를 받는다. 넘긴 추출 ID의 `GET /extractions/{id}`만 대시보드 요청으로 인정한다.
   - **공간 기본값:** 기존처럼 ws_01이다.
   - **`latestDoneExtractionId(workspaceId?, state?)`:** 모의 db에서 그 공간의 최신 완료 회의(시작 시각이 가장 늦은 `done`)의 추출 ID를 읽는다. ID를 테스트에 하드코딩하지 않는다.
   - **사용처:** [boot.test.tsx](../../../../src/app/boot.test.tsx), [guards.test.tsx](../../../../src/app/router/guards.test.tsx), [appShell.test.tsx](../../../../src/app/appShell.test.tsx) 셋 다 `{ extractionId: latestDoneExtractionId() }`를 넘긴다.
   - **추출 ID를 넘기지 않으면(또는 null):** 어떤 추출 조회도 인정하지 않는다. 그 편이 안전하다고 판단했다. 기본값이 「모든 추출 허용」이면 ID를 빠뜨린 호출이 이번 문제를 그대로 되살린다. 기존 호출은 위 세 곳뿐이고 모두 이번에 ID를 넘기도록 고쳤으므로 호환 문제가 없다. ID를 빠뜨린 호출은 추출 조회 때문에 실패해 바로 드러난다.

### 검증 (Node v24.21.0, `frontend/`, 2026-10-18)

| 명령 | 결과 |
|---|---|
| 수정 전 `npx vitest run src/shared/test/requests.test.ts` (새 헬퍼 테스트) | 4개 모두 실패 |
| 수정 후 같은 명령 | 4 passed |
| `npm run typecheck`·`npm run lint`·`npm run format:check` | 모두 exit 0 |
| `npx vitest run src/shared/test src/app/boot.test.tsx src/app/router/guards.test.tsx src/app/appShell.test.tsx src/app/dashboard.test.tsx src/widgets/dashboard src/shared/mock/dashboardScenarios.test.ts src/entities/extraction src/features` | 25 files / 348 tests 통과 |

**새 헬퍼 테스트** — [requests.test.ts](../../../../src/shared/test/requests.test.ts)가 네 가지를 본다.

- 최신 완료 회의 추출 읽기: 정리 중 회의는 빼고, 회의를 지우면 다음 회의로 넘어가고, 회의가 없는 공간은 null
- 넘긴 ID만 인정: 다른 추출 ID, 되돌리기 경로, POST는 아니다
- ID를 빼면 추출 조회는 인정하지 않는다
- 공간 기본값

**임시 확인** — 커밋하지 않는 임시 테스트 파일로 확인하고 바로 지웠다. 대시보드 착지 중에 다른 회의의 추출(`GET /extractions/ex_00`)을 하나 더 부르게 했다. boot와 같은 「그 밖의 업무 요청 없음」 단언이 `/extractions/ex_00`을 남은 요청으로 내며 실패했다. 고치기 전 헬퍼라면 이 요청이 통과했다.

전체 게이트는 PR 직전에 하기로 해 이번에는 실행하지 않았다.
