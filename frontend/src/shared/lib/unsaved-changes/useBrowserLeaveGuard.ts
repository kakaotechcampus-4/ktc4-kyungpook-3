import { useEffect, useLayoutEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { guardLeave, hasUnsavedChanges, useUnsavedChangesStore } from './store'

/**
 * 브라우저가 직접 일으키는 이탈을 맡는다. 앱에 하나만 올린다 (UnsavedChangesPrompt).
 * - 뒤로가기·앞으로가기: popstate 에서 보던 주소로 되돌리고 같은 모달을 연다.
 *   `변경 내용 버리고 나가기`를 고르면 그 뒤로가기를 다시 한다.
 * - 새로고침·탭 닫기·주소창 이동: beforeunload — 브라우저 기본 경고
 *
 * 제한: popstate 는 브라우저가 주소를 옮긴 뒤에 온다. 라우터가 먼저 그 이동을 그리면 다음 화면이
 * 한 프레임 보일 수 있다. 줄이려고 capture 로, 라우터보다 먼저 한 번만 건다 (제안서 §6-9).
 */
export function useBrowserLeaveGuard(): void {
  const location = useLocation()
  const navigate = useNavigate()
  const dirty = useUnsavedChangesStore((state) => state.sources.size > 0)

  /** 마지막으로 그린 주소. popstate 가 올 때 브라우저 주소는 이미 바뀌어 있다 */
  const shown = useRef(location)
  /** useNavigate 는 주소가 바뀔 때마다 새 함수다. 리스너를 다시 걸지 않으려고 ref 로 읽는다 */
  const navigateRef = useRef(navigate)
  /** 나가기를 고른 뒤 다시 하는 뒤로가기는 묻지 않는다 */
  const replaying = useRef(false)

  useEffect(() => {
    shown.current = location
    navigateRef.current = navigate
  }, [location, navigate])

  // 자식의 layout effect 는 BrowserRouter 의 기록 구독보다 먼저 돈다. 한 번만 걸어 그 순서를 지킨다
  useLayoutEffect(() => {
    const onPopState = () => {
      if (replaying.current) {
        replaying.current = false
        return
      }
      const from = shown.current
      if (!hasUnsavedChanges() || window.location.pathname === from.pathname) return
      // 보던 주소를 한 칸 다시 쌓아 제자리로 돌린다. 되돌린 자리에서 한 칸 뒤가 사용자가 가려던 곳이다
      void navigateRef.current(from, { state: from.state as unknown })
      guardLeave(() => {
        replaying.current = true
        window.history.back()
      })
    }
    window.addEventListener('popstate', onPopState, { capture: true })
    return () => window.removeEventListener('popstate', onPopState, { capture: true })
  }, [])

  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])
}
