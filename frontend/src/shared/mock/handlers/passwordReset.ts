import { http } from 'msw'
import { z } from 'zod'
import { paths } from '@/shared/config/routes'
import { db } from '../db'
import type { MockResetToken } from '../db'
import { fail, ok } from '../envelope'

/*
 * #356 비밀번호 재설정 (계약 §4.1.1). 합의만 됐고 BE 구현은 아직 없다 — 합의 댓글의 동작을 따른다.
 * 시각은 `Date.now()` 다. 브라우저 MSW 는 `now()`(shared/lib/date)를 MOCK_NOW 에 멈추는데, 그 시계로는
 * 60초 쿨다운이 끝나지 않는다. 토큰 만료·쿨다운은 실제로 흐르는 시계로 본다.
 */

const base = '/api/v1/auth/password-reset'

const TOKEN_TTL_MS = 30 * 60_000

const MAIL_COOLDOWN_MS = 60_000

const EMAIL = z.email()

const PASSWORD_RULE = /^(?=.*\d).{8,}$/

type TokenCheck = { row: MockResetToken } | { reason: 'invalid' | 'expired' | 'used' }

function checkToken(token: unknown): TokenCheck {
  const row = db.passwordReset.tokens.find((candidate) => candidate.token === token)
  if (!row || row.status === 'revoked') return { reason: 'invalid' }
  if (row.status === 'used') return { reason: 'used' }
  if (Date.parse(row.expiresAt) <= Date.now()) return { reason: 'expired' }
  return { row }
}

const serverError = () => fail('INTERNAL_ERROR', '서버 오류가 발생했습니다.', 500)

const tokenInvalid = (reason: string) =>
  fail('PASSWORD_RESET_TOKEN_INVALID', '재설정 링크를 사용할 수 없습니다.', 400, { reason })

/** 가입한 이메일이고 쿨다운이 아니면 이전 링크를 무효로 하고 새 링크를 메일함에 넣는다 */
function sendResetMail(email: string): void {
  const state = db.passwordReset
  const at = Date.now()
  if (!db.accounts.some(({ session }) => session.user.email === email)) return
  if (at < (state.nextMailAt[email] ?? 0)) return
  for (const row of state.tokens)
    if (row.email === email && row.status === 'active') row.status = 'revoked'
  const token = `mock-reset-${String(state.tokens.length + 1).padStart(2, '0')}`
  state.tokens.push({
    token,
    email,
    expiresAt: new Date(at + TOKEN_TTL_MS).toISOString(),
    status: 'active',
  })
  state.nextMailAt[email] = at + MAIL_COOLDOWN_MS
  state.outbox.push({
    to: email,
    resetPath: `${paths.resetPassword()}#token=${encodeURIComponent(token)}`,
    sentAt: new Date(at).toISOString(),
  })
}

export const passwordResetHandlers = [
  http.post(`${base}/request`, async ({ request }) => {
    if (db.passwordReset.failure === 'server-error') return serverError()
    const body = (await request.json()) as { email?: unknown }
    if (typeof body.email !== 'string' || !EMAIL.safeParse(body.email).success)
      return fail('INVALID_REQUEST', '요청이 올바르지 않습니다.', 400)
    if (db.passwordReset.failure === 'mail-unavailable')
      return fail('MAIL_UNAVAILABLE', '메일을 보낼 수 없습니다.', 503)
    sendResetMail(body.email)
    return ok({})
  }),
  http.post(`${base}/verify`, async ({ request }) => {
    if (db.passwordReset.failure === 'server-error') return serverError()
    const body = (await request.json()) as { token?: unknown }
    const checked = checkToken(body.token)
    if ('reason' in checked) return tokenInvalid(checked.reason)
    return ok({ expires_at: checked.row.expiresAt })
  }),
  http.post(`${base}/confirm`, async ({ request }) => {
    if (db.passwordReset.failure === 'server-error') return serverError()
    const body = (await request.json()) as { token?: unknown; new_password?: unknown }
    const checked = checkToken(body.token)
    if ('reason' in checked) return tokenInvalid(checked.reason)
    if (typeof body.new_password !== 'string' || !PASSWORD_RULE.test(body.new_password))
      return fail('INVALID_REQUEST', '비밀번호 규칙에 맞지 않습니다.', 400, {
        fields: ['new_password'],
      })
    const { row } = checked
    row.status = 'used'
    const account = db.accounts.find(({ session }) => session.user.email === row.email)
    if (account) account.password = body.new_password
    // 서버가 그 계정의 세션을 모두 끊는다. 다른 계정으로 로그인한 세션은 그대로다
    if (db.authenticated && db.session.user.email === row.email) db.authenticated = false
    return ok({})
  }),
]
