import { fetchDto, jsonRequest } from '@/shared/test/api'
import type { SessionDto } from '@/shared/types/api/auth'
import { db } from './db'
import { applyScenario } from './scenarios'

/* #446 가입 이름 규칙(BE validate_name)과 #457 로그인 시도 제한(BE PR #456 login_limit) */

const EMAIL = 'pm@example.com'
const PASSWORD = 'mock-password'
const BLOCK_SECONDS = 15 * 60

const signup = (name: string, email = 'new@example.com') => {
  db.signupVerification.proofs.proof = { email, expiresAt: Date.now() + 60_000 }
  return fetchDto<SessionDto>(
    '/auth/signup',
    jsonRequest('POST', { name, verification_token: 'proof', password: 'pass1234' }),
  )
}
const login = (password: string, email = EMAIL) =>
  fetchDto<SessionDto>('/auth/login', jsonRequest('POST', { email, password }))

/** `Retry-After` 헤더를 보려고 공용 request() 를 거치지 않는다 */
async function rawLogin(password: string) {
  const response = await fetch(`${location.origin}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password }),
  })
  const body = (await response.json()) as {
    error: { code: string; details: { retry_after_seconds: number } } | null
  }
  return { status: response.status, retryAfter: response.headers.get('Retry-After'), body }
}

async function failLogins(times: number, email = EMAIL) {
  for (let attempt = 0; attempt < times; attempt += 1)
    await expect(login('wrong-password', email)).rejects.toMatchObject({ status: 401 })
}

async function resetPassword(newPassword: string) {
  await fetchDto('/auth/password-reset/request', jsonRequest('POST', { email: EMAIL }))
  const mail = db.passwordReset.outbox.at(-1)
  if (!mail) throw new Error('no mail')
  const token = decodeURIComponent(mail.resetPath.split('#token=')[1])
  await fetchDto(
    '/auth/password-reset/confirm',
    jsonRequest('POST', { token, new_password: newPassword }),
  )
}

beforeEach(() => {
  applyScenario('signed-out')
  vi.useFakeTimers({ toFake: ['Date'], now: Date.parse('2026-11-07T09:00:00Z') })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('가입 이름 규칙 (#446, BE validate_name)', () => {
  it.each([
    ['공백뿐', '   '],
    ['101 코드 포인트', 'a'.repeat(101)],
    ['보이지 않는 글자뿐', '\u200b'],
    ['보이지 않는 글자·공백·결합 부호뿐', '\u200b \u0301'],
    ['제어문자', 'a\u0007b'],
    ['줄바꿈', 'a\nb'],
    ['줄 구분자', 'a\u2028b'],
    ['글자 방향 제어', 'a\u202eb'],
    ['짝 없는 서로게이트', 'a\ud800b'],
  ])('%s 이름은 400 INVALID_REQUEST 이고 name 칸 오류다', async (_, name) => {
    await expect(signup(name)).rejects.toMatchObject({
      status: 400,
      code: 'INVALID_REQUEST',
      details: { fields: [{ loc: ['body', 'name'] }] },
    })
  })

  it('앞뒤 공백을 지운 이름으로 가입한다', async () => {
    await expect(signup('  최진호  ')).resolves.toMatchObject({ user: { name: '최진호' } })
  })

  it('길이는 코드 포인트로 센다 — 이모지 100개(UTF-16 200자)는 받는다', async () => {
    await expect(signup('😀'.repeat(100))).resolves.toBeDefined()
  })

  it('안쪽의 ZWJ 는 받는다', async () => {
    await expect(signup('a\u200db')).resolves.toBeDefined()
  })

  it('본문 검증이 중복 이메일보다 먼저다 — 가입된 이메일이어도 400 이다', async () => {
    await expect(signup('   ', EMAIL)).rejects.toMatchObject({
      status: 400,
      code: 'INVALID_REQUEST',
    })
  })
})

describe('로그인 시도 제한 (#457, BE login_limit)', () => {
  it('10번째 실패까지는 401 이고 그 뒤로는 맞는 비밀번호도 429 다. 남은 시간을 본문과 Retry-After 로 준다', async () => {
    await failLogins(10)
    const blocked = await rawLogin(PASSWORD)
    expect(blocked.status).toBe(429)
    expect(blocked.body.error?.code).toBe('TOO_MANY_LOGIN_ATTEMPTS')
    const seconds = blocked.body.error?.details.retry_after_seconds
    expect(Number.isInteger(seconds) && seconds! > 0 && seconds! <= BLOCK_SECONDS).toBe(true)
    expect(blocked.retryAfter).toBe(String(seconds))
  })

  it('15분이 지나면 다시 로그인된다', async () => {
    await failLogins(10)
    vi.advanceTimersByTime(BLOCK_SECONDS * 1000 - 1)
    await expect(login(PASSWORD)).rejects.toMatchObject({ status: 429 })
    vi.advanceTimersByTime(1)
    await expect(login(PASSWORD)).resolves.toMatchObject({ user: { email: EMAIL } })
  })

  it('막히기 전에 로그인하면 실패 횟수가 지워진다', async () => {
    await failLogins(9)
    await login(PASSWORD)
    await failLogins(9)
    await expect(login(PASSWORD)).resolves.toBeDefined()
  })

  it('다른 이메일은 막히지 않는다', async () => {
    db.accounts.push({
      ...structuredClone(db.accounts[0]),
      session: {
        ...structuredClone(db.accounts[0].session),
        user: { ...db.accounts[0].session.user, user_id: 'us_02', email: 'other@example.com' },
      },
    })
    await failLogins(10)
    await expect(login(PASSWORD, 'other@example.com')).resolves.toMatchObject({
      user: { email: 'other@example.com' },
    })
  })

  it('비밀번호 재설정을 마치면 막힘이 풀린다', async () => {
    await failLogins(10)
    await resetPassword('newpass123')
    await expect(login('newpass123')).resolves.toMatchObject({ user: { email: EMAIL } })
  })

  it('대소문자가 다른 이메일로 막혀도 재설정을 마치면 풀린다', async () => {
    await failLogins(10, 'PM@example.com')
    await expect(login(PASSWORD)).rejects.toMatchObject({ status: 429 })
    await resetPassword('newpass123')
    await expect(login('newpass123')).resolves.toMatchObject({ user: { email: EMAIL } })
  })

  it('첫 실패부터 15분이 지나면 실패를 처음부터 센다', async () => {
    await failLogins(9)
    vi.advanceTimersByTime(BLOCK_SECONDS * 1000)
    await failLogins(1)
    await expect(login(PASSWORD)).resolves.toMatchObject({ user: { email: EMAIL } })
  })

  it('첫 실패부터 15분이 되기 직전의 10번째 실패는 막는다', async () => {
    await failLogins(9)
    vi.advanceTimersByTime(BLOCK_SECONDS * 1000 - 1)
    await failLogins(1)
    await expect(login(PASSWORD)).rejects.toMatchObject({ status: 429 })
  })

  it('이메일은 앞뒤 공백과 대소문자를 무시하고 함께 센다', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await failLogins(1)
      await failLogins(1, 'PM@Example.com ')
    }
    await expect(login(PASSWORD)).rejects.toMatchObject({ status: 429 })
  })

  it('login-rate-limited 는 맞는 비밀번호도 바로 429 이고 남은 시간은 900초다', async () => {
    applyScenario('login-rate-limited')
    const blocked = await rawLogin(PASSWORD)
    expect(blocked.status).toBe(429)
    expect(blocked.body.error).toMatchObject({
      code: 'TOO_MANY_LOGIN_ATTEMPTS',
      details: { retry_after_seconds: BLOCK_SECONDS },
    })
    expect(blocked.retryAfter).toBe(String(BLOCK_SECONDS))
  })
})
