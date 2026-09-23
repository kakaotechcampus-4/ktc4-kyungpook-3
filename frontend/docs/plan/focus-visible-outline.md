# 키보드 포커스 표시 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tab 으로 이동할 때 포커스된 컨트롤이 보이게 한다. 이슈 #73, WCAG 2.2 AA SC 2.4.7.

**Architecture:** `global.css` 의 `@layer base` 에 `:focus-visible { outline: 2px solid ink; outline-offset: -1px }` 한 줄을 둔다. 음수 offset 이라 outline 이 기존 1px 테두리 **위에** 겹쳐 그려진다. 그래서 선이 두 겹이 되지 않고 "테두리가 먹으로 두꺼워진다"로 보인다. 먹 면 컨트롤 두 개(Button `primary`, Checkbox 체크·중간 상태)만 흰 선 예외를 둔다. 장식형 TextField 는 래퍼가 그린다.

**Tech Stack:** Tailwind CSS v4 (`@tailwindcss/vite`), React 19, Radix, Vitest + Testing Library (jsdom), Playwright MCP(브라우저 확인)

**Spec:** GitHub 이슈 #73 — `gh issue view 73`. 배경은 `frontend/docs/impl-decision/2026-09-16-focus-ring-not-ink.md`.

## Global Constraints

- 포커스 표시는 `outline` 한 가지만 쓴다. `box-shadow`·`ring-*` 는 쓰지 않는다 (tokens.css 가 그림자를 금지한다).
- 기본값은 `outline: 2px solid var(--color-ink); outline-offset: -1px`.
- 먹 면 예외는 `outline-color: var(--color-surface); outline-offset: -3px`.
- `:focus-visible` 만 쓴다. `:focus` 에는 그리지 않는다 (마우스 클릭에 링이 뜨지 않게).
- React 에서 포커스를 추적하지 않는다 (`onFocus` 상태·`useState` 금지). CSS 의사 클래스만 쓴다.
- 클래스는 모듈 스코프 표에 두고 배열 join 으로 붙인다 (`docs/impl-decision/2026-09-16-no-cn-clsx-tailwind-merge.md`).
- 새 색·간격 토큰을 만들지 않는다. 허용 색은 `ink`·`surface` 뿐이다. (Task 7 에서 강조색 테두리 컨트롤에 `accent` 추가)
- 커밋은 `feat(frontend): …` / `docs(frontend): …`, 한국어 설명.

## 확인해 둔 사실 (2026-09-23, 설치된 Tailwind 로 직접 컴파일)

- 유틸리티 이름: `focus-visible:outline-surface`, `focus-visible:-outline-offset-3`, `-outline-offset-1`, `outline-none`, `has-[input:focus-visible]:outline-2` 모두 생성된다. `--spacing` 을 비운 것과 무관하다 (offset 은 px 숫자다).
- 순서: `data-[state=*]:` · `aria-*:` 변형은 `focus-visible:` 보다 **뒤에** 생성되어 이긴다. 겹쳐 쓴 `data-[state=checked]:focus-visible:` · `aria-disabled:focus-visible:` 는 `focus-visible:` 단독보다 뒤다.
- **그래서 상태 변형과 충돌하지 않는다.** 기존 상태 변형은 전부 `border-*`·`bg-*` 만 바꾸고 `outline-*` 을 건드리지 않는다. SelectCard 의 `data-[state=checked]:border-line-strong` 이 포커스를 덮는 일이 없다.
- 전역 규칙은 `@layer base`, 예외는 `@layer utilities` 라 예외가 항상 이긴다 (`docs/impl-decision/2026-09-16-unlayered-global-beats-utilities.md`).

## Review Focus

