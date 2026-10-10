import type { QueryClient } from '@tanstack/react-query'
import { clearTrackedMeetings } from '@/entities/meeting'
import { advanceSessionGeneration } from '@/entities/user'
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
  // 로그인 이동은 여기서 하지 않는다. 세션이 null 이 되면 RequireAuth 한 곳이 한 번 보낸다.
  // 끝난 세션에서 출발한 요청의 401 은 client 가 알리지 않는다 — 재로그인한 새 세션을 끝내지 않는다 (U4 r3 M04)
  const stopListening = onUnauthorized(() => {
    expireSession(queryClient)
  })
  startBootQueries(queryClient)
  return {
    queryClient,
    dispose: () => {
      stopListening()
      // 앱 한 벌의 세션도 끝난다. 버린 앱의 늦은 비동기 작업이 다음 앱(테스트)에 알림을 남기지 않는다
      advanceSessionGeneration()
      // 정리 추적 store 는 모듈과 함께 살아남는다. 앱 한 벌을 버릴 때 함께 비운다
      clearTrackedMeetings()
      queryClient.clear()
    },
  }
}
