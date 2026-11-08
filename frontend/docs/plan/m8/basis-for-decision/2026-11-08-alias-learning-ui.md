# 승인 때 별칭 등록 안내와 팀원별 별칭 관리 화면의 모양

- 기록일: 2026-11-08
- 관련: #523(메인 이슈 #459, BE #463·#464). 마일스톤 계획 밖의 이슈 작업이다. 결과는 [#523 결과](../../../issues/523-alias-ui/result.md)에 있다.

## 문제와 제약

- BE 는 담당자를 못 찾은 이름 지목을 승인할 때 그 이름을 고른 담당자의 별칭으로 배운다(`save_alias`). 별칭을 고치는 API 는 없어 잘못 배운 별칭은 지우는 것만이 바로잡는 길이다.
- 사용자 결정(2026-11-08, #523 FE 답)이 모양을 정했다. 생성 승인 카드의 담당자 고르기 바로 아래 체크박스(기본 켜짐), `alias_candidate=true` 이고 팀원을 골랐을 때만 보임, 담당자 고르기에는 팀원 이름만, 설정의 팀원 목록에서 행을 펼쳐 별칭 칩·추가·삭제(PM 만), 출처 꼬리표 넷, 필드 이름 그대로.
- #344 둘째 PR 이 답장 카드와 공용 담당자 고르기 조립을 고치는 중이라 그쪽은 건드리지 않는다. 을/를 함수(`objectParticle`)는 지금 `widgets/dashboard` 에 있고 #344 가 `shared/lib/korean.ts` 로 옮긴다. features 는 widgets 를 가져올 수 없다(계층 검사).

## 실제 검토한 선택지

- 등록 여부를 담는 곳. ① `alias_candidate`·`alias_text` 를 모델에 따로 둔다. ② 「배울 글자 또는 null」 한 필드(`aliasCandidate`)로 합친다.
- 보낼지와 보일지 판정. ① 화면과 승인 계획이 각자 조건을 쓴다. ② 한 함수(`aliasToLearn`)를 둘이 함께 쓴다.
- 체크 값을 싣는 곳. ① `approve` 에 따로 인자를 더한다. ② 생성 승인의 보완 값(`ApprovalEdits` 의 `task_create`)에 `saveAlias` 를 둔다.
- 안내를 둘 화면. ① 승인 상세만. ② 승인 상세와 태스크 목록의 생성 승인 카드 둘 다.
- 별칭 화면 자리. 설정 화면에는 팀원 목록이 없고 목차의 「팀원」이 팀 화면으로 간다(2026-10-30 사용자 답변). ① 설정에 새 절을 만든다. ② 팀 화면의 팀원 줄을 펼친다.
- 일반 팀원. ① 별칭을 숨긴다. ② 읽기만 하게 보인다.
- 을/를 함수. ① 안내 문구를 widgets 에서 만들어 넘긴다. ② #344 와 같은 `shared/lib/korean.ts` 를 같은 내용 그대로 더한다.

## 선택과 이유

- 한 필드 `aliasCandidate` 를 골랐다. 「후보인데 글자가 없음」을 나타낼 수 없다.
- `aliasToLearn` 하나를 골랐다. 담당자가 미정이면 null 이다. 승인 계획은 체크가 켜져 있고 이 값이 있을 때만 `save_alias: true` 를 싣는다. 화면은 같은 값에 담당자 이름을 아는지를 더해 체크박스를 보인다. 보이는 체크와 보내는 본문이 어긋나지 않는다.
- 보완 값의 `task_create` 에 `saveAlias` 를 뒀다. 수정 승인에는 실을 수 없어 타입이 막는다. `approve` 는 그대로다.
- 두 화면 다 넣었다. 목록 카드에서 승인하면 배울 기회를 조용히 잃는다. 두 화면이 같은 `AliasSaveField` 를 쓴다.
- 팀 화면을 골랐다. 설정 목차의 「팀원」이 여는 곳이 팀 화면이고, 줄을 펼치는 모양이 사용자 결정과 맞는다. 팀원 줄 머리에 「별칭 N」 단추를 두고 줄 아래로 펼친다.
- 일반 팀원은 읽기만 한다. 팀 화면은 팀원·일을 모두에게 보이고 PM 조작(팀원 관리·초대)만 숨긴다. 별칭 목록 조회는 서버도 팀원 누구에게나 연다.
- 같은 내용의 `shared/lib/korean.ts`(테스트 포함)를 더했다. #344 의 파일과 바이트가 같아 병합 때 같은 추가로 겹치지 않는다. `widgets/dashboard` 의 원래 함수는 #344 가 지운다.
- MSW 는 BE 처럼 응답마다 후보를 다시 계산한다. 저장값은 추출 때 값이고, 대기 중인 생성 승인이며 공간의 누구도 그 글자를 별칭으로 갖지 않을 때만 후보로 보낸다.

## 장단점과 감수한 제약

- 별칭 목록은 공간 전체를 한 번 받아 팀원별로 나눈다. 팀원별 조회가 없고, 접힌 단추에 개수를 적으려면 미리 받아야 한다.
- 같은 글자를 다시 넣으면 서버가 기존 행을 201 로 돌려준다. 돌려받은 id 가 누를 때 있던 id 면 「이미 있는 별칭이에요.」 로 보인다.
- 다른 팀원이 같은 글자를 가져도 경고하지 않는다. 서버는 허용하고 그 이름은 애매해져 확인 필요로 간다.
- MSW 는 님·조사 후보, 한 글자 규칙, 탈퇴한 팀원을 흉내 내지 않는다. 미매칭 이름 판정도 옛 규칙 그대로다(이슈의 「필수 아님」).

## 영향 범위와 재검토 조건

- 영향 코드: `src/entities/approval/model/{types,mapper,resolution}.ts`, `src/features/approval-resolve/ui/AliasSaveField.tsx`, `model/useTaskCreateOverrides.ts`, `model/useApprovalResolve.ts`, `src/widgets/task-board/ui/ApprovalCard.tsx`, `src/entities/member/api/memberAliases.ts`, `src/features/member-alias/`, `src/widgets/team/ui/{MemberList,TeamOverview}.tsx`, MSW 승인·추출·팀원 handler 와 픽스처.
- #512(카드 합치기)가 배포되면 한 카드에 추출 항목이 여럿 붙는다. BE 가 두 필드의 기준을 다시 알리면 이 판정을 고친다.
- 출처 꼬리표 문구나 펼치는 자리를 PM·디자인이 바꾸면 이 기록을 고친다.

## 근거와 관련 문서

- 이슈 #523 본문과 FE 답 댓글(2026-11-08), BE `schemas/approval.py`·`schemas/meeting.py`·`schemas/member.py`·`api/members.py`·`services/alias_learning.py`
- [계약 §2.2·§2.5 「승인 때 별칭 학습」·§5.8](../../../contracts/frontend-api-contract.md)
