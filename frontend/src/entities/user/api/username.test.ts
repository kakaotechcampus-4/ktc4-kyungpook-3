import { http } from 'msw'
import { db } from '@/shared/mock/db'
import { ok } from '@/shared/mock/envelope'
import { applyScenario } from '@/shared/mock/scenarios'
import { server } from '@/shared/mock/server'
import { fetchUsernameAvailability, updateUsername } from './username'

/* #627 아이디 중복 확인(BE GET /auth/username-availability, 로그인 없이 늘 200)과 아이디 변경(PATCH /users/me) */

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

describe('아이디 변경', () => {
  beforeEach(() => applyScenario('single-workspace'))

  it('바꾼 사용자 정보를 돌려주고, 다음 /auth/me 에도 남는다', async () => {
    await expect(updateUsername('NewName1')).resolves.toMatchObject({
      id: 'us_01',
      username: 'newname1',
      email: 'pm@example.com',
    })
    expect(db.accounts[0].session.user.username).toBe('newname1')
  })

  it('지금 아이디와 같으면 그대로 200 이다', async () => {
    await expect(updateUsername('userpm')).resolves.toMatchObject({ username: 'userpm' })
  })

  it('남이 쓰는 아이디는 409 USERNAME_TAKEN 이다', async () => {
    applyScenario('username-taken')
    db.authenticated = true
    await expect(updateUsername('minsu')).rejects.toMatchObject({
      status: 409,
      code: 'USERNAME_TAKEN',
    })
  })

  it('규칙 밖이면 400 INVALID_REQUEST 의 username 칸 오류다', async () => {
    await expect(updateUsername('ab')).rejects.toMatchObject({
      status: 400,
      code: 'INVALID_REQUEST',
      details: { fields: [{ loc: ['body', 'username'] }] },
    })
  })

  it('로그인하지 않았으면 401 이다', async () => {
    db.authenticated = false
    await expect(updateUsername('newname1')).rejects.toMatchObject({ status: 401 })
  })
})

describe('#627 시나리오', () => {
  it('username-race: 중복 확인은 쓸 수 있다고 답하지만 바꾸기는 409 다', async () => {
    applyScenario('username-race')
    await expect(fetchUsernameAvailability('newuser1')).resolves.toEqual({ available: true })
    db.authenticated = true
    await expect(updateUsername('newuser1')).rejects.toMatchObject({ code: 'USERNAME_TAKEN' })
  })

  it('kakao-account: 이메일·비밀번호 없는 계정으로 로그인돼 있다', () => {
    applyScenario('kakao-account')
    expect(db.authenticated).toBe(true)
    expect(db.session.user).toMatchObject({ email: null, username: 'userpm' })
    expect(db.accounts[0]).toMatchObject({ password: null, kakaoId: 'kakao-pm' })
  })
})
