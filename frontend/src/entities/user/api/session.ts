import { queryOptions } from '@tanstack/react-query'
import { request } from '@/shared/api/client'
import { ApiError } from '@/shared/api/errors'
import { STALE_TIME } from '@/shared/api/queryClient'
import type { SessionDto } from '@/shared/types/api/auth'
import { toSession } from '../model/mapper'
import type { Session } from '../model/types'

export const SESSION_QUERY_KEY = ['session'] as const

/** 401 은 오류가 아니라 「로그인하지 않았다」는 답이라 null 이다. 네트워크 실패 등은 그대로 던진다 */
export async function fetchSession(signal?: AbortSignal): Promise<Session | null> {
  try {
    return toSession(await request<SessionDto>('/auth/me', { signal }))
  } catch (error) {
    if (error instanceof ApiError && error.kind === 'http' && error.status === 401) return null
    throw error
  }
}

/** 부팅이 시작하고 가드가 구독한다. data 가 null 이면 비로그인이다 */
export function sessionQueryOptions() {
  return queryOptions({
    queryKey: SESSION_QUERY_KEY,
    queryFn: ({ signal }) => fetchSession(signal),
    staleTime: STALE_TIME.long,
  })
}
