import { captureSessionScope, endSessionScope } from './sessionScope'

describe('세션 범위', () => {
  it('세션이 끝나면 잡아 둔 범위는 지금 세션이 아니고 그 신호는 취소된다. 새 범위의 신호는 살아 있다 (U4 r3 M04)', () => {
    const before = captureSessionScope()
    expect(before.isCurrent()).toBe(true)
    expect(before.signal.aborted).toBe(false)

    endSessionScope()
    expect(before.isCurrent()).toBe(false)
    expect(before.signal.aborted).toBe(true)

    const after = captureSessionScope()
    expect(after.isCurrent()).toBe(true)
    expect(after.signal.aborted).toBe(false)
  })

  it('취소를 받는 쪽은 이미 바뀐 세대를 본다 — 취소로 떨어진 뒷처리가 지금 세션으로 착각하지 않는다', () => {
    const scope = captureSessionScope()
    let staleSeen: boolean | null = null
    let nextAborted: boolean | null = null
    scope.signal.addEventListener('abort', () => {
      staleSeen = scope.isCurrent()
      nextAborted = captureSessionScope().signal.aborted
    })
    endSessionScope()
    // 취소 알림 안에서도 이전 범위는 끝났고, 새로 잡은 범위는 새 세대의 살아 있는 신호다
    expect(staleSeen).toBe(false)
    expect(nextAborted).toBe(false)
    expect(scope.isCurrent()).toBe(false)
  })
})
