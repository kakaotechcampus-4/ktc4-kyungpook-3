# 마스코트 좌표를 `translate(120 120)` 안에 둘 것인가, 펼칠 것인가

- 날짜: 2026-09-16
- 상태: 결정

## 고민

`mascot.js` 는 루트 `<g transform="translate(120 120)">` 을 깔고 **몸 중심이 원점인 정규화 좌표**로 그린다.
그래서 `idle` 의 얼굴은 `cx="0" cy="-6.09"` 로 나온다.

그런데 §8-3 의 완료 조건 9개와 아트보드의 정적 SVG 는 **절대 좌표**다.

```html
<!-- Login.dc.html -->
<ellipse cx="120" cy="113.91" rx="65.69" ry="64.01"></ellipse>
<g transform="translate(80.78 30.79) rotate(-22)">
```

원본을 그대로 옮기면 `cx="0"` 이 나오고 9개 숫자가 하나도 안 맞는다.
`translate(120 120)` 을 유지한 채 테스트에서 120을 더해 비교할 수도 있었다.

## 고른 길

**루트 그룹을 없애고 `CENTER = 120` 을 좌표 계산에 녹인다.**

```ts
const innerCx = round(CENTER + current.innerX * R, 2) // 120
const innerCy = round(CENTER + current.innerY * R, 2) // 113.91
```

## 왜

- 검산 방법이 "렌더해서 9개 숫자를 본다"로 못 박혀 있다. 테스트가 좌표계를 되짚어 계산하기 시작하면
  **테스트가 구현을 따라 움직인다.** 아트보드와 글자 그대로 같은 문자열을 비교해야 검산이 검산으로 남는다.
- 정적 SVG 12장과 이 컴포넌트가 같은 좌표계를 쓰면, 나중에 아트보드를 다시 떠서 대조하기 쉽다.

## 대신 바뀐 것 하나

`talking` 의 bounce 는 원본에서 `puppet` 에 `scale(1, 1+b)` 였다. 원점이 몸 중심이라 그것만으로 됐다.
좌표를 펼치면 원점이 viewBox 좌상단이라 **그대로 쓰면 마스코트가 아래로 늘어난다.** 축을 되돌려 끼운다.

```ts
`translate(${CENTER} ${CENTER}) scale(1 ${scaleY}) translate(${-CENTER} ${-CENTER})`
```

숫자는 하나도 안 바뀐다. 축만 제자리로 옮긴 것이다.

## 다시 고민할 때

마스코트를 다른 viewBox 로 쓰는 날. 그때는 `CENTER` 와 `R` 이 같이 움직인다.
