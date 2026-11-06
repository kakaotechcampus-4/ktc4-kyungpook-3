import { http } from 'msw'
import { z } from 'zod'
import { paths } from '@/shared/config/routes'
import { db } from '../db'
import type { MockResetToken } from '../db'
import { fail, ok } from '../envelope'

/*
 * #356 비밀번호 재설정 (계약 §4.1.1). BE PR #398 의 동작을 따른다.
 * 시각은 `Date.now()` 다. 브라우저 MSW 는 `now()`(shared/lib/date)를 MOCK_NOW 에 멈추는데, 그 시계로는
 * 60초 쿨다운이 끝나지 않는다. 토큰 만료·쿨다운은 실제로 흐르는 시계로 본다.
 */

const base = '/api/v1/auth/password-reset'

const TOKEN_TTL_MS = 30 * 60_000

const MAIL_COOLDOWN_MS = 60_000

const HOUR_MS = 60 * 60_000

const HOURLY_MAIL_LIMIT = 5

const EMAIL = z.email()

/** BE validate_password. 길이는 코드 포인트로 세고(u), 숫자는 ASCII 0-9 만 본다 */
const PASSWORD_RULE = /^(?=.*[0-9]).{8,}$/u

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

/** BE 의 가리는 규칙. 아이디 앞 2자(2자 이하면 1자) + `***`, 도메인은 그대로 */
function maskEmail(email: string): string {
  const at = email.indexOf('@')
  const local = email.slice(0, at)
  return `${local.slice(0, local.length >= 3 ? 2 : 1)}***${email.slice(at)}`
}

/** 가입한 이메일이고 60초·1시간 5번 제한에 걸리지 않을 때만 이전 링크를 무효로 하고 새 링크를 메일함에 넣는다 */
function sendResetMail(email: string): void {
  const state = db.passwordReset
  const at = Date.now()
  if (!db.accounts.some(({ session }) => session.user.email === email)) return
  if (at < (state.nextMailAt[email] ?? 0)) return
  const lastHour = state.outbox.filter(
    (mail) => mail.to === email && Date.parse(mail.sentAt) > at - HOUR_MS,
  ).length
  if (lastHour >= HOURLY_MAIL_LIMIT) return
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

/** BE 본문 검증(pydantic) 오류 한 칸. 400 `INVALID_REQUEST` 의 `details.fields` 에 들어간다 */
interface FieldError {
  loc: string[]
  msg: string
}

/** 필수 문자열 칸을 BE 처럼 검사한다. 없거나 문자열이 아니면 그 칸의 오류다 */
function stringField(body: Record<string, unknown>, name: string): FieldError | null {
  const value = body[name]
  if (value === undefined) return { loc: ['body', name], msg: 'Field required' }
  if (typeof value !== 'string')
    return { loc: ['body', name], msg: 'Input should be a valid string' }
  return null
}

const invalidBody = (fields: FieldError[]) =>
  fail('INVALID_REQUEST', '요청이 올바르지 않습니다.', 400, { fields })

async function readBody(request: Request): Promise<Record<string, unknown>> {
  const body: unknown = await request.json()
  return typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {}
}

export const passwordResetHandlers = [
  http.post(`${base}/request`, async ({ request }) => {
    if (db.passwordReset.failure === 'server-error') return serverError()
    const body = await readBody(request)
    const emailError = stringField(body, 'email')
    if (emailError) return invalidBody([emailError])
    if (typeof body.email !== 'string' || !EMAIL.safeParse(body.email).success)
      return invalidBody([{ loc: ['body', 'email'], msg: 'value is not a valid email address' }])
    if (db.passwordReset.failure === 'mail-unavailable')
      return fail('MAIL_UNAVAILABLE', '메일을 보낼 수 없습니다.', 503)
    sendResetMail(body.email)
    return ok({})
  }),
  http.post(`${base}/verify`, async ({ request }) => {
    if (db.passwordReset.failure === 'server-error') return serverError()
    const body = await readBody(request)
    const tokenError = stringField(body, 'token')
    if (tokenError) return invalidBody([tokenError])
    const checked = checkToken(body.token)
    if ('reason' in checked) return tokenInvalid(checked.reason)
    return ok({ expires_at: checked.row.expiresAt, email_masked: maskEmail(checked.row.email) })
  }),
  http.post(`${base}/confirm`, async ({ request }) => {
    if (db.passwordReset.failure === 'server-error') return serverError()
    const body = await readBody(request)
    // BE 는 본문 검증이 토큰 확인보다 먼저다. 칸마다 오류를 모아 한 번에 답하고, 규칙 위반은 토큰을 쓰지 않는다
    const passwordError =
      stringField(body, 'new_password') ??
      (PASSWORD_RULE.test(body.new_password as string)
        ? null
        : {
            loc: ['body', 'new_password'],
            msg: 'Value error, 비밀번호는 8자 이상이고 숫자를 하나 이상 포함해야 합니다.',
          })
    const fields = [stringField(body, 'token'), passwordError].filter(
      (error): error is FieldError => error !== null,
    )
    if (fields.length > 0) return invalidBody(fields)
    const newPassword = body.new_password as string
    const checked = checkToken(body.token)
    if ('reason' in checked) return tokenInvalid(checked.reason)
    const { row } = checked
    row.status = 'used'
    const account = db.accounts.find(({ session }) => session.user.email === row.email)
    if (account) account.password = newPassword
    // 서버가 그 계정의 세션을 모두 끊는다. 다른 계정으로 로그인한 세션은 그대로다
    if (db.authenticated && db.session.user.email === row.email) db.authenticated = false
    return ok({})
  }),
]
