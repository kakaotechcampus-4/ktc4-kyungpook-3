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

/* 화면 틀. 화면(SettingsPage)과 라우트 뼈대(SettingsSkeleton)가 같이 쓴다 (#510) */
/* Settings 캔버스 — main 패딩 48/48/72, 안쪽 1000px 에 목차 176px 과 본문(간격 44), 절 사이 40px */
export const MAIN =
  'mx-auto flex w-full max-w-shell flex-1 justify-center px-48 pt-48 pb-72 max-md:px-20 max-md:pt-12 max-md:pb-32'
/* 폭 768 미만은 목차 위 · 절 아래 한 열이다(D-180). 목차는 따라 내려오지 않는다 — 붙어 있으면 절을 가린다 */
export const COLUMNS =
  'flex w-full max-w-column items-start gap-44 max-md:flex-col max-md:items-stretch'
export const ASIDE =
  'sticky top-[34px] flex w-[176px] shrink-0 flex-col gap-16 max-md:static max-md:w-full'
/* 제목은 들어올 때 포커스를 받는 자리다(tabIndex -1). 절 제목과 같이 포커스 표시는 없다 */
export const TITLE =
  'px-10 text-[22px] leading-[1.4] font-bold tracking-h1 text-ink focus-visible:outline-none'
export const CONTENT = 'flex min-w-[0px] flex-1 flex-col gap-40'

/* Settings 캔버스 목차 — 높이 34(최소 36) · 좌우 10 · 13px 600, 지금 절은 선택 면에 먹 글자.
   13px 은 `text-control` 로 쓰지 않는다 — 같은 이름의 색 토큰(`--color-control`)과 겹쳐 Tailwind 가 글자색만 만든다 */
export const NAV_ITEM =
  'flex h-34 min-h-[36px] w-full items-center rounded-9 px-10 text-[13px] leading-none font-semibold text-sub hover:text-ink aria-disabled:hover:text-sub aria-[current=location]:bg-surface-selected aria-[current=location]:text-ink'

/** `연결` 절의 설명 */
export const CONNECTIONS_LEAD =
  '연결을 끊으면 이미 반영한 내용은 그대로 남고, 새 내용만 쓰지 않게 됩니다.'
