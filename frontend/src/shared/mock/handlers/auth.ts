import { http } from 'msw'
import { db } from '../db'
import { fail, ok } from '../envelope'
import { requireAuth } from '../auth-guard'

const base = '/api/v1/auth'
export const authHandlers = [
  http.post(`${base}/signup`, async ({ request }) => {
    const body = (await request.json()) as { email?: unknown; password?: unknown; name?: unknown }
    if (
      typeof body.email === 'string' &&
      db.accounts.some((account) => account.session.user.email === body.email)
    )
      return fail('EMAIL_ALREADY_EXISTS', '이미 가입된 이메일입니다.', 409)
    if (
      typeof body.email !== 'string' ||
      typeof body.password !== 'string' ||
      typeof body.name !== 'string'
    )
      return fail('INVALID_REQUEST', '요청이 올바르지 않습니다.', 400)
    db.session = {
      user: {
        user_id: `us_${String(db.accounts.length + 1).padStart(2, '0')}`,
        email: body.email,
        name: body.name,
        avatar_url: null,
      },
      workspace_count: 0,
      last_workspace_id: null,
    }
    db.accounts.push({
      session: structuredClone(db.session),
      password: body.password,
      workspaceIds: [],
    })
    db.authenticated = true
    return ok(db.session, { status: 201 })
  }),
  http.post(`${base}/login`, async ({ request }) => {
    const body = (await request.json()) as { email?: unknown; password?: unknown }
    const account = db.accounts.find(({ session }) => session.user.email === body.email)
    if (!account || body.password !== account.password)
      return fail('INVALID_CREDENTIALS', '이메일 또는 비밀번호가 올바르지 않습니다.', 401)
    db.session = structuredClone(account.session)
    db.authenticated = true
    return ok(db.session)
  }),
  http.post(`${base}/logout`, () => {
    const denied = requireAuth()
    if (denied) return denied
    db.authenticated = false
    return ok({})
  }),
  http.get(`${base}/me`, () =>
    db.authenticated ? ok(db.session) : fail('UNAUTHENTICATED', '로그인이 필요합니다.', 401),
  ),
]
