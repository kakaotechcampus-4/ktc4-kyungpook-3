import { act, renderHook } from '@testing-library/react'
import { MINUTES_HOLD_MS, MINUTES_SKELETON_MIN_MS, useSelectionTimeline } from './useShownMeeting'

/*
 * 회의를 바꿀 때의 시간 규칙 (UX1, UX1-N03) — 가짜 타이머로 경계 바로 전과 바로 뒤를 본다. 실제 시간 · 페인트는 보지 않는다
 * (실제 Chromium 의 프레임 · 밀리초는 e2e/meeting-skeleton.e2e.ts). 조회와 떼어 낸 규칙이라 요청 · 응답 없이 `settled` 만 바꾼다.
 */

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

interface Props {
  meetingId: string | null
  settled: boolean
  canHold: boolean
}

function setup(initial: Props) {
  return renderHook(
    ({ meetingId, settled, canHold }: Props) => useSelectionTimeline(meetingId, settled, canHold),
    { initialProps: initial },
  )
}

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms)
  })
}

describe('useSelectionTimeline — 들고 있기 (UX1)', () => {
  it('첫 진입은 들고 있지 않고 뼈대를 붙잡지도 않는다', () => {
    const { result } = setup({ meetingId: 'mt_09', settled: false, canHold: true })
    expect(result.current).toEqual({
      shownId: 'mt_09',
      holding: false,
      switched: false,
      keepSkeleton: false,
    })
    advance(MINUTES_HOLD_MS + MINUTES_SKELETON_MIN_MS)
    expect(result.current.keepSkeleton).toBe(false)
  })

  it('상한 바로 전(MINUTES_HOLD_MS − 1)까지 이전 회의를 들고 있고, 그 안에 답이 오면 뼈대 없이 바로 바뀐다', () => {
    const { result, rerender } = setup({ meetingId: 'mt_09', settled: true, canHold: true })
    rerender({ meetingId: 'mt_07', settled: false, canHold: true })
    expect(result.current).toMatchObject({ shownId: 'mt_09', holding: true })

    advance(MINUTES_HOLD_MS - 1)
    expect(result.current).toMatchObject({ shownId: 'mt_09', holding: true })

    rerender({ meetingId: 'mt_07', settled: true, canHold: true })
    expect(result.current).toEqual({
      shownId: 'mt_07',
      holding: false,
      switched: true,
      keepSkeleton: false,
    })
    // 뒤에 타이머가 남아 상태를 바꾸지 않는다
    advance(MINUTES_HOLD_MS + MINUTES_SKELETON_MIN_MS)
    expect(result.current).toMatchObject({ shownId: 'mt_07', keepSkeleton: false })
  })

  it('상한(MINUTES_HOLD_MS)이 되면 고른 회의로 넘어가 뼈대를 그린다 — 이전 회의를 남기지 않는다', () => {
    const { result, rerender } = setup({ meetingId: 'mt_09', settled: true, canHold: true })
    rerender({ meetingId: 'mt_07', settled: false, canHold: true })

    advance(MINUTES_HOLD_MS)
    expect(result.current).toEqual({
      shownId: 'mt_07',
      holding: false,
      switched: true,
      keepSkeleton: true,
    })
  })

  it('회의를 연달아 바꿔도 처음 바꾼 때부터 잰다', () => {
    const { result, rerender } = setup({ meetingId: 'mt_09', settled: true, canHold: true })
    rerender({ meetingId: 'mt_07', settled: false, canHold: true })
    advance(MINUTES_HOLD_MS - 100)
    rerender({ meetingId: 'mt_05', settled: false, canHold: true })
    expect(result.current).toMatchObject({ shownId: 'mt_09', holding: true })

    advance(99)
    expect(result.current).toMatchObject({ shownId: 'mt_09', holding: true })
    advance(1)
    expect(result.current).toMatchObject({ shownId: 'mt_05', holding: false, keepSkeleton: true })
  })

  it('목록 요약이 없으면(canHold 가 아니면) 들고 있지 않고 바로 넘어간다 — 그린 뼈대는 최소 시간을 지킨다', () => {
    const { result, rerender } = setup({ meetingId: 'mt_09', settled: true, canHold: false })
    rerender({ meetingId: 'mt_07', settled: false, canHold: false })
    expect(result.current).toMatchObject({ shownId: 'mt_07', holding: false, keepSkeleton: true })
    rerender({ meetingId: 'mt_07', settled: true, canHold: false })
    expect(result.current.keepSkeleton).toBe(true)
    advance(MINUTES_SKELETON_MIN_MS)
    expect(result.current.keepSkeleton).toBe(false)
  })
})