1. **`aria-disabled` primary 버튼** — 포커스를 받는데 면이 `surface-selected`(밝은 회색)다. 흰 선 예외가 그대로 걸리면 보이지 않는다. 먹 선으로 되돌아가야 한다 → Task 2 테스트.
2. **장식형 TextField 의 끝 버튼** — 비밀번호 보기 버튼에 포커스가 가도 래퍼가 함께 그리면 선이 두 겹이다. 래퍼는 **input** 포커스에만 반응해야 한다 → Task 4 테스트(`has-[input:focus-visible]`).
3. **오류·필수 입력** — 강조색 테두리 위에 먹 선이 덮인다. 포커스가 빠지면 빨간 테두리가 돌아와야 한다. 오류 문구는 그대로 남는다 → Task 5 브라우저 확인.
4. **세그먼트 항목 사이 간격 3px** — offset 이 음수라 이웃을 덮지 않아야 한다 → Task 5 브라우저 확인.
5. **윈도우 고대비 모드** — outline 이 남아야 한다 → Task 5 `forced-colors: active` 확인.

---

### Task 1: 전역 `:focus-visible` 규칙과 결정 기록

**Files:**
- Modify: `frontend/src/app/styles/global.css:69-74`
- Create: `frontend/src/app/styles/global.test.ts`
- Create: `frontend/docs/impl-decision/2026-09-23-focus-outline-over-border.md`

**Interfaces:**
- Produces: 전역 기본 포커스 표시. 이후 Task 는 이 값을 **덮는 예외**만 추가한다.

- [ ] **Step 0: 워크트리에 의존성 설치**

Run: `cd frontend && npm ci`
Expected: 오류 없이 끝난다. 워크트리에는 `node_modules` 가 없다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

jsdom 은 Tailwind 레이어 CSS 를 계산하지 않으므로, 규칙 **문장**을 계약으로 고정한다. 실제로 그려지는지는 Task 5 가 본다.

`frontend/src/app/styles/global.test.ts`:

```ts
import css from './global.css?raw'

/* jsdom 은 이 CSS 를 계산하지 않는다 — 규칙 문장을 계약으로 고정하고,
   실제로 그려지는지는 브라우저에서 본다 (docs/plan/focus-visible-outline.md Task 5). */
describe('global focus rule', () => {
  it('draws a 2px ink outline over the existing border on focus-visible', () => {
    const rule = /:focus-visible\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''

    expect(rule).toMatch(/outline:\s*2px solid var\(--color-ink\);/)
    expect(rule).toMatch(/outline-offset:\s*-1px;/)
  })

  it('no longer strips the outline', () => {
    expect(css).not.toMatch(/outline:\s*none/)
  })

  it('leaves plain :focus alone so a mouse click draws nothing', () => {
    expect(css).not.toMatch(/(^|[\s,]):focus\s*[,{]/m)
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `cd frontend && npx vitest run src/app/styles/global.test.ts`
Expected: FAIL — 첫 번째와 두 번째 테스트가 떨어진다 (지금은 `outline: none`).
`?raw` import 가 타입 오류를 내면 `src/vite-env.d.ts` 첫 줄에 `/// <reference types="vite/client" />` 가 있는지 보고, 없으면 추가한다.

- [ ] **Step 3: 규칙을 바꾼다**

`global.css` 의 69–74행을 이것으로 바꾼다:

```css
  /* 포커스는 outline 이다. offset 을 -1px 로 주면 outline 이 기존 1px 테두리 위에 겹쳐
     "테두리가 먹으로 두꺼워진다"로 보이고, 선이 두 겹이 되지 않는다.
     outline 은 박스 크기에 들지 않아 레이아웃을 밀지 않고, 고대비 모드에서도 남는다.
     먹 면 컨트롤은 컴포넌트가 흰 선으로 덮는다.
     docs/impl-decision/2026-09-23-focus-outline-over-border.md */
  :focus-visible {
    outline: 2px solid var(--color-ink);
    outline-offset: -1px;
  }
```

- [ ] **Step 4: 통과를 확인한다**

Run: `cd frontend && npx vitest run src/app/styles/global.test.ts`
Expected: PASS 3개

- [ ] **Step 5: 결정 기록을 쓴다**

`frontend/docs/impl-decision/2026-09-23-focus-outline-over-border.md`:

````markdown
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
````

- [ ] **Step 6: 커밋**

```bash
git add frontend/src/app/styles/global.css frontend/src/app/styles/global.test.ts frontend/docs/impl-decision/2026-09-23-focus-outline-over-border.md
git commit -m "feat(frontend): 포커스를 테두리 위에 겹친 outline 으로 그리다"
```

