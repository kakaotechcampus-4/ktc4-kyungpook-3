# 오류 입력의 플레이스홀더 `#FF8989` 를 어떻게 칠할 것인가

- 날짜: 2026-09-16
- 상태: 결정

## 고민

`m2-design-tokens.md` §7-2 의 오류 실측 원문은 플레이스홀더를 `#FF8989` 로 적는다.

```html
<div style="... border-color: #FF6969">
  <span style="color: #FF8989">미지정</span>
```

T1 작업 지시는 "`#FF8989` 는 토큰이 아니다. 토큰을 만들지 말고 고른 길을 적어라"였다.
그런데 `src/app/styles/tokens.css` 를 열어 보면 **이미 있다.**

```css
--color-accent-soft: #ff8989; /* 연한 짝 — 위 입력의 플레이스홀더에만 */
```

지시와 실제 토큰 파일이 어긋났다. 셋 중 하나를 골라야 했다.

1. 지시대로 토큰이 없다고 보고 `placeholder:text-[#FF8989]` 로 하드코딩한다
2. 있는 토큰을 쓴다 — `placeholder:text-accent-soft`
3. 플레이스홀더 색을 바꾸지 않는다 (경계·라벨만 강조색으로)

## 고른 길

**2번.** `placeholder:text-accent-soft` 를 쓴다. **토큰은 하나도 새로 만들지 않았다.**

`TextField` 에서 강조 상태(`error` 또는 `labelTone="required-blocking"`)일 때만 붙는다.
평소에는 `placeholder:text-faint`(`#999999`, §7-2 "placeholder 제안") 이다.

## 왜

지시의 **의도**는 "토큰을 늘리지 마라"였지 "이 색을 하드코딩해라"가 아니다.
T0 가 이미 §5-1 의 16색을 전부 넣으면서 `accent-soft` 를 만들어 두었으므로, 지시의 금지선을 넘지 않고 2번을 고를 수 있다.

1번은 §10-2 의 "토큰 밖 하드코딩 색 0건" 검산에 걸린다. TSX 안의 `#FF8989` 는 그 grep 이 잡으라고 만든 바로 그 대상이다.

3번은 실측을 버리는 것이라 안 된다.

## 곁가지 — 색 클래스를 두 개 붙이지 않는다

`placeholder:text-faint` 와 `placeholder:text-accent-soft` 를 **같이** 붙이면 안 된다.
경계색(`border-input-border` vs `border-accent`), 라벨색(`text-sub` vs `text-accent`) 도 마찬가지다.

Tailwind 는 HTML 의 클래스 순서가 아니라 **생성된 CSS 의 순서**로 이긴다
(`docs/error/2026-09-16-no-cn-clsx-tailwind-merge.md`). 그래서 `Label`·`TextField` 는 색을 **삼항 하나로** 고른다.

```ts
const borderColor = error || blocking ? 'border-accent' : TONE_BORDER[tone]
```

`hover:` · `disabled:` 처럼 **변형이 다르면** 겹쳐도 된다. 변형 유틸이 평소 유틸보다 뒤에 생성되기 때문이다.
같은 변형·같은 속성일 때만 삼항으로 하나를 고른다.

## 다시 고민할 때

`accent-soft` 는 지금 이 한 자리에만 쓴다. 다른 곳에서 "연한 빨강"이 필요해지면
그건 새 쓰임새이므로 `#FF6969` 를 "승인을 막는 입력"에만 쓴다는 §7-2 의 제한부터 다시 읽는다.
