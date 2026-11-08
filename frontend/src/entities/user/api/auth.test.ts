import { http } from 'msw'
import { db } from '@/shared/mock/db'
import { ok } from '@/shared/mock/envelope'
import { server } from '@/shared/mock/server'
import { recordRequestBodies } from '@/shared/test/requests'
import { fetchSession } from './session'
import { login, logout, signup } from './auth'
import { confirmSignupCode, requestSignupCode } from './signupCode'

describe('login', () => {
  it('픽스처 계정으로 로그인하면 Session 을 돌려준다', async () => {
    db.authenticated = false
    await expect(login({ email: 'pm@example.com', password: 'mock-password' })).resolves.toEqual({
      user: { id: 'us_01', email: 'pm@example.com', name: '최진호', avatarUrl: null },
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

  const profile = { name: '새 사용자', password: 'pass1234', linkKakao: false }

  it('가입하면 공간 0개의 Session 으로 로그인된다', async () => {
    const session = await signup({
      ...profile,
      verificationToken: await verifiedToken('new@example.com'),
    })
    expect(session).toMatchObject({
      user: { email: 'new@example.com', name: '새 사용자' },
      workspaceCount: 0,
      lastWorkspaceId: null,
    })
    await expect(fetchSession()).resolves.toMatchObject({ user: { email: 'new@example.com' } })
  })

  it('SignupRequest 모양 { verification_token, password, name, link_kakao } 으로 보낸다. 이메일은 없다', async () => {
    const verificationToken = await verifiedToken('new@example.com')
    const bodies = recordRequestBodies('POST', '/auth/signup')
    await signup({ ...profile, verificationToken })
    await vi.waitFor(() =>
      expect(bodies).toEqual([
        {
          verification_token: verificationToken,
          password: 'pass1234',
          name: '새 사용자',
          link_kakao: false,
        },
      ]),
    )
  })

  it('증명 없이는 400 SIGNUP_VERIFICATION_INVALID 다', async () => {
    await expect(signup({ ...profile, verificationToken: 'forged' })).rejects.toMatchObject({
      status: 400,
      code: 'SIGNUP_VERIFICATION_INVALID',
    })
  })

  it('만료된 증명은 400 SIGNUP_VERIFICATION_INVALID 다', async () => {
    const verificationToken = await verifiedToken('new@example.com')
    db.signupVerification.proofs[verificationToken].expiresAt = 0
    await expect(signup({ ...profile, verificationToken })).rejects.toMatchObject({
      code: 'SIGNUP_VERIFICATION_INVALID',
    })
  })

  it('증명을 받은 뒤 같은 이메일이 가입되면 409 EMAIL_ALREADY_EXISTS 다', async () => {
    const verificationToken = await verifiedToken('new@example.com')
    await signup({ ...profile, verificationToken })
    await expect(signup({ ...profile, verificationToken })).rejects.toMatchObject({
      status: 409,
      code: 'EMAIL_ALREADY_EXISTS',
    })
  })

  describe('카카오 연결', () => {
    const pending = { kakaoId: 'kakao-1', email: 'kakao@example.com', nickname: '카카오' }
    const kakaoProfile = { ...profile, verificationToken: null, linkKakao: true }

    it('대기의 인증된 이메일로 만들고 계정에 잇는다. 토큰을 보내지 않는다', async () => {
      db.kakao.pending = pending
      const bodies = recordRequestBodies('POST', '/auth/signup')
      await expect(signup(kakaoProfile)).resolves.toMatchObject({
        user: { email: 'kakao@example.com' },
      })
      await vi.waitFor(() =>
        expect(bodies).toEqual([{ password: 'pass1234', name: '새 사용자', link_kakao: true }]),
      )
      expect(db.accounts.at(-1)?.kakaoId).toBe('kakao-1')
      expect(db.kakao.pending).toBeNull()
    })

    it('대기가 없으면 400 KAKAO_LINK_EXPIRED 다', async () => {
      await expect(signup(kakaoProfile)).rejects.toMatchObject({
        status: 400,
        code: 'KAKAO_LINK_EXPIRED',
      })
    })

    it('대기에 이메일이 없으면 코드 증명이 있어야 한다', async () => {
      db.kakao.pending = { ...pending, email: null }
      await expect(signup(kakaoProfile)).rejects.toMatchObject({
        code: 'SIGNUP_VERIFICATION_INVALID',
      })
      const verificationToken = await verifiedToken('new@example.com')
      await expect(signup({ ...kakaoProfile, verificationToken })).resolves.toMatchObject({
        user: { email: 'new@example.com' },
      })
      expect(db.accounts.at(-1)?.kakaoId).toBe('kakao-1')
    })

    it('같은 카카오가 이미 이어져 있으면 409 KAKAO_ALREADY_LINKED 다', async () => {
      db.accounts[0].kakaoId = 'kakao-1'
      db.kakao.pending = pending
      await expect(signup(kakaoProfile)).rejects.toMatchObject({
        status: 409,
        code: 'KAKAO_ALREADY_LINKED',
      })
    })
  })

  it('비밀번호가 규칙에 어긋나면 이미 있는 이메일이어도 409 가 아니라 400 INVALID_REQUEST 다', async () => {
    const existing = { ...profile, verificationToken: null, linkKakao: true }
    db.kakao.pending = { kakaoId: 'kakao-1', email: 'pm@example.com', nickname: null }
    await expect(signup(existing)).rejects.toMatchObject({ code: 'EMAIL_ALREADY_EXISTS' })

    await expect(signup({ ...existing, password: 'abcdefgh' })).rejects.toMatchObject({
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
