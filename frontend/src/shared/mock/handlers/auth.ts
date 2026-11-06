import { http } from 'msw'
import { db } from '../db'
import { fail, ok } from '../envelope'
import { requireAuth } from '../auth-guard'
import { workspaceCountOf } from '../sessions'
import { readJson } from '../utils'
import { invalidBody, passwordField, stringField } from '../validation'

const base = '/api/v1/auth'

/** 소속 수는 응답할 때 센다 — 저장한 세션 값에는 수락한 초대로 생긴 소속이 없다 */
const authResponse = () => ({
  ...db.session,
  workspace_count: workspaceCountOf(db.session.user.user_id),
})

export const authHandlers = [
  http.post(`${base}/signup`, async ({ request }) => {
    const body = (await readJson(request)) ?? {}
    // BE 는 본문 검증(pydantic)이 중복 이메일 확인보다 먼저다. 규칙 위반이면 이미 있는 이메일이어도 400 이다
    const bodyError = invalidBody(
      stringField(body, 'email'),
      passwordField(body, 'password'),
      stringField(body, 'name'),
    )
    if (bodyError) return bodyError
    const { email, password, name } = body as { email: string; password: string; name: string }
    if (db.accounts.some((account) => account.session.user.email === email))
      return fail('EMAIL_ALREADY_EXISTS', '이미 가입된 이메일입니다.', 409)
    db.session = {
      user: {
        user_id: `us_${String(db.accounts.length + 1).padStart(2, '0')}`,
        email,
        name,
        avatar_url: null,
      },
      workspace_count: 0,
      last_workspace_id: null,
    }
    db.accounts.push({
      session: structuredClone(db.session),
      password,
      workspaceIds: [],
      memberIds: {},
    })
    db.authenticated = true
    return ok(authResponse(), { status: 201 })
  }),
  http.post(`${base}/login`, async ({ request }) => {
    const body = (await request.json()) as { email?: unknown; password?: unknown }
    const account = db.accounts.find(({ session }) => session.user.email === body.email)
    if (!account || body.password !== account.password)
      return fail('INVALID_CREDENTIALS', '이메일 또는 비밀번호가 올바르지 않습니다.', 401)
    db.session = structuredClone(account.session)
    db.authenticated = true
    return ok(authResponse())
  }),
  http.post(`${base}/logout`, () => {
    const denied = requireAuth()
    if (denied) return denied
    db.authenticated = false
    return ok({})
  }),
  http.get(`${base}/me`, () =>
    db.authenticated ? ok(authResponse()) : fail('UNAUTHENTICATED', '로그인이 필요합니다.', 401),
  ),
]
