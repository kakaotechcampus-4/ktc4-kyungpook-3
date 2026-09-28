import { QueryClient } from '@tanstack/react-query'
import { ApiError } from './errors'

/** D-136. 세션·워크스페이스·팀원·설정·완료 회의록 상세는 `long` */
export const STALE_TIME = { default: 30_000, long: 5 * 60_000 } as const

export const GC_TIME = 5 * 60_000

/** 확정 계획: 1초 뒤 1회. 지수 대기는 쓰지 않는다 */
export const RETRY_DELAY_MS = 1_000

export const MAX_QUERY_RETRIES = 1

/** 네트워크 오류, 408, 5xx 만 다시 요청할 만하다. 취소·잘못된 응답·그 밖의 HTTP·모르는 오류는 아니다 */
export function isRetryableError(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false
  if (error.kind === 'network') return true
  return error.kind === 'http' && (error.status === 408 || error.status >= 500)
}

/** TanStack Query 는 첫 실패에 failureCount 0 을 넘긴다. 그래서 `< 1` 이 「한 번」이다 */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  return failureCount < MAX_QUERY_RETRIES && isRetryableError(error)
}

/** 앱에 하나. 테스트는 테스트마다 새로 만든다 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: STALE_TIME.default,
        gcTime: GC_TIME,
        retry: shouldRetryQuery,
        retryDelay: RETRY_DELAY_MS,
      },
      mutations: { retry: false },
    },
  })
}
