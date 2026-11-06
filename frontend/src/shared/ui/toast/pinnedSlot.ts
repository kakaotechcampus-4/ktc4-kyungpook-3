import { create } from 'zustand'

/* GlobalToaster 독의 맨 아래 칸. 독이 그려질 때 칸 요소를 적고 내려갈 때 지운다 */
export const usePinnedSlot = create<{ slot: HTMLElement | null }>()(() => ({ slot: null }))

export function setPinnedSlot(slot: HTMLElement | null): void {
  usePinnedSlot.setState({ slot })
}
