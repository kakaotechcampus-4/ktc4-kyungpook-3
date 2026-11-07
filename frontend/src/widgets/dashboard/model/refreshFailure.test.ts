import { refreshFailure } from './useDashboardData'
import type { Loadable, RefreshFailure } from './useDashboardData'

/* E-02 후속 — 한 영역이 쓰는 조회들의 갱신 실패를 안내 하나로 묶는다. 판정은 각 Loadable 의 `refreshFailed` 뿐이다 */

function failedRefresh(retrying = false): RefreshFailure & { calls: number } {
  const failure = {
    error: new Error('boom'),
    calls: 0,
    retrying,
    retry: () => {
      failure.calls += 1
    },
  }
  return failure
}

const ready: Loadable<number> = { status: 'ready', data: 1 }

it('갱신 실패가 없으면 undefined 다 — 로딩·처음부터 실패·없는 조회는 갱신 실패가 아니다', () => {
  expect(
    refreshFailure(
      ready,
      { status: 'loading' },
      { status: 'error', error: new Error('x'), retry: () => {} },
      null,
      undefined,
    ),
  ).toBeUndefined()
})

it('하나라도 갱신에 실패하면 안내 하나이고, 다시 시도는 실패한 조회만 모두 부른다', () => {
  const first = failedRefresh()
  const second = failedRefresh()
  const merged = refreshFailure({ status: 'ready', data: 1, refreshFailed: first }, ready, {
    status: 'ready',
    data: 2,
    refreshFailed: second,
  })
  expect(merged?.error).toBe(first.error)
  merged?.retry()
  expect([first.calls, second.calls]).toEqual([1, 1])
})

it('묶인 조회 중 하나라도 다시 받는 중이면 retrying 이다', () => {
  expect(
    refreshFailure(
      { status: 'ready', data: 1, refreshFailed: failedRefresh(false) },
      { status: 'ready', data: 2, refreshFailed: failedRefresh(true) },
    )?.retrying,
  ).toBe(true)
  expect(
    refreshFailure({ status: 'ready', data: 1, refreshFailed: failedRefresh(false) })?.retrying,
  ).toBe(false)
})
