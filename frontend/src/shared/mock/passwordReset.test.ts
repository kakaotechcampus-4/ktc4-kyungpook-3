import { fetchDto, fetchSessionDto, jsonRequest } from '@/shared/test/api'
import { db } from './db'
import { PASSWORD_RESET_SCENARIO_TOKENS } from './passwordResetScenarios'
import { applyScenario } from './scenarios'

/* #356 비밀번호 재설정 handler. BE PR #398 의 동작(계약 §4.1.1)을 본다 */

const EMAIL = 'pm@example.com'

const requestReset = (email: string) =>
  fetchDto('/auth/password-reset/request', jsonRequest('POST', { email }))
const verify = (token: string) =>
  fetchDto<{ expires_at: string; email_masked: string }>(
    '/auth/password-reset/verify',
    jsonRequest('POST', { token }),
  )
const confirm = (token: string, newPassword: string) =>
  fetchDto(
    '/auth/password-reset/confirm',
    jsonRequest('POST', { token, new_password: newPassword }),
  )
const login = (password: string) =>
  fetchDto('/auth/login', jsonRequest('POST', { email: EMAIL, password }))

/** 메일함의 마지막 메일 링크의 토큰 */
function lastMailedToken(): string {
  const mail = db.passwordReset.outbox.at(-1)
  if (!mail) throw new Error('no mail')
  return decodeURIComponent(mail.resetPath.split('#token=')[1])
}

