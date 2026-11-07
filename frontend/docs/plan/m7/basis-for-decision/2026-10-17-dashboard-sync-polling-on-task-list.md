# 최근 반영의 반영 대기 polling을 태스크 목록 조회로 하는 선택

- 기록일: 2026-10-17
- 관련 마일스톤: M7

## 문제와 제약

- 최근 반영 행의 상태는 연결된 태스크의 `notion_sync_status`로 정한다(계획 §3). 반영 대기 항목이 있으면 3초 polling을 하고, 모두 끝나거나 화면을 떠나면 멈춰야 한다.
- 대시보드는 요약·마감 임박 때문에 이미 태스크 목록(`GET /tasks?workspace_id=`) 전량을 받는다.
- M6의 3초 polling 패턴([useTaskNotionSync](../../../../src/features/task-notion-sync/model/useTaskNotionSync.ts))은 태스크 **상세** 조회 하나를 다시 부른다.

## 실제 검토한 선택지

1. 행마다 M6처럼 태스크 상세 조회에 3초 간격을 건다. 최대 3개 요청이 3초마다 나간다.
2. 이미 받는 태스크 목록 조회 하나에 간격을 건다. 상태 판정은 목록 데이터로 한다.

## 선택과 이유

2를 택했다. 같은 화면의 요약·마감 임박이 같은 목록을 쓰므로, 상세를 따로 받으면 행의 상태와 요약 숫자가 서로 다른 시점의 데이터가 된다. 목록 하나면 요청도 3초에 1회다. M6 패턴에서는 간격 상수(`NOTION_SYNC_POLL_MS`)와 「조회 실패 시 멈춤」 규칙을 그대로 가져왔다([useDashboardData](../../../../src/widgets/dashboard/model/useDashboardData.ts)).

## 장단점과 감수한 제약

- polling 응답이 태스크 전량이라 상세보다 크다. 목록에 페이지네이션이 없는 현재 구조(계약 §4.6)를 전제로 한다.
- 판정 대상은 최근 반영에 보이는 항목의 태스크뿐이다. 다른 태스크가 `pending`이어도 돌지 않는다(`hasPendingSync`).

## 영향 범위와 재검토 조건

태스크 목록에 페이지네이션이 생기거나 목록이 커져 3초 간격이 부담이 되면 행별 상세 조회로 바꾼다.

## 근거와 관련 문서

- [M7 계획](../plan.md) §3, [M7 결과](../result.md)
- 판정 테스트 [dashboard.test.ts](../../../../src/widgets/dashboard/lib/dashboard.test.ts), 화면 테스트 [dashboard.test.tsx](../../../../src/app/dashboard.test.tsx)의 「반영 대기 polling」
