# 이메일로 팀원을 초대하고 수락하면 계정을 잇는 BE

- 날짜: 2026-11-04
- 이슈: #319
- PR: #321
- 브랜치: `feature/319-member-invite`

## 한 일

BE 에 초대 테이블 `invitation` 을 더했다(마이그레이션 `e8b2f4c6a1d9`, `d5b8c3e7a914` 다음). 초대 하나는 워크스페이스, 대상 팀원(`Member`), 정규화한 이메일(소문자, 앞뒤 공백 없음), 상태, 초대한 PM 계정, 수락한 계정, 만든 시각과 마지막 상태 변경 시각을 담는다. 한 팀원에 대기 중 초대 하나, 한 워크스페이스에서 같은 이메일의 대기 중 초대 하나를 부분 고유 인덱스로 막는다.

웹 API 는 새 파일 `app/api/invitations.py` 에 두었다. 기존 API 에서는 `PATCH /members/{id}` 만 바꿨다. 대기 초대가 있는 팀원을 PM 으로 올리면 409 다.

| 누가 | 경로 | 하는 일 |
|---|---|---|
| PM | `POST /workspaces/{id}/invitations` | 팀원에게 이메일로 초대. 같은 팀원의 대기 중 초대는 취소된다 |
| PM | `GET /workspaces/{id}/invitations` | 초대 목록과 상태, 수락한 계정의 이름·이메일 |
| PM | `POST /invitations/{id}/cancel` | 수락 전 초대 취소 |
| PM | `POST /invitations/{id}/revoke` | 수락한 계정과 팀원의 연결 끊기. 마지막 PM 은 끊지 않는다 |
| 받는 사람 | `GET /invitations/me` | 내 가입 이메일로 온 대기 중 초대 |
| 받는 사람 | `POST /invitations/{id}/accept`·`decline` | 수락하면 `Member.user_id` 가 내 계정이 된다. 거절 |

상태 전이는 한 표(`_TRANSITIONS`)에서 정하고, 상태를 옮기는 쓰기는 모두 "지금 상태가 이것일 때만" 조건을 단 UPDATE 로 한다. 오류 코드 여덟 개를 더했다(`INVITATION_NOT_FOUND`, `INVITATION_NOT_PENDING`, `INVITATION_NOT_ACCEPTED`, `MEMBER_ALREADY_LINKED`, `ALREADY_WORKSPACE_MEMBER`, `EMAIL_ALREADY_INVITED`, `PM_MEMBER_NOT_INVITABLE`, `MEMBER_HAS_PENDING_INVITATION`).

`frontend-api-contract.md` 에 §5.9 팀원 초대 절을 새로 쓰고, 상태별 화면 문구와 오류를 적었다. 팀원으로 시작한 뒤 소속이 0개인 상태에는 새 BE 가 필요 없다는 것도 같이 적었다.

## 왜

PM 이 디스코드 명단으로 만든 팀원은 웹 계정과 이어지지 않아서, 팀원이 가입해도 소속 워크스페이스가 0개였다(#302). 리마인드 대화에서 팀원이 웹으로 답장하려면(#314) 이 연결이 있어야 한다. 이메일 인증이 없는 상태에서 수락을 어떻게 다룰지, 초대 상태와 오타 처리는 [결정 기록 0036](2026-11-04-0036-member-invite-by-email.md)에 적었다.

## 결과

| 항목 | 값 |
|---|---|
| `cd backend && .venv/bin/python -m pytest -q` (sqlite) | 904 passed, 430 skipped (시작 전 867 passed, 393 skipped. 늘어난 37 건은 초대 테스트이고, 같은 수만큼 늘어난 skip 은 그 PostgreSQL 판) |
| 같은 명령, `TEST_DATABASE_URL` 에 pgvector/pgvector:pg16 컨테이너 | 1329 passed, 5 skipped |
| PostgreSQL 에서 `alembic upgrade head`, `downgrade -1`, 다시 `upgrade head`, `alembic check` | 모두 통과, `check` 는 "No new upgrade operations detected" |
| 실제 서버(uvicorn + PostgreSQL)에서 PM 가입, 워크스페이스·팀원 만들기, ` Jimin@Example.com ` 으로 초대, `Jimin@example.com` 으로 가입 | 가입 뒤 `workspace_count` 0, 수락 전 `GET /workspaces/{id}` 403, 내 초대에 1건, 수락 200, 내 워크스페이스 1개, 다시 수락 409 `INVITATION_NOT_PENDING`, 연결 끊기 200, 끊은 뒤 403 |
| 실제 서버에서 대기 중 PM 승격, 수락, 승격, 되돌림, 연결 끊기 | 대기 중 승격 409 `MEMBER_HAS_PENDING_INVITATION`, 내 초대 1건 유지, 수락 200, 수락 뒤 승격 200, 연결 끊기 200, 끊은 뒤 403 |
| 초대 만들기와 PM 승격, 수락과 PM 승격 동시 요청(PostgreSQL, 두 스레드, 각 30번) | PM 역할에 대기 초대가 남은 경우 0, 500 없음. 같은 스크립트에서 팀원 행 잠금을 빼면 초대 만들기 쪽 30번 중 29번 그 상태가 생겼다 |
| 동시 요청(PostgreSQL, 두 스레드, 다섯 장면 각 15번) | 교착과 처리 안 된 예외 없음. 한 팀원에 연결 하나, 대기 중 초대 하나, 로그인할 수 있는 PM 하나 이상이 늘 지켜졌다. 같은 초대 동시 수락은 한 계정만 이어졌고(나머지는 409), 같은 이메일 동시 초대는 15번 모두 하나만 201 이고 나머지는 `EMAIL_ALREADY_INVITED` 다. 스크립트는 레포에 넣지 않았다 |
| 유료 호출 | 0원 |

리뷰에서 찾아 재현 테스트를 먼저 쓰고 고친 것은 아래와 같다.

| 무엇이 깨졌나 | 고친 것 |
|---|---|
| 역할이 PM 인 팀원을 초대하거나 대기 중에 PM 으로 올리면, 수락한 계정이 PM 이 되어 원래 PM 을 내리고 연결 끊기를 막을 수 있다 | 초대 만들기와 `PATCH /members/{id}` 에서 거절하고, 둘이 같은 팀원 행을 잠근다 |
| 끊긴 계정이 경합으로 남은 같은 이메일의 대기 초대를 수락해 다른 팀원 자리로 돌아온다 | 연결을 끊을 때 같은 이메일의 대기 초대를 함께 취소 |
| 이미 팀원인 이메일 확인만 SQL `lower` 로 비교해 비 ASCII 이메일에서 초대·수락과 결과가 달랐다 | 같은 `normalize_email` 로 비교 |
| 같은 이메일 동시 초대에서 진 요청이 드물게 500 | 409 `EMAIL_ALREADY_INVITED` 로 돌림 |

사전 확인 두 개 사이에 다른 초대가 수락되면 수락할 수 없는 대기 초대가 드물게 남는다. 고치지 않고 계약 §5.9 에 적었다. 수락은 409 이고 PM 이 취소하면 된다.

## 다음

- 화면 연결은 #320
- 가입 이메일 인증은 결정 기록 0036 의 다시 볼 조건에 남겼다
