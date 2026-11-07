# 승인 대기 새 항목 요청을 유사 검색 후보에 따로 더한다

- 기록일: 2026-11-07
- 관련 마일스톤: M6(사용자가 정함). 요청은 이슈 #141, FE 문의는 #512

## 문제와 제약

새 항목은 PM 이 승인해야 task 가 되는데, 유사 검색은 task 테이블만 봤다. 승인 대기 중에 다른 회의에서 같은 일이 나오면 또 새 카드가 생겼다(#141).

제약은 다음과 같다.

- 지금 AI 는 task_id 가 없는 후보를 고르면 그 판단을 버린다. BE 가 대기 후보를 먼저 내보내면 중복 대신 항목이 빠진다.
- 승인 대기 요청에는 임베딩이 없고, 제목은 payload JSON 안에 있다.
- 합치기(action=merge)는 #464 별칭 학습과 같은 곳을 고쳐, 이번 변경과 따로 낸다.

## 실제 검토한 선택지

| 질문 | 선택지 | 결정 |
|---|---|---|
| 켜는 방식 | 늘 섞기 / 요청 플래그(include_pending, 기본 false) | 플래그. BE 를 먼저 배포해도 AI 가 후보를 버리지 않는다(#141 합의) |
| 후보 수 | task 와 합쳐 k개 / task k개와 따로 최대 2개 | 따로 최대 2개. 합치면 대기 후보가 기존 task 후보를 밀어내 수정·완료 판단을 놓친다(AI 제안, BE 동의) |
| 후보 쿼리 | UNION 한 번 / 두 쿼리를 따로 돌려 합침 | 따로. 기존 task 검색 함수와 테스트를 그대로 두고 task 자리를 지킨다 |
| 임베딩 저장 | approval_request 컬럼 / 별도 테이블 | 컬럼 2개(embedding, embedding_rejected_title). task 와 같은 워커·패턴을 쓴다 |
| 임베딩 없는 대기 요청 | 무시 / auto 를 막음 | 막음(unsearched_pending_exists). 검색이 못 본 요청이 있으면 similar_count 0 을 믿을 수 없다 |
| PR 나누기 | 한 PR / 검색·임베딩 먼저, 합치기는 #464 뒤 | 둘로 나눔(사용자 결정). 합치기는 별칭 학습과 맞춰야 한다 |

## 선택과 이유

워커는 task 다음에 pending task_create 요청을 approval_id 순으로 채운다. 제목은 payload 의 task_title, 없으면 title 을 쓴다. 제목이 없거나 형식이 틀린 요청은 API 를 부르지 않고 embedding_rejected_title 에 빈 문자열을 적어, 뒤 요청이 굶지 않게 한다.

auto 판단에서는 임베딩이 없는 대기 요청이 있으면 막는다. 다만 같은 추출 요청 안에서 앞 항목이 만든 대기 요청은 보지 않는다. 막으면 회의마다 auto 비율이 크게 떨어지고, 같은 회의 중복은 AI 가 #140 으로 따로 막는다.

## 장단점과 감수한 제약

- 대기 요청이 만들어진 뒤 워커가 임베딩을 채울 때까지(기본 5초 주기) 다른 회의의 judge 새 항목은 auto 대신 review 로 간다. 배포 직후 기존 대기 요청을 채우는 동안도 같다.
- 임베딩 키가 없는 환경에서는 워커가 돌지 않아 대기 요청이 있는 동안 auto 가 계속 막힌다. 그 환경에서는 task 임베딩도 없어 이미 막혀 있다.
- 공백뿐인 task_title 은 검색용 제목에서 건너뛰고 title 을 쓴다. 승인은 이런 요청을 제목 검증으로 거절하므로 task 가 되지 않는다.
- 임베딩 API 가 제목을 거절해 워커가 건너뛴 대기 요청(embedding_rejected_title 에 제목이 있음)도 검색에서 빠져 있으므로 센다. 승인 요청에는 만료가 없어서 PM 이 처리할 때까지 그 워크스페이스의 judge 새 항목은 auto 로 가지 못한다. 제목을 거절당한 task 가 unsearched_task_exists 로 계속 막는 것과 같은 성격이고 거절은 드물어 그대로 둔다. 원인은 로그로 찾는다. 워커의 경고 "approval 임베딩 입력이 거절되어 건너뜁니다 approval_id=..." 가 어떤 요청인지 알려 주고, 추출의 게이트 사유 로그에 unsearched_pending_exists 가 찍힌다.
- 한 추출 요청에 legacy 항목이 먼저 대기 요청을 만들고 judge 항목이 뒤에 오면, 그 judge 항목은 auto 를 막힌다. 막는 쪽이라 그대로 둔다.
- 벡터 인덱스는 만들지 않았다. 워크스페이스·상태 인덱스로 좁혀지고, 운영 대기 요청 수는 아직 모른다.

## 영향 범위와 재검토 조건

- AI 계약: 유사 검색 요청 include_pending, 후보 approval_id, 대기 후보는 task_id·status·notion_page_id null. 새 게이트 사유 unsearched_pending_exists. 새 에러 코드 없음.
- DB: approval_request 컬럼 2개, 마이그레이션 1건, 백필은 워커가 한다.
- 다시 볼 때:
  - 운영에서 대기 후보 2개가 부족하거나 많다고 보일 때(AI 와 조정).
  - 워크스페이스별 대기 요청이 많아져 검색이 느려질 때(벡터 인덱스).

## 근거와 관련 문서

- 이슈 #141 본문, BE 제안(2026-11-04), AI 답(2026-11-06), BE 확인과 설계 확정 댓글(2026-11-07)
- [결과 기록](../result.md)
- [BE↔AI 계약](../../../contracts/backend-ai-contract.md) 유사 검색 절과 auto 조건
- `backend/app/services/embedding.py`, `backend/app/api/similar_tasks.py`, `backend/app/services/matching.py`