---

### Task 2: Button `primary` 의 흰 선 예외

**Files:**
- Modify: `frontend/src/shared/ui/button/Button.tsx:35-50`
- Test: `frontend/src/shared/ui/button/Button.test.tsx`

**Interfaces:**
- Consumes: Task 1 의 전역 규칙 (먹 선 · offset -1px)
- Produces: `VARIANT.primary` 에 포커스 예외 클래스 4개

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`Button.test.tsx` 의 `describe('Button')` 안 마지막에 추가한다:

```tsx
  it('draws a white focus line inside the ink face of primary', () => {
    render(<Button variant="primary">승인</Button>)

    expect(screen.getByRole('button')).toHaveClass(
      'focus-visible:outline-surface',
      'focus-visible:-outline-offset-3',
    )
  })

  it('returns aria-disabled primary to the ink focus line — the face is light there', () => {
    render(
      <Button variant="primary" aria-disabled="true">
        승인
      </Button>,
    )

    expect(screen.getByRole('button')).toHaveClass(
      'aria-disabled:focus-visible:outline-ink',
      'aria-disabled:focus-visible:-outline-offset-1',
    )
  })

  it.each(['default', 'ghost', 'text', 'outline'] as const)(
    'leaves the %s variant on the global focus line',
    (variant) => {
      render(<Button variant={variant}>승인</Button>)

      expect(screen.getByRole('button').className).not.toMatch(/focus-visible:/)
    },
  )
```

- [ ] **Step 2: 실패를 확인한다**

Run: `cd frontend && npx vitest run src/shared/ui/button`
Expected: FAIL — 새 테스트 둘이 떨어진다. 세 번째 `it.each` 는 통과한다.

- [ ] **Step 3: 구현한다**

`Button.tsx` 의 `VARIANT` 위에 상수를 두고 `primary` 끝에 붙인다:

```tsx
/* 먹 면에는 전역 먹 선이 묻힌다 — 면 안쪽에 흰 선을 긋는다.
   aria-disabled 면은 밝아서 흰 선이 안 보이므로 전역 값으로 되돌린다.
   docs/impl-decision/2026-09-23-focus-outline-over-border.md */
const INK_FACE_FOCUS =
  'focus-visible:outline-surface focus-visible:-outline-offset-3 aria-disabled:focus-visible:outline-ink aria-disabled:focus-visible:-outline-offset-1'
```

```tsx
  primary: `bg-ink text-surface hover:bg-dim hover:text-surface active:bg-sub active:text-surface disabled:bg-surface-selected disabled:text-faint aria-disabled:bg-surface-selected aria-disabled:text-faint ${INK_FACE_FOCUS}`,
```

- [ ] **Step 4: 통과를 확인한다**

Run: `cd frontend && npx vitest run src/shared/ui/button`
Expected: PASS 전부

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/shared/ui/button
git commit -m "feat(frontend): primary 버튼의 포커스를 먹 면 안쪽 흰 선으로 그리다"
```

---

### Task 3: Checkbox 체크·중간 상태의 흰 선 예외

**Files:**
- Modify: `frontend/src/shared/ui/checkbox/Checkbox.tsx:137-140`
- Test: `frontend/src/shared/ui/checkbox/Checkbox.test.tsx`

**Interfaces:**
- Consumes: Task 1 의 전역 규칙
- Produces: `BOX_SURFACE` 에 상태별 포커스 예외 클래스

미체크 상자는 흰 면 + 입력 경계라 전역 먹 선 그대로 둔다. 18px 상자에서 offset -3px 흰 선은 먹 면 안쪽 2px 에 그려진다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`Checkbox.test.tsx` 의 `describe('Checkbox')` 안 마지막에 추가한다:

```tsx
  it('draws a white focus line inside the ink face when checked or indeterminate', () => {
    render(<Checkbox checked />)

    expect(screen.getByRole('checkbox')).toHaveClass(
      'data-[state=checked]:focus-visible:outline-surface',
      'data-[state=checked]:focus-visible:-outline-offset-3',
      'data-[state=indeterminate]:focus-visible:outline-surface',
      'data-[state=indeterminate]:focus-visible:-outline-offset-3',
    )
  })

  it('leaves the unchecked box on the global focus line', () => {
    render(<Checkbox />)

    expect(screen.getByRole('checkbox').className).not.toMatch(/data-\[state=unchecked\]:focus-visible:/)
  })
