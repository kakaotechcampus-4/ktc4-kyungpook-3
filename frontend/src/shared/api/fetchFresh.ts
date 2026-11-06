import { CancelledError, hashKey } from '@tanstack/react-query'
import type { FetchQueryOptions, QueryClient, QueryKey } from '@tanstack/react-query'
import { CLIENT_ERROR_CODES, createClientError } from './errors'
import { captureSessionScope } from './sessionScope'

/**
 * 판정 한 번에 공유 조회를 묻는 최대 횟수. 다시 묻는 것은 묻는 사이 그 조회가 취소돼 이전 값이 돌아왔을 때뿐이다.
 * 취소는 그 조회를 구독하던 **마지막** 화면이 내려갈 때 일어난다 — StrictMode 의 시험 재마운트 한 번, 사용자가 그 화면을
 * 떠나는 것 한 번이면 두 번이다. 세 번째도 취소되면 확인하지 못한 것으로 보고 끝낸다(호출자의 「확인 못 함」 경로).
 * 같은 판정이 서버를 끝없이 두드리지 않는다
 */
export const FRESH_ATTEMPTS = 3

const canceled = () => createClientError(CLIENT_ERROR_CODES.REQUEST_CANCELED)

/**
 * 「판정을 시작한 뒤의 서버 상태」가 꼭 필요한 판정의 조회. 처리 추적기의 끊김 판정·업로드 응답 유실 복구·
 * Notion 복귀 확인이 쓴다. 따로 요청을 보내 캐시에 쓰지 않는다 — 같은 key 의 공유 Query 를 `fetchQuery` 로 묻고, 그 Query 가
 * 캐시에 쓴 값으로만 판정한다. 같은 key 의 조회는 한 번에 하나만 날아가고(합치기), 나중에 출발한 조회가 앞 조회를 거둔다
 * (무효화·`refetch` 의 `cancelRefetch`). 그래서 이전 상태의 답이 더 새 답을 덮는 순서가 생기지 않는다.
 *
 * 돌려주는 값은 그 key 의 지금 캐시 값이다 — 화면이 그리는 값과 판정이 같다. 실패는 그대로 던지고,
 * 세션이 끝났으면 취소 오류로 끝낸다.
 */
export async function fetchFresh<TData, TQueryKey extends QueryKey>(
  queryClient: QueryClient,
  options: FetchQueryOptions<TData, Error, TData, TQueryKey>,
): Promise<TData> {
  const session = captureSessionScope()
  const { queryKey } = options
  const hash = hashKey(queryKey)
  const cache = queryClient.getQueryCache()
  // 시작 뒤 이 key 에 조회의 답이 쓰였나. 마지막 구독이 내려가면 TanStack Query 는 진행 중 조회를 취소하고 이전 값을
  // 돌려준다(`cancel({ revert: true })`). 그 되돌림은 `setState`, 손으로 쓴 값은 `manual` 이라 답으로 치지 않는다.
  // `dataUpdatedAt` 으로는 가리지 못한다 — 밀리초 안에 겹치면 같고, 손으로 쓴 값에도 바뀐다
  let answered = false
  const stopWatching = cache.subscribe((event) => {
    if (
      event.type === 'updated' &&
      event.query.queryHash === hash &&
      event.action.type === 'success' &&
      event.action.manual !== true
    )
      answered = true
  })
  try {
    // 시작 전에 출발한 조회(포커스·무효화 재조회)는 그 전 서버 상태를 묻고 있어 합치지 않고 거둔다. 거둔 조회의 늦은 답은
    // 캐시에 닿지 않는다. 시작 뒤에 출발한 조회는 더 새 상태라 거두지 않고 합친다
    const inFlight = cache.find({ queryKey, exact: true })?.state.fetchStatus
    if (inFlight !== undefined && inFlight !== 'idle')
      await queryClient.cancelQueries({ queryKey, exact: true })

    // 세션을 끝내는 코드가 진행 중 조회를 거둔다(`cancelQueries`·`clear`). 끝난 세션에서는 다시 묻지 않는다
    for (let attempt = 1; ; attempt += 1) {
      if (!session.isCurrent()) throw canceled()
      let data: TData
      try {
        data = await queryClient.fetchQuery({ ...options, staleTime: 0 })
      } catch (error) {
        // 처음 받는 조회가 취소되면 되돌릴 값이 없어 취소를 던진다 — 이전 값이 돌아온 것과 같다
        if (!(error instanceof CancelledError)) throw error
        if (!session.isCurrent() || attempt === FRESH_ATTEMPTS) throw canceled()
        continue
      }
      if (!session.isCurrent()) throw canceled()
      if (answered) return queryClient.getQueryData<TData>(queryKey) ?? data
      if (attempt === FRESH_ATTEMPTS) throw canceled()
    }
  } finally {
    stopWatching()
  }
}
