# 근거 화자에 Discord uid가 그대로 보임

- 구분: FE 수정
- 상태: 수정함 (`a935bdb`). 실제 서버 데이터로 화면 확인은 아직 하지 않았다.

## 현상

승인 카드와 확인 필요 상세의 근거 영역에 화자가 이름이 아니라 숫자 ID로 보일 수 있다.

## 원인

- 서버의 `evidence_speaker`는 별칭이나 이름이 아니라 발화 트랙의 Discord uid다(`backend/app/schemas/meeting.py:165`).
- 프론트는 이 값을 이름으로 보고 그대로 화면에 썼다(`ApprovalCard.tsx`, `ApprovalReview.tsx`).
- MSW 데이터는 화자에 이름(`김서연`)을 넣어 두어 모의 실행에서는 드러나지 않았다.

## 조치

- `entities/member`의 `speakerName`이 Discord uid로 연결된 팀원 이름을 찾는다. 연결된 팀원이 없으면 uid를 보여 주지 않고 「알 수 없음」으로 표시한다.
- MSW 화자 데이터를 Discord uid로 바꿨다.
