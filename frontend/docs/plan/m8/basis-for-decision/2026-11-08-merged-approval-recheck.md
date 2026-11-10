# 합쳐진 승인 카드를 본 뒤 바뀌면 폼을 새 카드에 맞추고 PM 이 고친 칸은 둔다

- 기록일: 2026-11-08
- 관련 마일스톤: M8 밖의 이슈 작업 [#512](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/512)(BE #533·#547, #535). 결과는 [이슈 결과](../../m6/work-items/512-merged-approval/result.md)에 있다.

## 문제와 제약

- BE #533 이 대기 중인 생성 카드에 다른 회의의 항목을 합친다. PM 이 카드를 연 뒤에 합쳐지면 화면의 값과 서버가 만들 태스크가 달라진다.
- 열린 상세 폼은 `useTaskCreateOverrides` 가 처음 받은 카드로 초기값을 만들고, 같은 승인의 새 응답을 폼에 다시 적용하지 않았다. 서버에는 PM 이 고친 칸만 보내므로, 다시 받아도 고치지 않은 칸이 낡은 값으로 남았다(#512 FE 답 1번).
- BE #547 은 `payload_version` 비교와 409 `APPROVAL_CHANGED` 만 준다. 어느 칸이 바뀌었는지는 주지 않는다. 폼을 만든 시점(PM 이 본 내용)의 값을 보내야 의미가 있다(#512 BE 답).
- PM 이 고친 값은 보존한다(브리프·FE 확정).

## 실제 검토한 선택지

1. 409 를 받으면 안내만 하고 PM 이 새로고침하게 한다. 고친 값이 사라진다.
2. 409 를 받았을 때만 새 카드를 받아 폼을 맞춘다. 409 없이 다시 받은 응답(포커스 복귀 등)으로 카드가 바뀌면 폼이 낡은 채로 남고 승인이 한 번 더 409 가 된다.
3. 같은 승인의 `payload_version` 이 달라진 응답을 받으면 언제든 폼을 그 카드에 맞춘다. 409 는 다시 받기를 시작하는 신호일 뿐이다.

## 선택과 이유

3을 골랐다.

- 폼이 맞춰진 카드(`seen`)를 상태로 두고 처리 요청은 그 카드의 `payloadVersion` 을 싣는다. 화면에 보이는 값과 보내는 지문이 늘 같은 카드에서 나온다.
- 버전이 다른 응답이 오면 `form.reset(새 값, { keepDirtyValues: true, keepDirty: true })` 로 고치지 않은 칸만 새 값으로 바꾼다. 기본값도 새 카드로 옮겨, 이후 PM 이 고치는 칸도 새 제안과 비교한다. `resetField` 로 고치지 않은 칸만 바꾸면 고친 칸의 기본값이 옛 제안에 남는다. 그러면 PM 이 그 칸을 옛 제안 값으로 되돌렸을 때 보내지 않아 새 제안으로 만들어지는 틈이 있어 버렸다.
- 「바뀐 내용」 안내는 처음 본 카드와 지금 카드의 차이를 보인다. 409 가 아니어도 같은 안내라 PM 이 놓치지 않는다. 승인 버튼은 「새 내용을 확인했어요, 승인」으로 바뀐다.
- 목록 카드는 값을 승인 응답과 고친 값으로 매번 계산한다. 그래서 그 카드를 그린 응답의 지문을 싣고, 409 면 문구와 함께 새 목록으로 다시 그린다.

## 장단점과 감수한 제약

- 안내가 비교하는 기준은 처음 본 카드다. 두 번 이상 바뀌면 중간 값은 보이지 않는다.
- `keepDirty` 라 고친 칸의 dirty 표시는 새 제안과 같아져도 남는다. 그 칸은 제안과 같은 값을 `task_overrides` 로 보낸다. 결과는 같다.
- `seen` 은 payload 스냅샷이다. 별칭 후보(`alias_candidate`)는 payload 밖에서 지금 별칭으로 구해 지문이 같아도 바뀌므로, 처리할 카드는 `seen` 에 최신 응답의 후보만 얹는다(2026-11-09 리뷰 반영, 같은 지문에서 후보만 생기면 `save_alias` 가 빠지던 결함).
- 「확인했어요」는 버튼 문구다. 안내를 읽었는지 따로 묻지 않는다.
- MSW 의 「본 뒤 합쳐짐」은 모의 DB 판을 올리지 않으려고 추출 항목에 `merge_into`(응답에는 없음)를 두고 처리 요청 직전에 합친다.

## 영향 범위와 재검토 조건

- 생성 승인 상세와 태스크 목록의 생성 승인 카드. 변경 승인(`task_update`)은 `payload_version` 이 null 이라 그대로다.
- BE 가 바뀐 칸을 직접 알려 주거나 `payload_version` 을 필수로 바꾸면 다시 본다.

## 근거와 관련 문서

- [#512](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/512) BE 답·FE 확정(2026-11-08)
- [계약 §2.5 「합쳐진 카드와 본 뒤 바뀐 카드」](../../../contracts/frontend-api-contract.md)
- [useTaskCreateOverrides](../../../../src/features/approval-resolve/model/useTaskCreateOverrides.ts), [ApprovalReview](../../../../src/widgets/approval-review/ui/ApprovalReview.tsx), [approvalMerge](../../../../src/shared/mock/approvalMerge.ts)
- RTL: [approvalMerged.test.tsx](../../../../src/app/approvalMerged.test.tsx)
