# M7 계획 — 대시보드 완성

- 작성일: 2026-10-17
- 상태: 구현 전 계획. 완료 판정과 테스트 성공 기록은 포함하지 않는다.
- 계획 근거: 사용자가 제시한 M7 계획 초안과 확정 전제, [전체 계획](../frontend-plan.md)의 M7, 현재 작업 트리의 프론트·백엔드 코드와 계약, [M6 결과](../m6/result.md).
- 완료 기준: **프론트엔드 구현과 MSW 검증**으로 판정한다. 실제 서버·Notion 연동 검증은 별도 과제로 기록하고, M6의 미검증 과제를 M7 완료로 처리하지 않는다.

## 목표와 배경

현재 빈 상태 안내뿐인 대시보드를 **요약 → 확인 필요 → 마감 임박 → 최근 반영** 화면으로 완성한다. [메인 시안](../../design/canvas/Main.dc.html)과 공통 UI를 사용한다.

현재 [대시보드 화면](../../../src/pages/dashboard/ui/DashboardPage.tsx)은 회의록·태스크 링크가 있는 빈 상태 하나만 보여 주며, 관련 API는 호출하지 않는다. 온보딩 완료·로그인 후 진입 경로는 이미 이 화면으로 연결되어 있다([진입 경로](../../../src/entities/workspace/lib/entryPath.ts)).

전체 계획의 M7은 결정 D-032~D-065를 기준으로 한다. 이후 결정과 현재 코드로 다음 내용이 달라졌다.

- **D-162**: 확인 필요 항목의 목적지는 `/approvals/:approvalId`로 바뀌었다.
- **되돌리기 방식**: 백엔드가 항목 단위 되돌리기(`POST /extractions/{extraction_id}/items/{item_id}/revert`)를 구현했다. 이번 계획은 이 방식을 따른다.

전체 계획 원문은 수정하지 않는다.

## 구현 범위와 제외 범위

### 구현 범위

- 기존 Query를 재사용한 대시보드 데이터 조립. 날짜 판정은 공통화한다.
- 영역별 구현:
  - 상단 요약 4개, 제목, 최근 처리 회의 안내
  - 확인 필요(PM 전용), 마감 임박
  - 최근 반영: 동기화 상태 표시, polling, 빈 상태 3종
- 항목 되돌리기: 확인 모달, 결과 표시, 캐시 갱신, 거부 사유 안내.
- 추출 DTO·모델에 `reverted_at`·`approval_status`를 반영하고 되돌리기 요청·응답·오류를 처리한다.
- MSW에서 되돌리기의 서버 동작을 재현하고 대시보드 시나리오를 추가한다.
- 품질 확인: 역할 분기, 로딩·빈 데이터·부분 오류 구분, 키보드 접근성.
- 검증·기록: Storybook·통합 테스트·E2E, 계약 정정, 구현 후 결과 기록.

### 제외 범위

- 백엔드 신규 개발. 별도 대시보드 집계 API도 추가하지 않는다(계약 §4.6에서 요청 철회).
- `전체 로그` 화면. 버튼은 비활성으로 유지한다(D-035).
- 최근 반영의 나머지 항목을 보는 경로(D-039 보류분)와 M8 기능 확장.
- `막힌 일` 요약 클릭(D-060·D-061 보류). 이번 M7에서는 요약 4개를 모두 정보 표시로만 둔다.
- 필드 이력 rollback으로 되돌리기를 구현하는 방식.
- 실제 Notion 페이지 생성·보관 성공 판정. MSW 결과로 판단하지 않는다.

## 의존 사항과 관련 문서

- [전체 계획](../frontend-plan.md), [제품·기술 결정](../../decision/frontend-decisions.md)(D-032~D-065, D-162), [대표 계약](../../contracts/frontend-api-contract.md)(§4.6, §5.4).
- [M6 계획](../m6/plan.md), [M6 결과](../m6/result.md): 태스크 목록·상세·확인 필요 상세와 URL 조건을 인계받는다.
  - M6의 Node 24 게이트 미실행은 M6 과제로 남는다.
  - 승인 조회 PM 제한과 실제 Notion 반영 미검증도 M6 과제다.
- [메인 시안](../../design/canvas/Main.dc.html): 시안 제목의 개수 표기(`확인이 필요한 일 3개`)는 D-062에 따라 쓰지 않는다.
- [MSW 안내](../../msw-guide.md), [파트 README](../../../README.md).

현재 구현과 변경 필요 사항은 다음과 같다. 정적 코드 확인 결과이며 실 API 검증이나 신규 합의를 뜻하지 않는다.

