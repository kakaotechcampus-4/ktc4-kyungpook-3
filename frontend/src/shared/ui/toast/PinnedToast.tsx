import { useLayoutEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { usePinnedSlot } from './pinnedSlot'

/**
 * 시간이 지나도 닫히지 않는 토스트를 토스트 자리 맨 아래에 고정한다 (#424). 짧은 토스트는 그 위로 쌓인다.
 * 화면이 자리(PinnedToastHost)를 두었으면 그 자리에 그린다.
 * 모양은 호출자가 그린다. 앱에 GlobalToaster 도 자리도 없으면 아무것도 그리지 않는다
 */
export function PinnedToast({ children }: { children: ReactNode }) {
  const target = usePinnedSlot((state) => state.host ?? state.slot)
  // 포털 대상이 바뀌면 React 는 안을 새로 마운트해 펼침 같은 상태를 잃는다. 대상은 늘 이 칸이고, 칸만 독과 화면 자리 사이로 옮긴다 (#474)
  const [box] = useState(() => {
    const element = document.createElement('div')
    element.style.display = 'contents'
    return element
  })
  useLayoutEffect(() => {
    if (target === null) return
    target.appendChild(box)
    return () => box.remove()
  }, [target, box])
  return target === null ? null : createPortal(children, box)
}
