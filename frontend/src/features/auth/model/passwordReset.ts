import type { ResetLinkProblem } from '@/entities/user'

/* 비밀번호 재설정 화면의 규칙 (#356). 문구는 FE 답변 댓글에서 정했다 */

/** 메일 링크 `/reset-password#token=...` 의 토큰. 없거나 비었으면 null */
export function readResetToken(hash: string): string | null {
  const token = new URLSearchParams(hash.replace(/^#/, '')).get('token')
  return token === null || token === '' ? null : token
}

export const RESET_LINK_MESSAGES: Record<ResetLinkProblem, string> = {
  expired: '링크 유효 시간(30분)이 지났어요.',
  used: '이미 사용한 링크예요.',
  invalid: '쓸 수 없는 링크예요. 다시 요청했다면 가장 최근 메일의 링크를 열어 주세요.',
}

/** 서버는 60초 안의 재요청에 메일을 보내지 않고 같은 200 을 준다. 화면이 같은 시간 동안 다시 보내기를 막는다 */
export const RESEND_COOLDOWN_MS = 60_000

/** 보낸 시각부터 다시 보낼 수 있을 때까지 남은 초. 올림이라 1초 미만이 남아도 1이다 */
export function resendSecondsLeft(sentAt: number, at: number): number {
  return Math.max(0, Math.ceil((sentAt + RESEND_COOLDOWN_MS - at) / 1000))
}

/** 비밀번호를 바꾸고 로그인으로 보낼 때의 이동 state. 로그인 화면이 안내를 띄운다 */
export const PASSWORD_CHANGED_STATE = { loginNotice: 'password-changed' } as const

export const PASSWORD_CHANGED_NOTICE = '비밀번호를 바꿨어요. 새 비밀번호로 로그인해 주세요.'

/** 로그인 화면이 받은 이동 state 의 안내 문구. 없으면 null */
export function readLoginNotice(state: unknown): string | null {
  return typeof state === 'object' &&
    state !== null &&
    'loginNotice' in state &&
    state.loginNotice === PASSWORD_CHANGED_STATE.loginNotice
    ? PASSWORD_CHANGED_NOTICE
    : null
}
