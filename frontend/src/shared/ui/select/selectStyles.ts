/* Select·Combobox·시트 목록이 함께 쓰는 모양. 동작이 Radix 든 직접 만든 목록이든 같은 data-* 속성을 달아 한 벌의 클래스로 그린다.
   15px · 14px · 11px 는 타이포 스케일 밖이다 — 시안 select-design.html 실측.
   docs/plan/m2/basis-for-decision/2026-09-16-values-outside-token-scale.md */

export const TRIGGER = 'group relative flex w-full items-center rounded-9 border text-left'

export const TRIGGER_SIZE = {
  md: 'min-h-44 pr-40 pl-13 text-[15px]',
  sm: 'min-h-36 pr-34 pl-12 text-[14px]',
} as const

export const CHEVRON = 'absolute top-1/2 flex -translate-y-1/2 group-data-[state=open]:rotate-180'

export const CHEVRON_RIGHT = { md: 'right-14', sm: 'right-11' } as const

/* 경계·글자·포커스 선 색은 한 곳에서만 고른다 — 두 클래스를 같이 붙이면 CSS 순서가 이긴다.
   막힌 칸의 포커스 선은 강조색이다 — 먹 선이 덮으면 포커스 중에 "승인이 막힌 칸"이라는 신호가 사라진다.
   보통 칸은 전역 먹 선을 그대로 쓴다. docs/plan/m2/basis-for-decision/2026-09-23-focus-outline-over-border.md */
export function triggerColor(tone: 'normal' | 'blocking', disabled: boolean) {
  if (disabled) return 'cursor-not-allowed border-line bg-surface-sunken text-faint'
  if (tone === 'blocking')
    return 'cursor-pointer border-accent bg-surface text-ink data-[placeholder]:text-accent focus-visible:outline-accent-point'
  return 'cursor-pointer border-input-border bg-surface text-ink data-[placeholder]:text-dim hover:not-data-[state=open]:border-sub data-[state=open]:border-ink'
}

/** 떠 있는 목록 면 — DropdownMenu 와 같다 (반경 14 · 테두리 한 겹 · 그림자 없음). 최소 폭은 쓰는 쪽이 트리거 폭 변수로 더한다 */
export const PANEL = 'z-100 max-w-[340px] rounded-[14px] border border-line bg-surface p-8 text-ink'

/* 스크롤 버튼 대신 스크롤바를 쓴다. 직접 만든 목록은 relative 여야 줄의 offsetTop 이 목록 기준이 된다 */
export const LIST = 'relative flex flex-col gap-1 outline-none [scrollbar-width:thin]!'

export const LIST_SIZE = {
  menu: 'max-h-[264px] overflow-y-auto',
  sheet: 'min-h-[0px] flex-1 overflow-y-auto',
} as const

/* 줄은 격자다 — 보조줄이 앞 아이콘 아래가 아니라 글자 아래에 선다.
   목록은 높이 상한이 있는 flex 열이라 줄이 줄어들면 두 줄 항목의 글자가 겹친다 — 줄은 줄어들지 않고 목록이 스크롤한다 */
export const ITEM =
  'grid shrink-0 cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-center rounded-10 px-10 py-9 outline-none select-none data-[disabled]:cursor-not-allowed data-[disabled]:text-faint data-[highlighted]:bg-surface-selected data-[state=checked]:font-bold'

/** 시트 줄은 손가락으로 누른다 — 시안 52px */
export const ITEM_SIZE = {
  menu: 'min-h-40 text-[15px]',
  sheet: 'min-h-[52px] text-[16px]',
} as const

export const ITEM_LEADING = 'col-start-1 mr-10 flex flex-none'
export const ITEM_LABEL = 'col-start-2 truncate'
export const ITEM_DESCRIPTION = 'col-start-2 row-start-2 text-caption font-normal text-dim'
export const ITEM_CHECK = 'col-start-3 row-span-2 row-start-1 ml-10 flex'

/** 직접 만든 목록에서 줄을 가운데로 — 시각처럼 긴 목록은 고른 값 위아래가 함께 보여야 고르기 쉽다 */
export function centerInList(list: HTMLElement, item: HTMLElement) {
  list.scrollTop = item.offsetTop - (list.clientHeight - item.offsetHeight) / 2
}
