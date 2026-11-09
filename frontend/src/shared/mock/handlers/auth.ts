import { http } from 'msw'
import { db, loginLimitKey, type MockLoginLimit } from '../db'
import { fail, ok } from '../envelope'
import { requireAuth } from '../auth-guard'
import { accountWithEmail, accountWithUsername, workspaceCountOf } from '../sessions'
import { readJson } from '../utils'
import {
  PYTHON_STRIP,
  checkedUsername,
  invalidBody,
  passwordField,
  stringField,
  usernameField,
} from '../validation'
import type { FieldError } from '../validation'
import { readSignupProof } from './signupCode'

const base = '/api/v1/auth'

const NAME_MAX_LENGTH = 100

/** 제어·서로게이트·줄/문단 구분자와 글자 방향 제어. ZWJ·ZWNJ 는 허용한다 */
const NAME_FORBIDDEN = /[\p{Cc}\p{Cs}\p{Zl}\p{Zp}\u202a-\u202e\u2066-\u2069]/u

/** 형식 문자·결합 부호·공백이 아닌 글자. 이것이 하나도 없는 이름은 빈칸으로 본다 */
const NAME_VISIBLE = /[^\p{Cf}\p{Mn}\p{Me}\p{Z}]/u

/** BE validate_name. 앞뒤 공백을 지운 이름을 돌려주고 규칙에 어긋나면 null 이다. 길이는 코드 포인트로 센다 */
function checkedName(value: string): string | null {
  const name = value.replace(PYTHON_STRIP, '')
  if (!name || [...name].length > NAME_MAX_LENGTH) return null
  return NAME_FORBIDDEN.test(name) || !NAME_VISIBLE.test(name) ? null : name
}

function nameField(body: Record<string, unknown>): FieldError | null {
  const typeError = stringField(body, 'name')
  if (typeError) return typeError
  return checkedName(body.name as string) === null
    ? {
        loc: ['body', 'name'],
        msg: 'Value error, 이름은 앞뒤 공백을 뺀 1~100자이고 제어문자를 포함할 수 없습니다.',
      }
    : null
}

/** BE SignupRequest._check_signup_kind. 칸 검증을 모두 통과한 뒤에만 본다 */
function signupKindError(kakao: boolean, password: boolean, verificationToken: boolean) {
  const msg = kakao
    ? password || verificationToken
      ? 'Value error, 카카오 가입은 비밀번호와 이메일 인증 토큰을 받지 않습니다.'
      : null
    : password
      ? null
      : 'Value error, 이메일 가입은 비밀번호가 필요합니다.'
  return msg === null ? null : invalidBody({ loc: ['body'], msg })
}

const LOGIN_FAILURE_LIMIT = 10

const LOGIN_WINDOW_MS = 15 * 60_000

const LOGIN_BLOCK_MS = 15 * 60_000

/** BE _fresh_view. 막힘이 끝났거나, 막히지 않은 채 첫 실패부터 15분이 지난 행은 없는 것으로 본다 */
function freshLoginLimit(key: string, at: number): MockLoginLimit | null {
  const entry = db.loginLimit[key]
  if (!entry) return null
  return at < (entry.blockedUntil ?? entry.windowStartedAt + LOGIN_WINDOW_MS) ? entry : null
}

/** 소속 수는 응답할 때 센다 — 저장한 세션 값에는 수락한 초대로 생긴 소속이 없다 */
const authResponse = () => ({
  ...db.session,
  workspace_count: workspaceCountOf(db.session.user.user_id),
})

