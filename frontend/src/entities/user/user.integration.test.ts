import { unwrap } from '@/shared/api/envelope'
import { toSession } from './model/mapper'
import type { Envelope } from '@/shared/types/api/envelope'
import type { SessionDto } from '@/shared/types/api/auth'

it('logs in with the documented mock credentials and returns a mapped session', async () => {
  const response = await fetch('http://localhost:3000/api/v1/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'pm@example.com', password: 'mock-password' }),
  })
  const envelope = (await response.json()) as Envelope<SessionDto>
  expect(response.status).toBe(200)
  expect(toSession(unwrap(envelope, response.status))).toMatchObject({
    user: { id: 'us_01' },
    workspaceCount: 2,
  })
})

it('covers signup conflict, invalid login, session lookup, and logout', async () => {
  const signup = await fetch('http://localhost:3000/api/v1/auth/signup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'pm@example.com', password: 'mock-password', name: '최진호' }),
  })
  const signupBody = (await signup.json()) as Envelope<SessionDto>
  expect(() => unwrap(signupBody, signup.status)).toThrow('이미 가입된 이메일입니다.')
  expect(signup.status).toBe(409)
  const invalid = await fetch('http://localhost:3000/api/v1/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'pm@example.com', password: 'wrong' }),
  })
  expect(invalid.status).toBe(401)
  const me = await fetch('http://localhost:3000/api/v1/auth/me')
  expect(toSession(unwrap((await me.json()) as Envelope<SessionDto>, me.status)).user.name).toBe(
    '최진호',
  )
  await fetch('http://localhost:3000/api/v1/auth/logout', { method: 'POST' })
  const afterLogout = await fetch('http://localhost:3000/api/v1/auth/me')
  expect(afterLogout.status).toBe(401)
})

it('keeps existing accounts after signup and accepts the new account password', async () => {
  const send = (path: string, body: unknown) =>
    fetch(`${location.origin}/api/v1/auth/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  const signup = await send('signup', {
    email: 'new@example.com',
    password: 'new-password',
    name: '새 팀원',
  })
  expect(
    toSession(unwrap((await signup.json()) as Envelope<SessionDto>, signup.status)),
  ).toMatchObject({ workspaceCount: 0, lastWorkspaceId: null })
  expect(
    (await send('signup', { email: 'pm@example.com', password: 'x', name: '중복' })).status,
  ).toBe(409)
  expect((await send('login', { email: 'new@example.com', password: 'new-password' })).status).toBe(
    200,
  )
  expect((await send('login', { email: 'pm@example.com', password: 'mock-password' })).status).toBe(
    200,
  )
})