beforeEach(() => {
  applyScenario('signed-out')
  vi.useFakeTimers({ toFake: ['Date'], now: Date.parse('2026-11-05T09:00:00Z') })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('재설정 메일 요청', () => {
  it('가입한 이메일이면 200 이고 메일함에 /reset-password#token= 링크가 들어간다', async () => {
    await expect(requestReset(EMAIL)).resolves.toEqual({})
    expect(db.passwordReset.outbox).toEqual([
      {
        to: EMAIL,
        resetPath: expect.stringMatching(/^\/reset-password#token=.+/) as string,
        sentAt: '2026-11-05T09:00:00.000Z',
      },
    ])
    await expect(verify(lastMailedToken())).resolves.toEqual({
      expires_at: '2026-11-05T09:30:00.000Z',
      email_masked: 'p***@example.com',
    })
  })

  it('가입하지 않은 이메일도 같은 200 이고 메일은 나가지 않는다', async () => {
    await expect(requestReset('nobody@example.com')).resolves.toEqual({})
    expect(db.passwordReset.outbox).toEqual([])
  })

  it('60초 안의 재요청은 같은 200 이고 메일이 없다. 60초가 지나면 다시 보낸다', async () => {
    await requestReset(EMAIL)
    vi.advanceTimersByTime(59_999)
    await expect(requestReset(EMAIL)).resolves.toEqual({})
    expect(db.passwordReset.outbox).toHaveLength(1)
    vi.advanceTimersByTime(1)
    await requestReset(EMAIL)
    expect(db.passwordReset.outbox).toHaveLength(2)
  })

  it('1시간에 5번 보낸 뒤에는 60초가 지나도 같은 200 이고 메일이 없다. 첫 메일 뒤 1시간이 지나면 다시 보낸다', async () => {
    for (let sent = 0; sent < 5; sent += 1) {
      await requestReset(EMAIL)
      vi.advanceTimersByTime(60_000)
    }
    expect(db.passwordReset.outbox).toHaveLength(5)
    await expect(requestReset(EMAIL)).resolves.toEqual({})
    expect(db.passwordReset.outbox).toHaveLength(5)
    vi.advanceTimersByTime(60 * 60_000 - 5 * 60_000 + 1)
    await requestReset(EMAIL)
    expect(db.passwordReset.outbox).toHaveLength(6)
  })

  it('제한에 걸린 재요청은 앞 링크를 그대로 둔다', async () => {
    await requestReset(EMAIL)
    const first = lastMailedToken()
    await requestReset(EMAIL)
    await expect(verify(first)).resolves.toBeDefined()
  })

  it('새 요청은 앞 링크를 invalid 로 만든다', async () => {
    await requestReset(EMAIL)
    const first = lastMailedToken()
    vi.advanceTimersByTime(60_000)
    await requestReset(EMAIL)
    await expect(verify(first)).rejects.toMatchObject({
      status: 400,
      code: 'PASSWORD_RESET_TOKEN_INVALID',
      details: { reason: 'invalid' },
    })
    await expect(verify(lastMailedToken())).resolves.toBeDefined()
  })

  it('이메일 형식이 아니면 400 INVALID_REQUEST', async () => {
    await expect(requestReset('pm')).rejects.toMatchObject({
      status: 400,
      code: 'INVALID_REQUEST',
    })
  })
})

describe('링크 확인과 변경', () => {
  it('30분이 지나면 expired 다', async () => {
    await requestReset(EMAIL)
    vi.advanceTimersByTime(30 * 60_000)
    await expect(verify(lastMailedToken())).rejects.toMatchObject({
      details: { reason: 'expired' },
    })
  })

  it('없는 토큰은 invalid 다', async () => {
    await expect(verify('nope')).rejects.toMatchObject({
      code: 'PASSWORD_RESET_TOKEN_INVALID',
      details: { reason: 'invalid' },
    })
  })

  it('변경하면 새 비밀번호로만 로그인되고 같은 링크는 used 다', async () => {
    await requestReset(EMAIL)
    const token = lastMailedToken()
    await expect(confirm(token, 'newpass123')).resolves.toEqual({})

    await expect(login('mock-password')).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' })
    await expect(login('newpass123')).resolves.toMatchObject({ user: { email: EMAIL } })
    await expect(confirm(token, 'other1234')).rejects.toMatchObject({
      details: { reason: 'used' },
    })
    await expect(verify(token)).rejects.toMatchObject({ details: { reason: 'used' } })
  })

  it('규칙에 맞지 않는 새 비밀번호는 400 INVALID_REQUEST 이고 링크는 그대로 쓸 수 있다', async () => {
    await requestReset(EMAIL)
    const token = lastMailedToken()
    await expect(confirm(token, 'abcdefgh')).rejects.toMatchObject({
      status: 400,
      code: 'INVALID_REQUEST',
      details: { fields: [{ loc: ['body', 'new_password'], msg: expect.any(String) as string }] },
    })
    await expect(verify(token)).resolves.toBeDefined()
  })

  it('규칙 위반은 토큰보다 먼저 본다. 쓸 수 없는 링크여도 400 INVALID_REQUEST 다', async () => {
    await expect(confirm('nope', 'short')).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
  })

  it('가린 이메일은 아이디 앞 2자, 아이디가 2자 이하면 1자 + *** 다', async () => {
    for (const email of ['abcdef@gmail.com', 'ab@gmail.com']) {
      const account = structuredClone(db.accounts[0])
      account.session.user.email = email
      db.accounts.push(account)
    }
    await requestReset('abcdef@gmail.com')
    await expect(verify(lastMailedToken())).resolves.toMatchObject({
      email_masked: 'ab***@gmail.com',
    })
    await requestReset('ab@gmail.com')
    await expect(verify(lastMailedToken())).resolves.toMatchObject({
      email_masked: 'a***@gmail.com',
    })
  })

  it('그 계정으로 로그인한 세션은 끊긴다', async () => {
    applyScenario('single-workspace')
    await requestReset(EMAIL)
    await confirm(lastMailedToken(), 'newpass123')
    await expect(fetchSessionDto()).resolves.toBeNull()
  })
})

describe('실패 스위치', () => {
  it('server-error 는 세 경로 모두 500 INTERNAL_ERROR 다', async () => {
    db.passwordReset.failure = 'server-error'
    const expected = { status: 500, code: 'INTERNAL_ERROR' }
    await expect(requestReset(EMAIL)).rejects.toMatchObject(expected)
    await expect(verify('x')).rejects.toMatchObject(expected)
    await expect(confirm('x', 'newpass123')).rejects.toMatchObject(expected)
  })

  it('mail-unavailable 은 요청만 503 MAIL_UNAVAILABLE 이다', async () => {
    db.passwordReset.failure = 'mail-unavailable'
    await expect(requestReset(EMAIL)).rejects.toMatchObject({
      status: 503,
      code: 'MAIL_UNAVAILABLE',
    })
    expect(db.passwordReset.outbox).toEqual([])
  })
})

describe('시나리오', () => {
  it.each([
    ['password-reset-expired', 'expired'],
    ['password-reset-used', 'used'],
    ['password-reset-invalid', 'invalid'],
  ] as const)('%s 의 고정 토큰은 %s 다', async (scenario, reason) => {
    applyScenario(scenario)
    await expect(verify(PASSWORD_RESET_SCENARIO_TOKENS[scenario])).rejects.toMatchObject({
      details: { reason },
    })
  })

  it('password-reset 의 고정 토큰으로 바꾸면 새 비밀번호로 로그인된다. 비로그인으로 시작한다', async () => {
    applyScenario('password-reset')
    await expect(fetchSessionDto()).resolves.toBeNull()
    await confirm(PASSWORD_RESET_SCENARIO_TOKENS['password-reset'], 'newpass123')
    await expect(login('newpass123')).resolves.toBeDefined()
  })

  it('password-reset-invalid 는 메일함에 무효가 된 링크와 새 링크가 함께 있다', async () => {
    applyScenario('password-reset-invalid')
    expect(db.passwordReset.outbox.map(({ resetPath }) => resetPath)).toEqual([
      '/reset-password#token=mock-reset-revoked',
      '/reset-password#token=mock-reset-newer',
    ])
    await expect(verify('mock-reset-newer')).resolves.toBeDefined()
  })

  it('password-reset-cooldown 은 다시 요청해도 메일이 늘지 않는다', async () => {
    applyScenario('password-reset-cooldown')
    await requestReset(EMAIL)
    expect(db.passwordReset.outbox).toHaveLength(1)
  })

  it('password-reset-server-error 는 확인이 500, password-reset-mail-unavailable 은 요청이 503 이다', async () => {
    applyScenario('password-reset-server-error')
    await expect(
      verify(PASSWORD_RESET_SCENARIO_TOKENS['password-reset-server-error']),
    ).rejects.toMatchObject({ status: 500 })
    applyScenario('password-reset-mail-unavailable')
    await expect(requestReset(EMAIL)).rejects.toMatchObject({ status: 503 })
  })
})
