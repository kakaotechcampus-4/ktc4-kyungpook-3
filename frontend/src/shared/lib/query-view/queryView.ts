/**
 * 조회 하나를 화면 상태로 읽는다 (E-02). `{data, error}` 만 본다 — `UseQueryResult` 와 `refetchInterval` 콜백의
 * `query.state` 가 둘 다 이 모양이라, 그리는 쪽(`loadable`)과 polling 을 멈추는 쪽이 같은 판정을 쓴다.
 * - `loading`: 데이터도 오류도 아직 없다
 * - `error`: 처음부터 받지 못했다
 * - `ready`: 데이터가 있고 마지막 조회가 성공했다
 * - `refreshFailed`: 데이터는 있으나 마지막 재조회가 실패했다. 기존 데이터를 그대로 보이고 갱신 실패를 알린다.
 *   React Query 의 stale(최신 시간이 지난 정상 상태)과 다른 뜻이라 이름을 따로 둔다
 * Query 의 `error` 는 다음 성공 전까지 남고, 재시도(1회) 중에는 아직 채워지지 않는다
 */
export type QueryView = 'loading' | 'error' | 'ready' | 'refreshFailed'

export function queryView({ data, error }: { data: unknown; error: unknown }): QueryView {
  const failed = error !== null && error !== undefined
  if (data !== undefined) return failed ? 'refreshFailed' : 'ready'
  return failed ? 'error' : 'loading'
}
