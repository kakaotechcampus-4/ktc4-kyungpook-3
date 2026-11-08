import { onTestFinished } from 'vitest'
import {
  SPLASH_INTERVAL_MS,
  SPLASH_RECORD_KEY,
  hasSplashRecord,
  isSplashDue,
  markSplashShown,
} from './splashRecord'

/* 전체 스플래시 12시간 규칙 (#510). index.html 의 <head> 판정과 같은지는 app/splash/staticSplash.test.tsx 가 본다 */

const NOW = Date.UTC(2026, 10, 8, 3, 0, 0)
const HOUR = 60 * 60 * 1000

function blockStorage(method: 'getItem' | 'setItem') {
  const blocked = vi.spyOn(Storage.prototype, method).mockImplementation(() => {
    throw new DOMException('막힘', 'SecurityError')
  })
  onTestFinished(() => {
    blocked.mockRestore()
  })
}

describe('isSplashDue', () => {
  it('기록이 없으면 보인다', () => {
    expect(isSplashDue(NOW)).toBe(true)
  })

  it('11시간 전에 보였으면 건너뛴다', () => {
    markSplashShown(NOW - 11 * HOUR)
    expect(isSplashDue(NOW)).toBe(false)
  })

  it('13시간 전에 보였으면 다시 보인다', () => {
    markSplashShown(NOW - 13 * HOUR)
    expect(isSplashDue(NOW)).toBe(true)
  })

  it('12시간이 되는 순간부터 다시 보인다', () => {
    markSplashShown(NOW - SPLASH_INTERVAL_MS + 1)
    expect(isSplashDue(NOW)).toBe(false)
    markSplashShown(NOW - SPLASH_INTERVAL_MS)
    expect(isSplashDue(NOW)).toBe(true)
  })

  it('저장소를 읽지 못하면 매번 보인다', () => {
    markSplashShown(NOW - HOUR)
    blockStorage('getItem')
    expect(isSplashDue(NOW)).toBe(true)
  })

  it.each([
    ['시각이 아닌 값', 'seen'],
    ['0', '0'],
    ['빈 값', ''],
  ])('%s 이면 보인다', (_name, raw) => {
    window.localStorage.setItem(SPLASH_RECORD_KEY, raw)
    expect(isSplashDue(NOW)).toBe(true)
  })

  it('기록이 앞날이면(시계가 뒤로 갔다) 보인다 — 12시간 넘게 건너뛰지 않는다', () => {
    markSplashShown(NOW + HOUR)
    expect(isSplashDue(NOW)).toBe(true)
  })
})

describe('hasSplashRecord', () => {
  it('값이 있기만 하면 써 본 사람이다 — 시각과 상관없다', () => {
    expect(hasSplashRecord()).toBe(false)
    markSplashShown(1)
    expect(hasSplashRecord()).toBe(true)
  })

  it('저장소를 읽지 못하면 처음 온 사람으로 본다', () => {
    markSplashShown(NOW)
    blockStorage('getItem')
    expect(hasSplashRecord()).toBe(false)
  })
})

describe('markSplashShown', () => {
  it('버전 붙은 키에 epoch ms 로 쓴다 (D-147)', () => {
    markSplashShown(NOW)
    expect(window.localStorage.getItem('splash-last-shown:v1')).toBe(String(NOW))
  })

  it('쓰기가 막혀도 던지지 않는다', () => {
    blockStorage('setItem')
    expect(() => {
      markSplashShown(NOW)
    }).not.toThrow()
  })
})
