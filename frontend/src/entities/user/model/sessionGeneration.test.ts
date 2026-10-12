import { advanceSessionGeneration, captureSession } from './sessionGeneration'

describe('세션 세대', () => {
  it('잡아 둔 뒤 세션이 끝나면 그 세대는 더 이상 지금 세션이 아니다', () => {
    const before = captureSession()
    expect(before()).toBe(true)
    advanceSessionGeneration()
    expect(before()).toBe(false)
    // 새 세션에서 잡은 것은 지금 세션이다. 앞 세대는 계속 아니다
    const after = captureSession()
    expect(after()).toBe(true)
    expect(before()).toBe(false)
  })
})
