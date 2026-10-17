# E-06 M6 태스크 상세도 재조회 실패를 숨긴다

- 출처: E-02를 검토하다가 발견했다. 두 리뷰의 지적 사항은 아니다.
- 관련: M6 태스크 상세·Notion 반영 polling. M7 범위 밖이다.
- 상태: 별도 이슈로 분리(2026-10-18) — [#236](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/236). 이번 M7에서 고치지 않는다.

## 문제

`frontend/src/widgets/task-detail/ui/TaskDetail.tsx:59`는 `task.data`가 있으면 `task.error`보다 먼저 정상 본문을 그린다. [E-02](E-02-refetch-error-hidden.md)와 같은 순서다.

Notion 반영 polling(`frontend/src/features/task-notion-sync/model/useTaskNotionSync.ts`의 `notionSyncRefetchInterval`)은 조회 오류가 나면 멈춘다.

## 결과

태스크 상세를 열어 둔 채 `반영 대기` 확인 중에 재조회가 실패하면 polling이 멈춘다. 그런데 화면은 마지막으로 받은 `반영 대기`를 안내 없이 계속 보여 준다.

## 메모

E-02에서 대시보드에 만드는 판정 함수와 갱신 실패 표시를 M6에도 재사용할 수 있다. 후속 작업으로 판단한다.
