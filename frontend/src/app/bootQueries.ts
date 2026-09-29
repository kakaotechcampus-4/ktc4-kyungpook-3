import type { QueryClient } from '@tanstack/react-query'
import { sessionQueryOptions } from '@/entities/user'
import { workspaceListQueryOptions } from '@/entities/workspace'

/**
 * 부팅 때 세션과 워크스페이스 목록을 겹쳐서 시작한다. 가드는 이 캐시를 구독만 하고 요청을 새로 만들지 않는다.
 * 업무 데이터는 여기서 시작하지 않는다 — 인증·소속·온보딩·역할을 확인한 화면이 시작한다.
 */
export function startBootQueries(queryClient: QueryClient): void {
  void queryClient.prefetchQuery(sessionQueryOptions())
  void queryClient.prefetchQuery(workspaceListQueryOptions())
}
