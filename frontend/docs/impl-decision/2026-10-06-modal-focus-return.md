# Trigger 없는 모달이 닫히면 포커스가 `body` 로 떨어졌다 — 어디로 돌릴 것인가

- 날짜: 2026-10-06
- 상태: 결정

## 고민

M5 U6-3 키보드 E2E 를 쓰다 발견했다. 업로드 화면에서 파일을 고른 뒤 헤더 `태스크` 링크에서 Enter → 이탈 확인 모달 → Esc 로
닫으면 `document.activeElement` 가 `body` 였다. 가두기(Tab 순환)는 정상이었다.

공통 `Modal` 은 열림을 호출자가 쥔다(`open`·`onOpenChange`). Radix `Dialog.Trigger` 를 쓰지 않는다. Radix 의 모달 Content 는
닫힐 때 `onCloseAutoFocus` 에서 FocusScope 의 기본 복귀를 막고 `triggerRef` 로만 포커스를 돌린다. Trigger 가 없으니 아무 데도
돌리지 않는다. 키보드 사용자는 모달을 닫을 때마다 문서 처음부터 Tab 을 다시 밟아야 했다. 같은 `Modal` 을 쓰는 미저장 이탈 확인
(`app/router/UnsavedChangesPrompt`)과 Notion 차단·재연결 모달(`features/notion-connection/ui/NotionRequiredModal`) 모두 같다.

길이 둘이었다.

1. 호출하는 곳마다 연 요소를 넘긴다(`returnFocusTo` 같은 prop).
2. 공통 `Modal` 이 열릴 때의 포커스를 기억했다가 닫힐 때 돌린다.

## 고른 길

2번. `Modal` 한 곳에서 Radix 의 두 이벤트를 쓴다 (코디네이터 승인, 2026-10-06).

```tsx
onOpenAutoFocus={() => {
  // FocusScope 가 첫 요소로 옮기기 전이다 — 지금 포커스가 있는 요소가 모달을 연 요소다
  const active = document.activeElement
  opener.current = active instanceof HTMLElement && active !== document.body ? active : null
}}
onCloseAutoFocus={(event) => {
  const target = opener.current
  opener.current = null
  if (target === null || !target.isConnected) return
  const active = document.activeElement
  if (active !== null && active !== document.body) return
  event.preventDefault()
  target.focus()
}}
```

- 연 요소가 문서에서 사라졌으면(화면 이동) 손대지 않는다 — 기존 동작(Radix 기본)이다.
- 닫는 사이 다른 요소가 포커스를 가져갔으면 손대지 않는다. Radix 는 닫은 뒤의 포커스를 타이머로 옮기므로, 이동한 새 화면이
  자기 포커스 정책(예: 설정의 `Notion 연결` 제목)을 먼저 실행한다. 그 포커스를 가로채지 않는다.
- 포커스를 받을 수 없는 요소면 `focus()` 가 아무것도 하지 않는다 — 기존처럼 `body` 다.
- 처음부터 열린 채 그려진 모달(업로드 진입 차단)은 연 요소가 없다(`body`) — 아무것도 하지 않는다.

검사:

- `shared/ui/modal/Modal.test.tsx` 의 `focus return` 세 건 — Esc·닫기 버튼 뒤 복귀, 연 요소가 사라지면 그대로, 이동한 화면의
  포커스를 가로채지 않음. 복귀 줄을 지우면 첫 건이, 「다른 요소가 가져갔으면 그대로」 줄을 지우면 셋째 건이 실패함을 확인했다.
- `e2e/meeting-keyboard.e2e.ts` 가 실제 Chromium 에서 가두기와 복귀를 함께 본다.

## 왜

- 연 요소를 넘기는 길은 호출부 셋이 저마다 기억해야 한다. 이탈 확인은 `GuardedLink`·`useGuardedNavigate`·뒤로가기 어디서든
  열려 넘길 요소를 알기 어렵다.
- Radix `Trigger` 로 바꾸는 길은 열림을 호출자가 쥐는 공통 UI 의 계약(`open` 은 호출자 소유)과 맞지 않는다.
- WAI-ARIA 모달 대화상자 패턴은 닫히면 연 요소로 포커스를 돌리라고 한다. 연 요소가 없어졌을 때만 다른 곳을 고른다.

## 다시 고민할 때

- Radix 가 Trigger 없는 Dialog 의 복귀를 직접 지원하게 되면 이 처리를 지운다.
- 닫힌 뒤 연 요소가 아닌 곳(예: 목록의 다음 항목)으로 보내야 하는 모달이 생기면 그 모달만 `onCloseAutoFocus` 를 받게 넓힌다.
