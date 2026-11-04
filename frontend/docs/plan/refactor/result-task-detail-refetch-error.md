# 결과 — 태스크 상세 재조회 실패 안내 수정 (#236)

- 기록일: 2026-10-18(구현·최초 기록), 2026-10-30(Storybook 스토리 추가·끊어진 링크 연결·독립 검증 반영)
- 대상: [계획](plan-task-detail-refetch-error.md) 작업 순서 1~7과 완료조건 AC-01~09
- 상태: **프론트 구현과 MSW 기준 검증, 갱신 실패 Storybook 스토리 추가, 읽기 전용 독립 검증(Codex)을 마쳤다.** AC-09의 착수 전 기준 대비 보존은 검증불가다. 실제 백엔드·Notion에 붙인 확인은 하지 못했다(아래 「남은 작업과 제한 사항」). 커밋·PR 전이다.

## 작업 근거와 요약

태스크 상세를 연 채 Notion `반영 대기`를 3초마다 확인하는 도중 재조회가 실패하면 polling은 멈췄지만, 화면은 `task.data`가 있다는 이유로 오류를 보지 않고 마지막 `반영 대기`를 안내 없이 보여 주었다([E-06](../m7/errors/E-06-m6-detail-refetch-error-hidden.md)). 화면과 polling이 같은 조회를 다르게 읽은 것이 원인이다.

대시보드에서 같은 문제를 고친 판정 함수 `queryView`([E-02](../m7/errors/E-02-refetch-error-hidden.md))를 공통 위치로 옮겨 상세 화면과 polling이 함께 쓰게 했다. 갱신에 실패하면 기존 본문을 유지하고 본문 위에 `최신 상태를 받지 못했어요 · 다시 시도`를 보이며, 재조회가 성공하면 사라진다.

| 항목 | 내용 |
|---|---|
| 기준 | HEAD `ff9467e` 위 작업 트리(브랜치 `fix/236-task-detail-refetch-error`) |
| 커밋·PR | 아직 없음 |
| 기록 위치 | 이 문서. [M6 결과](../m6/result.md) 「태스크 상세 재조회 실패 안내」와 [Frontend README](../../../README.md) 한 줄에도 같은 사실을 요약했다 |

## 실제 구현 및 관련 코드

- **공통 판정** — [query-view](../../../src/shared/lib/query-view/index.ts)
  - `queryView`와 단위 테스트를 `widgets/dashboard/lib`에서 `git mv`로 옮겼다. 판정 로직은 바꾸지 않았고 `loading | error | ready | refreshFailed` 의미가 그대로다. 공개 진입점은 `queryView`와 `QueryView` 타입이다.
  - 대시보드([useDashboardData.ts](../../../src/widgets/dashboard/model/useDashboardData.ts))는 import만 공통 경로로 바꿨다. 기존 위치의 파일은 남기지 않았다.
- **polling** — [useTaskNotionSync.ts](../../../src/features/task-notion-sync/model/useTaskNotionSync.ts)
  - `notionSyncRefetchInterval`의 입력을 `{ state: { data, error } }`로 바꿨다. `queryView(state) !== 'ready'`이면 `false`, `ready`이면서 Notion 상태가 `pending`일 때만 `NOTION_SYNC_POLL_MS`(3초)다. `synced | failed | null`은 멈춘다. 재조회 실패에서 멈추는 동작은 이전과 같고, 이제 화면이 이를 알린다.
- **상세 화면** — [TaskDetail.tsx](../../../src/widgets/task-detail/ui/TaskDetail.tsx)
  - 같은 `queryView(task)`로 판정한다. 데이터가 있으면 본문을 그리고, `refreshFailed`이면 본문 위에 `RefreshFailedNotice`를 둔다. 최초 조회 실패는 `view === 'error'`일 때 기존 접근 불가 화면(`UnavailableTask`) 또는 `QueryErrorState`로 간다.
  - `RefreshFailedNotice`는 `role="alert"`에 `최신 상태를 받지 못했어요`와 공통 [Button](../../../src/shared/ui/button)의 `다시 시도`(문구는 `COMMON_MESSAGES.retry`)를 한 번 둔다. 버튼은 `task.refetch({ cancelRefetch: false })`를 부르고, 요청 중(`task.isFetching`)에는 `loading`으로 비활성이다. 성공하면 안내가 사라지고 재실패하면 남아 다시 시도할 수 있다.
  - PM·일반 팀원 모두 이 버튼을 쓴다. `failed`일 때 PM에게만 `다시 반영하기`가 나타나는 기존 권한은 바꾸지 않았다.
  - 토스트는 쓰지 않았고, 변경 이력·팀원·회의 조회의 오류 처리는 그대로다.
