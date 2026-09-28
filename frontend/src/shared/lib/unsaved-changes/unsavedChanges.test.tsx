import { renderHook } from '@testing-library/react'
import {
  cancelLeave,
  clearUnsavedChanges,
  confirmLeave,
  guardLeave,
  hasUnsavedChanges,
  useUnsavedChangesStore,
} from './store'
import { useUnsavedChanges } from './useUnsavedChanges'

describe('useUnsavedChanges', () => {
  it('dirty 인 동안만 등록한다', () => {
    const { rerender, unmount } = renderHook(({ dirty }) => useUnsavedChanges(dirty), {
      initialProps: { dirty: false },
    })
    expect(hasUnsavedChanges()).toBe(false)

    rerender({ dirty: true })
    expect(hasUnsavedChanges()).toBe(true)

    rerender({ dirty: false })
    expect(hasUnsavedChanges()).toBe(false)

    rerender({ dirty: true })
    unmount()
    expect(hasUnsavedChanges()).toBe(false)
  })

  it('release 는 다음 렌더를 기다리지 않고 바로 푼다', () => {
    const { result } = renderHook(() => useUnsavedChanges(true))
    expect(hasUnsavedChanges()).toBe(true)

    result.current.release()
    expect(hasUnsavedChanges()).toBe(false)
  })

  it('여러 곳이 등록하면 하나라도 남아 있는 동안 dirty 다', () => {
    const first = renderHook(() => useUnsavedChanges(true))
    const second = renderHook(() => useUnsavedChanges(true))
    expect(useUnsavedChangesStore.getState().sources.size).toBe(2)

    first.unmount()
    expect(hasUnsavedChanges()).toBe(true)

    second.unmount()
    expect(hasUnsavedChanges()).toBe(false)
  })
})

describe('이동 관문 (guardLeave)', () => {
  const pending = () => useUnsavedChangesStore.getState().pendingLeave

  it('변경이 없으면 이동을 바로 실행하고 저장하지 않는다', () => {
    const leave = vi.fn()
    guardLeave(leave)
    expect(leave).toHaveBeenCalledTimes(1)
    expect(pending()).toBeNull()
  })

  it('변경이 있으면 실행하지 않고 저장해 둔다 — 모달이 열리는 조건이다', () => {
    useUnsavedChangesStore.getState().mark('draft')
    const leave = vi.fn()
    guardLeave(leave)
    expect(leave).not.toHaveBeenCalled()
    expect(pending()).toBe(leave)
  })

  it('나가기를 고르면 저장해 둔 이동을 한 번만 실행한다', () => {
    useUnsavedChangesStore.getState().mark('draft')
    const leave = vi.fn()
    guardLeave(leave)

    confirmLeave()
    confirmLeave()
    expect(leave).toHaveBeenCalledTimes(1)
    expect(pending()).toBeNull()
  })

  it('취소하면 저장해 둔 이동을 버린다', () => {
    useUnsavedChangesStore.getState().mark('draft')
    const leave = vi.fn()
    guardLeave(leave)

    cancelLeave()
    confirmLeave()
    expect(leave).not.toHaveBeenCalled()
    expect(pending()).toBeNull()
  })

  it('모두 풀기는 등록과 저장해 둔 이동을 함께 비운다 — 세션 만료', () => {
    useUnsavedChangesStore.getState().mark('draft')
    guardLeave(vi.fn())

    clearUnsavedChanges()
    expect(hasUnsavedChanges()).toBe(false)
    expect(pending()).toBeNull()
  })
})