describe('useSelectionTimeline — 그린 뼈대의 최소 시간 (UX1-N03)', () => {
  /** mt_09 를 보다 mt_07 을 고르고 상한까지 답이 없다 — 뼈대가 막 그려진 순간 */
  function pastHold() {
    const hook = setup({ meetingId: 'mt_09', settled: true, canHold: true })
    hook.rerender({ meetingId: 'mt_07', settled: false, canHold: true })
    advance(MINUTES_HOLD_MS)
    expect(hook.result.current).toMatchObject({ shownId: 'mt_07', keepSkeleton: true })
    return hook
  }

  it('답이 상한을 막 넘겨 와도 뼈대를 MINUTES_SKELETON_MIN_MS 동안 둔다 — 바로 전까지 뼈대, 그때 회의록', () => {
    const { result, rerender } = pastHold()
    // 상한 1ms 뒤 답 — 3회차의 61ms 번쩍임이 나던 자리다
    advance(1)
    rerender({ meetingId: 'mt_07', settled: true, canHold: true })
    expect(result.current.keepSkeleton).toBe(true)

    advance(MINUTES_SKELETON_MIN_MS - 2)
    expect(result.current.keepSkeleton).toBe(true)
    advance(1)
    expect(result.current).toEqual({
      shownId: 'mt_07',
      holding: false,
      switched: true,
      keepSkeleton: false,
    })
  })

  it('답이 최소 시간보다 늦으면 뼈대를 더 늘리지 않는다 — 답이 오는 대로 바뀐다', () => {
    const { result, rerender } = pastHold()
    advance(MINUTES_SKELETON_MIN_MS)
    // 시간은 찼지만 답이 없다 — 화면은 답이 없어 뼈대 그대로이고, 이 규칙은 더 붙잡지 않는다
    expect(result.current.keepSkeleton).toBe(false)
    rerender({ meetingId: 'mt_07', settled: true, canHold: true })
    expect(result.current).toMatchObject({ shownId: 'mt_07', keepSkeleton: false })
  })

  it('뼈대를 두는 동안 다른 회의를 고르면 뼈대 위에서 들고 있다 — 그동안 받은 이전 회의 본문을 처음 보이지 않는다', () => {
    const { result, rerender } = pastHold()
    rerender({ meetingId: 'mt_07', settled: true, canHold: true })
    advance(50)
    rerender({ meetingId: 'mt_05', settled: false, canHold: true })
    // 들고 있는 것은 mt_07 의 뼈대다(본문이 아니다)
    expect(result.current).toMatchObject({ shownId: 'mt_07', holding: true, keepSkeleton: true })

    // 새 회의의 답이 오면 바로 넘어간다 — 그 회의는 뼈대를 거치지 않았다
    rerender({ meetingId: 'mt_05', settled: true, canHold: true })
    expect(result.current).toMatchObject({ shownId: 'mt_05', holding: false, keepSkeleton: false })
  })

  it('뼈대를 두는 동안 고른 회의도 상한까지 답이 없으면 그 회의의 뼈대로 넘어가 최소 시간을 새로 잰다', () => {
    const { result, rerender } = pastHold()
    rerender({ meetingId: 'mt_05', settled: false, canHold: true })
    advance(MINUTES_HOLD_MS)
    expect(result.current).toMatchObject({ shownId: 'mt_05', holding: false, keepSkeleton: true })
    rerender({ meetingId: 'mt_05', settled: true, canHold: true })
    advance(MINUTES_SKELETON_MIN_MS - 1)
    expect(result.current.keepSkeleton).toBe(true)
    advance(1)
    expect(result.current.keepSkeleton).toBe(false)
  })
})
