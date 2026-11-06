import { paths } from '@/shared/config/routes'
import { initialDb } from './db'
import type { MockDb, MockResetToken } from './db'

/*
 * #356 비밀번호 재설정. 모두 비로그인이고 픽스처 계정 pm@example.com 의 메일이다.
 * 시나리오마다 토큰 값이 하나로 정해져 있어 `/reset-password?msw-scenario=password-reset-expired#token=mock-reset-expired`
 * 같은 주소로 바로 재현한다. 모의 메일함(devPaths.mockMail)에도 그 링크의 메일이 있다.
 */

export const PASSWORD_RESET_SCENARIOS = [
  'password-reset',
  'password-reset-expired',
  'password-reset-used',
  'password-reset-invalid',
  'password-reset-cooldown',
  'password-reset-server-error',
  'password-reset-mail-unavailable',
] as const
export type PasswordResetScenario = (typeof PASSWORD_RESET_SCENARIOS)[number]

export function isPasswordResetScenario(value: string): value is PasswordResetScenario {
  return (PASSWORD_RESET_SCENARIOS as readonly string[]).includes(value)
}

/** 시나리오가 메일함에 넣어 두는 링크의 토큰 */
export const PASSWORD_RESET_SCENARIO_TOKENS = {
  'password-reset': 'mock-reset-normal',
  'password-reset-expired': 'mock-reset-expired',
  'password-reset-used': 'mock-reset-used',
  'password-reset-invalid': 'mock-reset-revoked',
  'password-reset-cooldown': 'mock-reset-cooldown',
  'password-reset-server-error': 'mock-reset-server-error',
  'password-reset-mail-unavailable': 'mock-reset-mail-unavailable',
} as const satisfies Record<PasswordResetScenario, string>

const EMAIL = 'pm@example.com'

/* 시나리오를 만들 때마다 같은 db 여야 한다(scenarios.test.ts) — 시각을 지금에서 재지 않고 고정한다.
   handler 는 실제 시계로 만료를 보므로 아직 쓸 수 있는 링크는 먼 뒤, 만료된 링크는 지난 시각이다 */
const SENT_AT = '2026-09-18T00:00:00.000Z'
const LATER_SENT_AT = '2026-09-18T00:05:00.000Z'
const STILL_VALID = '2099-12-31T00:00:00.000Z'
const EXPIRED = '2026-09-18T00:30:00.000Z'

function mail(state: MockDb, row: MockResetToken, sentAt = SENT_AT): void {
  state.passwordReset.tokens.push(row)
  state.passwordReset.outbox.push({
    to: row.email,
    resetPath: `${paths.resetPassword()}#token=${row.token}`,
    sentAt,
  })
}

export function createPasswordResetScenarioDb(scenario: PasswordResetScenario): MockDb {
  const state = initialDb()
  state.authenticated = false
  const token = PASSWORD_RESET_SCENARIO_TOKENS[scenario]
  const active: MockResetToken = { token, email: EMAIL, expiresAt: STILL_VALID, status: 'active' }
  switch (scenario) {
    case 'password-reset':
      mail(state, active)
      break
    case 'password-reset-expired':
      mail(state, { ...active, expiresAt: EXPIRED })
      break
    case 'password-reset-used':
      mail(state, { ...active, status: 'used' })
      break
    case 'password-reset-invalid':
      // 같은 이메일로 다시 요청해 앞 링크가 무효가 됐다. 메일함의 두 번째 메일 링크는 쓸 수 있다
      mail(state, { ...active, status: 'revoked' })
      mail(state, { ...active, token: 'mock-reset-newer' }, LATER_SENT_AT)
      break
    case 'password-reset-cooldown':
      // 방금 메일을 보냈다. 이 시나리오 동안은 다시 요청해도 메일이 가지 않는다
      mail(state, active)
      state.passwordReset.nextMailAt[EMAIL] = Date.parse(STILL_VALID)
      break
    case 'password-reset-server-error':
      mail(state, active)
      state.passwordReset.failure = 'server-error'
      break
    case 'password-reset-mail-unavailable':
      // 앞서 보낸 메일은 남아 있고 지금은 서버가 메일을 보낼 수 없다
      mail(state, active)
      state.passwordReset.failure = 'mail-unavailable'
      break
  }
  return state
}
