# 계획 — 최신 완료 회의 선택의 전체 정렬 제거 (#350)

- 작성일: 2026-11-05
- 상태: 구현 전 계획. 완료 판정과 테스트 성공 기록은 포함하지 않는다.
- 근거: 이슈 #350, 현재 작업 트리의 코드(base `origin/develop` `c8fe3ef0`), 사용자 지시(2026-11-05: `plan/refactor/`에 계획·결과 파일 작성, 변경 전후 비용을 실제 규모와 큰 목록으로 나눠 측정).
- 위치: [전체 계획](../frontend-plan.md)의 M0~M8 번호에 속하지 않는 수정 계획이다. 원 구현은 [M7 계획](../m7/plan.md) §1이다. 전체 계획·기존 마일스톤 계획은 수정하지 않는다.

## 목표와 배경

대시보드는 최근 반영 영역에 쓸 회의 하나를 고르려고 `latestDoneMeeting`을 렌더마다 부른다. 이 함수는 회의록 목록용 `toMinutesList`를 거쳐 전체 목록을 복사·정렬하고 세 번 거른 뒤 첫 항목만 쓴다. 고르는 데 필요한 것은 한 번의 순회다.

선택 결과와 동률 처리는 그대로 두고, 정렬·분류 없이 한 번 훑어 고르게 바꾼다. 서버 응답이 정렬됐다고 가정하지 않는다.

## 현재 선택 기준

[minutesList.ts](../../../src/entities/meeting/lib/minutesList.ts)의 `byStartedAtDesc` 뒤 `status === 'done'`의 첫 항목이다.

| 기준 | 현재 동작 |
|---|---|
| 완료 상태 | `status === 'done'`만 후보다. `processing`·`failed` 등은 시작 시각이 더 늦어도 건너뛴다 |
| 시작일 | `Date.parse(startedAt)`의 시점 내림차순. 문자열이 아니라 시점으로 비교한다 |
| 날짜 누락 | `Date.parse`가 `NaN`이면 `-Infinity`로 친다. 날짜가 있는 회의보다 항상 뒤다 |
| 같은 시작일 | 안정 정렬이라 받은 순서에서 앞의 회의다. 모든 후보의 날짜를 읽을 수 없으면 받은 순서의 첫 완료 회의다 |
| 빈 목록·완료 없음 | `null` |

## 범위

- 포함: [dashboard.ts](../../../src/widgets/dashboard/lib/dashboard.ts)의 `latestDoneMeeting` 본문, [dashboard.test.ts](../../../src/widgets/dashboard/lib/dashboard.test.ts)의 선택 기준 테스트, 변경 전후 비용 측정, 이 계획과 결과 문서.
- 제외
  - [minutesList.ts](../../../src/entities/meeting/lib/minutesList.ts). 회의록 화면은 세 목록 모두를 그리므로 정렬이 필요하고, #256이 같이 고칠 수 있는 파일이다.
  - [useDashboardData.ts](../../../src/widgets/dashboard/model/useDashboardData.ts)의 회의 상세 워크스페이스 검사(`detailMismatch`)와 polling(#349·#354 몫).
  - Frontend README. 병합 때 반영한다.

## 작업 순서

1. **기준 고정.** 바꾸기 전 코드에서 위 표의 다섯 기준을 테스트로 묶고 통과를 확인한다. 회의록 기본 진입(`latestMinutesId`)과 같은 회의를 고르는지 임의 입력 200개로 대조한다.
2. **한 번 순회.** `latestDoneMeeting`을 완료 회의만 보며 더 늦은 시점일 때만 후보를 바꾸는 순회로 바꾼다. 같은 시점이면 바꾸지 않아 앞의 회의가 남는다. `toMinutesList` import를 지운다.
3. **useMemo 판단.** 측정 결과로 정한다. 실제 규모에서 순회 비용이 렌더 비용에 비해 무시할 만하면 hook은 바꾸지 않는다.
4. **측정.** 변경 전(`toMinutesList(...).minutes[0]`)과 변경 후를 같은 프로세스에서 번갈아 잰다. 30건, 1,000건, 10,000건으로 나눈다.
5. **검사와 기록.** typecheck·lint·format:check·build·대시보드 관련 Vitest를 돌리고 결과 문서에 남긴다.

## 완료조건과 검증

| ID | 완료조건 | 검증 방법 |
|---|---|---|
| AC-01 | 위 표의 기준이 변경 전 코드에서 테스트로 고정되고, 변경 후에도 같은 테스트가 수정 없이 통과한다 | `dashboard.test.ts` 「최신 완료 회의 선택 기준 (#350)」을 변경 전·후에 각각 실행 |
| AC-02 | 대시보드가 고르는 회의가 회의록 기본 진입과 같다 | 같은 묶음의 임의 입력 대조 테스트 |
| AC-03 | `latestDoneMeeting`이 목록을 복사·정렬하지 않는다 | 코드 diff |
| AC-04 | 변경 전후 비용을 크기별로 측정 조건과 함께 기록한다. 작은 목록의 체감 개선은 단정하지 않는다 | 측정 스크립트 출력 |
| AC-05 | typecheck·lint·format:check·build와 대시보드 관련 Vitest가 통과한다 | 명령 실행 결과 |

## 위험 및 미결 사항

- 위험: 날짜 해석 규칙(`NaN` → `-Infinity`)이 `minutesList.ts`와 두 곳에 있게 된다. AC-02의 대조 테스트가 두 규칙이 어긋나면 실패한다.
- 미결 사항: 없음.