export const authHandlers = [
  http.post(`${base}/signup`, async ({ request }) => {
    const body = (await readJson(request)) ?? {}
    // BE 는 본문 검증(pydantic)이 인증·중복 확인보다 먼저다. 규칙 위반이면 이미 있는 이메일·아이디여도 400 이다
    const has = (key: string) => body[key] !== undefined && body[key] !== null
    const bodyError =
      invalidBody(
        has('password') ? passwordField(body, 'password') : null,
        nameField(body),
        usernameField(body, 'username'),
      ) ?? signupKindError(body.link_kakao === true, has('password'), has('verification_token'))
    if (bodyError) return bodyError
    const name = checkedName(body.name as string) as string
    const username = checkedUsername(body.username as string) as string
    const kakao = body.link_kakao === true ? db.kakao.pending : null
    if (body.link_kakao === true && kakao === null)
      return fail('KAKAO_LINK_EXPIRED', '카카오 로그인 정보가 만료됐습니다.', 400)
    const email = kakao === null ? readSignupProof(body.verification_token) : null
    if (kakao === null && email === null)
      return fail('SIGNUP_VERIFICATION_INVALID', '이메일 인증이 필요합니다.', 400)
    // BE _signup_conflict 의 순서: 이메일 → 카카오 → 아이디
    if (email !== null && accountWithEmail(email))
      return fail('EMAIL_ALREADY_EXISTS', '이미 가입된 이메일입니다.', 409)
    if (kakao !== null && db.accounts.some(({ kakaoId }) => kakaoId === kakao.kakaoId))
      return fail('KAKAO_ALREADY_LINKED', '이미 다른 계정에 연결된 카카오 계정입니다.', 409)
    if (accountWithUsername(username) || db.usernameRace.includes(username))
      return fail('USERNAME_TAKEN', '이미 사용 중인 아이디입니다.', 409)
    db.session = {
      user: {
        user_id: `us_${String(db.accounts.length + db.withdrawals.length + 1).padStart(2, '0')}`,
        username,
        email,
        name,
        avatar_url: null,
      },
      workspace_count: 0,
      last_workspace_id: null,
    }
    db.accounts.push({
      session: structuredClone(db.session),
      password: kakao === null ? (body.password as string) : null,
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
    const email = typeof body.email === 'string' ? body.email : ''
    // passwordReset.ts 처럼 멈춘 now() 가 아니라 흐르는 시계로 본다. 멈춘 시계로는 15분이 끝나지 않는다
    const at = Date.now()
    const key = loginLimitKey(email)
    const limit = freshLoginLimit(key, at)
    const blockedUntil = limit?.blockedUntil ?? null
    if (blockedUntil !== null) {
      // 시나리오는 먼 미래까지 막아 둔다. BE 는 15분을 넘겨 답하지 않는다
      const seconds = Math.min(
        Math.max(Math.ceil((blockedUntil - at) / 1000), 1),
        LOGIN_BLOCK_MS / 1000,
      )
      return fail(
        'TOO_MANY_LOGIN_ATTEMPTS',
        '로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.',
        429,
        { retry_after_seconds: seconds },
        { 'Retry-After': String(seconds) },
      )
    }
    const account = accountWithEmail(email)
    if (!account || body.password !== account.password) {
      // BE _bump 처럼 센 뒤에 본다. 10번째 실패는 401 이고 그다음 시도부터 막힌다
      const failures = (limit?.failures ?? 0) + 1
      db.loginLimit[key] = {
        failures,
        windowStartedAt: limit?.windowStartedAt ?? at,
        blockedUntil: failures >= LOGIN_FAILURE_LIMIT ? at + LOGIN_BLOCK_MS : null,
      }
      return fail('INVALID_CREDENTIALS', '이메일 또는 비밀번호가 올바르지 않습니다.', 401)
    }
    delete db.loginLimit[key]
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
  http.get(`${base}/username-availability`, ({ request }) => {
    const value = new URL(request.url).searchParams.get('username')
    if (value === null)
      return fail('INVALID_REQUEST', '요청이 올바르지 않습니다.', 400, {
        fields: [{ loc: ['query', 'username'], msg: 'Field required' }],
      })
    const username = checkedUsername(value)
    const reason = username === null ? 'invalid' : accountWithUsername(username) ? 'taken' : null
    return ok({ available: reason === null, reason })
  }),
  http.get(`${base}/kakao/pending`, () =>
    db.kakao.pending === null
      ? fail('KAKAO_LINK_EXPIRED', '카카오 로그인 정보가 만료됐습니다.', 400)
      : ok({ nickname: db.kakao.pending.nickname }),
  ),
  http.get(`${base}/me`, () =>
    db.authenticated ? ok(authResponse()) : fail('UNAUTHENTICATED', '로그인이 필요합니다.', 401),
  ),
]
