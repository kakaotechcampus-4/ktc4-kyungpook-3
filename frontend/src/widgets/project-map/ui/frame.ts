/* ProjectMap 화면의 본문과 제목 수치. */

export const MAIN =
  'relative mx-auto flex w-full max-w-shell flex-1 flex-col gap-22 px-48 pt-48 pb-[116px] max-md:px-20 max-md:pt-12 max-md:pb-[140px]'
export const TITLE = 'text-[28px] leading-[1.25] font-bold tracking-h1 text-ink max-md:text-[24px]'
export const NOTE = 'text-caption text-dim'
export const MAP_TOOLBAR = 'flex items-stretch justify-between gap-22 max-lg:flex-col'
/* 회의록 탭과 같은 38px · 13.5px 600 · 선택은 먹 밑줄 2px이다. */
export const MAP_TABS = 'flex items-center gap-18'
export const MAP_TAB =
  'inline-flex h-[38px] items-center border-b-2 border-transparent px-3 text-body font-semibold text-sub hover:text-ink aria-selected:border-ink aria-selected:text-ink'
export const GRAPH_FRAME =
  'relative aspect-[8/5] w-full overflow-hidden rounded-16 border border-line bg-surface-sunken'

/* 본문 | 옆 패널 340px. 휴대폰은 패널이 아래 시트라 한 단이다 */
export const COLUMNS_WITH_PANEL = 'grid grid-cols-[minmax(0px,1fr)_340px] items-start gap-28'

export const SECTION_TITLE = 'text-[14px] leading-[1.75] font-semibold text-ink'
export const BADGE =
  'inline-flex h-[21px] shrink-0 items-center rounded-6 bg-control px-8 text-meta leading-none font-semibold text-sub'
export const ROW_META = 'shrink-0 text-caption text-dim tabular-nums'