```

- [ ] **Step 2: 실패를 확인한다**

Run: `cd frontend && npx vitest run src/shared/ui/checkbox`
Expected: FAIL — 첫 테스트가 떨어진다.

- [ ] **Step 3: 구현한다**

`BOX_SURFACE` 를 이것으로 바꾼다. 포커스 예외는 **상태가 먹 면일 때만** 걸리도록 상태 변형에 겹쳐 쓴다:

```tsx
/* 면은 data-state 가 고른다. 호출부가 uncontrolled 로 써도 맞아야 하기 때문이다.
   같은 속성 안에서 기본 유틸과 변형 유틸이 겹치면 변형이 이긴다 (Tailwind 생성 순서).
   먹 면일 때만 포커스를 흰 선으로 바꾼다 — docs/impl-decision/2026-09-23-focus-outline-over-border.md */
const BOX_SURFACE =
  'bg-surface data-[state=checked]:border-transparent data-[state=checked]:bg-ink data-[state=checked]:active:bg-sub data-[state=checked]:focus-visible:outline-surface data-[state=checked]:focus-visible:-outline-offset-3 data-[state=indeterminate]:border-transparent data-[state=indeterminate]:bg-ink data-[state=indeterminate]:active:bg-sub data-[state=indeterminate]:focus-visible:outline-surface data-[state=indeterminate]:focus-visible:-outline-offset-3'
```

`invalid` 톤도 `BOX_SURFACE` 를 쓰므로 함께 적용된다. `disabled` 톤은 포커스를 받지 않으니 손대지 않는다.

- [ ] **Step 4: 통과를 확인한다**

Run: `cd frontend && npx vitest run src/shared/ui/checkbox`
Expected: PASS 전부

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/shared/ui/checkbox
git commit -m "feat(frontend): 체크된 체크박스의 포커스를 먹 면 안쪽 흰 선으로 그리다"
```

---

### Task 4: 장식형 TextField 는 래퍼가 그린다

**Files:**
- Modify: `frontend/src/shared/ui/text-field/TextField.tsx:288-293`
- Test: `frontend/src/shared/ui/text-field/TextField.test.tsx`

**Interfaces:**
- Consumes: Task 1 의 전역 규칙
- Produces: `BARE_INPUT` 에 `focus-visible:outline-none`, `ADORNED_BOX` 에 input 한정 래퍼 포커스

장식이 없는 input 은 자기 테두리 위에 전역 먹 선이 겹치므로 손대지 않는다.
래퍼는 `has-focus-visible` 가 아니라 **`has-[input:focus-visible]`** 로 건다 — 끝의 버튼(비밀번호 보기)에 포커스가 갈 때 래퍼까지 그리면 두 겹이 된다. 그 버튼은 자기 전역 선을 그린다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`TextField.test.tsx` 의 `describe('TextField')` 안 마지막에 추가한다:

```tsx
  it('moves the focus line to the wrapper when an adornment wraps the input', () => {
    render(
      <TextField
        label="비밀번호"
        endAdornment={<button type="button" aria-label="비밀번호 보기" />}
      />,
    )
    const input = screen.getByLabelText('비밀번호')
    const wrapper = input.parentElement

    expect(input).toHaveClass('focus-visible:outline-none')
    expect(wrapper).toHaveClass(
      'has-[input:focus-visible]:outline-2',
      'has-[input:focus-visible]:outline-ink',
      'has-[input:focus-visible]:-outline-offset-1',
    )
  })

  it('keeps the plain input on the global focus line', () => {
    render(<TextField label="이메일" />)

    expect(screen.getByLabelText('이메일').className).not.toMatch(/outline/)
  })
```

- [ ] **Step 2: 실패를 확인한다**

