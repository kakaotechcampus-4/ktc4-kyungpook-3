/* Segmented 와 뼈대용 SegmentedFrame 이 같이 쓰는 모양 (#510) */

export type SegmentedSize = 'sm' | 'md'

/* 표는 모듈 스코프에 둔다 — 렌더마다 다시 만들지 않는다.
   근거: m2-design-tokens.md §7-7 (아트보드 5장 실측이 전부 같다) */

export const TRACK = 'inline-flex gap-3 rounded-11 border border-transparent bg-control p-3'

/* `min-h-36` 을 빼면 시안보다 6px 낮아진다 — 인라인 `height`와 `min-height`가 함께 있고
   렌더 높이는 36px 이다 (§7-7). 두 값을 같이 옮긴다. */
export const ITEM =
  'inline-flex min-h-36 items-center justify-center rounded-9 border-0 bg-transparent font-semibold'

export const ITEM_SIZE: Record<SegmentedSize, string> = {
  sm: 'h-30 px-13 text-caption',
  md: 'h-32 px-15 text-control',
}

/* 칸의 색은 고른 상태(data-state)로 정한다 — 기본색(`bg-transparent`·`text-sub`)과 고른 색이 같은 우선순위라
   클래스를 나란히 붙이면 CSS 순서가 이긴다. 상태 선택자가 기본색을 덮는다. 뼈대(SegmentedFrame)도 같은 선택자를 쓴다 (#510).
   두 묶음은 겹치는 속성이 없다 — 한 번에 하나만 붙는다.
   hover 를 미선택에만 거는 이유는 docs/impl-decision/2026-09-16-segmented-hover-pressed.md
   누르는 동안 면은 바뀌지 않는다 — docs/impl-decision/2026-09-23-no-pressed-face-checkbox-segmented.md */
export const ITEM_TONE = {
  default:
    'text-sub data-[state=on]:bg-surface data-[state=on]:text-ink data-[state=off]:hover:text-ink',
  disabled: 'pointer-events-none text-line-strong data-[state=on]:bg-surface',
}
