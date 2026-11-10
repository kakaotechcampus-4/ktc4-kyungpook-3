import { http } from 'msw'
import { db } from '@/shared/mock/db'
import { ok } from '@/shared/mock/envelope'
import { server } from '@/shared/mock/server'
import { fetchDto, jsonRequest } from '@/shared/test/api'
import { recordRequestBodies } from '@/shared/test/requests'
import { fetchSession } from './session'
import { login, logout, signup } from './auth'
import { confirmSignupCode, requestSignupCode } from './signupCode'

describe('login', () => {
  it('픽스처 계정으로 로그인하면 Session 을 돌려준다', async () => {
    db.authenticated = false
    await expect(login({ email: 'pm@example.com', password: 'mock-password' })).resolves.toEqual({
      user: {
        id: 'us_01',
        username: 'userpm',
        email: 'pm@example.com',
        name: '최진호',
        avatarUrl: null,
      },
      workspaceCount: 2,
      lastWorkspaceId: 'ws_01',
    })
    await expect(fetchSession()).resolves.not.toBeNull()
  })

  it('자격 증명이 틀리면 401 INVALID_CREDENTIALS 로 던진다', async () => {
    await expect(login({ email: 'pm@example.com', password: 'wrong' })).rejects.toMatchObject({
      kind: 'http',
      status: 401,
      code: 'INVALID_CREDENTIALS',
    })
  })

  it('LoginRequest 모양 { email, password } 로 보낸다', async () => {
    const bodies = recordRequestBodies('POST', '/auth/login')
    await login({ email: 'pm@example.com', password: 'mock-password' })
    await vi.waitFor(() =>
      expect(bodies).toEqual([{ email: 'pm@example.com', password: 'mock-password' }]),
    )
  })
})

