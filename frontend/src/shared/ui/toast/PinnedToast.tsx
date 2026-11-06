import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { usePinnedSlot } from './pinnedSlot'

/**
 * 시간이 지나도 닫히지 않는 토스트를 토스트 자리 맨 아래에 고정한다 (#424). 짧은 토스트는 그 위로 쌓인다.
 * 모양은 호출자가 그린다. 앱에 GlobalToaster 가 없으면 아무것도 그리지 않는다
 */
export function PinnedToast({ children }: { children: ReactNode }) {
  const slot = usePinnedSlot((state) => state.slot)
  return slot === null ? null : createPortal(children, slot)
}
