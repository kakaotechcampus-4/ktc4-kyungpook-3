# PM 이 팀원을 명단에서 뺄 수 있게 했다

- 날짜: 2026-11-10
- 이슈: #637
- PR: #661
- 브랜치: feature/637-member-delete
- 작성자: 김동우

## 한 일

- `DELETE /members/{member_id}` 를 더했다. PM 만 부르고 본문 없이 204 다. 일반 팀원과 다른 공간의 사용자는 403, 없거나 탈퇴했거나 이미 지운 팀원은 404 `MEMBER_NOT_FOUND`, 마지막 PM 이 자기를 지우면 409 `LAST_PM_REQUIRED` 다
- 팀원 행은 남기고 `is_deleted`·`deleted_at` 만 채운다. 이름·디스코드 계정·로그인 연결은 그대로라 같은 디스코드 계정을 다른 팀원에 다시 이을 수 있다
- 끝나지 않은 태스크의 담당을 `apply_task_updates` 로 비운다. 이력에 지운 PM 이 남고 version 이 오르고 Notion 동기화가 쌓인다. `done` 태스크와 지운 태스크는 그대로다
- 대기 초대를 `canceled` 로 닫고, 예약 재촉 묶음과 리마인드를 PM 취소와 같은 길로 닫는다
- 계정 탈퇴의 DM 정리 중 안 나간 DM 을 `failed` 로, 답 기다리는 시계를 `stopped` 로 바꾸는 부분을 `messages.stop_thread_dms` 로 떼어 탈퇴와 팀원 삭제가 같이 쓴다. 탈퇴 동작은 바꾸지 않았다
- 지운 팀원의 `PATCH /members/{id}` 를 404 로 막는다. 지운 팀원에 디스코드를 다시 이으면 명단에 없는 사람이 다시 일을 받기 때문이다. `GET` 은 이력용으로 200 그대로다
- 프론트 계약 §2.2 와 backend README 권한 표에 팀원 삭제를 적었다. 프론트 코드는 고치지 않았다

## 왜

배포된 서비스에서 잘못 추가한 팀원을 지울 방법이 없었다. 소프트 삭제를 고른 근거는 [결정 기록](2026-11-10-member-delete-decision.md).

## 결과

| 항목 | 값 |
|---|---|
| 새 테스트 `tests/api/test_member_delete.py` | sqlite 12 통과, PostgreSQL 12 건너뜀(TEST_DATABASE_URL 없음) |
| backend pytest 전체 sqlite | 3198 통과, 2275 건너뜀. 건너뛴 것은 모두 PostgreSQL 이 있어야 도는 테스트다 |
| ruff | 통과 |
| 비용 | 0원 |

새 테스트에서 묶음 취소, DM 정리, 소켓 끊기, PM 잠금 호출을 하나씩 빼 보면 각각 해당 테스트가 실패하는 것을 확인했다. PostgreSQL 에서의 동시 삭제는 돌려 보지 않았다.

건너뛴 이유는 `backend/` 에서 아래 명령으로 확인했다. 출력이 비면 PostgreSQL 이 없거나 SQLite 가 잠금을 무시해 건너뛴 것뿐이다.

```
.venv/bin/python -m pytest -q -p no:warnings -rs | grep '^SKIPPED' | grep -vE 'TEST_DATABASE_URL|PostgreSQL|SQLite|row locks'
```

## 다음

- 승인 대기 카드 payload 에 지운 팀원이 담당으로 든 경우는 승인 때 404 로 막힌다. 정리할지는 따로 정한다
- 지운 팀원은 기록용 목록(`include_withdrawn=true`)에도 없어 이력의 이름을 FE 가 찾지 못한다
- 자동 막힘 태스크의 담당자를 지우면 자동 막힘 되돌리기가 409 가 된다. 탈퇴와 같은 동작이며 그대로 둘지 정한다
- FE 화면은 #647 이 붙인다
