import { closePushPrompt, isPushPromptClosed } from './pushPromptRecord'

beforeEach(() => {
  window.localStorage.clear()
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('알림 띠를 닫은 기록 (#411)', () => {
  it('닫은 계정에만 남는다 — 같은 기기의 다른 계정은 다시 본다', () => {
    closePushPrompt('us_01')
    expect(isPushPromptClosed('us_01')).toBe(true)
    expect(isPushPromptClosed('us_02')).toBe(false)
  })

  it('저장소가 막혀 읽지 못하면 닫지 않은 것으로 본다', () => {
    closePushPrompt('us_01')
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    expect(isPushPromptClosed('us_01')).toBe(false)
  })

  it('저장소가 막혀 쓰지 못해도 던지지 않는다', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })
    expect(() => closePushPrompt('us_01')).not.toThrow()
    expect(isPushPromptClosed('us_01')).toBe(false)
  })
})
