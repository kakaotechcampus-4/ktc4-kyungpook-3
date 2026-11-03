# 리마인드 메시지와 팀원별 대화 BE, PM 말투 초안 모듈

- 날짜: 2026-11-04
- 이슈: #310
- PR: #
- 브랜치: `feature/310-reminder-messages`

## 한 일

BE 에 리마인드 메시지를 저장하고 다루는 테이블 다섯 개를 더했다(마이그레이션 `d5b8c3e7a914`, `c7a2e91b4d36` 다음).

| 테이블 | 담는 것 |
|---|---|
| `message_thread` | 워크스페이스 × 팀원 한 명의 대화 |
| `reminder` | 태스크 하나 × 받는 사람 한 명의 재촉, PM 메모(`note`) |
| `reminder_bundle` | 같은 받는 사람·발송 시각의 보낼 메시지. 문구, 문구 출처(pm·ai·rule), 초안 상태, 승인 |
| `thread_message` | 대화에 들어간 글. 봇이 보낸 DM(결과와 실패 사유)과 팀원 답장(디스코드·웹) |
| `bot_dm_part` | 봇이 실제로 보낸 DM 의 디스코드 메시지 id |

웹 API(`app/api/messages.py`)는 대화 목록과 대화 조회, PM 의 리마인드 만들기·고치기·빼기, 보낼 메시지의 문구·시각 고치기·승인·취소, 팀원의 웹 답장이다. 쓰기는 PM 만, 팀원은 자기 대화만 보고 답장한다. 봇 API(`app/api/bot_messages.py`, 서비스 토큰)는 보낼 메시지 가져가기, 발송 결과 보고, 디스코드 답장 넣기, AI 초안 가져가기와 써 넣기다. 상태 전이는 `app/services/messages.py` 의 함수로 두어 이어서 붙을 스케줄러가 같은 함수를 부른다.

AI 쪽에 `ai/draft/reminder_draft.py` 를 더했다. 보낼 메시지 하나의 정보(받는 사람, 태스크 제목·마감·상태·PM 메모, PM 이 쓰거나 고쳐 승인한 최근 문구)로 Luna 프롬프트를 만들고, 결과에 제목과 날짜가 모두 있는지, 목록 모양이 아닌지, 600자 이하인지, AI·봇이라는 말이 없는지 코드가 다시 거른다. 실제 Luna 로 합성 예시 4개를 보는 스크립트 `ai/draft/eval_reminder_draft.py` 도 더했다.

두 계약 문서에 메시지 절을 적었다. `backend-ai-contract.md` 「리마인드 DM」에 봇·초안 경로 다섯 개, `frontend-api-contract.md` §5.7 에 웹 API 와 상태·문구 출처·DM 결과 표시를 적었다.

## 왜

PM 이 마감 리마인드를 PM 말투로 부담 없이 보내고 팀원 답장을 받아 태스크에 반영하는 기능의 바탕이다. 지금까지 BE 에 메시지 기록이 없었고 FE 메시지 화면은 MSW 에서만 돌았다. 봇 DM 발송, 스케줄러, 답장 판단, 팀원 초대 작업이 이 계약 위에 붙는다. 저장 단위, 승인 단위, DM 실패 표시, 발송 횟수, 답장 워크스페이스 찾기는 [결정 기록 0034](2026-11-04-0034-reminder-and-thread-message.md).

## 결과

| 항목 | 값 |
|---|---|
| `cd backend && .venv/bin/python -m pytest -q` (sqlite) | 857 passed, 375 skipped (시작 전 792 passed, 310 skipped. 늘어난 skip 은 PostgreSQL 판) |
| 같은 명령, `TEST_DATABASE_URL` 에 pgvector/pgvector:pg16 컨테이너 | 1229 passed, 1 skipped (마지막 수정 한 건 전 커밋에서) |
| PostgreSQL 에서 `alembic upgrade head`, `alembic check`, `downgrade c7a2e91b4d36` 후 다시 `upgrade head` | 모두 통과, `check` 는 "No new upgrade operations detected." |
| 실제 서버(uvicorn + PostgreSQL)에서 봇 경로 | 토큰 없으면 401, 가져가기 둘은 빈 목록, 모르는 디스코드 계정 답장은 404 `MEMBER_NOT_FOUND` |
| `cd ai && .venv/bin/python -m pytest -q` | 실패 없음(종료 코드 0). 초안 모듈 테스트 26개는 FakeLLM 으로 돈다 |
| 보낼 메시지 하나의 상태 모델(TLA+, 상태 372개) | 나간 글은 PM 이 승인한 글이다, 승인된 예정 묶음의 문구는 승인한 문구다, PM 이 고친 문구를 AI 가 덮지 않는다, 리마인드가 없는 묶음은 예정이 아니다. 넷 모두 지켜진다 |
| 실제 Luna 출력 | 아직 안 봤다 |
| 유료 호출 | 0원 |

상태 모델을 그리다가 초안을 기다리던 묶음을 승인하면 초안 대기로 남는 것을 찾아, 승인하면 초안 대기를 닫게 고쳤다.

## 다음

- 봇 DM 작업: `ai/capture` 에서 보낼 메시지 가져가기·발송·결과 보고(보낸 DM 의 디스코드 id), DM 답장 넘기기(답장 기능의 대상 id), 2,000자 넘는 글 나눠 보내기, 초안 워커(`draft_reminder` 를 불러 써 넣기)
- 스케줄러 작업: 3일 전 제안, 발송 직전 재확인, 5분 모으기, `expire_reminder` 로 놓친 예약 만료, 봇이 꺼져 있어도 시각에 맞춰 대화 메시지 만들기
- 답장 판단 작업: 답장의 태스크 판정과 `답장 확인 필요`
- 실제 Luna 로 합성 예시를 돌려 초안이 검사를 얼마나 통과하는지 본다. 장부에 Luna 단가가 없다
- FE 요청: 메시지 화면을 실제 API 로, 팀원 답장 화면, `DM 못 보냄` 표시, 봇 DM 을 PM 이 본다는 안내
