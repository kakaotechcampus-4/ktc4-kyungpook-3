import { QueryClient } from '@tanstack/react-query'
import type {
  DefaultError,
  DefaultedQueryObserverOptions,
  Query,
  QueryKey,
  QueryObserverOptions,
} from '@tanstack/react-query'
import { ApiError, isInvalidResponse } from './errors'

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

/**
 * 마지막 조회가 읽을 수 있는 응답이었나. 소켓 신호·새 알림처럼 스스로 다시 받게 하는 무효화는 이것으로 거른다 —
 * `INVALID_RESPONSE` 는 다시 물어도 같은 답이다. 사용자의 다시 시도·쓰기 토스트의 새로고침은 거르지 않는다 (D-184)
 */
export function hasReadableResponse(query: { state: { error: unknown } }): boolean {
  return !isInvalidResponse(query.state.error)
}

function resolve<Q, T>(option: T | ((query: Q) => T), query: Q): T {
  return typeof option === 'function' ? (option as (query: Q) => T)(query) : option
}

/**
 * 모든 조회의 자동 재조회(간격·창 포커스·연결 복귀)를 마지막 조회가 `INVALID_RESPONSE` 인 동안 멈춘다. 조회마다
 * 옵션을 적으면 빠뜨린다(#348 의 meeting·message 리뷰). 조회가 정한 값은 읽을 수 있는 동안 그대로 쓰고, 다시 시도가
 * 성공하면 오류가 지워져 간격도 다시 돈다 (D-184)
 */
class ResponseGuardedQueryClient extends QueryClient {
  override defaultQueryOptions<
    TQueryFnData = unknown,
    TError = DefaultError,
    TData = TQueryFnData,
    TQueryData = TQueryFnData,
    TQueryKey extends QueryKey = QueryKey,
    TPageParam = never,
  >(
    options:
      | QueryObserverOptions<TQueryFnData, TError, TData, TQueryData, TQueryKey, TPageParam>
      | DefaultedQueryObserverOptions<TQueryFnData, TError, TData, TQueryData, TQueryKey>,
  ): DefaultedQueryObserverOptions<TQueryFnData, TError, TData, TQueryData, TQueryKey> {
    const defaulted = super.defaultQueryOptions(options)
    if ('_defaulted' in options && options._defaulted) return defaulted
    const { refetchInterval, refetchOnWindowFocus, refetchOnReconnect } = defaulted
    type Q = Query<TQueryFnData, TError, TQueryData, TQueryKey>
    return {
      ...defaulted,
      refetchInterval: (query: Q) =>
        hasReadableResponse(query) ? resolve(refetchInterval, query) : false,
      refetchOnWindowFocus: (query: Q) =>
        hasReadableResponse(query) ? (resolve(refetchOnWindowFocus, query) ?? true) : false,
      refetchOnReconnect: (query: Q) =>
        hasReadableResponse(query) ? (resolve(refetchOnReconnect, query) ?? true) : false,
    }
  }
}

/** 앱에 하나. 테스트는 테스트마다 새로 만든다 */
export function createQueryClient(): QueryClient {
  return new ResponseGuardedQueryClient({
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