describe('signup', () => {
  async function verifiedToken(email: string): Promise<string> {
    await requestSignupCode(email)
    const code = db.signupVerification.outbox.at(-1)?.code ?? ''
    return confirmSignupCode({ email, code })
  }

  const profile = { name: '새 사용자', password: 'pass1234', username: 'newuser1' }

  async function emailSignup(overrides: Partial<typeof profile> = {}, email = 'new@example.com') {
    return signup({
      kind: 'email',
      ...profile,
      ...overrides,
      verificationToken: await verifiedToken(email),
    })
  }

  it('가입하면 공간 0개의 Session 으로 로그인되고 아이디가 있다', async () => {
    const session = await emailSignup()
    expect(session).toMatchObject({
      user: { email: 'new@example.com', name: '새 사용자', username: 'newuser1' },
      workspaceCount: 0,
      lastWorkspaceId: null,
    })
    await expect(fetchSession()).resolves.toMatchObject({ user: { username: 'newuser1' } })
  })

  it('이메일 가입은 { verification_token, password, name, username } 로 보낸다. 이메일·link_kakao 는 없다', async () => {
    const verificationToken = await verifiedToken('new@example.com')
    const bodies = recordRequestBodies('POST', '/auth/signup')
    await signup({ kind: 'email', ...profile, verificationToken })
    await vi.waitFor(() =>
      expect(bodies).toEqual([
        {
          verification_token: verificationToken,
          password: 'pass1234',
          name: '새 사용자',
          username: 'newuser1',
        },
      ]),
    )
  })

  it('증명 없이는 400 SIGNUP_VERIFICATION_INVALID 다', async () => {
    await expect(
      signup({ kind: 'email', ...profile, verificationToken: 'forged' }),
    ).rejects.toMatchObject({ status: 400, code: 'SIGNUP_VERIFICATION_INVALID' })
  })

  it('만료된 증명은 400 SIGNUP_VERIFICATION_INVALID 다', async () => {
    const verificationToken = await verifiedToken('new@example.com')
    db.signupVerification.proofs[verificationToken].expiresAt = 0
    await expect(signup({ kind: 'email', ...profile, verificationToken })).rejects.toMatchObject({
      code: 'SIGNUP_VERIFICATION_INVALID',
    })
  })

  it('증명을 받은 뒤 같은 이메일이 가입되면 409 EMAIL_ALREADY_EXISTS 다', async () => {
    const verificationToken = await verifiedToken('new@example.com')
    await signup({ kind: 'email', ...profile, verificationToken })
    await expect(
      signup({ kind: 'email', ...profile, username: 'another1', verificationToken }),
    ).rejects.toMatchObject({ status: 409, code: 'EMAIL_ALREADY_EXISTS' })
  })

  it('이미 있는 아이디는 대소문자와 상관없이 409 USERNAME_TAKEN 이다. 이메일도 겹치면 이메일이 먼저다', async () => {
    await expect(emailSignup({ username: 'UserPM' })).rejects.toMatchObject({
      status: 409,
      code: 'USERNAME_TAKEN',
    })
    await expect(emailSignup({ username: 'userpm' }, 'pm@example.com')).rejects.toMatchObject({
      code: 'EMAIL_ALREADY_EXISTS',
    })
  })

  it('아이디는 앞뒤 공백을 지우고 소문자로 저장한다', async () => {
    await expect(emailSignup({ username: '  NewUser1 ' })).resolves.toMatchObject({
      user: { username: 'newuser1' },
    })
  })

  it('규칙 밖 아이디는 400 INVALID_REQUEST 의 username 칸 오류다', async () => {
    await expect(emailSignup({ username: 'ab' })).rejects.toMatchObject({
      status: 400,
      code: 'INVALID_REQUEST',
      details: { fields: [{ loc: ['body', 'username'] }] },
    })
  })

  describe('카카오 가입', () => {
    const pending = { kakaoId: 'kakao-1', nickname: '카카오' }
    const kakaoProfile = { kind: 'kakao', name: '카카오 사용자', username: 'kakaouser' } as const

    it('{ link_kakao, name, username } 만 보내고 이메일·비밀번호 없는 계정을 만들어 카카오를 잇는다', async () => {
      db.kakao.pending = pending
      const bodies = recordRequestBodies('POST', '/auth/signup')
      await expect(signup(kakaoProfile)).resolves.toMatchObject({
        user: { email: null, username: 'kakaouser', name: '카카오 사용자' },
      })
      await vi.waitFor(() =>
        expect(bodies).toEqual([
          { link_kakao: true, name: '카카오 사용자', username: 'kakaouser' },
        ]),
      )
      expect(db.accounts.at(-1)).toMatchObject({ kakaoId: 'kakao-1', password: null })
      expect(db.kakao.pending).toBeNull()
    })

    it('대기가 없으면 400 KAKAO_LINK_EXPIRED 다', async () => {
      await expect(signup(kakaoProfile)).rejects.toMatchObject({
        status: 400,
        code: 'KAKAO_LINK_EXPIRED',
      })
    })

    it('같은 카카오가 이미 이어져 있으면 409 KAKAO_ALREADY_LINKED 다. 아이디도 겹치면 카카오가 먼저다', async () => {
      db.accounts[0].kakaoId = 'kakao-1'
      db.kakao.pending = pending
      await expect(signup({ ...kakaoProfile, username: 'userpm' })).rejects.toMatchObject({
        status: 409,
        code: 'KAKAO_ALREADY_LINKED',
      })
    })

    it('카카오 가입에 비밀번호나 증명을 보내면 400 INVALID_REQUEST 다', async () => {
      db.kakao.pending = pending
      const raw = (extra: Record<string, unknown>) =>
        fetchDto(
          '/auth/signup',
          jsonRequest('POST', {
            link_kakao: true,
            name: '카카오',
            username: 'kakaouser',
            ...extra,
          }),
        )
      await expect(raw({ password: 'pass1234' })).rejects.toMatchObject({
        status: 400,
        code: 'INVALID_REQUEST',
      })
      await expect(raw({ verification_token: 'proof' })).rejects.toMatchObject({
        status: 400,
        code: 'INVALID_REQUEST',
      })
      expect(db.kakao.pending).toEqual(pending)
    })
  })

  it('비밀번호가 규칙에 어긋나면 이미 있는 이메일이어도 409 가 아니라 400 INVALID_REQUEST 다', async () => {
    const verificationToken = await verifiedToken('new@example.com')
    await signup({ kind: 'email', ...profile, verificationToken })
    const again = { kind: 'email', ...profile, username: 'another1', verificationToken } as const
    await expect(signup(again)).rejects.toMatchObject({ code: 'EMAIL_ALREADY_EXISTS' })

    await expect(signup({ ...again, password: 'abcdefgh' })).rejects.toMatchObject({
      status: 400,
      code: 'INVALID_REQUEST',
      details: {
        fields: [
          {
            loc: ['body', 'password'],
            msg: 'Value error, 비밀번호는 8자 이상이고 숫자를 하나 이상 포함해야 합니다.',
          },
        ],
      },
    })
  })
})

describe('logout', () => {
  it('서버 세션을 지운다. 이후 세션 조회는 비로그인이다', async () => {
    await expect(logout()).resolves.toBeUndefined()
    await expect(fetchSession()).resolves.toBeNull()
  })

  it('실패는 그대로 던진다 — 호출자가 캐시를 지우지 않게 한다', async () => {
    server.use(http.post('/api/v1/auth/logout', () => ok({}, { status: 500 })))
    await expect(logout()).rejects.toMatchObject({ kind: 'http', status: 500 })
  })
})
