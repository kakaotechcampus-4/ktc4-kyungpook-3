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

/* 고른 칸의 면 — Segmented 의 `data-[state=on]` 과 같다 */
export const ITEM_ON = 'bg-surface text-ink'
export const ITEM_OFF = 'text-sub'
