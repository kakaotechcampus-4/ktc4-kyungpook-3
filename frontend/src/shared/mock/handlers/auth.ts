import { http } from 'msw'
import { db } from '../db'
import { fail, ok } from '../envelope'
import { requireAuth } from '../auth-guard'
import { accountWithEmail, workspaceCountOf } from '../sessions'
import { readJson } from '../utils'
import { readSignupProof } from './signupCode'

const base = '/api/v1/auth'

/** 소속 수는 응답할 때 센다 — 저장한 세션 값에는 수락한 초대로 생긴 소속이 없다 */
const authResponse = () => ({
  ...db.session,
  workspace_count: workspaceCountOf(db.session.user.user_id),
})

export const authHandlers = [
  http.post(`${base}/signup`, async ({ request }) => {
    const body = (await readJson(request)) ?? {}
    if (typeof body.password !== 'string' || typeof body.name !== 'string')
      return fail('INVALID_REQUEST', '요청이 올바르지 않습니다.', 400)
    const kakao = body.link_kakao === true ? db.kakao.pending : null
    if (body.link_kakao === true && kakao === null)
      return fail('KAKAO_LINK_EXPIRED', '카카오 로그인 정보가 만료됐습니다.', 400)
    const email = kakao?.email ?? readSignupProof(body.verification_token)
    if (email === null) return fail('SIGNUP_VERIFICATION_INVALID', '이메일 인증이 필요합니다.', 400)
    if (accountWithEmail(email))
      return fail('EMAIL_ALREADY_EXISTS', '이미 가입된 이메일입니다.', 409)
    if (kakao !== null && db.accounts.some(({ kakaoId }) => kakaoId === kakao.kakaoId))
      return fail('KAKAO_ALREADY_LINKED', '이미 다른 계정에 연결된 카카오 계정입니다.', 409)
    db.session = {
      user: {
        user_id: `us_${String(db.accounts.length + 1).padStart(2, '0')}`,
        email,
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
      memberIds: {},
      ...(kakao === null ? {} : { kakaoId: kakao.kakaoId }),
    })
    db.authenticated = true
    db.kakao.pending = null
    return ok(authResponse(), { status: 201 })
  }),
  http.post(`${base}/login`, async ({ request }) => {
    const body = (await request.json()) as { email?: unknown; password?: unknown }
    const account = typeof body.email === 'string' ? accountWithEmail(body.email) : undefined
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
  http.get(`${base}/kakao/pending`, () =>
    db.kakao.pending === null
      ? fail('KAKAO_LINK_EXPIRED', '카카오 로그인 정보가 만료됐습니다.', 400)
      : ok({ email: db.kakao.pending.email, nickname: db.kakao.pending.nickname }),
  ),
  http.get(`${base}/me`, () =>
    db.authenticated ? ok(authResponse()) : fail('UNAUTHENTICATED', '로그인이 필요합니다.', 401),
  ),
]
