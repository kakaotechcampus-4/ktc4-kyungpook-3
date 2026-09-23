# 포커스에 outline을 쓰지 않는다

- 날짜: 2026-09-16
- 상태: 개정됨 (2026-09-23) — `2026-09-23-focus-outline-over-border.md` 가 이었다

## 고민

스펙·캔버스는 `:focus-visible { outline: 2px solid #171717; offset 4px }` 다.
테두리가 있는 버튼(outline·default)에 링을 더하면 선이 두 겹이 된다.

## 고른 길

`:focus` / `:focus-visible` 모두 `outline: none`.
눌림(active) 표시는 테두리·면 색으로만 한다.

## 남은 구멍 — 지금 키보드 포커스 표시가 **아예 없다**

`outline: none` 을 넣었는데 그 자리를 채운 게 없다.
산출 CSS 에서 포커스 규칙은 `:focus,:focus-visible{outline:none}` 한 줄이 전부고,
`src/shared/ui/` 어느 컴포넌트에도 `focus-visible:` 유틸이 없다.

```bash
grep -rn 'focus' src/ --include=*.tsx --include=*.css | grep -v '\.test\.'
#   src/app/styles/global.css:71,72  → outline: none
#   src/shared/ui/mascot/Mascot.tsx:504  → focusable="false" (SVG 속성, 무관)
```

`hover:` 와 `active:` 는 있지만 **둘 다 포인터 전용**이라 탭 이동에는 아무 변화가 없다.
`WCAG 2.2 AA` SC 2.4.7 미충족이고, `frontend-decisions.md` 의 접근성 결정과도 어긋난다.

## 다시 고민할 때

**M4 화면 작업 전에 반드시 채운다.** 이중 선을 피하면서 탭 이동이 보이게 하는 후보:

- `focus-visible` 에서만 테두리를 먹으로 (테두리가 이미 있는 컨트롤은 색만 바뀌므로 두 겹이 안 된다)
- `box-shadow` 인셋 링 (레이아웃을 밀지 않는다)
- 테두리 없는 컨트롤(고스트·텍스트 버튼)만 `outline`, 나머지는 테두리 색

지금은 이중 선을 없애는 쪽이 이겼지만, **"없앤다"와 "대신 무엇을 쓴다"는 다른 결정이다.**
전자만 하고 후자를 안 해서 생긴 구멍이다.

## 그 뒤 (2026-09-23)

outline 을 되살렸다. 두 겹은 outline 이 아니라 `offset: 4px` 의 빈틈 때문이었다.
`offset: -1px` 로 기존 테두리 위에 겹쳐 그린다 — `2026-09-23-focus-outline-over-border.md`.
위 후보 중 "테두리를 먹으로"는 고대비 모드에서 사라지고, `box-shadow` 는 그림자 금지와 고대비 모드에 걸려 고르지 않았다.
