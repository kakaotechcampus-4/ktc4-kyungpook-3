import { useCallback } from 'react'
import { resolvePath, useLocation, useNavigate } from 'react-router'
import type { NavigateOptions, To } from 'react-router'
import { guardLeave } from './store'

export type GuardedNavigate = (to: To, options?: NavigateOptions) => void

/**
 * 코드에서 옮길 때는 useNavigate 대신 이것을 쓴다 (D-138). 앱 안 이동의 관문이다.
 * 저장하지 않은 변경이 있고 경로가 바뀌면 이동하지 않고 저장해 둔 채 모달을 연다.
 * 검색·필터·정렬처럼 검색 파라미터만 바뀌는 이동은 묻지 않는다.
 * 기록 이동(숫자)은 받지 않는다 — 뒤로가기·앞으로가기는 useBrowserLeaveGuard 가 popstate 에서 묻는다.
 * 경로 비교는 지금 주소 기준으로 푼다. M3 의 이동은 모두 절대 경로이거나 검색 파라미터만 바꾼다.
 */
export function useGuardedNavigate(): GuardedNavigate {
  const navigate = useNavigate()
  const { pathname } = useLocation()

  return useCallback(
    (to, options) => {
      const go = () => void navigate(to, options)
      if (resolvePath(to, pathname).pathname === pathname) go()
      else guardLeave(go)
    },
    [navigate, pathname],
  )
}
