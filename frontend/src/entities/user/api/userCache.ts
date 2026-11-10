import type { QueryClient } from '@tanstack/react-query'
import { SESSION_QUERY_KEY } from './session'

/**
 * 세션이 끝날 때(로그인·가입·로그아웃·만료) 앞 사용자의 캐시를 비운다. 세션 query 는 호출자가 바꾸므로 남긴다.
 * mutation 캐시도 함께 비운다. 쓰기 변수(회의록 고치기 초안 등)는 앞 사용자의 글이고, 고치기 mutation 은 실패 문구를 남기려고
 * 수거되지 않는다(#551, `gcTime: Infinity`). 진행 중이던 쓰기는 세대를 올린 뒤라 그 뒷처리가 이미 무효다(#681)
 */
export function clearUserCache(queryClient: QueryClient): void {
  queryClient.removeQueries({ predicate: ({ queryKey }) => queryKey[0] !== SESSION_QUERY_KEY[0] })
  queryClient.getMutationCache().clear()
}
