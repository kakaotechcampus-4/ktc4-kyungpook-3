import { ApiError } from '@/shared/api/errors'
import { fetchDto, jsonRequest } from '@/shared/test/api'
import type { SignupCodeConfirmedDto, SignupCodeSentDto } from '@/shared/types/api/auth'
import { db } from './db'
import { applyScenario } from './scenarios'

/* #427 가입 코드 handler. backend services/signup_codes.py 의 동작(계약 §4.1.2)을 본다 */

const EMAIL = 'new@example.com'

const requestCode = (email: string = EMAIL) =>
  fetchDto<SignupCodeSentDto>('/auth/signup/code', jsonRequest('POST', { email }))
const confirmCode = (code: string, email: string = EMAIL) =>
  fetchDto<SignupCodeConfirmedDto>(
    '/auth/signup/code/confirm',
    jsonRequest('POST', { email, code }),
  )

function lastCode(): string {
  const mail = db.signupVerification.outbox.at(-1)
  if (!mail) throw new Error('no mail')
  return mail.code
}

const wrongCode = () => (lastCode() === '000000' ? '000001' : '000000')

async function failure(pending: Promise<unknown>): Promise<ApiError> {
  const error: unknown = await pending.then(
    () => null,
    (reason: unknown) => reason,
  )
  if (!(error instanceof ApiError)) throw new Error('expected ApiError')
  return error
}

const advance = (ms: number) => vi.setSystemTime(Date.now() + ms)

beforeEach(() => {
  applyScenario('signed-out')
  vi.useFakeTimers({ toFake: ['Date'], now: Date.parse('2026-11-06T09:00:00Z') })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('코드 요청', () => {
  it('정규화한 이메일로 메일을 보내고 유효 시간과 재발송 시간을 알린다', async () => {
    await expect(requestCode(' New@Example.com ')).resolves.toEqual({
      expires_in: 600,
      resend_after: 60,
    })
    expect(db.signupVerification.outbox.map(({ to }) => to)).toEqual([EMAIL])
    expect(lastCode()).toMatch(/^\d{6}$/)
  })

  it('이미 가입된 이메일은 대소문자가 달라도 409 다', async () => {
    const error = await failure(requestCode('PM@example.com'))
    expect([error.status, error.code]).toEqual([409, 'EMAIL_ALREADY_EXISTS'])
    expect(db.signupVerification.outbox).toEqual([])
  })

  it('60초 안의 재요청은 429 cooldown 이고 앞 코드를 그대로 둔다', async () => {
    await requestCode()
    const code = lastCode()
    advance(20_000)
    const error = await failure(requestCode())
    expect([error.status, error.code, error.details]).toEqual([
      429,
      'SIGNUP_CODE_RATE_LIMITED',
      { reason: 'cooldown', retry_after: 40 },
    ])
    await expect(confirmCode(code)).resolves.toMatchObject({ expires_in: 1800 })
  })

  it('한 시간에 다섯 번까지 보내고 그 뒤는 429 hourly 다. 창이 지나면 다시 보낸다', async () => {
    for (let sent = 0; sent < 5; sent += 1) {
      await requestCode()
      advance(60_000)
    }
    const error = await failure(requestCode())
    expect(error.details).toMatchObject({ reason: 'hourly' })
    expect(db.signupVerification.outbox).toHaveLength(5)

    advance(60 * 60_000)
    await expect(requestCode()).resolves.toMatchObject({ resend_after: 60 })
  })

  it('메일을 보낼 수 없으면 503 이다', async () => {
    db.passwordReset.failure = 'mail-unavailable'
    const error = await failure(requestCode())
    expect([error.status, error.code]).toEqual([503, 'MAIL_UNAVAILABLE'])
  })

  it('이메일 형식이 아니면 400 이다', async () => {
    const error = await failure(requestCode('x'))
    expect([error.status, error.code]).toEqual([400, 'INVALID_REQUEST'])
  })
})

describe('코드 확인', () => {
  it('맞으면 증명 토큰을 주고 코드는 다시 쓸 수 없다', async () => {
    await requestCode()
    const code = lastCode()
    await expect(confirmCode(code)).resolves.toMatchObject({ expires_in: 1800 })
    expect(Object.keys(db.signupVerification.proofs)).toHaveLength(1)
    expect((await failure(confirmCode(code))).details).toEqual({ reason: 'expired' })
  })

  it('틀리면 남은 횟수를 알리고 다섯 번째부터 too_many 다', async () => {
    await requestCode()
    const wrong = wrongCode()
    for (const left of [4, 3, 2, 1, 0]) {
      expect((await failure(confirmCode(wrong))).details).toEqual({
        reason: 'wrong',
        attempts_left: left,
      })
    }
    expect((await failure(confirmCode(lastCode()))).details).toEqual({ reason: 'too_many' })
  })

  it('10분이 지나면 expired 다', async () => {
    await requestCode()
    advance(10 * 60_000)
    expect((await failure(confirmCode(lastCode()))).details).toEqual({ reason: 'expired' })
  })

  it('다시 받으면 횟수가 새로 시작하고 앞 코드는 틀린 코드가 된다', async () => {
    await requestCode()
    const old = lastCode()
    await failure(confirmCode(wrongCode()))
    advance(60_000)
    await requestCode()
    expect((await failure(confirmCode(old))).details).toMatchObject({ attempts_left: 4 })
    await expect(confirmCode(lastCode())).resolves.toMatchObject({ expires_in: 1800 })
  })

  it('코드가 여섯 자리 숫자가 아니면 400 이다', async () => {
    await requestCode()
    const error = await failure(confirmCode('12345'))
    expect([error.status, error.code]).toEqual([400, 'INVALID_REQUEST'])
  })
})
