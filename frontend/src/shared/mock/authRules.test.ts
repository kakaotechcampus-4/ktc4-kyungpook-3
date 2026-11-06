import { fetchDto, jsonRequest } from '@/shared/test/api'
import type { SessionDto } from '@/shared/types/api/auth'
import { applyScenario } from './scenarios'

/* #446 가입 이름 규칙(BE validate_name) */

const EMAIL = 'pm@example.com'

const signup = (name: string, email = 'new@example.com') =>
  fetchDto<SessionDto>('/auth/signup', jsonRequest('POST', { name, email, password: 'pass1234' }))

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
