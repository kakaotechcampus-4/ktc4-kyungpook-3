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

/* 휴대폰 로그인(H-1, PwaLogin 390×844). 위는 매스와 소개를 남은 높이 가운데에, 폼은 아래에 둔다.
   시안의 위 47·아래 34 는 기기 안전 영역이라 안전 영역과 24px 중 큰 값으로 비킨다.
   22px·88px 매스는 시안 값이고 토큰 스케일 밖이다 */
export const PHONE_SCREEN =
  'flex min-h-dvh flex-col bg-surface pt-[max(24px,env(safe-area-inset-top))] pr-[max(24px,env(safe-area-inset-right))] pb-[max(24px,env(safe-area-inset-bottom))] pl-[max(24px,env(safe-area-inset-left))] text-ink'

export const PHONE_ROW = 'flex flex-1 flex-col'

export const PHONE_COLUMN = 'flex flex-1 flex-col'

export const PHONE_BRAND =
  'flex flex-1 flex-col items-center justify-center gap-14 py-24 text-center'

export const PHONE_HEADING = 'text-[22px] leading-[30px] font-bold tracking-h3 text-ink'

export const PHONE_INTRO = 'text-[14px] leading-[22px] text-sub'

export const PHONE_MASCOT_SIZE = 88

export const PHONE_FORM = 'flex flex-col gap-12'

/* 넓은 화면의 폼 자리. 상자를 만들지 않아 폼 요소가 COLUMN 의 간격을 그대로 받는다 */
export const FORM_SLOT = 'contents'
