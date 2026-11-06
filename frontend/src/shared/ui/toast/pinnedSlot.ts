import { create } from 'zustand'

/** 독의 아래 가장자리(`bottom-24`). 고정 토스트가 차지하는 높이에 더해 본문 아래 여백을 만든다 */
const DOCK_EDGE = 24

interface PinnedSlotState {
  slot: HTMLElement | null
  /** 고정 토스트가 있는 동안 본문이 아래에 비워 둘 높이(px). 없으면 0 */
  reserve: number
}

/* GlobalToaster 독의 맨 아래 칸. 독이 그려질 때 칸 요소를 적고 내려갈 때 지운다 */
export const usePinnedSlot = create<PinnedSlotState>()(() => ({ slot: null, reserve: 0 }))

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

/** 고정 토스트가 있는 동안 본문 아래에 비워 둘 높이(px, 칸 높이 + 독 가장자리 24). 없으면 0 */
export function usePinnedToastReserve(): number {
  return usePinnedSlot((state) => state.reserve)
}
