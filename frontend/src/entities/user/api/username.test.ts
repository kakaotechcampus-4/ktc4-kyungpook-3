import { http } from 'msw'
import { db } from '@/shared/mock/db'
import { ok } from '@/shared/mock/envelope'
import { applyScenario } from '@/shared/mock/scenarios'
import { server } from '@/shared/mock/server'
import { fetchUsernameAvailability } from './username'

/* #627 아이디 중복 확인 (BE GET /auth/username-availability). 로그인 없이 부르고 늘 200 이다 */

beforeEach(() => applyScenario('signed-out'))

describe('아이디 중복 확인', () => {
  it('아무도 쓰지 않는 아이디는 쓸 수 있다', async () => {
    await expect(fetchUsernameAvailability('newuser1')).resolves.toEqual({ available: true })
  })

  it('있는 아이디는 대소문자·앞뒤 공백과 상관없이 taken 이다', async () => {
    expect(db.accounts[0].session.user.username).toBe('userpm')
    await expect(fetchUsernameAvailability(' UserPM ')).resolves.toEqual({
      available: false,
      reason: 'taken',
    })
  })

  it.each(['abc', 'a'.repeat(21), '아이디입니다', 'user name', 'user_01', ''])(
    '규칙 밖 값 %j 는 오류가 아니라 invalid 다',
    async (value) => {
      await expect(fetchUsernameAvailability(value)).resolves.toEqual({
        available: false,
        reason: 'invalid',
      })
    },
  )

  it('모르는 사유는 상태 판단 값이라 응답을 읽지 못한 것으로 본다 (D-184)', async () => {
    server.use(
      http.get('/api/v1/auth/username-availability', () =>
        ok({ available: false, reason: 'reserved' }),
      ),
    )
    await expect(fetchUsernameAvailability('newuser1')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    })
  })
})
