# 버튼 크기 표의 padding·굵기가 변형마다 갈린다 — 표를 쪼갤 것인가

- 날짜: 2026-09-16
- 상태: 일부 결정, 일부 M4 로 미룸

## 고민

`Button` 은 `size` 하나로 높이·padding·반경·글자를 고른다. 그런데 §7-1 의 크기 표는 **한 칸에 값을 여러 개** 적는다.

| 크기 | 표에 적힌 padding | 표에 적힌 굵기 |
|---|---|---|
| `md` | `0 20px`(primary) / `0 16px`(ghost) | 600 |
| `lg-onboarding` | `0 18px`(primary) / `0 30px`(`다음`) / `0 14px`(텍스트) | 카드 확정 버튼 700 / 하단 `다음` 600 |

즉 `size` 만으로는 못 정한다. `variant` 도 봐야 하고, `lg-onboarding` 은 **variant 로도 못 가른다** —
온보딩 카드 안의 확정 버튼(`만들기`·`연결하기`·`이 보드로 연결`)과 하단 내비의 `다음` 이 둘 다 primary 인데 굵기가 다르다.

## 고른 길

**굵기** — `size === 'lg-onboarding' && variant === 'primary'` 면 700, 나머지는 전부 600.

```ts
const weight = size === 'lg-onboarding' && variant === 'primary' ? 'font-bold' : 'font-semibold'
```

굵기 클래스는 **한 곳에서만** 고른다. `font-semibold` 를 기본에 깔고 `font-bold` 를 덧붙이면
생성 CSS 순서가 이기므로 어느 쪽이 나올지 코드를 봐선 알 수 없다.

**padding** — 크기마다 하나만 고른다. `md` 는 `px-20`, `lg-onboarding` 은 `px-18` (둘 다 primary 실측값).

## 남은 것 — 하단 내비 `다음` 은 아직 못 그린다

이 결정대로면 온보딩 하단 내비의 `다음` 이 **600 이어야 하는데 700 으로, `0 30px` 이어야 하는데 `px-18` 로** 나온다.

지금 API 로는 못 고친다. `className` 은 레이아웃만 더하는 자리라
`className="px-30 font-semibold"` 로 덮는 것은 `no-cn-clsx-tailwind-merge` 의 규칙을 정면으로 어긴다.

**M4 에서 온보딩 4화면을 실제로 그릴 때 정한다.** 그때 후보:

- A — `size="lg-onboarding-next"` 를 크기 표에 하나 더 넣는다 (600 / `px-30`)
- B — `emphasis?: 'confirm'` 같은 prop 을 만들어 굵기·padding 을 같이 옮긴다
- C — 시안을 다시 재서 `다음` 도 700 인지 확인한다 (실측 재검증)

**C 를 먼저 한다.** 700/600 이 갈린다는 근거가 §7-1 의 주석 한 줄뿐이라, 화면을 띄워 보면 A·B 가 아예 필요 없을 수 있다.

## 곁가지 — 선 토큰을 면으로 쓴다

hover·pressed 면 색이 선 토큰과 겹친다. `#E8E8E8` 은 `--color-line`, `#DCDCDC` 는 `--color-inactive` 다.

```
default: hover:bg-line active:bg-inactive
ghost:   hover:bg-control active:bg-line
```

`bg-line` 이 어색하게 읽히지만 **새 색을 만들지 않는다**는 쪽을 골랐다.
16색 표가 전부이고 §7-1 이 요구하는 hex 가 그 표 안에 이미 있으므로, 이름이 안 맞는다고 색을 늘리지는 않는다.

그리고 `primary` 의 hover/pressed 는 §7-1 이 **제안**으로 표시한 값이다(`bg-sub`).
`#000000` 도 `opacity` 도 쓰지 않았다. §7-1 의 지시대로 **M4 에서 실물을 보고 확정한다.**
