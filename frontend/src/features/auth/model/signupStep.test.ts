import { firstSignupStep, signupCodeMessage } from './signupStep'

describe('firstSignupStep', () => {
  it('카카오가 인증한 이메일이 있으면 코드 없이 잠긴 프로필부터다', () => {
    expect(firstSignupStep({ email: 'kakao@example.com', nickname: null })).toEqual({
      step: 'profile',
      email: 'kakao@example.com',
      verificationToken: null,
      emailLocked: true,
    })
  })

  it.each([[null], [{ email: null, nickname: '카카오' }]])('그 밖에는 이메일부터다', (pending) => {
    expect(firstSignupStep(pending)).toEqual({ step: 'email' })
  })
})

describe('signupCodeMessage', () => {
  it.each([
    [{ reason: 'wrong', attemptsLeft: 3 }, '코드가 맞지 않아요. 3번 더 입력할 수 있어요.'],
    [{ reason: 'wrong', attemptsLeft: 0 }, '코드가 맞지 않아요. 새 코드를 받아 주세요.'],
    [{ reason: 'wrong', attemptsLeft: null }, '코드가 맞지 않아요.'],
    [{ reason: 'expired' }, '코드 유효 시간(10분)이 지났어요. 새 코드를 받아 주세요.'],
    [{ reason: 'too_many' }, '입력 횟수를 모두 썼어요. 새 코드를 받아 주세요.'],
  ] as const)('%o', (problem, message) => {
    expect(signupCodeMessage(problem)).toBe(message)
  })
})
