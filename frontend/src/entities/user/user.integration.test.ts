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

// 백엔드는 보호된 엔드포인트마다 get_current_user·get_current_member 를 건다.
// MSW 가 db.authenticated 를 /me 만 보고 있어 로그아웃 뒤에도 데이터를 주고 있었다.
// override 로는 덮을 수 없는 차이다 — 기본 동작 전체가 다르기 때문이다
it('stops serving protected endpoints after logout', async () => {
  const base = `${location.origin}/api/v1`
  expect((await fetch(`${base}/workspaces`)).status).toBe(200)

  const loggedOut = await fetch(`${base}/auth/logout`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  })
  expect(loggedOut.status).toBe(200)

  for (const path of [
    '/auth/me',
    '/workspaces',
    '/workspaces/ws_01',
    '/workspaces/ws_01/integrations',
    '/workspaces/ws_01/meetings',
    '/meetings/mt_09/minutes',
  ]) {
    const response = await fetch(`${base}${path}`)
    expect({ path, status: response.status }).toEqual({ path, status: 401 })
  }

  // 로그아웃을 두 번 하면 이미 세션이 없어 401 이다
  expect((await fetch(`${base}/auth/logout`, { method: 'POST' })).status).toBe(401)
})

// 로그인은 됐지만 그 워크스페이스 멤버가 아니면 403 이다 (get_current_member)
it('refuses workspaces the signed-in user does not belong to', async () => {
  const base = `${location.origin}/api/v1`
  for (const path of [
    '/workspaces/ws_99/integrations',
    '/workspaces/ws_99/meetings',
    '/workspaces/ws_99/discord/members',
  ]) {
    const response = await fetch(`${base}${path}`)
    expect({ path, status: response.status }).toEqual({ path, status: 403 })
  }

  // 반면 GET /workspaces/{id} 는 멤버십을 보지 않는다. 실 API 의 구멍을 그대로 흉내낸다 (계약 §4.0-②-1)
  expect((await fetch(`${base}/workspaces/ws_99`)).status).toBe(404)
})
