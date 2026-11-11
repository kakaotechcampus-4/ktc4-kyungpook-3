import type { InboxPane } from '../model/selection'

/* 메시지 화면 틀. 화면(MessageInbox)과 라우트 뼈대(MessageInboxSkeleton)가 같이 쓴다 (#510) */

/* Messages 캔버스 실측 — 왼쪽 목록 308(위 18 · 좌우 12 · 아래 24, 영역 사이 18) · 오른쪽 선, 목록 제목 17px.
   화면 높이를 헤더 아래로 묶고 목록과 상세가 각자 세로로 스크롤한다 (D-124, 계획 C-6 6단계).
   스크롤 칸은 relative 다 — 안의 sr-only 글자(absolute)가 칸 밖 문서 높이를 늘려 페이지가 스크롤되지 않게 한다.
   768 미만(H-4·H-5)은 목록과 상세 중 하나만 화면 전체로 그린다. 목록은 휴대폰 헤더(56 + 위 안전 영역)와 아래 탭 막대 사이,
   상세는 셸 헤더·탭 막대를 걷은 화면 전체다. 셸의 아래 여백(탭 막대)과 더해 바깥 페이지가 스크롤하지 않는다 */
export const SCREEN: Record<InboxPane, string> = {
  both: 'flex h-[calc(100dvh-var(--spacing-header))] items-stretch',
  list: 'flex h-[calc(100dvh-(56px+env(safe-area-inset-top)+var(--bottom-tab-bar)))] items-stretch',
  detail: 'flex h-dvh items-stretch',
}
export const ASIDE: Record<InboxPane, string> = {
  both: 'relative flex w-aside shrink-0 flex-col gap-18 overflow-y-auto border-r border-divider px-12 pt-18 pb-24',
  list: 'relative flex w-full flex-col gap-18 overflow-y-auto pt-8 pr-[max(12px,env(safe-area-inset-right))] pb-24 pl-[max(12px,env(safe-area-inset-left))]',
  detail: '',
}
export const ASIDE_TITLE: Record<InboxPane, string> = {
  both: 'px-8 text-[17px] leading-[1.55] font-bold tracking-h2 text-ink',
  list: 'px-8 text-[24px] leading-[1.4] font-bold tracking-h2 text-ink',
  detail: '',
}
export const DETAIL = 'relative flex min-w-[0px] flex-1 flex-col'

export const COMPOSE_LINK =
  'shrink-0 rounded-9 px-10 py-4 text-caption font-semibold text-sub hover:bg-surface-sunken hover:text-ink aria-[current=page]:bg-surface-selected aria-[current=page]:text-ink max-md:inline-flex max-md:min-h-44 max-md:items-center max-md:px-14 max-md:text-body'

/* 오른쪽 칸의 만들기 화면(새 재촉·새 대화). 보내기 전 확인과 같은 가운데 604 열이다(ReviewDetail) */
export const COMPOSE_PAGE =
  'flex flex-1 justify-center overflow-y-auto px-36 pt-44 pb-56 max-md:px-20 max-md:pt-24 max-md:pb-32'
export const COMPOSE_COLUMN = 'flex w-full max-w-[604px] flex-col gap-24 self-start'
export const COMPOSE_CARD = 'overflow-hidden rounded-16 border border-line bg-surface'
export const COMPOSE_TITLE =
  'text-[28px] leading-[1.25] font-bold tracking-h1 text-ink max-md:text-[24px]'
