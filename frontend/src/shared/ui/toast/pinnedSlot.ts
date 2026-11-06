import { create } from 'zustand'

/** 독의 아래 가장자리(`bottom-24`). 고정 토스트가 차지하는 높이에 더해 본문 아래 여백을 만든다 */
const DOCK_EDGE = 24

/** 고정 토스트를 쌓는 칸. 독의 칸과 화면이 두는 자리(PinnedToastHost)가 같은 모양이다 */
export const PINNED_STACK =
  'flex max-h-[50dvh] flex-col items-end gap-8 overflow-y-auto empty:hidden'

interface PinnedSlotState {
  slot: HTMLElement | null
  /** 화면이 둔 고정 토스트 자리. 있는 동안 고정 토스트는 독 대신 여기에 그린다 */
  host: HTMLElement | null
  /** 고정 토스트가 있는 동안 본문이 아래에 비워 둘 높이(px). 없으면 0 */
  reserve: number
}

/* GlobalToaster 독의 맨 아래 칸. 독이 그려질 때 칸 요소를 적고 내려갈 때 지운다 */
export const usePinnedSlot = create<PinnedSlotState>()(() => ({
  slot: null,
  host: null,
  reserve: 0,
}))

let observer: ResizeObserver | null = null

function measure(slot: HTMLElement): void {
  const height = slot.getBoundingClientRect().height
  const reserve = height > 0 ? Math.ceil(height) + DOCK_EDGE : 0
  if (usePinnedSlot.getState().reserve !== reserve) usePinnedSlot.setState({ reserve })
}

/**
 * 칸 요소를 적고 그 높이를 지켜본다. 고정 토스트가 생기고 접히고 사라질 때마다 본문 아래 여백이 따라간다 —
 * 오른쪽 아래 카드가 본문 끝의 버튼을 덮어도 스크롤로 꺼낼 수 있다 (#424)
 */
export function setPinnedSlot(slot: HTMLElement | null): void {
  observer?.disconnect()
  observer = null
  usePinnedSlot.setState({ slot, reserve: 0 })
  if (slot === null || typeof ResizeObserver === 'undefined') return
  observer = new ResizeObserver(() => measure(slot))
  observer.observe(slot)
  measure(slot)
}

/**
 * 화면이 고정 토스트 자리를 둔다. 돌려준 함수로 내려놓는다 — 그 사이 다른 자리가 올라왔으면 그 자리를 지우지 않는다.
 * 자리가 있는 동안 독의 칸은 비어 높이가 0 이라 셸의 본문 아래 여백(reserve)도 0 이 된다
 */
export function claimPinnedHost(host: HTMLElement): () => void {
  usePinnedSlot.setState({ host })
  return () => {
    if (usePinnedSlot.getState().host === host) usePinnedSlot.setState({ host: null })
  }
}

/** 고정 토스트가 있는 동안 본문 아래에 비워 둘 높이(px, 칸 높이 + 독 가장자리 24). 없으면 0 */
export function usePinnedToastReserve(): number {
  return usePinnedSlot((state) => state.reserve)
}