| 경계 | 현재 근거 | M7에서 필요한 변경 |
|---|---|---|
| 대시보드 화면 | [화면](../../../src/pages/dashboard/ui/DashboardPage.tsx), [라우트](../../../src/app/router/routes.tsx) | 대시보드 위젯 신설, 빈 상태 안내 교체. 온보딩 종료 진입 유지 |
| 조회 Query | [태스크](../../../src/entities/task/api/taskApi.ts), [승인 대기](../../../src/entities/approval/api/pendingApprovals.ts), [회의](../../../src/entities/meeting/api/meetingQueries.ts), [팀원](../../../src/entities/member/api/memberList.ts), [연동](../../../src/entities/integration/api/integrations.ts), [추출](../../../src/entities/extraction/api/extractionQuery.ts), [쿼리키](../../../src/shared/api/queryKeys.ts) | 재사용한다. 독립 조회는 병렬로 한다. 회의 상세 → 추출은 순서대로 조회한다 |
| 날짜 판정 | [서울 오늘](../../../src/shared/lib/date/today.ts), [마감 판정](../../../src/entities/task/lib/taskDate.ts), [목록 조건](../../../src/widgets/task-board/lib/taskBoard.ts)의 `addDays`·`soonUntil` | 날짜 계산을 `shared/lib/date`로 옮기고 M6 목록과 대시보드가 같이 쓴다 |
| 목록 URL 조건 | [목록 조건](../../../src/widgets/task-board/lib/taskBoard.ts) | `tab=needs_review`, `tab=in_progress&due=overdue,soon`은 이미 지원한다. `in_progress`는 미완료 태스크만 보여 주고 승인 항목을 넣지 않는다. 대시보드는 링크만 만든다 |
| 추출 DTO·모델 | [DTO](../../../src/shared/types/api/extraction.ts), [모델](../../../src/entities/extraction/model/types.ts), [매퍼](../../../src/entities/extraction/model/mapper.ts) | `reverted_at`·`approval_status`가 없어 추가가 필요하다. 되돌리기 API 함수는 없다 |
| 서버 되돌리기 | [API](../../../../backend/app/api/extractions.py), [태스크 삭제](../../../../backend/app/services/tasks.py), [스키마](../../../../backend/app/schemas/meeting.py) | PM 전용이다. 처리 내용은 아래와 같다 |
| Notion 반영 표시 | [polling](../../../src/features/task-notion-sync/model/useTaskNotionSync.ts), [주기](../../../src/features/task-notion-sync/lib/notionSyncLabel.ts) | 태스크의 `notion_sync_status`로 판정한다. 3초 polling 패턴을 재사용한다 |
| 역할 분기 | [공간 목록·역할](../../../src/entities/workspace/api/workspaceList.ts), [태스크 보드 예](../../../src/widgets/task-board/ui/TaskBoard.tsx) | `role === 'pm'`일 때만 승인 조회를 켠다 |
| MSW | [추출 handler](../../../src/shared/mock/handlers/extraction.ts), [승인 handler](../../../src/shared/mock/handlers/approval.ts), [태스크 handler](../../../src/shared/mock/handlers/task.ts), [추출 픽스처](../../../src/shared/mock/fixtures/extraction.ts), [시나리오](../../../src/shared/mock/scenarios.ts) | 되돌리기 handler와 대시보드 시나리오가 필요하다 |
| 계약 | [대표 계약](../../contracts/frontend-api-contract.md) §5.4 | 최근 반영 판정이 history rollback·`is_rolled_back` 기준으로 적혀 있어 현재 구현과 다르다. 정정이 필요하다 |

서버 되돌리기의 처리 내용은 다음과 같다.

- **처리 순서**:
  1. 태스크를 지움 표시하고 Notion 페이지 보관을 요청한다.
  2. `TASK_CREATE` 승인을 새로 만든다.
  3. 항목에 `reverted_at`을 기록한다. 항목의 `task_id`는 비우고 새 승인 ID로 바꾼다.
- **응답**: `{item_id, reverted_task_id, approval_id, reverted_at}`
- **거부**: 409 `AUTO_TASK_NOT_REVERTIBLE`. `details.reason`은 다음 중 하나다.
  - `already_reverted`, `not_auto_created`, `task_missing`
  - `task_changed`: `task_version`이 함께 온다.
  - `pending_approval`: `approval_id`가 함께 온다.
- **기타 오류**: 404 `EXTRACTION_NOT_FOUND`·`EXTRACTION_ITEM_NOT_FOUND`, 일반 팀원 403 `FORBIDDEN`.

## 구현 순서

### 1. 데이터 조립과 공통 판정

