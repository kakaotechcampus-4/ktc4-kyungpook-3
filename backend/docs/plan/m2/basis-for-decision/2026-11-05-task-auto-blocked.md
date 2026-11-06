# 태스크 응답의 자동 막힘 여부는 이력이 아니라 취소 API 조건으로 판정한다

- 기록일: 2026-11-05
- 관련 마일스톤: M2 (이슈 #365, 관련 #330·#346, PR #373)

## 문제와 제약

- FE 보드는 막힌 카드가 무응답 자동 막힘인지 알려고 카드마다 `GET /tasks/{task_id}/history` 를 불렀다. 막힌 태스크가 많아지면 보드를 열 때마다 요청도 그만큼 늘어난다(#365).
- FE 의 요청은 `TaskResponse` 에 자동 막힘 여부를 싣고, `POST /tasks/{task_id}/auto-block/undo` 가 성공할 수 있을 때만 true 로 해 달라는 것이었다.
- FE 계약 §5.7 과 #330 은 "이력의 마지막 status 변경이 `change_source: scheduler` 인가"로 자동 막힘을 가린다. 그런데 undo 는 이력을 보지 않는다. undo 는 열려 있고 막힘을 실제로 건(applied) 무응답 감시 기록이 있는지, 태스크가 blocked 이고 사유가 스케줄러 문구(`BLOCKER_TEXT`)인지를 본다([scheduler.py](../../../../app/services/scheduler.py) `undo_auto_block`).
- 그래서 두 기준이 다른 답을 내는 경우가 있다.
  - 자동 막힘 뒤 PM 이 사유만 고친 경우: 이력 기준으로는 자동 막힘인데 undo 는 409 다.
  - 자동 막힘 뒤 상태를 진행 중으로 바꿨다가 다시 막힘으로 바꾼 경우: 이력 기준으로는 사람 변경인데 undo 는 200 이다. 사유가 그대로 남고, 막힘 상태의 감시는 사람의 변경으로 닫히지 않기 때문이다.
- DB 모델과 마이그레이션은 바꾸지 않는다.

## 실제 검토한 선택지

설계 초안에서 검토했고, 사용자와 2026-11-05 에 확정했다([#365 설계 확정 댓글](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/365#issuecomment-6637008816)).

- 판정 기준
  - 이력의 마지막 status 변경 출처: 위 두 경우에서 undo 결과와 어긋난다.
  - undo 의 성공 조건(감시 기록과 사유): 요청의 "undo 가 성공할 때만 true"와 정확히 맞는다.
- 계산 위치
  - A. 스케줄러 서비스의 판정 함수를 undo 와 응답 조립이 같이 쓰고, 라우터 헬퍼에서 응답을 만든다.
  - B. Task 에 상관 서브쿼리 `column_property` 를 둔다.
  - C. Task 에 `auto_blocked` 컬럼을 두고 막힘·해제·undo·PATCH 때마다 갱신한다.
- 사용자에게 물은 것
  - 7개 응답 경로 모두에 필수 필드로 넣을지, 목록·상세에만 넣을지.
  - "상태를 바꿨다가 다시 막힘" 경우에 undo 가 성공하는 지금 동작을 그대로 둘지.
  - PM 과 팀원에게 같은 값을 줄지.

## 선택과 이유

- 판정은 undo 의 성공 조건으로 한다. `auto_blocked` 의 뜻을 "지금 undo 를 부르면 성공하는가" 하나로 고정하면, FE 가 버튼을 보여 줬는데 누르면 409 가 나는 일이 판정 기준 때문에 생기지 않는다.
- A 를 골랐다.
  - 판정 조각 `_auto_block_state` 와 `_undoable_watches` 를 [scheduler.py](../../../../app/services/scheduler.py) 한 곳에 두고, `undo_auto_block` 과 `auto_blocked_ids` 가 같이 쓴다.
  - B 는 모델이 스케줄러 문구와 감시 상태를 알아야 해서 의존 방향이 뒤집힌다. Task 를 읽는 모든 곳에 서브쿼리가 붙는 것도 문제였다.
  - C 는 마이그레이션이 필요하다. 갱신 지점을 하나라도 빠뜨리면 undo 와 어긋난다.
- `TaskResponse` 를 돌려주는 7개 경로 모두에 기본값 없는 필수 필드로 넣는다([schemas/task.py](../../../../app/schemas/task.py), [api/tasks.py](../../../../app/api/tasks.py) `_task_responses`). 응답을 만드는 곳 하나를 빠뜨리면 조용히 false 가 나가지 않고 검증 오류로 드러난다.
- "상태를 바꿨다가 다시 막힘" 경우는 지금 동작 그대로 true 로 둔다. #365 는 표시를 다루는 이슈이고, undo 동작을 바꾸면 #330·#346 에서 맞춘 내용이 바뀐다.
- PM 과 팀원 모두 같은 값을 받는다. undo 는 계속 PM 전용이다.
- 지운 태스크는 undo 가 404 이므로 후보에서 뺀다. 최종 리뷰 지적을 받아 정했다.

## 장단점과 감수한 제약

- 목록은 태스크 수와 상관없이 감시 기록을 최대 한 번 읽는다. 후보(blocked 이고 사유가 스케줄러 문구이며 지우지 않은 태스크)가 없으면 읽지 않는다.
- 목록은 잠금 없이 읽는다. 스케줄러가 같은 순간에 커밋하면 잠깐 false 로 보일 수 있다. FE 는 409 `AUTO_BLOCK_NOT_FOUND` 를 받으면 다시 불러오는 처리를 그대로 둔다.
- 단건 응답마다 쿼리가 최대 한 번 는다. 막힘 후보일 때만이다.
- FE 계약 §5.7 의 이력 기준 설명은 FE 가 이 필드 기준으로 고쳐야 한다. BE 는 frontend/ 문서를 고치지 않는다.

## 영향 범위와 재검토 조건

- 영향: `TaskResponse` 를 받는 FE 화면(보드, 상세). AI 는 `TaskResponse` 를 받지 않는다.
- 재검토 조건
  - undo 의 성공 조건이 바뀌면 `auto_blocked` 도 같이 바뀐다. 판정 조각을 공유하므로 따로 고칠 곳은 없다.
  - "사람이 상태를 한 번이라도 건드리면 자동 막힘이 아니다"로 바꾸려면 undo 동작부터 별도 이슈로 바꾼다.
  - 막힌 태스크가 크게 늘어 `IN (...)` 목록이 길어지면 쿼리 방식을 다시 본다.

## 근거와 관련 문서

- 코드: [scheduler.py](../../../../app/services/scheduler.py) `_auto_block_state`·`_undoable_watches`·`auto_blocked_ids`·`undo_auto_block`, [api/tasks.py](../../../../app/api/tasks.py) `_task_responses`, [schemas/task.py](../../../../app/schemas/task.py) `TaskResponse.auto_blocked`
- 테스트: [test_scheduler.py](../../../../tests/api/test_scheduler.py) auto_blocked 판정 절(판정과 undo 결과가 같은지 경우별로 확인), [test_task_auto_blocked.py](../../../../tests/api/test_task_auto_blocked.py)(7개 경로, 팀원 조회, 목록 쿼리 수)
- 운영 설명: [backend/README.md](../../../../README.md) "자동 막힘 표시" 행
- FE 계약(FE 가 갱신): [frontend-api-contract.md](../../../../../frontend/docs/contracts/frontend-api-contract.md) §5.7
- 검증: 2026-11-05 `pytest -q -p no:cacheprovider` 1261 passed, 791 skipped(PostgreSQL 변형, TEST_DATABASE_URL 없음). PostgreSQL 실행 계획은 확인하지 못했다.
