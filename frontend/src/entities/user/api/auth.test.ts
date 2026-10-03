import { http } from 'msw'
import { db } from '@/shared/mock/db'
import { ok } from '@/shared/mock/envelope'
import { server } from '@/shared/mock/server'
import { recordRequestBodies } from '@/shared/test/requests'
import { fetchSession } from './session'
import { login, logout, signup } from './auth'

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
  it('가입하면 공간 0개의 Session 으로 로그인된다', async () => {
    const session = await signup({
      name: '새 사용자',
      email: 'new@example.com',
      password: 'pass1234',
    })
    expect(session).toMatchObject({
      user: { email: 'new@example.com', name: '새 사용자' },
      workspaceCount: 0,
      lastWorkspaceId: null,
    })
    await expect(fetchSession()).resolves.toMatchObject({ user: { email: 'new@example.com' } })
  })

  it('SignupRequest 모양 { email, password, name } 으로 보낸다', async () => {
    const bodies = recordRequestBodies('POST', '/auth/signup')
    await signup({ name: '새 사용자', email: 'new@example.com', password: 'pass1234' })
    await vi.waitFor(() =>
      expect(bodies).toEqual([
        { email: 'new@example.com', password: 'pass1234', name: '새 사용자' },
      ]),
    )
  })

  it('이미 있는 이메일은 409 EMAIL_ALREADY_EXISTS 로 던진다', async () => {
    await expect(
      signup({ name: '중복', email: 'pm@example.com', password: 'pass1234' }),
    ).rejects.toMatchObject({ status: 409, code: 'EMAIL_ALREADY_EXISTS' })
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
