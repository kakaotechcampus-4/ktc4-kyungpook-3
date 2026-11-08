/* 팀 화면 틀. 화면(TeamOverview)과 라우트 뼈대(TeamOverviewSkeleton)가 같이 쓴다 (#510) */

/* Team 시안 — main 패딩 48/48/72, 블록 사이 22px, 본문은 `1fr | 336px` 두 단(간격 100px).
   폭 768px 미만은 시안이 없어 대시보드(H-2)의 여백으로 한 단에 쌓는다 */
export const MAIN =
  'mx-auto flex w-full max-w-shell flex-1 flex-col gap-22 px-48 pt-48 pb-72 max-md:px-20 max-md:pt-12 max-md:pb-32'
export const TITLE = 'text-[28px] leading-[1.25] font-bold tracking-h1 text-ink max-md:text-[24px]'
export const LEAD = 'text-body text-sub'
export const COLUMNS =
  'grid grid-cols-[minmax(0px,1fr)_336px] items-start gap-[100px] max-md:grid-cols-1 max-md:gap-32'
export const HEADER =
  'flex items-end justify-between gap-24 max-md:flex-col max-md:items-start max-md:gap-12'
/** 화면 머리의 안내 — 화면과 뼈대가 같은 글자다 */
export const LEAD_TEXT = '진행률은 팀원이 직접 말한 값입니다. 옆에 적힌 기준 날짜를 함께 보세요.'
