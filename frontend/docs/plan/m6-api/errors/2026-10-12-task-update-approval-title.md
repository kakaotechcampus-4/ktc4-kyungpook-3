# 수정 승인 이름을 잘못된 필드에서 읽음

- 구분: FE 수정
- 상태: 수정함 (`59e0b0c`). 실제 서버 데이터로 화면 확인은 아직 하지 않았다.

## 현상

실 API에서 기존 태스크 수정 승인(`task_update`)의 카드·상세 제목이 항상 「제목 없는 확인 요청」으로 보인다.

## 원인

- 프론트는 수정 승인의 이름을 `payload.title`에서 읽었다(`frontend/src/entities/approval/model/mapper.ts`).
- 서버는 대상 태스크 이름을 `payload.task_title`에, 제안할 때 본 제목을 `payload.base_title`에 싣는다. `title`은 승인하면 실제로 바뀌는 키라서 이름에 쓰지 않는다(`backend/app/api/extractions.py:378` 주석).
- MSW의 수정 승인 데이터에도 `task_title`이 없어 모의 실행에서는 이 차이가 드러나지 않았다.

## 조치

- 이름을 `task_title`, 없으면 `base_title`에서 읽는다. `title`은 변경 항목으로만 다룬다.
- MSW 수정 승인 데이터(`ap_04`)에 서버처럼 `task_title`·`base_title`을 넣었다.
- 매퍼 단위 테스트를 추가했다.
