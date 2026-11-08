/* 확인 요청 틀. 화면(ApprovalReview)과 뼈대(ApprovalSkeleton · 라우트 뼈대)가 같이 쓴다 (#510) */

/* 본문 폭은 리스트·보드와 같은 960 컨테이너다(본문 864, #466). 좁은 화면은 좌우 16 */
export const ROOT = 'mx-auto flex w-full max-w-[960px] flex-col gap-22 px-16 pt-40 pb-72 sm:px-48'
export const BACK =
  'inline-flex min-h-32 items-center gap-4 self-start text-[13px] font-semibold text-sub hover:text-ink'
export const CARD = 'flex flex-col overflow-hidden rounded-16 border border-line bg-surface'
export const CARD_BODY = 'flex flex-col gap-16 p-20'
export const CARD_FOOT = 'flex flex-col gap-12 border-t border-divider px-20 py-14'
export const EVIDENCE = 'flex flex-col gap-8 rounded-12 bg-surface-sunken px-18 py-16'
