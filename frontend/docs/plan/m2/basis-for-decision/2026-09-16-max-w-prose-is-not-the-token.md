# `max-w-prose` 는 `--container-prose` 가 아니다 — 토큰이 조용히 무시된다

- 날짜: 2026-09-16
- 상태: 확인 필요 — 갤러리에서는 피했지만 토큰은 그대로 남아 있다

## 고민

갤러리의 한 칸 폭으로 본문 폭 토큰을 쓰려고 `max-w-prose` 를 붙였다.
`tokens.css` 가 그 이름을 정의한다.

```
--container-*: initial;
--container-prose: 640px;   /* 본문 한 줄 길이 상한 (design-system.md §4-2) */
```

`--container-*` 를 비웠으니 이름 있는 다섯 개만 유틸이 되고, `max-w-prose` 는 640px 여야 한다.
**산출 CSS 는 다르다.**

```bash
npm run build
grep -o '\.max-w-[a-z]*{[^}]*}' dist/assets/*.css
```

```
.max-w-column{max-width:var(--container-column)}
.max-w-full{max-width:100%}
.max-w-prose{max-width:65ch}
.max-w-shell{max-width:var(--container-shell)}
```

`shell` · `column` 은 토큰을 가리키는데 **`prose` 만 65ch 다.**
Tailwind v4 가 `max-w-prose` 를 고정 유틸로 들고 있고, 그쪽이 테마에서 나온 이름을 덮는다.
`--container-*: initial` 도 이 고정 유틸은 못 지운다.

**아무 경고도 없다.** 빌드·타입·린트 전부 통과하고 클래스도 실제로 생긴다. 값만 다른 값이다.
`2026-09-16-values-outside-token-scale.md` 의 "클래스가 아예 없다"와도,
`2026-09-16-unlayered-global-beats-utilities.md` 의 "클래스가 있는데 진다"와도 또 다른 세 번째 경우다.

65ch 는 서체에 따라 달라진다. 나눔스퀘어에서는 640px 근처가 아니다.

## 고른 길

**갤러리에서는 그 이름을 안 쓴다.** 갤러리 칸은 제품 폭이 아니므로 임의값으로 적었다.

```
const COLUMN = 'flex max-w-[420px] flex-col gap-12'
```

`--container-prose` 는 **건드리지 않았다.** `tokens.css` 는 T0 소유이고, 이번 조각은 토큰을 안 고친다.

## 왜 토큰 이름을 안 바꿨나

고치는 길은 이름을 `--container-body` 처럼 Tailwind 고정 유틸과 겹치지 않게 바꾸는 것이다.
그러면 `max-w-body` 가 640px 를 낸다.

**지금 바꾸면 안 되는 이유** — `--container-prose` 를 쓰는 제품 코드가 아직 0곳이다.
쓰는 곳이 생기기 전에 이름을 정하는 편이 맞고, 그 결정은 본문 폭을 실제로 거는 M4 의 일이다.
지금 바꾸면 토큰만 이름이 바뀐 채 아무도 안 쓰는 상태가 하나 더 생긴다.

## 딸린 확인 — 나머지 넷은 괜찮다

`shell` · `column` · `landing-text` · `landing-card` 는 Tailwind 고정 유틸과 이름이 겹치지 않는다.
위 grep 에서 `shell` · `column` 이 `var(--container-...)` 로 나가는 것을 확인했다.
`landing-text` · `landing-card` 는 아직 쓰는 곳이 없어 CSS 가 안 나온다 — 쓰는 순간 같은 방식으로 확인한다.

## 다시 고민할 때

M4 에서 본문 한 줄 길이 상한을 실제로 걸 때 정한다.

1. 이름을 `--container-body` 로 바꾸고 `max-w-body` 를 쓴다, 또는
2. 토큰을 지우고 Tailwind 의 65ch 를 그대로 받는다 (design-system.md §4-2 가 640px 라고 적었으니 이 길은 스펙을 바꾸는 것이다).

**어느 쪽이든 고정 유틸과 이름이 겹치는 토큰이 또 있는지 같이 본다.** `prose` 만 겹치리라는 보장이 없다.
