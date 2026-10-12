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
 * 「판정을 시작한 뒤의 서버 상태」가 꼭 필요한 판정의 조회 (U4 r4 M06). 처리 추적기의 끊김 판정·업로드 응답 유실 복구·
 * Notion 복귀 확인이 쓴다. 따로 요청을 보내 캐시에 쓰지 않는다 — 같은 key 의 공유 Query 를 `fetchQuery` 로 묻고, 그 Query 가
 * 캐시에 쓴 값으로만 판정한다. 같은 key 의 조회는 한 번에 하나만 날아가고(합치기), 나중에 출발한 조회가 앞 조회를 거둔다
 * (무효화·`refetch` 의 `cancelRefetch`). 그래서 이전 상태의 답이 더 새 답을 덮는 순서가 생기지 않는다 —
 * 3·4회차처럼 직접 요청과 공유 조회 두 길이 같은 캐시에 쓰면 도착 순서마다 구멍이 났다 (U4 r3 M05, r4 M06).
 *
 * 공유 조회에 기대면서 지키는 것:
 *
 * 1. **시작 전에 출발한 조회의 답은 쓰지 않는다** (U4 r3 M05). 시작할 때 이미 진행 중인 조회(설정의 포커스·무효화 재조회)는
 *    그 전 서버 상태를 묻고 있다. 합치지 않고 거둔 뒤(`cancelQueries`) 새로 묻는다. 거둔 조회의 늦은 답은 캐시에 닿지 않는다.
 *    시작 **뒤에** 출발한 조회는 거두지 않는다 — 더 새 상태라 합쳐서 그 답을 쓴다.
 * 2. **취소돼 돌아온 이전 값은 답이 아니다** (U4 r2 M03). 마지막 구독이 내려가면 TanStack Query 는 진행 중 조회를 취소하고,
 *    이전 데이터가 있으면 그것을 돌려준다(`cancel({ revert: true })`). 시작 뒤에 이 key 에 **조회의 답이 쓰였는지**를 캐시 사건으로
 *    보고, 쓰이지 않았으면 같은 세션 안에서 다시 묻는다(최대 `FRESH_ATTEMPTS`). 시각(`dataUpdatedAt`)으로 보지 않는다 — 도착
 *    시각이라 밀리초 안에 겹치면 가리지 못하고, 손으로 쓴 값(`setQueryData`)과 조회의 답을 구별하지 않는다.
 * 3. **끝난 세션의 조회는 부작용이 없다** (U4 r3 M04). 세션을 끝내는 세 곳(로그인·로그아웃의 사용자 범위 정리, 만료, 앱 폐기)이
 *    세대를 올린 뒤 진행 중 조회를 모두 거두고(`cancelQueries`·`clear`) 그 signal 이 요청을 끊는다. 여기서는 묻기 전·답을 받은 뒤
 *    세대를 확인해, 끝났으면 다시 묻지 않고 취소 오류로 끝낸다. 401 의 만료 알림은 `request` 가 출발 세대로 거른다(sessionScope).
 *
 * 돌려주는 값은 그 key 의 지금 캐시 값이다 — 화면이 그리는 값과 판정이 같다. 실패는 그대로 던진다.
 */
export async function fetchFresh<TData, TQueryKey extends QueryKey>(
  queryClient: QueryClient,
  options: FetchQueryOptions<TData, Error, TData, TQueryKey>,
): Promise<TData> {
  const session = captureSessionScope()
  const { queryKey } = options
  const hash = hashKey(queryKey)
  const cache = queryClient.getQueryCache()
  // 시작 뒤 이 key 에 조회의 답이 쓰였나. 취소의 되돌림은 `setState`, 손으로 쓴 값은 `manual` 이라 치지 않는다
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
    const inFlight = cache.find({ queryKey, exact: true })?.state.fetchStatus
    if (inFlight !== undefined && inFlight !== 'idle')
      await queryClient.cancelQueries({ queryKey, exact: true })

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
