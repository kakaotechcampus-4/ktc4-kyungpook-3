/* Settings 캔버스 — 절 사이 40px, 절 안 14px, 절 머리는 제목·설명 아래 1px 선 */
export const SECTION = 'flex scroll-mt-[34px] flex-col gap-14'
export const SECTION_HEAD = 'flex flex-col gap-4 border-b border-line pb-12'
/* 17px 은 Settings 캔버스의 절 제목이다 — 모달 제목과 같은 단(docs/impl-decision/2026-09-16-modal-title-17px.md) */
export const SECTION_TITLE =
  'text-[17px] leading-[1.55] font-bold tracking-h2 text-ink focus-visible:outline-none'
/* 13px · 줄 높이 1.85 는 캔버스 절 설명의 실측이다 */
export const SECTION_LEAD = 'text-[13px] leading-[1.85] text-dim'
/* 선택지·토글 카드. 고른 것만 강조 테두리 한 겹이다 */
export const OPTION_CARD = 'rounded-16 border bg-surface'
export const OPTION_TITLE = 'block text-body font-semibold'
export const OPTION_DESCRIPTION = 'block text-caption'
