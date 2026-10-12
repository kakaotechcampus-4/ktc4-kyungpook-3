# 클래스 이름을 cn / clsx / tailwind-merge로 붙일 것인가

- 날짜: 2026-09-16
- 상태: 결정

## 고민

shared/ui는 variant마다 클래스가 갈리고, 호출부가 `className`으로 여백을 더한다.
shadcn은 이 자리에 `cn`(`clsx` + `tailwind-merge`)을 둔다. 스펙은 `clsx`를 선택이라고만 했다.

## 고른 길

셋 다 쓰지 않는다. variant/size 표는 모듈 스코프에 두고, 배열 join으로 붙인다.

```ts
;[base, variants[variant], sizes[size], fullWidth ? 'w-full' : undefined, className]
  .filter(Boolean)
  .join(' ')
```

`className`은 `mt-12`·`w-full` 같은 레이아웃만 더한다. `rounded-9`를 `className="rounded-8"`로 덮지 않는다. 반경·색이 다르면 prop을 늘린다.

## 왜

시각은 `variant` / `size` / `tone`이 API다. className으로 덮는 시스템이 아니다.
`tailwind-merge`는 기본 Tailwind 이름표로 충돌을 접는다. `rounded-9`, `text-ink`, `gap-7`(7px)은 그 표와 안 맞는다.
join만 하는 함수를 `cn`이라고 부르면, 뒤에 온 클래스가 이긴다고 착각한다. Tailwind는 HTML 순서가 아니라 생성 CSS 순서가 이긴다.

## 다시 고민할 때

독립 불리언 조건이 표로 못 담길 만큼 많아지면 `clsx`만 재논의한다. 그때도 `cn` / `tailwind-merge`는 따라오지 않는다.
