# 승인 때 별칭 학습: 저장 대상과 판단 위치

- 기록일: 2026-11-06
- 관련 마일스톤: M3 (회의·전사·AI 결과 수신)
- 관련 이슈: #459 (PR ②. 님·조사 후보 검색과 팀원 이름·디스코드 닉네임 별칭은 PR ①)

## 문제와 제약

- `member_alias` 는 PM 이 수동 API 로 넣을 때만 채워지고 등록 화면도 없어 사실상 비어 있다. 그래서 이름으로 지목된 담당자가 대부분 PM 보류(`hold`)로 간다.
- PM 은 보류된 항목을 승인하면서 담당자를 직접 고른다. 이때 회의에서 부른 말과 실제 담당자의 짝이 생기지만 버려지고 있었다.
- AI 는 `assignee_type` 을 보내지만 BE 는 판단에만 쓰고 저장하지 않았다. 승인 시점에는 이 항목이 이름으로 부른 것인지 알 수 없었다.
- 잘못 배운 별칭은 다음 회의의 매칭을 망가뜨린다. `resolve_assignee` 는 같은 글자를 두 명이 가지면 애매함(ambiguous)으로 판정한다.

## 실제 검토한 선택지

1. **후보 여부를 응답 때 계산(채택)**: DB 에는 `extraction_item.assignee_type` 만 저장한다. `alias_candidate`·`alias_text` 는 응답을 만들 때 추출 항목과 승인 상태로 계산하고, 승인할 때 같은 함수로 다시 판정한다.
2. **승인 요청 payload 에 후보 여부 저장**: 쿼리는 늘지 않는다. 하지만 `POST /approvals` 로 누구나 payload 에 값을 넣을 수 있어 승인 때 결국 다시 판정해야 하고, 판단 기준이 두 곳이 된다. 승인 뒤에도 값이 남는다.
3. **이미 그 글자를 가진 팀원 목록(`alias_owner_member_ids`)도 응답에 싣기**: FE 가 미리 숨길 수 있지만 필드와 조회가 늘어난다. 아래 4번 규칙으로 필요가 없어졌다.
4. 같은 글자를 다른 팀원이 이미 가진 경우:
   - (가) 그대로 저장
   - (나) 후보에서 빼고 저장하지 않음(채택). 최종 리뷰에서 (가)가 원래 팀원의 매칭을 애매함으로 바꾼다는 지적이 나왔다.

## 선택과 이유

- **선택지 1**: 판단 기준이 `app/services/alias_learning.py` 한 곳에 모인다. auto 되돌리기로 생긴 승인과 이미 쌓인 pending 승인에도 같은 규칙이 적용된다.
- **학습 대상**: 추출 때 담당자가 비어 있었던(못 찾음·애매함) 새 항목 중 `assignee_type` 이 `thirdname`·`thirdrole` 인 것만 학습한다.
  - 찾은 담당자를 PM 이 바꾼 경우와 1·2인칭·대명사·그룹은 부른 말과 담당자의 짝이 아니라서 뺐다.
  - `assignee_type` 이 NULL 인 옛 항목도 판단 근거가 없어 뺐다.
- **이미 누군가 가진 글자**: 같은 워크스페이스에서 그 글자를 가진 별칭이 하나라도 있으면(탈퇴 팀원 포함) 묻지 않고 저장하지 않는다.
  - 이 기능은 비어 있는 별칭을 채우려는 것이고, 잘 찾히던 사람을 애매하게 만들면 안 된다.
  - 탈퇴 팀원을 세는 것은 `resolve_assignee` 가 같은 기준으로 세기 때문이다.
- **저장 값**: `source=learned`, `verified=true`, `confidence=0.9` 다. PM 이 승인으로 확인한 짝이라 확인된 별칭으로 둔다. 0.9 는 auto 기준 0.8 이상이다.
- **역할(`thirdrole`)**: 맡은 사람이 바뀔 수 있다. 그래서 학습한 별칭으로 확신도가 높아져도 새 항목을 `auto` 로 보내지 않는다. legacy 경로는 확신도만 보기 때문에 BE 에서 막았다.
- **모르는 `assignee_type` 이나 16자를 넘는 값**: NULL 로 저장하고 경고 로그를 남긴다. 저장 전에는 어떤 값이 와도 등록이 성공했으므로, 칸을 추가했다고 등록이 실패하게 만들지 않았다.
- **`thirdname` 학습을 둔 이유**: PR ① 이 머지되면 팀원 이름·닉네임과 님·조사는 추출 때 찾힌다. 그래도 STT 오인식("화은"), 애칭, 영어 이름처럼 이름 규칙으로 못 잡는 표현을 배우는 역할이 남는다.

## 장단점과 감수한 제약

- 승인 목록·단건 조회와 추출 조회마다 조회가 최대 2번 늘어난다(후보 항목을 찾는 `IN` 조회, 그 글자를 이미 가진 별칭을 찾는 `IN` 조회). `extraction_item.approval_id` 에는 인덱스가 없다. 지금 규모에서는 문제가 없다고 보고 마이그레이션 범위를 넓히지 않았다.
- 두 사람이 정말 같은 별칭을 써야 하는 경우는 학습되지 않는다. PM 이 수동으로 등록해야 한다.
- 역할을 맡은 사람이 바뀌면 이전 사람의 별칭이 남는다. PM 이 지우고 다시 등록해야 한다(수정 API 없음).
- 다른 팀원 둘에게 같은 글자를 동시에 승인하면 둘 다 저장될 수 있다. 유니크 제약은 같은 팀원 기준이기 때문이다. 드문 경합이라 막지 않았다.
- 다듬기 규칙이 이름 끝 글자를 조사로 뗄 수 있다("민이" → "민"). 이상하게 저장되면 PM 이 고친다고 사용자와 정했다.

## 영향 범위와 재검토 조건

- 계약: `PATCH /approvals/{id}` 요청에 `save_alias` 를 추가했다. 승인 응답과 추출 조회 항목에 `alias_candidate`·`alias_text` 를 추가했다. 모두 기본값이 있어 하위 호환이다. AI 요청 모양은 바뀌지 않는다.
- DB: `extraction_item.assignee_type VARCHAR(16) NULL`.
- 다시 볼 때:
  - AI 가 역할 원문을 보내기 시작할 때. `thirdrole` 학습이 실제로 동작한다.
  - PR ① 이 머지된 뒤 학습한 별칭이 다음 회의에서 찾히는지 확인할 때.
  - 승인 목록이 느려질 때. `approval_id` 인덱스를 추가한다.
  - 미확인 별칭 목록(`GET /members/unresolved-aliases`)이 학습 뒤에도 원문 단위로 남는 문제를 다룰 때.

## 근거와 관련 문서

- 이슈 #459 본문 "정한 규칙"과 설계 확정 댓글
- 코드: `backend/app/services/alias_learning.py`, `backend/app/api/approvals.py`(`_apply_approval`), `backend/app/api/extractions.py`(`create_extraction`, `get_extraction`), `backend/app/services/matching.py`(`resolve_assignee`)
- 테스트: `backend/tests/services/test_alias_learning.py`, `backend/tests/api/test_alias_learning_approval.py`
- [Backend README 승인 때 별칭 학습](../../../../README.md#승인-때-별칭-학습), [AI 계약](../../../contracts/backend-ai-contract.md)
