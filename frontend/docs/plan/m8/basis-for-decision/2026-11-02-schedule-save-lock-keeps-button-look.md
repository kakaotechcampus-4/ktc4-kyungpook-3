# 발송 시점 저장 중의 발송 잠금은 모양을 바꾸지 않고, 저장 중 표시는 늦을 때만 보이는 선택

- 기록일: 2026-11-02
- 관련 마일스톤: M8-C 메시지(#245)

## 문제와 제약

- `언제 보낼까요?` 카드를 누르면 바로 서버에 발송 시점을 저장한다(D-137, 확정 버튼은 시안에 없다). 저장하는 동안 [ReviewDetail](../../../../src/widgets/message-inbox/ui/ReviewDetail.tsx)의 행동이 모두 잠기고, 잠긴 `이대로 발송`은 공용 [Button](../../../../src/shared/ui/button/Button.tsx)의 `aria-disabled` 모양(연회색 면 · 흐린 글자)이 된다.
- 코디네이터 실측(포트 5223, `messages-default`, `지금 바로` 누름): 20ms에 `aria-disabled=true`·면 `rgb(240, 240, 240)`, 111ms에 풀려 `rgb(23, 23, 23)` — 약 90ms 동안 버튼이 깜빡였다. 사용자가 지적했다.
- 사용자 결정(방식 A): 저장 중에도 발송·보내지 않음의 잠금(누름을 버려 순서를 지킴)은 유지하고, **시점 저장 때문에 잠긴 동안만** 두 버튼의 모양을 바꾸지 않는다. 시각 칸이 열림(안내 문구)·문구를 고치는 중·발송/보내지 않음 자체의 요청 중에는 지금처럼 잠긴 모양을 보인다 — 사람이 이유를 알아야 하는 잠금이다. 공용 Button의 `aria-disabled` 모양은 앱 전체에서 바꾸지 않는다.

## 실제 검토한 선택지

접근성 의미:

1. 저장 중에는 버튼의 `aria-disabled`를 떼고 누름만 버린다 — 화면 읽기 사용자는 눌렀는데 아무 일도 없다.
2. 버튼에 `aria-busy` — 바뀌는 것은 버튼이 아니라 시점 묶음이다. `aria-busy`는 내용이 갱신 중인 요소에 단다.
3. 버튼은 그대로 `aria-disabled="true"`(지금은 누를 수 없음을 알림), 시점 묶음 `fieldset`에 `aria-busy`(값을 저장 중), 모양만 유지.

모양을 유지하는 자리:

- 공용 Button에 옵션을 더한다 — 모든 변형의 `aria-disabled:` 클래스를 조건부로 바꿔야 해 공용 변경이 커진다.
- [LockedButton](../../../../src/widgets/message-inbox/ui/LockedButton.tsx)(메시지 위젯 전용)에 `keepLook` 옵션을 둔다.

저장 중 표시:

- 바로 표시 — 90ms 저장이면 표시 자체가 번쩍인다.
- 지연 + 최소 표시 시간 — 저장이 끝나 카드가 이미 골라진(먹 면) 뒤에도 `저장 중`이 남아 끝난 일을 진행 중으로 보인다.
- 지연만 — 저장이 그보다 길 때만 보이고 끝나면 바로 사라진다.

## 선택과 이유

- 접근성은 3을 택했다. 누름이 실제로 무시되므로 `aria-disabled`가 사실과 맞고, 갱신 중인 영역(`fieldset`)에 `aria-busy`를 단다.
- 모양은 `LockedButton`의 `keepLook`으로 유지한다. 잠긴 동안 `data-lock="quiet"`를 달고, 쓰는 변형(primary·default·ghost)의 기본 면·글자·hover·포커스 선을 `data-[lock=quiet]:aria-disabled:` 클래스로 다시 건다. 속성 하나가 더 붙어 선택자가 Button의 `aria-disabled:` 규칙보다 구체적이므로 생성 CSS 순서에 기대지 않는다. `ReviewDetail`은 `진행 중 행동 = schedule`이고 안내 문구(lockHint)가 없을 때만 켠다 — `이대로 발송`·`보내지 않음`, 같은 이유로 깜빡이던 `고쳐 쓰기`.
- 저장 중 표시는 지연만 둔다(400ms, [useShownAfter](../../../../src/widgets/message-inbox/lib/useShownAfter.ts)). 저장 중인 카드 오른쪽 위에 `저장 중`을 작게 얹고 카드의 테두리·면·글자 색과 높이는 바꾸지 않는다. 짧은 저장에서는 아무것도 번쩍이지 않고 카드 선택만 바뀐다.

## 장단점과 감수한 제약

- `KEEP_LOOK`이 Button의 변형 색을 옮겨 적는다. Button의 VARIANT를 바꾸면 같이 바꿔야 한다(파일 주석에 적었다). 회귀는 스토리 `발송_시점_저장_중`의 계산된 색 비교가 잡는다.
- 400~500ms 사이에 끝나는 저장은 `저장 중`이 잠깐 보였다 카드 선택과 함께 사라진다. 상태가 되돌아가는 깜빡임이 아니라 한 번의 결과 변화로 보았다.
- 모양이 그대로인 잠긴 버튼을 누르면 아무 일도 없다. 그 이유는 저장 중인 카드가 보여 준다(400ms 이후). 그 전의 누름은 눈에 띄는 반응 없이 버려진다.

## 영향 범위와 재검토 조건

메시지 위젯 안에서만 쓴다. 실제 API에서 시점 저장이 자주 수백 ms를 넘거나, 발송 시점에 확정 버튼을 두는 디자인이 생기면 다시 정한다.

## 근거와 관련 문서

- [M8-C 결과](../result-c.md) 「2026-11-02 발송 시점 카드 hover와 저장 중 버튼 깜빡임 수정」
- 회귀 사례: 스토리 [MessageInbox.stories.tsx](../../../../src/widgets/message-inbox/ui/MessageInbox.stories.tsx)의 `발송_시점_저장_중`, [messagesActionsMsw.test.tsx](../../../../src/app/messagesActionsMsw.test.tsx)의 「저장이 늦을 때만 그 카드에 저장 중이 보인다」
- [발송 시점 카드의 화살표 키·aria-disabled 선택](2026-11-01-send-timing-arrow-keys-move-focus-only.md)
