import { signupCodeMessage } from './signupStep'

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
