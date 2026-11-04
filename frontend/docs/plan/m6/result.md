# M6 구현 결과 — 태스크 목록·상세·확인 필요 승인

- 기록일: 2026-10-11
- 대상: [M6 계획](plan.md) 구현 순서 1~5와 최종 게이트
- 상태: **완료 선언 없음.** 프론트 구현과 MSW 기준 검증을 마쳤다. 최종 게이트는 Node 24가 아닌 Node v22.17.1에서만 실행했다. 실 API 보완·승인 조회 PM 제한·실제 Notion 반영은 미검증 연동 과제다.

## 작업 근거와 요약

계획의 범위 결정(2026-10-11)에 따라 M6 완료는 프론트 구현과 MSW 검증으로 판정하고, 실 API 보완 지원·승인 조회 PM 제한·실제 Notion 반영 검증은 별도 연동 과제로 구분한다. 구현은 다섯 단계로 나눠 진행했다.

| 단계 | 계획 | 커밋 |
|---|---|---|
| S1·S2 | 1. 계약·데이터 계층, 2. MSW 수직 흐름 | `0796a42` |
| S3 | 3. 태스크 목록·상세 | `5324a10` |
| S4 | 4. 확인 필요 상세·Notion 상태 | `8a8784a` |
| S5 | 5. 화면 검증·기록(Storybook·E2E·최종 게이트·이 문서) | 커밋 전 작업 트리 |

## 실제 구현 및 관련 코드

