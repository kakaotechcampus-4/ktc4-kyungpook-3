/* Team 캔버스 실측. 14.5px · 11.5px · 10.5px 은 토큰 밖 실측값이다 (docs/impl-decision/2026-09-16-values-outside-token-scale.md) */
export const SIDE_CARD = 'flex flex-col rounded-16 border bg-surface px-20 py-18'
export const SIDE_TITLE = 'text-body font-semibold text-ink'
export const BADGE =
  'inline-flex h-22 shrink-0 items-center gap-5 rounded-6 px-9 text-meta leading-none font-semibold'
export const BADGE_DOT = 'mr-3 h-5 w-5 shrink-0 rounded-999 bg-current'
export const SMALL_BUTTON =
  'inline-flex h-28 shrink-0 items-center rounded-7 border border-line-strong bg-surface-sunken px-10 text-[12px] text-ink hover:bg-control'
export const LINK_BUTTON =
  'inline-flex h-32 min-h-[36px] items-center self-start rounded-9 bg-control px-13 text-caption font-semibold text-ink hover:bg-line-strong'

/* 팀원 영역의 머리 줄·맡은 일 줄. 팀원 목록과 그 뼈대가 같이 쓴다 */
export const HEAD = 'flex items-center gap-12 border-b border-line py-14'
export const ROW =
  'flex items-center gap-16 border-b border-line py-13 last:border-b-0 max-md:gap-10'
