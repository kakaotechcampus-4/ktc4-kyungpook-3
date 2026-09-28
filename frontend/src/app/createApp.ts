import type { QueryClient } from '@tanstack/react-query'
import { onUnauthorized } from '@/shared/api/client'
import { createQueryClient } from '@/shared/api/queryClient'
import { startBootQueries } from './bootQueries'
import { expireSession } from './expireSession'

export interface AppInstance {
  queryClient: QueryClient
  /** 테스트가 끝날 때 구독과 캐시를 정리한다 */
  dispose: () => void
}

/**
 * 앱 한 벌. 라우터는 여기서 만들지 않는다 — 브라우저는 BrowserRouter, 테스트는 MemoryRouter 로 감싼다.
 * 세션 만료 구독과 부팅 조회는 둘이 똑같다.
 */
export function createApp(): AppInstance {
  const queryClient = createQueryClient()
  // 로그인 이동은 여기서 하지 않는다. 세션이 null 이 되면 RequireAuth 한 곳이 한 번 보낸다
  const stopListening = onUnauthorized(() => {
    expireSession(queryClient)
  })
  startBootQueries(queryClient)
  return {
    queryClient,
    dispose: () => {
      stopListening()
      queryClient.clear()
    },
  }
}
