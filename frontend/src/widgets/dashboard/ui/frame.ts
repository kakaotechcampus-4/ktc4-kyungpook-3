import type { SectionSkeletonShape } from './parts'

/* 대시보드 틀. 화면(Dashboard)과 라우트 뼈대(DashboardSkeleton)가 같이 쓴다 (#510) */

/* Main 시안 — main 패딩 48/48/72, 블록 사이 32px, 본문은 `1fr | 360px` 두 단(간격 68px).
   폭 768px 미만은 PwaDashboard 시안(H-2) — 패딩 12/20, 블록 사이 22px, 한 단, 요약은 네 칸 카드다 */
export const MAIN =
  'mx-auto flex w-full max-w-shell flex-1 flex-col gap-32 px-48 pt-48 pb-72 max-md:gap-22 max-md:px-20 max-md:pt-12 max-md:pb-32'
export const HEADER =
  'flex items-end justify-between gap-24 max-md:flex-col max-md:items-start max-md:gap-6'
export const TITLE = 'text-[32px] leading-[1.4] font-bold tracking-h1 text-ink max-md:text-[24px]'
export const LEAD = 'text-body text-sub'
export const TODAY = 'text-caption text-dim tabular-nums'
/* 휴대폰 요약 칸 수는 항목 수(PM 넷, 팀원 셋)를 따른다. 팀원 줄에 빈 칸이 남지 않는다 */
export const SUMMARY =
  'flex flex-wrap items-baseline gap-36 pb-8 max-md:grid max-md:auto-cols-fr max-md:items-stretch max-md:grid-flow-col max-md:gap-8 max-md:pb-[0px]'
export const SUMMARY_ITEM =
  'relative flex items-center gap-5 text-control text-sub max-md:flex-col max-md:items-start max-md:justify-between max-md:gap-2 max-md:rounded-12 max-md:px-10 max-md:pt-10 max-md:pb-12 max-md:text-[11px] max-md:leading-[1.45]'
/* 휴대폰 칸 면. 기한 지남 칸은 지난 일이 있을 때 경고 면이다 (H-2). 두 면 클래스를 같이 붙이면 CSS 순서로 하나가 이겨 하나만 붙인다 */
export const SUMMARY_ITEM_PLAIN = 'max-md:bg-surface-sunken'
export const SUMMARY_ITEM_ALERT = 'max-md:bg-accent-badge max-md:text-accent'
export const SUMMARY_VALUE =
  'text-[20px] leading-none font-semibold text-ink tabular-nums max-md:text-[22px] max-md:leading-[1.3] max-md:font-bold'
/* 링크는 숫자에만 걸고 누르는 자리는 항목 전체로 넓힌다 — dt·dd 를 링크로 감쌀 수 없다.
   밑줄은 긋지 않는다. 올리면 숫자만 옅어지고, 키보드 포커스는 전역 outline 이다 */
export const SUMMARY_LINK = 'hover:text-sub after:absolute after:inset-0'
export const COLUMNS =
  'grid grid-cols-[minmax(0px,1fr)_360px] items-start gap-[68px] max-md:grid-cols-1 max-md:gap-22'
export const SIDE = 'flex flex-col gap-40 max-md:gap-22'

/** 영역 본문 뼈대의 기본 모양 — 한 줄 행 셋 */
export const LINE_SHAPE: SectionSkeletonShape = { rows: 3, kind: 'line' }
