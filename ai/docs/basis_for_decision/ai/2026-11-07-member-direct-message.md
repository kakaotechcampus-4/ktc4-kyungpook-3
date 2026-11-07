# 리마인드 없이 PM 과 팀원이 메시지를 주고받는 BE

- 날짜: 2026-11-07
- 이슈: #470
- PR: (PR 번호)
- 브랜치: feature/470-member-direct-message
- 작성자: 김동우

## 한 일

- `POST /messages/threads`: PM 은 팀원을 골라, 팀원은 자기 대화를 연다. 몇 번 불러도 같은 대화다.
- `POST /messages/threads/{id}/replies`: PM 이 남의 대화에 쓰면 201 로 저장하고 바로 발송 대기로 보낸다.
- `sender: "pm"`, `author_member_id`, `author_name` 을 응답에 더했다. 마이그레이션 `5ae76a6102a8`.
- 알림 종류 `message_received` 를 더했다.
- 계약 `frontend-api-contract.md` §5.7, `backend-ai-contract.md` 리마인드 DM 절을 고쳤다.

## 왜

메시지 화면은 재촉이나 제안이 있어야 대화가 생겼다. PM 은 팀원 대화에 답장할 수 없었고(403), 팀원은 웹에서 먼저 쓸 곳이 없었다. 근거는 [결정 0049](2026-11-07-0049-pm-member-direct-message.md).

## 결과

| 확인 | 명령 | 결과 |
|---|---|---|
| backend, sqlite 와 Postgres | `TEST_DATABASE_URL=... python -m pytest -q` | 3675 passed, 44 skipped |
| 마이그레이션 왕복 | `alembic upgrade head`, `downgrade -1`, `upgrade head`, `alembic check` | 통과, pm 글은 bot 으로 돌아간다 |
| lint | `uvx ruff@0.14.0 check .` | 통과 |

로컬 실행 서버와 Postgres 에서 PM 입력칸만 임시로 켠 복사본 화면으로 확인했다. PM 글이 한 통 저장되고, Enter 를 다섯 번 눌러도 요청은 한 번이었다. 팀원 쪽도 같았다. 봇 API 를 직접 불러 한 번만 가져가지는 것, 미연결 팀원의 `DM 못 보냄`, 팀원이 남의 대화를 열거나 쓰면 403 인 것, 대화가 없는 팀원이 먼저 쓴 글이 PM 목록에 뜨는 것을 봤다.

실제 디스코드 발송은 아직 안 했다. 화면 확인은 DM 을 안내로 바꾸기 전 코드에서 했고, 안내 문구는 테스트로만 확인했다. 비용은 0원이다.

## 다음

- FE 요청 이슈로 입력칸과 팀원 고르기를 연결한다.
- 새 글 신호를 웹소켓으로 보내는 후속 작업.
- #515 와 머지 순서를 맞춘다. 안내 뒷부분은 #515 의 답장 안내로 바뀐다.
