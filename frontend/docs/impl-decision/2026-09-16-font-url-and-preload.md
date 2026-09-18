# 폰트 경로와 preload를 어디에 둘 것인가

- 날짜: 2026-09-16
- 상태: 결정

## 고민

스펙 예시는 `@font-face`에 `url('@/shared/...')`를 쓴다. Vite CSS가 `@`를 해석하는지는 불확실했다.
폰트를 빨리 받으려면 `index.html` `<link rel="preload">`와 React `preload()` 중 하나를 고른다.

## 고른 길

`@font-face`의 `url()`은 상대 리터럴 경로다. `@/` 별칭을 넣지 않는다.

```css
src: url('../../shared/styles/fonts/NanumSquare-Regular.woff2') format('woff2');
```

preload는 `index.html`에 Regular·Bold만 둔다. 컴포넌트/`main.tsx`에서 `react-dom` `preload()`를 호출하지 않는다. Light·ExtraBold는 시안에서 안 쓰이므로 preload하지 않는다.

## 왜

번들러는 리터럴 경로만 안전하게 추적한다. 별칭·변수 뒤의 경로는 분석이 넓어진다.
이 앱은 Vite CSR이다. JS가 뜬 뒤의 `preload()`는 HTML 파서가 읽는 `<link>`보다 늦다.

## 다시 고민할 때

웨이트를 더 쓰게 되면 preload 목록을 그때 늘린다. 경로 조립을 동적으로 바꾸지 않는다.
