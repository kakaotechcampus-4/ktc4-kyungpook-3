# `border-dashed` 가 테두리 모양인가 토큰 색인가

- 날짜: 2026-09-16
- 상태: 결정

## 고민

`Card` 의 `pending` 변형은 `2px dashed #BDBDBD` 다 (§7-4).
`#BDBDBD` 는 `tokens.css` 에 `--color-dashed` 로 들어 있다.

그런데 Tailwind 에는 **이미 `border-dashed` 라는 기본 유틸이 있다** — `border-style: dashed`.
토큰 이름과 유틸 이름이 정확히 겹친다. 색이 가려지는 줄 알고 이렇게 쓸 뻔했다.

```tsx
// 이렇게 쓰면 색이 아예 안 나온다
'border-2 border-dashed border-[color:var(--color-dashed)]'
```

## 고른 길

**`border-dashed` 하나만 쓴다.** 색 클래스를 따로 붙이지 않는다.

```ts
pending: 'rounded-16 border-2 border-dashed px-22 py-20'
```

## 왜 — 빌드 산출물을 봤다

Tailwind v4 는 겹치는 이름을 고르지 않는다. **두 규칙을 다 낸다.**

```bash
npm run build
grep -o '[^{}]*border-dashed[^{}]*{[^}]*}' dist/assets/*.css
```

```css
.border-dashed{--tw-border-style:dashed;border-style:dashed}
.border-dashed{border-color:var(--color-dashed)}
```

두 규칙이 건드리는 속성이 서로 달라서(`border-style` vs `border-color`) 충돌하지 않는다.
클래스 하나가 `dashed` 와 `#BDBDBD` 를 같이 낸다. 토큰 이름이 유틸 이름과 겹친 게 **우연히 맞다**.

`border-2` 는 `border-style: var(--tw-border-style)` 를 같이 쓰는데, 그 변수의 최종 계산값이
`.border-dashed` 가 넣은 `dashed` 라 CSS 순서와 무관하게 점선이 된다.

**`border-[color:var(--color-dashed)]` 를 버린 이유** — 그 후보는 **CSS 가 아예 생성되지 않는다**.
위 빌드 산출물에 `border-[color...` 선택자가 0건이다. v4 는 이 자리에 `border-(--color-dashed)` 문법을 쓴다.
`[color:...]` 는 조용히 죽는 클래스라 타입·린트·테스트를 전부 통과하면서 화면만 틀린다.

## 딸린 함정

토큰 이름을 Tailwind 기본 유틸 이름과 같게 지으면 이런 일이 또 난다.
지금 `tokens.css` 에서 겹치는 건 `--color-dashed` 하나뿐이다.
`--color-solid` · `--color-double` · `--color-hidden` 같은 이름을 나중에 만들면 같은 자리에서 다시 헷갈린다.

확인하는 법은 언제나 같다 — **빌드해서 산출 CSS 에 그 선택자가 있는지 본다.**

## 다시 고민할 때

`border-dashed` 를 점선이 아닌 자리(예: 실선 `#BDBDBD` 테두리)에 쓰고 싶어지면,
그때는 `border-(--color-dashed)` 로 색만 따로 준다. 그 문법이 실제로 CSS 를 내는지 먼저 빌드로 확인한다.
