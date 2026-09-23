# 포커스는 테두리 위에 겹친 outline 이다

- 날짜: 2026-09-23
- 상태: 결정 — `2026-09-16-focus-ring-not-ink.md` 의 "대체 표현 미정"을 닫는다

## 고민

M2 는 outline 을 뺐다. 테두리가 있는 컨트롤에서 선이 두 겹이 되기 때문이다.
그런데 그 자리를 채우지 않아 Tab 으로 이동해도 화면이 바뀌지 않았다 (SC 2.4.7 미충족).

두 겹은 outline 자체가 아니라 캔버스 값 `outline-offset: 4px` 가 만든 빈틈 때문이다.
테두리 · 4px 틈 · 링이 따로 보인다.

## 고른 길

```css
:focus-visible {
  outline: 2px solid var(--color-ink);
  outline-offset: -1px;
}
```

offset 이 음수라 outline 이 기존 1px 테두리 위에 그려진다. 겉으로는 테두리가 먹으로 두꺼워진 한 줄이다.

예외는 둘이다.

| 대상 | 값 | 이유 |
|---|---|---|
| Button `primary`, Checkbox 체크·중간 상태 | `outline-surface` · offset `-3px` | 먹 선이 먹 면에 묻힌다. 면 안쪽에 흰 선을 긋는다 |
| 장식형 TextField | 래퍼가 `has-[input:focus-visible]` 로 그리고 안쪽 input 은 `outline-none` | 안쪽 input 에 그리면 래퍼 테두리 안쪽에 선이 하나 더 생긴다 |

`aria-disabled` primary 는 면이 밝아 흰 선이 안 보이므로 먹 선으로 되돌린다.

## 왜

- **border 두께를 바꾸지 않는다.** 박스가 1px 커져 주변이 밀린다.
- **border 색만 바꾸지 않는다.** 윈도우 고대비 모드가 테두리 색을 시스템 색으로 덮어 포커스가 사라진다.
  테두리 없는 고스트·텍스트 버튼·세그먼트에는 바꿀 테두리도 없다.
- **`box-shadow` 링을 쓰지 않는다.** 그림자 금지(tokens.css)에 걸리고, 고대비 모드에서 사라진다.
- outline 은 상태 변형(`data-[state=*]:border-*`)과 속성이 겹치지 않는다.
  선택된 카드의 `border-line-strong` 이 포커스를 덮는 일이 없다.

## 다시 고민할 때

바탕이 먹인 화면(어두운 헤더 등)이 생기면, 그 위의 컨트롤은 먹 선이 묻힌다 — 흰 선 예외를 그 영역에도 건다.
