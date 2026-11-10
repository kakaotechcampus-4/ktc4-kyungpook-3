import type { SignupCodeProblem } from '@/entities/user'

/** 이메일 가입 단계. 증명 토큰은 `profile` 에만 있다. 카카오 가입은 이 단계를 타지 않는다 (#627) */
export type SignupStep =
  | { step: 'email' }
  | { step: 'code'; email: string; resendAt: number }
  | { step: 'profile'; email: string; verificationToken: string }

/**
 * 가입 마지막 단계의 종류. 이메일 가입은 인증한 이메일을 보이고 비밀번호를 받는다.
 * 카카오 가입은 이메일·비밀번호가 없고 이름을 닉네임으로 채운다. 종류마다 되돌아갈 길이 다르다
 */
export type SignupProfile =
  | {
      kind: 'email'
      email: string
      verificationToken: string
      onChangeEmail: () => void
      /** 증명이 만료됐다. 이메일 인증부터 다시 한다 */
      onVerificationLost: (message: string) => void
    }
  | {
      kind: 'kakao'
      nickname: string | null
      /** 가입 요청이 대기 만료로 거절됐다 */
      onLinkExpired: (error: unknown) => void
    }

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
