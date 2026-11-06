import { useEffectEvent, useLayoutEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { PINNED_STACK, claimPinnedHost } from './pinnedSlot'

export interface PinnedToastHostProps {
  /** 자리의 위치. 화면이 정한다 */
  className?: string
  style?: CSSProperties
  /** 자리의 높이(px)가 바뀔 때. 고정 토스트가 없으면 0 이다 — 화면이 본문 끝에 토스트만큼 여백을 둔다 */
  onHeightChange?: (height: number) => void
}

/**
 * 고정 토스트(PinnedToast)를 독 대신 화면 안에 그릴 자리 (#474). 올라와 있는 동안 고정 토스트가 여기로 온다.
 * 빈 자리는 누름을 통과시킨다 — 누름은 토스트 면이 직접 켠다
 */
export function PinnedToastHost({ className = '', style, onHeightChange }: PinnedToastHostProps) {
  const [host, setHost] = useState<HTMLDivElement | null>(null)
  const reportHeight = useEffectEvent((height: number) => onHeightChange?.(height))
  // 그리기 전에 자리를 잡는다 — 토스트가 독에 한 번 보였다가 옮겨 가지 않는다
  useLayoutEffect(() => {
    if (host === null) return
    const release = claimPinnedHost(host)
    if (typeof ResizeObserver === 'undefined') return release
    const observer = new ResizeObserver(() => reportHeight(host.getBoundingClientRect().height))
    observer.observe(host)
    return () => {
      observer.disconnect()
      release()
    }
  }, [host])
  return (
    <div
      data-testid="pinned-toast-host"
      ref={setHost}
      className={`${PINNED_STACK} pointer-events-none ${className}`}
      style={style}
    />
  )
}