Run: `cd frontend && npx vitest run src/shared/ui/text-field`
Expected: FAIL — 첫 테스트가 떨어진다.

- [ ] **Step 3: 구현한다**

`BARE_INPUT` 과 `ADORNED_BOX` 를 이것으로 바꾼다:

```tsx
/* min-w-[0px] 은 오타가 아니다 — tokens.css 가 --spacing 을 비워서 min-w-0 유틸이 없다.
   padding 은 preflight 의 `*{padding:0}` 이 이미 지운다 (p-0 도 같은 이유로 없다).
   docs/impl-decision/2026-09-16-values-outside-token-scale.md
   포커스는 래퍼가 그리므로 안쪽 input 은 끈다 — 래퍼 테두리 안쪽에 선이 하나 더 생긴다. */
const BARE_INPUT =
  'h-full w-full min-w-[0px] border-0 bg-transparent font-normal text-ink focus-visible:outline-none'

/* 래퍼는 input 포커스에만 그린다. 장식 안의 버튼은 자기 전역 선을 그린다 — 둘 다 그리면 두 겹이다.
   docs/impl-decision/2026-09-23-focus-outline-over-border.md */
const ADORNED_BOX =
  'flex w-full items-center gap-8 border bg-surface has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-ink has-[input:focus-visible]:-outline-offset-1'
```

`outline-2` 는 `outline-style: var(--tw-outline-style)` 을 함께 내고, 그 초기값이 `solid` 다. 따로 `outline-solid` 를 붙이지 않는다.

- [ ] **Step 4: 통과를 확인한다**

Run: `cd frontend && npx vitest run src/shared/ui/text-field`
Expected: PASS 전부

- [ ] **Step 5: 전체 검사**

Run: `cd frontend && npm run typecheck && npm run lint && npm run format:check && npm test`
Expected: 모두 통과. `format:check` 가 떨어지면 `npx prettier --write` 로 해당 파일만 고친다.

- [ ] **Step 6: 커밋**

```bash
git add frontend/src/shared/ui/text-field
git commit -m "feat(frontend): 장식이 붙은 입력은 래퍼가 포커스를 그리다"
```

---

### Task 5: 실제 브라우저에서 확인

jsdom 은 레이어 CSS 를 계산하지 않는다. 여기서 Review Focus 1–5 를 눈과 계산값으로 닫는다. 코드를 바꾸지 않는다 — 문제가 나오면 해당 Task 로 돌아가 테스트부터 고친다.

**Files:** 없음 (확인만). 결과는 PR 본문의 "확인 방법"에 붙인다.

- [ ] **Step 1: 개발 서버를 띄운다**

Run (백그라운드): `cd frontend && npm run dev -- --port 5173 --strictPort`
Expected: `http://localhost:5173` 에 `App.tsx` 컴포넌트 갤러리가 뜬다.

- [ ] **Step 2: Tab 으로 전부 돌며 계산값을 모은다**

Playwright MCP `browser_navigate` 로 `http://localhost:5173` 를 연다.
`browser_press_key` 로 `Tab` 을 40회 누르면서 매번 `browser_evaluate` 로 이 함수를 실행해 결과를 표로 모은다:

```js
() => {
  const el = document.activeElement
  const s = getComputedStyle(el)
  const wrap = el.parentElement ? getComputedStyle(el.parentElement) : null
  return {
    tag: el.tagName,
    label: el.getAttribute('aria-label') || el.textContent?.trim().slice(0, 20),
    state: el.getAttribute('data-state'),
    outline: `${s.outlineStyle} ${s.outlineWidth} ${s.outlineColor} / ${s.outlineOffset}`,
    wrapperOutline: wrap ? `${wrap.outlineStyle} ${wrap.outlineWidth} / ${wrap.outlineOffset}` : null,
  }
}
```

Expected:

| 대상 | outline |
|---|---|
| default · ghost · text · outline 버튼, 세그먼트 항목, 선택 카드, 미체크 체크박스, 토스트, 장식 없는 입력 | `solid 2px rgb(23, 23, 23) / -1px` |
| primary 버튼, 체크된 체크박스 | `solid 2px rgb(255, 255, 255) / -3px` |
| 장식형 입력의 안쪽 input | `none` · `wrapperOutline` 이 `solid 2px / -1px` |
| 장식형 입력 끝의 버튼 | 자기 값 `solid 2px … / -1px` · `wrapperOutline` 이 `none` (Review Focus 2) |

