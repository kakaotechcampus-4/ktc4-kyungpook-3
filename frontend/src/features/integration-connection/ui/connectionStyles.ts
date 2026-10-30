import type { IntegrationStatus } from '@/entities/integration'

/* Settings 캔버스 `연결` 절의 줄 모양. Discord·Notion 영역이 같이 쓴다. `속성 다시 맞추기`·`연결 끊기`·`채널 바꾸기`는 옮기지 않았다 */
export const SECTION = 'flex flex-col gap-14 border-t border-divider pt-24'
/* 17px 은 Settings 캔버스의 절 제목이다 — 모달 제목과 같은 단(docs/impl-decision/2026-09-16-modal-title-17px.md) */
export const HEADING = 'text-[17px] font-bold tracking-h2 text-ink focus-visible:outline-none'
export const LEAD = 'text-body text-sub'
export const ROW = 'flex items-center gap-14 rounded-16 border border-line bg-surface px-18 py-16'
export const ICON_BOX =
  'inline-flex h-40 w-40 shrink-0 items-center justify-center rounded-10 bg-surface-sunken text-sub'
export const NAME = 'text-body font-semibold text-ink'
/* 11px 배지는 Settings 캔버스 실측이다. 점은 연결됨 먹 · 미연결 점선 회색 · 끊김 강조(위험 배지) */
export const BADGE =
  'inline-flex h-20 items-center gap-5 rounded-6 bg-control px-8 text-[11px] leading-none font-semibold text-sub'
export const DOT: Record<IntegrationStatus, string> = {
  connected: 'h-5 w-5 rounded-999 bg-ink',
  connecting: 'h-5 w-5 rounded-999 bg-dim',
  not_connected: 'h-5 w-5 rounded-999 bg-dashed',
  revoked: 'h-5 w-5 rounded-999 bg-accent',
}
export const NOTE = 'text-caption text-dim'
