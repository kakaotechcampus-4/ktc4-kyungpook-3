import { http } from 'msw'
import { z } from 'zod'
import { db } from '../db'
import type { MockSignupCode } from '../db'
import { fail, ok } from '../envelope'
import { accountWithEmail, normalizeEmail } from '../sessions'
import { readJson } from '../utils'

/*
 * #427 가입 코드 (계약 §4.1.2). backend services/signup_codes.py 의 동작을 따른다.
 * 시각은 비밀번호 재설정 handler 와 같은 까닭으로 `Date.now()` 다. 멈춘 `now()` 로는 60초 제한이 풀리지 않는다.
 */

const base = '/api/v1/auth/signup/code'

const CODE_TTL_MS = 10 * 60_000

const COOLDOWN_MS = 60_000

const WINDOW_MS = 60 * 60_000

const HOURLY_LIMIT = 5

const MAX_ATTEMPTS = 5

const PROOF_TTL_MS = 30 * 60_000

const EMAIL = z.email()

const CODE = /^[0-9]{6}$/

const invalidBody = () => fail('INVALID_REQUEST', '요청이 올바르지 않습니다.', 400)

function rateLimited(reason: 'cooldown' | 'hourly', retryAt: number, at: number) {
  return fail('SIGNUP_CODE_RATE_LIMITED', '인증 코드를 너무 자주 요청했습니다.', 429, {
    reason,
    retry_after: Math.ceil((retryAt - at) / 1000),
  })
}

const codeInvalid = (details: Record<string, unknown>) =>
  fail('SIGNUP_CODE_INVALID', '인증 코드가 맞지 않습니다.', 400, details)

function randomCode(): string {
  return String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0')
}

function readEmail(body: Record<string, unknown>): string | null {
  if (typeof body.email !== 'string') return null
  const email = normalizeEmail(body.email)
  return EMAIL.safeParse(email).success ? email : null
}

/** 가입에 쓸 수 있는 증명이면 그 이메일을, 없거나 만료면 null 을 돌려준다 */
export function readSignupProof(token: unknown): string | null {
  if (typeof token !== 'string') return null
  const proof = db.signupVerification.proofs[token]
  return proof !== undefined && proof.expiresAt > Date.now() ? proof.email : null
}

export const signupCodeHandlers = [
  http.post(base, async ({ request }) => {
    const email = readEmail((await readJson(request)) ?? {})
    if (email === null) return invalidBody()
    if (db.passwordReset.failure === 'mail-unavailable')
      return fail('MAIL_UNAVAILABLE', '메일을 보낼 수 없습니다.', 503)
    if (accountWithEmail(email))
      return fail('EMAIL_ALREADY_EXISTS', '이미 가입된 이메일입니다.', 409)

    const state = db.signupVerification
    const at = Date.now()
    const row: MockSignupCode | undefined = state.codes[email]
    if (row !== undefined) {
      if (row.sentAt + COOLDOWN_MS > at) return rateLimited('cooldown', row.sentAt + COOLDOWN_MS, at)
      const windowEnds = row.windowStartedAt + WINDOW_MS
      if (windowEnds > at && row.windowCount >= HOURLY_LIMIT)
        return rateLimited('hourly', windowEnds, at)
    }
    const windowOpen = row !== undefined && row.windowStartedAt + WINDOW_MS > at
    const code = randomCode()
    state.codes[email] = {
      code,
      attempts: 0,
      expiresAt: at + CODE_TTL_MS,
      sentAt: at,
      windowStartedAt: windowOpen ? row.windowStartedAt : at,
      windowCount: windowOpen ? row.windowCount + 1 : 1,
    }
    state.outbox.push({ to: email, code, sentAt: new Date(at).toISOString() })
    return ok({ expires_in: CODE_TTL_MS / 1000, resend_after: COOLDOWN_MS / 1000 })
  }),
  http.post(`${base}/confirm`, async ({ request }) => {
    const body = (await readJson(request)) ?? {}
    const email = readEmail(body)
    if (email === null || typeof body.code !== 'string' || !CODE.test(body.code))
      return invalidBody()

    const state = db.signupVerification
    const at = Date.now()
    const row = state.codes[email]
    if (row === undefined || row.expiresAt <= at) return codeInvalid({ reason: 'expired' })
    if (row.attempts >= MAX_ATTEMPTS) return codeInvalid({ reason: 'too_many' })
    row.attempts += 1
    if (row.code !== body.code)
      return codeInvalid({ reason: 'wrong', attempts_left: MAX_ATTEMPTS - row.attempts })

    Reflect.deleteProperty(state.codes, email)
    const token = `mock-proof-${crypto.randomUUID()}`
    state.proofs[token] = { email, expiresAt: at + PROOF_TTL_MS }
    return ok({ verification_token: token, expires_in: PROOF_TTL_MS / 1000 })
  }),
]
