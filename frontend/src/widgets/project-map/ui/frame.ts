/* 프로젝트 맵 화면 틀. 시안이 없어 팀 화면(Team)의 여백·제목과 회의록 탭 모양을 따른다 */

export const MAIN =
  'mx-auto flex w-full max-w-shell flex-1 flex-col gap-22 px-48 pt-48 pb-72 max-md:px-20 max-md:pt-12 max-md:pb-32'
export const TITLE = 'text-[28px] leading-[1.25] font-bold tracking-h1 text-ink max-md:text-[24px]'
export const NOTE = 'text-caption text-dim'

/* 본문 | 옆 패널 340px. 휴대폰은 패널이 아래 시트라 한 단이다 */
export const COLUMNS_WITH_PANEL = 'grid grid-cols-[minmax(0px,1fr)_340px] items-start gap-28'

export const SECTION_TITLE = 'text-[14px] leading-[1.75] font-semibold text-ink'
export const BADGE =
  'inline-flex h-[21px] shrink-0 items-center rounded-6 bg-control px-8 text-meta leading-none font-semibold text-sub'
export const ROW_META = 'shrink-0 text-caption text-dim tabular-nums'
