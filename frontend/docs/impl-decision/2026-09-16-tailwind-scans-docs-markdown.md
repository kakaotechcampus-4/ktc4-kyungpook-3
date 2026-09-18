# 산출 CSS 를 grep 해서 클래스가 유효한지 보는 방법이 스스로를 오염시킨다

- 날짜: 2026-09-16
- 상태: 확인 필요 — 고른 길은 적었지만 `@source` 를 아직 안 걸었다

## 고민

`docs/impl-decision/` 의 여러 글이 "이 클래스가 진짜 CSS 를 내는지"를 이렇게 확인한다.

```bash
npm run build
grep -o '[^{}]*border-dashed[^{}]*{[^}]*}' dist/assets/*.css
```

이 방법이 맞는 줄 알았다. **틀렸다.**
Tailwind v4 는 `@source` 를 안 적으면 프로젝트를 훑어 클래스 이름을 줍는데,
그 훑는 범위에 **`docs/**/*.md` 가 들어간다.**
즉 글에 클래스 이름을 적는 순간 그 클래스가 산출 CSS 에 생긴다.
확인하려고 적은 이름이 확인 결과를 만든다.

## 증거 — 넣었다 뺐다 해 봤다

`src/` 어디에도 없는 이름을 `docs/impl-decision/README.md` 에만 적고 빌드했다.

```bash
printf '\n필요하면 `rounded-[77px]` 로 쓴다.\n' >> docs/impl-decision/README.md
npm run build && grep -c '77px' dist/assets/*.css   # → 1

# 되돌리고 다시
npm run build && grep -c '77px' dist/assets/*.css   # → 0
```

지금 빌드에도 이미 두 개가 그렇게 들어와 있다. **둘 다 `src/` 에는 0건이다.**

```css
.rounded-\[28px\]{border-radius:28px}
.border-\(--color-dashed\),.border-\[color\:var\(--color-dashed\)\]{border-color:var(--color-dashed)}
```

- `rounded-[28px]` — 출처는 `docs/plan/m2-design-tokens.md` §5 의 산문 한 줄이다.
  §7-4 가 "반경 28 은 `Card` 에 넣지 않는다"고 적었고 `Card.tsx` 도 안 쓴다. 그런데 CSS 는 나간다.
- `border-[color:var(--color-dashed)]` — 출처는 `docs/impl-decision/2026-09-16-border-dashed-name-collision.md` 본문이다.

**추출기는 구분자를 본다.** 백틱 없이 맨 줄로 `rounded-[77px]` 만 적었을 때는 안 잡혔다.
백틱이나 따옴표로 감싼 순간 잡힌다. 글에서 클래스 이름은 거의 항상 백틱 안에 적으므로, 사실상 전부 잡힌다고 보면 된다.

## 딸린 함정 — 기존 글 한 줄이 이것 때문에 틀렸다

`2026-09-16-border-dashed-name-collision.md` 가 `border-[color:var(--color-dashed)]` 후보를 버리며 이렇게 적는다.

> **`border-[color:var(--color-dashed)]` 를 버린 이유** — 그 후보는 **CSS 가 아예 생성되지 않는다**.
> 위 빌드 산출물에 `border-[color...` 선택자가 0건이다.

**지금 빌드에서는 0건이 아니다.** 위 CSS 그대로 생성된다. v4 는 `[color:var(...)]` 문법을 받는다.

글을 쓸 당시에는 그 이름이 아직 어느 스캔 대상에도 없었으니 0건이 맞았다.
**그 이름을 글에 적는 행위가 0건을 1건으로 바꿨다.** 근거가 근거를 지웠다.

그 글의 *결론*(= `border-dashed` 한 개만 쓴다)은 그대로 살아 있다.
두 규칙이 `border-style` 과 `border-color` 를 따로 낸다는 관찰은 `src/` 에서 온 진짜 근거라 영향받지 않는다.
**버리는 이유만 틀렸다.** 실제 이유는 "한 클래스로 되는데 두 개 쓸 일이 없다"쪽이다.

## 고른 길

1. **클래스 유효성은 산출 CSS grep 으로 판정하지 않는다.**
   `src/` 에 실제로 쓴 뒤 빌드하고, 화면이나 테스트로 본다.
   굳이 CSS 를 보겠다면 **그 이름을 글에 적기 전에** 먼저 본다. 순서가 중요하다.
2. **`@source` 를 명시해 스캔 범위를 `src/` 와 `index.html` 로 좁힌다.**
   `src/app/styles/index.css` 의 `@import 'tailwindcss'` 아래에 붙인다.

   ```css
   @source '../../**/*.{ts,tsx}';
   @source '../../../index.html';
   ```

   이러면 `docs/` 가 빠져서 죽은 CSS 도 같이 사라진다.

**아직 안 걸었다.** 이 글은 검증 단계에서 나왔고 검증은 제품 파일을 고치지 않는다.
`@source` 를 거는 순간 `src/**/*.test.tsx` 를 범위에 넣을지도 같이 정해야 한다 —
테스트에만 있는 클래스도 지금은 전부 산출 CSS 에 들어간다.

## 다시 고민할 때

`@source` 를 걸고 나면 **빌드해서 산출 CSS 크기를 비교한다.** 지금은 20,429 B 다.
줄지 않으면 범위가 안 좁혀진 것이고, 화면이 깨지면 너무 좁힌 것이다.

> 이 글 자체도 같은 함정에 걸려 있다. 위 증거 블록의 `rounded-[77px]` 때문에
> 산출 CSS 가 20,390 B → 20,429 B 로 39 B 늘었다. 증거를 남기려면 그 값을 내야 해서 그냥 뒀다.
> `@source` 를 걸면 이 39 B 도 같이 사라진다. 사라지는지 보는 것이 곧 `@source` 가 걸렸다는 확인이다.
