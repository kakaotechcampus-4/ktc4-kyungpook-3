# 디스코드 연결 옮기기, 지난 발화 화자 다시 붙이기, 같은 이름 거절을 BE 에 더했다

- 날짜: 2026-11-10
- 이슈: #652
- 브랜치: feature/652-discord-link-move
- 작성자: 김동우

## 한 일

- `PATCH /members/{id}` 에 `move_discord_link` 를 더했다. true 면 그 계정을 가진 다른 활성 팀원의 연결을 풀고 이 팀원에 한 트랜잭션으로 잇는다. 두 팀원 행을 `member_id` 순서로 잠그고, 앞 팀원 풀기를 먼저 flush 한다. 앞 팀원의 닉네임 별칭은 지운다. 플래그가 없으면 전처럼 409 `DISCORD_USER_ALREADY_MAPPED` 다
- 팀원에 계정을 이으면(`POST`, `PATCH` 의 새 계정, 옮기기) 같은 트랜잭션에서 이 워크스페이스 회의의 그 계정 발화를 이 팀원에 붙인다. UPDATE 한 문장이다. 연결만 풀면 발화는 그대로다
- 같은 워크스페이스 활성 팀원과 이름이 같으면 팀원 추가와 이름 고치기를 409 `MEMBER_NAME_DUPLICATED` 로 막는다. 앞뒤 공백만 지우고 견준다. 이름이 바뀌지 않는 PATCH 는 보지 않아 이미 있는 중복도 고칠 수 있다
- 프론트 계약 §2.2 와 backend README 의 팀원 API 부분을 고쳤다. 프론트 코드는 고치지 않았다

## 왜

계정을 옮기려면 PATCH 를 두 번 불러야 했고, 옮겨도 지난 회의록은 앞 팀원 이름으로 남았다. 같은 이름은 FE 만 막았다. 선택의 근거는 [결정 기록](2026-11-10-discord-link-move-decision.md).

## 결과

| 항목 | 값 |
|---|---|
| 새 테스트 | `tests/api/test_member_discord_link_move.py` sqlite 32개(옮겨 받는 팀원의 id 가 앞인 경우와 뒤인 경우 두 벌), `tests/api/test_member_name_duplicate.py` 11개 통과. PostgreSQL 변형 32개는 TEST_DATABASE_URL 이 없어 건너뜀 |
| flush 순서 확인 | 앞 팀원 풀기 뒤의 flush 를 빼면 옮겨 받는 팀원의 id 가 앞인 경우 5개가 실패하는 것을 확인했다 |
| backend pytest sqlite | 3229 통과, 2295 건너뜀(작업 전 3186 통과, 2263 건너뜀) |
| backend pytest PostgreSQL | 돌리지 않음 |
| ruff | 통과 |
| 비용 | 0원 |

## 다음

- 이름 비교에서 대소문자를 무시할지 확인한다. 정한 문구와 FE `memberNameKey` 가 다르다(결정 기록의 결정 3)
- FE #647 이 `move_discord_link` 와 `MEMBER_NAME_DUPLICATED` 를 쓴다
- 승인 카드 payload 의 `evidence_speaker_member_id` 와 이미 저장된 요약 문서의 이름은 옮긴 팀원을 따르지 않는다
- 같은 이름을 동시에 보내면 워크스페이스 행 잠금(`lifecycle.workspace`)으로 차례로 처리돼 두 번째가 409 다(리뷰에서 Postgres 두 세션으로 확인). DB 제약은 없어 이 잠금을 거치지 않는 쓰기 경로가 생기면 막지 못한다