- [ ] **Step 3: 눈으로 본다**

`browser_take_screenshot` 로 아래를 찍어 확인한다:
- 아웃라인 버튼·입력·선택 카드에서 선이 **한 줄**로만 보인다 (두 겹 없음)
- 세그먼트 선택·미선택 항목 모두 이웃 항목을 덮지 않는다 (Review Focus 4)
- 오류 입력에 포커스하면 먹 선이 덮고, Tab 으로 빠지면 빨간 테두리가 돌아온다. 오류 문구는 계속 보인다 (Review Focus 3)
- 마우스로 버튼을 클릭하면 선이 **뜨지 않는다** (`:focus-visible` 만 쓴 효과)

- [ ] **Step 4: `aria-disabled` primary 를 확인한다 (Review Focus 1)**

갤러리에 `aria-disabled` primary 가 없으므로 `browser_evaluate` 로 하나 붙여 확인한다:

```js
() => {
  const b = [...document.querySelectorAll('button')].find((x) => x.className.includes('bg-ink'))
  b.setAttribute('aria-disabled', 'true')
  b.focus({ focusVisible: true })
  const s = getComputedStyle(b)
  return `${s.outlineColor} / ${s.outlineOffset}`
}
```

Expected: `rgb(23, 23, 23) / -1px`
`focus({ focusVisible: true })` 가 `:focus-visible` 을 켜지 않으면, 그 버튼 바로 앞 요소를 클릭한 뒤 `Tab` 으로 들어가 같은 값을 읽는다.

- [ ] **Step 5: 고대비 모드 (Review Focus 5)**

`browser_emulate_media` 로 `forcedColors: 'active'` 를 켜고 Step 2 의 표 중 버튼·입력·체크박스 하나씩 다시 읽는다.
Expected: `outlineStyle` 이 `none` 이 아니다 (색은 시스템 색으로 바뀌어도 된다).

- [ ] **Step 6: 서버를 끈다**

백그라운드 dev 서버를 종료한다.

---

### Task 6: 문서의 "미충족·미결" 문구를 닫는다

**Files:**
- Modify: `frontend/docs/impl-decision/2026-09-16-focus-ring-not-ink.md` (상태 줄 + 끝에 후속 절)
- Modify: `frontend/docs/impl-decision/2026-09-16-adorned-field-double-focus-ring.md` (끝에 후속 절)
- Modify: `frontend/docs/impl-decision/2026-09-16-segmented-hover-pressed.md` ("딸린 것" 절)
- Modify: `frontend/docs/design/design-system.md` (버전 줄 12, §3-3 110–117, 308, 428–430, §13-1 표 465)
- Modify: `frontend/docs/plan/m2-design-tokens.md` (§6-4 947–969, 표 9번 1811)
- Modify: `frontend/docs/decision/frontend-decisions.md:1309`
- Modify: `frontend/docs/plan/prev-todo-m3.md`

과거 기록은 지우지 않는다. 당시 판단은 남기고 "무엇이 그 뒤를 이었는지"를 덧붙인다 (문서의 주 목적은 개발 기록이다).

- [ ] **Step 1: 2026-09-16 결정 기록 세 개에 후속을 단다**

`2026-09-16-focus-ring-not-ink.md` 의 상태 줄을:

```markdown
- 상태: 절반만 결정 — `outline` 배제는 확정, **대체 표현은 미정**
```

에서 이것으로 바꾼다:

```markdown
- 상태: 개정됨 (2026-09-23) — `2026-09-23-focus-outline-over-border.md` 가 이었다
```

파일 끝에 추가한다:

```markdown
## 그 뒤 (2026-09-23)

outline 을 되살렸다. 두 겹은 outline 이 아니라 `offset: 4px` 의 빈틈 때문이었다.
`offset: -1px` 로 기존 테두리 위에 겹쳐 그린다 — `2026-09-23-focus-outline-over-border.md`.
위 후보 중 "테두리를 먹으로"는 고대비 모드에서 사라지고, `box-shadow` 는 그림자 금지와 고대비 모드에 걸려 고르지 않았다.
```

