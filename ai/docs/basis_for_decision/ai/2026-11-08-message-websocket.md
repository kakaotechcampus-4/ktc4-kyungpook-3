# 대화 새 글 웹소켓 신호

- 날짜: 2026-11-08
- 이슈: #520
- PR: PR_NUMBER
- 브랜치: feature/520-message-websocket (#518 위)

## 한 일

BE 에 대화 신호 웹소켓 `/api/v1/workspaces/{workspace_id}/messages/ws` 를 더했다. 글을 만드는 서비스 함수가 트랜잭션 안에서 신호를 등록하고, 바깥 커밋이 끝나면 대화 주인과 PM 전원의 열린 소켓에 `thread_updated` 를 보낸다. 소켓은 로그인 쿠키로 인증하고 30초마다 세션과 소속을 다시 확인한다. 계약은 `frontend/docs/contracts/frontend-api-contract.md` §5.7 에 적었다.

## 왜

대화를 열어 둔 사람이 상대의 새 글을 30초 polling 을 기다려야 보였다. 설계의 트레이드오프는 [결정 0053](2026-11-08-0053-message-thread-websocket-signal.md).

## 결과

| 항목 | 값 |
|---|---|
| backend 전체 pytest (sqlite·PostgreSQL) | 4285 passed, 45 skipped (리뷰 반영 전) |
| 소켓 테스트 `tests/api/test_message_socket.py` | 88 passed (리뷰 반영 뒤) |
| 실제 uvicorn, 응답 없이 멈춘 클라이언트가 닫히기까지 | 30.6초 (기본 ping 20초 간격, 20초 대기) |
| 실제 uvicorn, 소켓이 열린 채 SIGTERM 종료 | 0.12초, 클라이언트는 1012 |
| 열린 소켓 30개일 때 POST 응답 | 201, 0.020초 |
| 브라우저(레포 밖 FE 복사본) | 팀원 웹 답장 뒤 PM 화면에 새로고침 없이 나타남 |
| 비용 | 0원 |

리뷰에서 계정이 다른 팀원 행으로 옮겨져도 소켓이 옛 행으로 남아 남의 대화 신호를 받는 경우가 나왔다. 재확인 때 팀원 행이 바뀌었으면 1013 으로 닫아 다시 붙게 했다.

운영 Caddy 를 거친 연결은 아직 안 했다.

## 다음

- FE 요청 이슈 FE_ISSUE: 소켓 연결, 신호를 받으면 조회 다시 부르기, 닫힘 코드별 재연결, 로컬 Vite 소켓 규칙.
- 배포 뒤 운영 주소로 소켓 연결을 확인한다.
