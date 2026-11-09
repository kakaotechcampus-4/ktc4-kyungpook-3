import type { MockInstance } from 'vitest'
import { displayValue, fallbackValue, isKnownValue } from './unknownValue'

const sources = ['meeting', 'manual'] as const

let warning: MockInstance<typeof console.warn>
beforeEach(() => {
  warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => warning.mockRestore())

describe('표시용 분류', () => {
  it('아는 값은 그대로이고 경고하지 않는다', () => {
    const value = displayValue('meeting', sources, 'history source')
    expect(value).toBe('meeting')
    expect(isKnownValue(value)).toBe(true)
    expect(warning).not.toHaveBeenCalled()
  })

  it('모르는 값은 다른 아는 값으로 바꾸지 않고 받은 문자열을 남긴 채 경고한다', () => {
    const value = displayValue('future', sources, 'history source')
    expect(value).toEqual({ unknown: 'future' })
    expect(isKnownValue(value)).toBe(false)
    expect(warning).toHaveBeenCalledWith('Unknown history source: future')
  })
})

describe('보수 폴백', () => {
  it('아는 값은 그대로이고, 모르는 값은 정한 폴백으로 내리며 경고한다', () => {
    expect(fallbackValue('manual', sources, null, 'sync status')).toBe('manual')
    expect(warning).not.toHaveBeenCalled()
    expect(fallbackValue('future', sources, null, 'sync status')).toBeNull()
    expect(warning).toHaveBeenCalledWith('Unknown sync status: future')
  })
})
