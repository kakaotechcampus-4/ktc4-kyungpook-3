/* AuthShell 과 라우트 뼈대(AuthShellSkeleton)가 같은 틀을 쓴다 (#510) */

/* Login·Signup 캔버스 실측. 88px 간격 · 384px 폼 열 · 460px 카드 · 카드 높이 468px ·
   카드 반경 28px(Card 에 없는 인증 화면 일회성 값, m2 §7-4) · 제목 32/38 · 카드 제목 24/32 · 설명 15/24 ·
   캡션 12 는 토큰 스케일 밖이라 그 자리에 임의값으로 쓴다 — docs/impl-decision/2026-09-16-values-outside-token-scale.md */
export const SCREEN =
  'flex min-h-dvh items-center justify-center bg-surface px-16 py-56 text-ink lg:px-48'

export const ROW = 'flex w-full items-center justify-center gap-[88px]'

export const COLUMN = 'flex w-full max-w-[384px] shrink-0 flex-col gap-24'

export const HEADING_ROW = 'flex flex-wrap items-center justify-center gap-16'

export const HEADING = 'mb-2 text-[32px] leading-[38px] font-bold tracking-h3 text-ink'

/* 1024px 에서는 460px 를 다 못 쓴다 — 카드만 줄어든다 */
export const ASIDE =
  'hidden h-[468px] min-w-[0px] flex-[0_1_460px] flex-col items-center justify-center gap-34 rounded-[28px] bg-surface-sunken p-44 text-center lg:flex'

export const ASIDE_TEXT = 'flex flex-col items-center gap-12'

export const ASIDE_TITLE = 'text-[24px] leading-[32px] font-semibold tracking-h3 text-ink'

export const ASIDE_DESCRIPTION = 'max-w-[320px] text-[15px] leading-[24px] text-dim'

export const ASIDE_CAPTION = 'text-[12px] text-dim tabular-nums'
