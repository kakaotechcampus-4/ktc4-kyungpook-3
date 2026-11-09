# 쓰이지 않는 승인 종류 reminder_dm 을 백엔드에서 지운다

- 날짜: 2026-11-09
- 이슈: #335
- PR: (PR 번호)
- 브랜치: feature/335-drop-reminder-dm
- 작성자: 김동우

## 한 일

- `app/models/models.py` 의 `ApprovalType.REMINDER_DM` 을 지웠다.
- `app/api/approvals.py` 에서 승인할 때 고칠 수 있는 필드 표의 reminder_dm 항목, 승인 반영 함수의 reminder_dm 설명 주석, `create_approval` 의 reminder_dm 400 거절 분기를 지웠다.
- `app/schemas/approval.py` 의 `type` 설명에서 reminder_dm 문구를 지웠다.
- `tests/api/test_approval_task_overrides.py` 의 reminder_dm 테스트 7개를 하나로 줄였다. 남은 테스트는 type=reminder_dm POST 가 400 INVALID_REQUEST 이고 승인 요청 행을 만들지 않는지 본다.
- `docs/프로젝트 상세 설명.md` 의 ApprovalRequest 종류에서 reminder_dm 을 지웠다.

## 왜

리마인드 승인은 메시지 묶음 승인으로 옮겨 갔고 reminder_dm 을 만드는 코드가 없다. 앞선 #408 이 POST 로 새로 만드는 길을 막았고, 운영 DB 에 reminder_dm 행이 0건임을 확인했다(#335 댓글).

거절 분기까지 지워도 응답 상태는 그대로다. `app/main.py` 의 검증 오류 처리기가 enum 검증 실패를 400 INVALID_REQUEST 로 돌려준다. 바뀌는 것은 `error.details` 모양뿐이다(`{field, allowed}` 에서 `{fields: [...]}`). POST /approvals 를 부르는 FE·AI 코드는 없다.

본문 검증이 소속 확인보다 먼저 돌게 되어, 소속이 아닌 공간에 reminder_dm 을 보내도 400 이 난다. 다른 잘못된 type 값도 원래 그랬고 공간에 대한 정보는 드러나지 않는다. 그래서 "비소속이면 소속 확인이 먼저" 테스트는 지웠다.

## 결과

| 항목 | 값 |
|---|---|
| `pytest -q` (SQLite) | 3120 통과, 2190 건너뜀 |
| `pytest -q` (PostgreSQL 16 + pgvector, `TEST_DATABASE_URL`) | 5243 통과, 67 건너뜀 |
| `git grep "reminder_dm\|REMINDER_DM" -- backend/app` | 0줄 |
| 비용 | 0원 |

## 다음

- FE 의 reminder_dm 타입·목업·테스트와 `frontend/docs/contracts/frontend-api-contract.md` 의 reminder_dm 문구(291, 754줄) 정리는 배포 뒤 #348 후속에서 한다.
- `docs/Manager's Manager 계약·엔티티·흐름.excalidraw.md` 의 reminder_dm 표기는 그대로 두었다.
