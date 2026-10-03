/*
 * 랜딩 화면이 함께 쓰는 클래스. 값은 Landing 캔버스 실측이다.
 * 토큰 스케일 밖의 글자·간격(60/36/26/24/15px, 88·118·132px 등)은 임의값으로 그 자리에 쓴다 —
 * docs/impl-decision/2026-09-16-values-outside-token-scale.md, 2026-09-28-landing-scope.md
 */

/** 링크를 버튼 모양으로. Button 은 <button> 만 그려서 이동(링크)에는 쓰지 못한다 — 같은 면·글자 토큰을 쓴다 */
const PILL_LINK =
  'inline-flex items-center justify-center whitespace-nowrap rounded-999 font-semibold'

export const LINK_PRIMARY = `${PILL_LINK} bg-ink text-surface hover:bg-dim hover:text-surface active:bg-sub`

export const LINK_SECONDARY = `${PILL_LINK} bg-control text-ink hover:bg-line-strong active:bg-inactive`

/** 헤더 크기 — Button 의 landing-nav 와 같다 */
export const NAV_SIZE = 'h-[38px] px-18 text-[15px] leading-none'

/** 히어로·마지막 CTA 크기 — Button 의 landing-hero 와 같다 */
export const HERO_SIZE = 'h-44 px-24 text-landing leading-none'

/** 섹션 제목 36/40 · 600 */
export const SECTION_TITLE = 'text-[36px] leading-[40px] font-semibold tracking-h3 text-ink'

/** 섹션 설명 18/29 */
export const SECTION_LEAD = 'text-lead leading-[29px] text-dim'

/** 1200px 카드 폭. 좁은 창에서는 양옆 40px 을 남기고 줄어든다 */
export const CARD_WIDTH = 'w-full max-w-landing-card'

/** 1024px 글 폭 */
export const TEXT_WIDTH = 'w-full max-w-landing-text'