- **계약·데이터 계층** — 태스크 목록·상세·이력 Query와 상태 변경·Notion 재시도 API, `version`·`notion_sync_status` 매핑(반영 완료는 `synced`뿐), 승인 처리 본문 판정(`planApprovalResolution`)과 409 `APPROVAL_CONFLICT`·`APPROVAL_ALREADY_RESOLVED` 해석. [taskApi](../../../src/entities/task/api/taskApi.ts), [Task mapper](../../../src/entities/task/model/mapper.ts), [승인 판정](../../../src/entities/approval/model/resolution.ts), [resolveApproval](../../../src/entities/approval/api/resolveApproval.ts).
- **MSW** — 세션 기반 처리자·변경자, PM 쓰기 권한, 버전·충돌, 생성 승인 보완(`task_overrides`)의 검증 후 일괄 적용, 추출 항목 `task_id` 연결, Notion 대기·실패·재시도. M6 시나리오 9개(`tasks-default` 등). [승인 handler](../../../src/shared/mock/handlers/approval.ts), [태스크 handler](../../../src/shared/mock/handlers/task.ts), [태스크 상태](../../../src/shared/mock/task-state.ts), [시나리오](../../../src/shared/mock/scenarios.ts).
- **태스크 목록·상세** — 역할별 탭·개수·대기 승인 병합·정렬, URL `tab`·`due` 조건, 상세의 담당자·상태·마감·진행률·막힌 사유·연결 회의·이력, PM의 낙관적 상태 변경(해당 태스크만 복구). [TaskBoard](../../../src/widgets/task-board/ui/TaskBoard.tsx), [TaskDetail](../../../src/widgets/task-detail/ui/TaskDetail.tsx), [상태 변경](../../../src/features/task-status/model/useTaskStatusChange.ts).
- **확인 필요 상세** — 근거·원문·확정값 구분, 개발 MSW에서만 `보완하기`, 실 API에서는 필수값이 빠진 생성 승인의 `승인` 비활성화와 사유, 변경 승인의 현재값·제안값 비교, 충돌 재확인, 처리 결과와 생성·변경된 태스크 링크. [ApprovalReview](../../../src/widgets/approval-review/ui/ApprovalReview.tsx), [승인 처리](../../../src/features/approval-resolve/model/useApprovalResolve.ts), [보완 폼](../../../src/features/approval-resolve/ui/TaskCreateOverridesForm.tsx), 당시 `transport.ts`(#311에서 삭제).
- **Notion 상태** — 서버 상태만 따르는 문구, `pending`인 동안 3초 polling, PM의 반영 실패 재시도. [TaskNotionSyncStatus](../../../src/features/task-notion-sync/ui/TaskNotionSyncStatus.tsx), [useTaskNotionSync](../../../src/features/task-notion-sync/model/useTaskNotionSync.ts).
- **S5 검증 추가** — Storybook 다섯 묶음([목록](../../../src/widgets/task-board/ui/TaskBoard.stories.tsx), [상세](../../../src/widgets/task-detail/ui/TaskDetail.stories.tsx), [확인 필요 상세](../../../src/widgets/approval-review/ui/ApprovalReview.stories.tsx), [보완 폼](../../../src/features/approval-resolve/ui/TaskCreateOverridesForm.stories.tsx), [Notion 상태](../../../src/features/task-notion-sync/ui/TaskNotionSyncStatus.stories.tsx))과 그 play 회귀([stories.sb.ts](../../../e2e/storybook/stories.sb.ts)), 앱 E2E [tasks-approval.e2e.ts](../../../e2e/tasks-approval.e2e.ts). 제품 코드는 바꾸지 않았다.

## 완료조건 확인

| 계획의 ID | 상태 | 근거 |
|---|---|---|
| AC-01 | 충족 (프론트·MSW) | taskApi·Task mapper·판정·승인 처리·승인 mapper 테스트가 최종 게이트 `npm run test`에서 통과. [대표 계약](../../contracts/frontend-api-contract.md) 「M6 태스크·승인 처리 경계」가 현재 서버 구현(정적 대조)과 미합의 요청안을 구분한다. 서버 응답 모양은 MSW로 재현했고 실 백엔드 호출은 하지 않았다 |
| AC-02 | 충족 | [tasks.test](../../../src/app/tasks.test.tsx) 탭·개수·정렬과 팀원 승인 요청 0회. 대기 승인은 `확인 필요 목록`, 태스크는 `태스크 목록`이다. 2026-10-11 재실행: tasks.test 22건 통과, E2E에서 승인 뒤 확인 필요 카드 2건·만든 태스크 링크·팀원 목록 `전체 10 · 진행 중 7 · 완료 3`과 승인 요청 0건 |
| AC-03 | 충족 | tasks.test의 URL 탭·날짜 조건 복원·해제·뒤로가기(게이트 통과). E2E에서 화살표로 고른 탭이 `?tab=needs_review`로 남는 것 확인 |
| AC-04 | 충족 | tasks.test의 지연·실패·동시 mutation(해당 태스크만 복구, 다른 태스크 변경 보존)과 PM 전용 상태 변경(게이트 통과) |
| AC-05 | 충족 (MSW·프론트 분기) | 상세의 보완·원자성·실 API 분기는 [approvalsMsw.test](../../../src/app/approvalsMsw.test.tsx)·[approvals.test](../../../src/app/approvals.test.tsx)(이전 게이트). 목록 카드도 같다. 실 API 보류 카드(ap_01)는 접혀 있어도 `승인` 비활성, 사유가 `지금 서버는 승인 전 보완을 지원하지 않아요.`로 끝남, `반려` 활성 — tasks.test에서 확인(2026-10-11). E2E는 상세에서 보완 후 승인 한 번. **실 API의 보완 지원은 미검증·미지원**(계약 요청 M6-1~M6-3, 합의 여부 확인 필요) |
| AC-06 | 충족 | approvals·approvalsMsw 테스트의 반려·이미 처리됨·연속 충돌·지원하지 않는 종류·중복 클릭·자동 재시도 차단(게이트 통과). Storybook `충돌` play가 409 뒤 충돌 표와 `지금 값을 확인했어요, 다시 승인`을 확인 |
| AC-07 | 충족 (MSW 기준) | [notionSyncPolling.test](../../../src/app/notionSyncPolling.test.tsx) 간격·중단·재시도(이전 게이트). 처리 결과·polling은 승인 상세와 태스크 상세에 있다. 2026-10-11 E2E: 회의록 → 승인 → 확인 필요 3→2, 만든 태스크는 `태스크 목록` 링크, 탭 `전체 13 · 확인 필요 2 · 진행 중 8 · 완료 3`. polling이 `pending`인 동안 `반영 중`, 응답이 `synced`인 뒤에만 `반영됨`. **테스트 계정의 실제 Notion 반영 수동 검증은 실행하지 않았다 — 미검증** |
| AC-08 | 충족 (프론트 가드) | E2E: 팀원이 `/approvals/ap_01`로 들어오면 `/tasks`로 가고 `접근 권한이 없어요` 토스트, 승인 상세·목록 요청 0건. **서버의 승인 조회 PM 제한은 현재 서버에 없고 미검증**(계약 요청 M6-4) |
| AC-09 | 충족 | 생성 승인 제목은 승인 상세 링크이고, 마감 조건은 `group` 이름 `마감 조건`이다. 리스트 `main`은 960px 이하·가운데. 2026-10-11 E2E: 키보드로 `알림 문구 검토`에서 상세·보완·승인, 1024·1440·1920px 목록·상세·확인 필요 상세 9건 통과. Storybook play는 이 재실행에 포함하지 않았다 |
| AC-10 | 미검증 (Node 24 게이트 미실행) | 아래 Node v22.17.1 순차 게이트는 목록 UI를 다시 맞추기 전 기록이다. 그 뒤 `tasks-approval.e2e.ts` 5건이 실패했고, 2026-10-11에 그 파일 13건은 다시 통과했다. 전체 E2E·`npm run test`·Storybook·production 번들 점검은 이 재조정 후 다시 실행하지 않았다. Node 24 게이트는 여전히 미실행 |

## 검증 내역

### 최종 게이트 (2026-10-11, `frontend/`, 순차 실행)

| 순서 | 명령 | exit | 결과 |
|---|---|---|---|
| 1 | `npm ci` | 0 | 설치 완료. `EBADENGINE`(요구 `>=24 <25`, 현재 v22.17.1) 경고 |
| 2 | `npm run typecheck` | 0 | |
| 3 | `npm run lint` | 0 | |
| 4 | `npm run format:check` | 0 | |
| 5 | `npm run test` | 0 | 147 files / 1611 tests 통과 |
| 6 | `npm run build` | 0 | |
| 7 | `npm run build-storybook` | 0 | |
| 8 | `npm run test:e2e` | **1** | 75 통과, 1 실패 — M5 `meeting-skeleton.e2e.ts` 「참석자 1·4·10·20명 × 1024·1440·1920px」의 20명·1440px 칸 맞춤 단언(`한 사람 더 들어간다(1032.34375 ≤ 1060)`) |
| 9 | `npm run test:storybook` | 0 | 87 통과(M6 스토리 32개 play 포함) |

모두 Node v22.17.1 · npm 10.9.2, HEAD `8a8784a` 위 작업 트리에서 실행했다. 실패한 8번 뒤 순서를 멈추지 않고 9번까지 실행했다.

8번 실패 후속 확인(게이트 순서 밖, 같은 Node):

- 실패한 테스트와 그 화면 코드(`widgets/meeting-minutes`)는 M6 기준 커밋(`64c4071`) 이후 바뀌지 않았다. S5도 손대지 않았다.
- 같은 테스트만 `--repeat-each=5 --workers=1`로 5회 — 5/5 통과.
- `npm run test:e2e` 전체 재실행 — 76/76 통과.
- 병렬 부하에서 간헐적으로 실패하는 M5 회귀로 보이나 원인은 확인하지 않았다. 게이트의 `test:e2e` 첫 실행은 실패로 기록하며 통과로 바꾸지 않는다.

이 기계에는 Node v22.17.1만 있다(`C:\Program Files\nodejs`). nvm·fnm·volta·다른 Node 설치가 없어 **Node 24 게이트는 실행하지 못했다.** 위 결과는 Node 24 게이트 통과가 아니다.

### production 번들 점검

`npm run build` 산출물 `dist/`를 문자열 검색했다(2026-10-11).

- MSW 시나리오 이름(`tasks-default`·`approval-needs-input`·`notion-sync-pending`·`tasks-member`·`meeting-instant` 등), `msw-scenario`, 픽스처 값(`tk_01`·`ap_01`·픽스처 제목·계정), 등록 코드(`setupWorker`·`startMockWorker`·`msw/browser`·`mockServiceWorker` 참조), 모의 OAuth 경로 — 0건.
- `task_overrides` 1건은 승인 DTO 매퍼(제품 코드)의 `msw` transport 분기이고, `MSW` 1건은 `VITE_ENABLE_MSW` 환경 변수 스키마다. production 설정은 `mswEnabled: false`로 접혀 있다.
- `dist/mockServiceWorker.js`는 `public/` 정적 파일로 포함된다. [M5 인수인계](../m5/m5-handoff.md)가 따른 M4 결정(프로덕션 산출물에 포함, 앱 번들 등록 코드 없음)대로라 결함으로 세지 않는다.

### S5에서 추가한 검증

- Storybook 다섯 묶음 32개(목록 7 · 상세 6 · 확인 필요 상세 9 · 보완 폼 3 · Notion 상태 7). 정상·로딩·빈 상태·오류·권한(팀원)·보완 누락·충돌·처리 결과(승인·반려)·입력 오류·재시도 오류를 포함한다. Storybook 빌드는 개발 MSW가 아니라 처리 경로가 `live`다 — 확인 필요 상세 스토리에 `보완하기`가 없고, 보완 폼은 따로 그린다.
- [stories.sb.ts](../../../e2e/storybook/stories.sb.ts)에 M6 스토리 play 통과·handler 누락(404) 검사를 M5와 같은 방식으로 추가했다. 기존 단언은 그대로다.
- [tasks-approval.e2e.ts](../../../e2e/tasks-approval.e2e.ts) 13개 — 회의록에서 확인 필요로 이동·보완·승인·복귀 갱신, 승인 → `반영됨`(MSW), 팀원 승인 URL 차단, 키보드, 1024·1440·1920px × 목록·상세·확인 필요 상세.
- MSW에는 Notion 대기열 워커가 없다. E2E는 통합 테스트처럼 모의 db의 태스크 `notion_sync_status`를 `synced`로 바꾸고, 다음 polling 응답 본문이 `synced`임을 받은 뒤에 `반영됨`을 단언한다. 실제 Notion 반영 검증이 아니다.

### 목록 UI 재조정 후 확인 (2026-10-11, Node v22.17.1)

완료 검증이 깨뜨린 `e2e/tasks-approval.e2e.ts` 5건을 현재 목록 UI에 맞춰 다시 확인했다. `frontend/`에서 실행했다.

| 명령 | exit | 결과 |
|---|---|---|
| `npx vitest run src/app/tasks.test.tsx` | 0 | 22건 통과. 역할별 탭·정렬, 실 API 보류 카드의 비활성 `승인`·미지원 사유·`반려`, 제목의 승인 상세 href |
| `npx eslint` (수정한 목록·카드·스토리·tasks.test) | 0 | |
| `npx playwright test e2e/tasks-approval.e2e.ts` | 0 | 13건 통과. 회의록 복귀 후 확인 필요 2건과 태스크 목록의 생성 링크, Notion `반영됨`, 팀원 차단, 키보드 상세 진입, 1024·1440·1920px 목록·상세·확인 필요 상세 |

이 실행은 Node 24 순차 게이트가 아니다. 전체 `npm run test`, 전체 E2E, Storybook, production 번들 검색은 다시 하지 않았다.

### 이전 단계 검증

S1~S4의 통합 테스트와 브라우저 확인은 각 단계 감독 기록에 있다. 위 최종 게이트의 `npm run test`가 그 테스트를 현재 작업 트리에서 다시 실행했다.

## 계획 대비 변경

- **최종 게이트 환경:** 계획은 Node 24에서 실행하도록 정했으나 이 기계에 Node 24가 없어 Node v22.17.1로 같은 순서를 실행했다. 영향: Node 24 게이트는 미실행이며 이 결과로 대체하지 않는다.
- **Notion `synced` 전이:** MSW에 반영 워커가 없어 E2E가 모의 db 필드를 바꿔 `synced` 응답을 만든다(위 검증 내역). 계획의 「MSW 기준 승인 → 반영됨 E2E」 범위 안이며, 실제 Notion 수동 검증과 구분한다.
- **Storybook의 승인 처리 경로:** Storybook 빌드는 `live`라 보완 흐름은 보완 폼 단독 스토리와 개발 MSW E2E로 확인했다.
- **확인 필요 구역:** 대기 승인을 태스크 행 안에 끼우지 않고 `확인 필요 목록` 카드로 태스크 목록 위에 둔다. 탭 개수·정렬·팀원 승인 조회 0회는 같다. 근거는 [확인 필요를 카드 구역으로 두는 선택](basis-for-decision/2026-10-11-task-list-approval-section.md).
- **목록에서 승인한 뒤:** 카드는 대기 줄에서 빠지고 만든 태스크는 `태스크 목록`에 온다. 처리 결과 문장·생성된 태스크의 Notion polling은 승인 상세와 태스크 상세에 남긴다(계획 §4-5·§4-8).
- **리스트 본문 폭:** 리스트 `main`만 960px 이하로 가운데에 둔다. 보드·캘린더·간트는 셸 폭이다. AC-09 E2E가 보는 목록·상세·확인 필요 상세에는 넓은 보기가 없다.
- **늦은 상태 변경 성공:** 공간 전환이나 역할 변경 뒤에도 세션이 살아 있으면, 도착한 성공은 아직 남아 있는 그 공간의 목록·상세 캐시를 서버 값으로 갱신한다. S3 검증은 이를 실패로 봤으나 §3.6의 정합으로 보고 재작업하지 않았다. [기록](basis-for-decision/2026-10-11-late-status-success-keeps-workspace-cache.md).

## 태스크 상세 재조회 실패 안내 (#236, 2026-10-18)

[계획](../refactor/plan-task-detail-refetch-error.md)에 따라 M6 구현 이후 발견된 결함을 수정했다. 상세를 연 채 Notion `반영 대기`를 polling하다 재조회가 실패하면 polling은 멈추는데 화면은 안내 없이 마지막 `반영 대기`를 보였다([E-06](../m7/errors/E-06-m6-detail-refetch-error-hidden.md)).

### 변경

- `queryView`와 단위 테스트를 `widgets/dashboard/lib`에서 `shared/lib/query-view`(공개 `index.ts`)로 옮겼다. 판정 로직은 그대로이고, 대시보드는 공통 경로를 참조하며 기존 위치 파일은 삭제했다.
- `notionSyncRefetchInterval`의 입력을 `{ state: { data, error } }`로 바꿨다. `queryView(state) === 'ready'`이면서 Notion 상태가 `pending`일 때만 3초이고, `loading`·`error`·`refreshFailed`와 `synced | failed | null`은 `false`다.
- `TaskDetail`이 같은 `queryView`로 판정한다. `refreshFailed`이면 기존 본문 위에 `role="alert"` 안내 `최신 상태를 받지 못했어요`와 공통 `Button`의 `다시 시도`를 둔다. 버튼은 `task.refetch({ cancelRefetch: false })`를 부르고 요청 중 로딩·비활성이며, 성공하면 안내가 사라지고 재실패하면 남는다. 토스트는 쓰지 않았다.
- 최초 조회 실패(`QueryErrorState`)와 접근 불가 화면은 그대로다. 백엔드·DTO 변경은 없다.

### 테스트

- [notionSyncLabel.test.ts](../../../src/features/task-notion-sync/lib/notionSyncLabel.test.ts): polling 간격을 새 입력으로 갱신(AC-02).
- [notionSyncPolling.test.tsx](../../../src/app/notionSyncPolling.test.tsx) 「재조회 실패 안내 (#236)」: 500·네트워크 오류 각 1건(AC-03), 연속 클릭·요청 중 비활성·성공 시 안내 제거·`pending` polling 재개(AC-04·AC-06), 재실패 유지 뒤 회복(AC-05), PM·일반 팀원 × `synced`·`failed`(AC-06·AC-07).
- [tasks.test.tsx](../../../src/app/tasks.test.tsx): 처음부터 조회가 실패하면 일반 팀원도 `다시 시도`로 복구(AC-07).
- 구현 에이전트 보고: 수정 전에는 통합 테스트 8건이 안내를 찾지 못해 실패했고(polling 입력 단위 테스트 1건도 실패), 수정 후 통과했다. 수정 전 실패 원문은 남아 있지 않아 독립 확인하지 못했다.

### 검증 (Node v24.11.0, `frontend/`)

| 명령 | exit | 결과 |
|---|---|---|
| `npm run typecheck` | 0 | 오류 없음 |
| `npm run lint` | 0 | 경계 규칙 포함 오류 없음 |
| `npm run format:check` | 0 | 모든 파일 통과 |
| `npm test` | 0 | 159개 파일·1806건 통과 |
| `npx vitest run src/app/notionSyncPolling.test.tsx src/app/tasks.test.tsx` 5회 반복 | 0 | 구현 에이전트 보고: 매회 38건 통과, 불안정 없음(반복 로그가 없어 독립 확인하지 못했다) |
| `npm run build` | 0 | 빌드 성공 |
| `npx playwright test e2e/tasks-approval.e2e.ts e2e/dashboard.e2e.ts` | 0 | 17건 통과 |
| `npm run test:storybook` | 0 | 104건 통과(구현 시점의 기존 스토리) |

- 이 게이트는 #236 관련 범위(전체 Vitest·build·관련 E2E·Storybook)의 Node 24 실행이며, 위 M6 최종 게이트의 Node 24 재실행이나 M6 전체 E2E·production 번들 검증 완료를 뜻하지 않는다.

### 후속 (2026-10-30)

- [TaskDetail.stories.tsx](../../../src/widgets/task-detail/ui/TaskDetail.stories.tsx)에 갱신 실패 스토리 `갱신_실패`를 추가했고 Storybook은 105건 통과했다. 끊어졌던 `queryView` 링크 5개도 연결했다.
- Codex 읽기 전용 독립 검증: AC-01~08 충족(AC-03은 MSW 기준), AC-09는 착수 전 기준 대비 보존이 검증불가다. 최초 전체 Vitest·관련 E2E에서 timeout 각 1건이 있었고 단독·겹침 없는 재실행에서 통과했다. 세부와 제한은 [#236 결과](../refactor/result-task-detail-refetch-error.md)에 있다.

### 계획 대비 변경

- 구현은 계획 대비 달라진 점이 없다. 작업 트리에 `node_modules`가 없어 `npm ci`로 설치한 뒤 실행했다. 2026-10-30의 스토리 추가·링크 연결은 계획 밖 사용자 요청 후속이다.
- 미실행·미검증: 실제 백엔드와 Notion 기준 확인은 하지 않았다(MSW 기준).

## 남은 작업과 제한 사항

- Node 24 환경에서 최종 게이트 재실행.
- M5 `meeting-skeleton.e2e.ts` 참석자 칸 맞춤 테스트의 병렬 부하 간헐 실패 원인 확인(이번 게이트 첫 실행에서 1회 실패, 재실행 통과).
- 백엔드 연동 과제(계약 「백엔드 요청 (합의 여부 확인 필요)」 M6-1~M6-4): 승인 보완 `task_overrides` 지원·원자성·필수값 검증, 승인 목록·상세 조회의 PM 제한. 합의·실 API 검증 근거 없음.
- 테스트 계정의 실제 Notion 반영 수동 검증 — 미실행.
- `APPROVAL_CONFLICT`는 프론트 공통 오류 코드 목록에 아직 없다(계약 기록). 승인 엔티티가 코드 문자열로 판별한다.

## 관련 기록

- [확인 필요를 태스크 목록과 나란한 카드 구역으로 두는 선택](basis-for-decision/2026-10-11-task-list-approval-section.md)
- [공간 전환·역할 변경 뒤 늦은 상태 변경 성공이 남아 있는 공간 캐시를 갱신하는 선택](basis-for-decision/2026-10-11-late-status-success-keeps-workspace-cache.md)
- [보완값을 승인 요청 때까지 화면에 두는 선택](basis-for-decision/2026-10-11-approval-overrides-held-until-approve.md)
- [조회 오류 뒤 Notion polling을 재진입까지 멈추는 선택](basis-for-decision/2026-10-11-notion-polling-stops-on-query-error.md)
- [태스크 상세 재조회 실패 안내 계획 (#236)](../refactor/plan-task-detail-refetch-error.md) · [결과](../refactor/result-task-detail-refetch-error.md)
- [대표 계약](../../contracts/frontend-api-contract.md) 「M6 태스크·승인 처리 경계」
- [M5 인수인계](../m5/m5-handoff.md)

## M6 후속: 승인 보완과 Task 진행률 제거 (#311, 2026-11-04)

이 절은 [#305](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/305)의 FE 요청을 구체화한 [#311](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/311) 구현 결과다. 위의 2026-10-11 M6 완료조건 판정과 당시 서버 제한 설명은 그 시점의 기록으로 보존한다. 이번 변경은 그중 승인 보완 부분을 갱신하며, M6 전체나 실 API 연동의 완료를 선언하지 않는다.

### 실제 변경

- 현재 Task DTO·모델·요청·MSW·목록·상세·캘린더·팀 화면에서 `progress`를 제거했다. 과거 `changed_field: "progress"` 이력은 읽기 전용으로 표시하고 MSW의 해당 필드 되돌리기는 400으로 거절한다. 회의 처리·업로드 진행과 `in_progress` 상태는 별개다.
- 생성 승인은 제목·담당자·마감, 수정 승인은 상태·마감의 부분 보완값을 `task_overrides`로 실 API와 MSW에 함께 보낸다. 담당자·마감의 명시적 `null`은 미정, 키 생략은 원래 제안 유지다. 생성 결과 상태는 `todo`이며 반려 요청은 상태만 보낸다.
- 상세와 목록 카드에서 입력 중·제출 중·충돌 재확인의 경계를 공유한다. 충돌 응답의 `proposed`는 서버가 보완값을 적용한 최종값으로 표시한다. 재승인은 제출했던 동일 보완값과 확인한 `task_version`을 전송한다. 입력을 바꾼 순간 이전 확인을 해제하며, 다시 충돌하면 새 응답을 표시한다. 400·404·네트워크 오류 뒤에는 초안과 대기 상태를 유지한다.
- 완료 화면은 원래 제안·회의 근거와 서버가 저장한 `payload.task_overrides`를 분리해 읽고, 부분값과 명시적 `null`을 반영해 확정값을 표시한다. 기존 승인·태스크·이력·추출 캐시 갱신과 이미 처리된 승인 재조회·중복 전송 방지를 유지한다. 수정 필드의 `manual` 이력과 변경자는 서버 이력을 표시한다.

구현 경계는 [대표 계약](../../contracts/frontend-api-contract.md)의 「진행률 제거와 보완 승인 경계」, 선택 이유는 [결정 기록](basis-for-decision/2026-11-04-approval-edits-and-conflict-confirmation.md)에 있다. M6 계획의 AC-05(보완 승인), AC-06(충돌·재승인), AC-07(처리 뒤 갱신), AC-09(목록·상세 사용자 흐름)에 대한 후속 구현이다. 기존 AC ID와 원래 의미는 바꾸지 않았다. 예전 MSW 전용 보완·필수 담당자·필수 마감 분기는 #311의 새 계약으로 대체했다.

### 검증과 연동 경계

Node v24.11.0 환경에서 관련 Vitest 13개 파일·245건이 통과했다. 이는 마지막 두 UI 회귀를 추가하기 전 실행이며, 추가한 회귀 11건을 별도로 재실행해 통과했다. 여기에는 무수정 승인, `null`과 생략, 409 재충돌과 확인 해제, 400·404 입력 유지, 완료값·과거 진행률 이력, MSW 이력·반려·원자성 검사가 포함된다. `npm run typecheck`, `npm run lint`, `npm run build`와 변경 소스의 Prettier 검사를 통과했다. Chromium 사용자 흐름의 스크린샷·trace·실행 출력은 로컬 Git 제외 경로 `.verify/managers-manager/2026-11-03T17-13-11-851Z-tasks-b2550194/`에 남겼다.

최초 Chromium 15건 실행에서는 14건이 통과하고 1건은 실행 중 소스 HMR과 품질 검사가 겹친 상태에서 테스트 context 종료가 60초를 넘었다. 이 실패를 통과로 계산하지 않는다. 실패한 「회의록의 확인 필요 항목을 보완·승인」 흐름을 단독 재실행해 1건 통과했다(로컬 기록 `.verify/managers-manager/2026-11-03T17-21-41-013Z-tasks-938e591d/`). 두 실행을 합쳐 각 흐름은 통과했으나 최초 전체 실행의 실패 기록은 유지한다.

독립 리뷰에서 수정 승인 폼이 조회 전 `todo`·마감 미정으로 보일 수 있는 문제를 발견했다. 제안에 없는 값은 `원래 제안 유지`로 표시하고, 상태 선택을 취소하면 요청에서 생략하도록 수정했다. 같은 회귀에서 현재 태스크 재조회와 선택 취소를 함께 확인했다. 죽은 Notion 마감 필수 안내와 오래된 주석도 제거했다.

| 명령 (`frontend/`, wrapper는 저장소 루트) | 결과 |
|---|---|
| `npx vitest run src/app/approvalOverrides.test.tsx src/app/approvals.test.tsx src/app/approvalsMsw.test.tsx src/app/tasks.test.tsx src/entities/approval src/shared/mock/taskApprovalFlow.test.ts src/shared/mock/taskScenarios.test.ts --maxWorkers 2` | 13파일·245건 통과 |
| `npx vitest run src/app/approvalOverrides.test.tsx src/entities/task --maxWorkers 1` | 5파일·59건 통과 |
| `npx vitest run src/app/approvalOverrides.test.tsx --maxWorkers 1` | 리뷰 수정 뒤 11건 통과 |
| `npm run typecheck`, `npm run lint`, `npm run build` | 통과 |
| `npx prettier --check src e2e` | 통과. `npm run format:check`는 로컬 검증 산출물도 검사해 실패했으므로 소스 범위로 재확인 |
| `node .cursor/skills/verify-managers-manager/scripts/verify.cjs run tasks --grep '.*'` | 최초 14통과·1 context 종료 시간 초과 |
| 같은 wrapper의 `--grep '회의록의 확인 필요 항목을 보완'` | 단독 1건 통과 |
| 같은 wrapper의 `--grep '변경 보완 뒤 충돌'` | 리뷰 수정 뒤 1건 통과. 로컬 기록 `2026-11-04T01-31-05-480Z-tasks-fcdf39ab` |

Vitest에는 기존 React `act(...)` 경고가 출력됐다. 전체 Vitest·전체 E2E·Storybook·실 API는 이번 후속에서 실행한 범위에 포함하지 않는다. 시작 시 보관한 전체 계획·각 `plan.md`·트러블슈팅 원문의 SHA-256은 종료 점검에서 같았다.

### 병합 전 CI 후속

PR #323의 최초 CI 전체 Vitest는 2149건 통과·1건 실패였다. `shared/test/api.test.ts`의 공통 클라이언트 오류 검사가 담당자·마감 없는 생성 승인을 오류 입력으로 사용하던 이전 가정을 유지했다. 새 계약에서는 정상 승인이므로 오류 입력을 허용되지 않는 승인 상태로 바꿨다. 제품 코드는 바꾸지 않았다. CI 재검증 결과는 PR 검사 기록에서 확인한다.

그 수정 뒤 CI 전체 단위 테스트·빌드·E2E는 통과했다. Storybook은 153건 통과·2건 실패였으며, 태스크 상세의 `40%`와 진행률 `기록 없음`을 기대하던 기존 play 검사를 현재 화면에 맞게 고쳤다. 두 스토리는 진행률 항목이 없음을 검사한다.

[BE PR #307](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/307)은 2026-11-04 확인 시 OPEN이다. PR 스키마·구현과 FE 계약은 정적으로 대조했으나, 로컬 백엔드와 공개 배포 API에 변경이 적용됐다는 근거는 없다. 공개 `/openapi.json`은 SPA HTML을 반환했다. 실제 승인·DB·Notion 반영, PM 승인 조회 권한은 호환 BE 배포 환경에서 별도로 검증해야 한다. MSW·Chromium 성공은 실 API 검증으로 보지 않는다.
