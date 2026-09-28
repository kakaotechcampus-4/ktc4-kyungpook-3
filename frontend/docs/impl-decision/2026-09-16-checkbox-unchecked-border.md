# 체크박스 미체크 테두리 — 어느 선 토큰이고, 상태별 테두리를 어떻게 붙일 것인가

- 날짜: 2026-09-16
- 상태: 결정

## 고민

캔버스 25장에 체크박스는 `Signup.dc.html` 한 곳뿐이고 **체크된 상태만 있다.**
미체크·비활성·오류는 실측이 0건이라 `m2-design-tokens.md` §7-5 도 전부 `제안`으로 적어 두었다.

두 갈래의 고민이 겹친다.

1. **어느 선 토큰인가** — 선은 5단이다. `#949494`(입력 경계) · `#C9C9C9`(강조 테두리) · `#E8E8E8`(선) 셋이 후보다.
2. **한 요소에 테두리 규칙이 네 개 붙는다** — 체크(테두리 없음) · 미체크(선) · 오류(강조색) · 비활성(없음/`#C9C9C9`).
   체크 여부는 Radix 가 `data-state` 로 들고 있어서 렌더 시점에 알 수 없다(uncontrolled 로도 쓰인다).
   그런데 `invalid` 와 `disabled` 는 props 라 렌더 시점에 안다.

## 고른 길

**1번 — `border-input-border`(`#949494`).** 체크박스는 입력이고, `#949494` 의 Foundations 용례가 "입력 경계"다.
같은 폼 안의 `TextField` product 톤이 이미 이 선을 쓴다. 미체크 체크박스만 `#E8E8E8` 이면 한 줄 아래 입력과 굵기가 어긋나 보인다.

**2번 — 아는 것은 TS 에서 가르고, 모르는 것만 `data-[state=…]` 변형에 맡긴다.**

```ts
const BOX_TONE: Record<CheckboxTone, string> = {
  default: `${BOX_SURFACE} ${BOX_BORDER}`,
  invalid: `${BOX_SURFACE} ${BOX_BORDER_INVALID}`,
  disabled: BOX_DISABLED,
}
```

`disabled ? 'disabled' : invalid ? 'invalid' : 'default'` 로 **한 묶음만** 붙인다.
묶음끼리는 겹치지 않으므로 `border-accent` 와 `border-input-border` 가 같은 class 목록에 함께 들어가는 일이 없다.
묶음 **안에서만** `border-input-border`(기본) → `data-[state=checked]:border-transparent`(변형)처럼 겹치고, 이건 변형이 이긴다.

## 왜

`className` 을 배열 join 으로 붙이면 **HTML 에 나중에 적은 클래스가 이기지 않는다** — 생성된 CSS 순서가 이긴다
(docs/impl-decision/2026-09-16-no-cn-clsx-tailwind-merge.md).
`border-accent` 와 `data-[state=unchecked]:border-input-border` 를 같이 붙이면 변형 쪽이 뒤에 생성돼
**오류 상태가 조용히 묻힌다.** 타입·린트·테스트 어디서도 잡히지 않는다.

그래서 "겹치면 어느 쪽이 이기는가"를 따지는 대신 **애초에 겹치지 않게** 묶음을 갈랐다.
`disabled` 와 `invalid` 가 props 라서 가능한 방법이고, 체크 여부처럼 Radix 가 들고 있는 것만 변형에 남긴다.

## 딸린 것 — indeterminate 표식은 ternary 로 고른다

`Indicator` 는 checked / indeterminate 둘 다에서 렌더된다. 안에 무엇을 그릴지는 Radix 가 알려주지 않는다.
`checked` prop 이 `'indeterminate'` 인지 보고 ternary 로 고른다 — `defaultChecked` 는 `boolean` 이라
indeterminate 는 제어 컴포넌트로만 만들어진다. `group-data-[state=…]` 로 둘 다 그려 놓고 숨기는 방법은 쓰지 않았다.
DOM 에 안 쓰는 노드가 남고 테스트가 "무엇이 그려졌는가"를 못 묻는다.

## 다시 고민할 때

미체크 체크박스가 실제로 그려진 아트보드가 생기면 그 값으로 바꾼다.
`invalid` 묶음에 hover / pressed 를 넣을지는 약관 동의 화면(M4)에서 눈으로 보고 정한다 — 지금은 강조색 한 겹으로 고정이다.

## 그 뒤 (2026-09-23)

체크·중간 상태의 눌림 면 변화(`#171717` → `#5A5A5A`)는 없앴다. 미체크 테두리 hover / pressed 는 그대로다 — docs/impl-decision/2026-09-23-no-pressed-face-checkbox-segmented.md
