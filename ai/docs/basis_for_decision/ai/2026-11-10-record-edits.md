# 팀원이 전사 제목·발화와 AI 의 주제·결정을 고치고, 다시 요약해도 고친 것이 남는다

- 날짜: 2026-11-10
- 이슈: #605
- PR: (올린 뒤 채움)
- 브랜치: feature/605-record-edits
- 작성자: dw021213

## 한 일

- 고치기 경로 여섯 개를 더했다. `PATCH /meetings/{meeting_id}/title`, `PATCH /meetings/{meeting_id}/transcript/{seq}`, `PATCH /workspaces/{workspace_id}/topics/{topic_id}`, `POST .../topics/{topic_id}/merge`, `DELETE .../topics/{topic_id}/tasks/{task_id}`, `PATCH /workspaces/{workspace_id}/decisions/{decision_id}` 이다. 워크스페이스 멤버면 PM 이 아니어도 부른다
- 제목은 그 자리에서 고치고 처음 제목(`title_original`)과 고친 시각을 둔다. 발화는 원문을 두고 고친 문장을 `text_edit` 에 둔다. 회의록 전사와 요약 재료(`Source.shown_text`)는 고친 문장을 쓰고 승인 카드의 근거 인용은 원문을 쓴다
- 결정은 `state`(`valid`, `invalid`, `removed`)로 지우거나 유효하지 않다고 표시한다. 다음 회의의 요약 재료에는 `valid` 결정만 들어간다. 결정을 하나라도 고친 회의는 다시 요약해도 결정을 모두 그대로 둔다
- 주제 이름을 바꾸면 옛 이름을 `topic_alias` 에, 주제에서 뗀 태스크를 `topic_task_detach` 에 남겨 재요약이 되살리지 않는다. 고친 주제는 재요약이 고아로 지우지 않는다
- `summary.documents()` 가 결정 문장·상태와 주제 이름을 행에서 읽어 요약 JSON 과 합친다. 회의록, summary.md, 합본이 고친 값을 보인다
- 고친 제목, 발화, 주제, 결정은 #645 의 프롬프트 처리(`_unfence`, 꺾쇠를 전각으로)를 그대로 거친다
- 마이그레이션 `6631d28f2e1b`(부모 `b20d029aec7b`)가 고친 값 칸과 두 테이블을 더하고, 옛 요약의 최신본에 결정·주제 ID 를 채워 `schema_version` 을 2 로 올린다
- 회의 삭제(#576)와 혼자 쓰던 워크스페이스의 탈퇴(#575)가 고친 제목·발화와 그 회의의 결정을 함께 지운다
- 프론트 계약 §4.4.3, 백엔드 AI 계약, 결정 기록 0065 를 썼다

## 왜

요약이 잘못 뽑은 주제·결정과 잘못 전사된 제목·발화를 팀원이 고칠 길이 없었다. 재요약은 그 회의의 결정과 주제 연결을 지우고 AI 출력으로 다시 쓰므로 행만 고쳐서는 다음 재처리에서 덮인다. 요약을 승인된 사실로만 쓰게 한 #645 위에서 사람이 고친 기록도 정본으로 남긴다. 설계 근거는 [0065](2026-11-10-0065-human-record-edits-survive-resummary.md).

## 결과

테스트

| 명령 | 결과 |
|---|---|
| `cd ai && .venv/bin/python -m pytest` | 3003 passed |
| `cd backend && env -u TEST_DATABASE_URL .venv/bin/python -m pytest -q -p no:cacheprovider` (SQLite) | 3281 passed, 2356 skipped |
| 같은 명령, `TEST_DATABASE_URL` 로컬 PostgreSQL 16 | 5566 passed, 71 skipped |

마이그레이션은 빈 PostgreSQL 16 DB 에 `DATABASE_URL` 을 두고 `cd backend && .venv/bin/alembic upgrade head`, `alembic downgrade -1`, `alembic upgrade head`, `alembic check` 순서로 돌렸다. 헤드는 `6631d28f2e1b` 하나이고 내리면 `b20d029aec7b` 로 돌아가며 `alembic check` 는 `No new upgrade operations detected.` 였다. `tests/test_migration_record_edits.py` 는 SQLite 만 두면 2 passed, 2 skipped 이고 `TEST_DATABASE_URL` 을 주면 두 DB 에서 4 passed 였다.

실제 회의의 기록을 고쳐 다시 요약해 보지 않았다. 화면이 없어 API 테스트로만 확인했다. 유료 호출은 없다.

## 다음

- 회의록의 제목·발화 고치기와 주제·결정 고치기 화면은 #551 에 요청했다
- 이 PR 은 #645 위에 있다. #645 가 머지되면 develop 을 받아 대상 브랜치를 develop 으로 바꾼다
- 결정을 고친 회의를 실제로 다시 요약해, 손대지 않은 결정이 낡아 불편한지 본다
- 주제·결정 고치기와 요약 저장의 잠금 순서는 따져서 정했고 동시 실행으로 재 보지는 않았다
