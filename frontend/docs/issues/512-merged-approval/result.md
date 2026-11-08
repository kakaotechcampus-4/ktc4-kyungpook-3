# 합쳐진 승인 카드의 근거 표시와 본 뒤 바뀐 카드의 재확인 결과 (#512)

- 기록일: 2026-11-08
- 대상: [#512](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/512)(BE #533 합치기, #547 `payload_version`·409 `APPROVAL_CHANGED`, #535 닫힘)
- 기준: develop `fad77196` 에서 시작했다. PR 은 아직 만들지 않았다.
- 상태: **반영했다.** 단위·RTL 과 MSW 개발 서버(Chromium) 브라우저로 확인했다. 실서버는 확인하지 않았다. 실제 합치기는 BE 답대로 AI 가 켠 뒤부터 일어난다.

## 작업 근거와 요약

마일스톤 계획에 없는 작업이다. 근거는 이슈 #512 의 BE 답(2026-11-08)과 사용자가 확정한 FE 안 2~4(2026-11-08, 이슈 마지막 댓글)다.

BE 가 대기 중인 생성 카드에 다른 회의의 같은 일을 합친다. PM 이 카드를 연 뒤에 합쳐지면 화면에서 본 값과 만들어질 태스크가 달라진다. 열린 상세 폼은 같은 승인의 새 응답을 폼에 다시 적용하지 않아, 다시 받아도 고치지 않은 칸이 낡은 값으로 남았다. 이번 작업은 PM 이 본 카드의 지문을 실어 서버가 바뀐 카드를 막게 하고, 막히면 바뀐 칸을 보여 PM 의 수정은 둔 채 다시 처리하게 한다. 합쳐진 카드는 어느 회의의 어떤 말이 합쳐졌는지 보이게 한다.

## 실제 구현 및 관련 코드

- 지문(확인할 것 1)
  - [승인 DTO](../../../src/shared/types/api/approval.ts): 응답 `payload_version?`, 요청 `payload_version?`, 409 details.
  - [승인 mapper](../../../src/entities/approval/model/mapper.ts): 생성 승인의 `payloadVersion`. 실패 종류 `changed` 를 `conflict`(APPROVAL_CONFLICT)와 따로 읽는다.
  - [resolution.ts](../../../src/entities/approval/model/resolution.ts): 승인·반려 계획이 처리할 카드의 지문을 싣는다. 값이 없거나 변경 승인이면 보내지 않는다.
  - [useTaskCreateOverrides](../../../src/features/approval-resolve/model/useTaskCreateOverrides.ts): 폼이 맞춰진 카드(`seen`)를 둔다. 같은 승인의 지문이 다른 응답을 받으면 고치지 않은 칸만 새 값으로 바꾸고 PM 이 고친 칸은 둔다. 처음 본 카드와의 차이(`change`)를 준다.
  - [useApprovalResolve](../../../src/features/approval-resolve/model/useApprovalResolve.ts): 409 `APPROVAL_CHANGED` 면 승인 목록·상세를 다시 받는다. 문구는 [errorMessages](../../../src/shared/api/errorMessages.ts) 「보신 뒤에 확인 요청 내용이 바뀌었어요. 새 내용을 확인하고 다시 처리해 주세요.」
  - [ApprovalReview](../../../src/widgets/approval-review/ui/ApprovalReview.tsx): 상세는 `seen` 으로 처리한다. 바뀌었으면 「바뀐 내용」 안내(보던 값·새 제안·승인할 값, 새로 합쳐진 항목 수)와 「새 내용을 확인했어요, 승인」 버튼이다.
  - 목록 카드([ApprovalCard](../../../src/widgets/task-board/ui/ApprovalCard.tsx))는 그 카드를 그린 목록 응답의 지문을 싣고, 409 면 문구를 보이고 새 목록으로 다시 그린다.
  - `alias_text` 는 보내지 않는다(#535).
- 합쳐진 근거(확인할 것 2): 생성 승인 모델에 `mergedItems`·`assigneeItemId`([merged.ts](../../../src/entities/approval/model/merged.ts) 의 `mergedCount`·`approvalChange`). 상세는 「대표 근거 · 카드를 만든 회의」와 「합쳐진 근거 N건 보기」(회의·발화 시각·화자·인용·`doc_text`·합친 시각·원문 듣기)를 나누고, 담당자를 정한 근거에 「담당자 근거」를 붙인다. 처리 버튼 위에 「반려하면 합쳐진 항목 N개가 모두 반려돼요.」 목록 카드는 「회의 M곳 · 항목 N개 합침」.
- 자리(3): 목록은 `created_at` 으로 정렬하고 합쳐도 `created_at` 이 그대로라 자리가 유지된다. 코드는 바꾸지 않았고 RTL 로 확인했다.
- 회의록(4): 회의록 항목은 추출 항목 값을 쓰고 `approval_id` 로 상세에 잇는다. 코드는 바꾸지 않았고 RTL 로 확인했다.
- MSW
  - [approvalMerge](../../../src/shared/mock/approvalMerge.ts): 응답마다 payload 지문(16자 hex), BE 합치기 규칙을 줄인 `mergeIntoApproval`, 처리 요청 직전에 합치는 `mergePendingItems`.
  - [승인 handler](../../../src/shared/mock/handlers/approval.ts): `payload_version` 400·409, 승인하면 카드에 이어진 항목 모두의 `task_id`(BE 와 같다). [별칭 후보](../../../src/shared/mock/aliasLearning.ts)는 `assignee_item_id` 항목에서 구한다.
  - 시나리오 `approval-merged`(ap_03 에 mt_07 의 it_21 이 합쳐져 담당자 이재환·마감 9/26), `approval-merged-after-view`(같은 합치기가 첫 처리 요청 직전에 일어나 409). 모의 DB 판은 올리지 않았다(추출 항목의 `merge_into` 로 표시, 응답에는 없음).
- 계약: [계약](../../contracts/frontend-api-contract.md) §1 오류 코드, §2.4, §2.5 「승인 때 별칭 학습」 합의 상태, §2.5 「합쳐진 카드와 본 뒤 바뀐 카드」.
- 결정 기록: [본 뒤 바뀐 카드의 재확인](../../plan/m8/basis-for-decision/2026-11-08-merged-approval-recheck.md).
- E2E: `tasks-approval.e2e.ts` 의 ap_03 승인 본문 기대값에 지문을 더했다(실행은 CI).

## 완료조건 확인

| 브리프·사용자 결정 | 상태 | 근거 |
|---|---|---|
| 승인·반려 요청에 본 시점 `payload_version` | 충족 | RTL(상세 승인·반려, 목록 승인), resolution 단위 |
| 409 뒤 바뀐 칸 표시·PM 수정 보존·다시 승인 | 충족 | RTL·브라우저 |
| 409 없이 새 카드를 받아도 같은 재확인 | 충족 | RTL |
| `APPROVAL_CONFLICT` 와 구분 | 충족 | mapper 단위, RTL(변경 충돌 안내 없음) |
| 목록 카드의 합쳐진 수, 자리 유지 | 충족 | RTL·브라우저 |
| 상세의 merged_items 펼치기·담당자 근거·전체 반려 안내 | 충족 | RTL·브라우저 |
| 회의록 항목 값 유지 | 충족 | RTL·브라우저 |
| MSW 픽스처·지문·409·시나리오 | 충족 | 위 테스트 |
| 계약 §2.4·§2.5, 결정 기록 | 충족 | 위 문서 |

## 검증

검증 결과는 아래에 채운다.
