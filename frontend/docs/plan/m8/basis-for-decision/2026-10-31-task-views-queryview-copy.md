# `queryView` 판정을 task-board 안에 사본으로 두는 선택

- 기록일: 2026-10-31
- 관련 마일스톤: M8-A(#243)
- 후속: #236 뒤 shared 로 합침(2026-11-05, #396). task-board 사본을 지우고 [shared의 queryView](../../../../src/shared/lib/query-view/queryView.ts)를 쓴다.

## 문제와 제약

- 보기별 조회 상태(대기·최초 실패·성공·재조회 실패)를 가르려면, M7 대시보드의 `queryView`(#236 뒤 [shared/lib/query-view/queryView.ts](../../../../src/shared/lib/query-view/queryView.ts))와 같은 판정이 필요했다. `{data, error}`로 `loading`·`error`·`ready`·`refreshFailed`를 정하는 4줄짜리 함수다.
- 이 함수는 `widgets/dashboard` 안에 있다. 저장소의 FSD 경계 검사(`eslint-plugin-boundaries`의 `boundaries/dependencies`)는 위젯끼리 import하는 것을 막는다.
- 판정을 `shared`로 옮기는 일은 #236(M6 태스크 상세의 재조회 실패 표시, [E-06](../../m7/errors/E-06-m6-detail-refetch-error-hidden.md))의 해결 방향에 들어 있다. #236은 별도 워크트리(`fix-236-task-detail-refetch-error`)에서 진행 중이다.

## 실제 검토한 선택지

구현 워커 보고와 코디네이터 지시에 남은 선택지다.

1. `widgets/dashboard`에서 가져다 쓴다 — 경계 검사가 막는다.
2. 이번 브랜치에서 `shared`로 옮기고 대시보드와 함께 쓴다 — 별도 워크트리에서 진행 중인 #236 작업과 같은 판정을 옮기게 되어 병합 충돌이 생길 수 있다.
3. 같은 판정을 `widgets/task-board` 안에 작은 사본으로 두고, #236이 `shared`로 옮기면 교체한다.

## 선택과 이유

3을 택했다. [taskViews](../../../../src/widgets/task-board/lib/taskViews.ts)에 `QueryView` 타입과 `queryView`를 두었다. 주석에는 대시보드와 같은 판정이라는 점과, #236에서 `shared`로 옮겨지면 교체한다는 점을 적었다. 경계 규칙을 지키면서 #236 워크트리와의 충돌을 피한다. V2 리뷰는 본문이 대시보드와 같은 4줄 판정임을 확인하고 「복제는 작고 교체 의도가 명확하다」고 보았다. V3도 중복 자체를 결함으로 다시 지적하지 않았다.

## 장단점과 감수한 제약

- #236이 병합될 때까지 같은 판정이 두 곳에 있다. 한쪽 규칙만 바뀌면 대시보드와 태스크 보기가 실패를 다르게 판정할 수 있다.
- 교체는 이 브랜치가 아니라 후속 작업이다.

## 영향 범위와 재검토 조건

- 영향: `widgets/task-board/lib/taskViews.ts`의 `queryView`와 이를 쓰는 [TaskBoard](../../../../src/widgets/task-board/ui/TaskBoard.tsx).
- 후속: #236에서 `shared`의 판정이 생기면 task-board 사본을 지우고 그쪽을 import한다. 그 전에 판정 규칙을 바꿔야 하면 두 곳을 함께 고친다.

## 근거와 관련 문서

- [M8 결과 A](../result-a.md)의 「남은 작업과 제한 사항」
- [M7 결과](../../m7/result.md)의 E-02(재조회 실패 표시)와 #236 분리
- 구현 커밋 `608d188`. 구현 워커 보고와 V2·V3 리뷰는 코디네이터 작업 폴더의 임시 파일이다(저장소 밖).
