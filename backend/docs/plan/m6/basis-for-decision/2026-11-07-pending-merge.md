# 다른 회의의 같은 새 항목을 승인 대기 카드에 합친다

- 기록일: 2026-11-07
- 관련 마일스톤: M6(사용자가 정함). 요청은 이슈 #141(두 번째 PR), FE 문의는 #512, 앞선 기록은 [승인 대기 요청 유사 검색](2026-11-07-pending-approval-search.md)

## 문제와 제약

첫 PR 로 유사 검색이 승인 대기 task_create 카드를 후보로 돌려줄 수 있게 됐지만, AI 가 그 후보를 골라도 BE 에 "이 카드에 더한다"는 동작이 없었다. 그래서 다른 회의에서 같은 일이 나오면 새 카드가 또 생겼다.

제약은 다음과 같다.

- 모델 컬럼과 마이그레이션은 늘리지 않는다. 합친 내용은 카드 payload(JSON) 안에 둔다.
- 검색과 등록 사이에 PM 이 카드를 승인·반려할 수 있다.
- 승인 때 별칭 학습(#464)은 항목 하나의 원문을 저장하는데, 합친 카드는 여러 회의 항목이 한 카드를 가리킨다.
- 승인은 상태를 조건부 UPDATE 로 바꾼 뒤 세션에 남아 있던 옛 payload 로 task 를 만들 수 있었다(기존 문제).

## 실제 검토한 선택지

| 질문 | 선택지 | 결정 |
|---|---|---|
| 대상을 쓸 수 없을 때 | 400 / create 로 처리 | create(auto 아님). 검색 뒤 승인된 경우 같은 정상 경합으로 회의 전체를 막지 않는다. 중복 검사를 거치지 못한 항목이라 auto 는 review 로 내린다 |
| 합칠 대상 | 추출이 만든 카드만 / 팀원이 직접 만든 카드도 | 둘 다(사용자 결정 Q2). 검색 후보와 대상을 같게 한다 |
| 덮어쓰기 | 늘 덮음 / 새 값이 있을 때만 / 항목 종류에 따라 | 마감·상태는 새 값이 있을 때만, 담당자·gate 는 category 가 assignee 일 때만, doc_text 는 " / " 로 이어 붙임. 처리 순서대로 덮는다 |
| 담당 항목 표시 | 늘 기록 / 담당자를 바꿀 때만(assignee_item_id) | 바꿀 때만(사용자 결정 Q1). 없으면 처음 항목(extraction_item_id)이다. 별칭 후보와 저장은 이 항목만 본다 |
| 합친 뒤 승인 | 막음(409) / 최신 값으로 승인 | 최신 값으로 승인. PM 이 고친 칸은 PM 값, 나머지는 합친 값. FE 의 "본 뒤 바뀌었으면 409" 는 #512 답 뒤 다시 본다. 2026-11-08 [승인 카드 payload 버전](2026-11-08-approval-payload-version.md)으로 선택적 409 를 더했다 |
| 동시 처리 | 낙관적 버전 / 행 잠금 | 행 잠금. task(ID 순) 다음 task_create 카드(ID 순)를 FOR UPDATE 로 잠근다. 승인의 조건부 UPDATE 와 같은 행이라 순서가 정해진다 |

## 선택과 이유

합치기 규칙은 순수 함수(`app/services/pending_merge.py`)로 두고, 추출 등록이 대상 카드를 잠근 뒤 적용한다. 합친 항목은 action=merge 로 남고 approval_id 가 그 카드다. 새 일이 아니므로 judge auto 조건을 보지 않고 gate 는 review 나 hold 다.

승인은 조건부 UPDATE 직후 카드를 다시 읽어 최신 payload 로 task 를 만들고, 그 카드에 연결된 모든 추출 항목에 task_id 를 채운다. 별칭 후보와 저장은 카드의 담당 항목만 보고, payload 가 가리키는 항목이 그 카드에 연결돼 있지 않으면 무시한다.

task_update 카드는 잠그지 않는다. 그 승인은 카드 → task 순서로 잠가, task 를 먼저 잠그는 추출 요청과 함께 잠그면 서로 기다릴 수 있다. 합칠 수도 없는 카드라 잠글 이유가 없다.

## 장단점과 감수한 제약

- 마감을 지우는 판단은 merge 로 전달되지 않는다(새 값이 null 이면 그대로).
- category 가 assignee 인데 담당자 표현이 없는(none·group) 항목은 AI 합치기 규칙과 같게 카드 담당자를 비운다. 그 항목의 gate 는 review 라, 찾아 둔 담당자를 지운 경우에만 카드 gate 를 hold 로 올려 PM 이 알아보게 했다. 담당자를 언급한 항목일 때만 덮어쓰는 안은 AI 규칙과 달라져 버렸다(#533 리뷰). 담당자를 못 찾아 hold 인 카드(원문만 있음)에 담당자 표현이 없는 항목이 합쳐지면 원문과 hold 를 그대로 둔다(#533 리뷰).
- 대표 근거와 제목은 처음 회의 것이다. 뒤 회의 근거는 payload merged_items 에만 있고, 추출 항목 행에는 각 회의의 근거가 그대로 남는다.
- PM 이 카드를 보는 사이 값이 바뀔 수 있다. FE 가 바뀐 것을 알릴지는 #512 답에 따른다. 이후 [승인 카드 payload 버전](2026-11-08-approval-payload-version.md)으로 해결했다.
- 별칭도 같다. PM 이 카드를 연 뒤 category 가 assignee 인 항목이 합쳐지면 담당 항목이 바뀌어, save_alias=true 로 승인할 때 PM 이 화면에서 보지 못한 글자가 확인된 별칭으로 저장될 수 있다. 요청에 PM 이 본 글자가 없어 BE 는 이를 가릴 수 없다. task 값과 달리 별칭은 다음 회의부터 담당자를 확정하는 부작용이라, #512 의 "본 뒤 바뀌었으면 409" 와 함께 FE 가 본 alias_text 를 보내는 방안을 정한다. 그 전까지는 잘못 저장된 별칭을 DELETE /members/aliases/{id} 로 지운다(최종 리뷰). 이후 alias_text 대신 [승인 카드 payload 버전](2026-11-08-approval-payload-version.md)으로 함께 막았다(#535).
- target_approval_id 가 36자를 넘으면 요청 전체가 400 이다. AI 는 BE 가 준 ID 만 보내고, evidence_speaker_member_id 도 같은 규칙이라 맞췄다.
- 카드 임베딩은 합쳐도 다시 계산하지 않는다(제목이 바뀌지 않는다).
- PostgreSQL 동시성 테스트 3개는 로컬에서 돌지 않고 CI 에서 처음 돈다.

## 영향 범위와 재검토 조건

- AI 계약: POST /extractions 항목의 action "merge" 와 target_approval_id. merge 도 task_title 필수. 모르는 action 은 지금 400 이라 BE 를 먼저 배포하고, AI 는 그 뒤 include_pending 을 켠다.
- FE: 경로·응답 모양은 그대로다. 대기 카드 payload 에 merged_items·assignee_item_id 가 생길 수 있고, 여러 회의 항목이 같은 approval_id·task_id 를 가진다. alias_candidate 는 담당 항목 행에만 나온다.
- DB: 컬럼·마이그레이션 없음(ExtractionAction 값 "merge" 하나). 새 에러 코드 없음.
- 다시 볼 때:
  - #512 에서 FE 가 "본 뒤 바뀌었으면 409" 를 원할 때.
  - 운영에서 잘못 합쳐진 카드가 보일 때(합치기를 되돌리는 동작이 없다).

## 근거와 관련 문서

- 이슈 #141 설계 확정 댓글(PR 2, 2026-11-07)
- [결과 기록](../result.md)
- [BE↔AI 계약](../../../contracts/backend-ai-contract.md) 추출 등록 절
- `backend/app/services/pending_merge.py`, `backend/app/api/extractions.py`, `backend/app/api/approvals.py`, `backend/app/services/alias_learning.py`