- 기존 태스크·승인·회의·팀원·연동 Query를 재사용해 대시보드 조립 훅을 만든다.
  - 워크스페이스별 쿼리키(`['workspace', id, ...]`)를 그대로 쓴다. 공간을 바꾸면 이전 공간의 데이터가 섞이지 않게 한다.
  - 독립 조회는 병렬로 실행한다.
  - 최신 완료 회의의 상세와 그 추출 결과는 필요한 순서로 조회한다(회의 목록 → 회의 상세 → 추출).
- 날짜 계산을 `shared/lib/date`로 공통화하고 M6 목록이 같은 함수를 쓰도록 바꾼다.
  - 대상: 날짜 더하기, `soon` 마지막 날 계산.
  - 서울 날짜 기준으로 오늘부터 6일 뒤까지를 ‘7일 이내’로 판정한다(D-043, D-144).
  - M6 목록의 동작은 바꾸지 않는다.
- 일반 팀원에게는 다음을 렌더링하지 않고, 승인 API도 호출하지 않는다(D-104, D-163).
  - 확인 대기 숫자
  - 확인 필요 영역
  - PM 전용 액션(되돌리기, 회의 업로드·Notion 설정 이동)

### 2. 요약·확인 필요·마감 임박

- **요약**
  - `확인 대기 → 기한 지남 → 7일 이내 마감 → 막힌 일` 순서로 표시한다(D-055).
  - 표시 행 수가 아니라 전체 데이터로 집계한다(D-052).
  - 요약은 모두 클릭할 수 없는 정보다(D-061).
  - 완료 태스크와 마감 없는 태스크는 마감 집계에서 뺀다. 기한 지남과 7일 이내는 중복 집계하지 않는다(D-053, D-054).
- **제목**
  - PM: 확인 필요가 있으면 `확인이 필요한 일이 있어요`, 없으면 `확인이 필요한 일이 없어요`(D-062, D-064).
  - 일반 팀원: 중립적인 `워크스페이스 현황`.
- **최근 처리 회의 안내**
  - 시작 시각 기준 최신 완료 회의로 정한다. 클릭 기능은 두지 않는다(D-063).
  - 완료 회의가 없으면 `아직 정리한 회의가 없어요`(D-065).
- **확인 필요(PM)**
  - 대기 시작이 오래된 순으로 최대 5개 표시한다(D-049~D-051).
  - `확인하기`·`채워 넣기`는 확인 필요 상세 `/approvals/:approvalId`로 이동한다(D-034, D-162).
  - 전체 보기는 `tab=needs_review` 목록으로 이동한다.
- **마감 임박**
  - 기한 지남을 경고 상태로 먼저 보여 주고, 이후 마감 가까운 순으로 최대 5개 표시한다(D-044, D-045).
  - 행 전체가 태스크 상세 링크다(D-047).
  - 5개를 넘으면 `tab=in_progress&due=overdue,soon`으로 이동한다(D-046). 이 목록은 승인 항목 없이 같은 대상만 보여 준다.
  - 비어 있으면 `마감이 임박한 태스크가 없습니다`(D-048).

### 3. 최근 반영 표시

- 최신 완료 회의 한 건에서 `gate=auto` 항목을 기존 응답 순서대로 최대 3개 표시한다(D-038, D-039). `전체 로그`는 비활성으로 둔다(D-035).
- 반영 상태는 연결된 태스크의 서버 상태로 구분한다: 반영 대기, 반영 실패, 반영 완료.
  - `synced`만 반영 완료로 표시한다.
  - `reverted_at`이 있으면 `되돌림`을 우선 표시한다.
- 반영 대기 항목이 있으면 기존 3초 polling 패턴을 적용한다. 모두 완료·실패가 되거나 화면을 떠나면 멈춘다.
- 빈 상태는 다음 순서로 판정한다(D-040~D-042). PM 전용 이동은 일반 팀원에게 노출하지 않는다.

  | 순서 | 원인 | 이동 |
  |---|---|---|
  | 1 | 완료 회의 없음 | 회의 업로드 |
  | 2 | Notion 미연결(`connected`가 아닌 상태) | Notion 설정 |
  | 3 | 자동 처리 항목 없음 | 최근 회의록 |

### 4. 되돌리기

- 전용 API 함수와 오류 처리를 추가한다. 경로는 `POST /extractions/{extraction_id}/items/{item_id}/revert`다.
- 확인 모달(D-036):
  - 자동 생성 태스크가 삭제되고 확인 필요 요청이 새로 생긴다는 점을 설명한다.
  - 취소하면 아무것도 바꾸지 않는다.
  - 처리 중에는 중복 제출을 막는다.
