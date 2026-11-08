import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { holdSplash } from '@/shared/lib/splash'
import { useLoadingIndicator, type LoadingIndicator } from './useLoadingIndicator'

/**
 * 가짜 시계를 1ms 씩 흘린다. act 하나로 크게 흘리면 그 안에서 걸린 effect 의 타이머가 act 가 끝난 뒤에야 걸린다 —
 * 브라우저에서는 커밋 직후 effect 가 돌아 타이머가 바로 걸린다
 */
function tick(ms: number) {
  for (let step = 0; step < ms; step += 1)
    act(() => {
      vi.advanceTimersByTime(1)
    })
}

/** 로딩을 `responseMs` 동안 켰다 끄고, 렌더마다 결과를 시각과 함께 남긴다 */
function respondAfter(responseMs: number) {
  const seen: { at: number; value: LoadingIndicator }[] = []
  const start = Date.now()
  const hook = renderHook(
    ({ loading }: { loading: boolean }) => {
      const value = useLoadingIndicator(loading)
      seen.push({ at: Date.now() - start, value })
      return value
    },
    { initialProps: { loading: true } },
  )
  tick(responseMs)
  hook.rerender({ loading: false })
  return { hook, seen, elapsed: () => Date.now() - start }
}

/** 지금부터 `ms` 를 1ms 씩 흘리며 스켈레톤이 처음 사라진 시각을 찾는다 */
function hiddenAt(
  hook: { result: { current: LoadingIndicator } },
  elapsed: () => number,
  ms: number,
) {
  for (let step = 0; step < ms; step += 1) {
    if (!hook.result.current.pending) return elapsed()
    tick(1)
  }
  return hook.result.current.pending ? null : elapsed()
}

describe('useLoadingIndicator', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('로딩이 시작되면 바로 pending 이고 스켈레톤은 아직 보이지 않는다(빈 자리)', () => {
    const { result } = renderHook(() => useLoadingIndicator(true))
    expect(result.current).toEqual({ pending: true, skeletonVisible: false, reveal: false })
  })

  it('150ms 응답은 스켈레톤을 한 번도 보이지 않고 바로 내용이다', () => {
    const { hook, seen } = respondAfter(150)
    tick(1000)
    expect(seen.filter(({ value }) => value.skeletonVisible)).toHaveLength(0)
    expect(hook.result.current).toEqual({ pending: false, skeletonVisible: false, reveal: true })
  })

  it('250ms 응답은 200ms 에 스켈레톤이 보이고 600ms 에 사라진다', () => {
    const seen: { at: number; visible: boolean }[] = []
    const start = Date.now()
    const hook = renderHook(
      ({ loading }: { loading: boolean }) => {
        const value = useLoadingIndicator(loading)
        seen.push({ at: Date.now() - start, visible: value.skeletonVisible })
        return value
      },
      { initialProps: { loading: true } },
    )
    tick(199)
    expect(hook.result.current.skeletonVisible).toBe(false)
    tick(1)
    expect(hook.result.current.skeletonVisible).toBe(true)
    expect(seen.find(({ visible }) => visible)?.at).toBe(200)

    tick(50)
    hook.rerender({ loading: false })
    // 데이터가 와도 최소 표시 동안은 스켈레톤을 붙잡는다
    expect(hook.result.current).toMatchObject({ pending: true, skeletonVisible: true })
    expect(hiddenAt(hook, () => Date.now() - start, 1000)).toBe(600)
    expect(hook.result.current).toEqual({ pending: false, skeletonVisible: false, reveal: true })
  })

  it('1초 응답은 1초에 사라진다 — 최소 표시를 이미 넘겼다', () => {
    const { hook, elapsed } = respondAfter(1000)
    expect(hiddenAt(hook, elapsed, 100)).toBe(1000)
  })

  it('처음부터 데이터가 있으면 pending 도 전환도 없다', () => {
    const { result } = renderHook(() => useLoadingIndicator(false))
    tick(1000)
    expect(result.current).toEqual({ pending: false, skeletonVisible: false, reveal: false })
  })

  it('붙잡는 동안 다시 로딩되면 스켈레톤을 그대로 두고, 끝나면 처음 보인 때부터 잰 최소 시간에 사라진다', () => {
    const start = Date.now()
    const hook = renderHook(({ loading }: { loading: boolean }) => useLoadingIndicator(loading), {
      initialProps: { loading: true },
    })
    tick(250)
    hook.rerender({ loading: false })
    tick(100)
    hook.rerender({ loading: true })
    tick(100)
    expect(hook.result.current.skeletonVisible).toBe(true)
    hook.rerender({ loading: false })
    expect(hiddenAt(hook, () => Date.now() - start, 1000)).toBe(600)
  })

  it('지연 안에 끝났다가 다시 로딩되면 지연을 처음부터 다시 잰다', () => {
    const hook = renderHook(({ loading }: { loading: boolean }) => useLoadingIndicator(loading), {
      initialProps: { loading: true },
    })
    tick(150)
    hook.rerender({ loading: false })
    hook.rerender({ loading: true })
    tick(150)
    expect(hook.result.current.skeletonVisible).toBe(false)
    tick(50)
    expect(hook.result.current.skeletonVisible).toBe(true)
  })

  it('라우트 뼈대가 그려진 채 로딩으로 시작하면 지연 없이 스켈레톤을 이어받고, 그때부터 최소 시간을 둔다', () => {
    const release = holdSplash()
    const hook = renderHook(({ loading }: { loading: boolean }) => useLoadingIndicator(loading), {
      initialProps: { loading: true },
    })
    release()
    expect(hook.result.current).toEqual({ pending: true, skeletonVisible: true, reveal: false })
    tick(100)
    hook.rerender({ loading: false })
    expect(hook.result.current.skeletonVisible).toBe(true)
    tick(299)
    expect(hook.result.current.pending).toBe(true)
    tick(1)
    expect(hook.result.current).toEqual({ pending: false, skeletonVisible: false, reveal: true })
  })

  it('라우트 뼈대가 있어도 데이터가 이미 있으면 이어받지 않는다', () => {
    const release = holdSplash()
    const { result } = renderHook(() => useLoadingIndicator(false))
    release()
    expect(result.current).toEqual({ pending: false, skeletonVisible: false, reveal: false })
  })
})
