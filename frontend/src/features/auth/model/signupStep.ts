import type { KakaoPending, SignupCodeProblem } from '@/entities/user'

/**
 * 가입 단계. 증명 토큰은 `profile` 에만 있다. 카카오 연결 여부는 여기 두지 않고 주소(`kakao=1`)에서 읽는다 —
 * 메일 앱을 다녀오며 새로고침돼도 연결이 풀리지 않게 한다.
 * `verificationToken` 이 null 이면 카카오가 인증한 이메일이고, 서버가 그 값을 쿠키에서 읽는다.
 */
export type SignupStep =
  | { step: 'email' }
  | { step: 'code'; email: string; resendAt: number }
  | { step: 'profile'; email: string; verificationToken: string | null; emailLocked: boolean }

/** 카카오가 인증한 이메일이 있으면 코드 없이 프로필부터다. 그 밖에는 이메일부터다 */
export function firstSignupStep(pending: KakaoPending | null): SignupStep {
  return pending?.email
    ? { step: 'profile', email: pending.email, verificationToken: null, emailLocked: true }
    : { step: 'email' }
}

/** 카카오로 온 사람이 이미 있는 이메일을 넣었다. 그 계정에 잇지 않으므로 다른 이메일을 받는다 */
export const KAKAO_EMAIL_TAKEN_MESSAGE = '이미 가입된 이메일이에요. 다른 이메일을 입력해 주세요.'

const NEW_CODE_NEEDED = '새 코드를 받아 주세요.'

export function signupCodeMessage(problem: SignupCodeProblem): string {
  switch (problem.reason) {
    case 'expired':
      return `코드 유효 시간(10분)이 지났어요. ${NEW_CODE_NEEDED}`
    case 'too_many':
      return `입력 횟수를 모두 썼어요. ${NEW_CODE_NEEDED}`
    case 'wrong':
      if (problem.attemptsLeft === null) return '코드가 맞지 않아요.'
      return problem.attemptsLeft > 0
        ? `코드가 맞지 않아요. ${problem.attemptsLeft}번 더 입력할 수 있어요.`
        : `코드가 맞지 않아요. ${NEW_CODE_NEEDED}`
  }
}