- 서버 성공 후에만 반영한다. 낙관적 업데이트는 하지 않는다(D-137).
  - 성공한 행은 위치를 유지하고, `되돌림` 상태와 새 확인 필요 상세 링크를 표시한다(D-037).
  - 태스크·승인·추출 캐시를 무효화한다.
- 거부 사유 `details.reason`을 구분해 안내한다.
  - 대상: 수정된 태스크(`task_changed`), 대기 승인 존재(`pending_approval`), 이미 되돌림(`already_reverted`) 등.
  - 실패하면 성공 표시를 하지 않고 최신 상태를 다시 조회한다. 네트워크 실패도 같다.

### 5. MSW·계약·화면 검증

- 추출 픽스처·handler에 `reverted_at`·`approval_status`를 넣는다.
- 되돌리기 handler가 서버 동작을 재현하게 한다.
  - 재현할 동작: 태스크 삭제, 승인 생성, 항목 연결 변경.
  - 재현할 거부 조건: `already_reverted`, `task_changed`, `pending_approval`, `not_auto_created`, `task_missing`, PM 외 403.
- 대시보드 시나리오를 추가한다.
  - 기본, 빈 상태 3종, 반영 대기·실패, 되돌림 거부, 일반 팀원, 부분 조회 실패.
- 로딩·실제 빈 데이터·조회 오류를 구분해 표시한다.
  - 일부 조회가 실패해도 전체 화면을 막지 않는다.
  - 실패한 집계를 `0`으로 표시하지 않는다.
- Storybook 스토리, 통합 테스트, E2E를 작성한다.
- 구현 후 대표 계약을 정정한다(contract-update). 구현 사실과 실서버 검증 여부를 구분한다.
  - ‘자동 처리 = Notion 반영 완료’로 읽히는 서술을 고친다.
  - §5.4의 필드 이력 rollback 기준 설명을 항목 되돌리기로 바꾼다.
- 결과는 `result.md`와 파트 README에 기록한다.

## 완료조건과 검증

| ID | 완료조건 | 검증 방법 |
|---|---|---|
| AC-01 | 요약은 전체 데이터로 집계되어 제한된 목록과 일치하고, 날짜 중복 집계가 없다 | 단위 테스트: 어제·오늘·+6일·+7일, 월·연도 경계, 완료·마감 없음 |
| AC-02 | 확인 필요·마감 임박 목록의 정렬, 최대 5개, 상세·전체 보기 이동이 맞다 | 통합 테스트, 핵심 이동 E2E |
| AC-03 | 최신 완료 회의의 `gate=auto` 항목만 최대 3개 표시하고, 반영 대기·실패·완료·되돌림을 구분하며, polling을 시작·중단한다 | MSW 통합 테스트 |
| AC-04 | 되돌리기 성공 후 행 유지·새 확인 필요 링크·캐시 갱신이 일관된다 | 테스트: 성공·취소·중복 제출·서버 거부 사유별·네트워크 실패 |
| AC-05 | 빈 상태 3종, 부분 오류, 역할별 노출·승인 미호출, 공간 전환이 올바르다 | 통합 테스트, Storybook |
| AC-06 | 키보드 이동, 모달 포커스, 기존 온보딩 종료·로그인 후 대시보드 진입이 유지된다 | E2E와 화면 확인 |

### 최종 게이트

Node 24에서 다음을 실행한다. 실행한 Node 버전과 결과를 `result.md`에 기록한다.

- `typecheck`, `lint`, `format:check`, `test`, `build`
- Storybook 회귀(`build-storybook`, `test:storybook`)
- 관련 E2E

## 위험 및 미결 사항

- **실제 Notion 처리 미확인**: 되돌리기 후 Notion 페이지 보관은 서버 워커가 비동기로 처리한다([태스크 삭제](../../../../backend/app/services/tasks.py)). 실제 보관 성공은 이번 범위에서 확인하지 않고 별도 연동 검증으로 남긴다.
- **D-038 해석**: 계약의 ‘자동 처리 항목’은 Notion 반영 완료를 뜻하지 않는다. 반영 여부는 태스크의 `notion_sync_status`로 따로 표시한다.
- **보류 결정**: D-039(표시 개수 3개)와 D-060·D-061(`막힌 일` 클릭)은 이번 M7에서 위 기본값으로 구현한다. 최종 결정은 아니다.
- **검증 환경**: M6의 Node 24 게이트 미실행과 M5 E2E 간헐 실패가 M7 검증에 영향을 줄 수 있다. 영향을 받으면 원인을 구분해 기록한다.
- **승인 조회 권한**: 서버의 승인 조회는 아직 PM으로 제한되지 않는다(M6 과제). 일반 팀원 차단은 프론트의 미호출로만 보장된다.
