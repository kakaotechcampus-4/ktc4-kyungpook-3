# M7 구현 결과 — 대시보드 완성

- 기록일: 2026-10-17
- 대상: [M7 계획](plan.md) 구현 순서 1~5와 최종 게이트
- 상태: **AC-01~AC-06 충족(프론트·MSW 기준), 커밋 전 작업 트리. E-01~E-05 수정 뒤 전체 게이트를 2026-10-18 Node v24.21.0에서 다시 실행해 모두 통과했다.** 리뷰 지적 E-01~E-05는 해결했고, [E-06](errors/E-06-m6-detail-refetch-error-hidden.md)은 M7 범위 밖이라 별도 이슈 [#236](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/236)로 분리했다([지적 목록](errors/README.md)). 2026-10-17 게이트는 E-01~E-05 수정 전 기록으로 남긴다. 실 API 되돌리기와 실제 Notion 페이지 보관은 미검증 연동 과제로 남는다(계획의 완료 기준대로 M7 판정 밖).

## 작업 근거와 요약

코디네이터 지시(task_1502577bb384)에 따라 계획의 구현 순서 1~5를 한 번에 구현했다. 브랜치 `feature/235-m7-dashboard`, 기준 HEAD `3f59e91` 위 작업 트리이며 커밋하지 않았다. 계획 파일(plan.md)은 수정하지 않았다(작업 시작·종료 해시 `ac54fde` 동일).

| 단계 | 내용 |
|---|---|
| 1 | 기존 Query 조립 훅, 날짜 계산 `shared/lib/date` 공통화(M6 목록이 같은 함수 사용), 역할별 승인 미조회 |
| 2 | 요약 4개·제목·최근 처리 회의 안내, 확인 필요(PM), 마감 임박 |
| 3 | 최근 반영: `gate=auto` 3개, `notion_sync_status` 상태, 3초 polling, 빈 상태 3종 |
| 4 | 항목 되돌리기 API·확인 모달·거부 사유별 안내·캐시 무효화 |
| 5 | MSW handler·시나리오 9종, Storybook 12개, 통합 테스트·E2E, 계약 정정 |

## 실제 구현 및 관련 코드

- **날짜 공통화** — `addDays`·`soonUntil`·`SOON_LAST_DAY_OFFSET`을 [days.ts](../../../src/shared/lib/date/days.ts)로 옮겼다. 태스크 목록은 이 함수를 쓰고, 기존 `widgets/task-board` 내보내기는 재내보내기로 유지했다([taskBoard.ts](../../../src/widgets/task-board/lib/taskBoard.ts)). M6 목록 테스트는 수정 없이 통과한다.
- **추출 DTO·모델** — `reverted_at`·`approval_status`, 되돌리기 응답·409 details DTO. 모르는 승인 상태는 `null`. [추출 DTO](../../../src/shared/types/api/extraction.ts), [mapper](../../../src/entities/extraction/model/mapper.ts), [revertAutoItem](../../../src/entities/extraction/api/revertAutoItem.ts). 오류 코드 `EXTRACTION_ITEM_NOT_FOUND`·`AUTO_TASK_NOT_REVERTIBLE`을 추가해 서버 38개와 맞췄다([errors](../../../src/shared/api/errors.ts), [문구](../../../src/shared/api/errorMessages.ts)).
- **되돌리기 기능** — [features/auto-item-revert](../../../src/features/auto-item-revert): 서버 성공 뒤에만 반영, 성공 응답을 추출 캐시에 쓰고 태스크·승인·추출 캐시 무효화, 실패해도 같은 캐시 재조회, 같은 공간에서 한 번에 하나, 자동 재시도 없음, 세션이 바뀐 늦은 응답 무시, 성공 토스트(D-037). 확인 모달은 처리 중 닫히지 않는다.
- **대시보드 위젯** — [widgets/dashboard](../../../src/widgets/dashboard): 순수 판정 [dashboard.ts](../../../src/widgets/dashboard/lib/dashboard.ts), 조회 조립 [useDashboardData](../../../src/widgets/dashboard/model/useDashboardData.ts)(독립 조회 병렬, 회의 목록 → 상세 → 추출 순차, 회의 상세의 공간 확인), 화면 [Dashboard](../../../src/widgets/dashboard/ui/Dashboard.tsx)·[RecentSection](../../../src/widgets/dashboard/ui/RecentSection.tsx). 영역마다 로딩·오류·빈 상태를 따로 그리고 실패한 집계는 `–`로 둔다.
- **페이지** — [DashboardPage](../../../src/pages/dashboard/ui/DashboardPage.tsx)가 역할을 정하고 태스크 목록 주소를 목록의 URL 규칙(`boardSearch`)으로 만들어 넘긴다. 공간이 바뀌면 `key`로 화면 상태를 새로 시작한다.
- **MSW** — [추출 handler](../../../src/shared/mock/handlers/extraction.ts)에 되돌리기(서버 순서·거부 사유 5종·403·404·401)와 조회 시 지금 승인 상태 채우기. 시나리오 `dashboard-default`·`-no-meeting`·`-notion-not-connected`·`-no-auto`·`-sync-pending`·`-sync-failed`·`-revert-rejected`·`-member`·`-partial-error`([scenarios.ts](../../../src/shared/mock/scenarios.ts)). 저장 버전(`MOCK_DB_VERSION` 2)은 올리지 않았다 — 새 필드가 없는 예전 저장본은 handler가 `null`로 읽는다.
- **아이콘** — 시안의 되돌리기 아이콘 `undo`를 [Icon](../../../src/shared/ui/icon/Icon.tsx)에 추가했다.
- **계약** — [대표 계약](../../contracts/frontend-api-contract.md)에 「M7 대시보드·항목 되돌리기 경계」를 추가하고 §2.4에 새 필드를, §5.4를 항목 되돌리기·`notion_sync_status` 기준으로 정정했다(`gate=auto`는 Notion 반영 완료가 아님을 명시).

## 완료조건 확인

| 계획의 ID | 상태 | 근거 |
|---|---|---|
| AC-01 | 충족 | [dashboard.test.ts](../../../src/widgets/dashboard/lib/dashboard.test.ts) 요약 집계(어제·오늘·+6일·+7일, 완료, 마감 없음, 월·연·윤년 경계, 기한 지남과 7일 이내 비중복, 목록 길이 = 두 집계 합), [days.test.ts](../../../src/shared/lib/date/days.test.ts) 시간대 무관. 통합 테스트에서 5개만 보여도 집계 6(2+4) |
| AC-02 | 충족 | [dashboard.test.tsx](../../../src/app/dashboard.test.tsx) 「확인 필요」「마감 임박」: 정렬, 최대 5개, `채워 넣기`/`확인하기` → `/approvals/:id`, 전부 보기 `?tab=needs_review`, 행 전체 태스크 상세 링크, 전체 보기 → `?tab=in_progress&due=overdue,soon`에서 같은 6건·승인 없음. E2E [dashboard.e2e.ts](../../../e2e/dashboard.e2e.ts) 첫 시나리오 |
| AC-03 | 충족 (MSW) | 통합 테스트 「최근 반영」「반영 대기 polling」: auto 항목만 응답 순서 3개, 반영 완료·실패·상태 없음·되돌림 구분, `pending` 동안 3초마다 목록 재조회 후 `synced`에서 멈춤, 실패만 있으면 polling 없음, 화면을 떠나면 멈춤, polling 재조회 실패 시 멈추고 제목 근처 갱신 실패 표시·토스트 한 번 → 다시 시도 실패 시 토스트 한 번 더 → 성공 시 표시가 사라지고 polling 재개([E-02](errors/E-02-refetch-error-hidden.md) 해결 2026-10-17), 되돌린 뒤 승인되면 새 태스크의 반영 상태·보조 문구를 보이고 그 태스크가 반영 대기면 polling, 반려되면 `되돌림`+`반려됨`, 처리된 승인 링크·되돌리기 없음, 팀원에게는 승인 문구 없음([E-03](errors/E-03-reverted-row-stale.md) 해결 2026-10-18) |
| AC-04 | 충족 (MSW) | 통합 테스트 「되돌리기」: 성공(POST 1회, 행 위치 유지, `되돌림`·새 확인 필요 링크, 토스트, 확인 필요·확인 대기·마감 임박·추출 재조회), 취소(요청 0, 포커스 복귀), 중복 제출(1회, 처리 중 닫힘 차단, 응답 전 성공 표시 없음), 거부 `task_changed`·`pending_approval`·`task_missing`·`not_auto_created`·`already_reverted`, 네트워크 실패·403. MSW handler 단독 [dashboardScenarios.test.ts](../../../src/shared/mock/dashboardScenarios.test.ts) |
| AC-05 | 충족 (MSW) | 통합 테스트: 빈 상태 3종과 이동 경로, 일반 팀원(확인 대기·확인 필요·되돌리기 없음, 승인 요청 0회, PM 전용 이동 없음, 되돌린 행에 `되돌림` 배지만 있고 확인 필요 상세 링크 없음 — [E-01](errors/E-01-member-sees-pm-link.md) 해결 2026-10-17), 태스크 조회 실패·추출만 실패의 부분 오류(숫자 `–`), 데이터가 있는 뒤의 재조회 실패는 기존 값을 두고 대시보드 제목 근처 표시 하나(`요약·최근 반영의 최신 상태를 받지 못했어요 · 다시 시도`, 실패한 조회로 영역 이름을 정함)와 실패가 생길 때 토스트 한 번으로 알림(E-02, 2026-10-18 세 번째 수정), 공간 전환 시 이전 공간 데이터 없음. Storybook 12개 play |
| AC-06 | 충족 (MSW) | Codex 리뷰가 찾은 「키보드로 되돌리기에 성공하면 포커스가 `body`로 떨어짐」([E-04](errors/E-04-focus-lost-after-revert.md))을 2026-10-18 해결했다 — 성공 뒤 포커스가 그 행의 새 `확인 필요 보기` 링크(없으면 행)로 간다. 통합 테스트 E-04 셋과 E2E 키보드 되돌리기의 포커스 단언. 통합 테스트 키보드(Enter로 모달, 모달 안 포커스 순환, Esc 후 연 버튼으로 복귀). E2E: 키보드 되돌리기·모달 화면 안 표시, 로그인 주소 → 대시보드 진입, 기존 [signup-onboarding.e2e.ts](../../../e2e/signup-onboarding.e2e.ts)의 온보딩 종료 → 대시보드. 화면 확인은 1440px 스크린샷 수동 확인(PM·팀원) |

## 검증 내역

### 최종 게이트 (재실행, 2026-10-18 02:50~02:54, Node v24.21.0)

E-01~E-05 수정 뒤 PR 직전 게이트다. `frontend/`에서 순차 실행했다. Node v24.21.0 · npm 11.19.0(fnm), HEAD `3f59e91` 위 작업 트리(커밋 전). 실행 파일이 깨져 거짓 통과한 적이 있어 먼저 `npm ci`로 다시 설치했다.

| 순서 | 명령 | exit | 결과 |
|---|---|---|---|
| 0 | `npm ci` | 0 | 설치 완료 |
| 1 | `npm run typecheck` | 0 | |
| 2 | `npm run lint` | 0 | |
| 3 | `npm run format:check` | 0 | |
| 4 | `npm run test` | 0 | 159 files / 1797 tests 통과 |
| 5 | `npm run build` | 0 | |
| 6 | `npm run build-storybook` | 0 | |
| 7 | `npm run test:storybook` | 0 | 104 통과 |
| 8 | `npm run test:e2e` | 0 | 81 통과(포트 5211 기본값, 충돌 없음) |

실패·재실행 없이 한 번에 통과했다. M6 결과의 `meeting-skeleton.e2e.ts` 간헐 실패도 이번 실행에서는 나오지 않았다.

### 화면 다듬기 뒤 검증 (2026-10-18 03:19~03:21, Node v24.21.0)

위 재실행 게이트 뒤 화면 확인에서 나온 두 가지(아래 「계획 대비 변경」의 마감 임박 정렬·최근 반영 화살표)를 고쳤다. 바뀐 것은 마크업·클래스뿐이다.

| 명령 | exit | 결과 |
|---|---|---|
| `npm run typecheck`·`npm run lint`·`npm run format:check` | 0 | |
| `npx vitest run src/app/dashboard.test.tsx src/widgets/dashboard src/shared/mock/dashboardScenarios.test.ts src/entities/extraction src/features` | 0 | 20 files / 285 tests 통과 |
| `npm run build-storybook` | 0 | |
| `npm run test:storybook` | 0 | 104 통과 |
| `npm run test:e2e` | 0 | 81 통과 |

개발 서버(MSW, 1440px)에서 마감 임박 다섯 행의 `기한 지남` 배지 왼쪽 x가 모두 같고(1174px), 상태 칸의 `진행 중`이 넘치지 않으며, 되돌린 행의 링크가 글자 없이 화살표 아이콘(26×26)이고 이름이 `확인 필요 보기 — 제목`임을 확인했다.

### 최종 게이트 (2026-10-17 22:05~22:09, `frontend/`, 순차 실행) — E-01~E-05 수정 전

Node v24.21.0 · npm 11.19.0(fnm), HEAD `3f59e91` 위 작업 트리.

> **이 게이트는 리뷰 지적 수정 전 기준이다.** 이후 [E-01](errors/E-01-member-sees-pm-link.md)(2026-10-17)과 [E-02](errors/E-02-refetch-error-hidden.md)(2026-10-17, 후속 2026-10-18 두 번), [E-03](errors/E-03-reverted-row-stale.md)(2026-10-18), [E-04](errors/E-04-focus-lost-after-revert.md)(2026-10-18), [E-05](errors/E-05-test-hygiene.md)(2026-10-18, 테스트만)를 고쳤고, 그때마다 typecheck·lint·format:check와 대시보드 관련 테스트만 실행했다(명령과 결과는 각 문서). 전체 게이트(전체 Vitest·build·Storybook·E2E)는 위 「재실행」 절(2026-10-18)에서 다시 실행해 통과했다.

| 순서 | 명령 | exit | 결과 |
|---|---|---|---|
| 1 | `npm run typecheck` | 0 | |
| 2 | `npm run lint` | 0 | |
| 3 | `npm run format:check` | 0 | |
| 4 | `npm run test` | 0 | 156 files / 1766 tests 통과 |
| 5 | `npm run build` | 0 | |
| 6 | `npm run build-storybook` | 0 | |
| 7 | `npm run test:storybook` | 0 | 104 통과(M7 스토리 12개 play 포함) |
| 8 | `npm run test:e2e` | 0 | 81 통과(포트 5211 기본값, 충돌 없음) |

- 게이트 전에 `node_modules/.bin`의 `prettier`·`tsc`·`eslint`·`vite`·`storybook`·`playwright` 실행 파일이 공백으로 깨져 있어 `npm run` 검사가 아무것도 실행하지 않고 exit 0으로 끝나는 것을 발견했다. `npm ci`(Node 24)로 다시 설치한 뒤 위 게이트를 실행했다. 이 재설치 전의 같은 명령 결과는 근거로 쓰지 않았다.
- 같은 날 첫 게이트 실행에서 `test:e2e`가 7건 실패했다. 모두 M4 빈 상태 문구(`확인할 일이 여기에 모여요`, `회의록으로 가기`)를 대시보드 착지 표식으로 쓰던 E2E였다. 표식을 고친 뒤 해당 4개 파일 46건을 따로 통과시키고 위 게이트를 처음부터 다시 실행했다.

### production 번들 점검

`dist/assets`에서 `dashboard-default`·`dashboard-revert-rejected`·`msw-scenario`·`tk_01`·`ap_05`·픽스처 제목·`setupWorker`를 검색해 모두 0건이다(2026-10-17). 2026-10-18 재실행 게이트의 build 산출물에서 같은 검색을 다시 해 모두 0건이다.

### 수행하지 않은 검증

- 실제 백엔드 호출: 되돌리기 성공·거절, 추출 응답의 새 필드, 승인 조회 — 정적 코드 대조와 MSW만 했다.
- 실제 Notion 페이지 보관(서버 워커) — 미검증.

## 계획 대비 변경

- **화면 제목 구조:** 시안의 큰 제목 자리의 상태 문장을 `h1`이 아닌 문단으로 그리고, M4부터의 숨은 `h1 대시보드`를 유지했다. 기존 진입 판정을 그대로 두기 위해서다. [기록](basis-for-decision/2026-10-17-dashboard-hidden-h1-kept.md).
- **polling 대상:** 반영 대기 polling은 M6의 태스크 상세 대신 이미 받는 태스크 목록 하나를 3초마다 다시 받는다. 간격·실패 시 중단 규칙은 M6와 같다. [기록](basis-for-decision/2026-10-17-dashboard-sync-polling-on-task-list.md).
- **반영 상태 문구:** 계획의 세 상태(반영 대기·실패·완료)와 `되돌림` 외에, 태스크의 `notion_sync_status`가 `null`이면 `반영 상태 없음`, 태스크를 모르면 `상태 알 수 없음`(목록 로딩 중 `확인 중`)으로 보인다. 서버가 `null`을 돌려주는 경우가 있어서다.
- **거부·실패 안내 위치:** 확인 모달은 서버 응답 뒤 닫고, 거부 사유·오류는 해당 행 아래 `role="alert"` 문장으로 남긴다. `task_changed`는 태스크 링크, `pending_approval`은 대기 승인 링크를 붙인다. `already_reverted`는 재조회한 `되돌림` 상태가 우선해 문장을 따로 보이지 않는다.
- **기존 테스트 수정:** 대시보드가 이제 업무 조회를 하므로, 「대시보드 업무 요청 0회」를 단언하던 테스트를 고쳤다 — [appShell](../../../src/app/appShell.test.tsx)(U4-4를 M7 기준으로), [boot](../../../src/app/boot.test.tsx)·[guards](../../../src/app/router/guards.test.tsx)(대시보드 조회는 [isDashboardRequest](../../../src/shared/test/requests.ts)로 제외), [meetingProcessing](../../../src/app/meetingProcessing.test.tsx) 3건(시작 화면을 메시지로), [meetingUpload](../../../src/app/meetingUpload.test.tsx) 1건(대시보드가 받아 둔 회의 상세 캐시 제거), E2E [layout](../../../e2e/layout.e2e.ts)·[meeting-skeleton](../../../e2e/meeting-skeleton.e2e.ts)·[restore](../../../e2e/restore.e2e.ts)·[signup-onboarding](../../../e2e/signup-onboarding.e2e.ts)의 착지 표식. 테스트 의도(추적기 요청 수, 가드의 추가 요청 없음 등)는 유지했다.
- **문서 범위:** [MSW 안내](../../msw-guide.md)는 이번 쓰기 범위 밖이라 M7 시나리오를 적지 않았다.
- **마감 임박 정렬(2026-10-18 화면 확인):** 상태 문구 길이(`막힘`·`진행 중`)에 따라 `기한 지남` 배지의 가로 위치가 행마다 달랐다. 상태 칸 폭을 44px로 고정해 배지 위치를 맞췄다([Dashboard](../../../src/widgets/dashboard/ui/Dashboard.tsx)의 `DueRow`).
- **최근 반영 이동 링크(2026-10-18 화면 확인):** 되돌린 행의 `확인 필요 보기` 글자 링크를 화살표 아이콘 링크로 바꿨다. 되돌리기 버튼과 같은 자리·크기(26×26)다. 접근 가능한 이름(`확인 필요 보기 — 제목`)과 툴팁(`title`)으로 뜻을 남겨 테스트·E-04 포커스 이동은 그대로다([RecentSection](../../../src/widgets/dashboard/ui/RecentSection.tsx)).

## 남은 작업과 제한 사항

- 실 API 되돌리기·거부 사유와 실제 Notion 페이지 보관의 연동 검증.
- 승인 조회 PM 제한은 서버에 없다(M6 과제). 일반 팀원 차단은 프론트의 미호출로만 보장된다.
- D-039(최근 반영 3개)·D-060·D-061(`막힌 일` 클릭)은 계획의 기본값으로 구현했으며 최종 결정이 아니다.
- [MSW 안내](../../msw-guide.md)에 M7 시나리오 9종 추가 필요.
- M6 결과의 Node 24 게이트 미실행은 M6 과제로 남는다. 이번 게이트는 M7 작업 트리 기준이다.
- 리뷰 지적 중 남은 것([지적 목록](errors/README.md)):
  - [E-06](errors/E-06-m6-detail-refetch-error-hidden.md) M6 태스크 상세도 재조회 실패를 숨긴다 — M7 범위 밖, [#236](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/236)로 분리

## 관련 기록

- [반영 대기 polling을 태스크 목록 조회로 하는 선택](basis-for-decision/2026-10-17-dashboard-sync-polling-on-task-list.md)
- [숨은 h1 `대시보드`를 유지하는 선택](basis-for-decision/2026-10-17-dashboard-hidden-h1-kept.md)
