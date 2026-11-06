import type { IntegrationStatus } from '@/entities/integration'

/* Settings 캔버스 `연결` 절의 카드 한 장. Discord·Notion 영역이 같이 쓴다. 안내·오류는 카드 아래에 둔다 */
export const SECTION = 'flex flex-col gap-8'
export const CARD =
  'flex flex-wrap items-center gap-16 rounded-16 border border-line bg-surface px-20 py-18'
export const ICON_BOX =
  'inline-flex h-40 min-h-[42px] w-40 shrink-0 items-center justify-center rounded-9 border border-input-border bg-surface text-sub'
export const BODY = 'flex min-w-[0px] flex-1 flex-col gap-4'
export const TITLE_ROW = 'flex items-center gap-9'
/* 14.5px 은 토큰 밖이다 — 캔버스의 카드 이름 실측 (docs/impl-decision/2026-09-16-values-outside-token-scale.md) */
export const NAME = 'text-[14.5px] font-semibold text-ink focus-visible:outline-none'
export const META = 'text-caption text-dim'
export const META_VALUE = 'text-sub tabular-nums'
/* 11px 배지는 Settings 캔버스 실측이다. 점은 연결됨 먹 · 미연결 점선 회색 · 끊김 강조(위험 배지) */
export const BADGE =
  'inline-flex h-20 items-center gap-5 rounded-6 bg-control px-8 text-[11px] leading-none font-semibold text-sub'
export const DOT: Record<IntegrationStatus, string> = {
  connected: 'h-5 w-5 rounded-999 bg-ink',
  connecting: 'h-5 w-5 rounded-999 bg-dim',
  not_connected: 'h-5 w-5 rounded-999 bg-dashed',
  revoked: 'h-5 w-5 rounded-999 bg-accent-point',
}
export const ACTIONS = 'flex shrink-0 items-center gap-8'
/* 카드 버튼은 캔버스가 `height:34px; min-height:36px` 이다 — 제품 최소 36px(디자인 시스템). 공용 `md-compact` 는 34px 이라 높이만 채운다 */
export const CARD_BUTTON = 'min-h-[36px]'
export const NOTE = 'text-caption text-dim'
