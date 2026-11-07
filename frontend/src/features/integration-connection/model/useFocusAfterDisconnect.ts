import { useCallback, useEffect, useRef } from 'react'
import type { RefObject } from 'react'

/**
 * 연결을 끊은 뒤 카드 제목으로 포커스를 옮긴다. 확인 창을 연 `연결 끊기` 는 끊기면 카드에서 사라져 창이 포커스를 돌려줄 곳이 없다 —
 * 그대로면 body 로 떨어져 키보드 사용자가 처음부터 다시 찾아와야 한다. 끊기 성공을 알린 뒤 카드가 미연결로 다시 그려지면(창이 닫힌 뒤)
 * 옮긴다. 다른 까닭(다른 탭에서 끊음 등)으로 미연결이 되면 옮기지 않는다. 제목은 `tabIndex={-1}` 이어야 한다
 */
export function useFocusAfterDisconnect(
  headingRef: RefObject<HTMLElement | null>,
  disconnected: boolean,
): () => void {
  const pending = useRef(false)

  useEffect(() => {
    if (!disconnected || !pending.current) return
    pending.current = false
    headingRef.current?.focus()
  }, [disconnected, headingRef])

  return useCallback(() => {
    pending.current = true
  }, [])
}