- **테스트**
  - 단위: [notionSyncLabel.test.ts](../../../src/features/task-notion-sync/lib/notionSyncLabel.test.ts) 「반영 중 polling 간격」을 새 입력으로 바꿨다. `ready`+`pending`만 3000, `synced`·`failed`·`null`과 `loading`·`error`·`refreshFailed`는 `false`다. 판정 단위 테스트는 [queryView.test.ts](../../../src/shared/lib/query-view/queryView.test.ts)로 옮겼다.
  - MSW 통합: [notionSyncPolling.test.tsx](../../../src/app/notionSyncPolling.test.tsx) 「재조회 실패 안내 (#236)」
  - MSW 통합: [tasks.test.tsx](../../../src/app/tasks.test.tsx)의 최초 조회 실패 뒤 일반 팀원 복구 케이스
  - Storybook(2026-10-30 추가): [TaskDetail.stories.tsx](../../../src/widgets/task-detail/ui/TaskDetail.stories.tsx)의 `갱신_실패`(id `m6-태스크-상세--갱신-실패`). `tk_04` 반영 대기 시나리오에서 첫 조회는 성공하고 재조회는 500이다. play가 `role="alert"` 1개와 문구, 이전 제목과 `반영 중` 유지, 초기 오류 문구 없음, `다시 시도` 후 안내 제거를 확인한다. 등록 파일 [stories.sb.ts](../../../e2e/storybook/stories.sb.ts)는 `m6-` 접두사 스토리를 자동 등록하므로 바꾸지 않았다.
- **문서 링크**(2026-10-30) — `queryView` 이동으로 끊어졌던 링크 5개(계획 문서 1개, [E-02](../m7/errors/E-02-refetch-error-hidden.md) 4개)를 `src/shared/lib/query-view/`로 연결했다.
- **백엔드** — 변경 없음. API·DTO는 그대로이고 공통 함수 위치와 polling 함수의 내부 입력 타입만 바뀌었다.

## 완료조건 확인

| ID | 상태 | 근거 |
|---|---|---|
| AC-01 | 충족 | `shared/lib/query-view`에서 `queryView`를 제공하고 4조합 단위 테스트가 이동한 파일에서 통과한다. 대시보드 회귀 테스트가 통과하고 기존 위치에는 파일이 없다(`git status`의 이동 표시와 import 검색) |
| AC-02 | 충족 | polling 단위 테스트가 `ready`+`pending`만 3000이고 나머지 입력은 `false`임을 확인한다 |
| AC-03 | 충족 (MSW 기준) | 통합 테스트: 첫 조회 성공 뒤 polling 요청이 500, 네트워크 오류일 때 각각 기본 1회 재시도까지 실패하면 이전 상세와 Notion 상태가 유지되고 안내가 하나만 보이며 polling이 멈춘다 |
| AC-04 | 충족 (MSW 기준) | 요청 중 `다시 시도`가 비활성이고 `aria-busy`가 붙으며, 연속 클릭에도 GET은 1회만 나갔다 |
| AC-05 | 충족 (MSW 기준) | 재실패하면 안내가 남고 버튼이 다시 활성화된다. 서버가 돌아오면 안내가 사라진다 |
| AC-06 | 충족 (MSW 기준) | 성공 응답이 `pending`이면 polling이 재개되고 `synced`·`failed`면 멈춘다. `다시 반영하기`는 PM × `failed`에서만 보인다 |
| AC-07 | 충족 (MSW 기준) | 기존 접근 불가·최초 오류 테스트는 무수정으로 통과했다. 일반 팀원이 최초 조회 실패 뒤 `다시 시도`로 복구하는 케이스를 추가했다 |
| AC-08 | 충족 (아래 실행 결과 기준) | 구현 시점(2026-10-18): 타입 검사·린트·포맷 검사·전체 Vitest·빌드·관련 E2E·Storybook(104건)이 모두 exit 0이다. 스토리 추가 후(2026-10-30): Storybook 105건 통과. 독립 검증에서는 최초 전체 Vitest·관련 E2E가 timeout 각 1건으로 exit 1이었고 단독·겹침 없는 재실행에서 통과했다(아래 「독립 검증」) |
| AC-09 (기록·현재 HEAD 대비) | 확인 | 이 문서, [M6 결과](../m6/result.md), [Frontend README](../../../README.md)에 기록했다. 전체 계획·기존 마일스톤 계획·트러블슈팅 원문은 현재 HEAD 대비 차이가 없다(`git status`, Codex 독립 확인 포함) |
| AC-09 (착수 전 기준 대비) | 검증불가 | 구현 착수 전 보호 문서의 내용·해시를 확보하지 않아, 착수 이전 상태 대비 보존은 증명하지 못한다 |

2026-10-30 Codex 독립 검증도 AC-01~08을 충족으로 판정했다(AC-03은 MSW 기준). AC-09는 위 두 행과 같이 일부만 확인했다.

## 검증 내역

### 수정 전 확인

테스트를 먼저 고친 뒤 실행했을 때 통합 테스트 8건과 polling 입력 단위 테스트 1건이 실패했다. 통합 테스트는 갱신 실패 안내가 없어 안내를 찾지 못했다. 단위 테스트는 새 입력 `{ data, error }`에 `status`가 없어, 이전 데이터가 `pending`이고 오류가 있는 상태를 계속 polling으로 판정했다. 수정 후 모두 통과했다. 실패 메시지 원문은 따로 보관하지 않았다.

### 구현 시점 실행 (2026-10-18, `frontend/`, Node v24.11.0)

| 명령 | exit | 결과 |
|---|---|---|
| `npm run typecheck` | 0 | 오류 없음 |
| `npm run lint` | 0 | 경계 규칙 포함 오류 없음 |
| `npm run format:check` | 0 | 모든 파일 통과 |
| `npm test` | 0 | 159 files / 1806 tests 통과 |
| `npx vitest run src/app/notionSyncPolling.test.tsx src/app/tasks.test.tsx` 5회 반복 | 0 | 매회 38건 통과, 불안정한 징후 없음 |
| `npm run build` | 0 | 빌드 성공 |
| `npx playwright test e2e/tasks-approval.e2e.ts e2e/dashboard.e2e.ts` | 0 | 17건 통과 |
| `npm run test:storybook` | 0 | 104건 통과(구현 시점의 기존 스토리. 갱신 실패 스토리는 2026-10-30에 추가했다) |

- 작업 트리에 `node_modules`가 없어 `npm ci`로 설치한 뒤 실행했다. Vitest worker 시작 시간 초과 같은 환경 문제는 없었다.
- 위 명령은 구현 에이전트가 실행한 결과이고, 이 문서를 쓰는 시점에 다시 실행하지는 않았다. 이후 `m6/result.md`의 줄바꿈(CRLF → LF)만 고쳤고 코드는 바뀌지 않았다.

### 독립 검증 (2026-10-30, Codex GPT-6.1-Sol high, 읽기 전용, Node v24.11.0)

구현 에이전트와 별개로 Codex가 읽기 전용으로 다시 실행·판정한 결과다.

| 명령 | exit | 결과 |
|---|---|---|
| `npm run typecheck` · `npm run lint` · `npm run format:check` · `npm run build` | 0 | 모두 통과 |
| 관련 Vitest | 0 | 7 files / 131 tests 통과 |
| `npm run test:storybook` | 0 | 104건 통과(스토리 추가 전) |
| `npm test` 최초 실행 | 1 | 158 files / 1805 tests 통과, [meetingProcessing.test.tsx](../../../src/app/meetingProcessing.test.tsx) 162행 StrictMode 테스트 1건이 5000ms timeout |
| 위 테스트 단독 재실행 | 0 | 1 passed / 30 skipped |
| `npm test` 다른 검증과 겹치지 않은 재실행 | 0 | 159 files / 1806 tests 통과, 172.98초 |
| `npx playwright test e2e/tasks-approval.e2e.ts e2e/dashboard.e2e.ts` 최초 실행 | 1 | 16 passed, [dashboard.e2e.ts](../../../e2e/dashboard.e2e.ts) 117행 제목 `toBeAttached` 1건이 5000ms timeout |
| 위 테스트 단독 재실행 | 0 | 1 passed |
| 같은 E2E 겹치지 않은 재실행 | 0 | 17건 통과 |

- 판정: AC-01~08 충족(AC-03은 MSW 기준), AC-09 검증불가(일부 확인). 기능 결함은 발견하지 않았다.
- 최초 실행 timeout 2건: 최초 실행은 다른 명령과 실행 시간이 일부 겹쳤고, 부하가 원인일 가능성은 추정이다. 원인과 #236 변경의 인과는 확정되지 않았다. 두 테스트 파일은 이번 diff에 없다.
- `dashboard.e2e.ts`는 URL·목록 대기에 `FIRST_PAINT`(15000ms)를 쓰는데 제목 대기는 더 짧아 보여 검토 후보로 지적됐다.

### 스토리 추가 후 (2026-10-30)

| 확인 | 결과 |
|---|---|
| `npm run test:storybook` | 105건 통과(이전 104건, Codex 독립 검증 포함) |
| Codex 독립 검증 | P0~P3 발견 없음. typecheck·lint·format:check exit 0. `npx vitest run src/shared/lib/query-view src/app/notionSyncPolling.test.tsx` 2 files / 20 tests 통과 |
| 링크 | 바꾼 링크 5개와 두 문서의 나머지 상대 링크 모두 대상 존재, 옛 `dashboard/lib/queryView` 경로 0건(Codex) |

- 구현 측 보고: 안내 렌더를 `false &&`로 막으면 새 스토리가 `Unable to find role=alert`로 실패하고, 원복하면 통과했다. 이 대조 실험은 Codex가 재현하지 않았다.
- 이 단계에서는 전체 Vitest·앱 E2E·앱 build·실서버·반복 안정성을 실행하지 않았다.

## 계획 대비 변경

- 기록 위치: 계획의 결정 기록(M6 결과·README)에 더해 이 문서에도 남겼다(사용자 지시, 2026-10-18).
- 끊어진 `queryView` 링크 연결과 갱신 실패 Storybook 스토리 추가(2026-10-30): 계획의 작업 순서·완료조건에 없던 사용자 요청 후속이다. 바뀐 범위는 문서 링크 5개와 스토리 파일 1개다.

## 남은 작업과 제한 사항

- 실제 백엔드·Notion 반영에서의 확인은 하지 못했다. 검증은 MSW 기준이다.
- 갱신 실패 안내는 통합 테스트와 Storybook `갱신_실패` 스토리로 검증했다. 스토리 추가 뒤에는 전체 Vitest·앱 E2E·앱 build·실서버·반복 안정성을 다시 실행하지 않았다.
- AC-09의 착수 전 기준 대비 보존은 내용·해시를 확보하지 않아 검증불가다.
- 구현 에이전트가 스스로 한 검증 중 독립 확인되지 않은 부분이 있다: 수정 전 8+1건 실패(원문 미보관), 5회 반복 실행 로그, `false &&` 대조 실험.
- 별도 안정성 추적 대상: 독립 검증 최초 실행의 `meetingProcessing.test.tsx` StrictMode 테스트·`dashboard.e2e.ts` 제목 대기 timeout 각 1건. 재실행에서는 통과했으나 원인은 확인하지 않았다.
- 검토 후보: `dashboard.e2e.ts` 제목 대기 시간을 URL·목록 대기의 `FIRST_PAINT`(15000ms)와 맞출지.
- 변경 이력·팀원·회의 조회의 갱신 실패 처리는 범위 밖이라 그대로다.
- 커밋·PR은 아직 만들지 않았다.
