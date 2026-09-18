# Card `default` 의 padding 이 네 개인데 하나만 고를 것인가

- 날짜: 2026-09-16
- 상태: 결정

## 고민

`m2-design-tokens.md` §7-4 의 `Card` 표는 **실측된 padding 을 전부** 적는다.

| 변형 | 표에 적힌 padding | 쓰는 곳 |
|---|---|---|
| `default` | `18px 20px` · `22px` · `16px 18px` · `15px 18px` | 설정 연결 행 · 알림 행 · 업로드 드롭존 |
| `attention` | `28px 30px` | `확인 필요` 태스크 카드 |
| `pending` | `20px 22px` | `보류` 태스크 카드 |
| `onboarding` | `22px 22px 18px` | 온보딩 4화면 본문 카드 |

`attention` · `pending` · `onboarding` 은 값이 하나씩이라 문제가 없다. **`default` 만 넷이다.**

세 갈래가 있었다.

1. `default` 를 네 개로 쪼갠다 — `variant="default"` 에 `density` 같은 두 번째 축을 붙인다.
2. padding 을 컴포넌트에서 빼고 호출부가 `className` 으로 준다.
3. 대표값 하나를 고르고, 다른 세 개는 그 화면을 그릴 때 정한다.

## 고른 길

**3번.** `default` 는 `px-20 py-18` (= `18px 20px`) 하나로 접는다.

```ts
default: 'rounded-16 border border-line px-20 py-18'
```

## 왜

**1번을 안 하는 이유** — `18/22/16+18/15+18` 은 *시각 밀도가 다른 카드*가 아니라 **아직 안 그린 화면 셋**이다.
`Settings` 연결 행과 `Upload` 드롭존은 M4·M5 에서 각자 레이아웃을 갖는다.
지금 축을 하나 늘리면 그 축의 이름(`density`? `compact`?)을 화면을 보기 전에 정해야 한다.

**2번을 안 하는 이유** — `docs/impl-decision/2026-09-16-no-cn-clsx-tailwind-merge.md` 가
"`className` 은 레이아웃만 더한다"로 못을 박았다. padding 을 호출부로 내리면 카드마다 값이 흩어지고,
카드가 카드로 안 보이는 순간이 온다.

**`18px 20px` 을 고른 이유** — 넷 중 유일하게 다른 컴포넌트와 겹친다. `Panel` 의 실측 padding 이
같은 `18px 20px` 이다. 카드 안에 근거 블록을 넣었을 때 두 겹의 안쪽 여백이 어긋나지 않는다.

## 다시 고민할 때

M4·M5 에서 `Settings` · `Upload` 를 실제로 그릴 때, 그 화면이 `px-20 py-18` 로 시안과 어긋나면
그때 두 번째 축을 만든다. 축 이름은 그 화면 둘을 눈으로 본 다음에 정한다.
