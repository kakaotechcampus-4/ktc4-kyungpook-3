# Skeleton 의 `@keyframes` 를 어디에 둘 것인가

- 날짜: 2026-09-16
- 상태: 결정

## 고민

§7-11 은 스켈레톤에 `1.6s ease-in-out` 무한, `opacity: 1 → 0.55 → 1` 을 요구한다.
그런데 `tokens.css` 가 **Tailwind 의 기본 애니메이션을 전부 지웠다**.

```css
--animate-*: initial;
```

이 한 줄이 `animate-pulse` · `animate-spin` 을 없애는 동시에 **그 유틸들이 달고 오던 `@keyframes` 도 같이 없앤다.**
Tailwind v4 는 `@theme` 안의 `--animate-*` 가 참조할 때만 keyframes 를 산출물에 넣기 때문이다.

임의값 유틸은 잘 나온다. **keyframes 만 없다.**

```bash
npm run build
grep -o '@media[^{]*prefers-reduced-motion[^{]*{[^@]*' dist/assets/*.css
# @media (prefers-reduced-motion:no-preference){
#   .motion-safe\:animate-\[skeleton-breathe_1\.6s_ease-in-out_infinite\]{
#     animation:1.6s ease-in-out infinite skeleton-breathe}}

grep -o '@keyframes[^{]*' dist/assets/*.css
# 0건 — 이름만 있고 정의가 없어서 아무 일도 안 일어난다
```

세 갈래가 있었다.

1. `tokens.css` 에 `@keyframes` 와 `--animate-skeleton-breathe` 를 넣는다.
2. `src/shared/ui/skeleton/skeleton.css` 에 `@keyframes` 만 두고 `Skeleton.tsx` 가 import 한다.
3. 애니메이션을 포기하고 면만 남긴다.

## 고른 길

**2번.** 컴포넌트 폴더 안에 `skeleton.css` 를 두고, 거기에 `@keyframes skeleton-breathe` **하나만** 적는다.

```
src/shared/ui/skeleton/
  Skeleton.tsx        ← import './skeleton.css'
  Skeleton.test.tsx
  skeleton.css        ← @keyframes 만
  index.ts
```

## 왜

**1번을 안 하는 이유** — `--animate-*: initial` 은 실수가 아니라 의도다. 기본 팔레트·간격을 지운 것과 같은 줄에 있다.
토큰은 "아트보드 22장에서 되풀이되는 값"이고, 이 keyframes 는 **컴포넌트 하나가 쓰는 정의**다.
전역 토큰 층에 올리면 다음 사람이 `animate-skeleton-breathe` 를 아무 데나 가져다 쓴다.

**3번을 안 하는 이유** — design-system.md §8 이 "로딩 = 스켈레톤(형태 유지)"를 규칙으로 못 박았고,
§7-11 이 그 형태를 어떻게 살아 있게 보일지까지 적었다. 정지한 회색 박스는 로딩으로 읽히지 않는다.

**`skeleton.css` 가 토큰 체계를 안 깨는 이유** — 이 파일에는 색도 간격도 없다. 불투명도 두 숫자뿐이다.
면(`bg-surface-selected`) · 반경(`rounded-6` 등) · 시간(`1.6s`)은 전부 `Skeleton.tsx` 의 클래스에 남는다.

## `prefers-reduced-motion` 을 JS 로 안 읽는 이유

`window.matchMedia('(prefers-reduced-motion: reduce)')` 를 구독해서 클래스를 갈아 끼울 수도 있었다. 안 한다.

- CSS `motion-safe:` 는 **규칙 자체가 안 생긴다.** 첫 프레임부터 정지 상태다. JS 는 한 프레임 늦는다.
- 훅이 하나 늘고, 서버 렌더를 붙이는 날 첫 렌더 불일치가 생긴다.
- `global.css` 의 `@media (prefers-reduced-motion: reduce)` 전역 규칙이 이미 두 번째 그물이다.

대신 `vite.config.ts` 가 테스트에서 `css: false` 라, 테스트는 계산된 스타일을 볼 수 없다.
그래서 `Skeleton.test.tsx` 는 **"이 요소에 붙은 animation 유틸이 정확히 하나이고 그 하나가 `motion-safe:` 로 시작한다"**
를 검사한다. 줄이기를 켠 사람에게 걸릴 수 있는 애니메이션이 하나도 없다는 뜻이다.

## 다시 고민할 때

애니메이션이 필요한 컴포넌트가 **셋 이상**이 되면, 그때 `--animate-*` 를 토큰으로 되살릴지 다시 본다.
지금은 스켈레톤 하나다. 마스코트(§8)는 자기 keyframes 를 자기 폴더에 갖는 같은 모양이 될 것 같다.