`2026-09-16-adorned-field-double-focus-ring.md` 끝에 추가한다:

```markdown
## 그 뒤 (2026-09-23)

래퍼가 `has-[input:focus-visible]` 로 outline 을 그리고, 안쪽 input 은 `focus-visible:outline-none` 으로 끈다.
`focus-within` 이 아니라 input 한정이라 장식 안 버튼의 포커스와 겹치지 않는다 — `2026-09-23-focus-outline-over-border.md`.
```

`2026-09-16-segmented-hover-pressed.md` 의 "딸린 것 — 포커스 링은 그대로 둔다" 절 끝에 추가한다:

```markdown
2026-09-23 — offset 이 `-1px` 가 되어 링이 항목 안쪽에 그려지므로 이웃을 덮지 않는다. 이 걱정은 닫혔다.
```

- [ ] **Step 2: design-system.md**

- 12행 버전 줄 → `| 버전 | v0.5 (2026-09-23) — 키보드 포커스 확정: 테두리 위에 겹친 outline (§3-3) |`
- §3-3 의 110–117행("**`outline` 링은 쓰지 않기로 했다.**" 부터 "…이 절에 채워야 한다." 까지)을 이것으로 바꾼다:

```markdown
**포커스는 테두리 위에 겹친 `outline`이다.** `:focus-visible { outline: 2px solid #171717; outline-offset: -1px }`.
offset이 음수라 기존 1px 테두리 위에 그려져 선이 두 겹이 되지 않는다 — 겉으로는 테두리가 먹으로 두꺼워진다.
먹 면 컨트롤(주 버튼, 체크된 체크박스)만 면 안쪽 흰 선(`#FFFFFF`, offset `-3px`)이다.
캔버스의 `offset 4px`는 테두리와 링 사이에 틈을 만들어 두 겹으로 보였기 때문에 옮기지 않았다.
근거: `docs/impl-decision/2026-09-23-focus-outline-over-border.md`
```

- 308행 `- 포커스에 \`outline\`을 더하지 않는다 (§3-3)` → `- 포커스 \`outline\`에 양수 offset을 주지 않는다 — 테두리와 틈이 생겨 두 겹이 된다 (§3-3)`
- 428행 `포커스는 §3-3 참고 — **아직 미결이다.**` → `포커스는 §3-3 참고.`
- 430행 체크박스를 `- [x] **모든 인터랙티브에 눈에 보이는 키보드 포커스 표시** — 테두리 위에 겹친 outline (§3-3)` 로 바꾼다
- 465행 §13-1 표의 1번 행 → `| 1 | 키보드 포커스 표시 | **정해졌다 (2026-09-23).** 테두리 위에 겹친 outline, 먹 면만 흰 선. §3-3 |`

- [ ] **Step 3: m2-design-tokens.md**

M2 계획 문서라 본문은 남기고, §6-4 의 "남은 구멍" 인용 블록(963–969행) 바로 아래에 추가한다:

```markdown
> **닫힘 (2026-09-23, #73).** `:focus-visible { outline: 2px solid ink; outline-offset: -1px }` 로 채웠다.
> 먹 면 컨트롤만 흰 선 예외다. `docs/impl-decision/2026-09-23-focus-outline-over-border.md`
```

1811행 표 9번의 마지막 칸 `**M4 화면 작업 전 필수.** …` 를 `**닫힘 (2026-09-23, #73).** \`docs/impl-decision/2026-09-23-focus-outline-over-border.md\`` 로 바꾼다.

- [ ] **Step 4: frontend-decisions.md D-128**

1309행을 이것으로 바꾼다:

```markdown
- 시각 포커스는 `:focus-visible` 의 `outline: 2px solid #171717; outline-offset: -1px` 이다 (2026-09-23, #73). 음수 offset 으로 기존 테두리 위에 겹쳐 그려 선이 두 겹이 되지 않게 한다. 먹 면 컨트롤만 면 안쪽 흰 선이다. 2026-09-16 에 `outline` 을 뺐다가 대체 표현이 없어 SC 2.4.7 이 미충족이던 구멍을 닫았다 — `docs/impl-decision/2026-09-23-focus-outline-over-border.md`. 키보드 이동·포커스 트랩은 그대로 지킨다.
```

- [ ] **Step 5: prev-todo-m3.md**

```markdown
# m3를 진행하기에 앞서 refactor 사항

- [x] focus시 border를 줌으로써 W3C 웹 표준 규격 맞추기 — #73. 테두리 위에 겹친 outline 으로 했다 (`docs/impl-decision/2026-09-23-focus-outline-over-border.md`)
```

- [ ] **Step 6: 남은 "미결" 문구가 없는지 본다**

Run: `cd frontend && grep -rn "SC 2.4.7" docs/ | grep -v "2026-09-16-focus-ring-not-ink.md"`
Expected: "미충족"이 현재형으로 남은 줄이 없다. 남은 줄이 있으면 같은 방식으로 후속을 단다.

Run: `cd frontend && npm run format:check`
Expected: 통과. `docs/` 가 prettier 대상이면 떨어진 파일만 고친다.

- [ ] **Step 7: 커밋**

```bash
git add frontend/docs
git commit -m "docs(frontend): 키보드 포커스 미결 항목을 닫다"
```

### Task 7: 강조색 테두리 컨트롤은 포커스도 강조색 선으로 그린다

Task 1–6 을 브라우저로 본 뒤 사용자가 내린 결정이다 (2026-09-23).
빨간 테두리(`border-accent`)를 가진 컨트롤은 포커스 선도 `accent` 로 그린다. 두께·offset 은 그대로 (`2px`, `-1px`).
먹 선이 덮으면 포커스 중에 "승인이 막힌 칸"이라는 신호가 사라지기 때문이다.

감수한 것: `accent` #FF6969 는 흰 바탕 대비 약 2.8:1 로 SC 1.4.11 의 3:1 에 못 미친다.
테두리 위에 겹치므로 포커스 변화가 빨간 1px → 빨간 2px 두께뿐이다.

| 컨트롤 | 조건 | 포커스 선 |
|---|---|---|
| TextField (장식 없음) | `error` 또는 `labelTone="required-blocking"` | input 에 `focus-visible:outline-accent` |
| TextField (장식형) | 같음 | 래퍼 `has-[input:focus-visible]:outline-accent`. 안쪽 input 은 계속 `outline-none` |
| Checkbox `invalid` | 미체크 | `focus-visible:outline-accent` |
| Checkbox `invalid` | 체크·중간 상태 | 기존 흰 선 (`data-[state=*]:focus-visible:outline-surface`, `-3px`) |

변경:
- `TextField.tsx` — 포커스 선 색을 `borderColor`·`placeholderColor` 와 같은 자리에서 같은 조건(`error || blocking`)으로 고른다.
  `ADORNED_BOX` 에서 색을 떼어 `ADORNED_FOCUS`(ink)·`ADORNED_FOCUS_ACCENT` 둘 중 하나만 붙인다.
- `Checkbox.tsx` — `BOX_BORDER_INVALID` 에 `focus-visible:outline-accent` 를 더했다.
  체크 상태 변형은 생성 CSS 에서 뒤에 오고 선택자도 더 구체적(0,3,0 대 0,2,0)이라 흰 선이 이긴다.
- 브라우저(DPR 1)에서 error·required-blocking 입력과 `invalid` 미체크 체크박스가 `solid 2px rgb(255, 105, 105) / -1px`,
  체크 후 `solid 2px rgb(255, 255, 255) / -3px`, 보통 입력은 `rgb(23, 23, 23) / -1px` 그대로임을 확인했다.
  갤러리에 장식형 오류 입력이 없어 래퍼 값은 단위 테스트로만 확인했다.

---

## PR

`develop` 대상이라 본문은 짧게 쓴다 — 한 일 / 주요 변경 / 확인 방법. `Closes #73`.
확인 방법에는 Task 5 의 계산값 표와 스크린샷을 붙인다.
