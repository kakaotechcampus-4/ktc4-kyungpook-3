import { RESEND_COOLDOWN_MS, readResetToken, resendSecondsLeft } from './passwordReset'

describe('readResetToken', () => {
  it.each([
    ['#token=abc', 'abc'],
    ['token=abc', 'abc'],
    ['#token=a%2Bb%3D', 'a+b='],
    ['#other=1&token=abc', 'abc'],
  ])('%j → %j', (hash, token) => {
    expect(readResetToken(hash)).toBe(token)
  })

  it.each(['', '#', '#token=', '#tok=abc', '#abc'])('%j 에는 토큰이 없다', (hash) => {
    expect(readResetToken(hash)).toBeNull()
  })
})

describe('resendSecondsLeft', () => {
  const sentAt = 1_000_000

  it('보낸 직후는 60초다', () => {
    expect(resendSecondsLeft(sentAt + RESEND_COOLDOWN_MS, sentAt)).toBe(60)
  })

  it('1초 미만이 남아도 1초로 보인다', () => {
    expect(resendSecondsLeft(sentAt + RESEND_COOLDOWN_MS, sentAt + 59_001)).toBe(1)
    expect(resendSecondsLeft(sentAt + RESEND_COOLDOWN_MS, sentAt + 58_999)).toBe(2)
  })

  it('60초가 지나면 0 이고 그 뒤에도 음수가 아니다', () => {
    expect(resendSecondsLeft(sentAt + RESEND_COOLDOWN_MS, sentAt + RESEND_COOLDOWN_MS)).toBe(0)
    expect(resendSecondsLeft(sentAt + RESEND_COOLDOWN_MS, sentAt + 10 * RESEND_COOLDOWN_MS)).toBe(0)
  })
})
