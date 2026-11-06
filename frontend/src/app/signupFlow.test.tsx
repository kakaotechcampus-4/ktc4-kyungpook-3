import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { SESSION_QUERY_KEY } from '@/entities/user'
import { AUTH_MESSAGES } from '@/features/auth'
import { paths } from '@/shared/config/routes'
import { leaveApp } from '@/shared/lib/location'
import { readReturnWorkspace, rememberReturnWorkspace } from '@/shared/lib/return-workspace'
import { db } from '@/shared/mock/db'
import { fail } from '@/shared/mock/envelope'
import { applyScenario } from '@/shared/mock/scenarios'
import { server } from '@/shared/mock/server'
import { deferred } from '@/shared/test/deferred'
import { recordRequestBodies, recordRequests } from '@/shared/test/requests'
import { renderApp } from './test/renderApp'
import { enterMailedCode, walkSignup } from './test/walkSignup'

/* #427 이메일 → 코드 → 프로필 가입과 카카오 연결 가입. 제품과 같은 배선(renderApp)에 MSW + 실제 request 경로다 */

vi.mock('@/shared/lib/location', () => ({ leaveApp: vi.fn() }))

const NEXT = paths.tasks('ws_01', 'tk_01')

const NEW_USER = { name: '새 사용자', email: 'new@example.com', password: 'pass1234' }

const KAKAO = { kakaoId: 'kakao-1', email: 'kakao@example.com', nickname: '카카오 닉네임' }

const click = (name: string | RegExp) => userEvent.click(screen.getByRole('button', { name }))

const posts = (log: ReturnType<typeof recordRequests>, path: string) =>
  log.started.filter((request) => request.method === 'POST' && request.path === path)

async function openSignup(path: string = paths.signup()) {
  const app = renderApp(path)
  await screen.findByRole('heading', { name: '회원가입' })
  return app
}

async function submitEmail(email: string) {
  await userEvent.type(screen.getByLabelText('이메일'), email)
  await click('인증 코드 받기')
}

async function reachCode(email: string = NEW_USER.email) {
  await submitEmail(email)
  return screen.findByLabelText('인증 코드')
}

async function reachProfile(email: string = NEW_USER.email) {
  await reachCode(email)
  await enterMailedCode()
  await screen.findByLabelText('이름')
}

function wrongCode(): string {
  return db.signupVerification.outbox.at(-1)?.code === '000000' ? '000001' : '000000'
}

async function enterWrongCode() {
  await userEvent.clear(screen.getByLabelText('인증 코드'))
  await userEvent.type(screen.getByLabelText('인증 코드'), wrongCode())
  await click('코드 확인')
}

beforeEach(() => {
  applyScenario('signed-out')
  vi.mocked(leaveApp).mockClear()
})

describe('이메일 단계', () => {
  it('처음에는 이메일만 묻는다. 이름·비밀번호는 코드를 확인한 뒤다', async () => {
    await openSignup()
    expect(screen.getByLabelText('이메일')).toHaveAttribute('type', 'email')
    expect(screen.queryByLabelText('이름')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('비밀번호')).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.queryByText(/이용약관|개인정보 처리방침/)).not.toBeInTheDocument()
  })

  it('빈 값은 입력 아래에 알리고 요청하지 않는다', async () => {
    const log = recordRequests()
    await openSignup()
    await click('인증 코드 받기')
    const email = screen.getByLabelText('이메일')
    await waitFor(() => expect(email).toHaveAttribute('aria-invalid', 'true'))
    expect(email).toHaveAccessibleDescription(AUTH_MESSAGES.emailRequired)
    expect(email).toHaveFocus()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(posts(log, '/auth/signup/code')).toHaveLength(0)
  })

  it('이미 가입된 이메일: 칸 아래에 알리고 포커스를 옮긴다. 로그인 링크가 있고 고치면 풀린다', async () => {
    const app = await openSignup()
    await submitEmail('pm@example.com')

    const email = screen.getByLabelText('이메일')
    await waitFor(() => expect(email).toHaveAttribute('aria-invalid', 'true'))
    expect(email).toHaveAccessibleDescription('이미 가입된 이메일이에요.')
    expect(email).toHaveFocus()
    expect(screen.getByRole('link', { name: '로그인' })).toHaveAttribute('href', '/login')
    await app.expectPath('/signup')

    await userEvent.clear(email)
    await userEvent.type(email, 'other@example.com')
    await waitFor(() => expect(email).not.toHaveAttribute('aria-invalid'))
  })

  it('방금 보낸 이메일(429 cooldown)은 실패가 아니라 코드 단계로 간다', async () => {
    await openSignup()
    await reachCode()
    await click('이메일 바꾸기')

    await submitEmail(NEW_USER.email)
    expect(await screen.findByLabelText('인증 코드')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^다시 보내기 \(\d+초\)$/ })).toBeDisabled()
    expect(db.signupVerification.outbox).toHaveLength(1)
  })

  it('한 시간 제한(429 hourly)은 폼 상단에 알리고 이메일 단계에 남는다', async () => {
    server.use(
      http.post('/api/v1/auth/signup/code', () =>
        fail('SIGNUP_CODE_RATE_LIMITED', 'x', 429, { reason: 'hourly', retry_after: 1800 }),
      ),
    )
    await openSignup()
    await submitEmail(NEW_USER.email)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '인증 코드를 너무 자주 요청했어요. 잠시 뒤 다시 시도해 주세요.',
    )
    expect(screen.getByLabelText('이메일')).toHaveValue(NEW_USER.email)
  })

  it('메일을 보낼 수 없으면 폼 상단에 알린다', async () => {
    db.passwordReset.failure = 'mail-unavailable'
    await openSignup()
    await submitEmail(NEW_USER.email)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '지금은 메일을 보낼 수 없어요. 잠시 뒤 다시 시도해 주세요.',
    )
  })
})

describe('코드 단계', () => {
  it('보낸 주소를 보이고 코드 칸으로 포커스를 옮긴다', async () => {
    await openSignup()
    const code = await reachCode()
    expect(screen.getByRole('status')).toHaveTextContent(
      'new@example.com 주소로 6자리 코드를 보냈어요.',
    )
    await waitFor(() => expect(code).toHaveFocus())
  })

  it('여섯 자리가 아니면 요청하지 않는다', async () => {
    const log = recordRequests()
    await openSignup()
    const code = await reachCode()
    await userEvent.type(code, '123')
    await click('코드 확인')
    await waitFor(() => expect(code).toHaveAccessibleDescription(AUTH_MESSAGES.codeFormat))
    expect(posts(log, '/auth/signup/code/confirm')).toHaveLength(0)
  })

  it('틀리면 남은 횟수를 보이고 칸에 머문다. 횟수를 다 쓰면 새 코드를 받으라고 한다', async () => {
    await openSignup()
    const code = await reachCode()
    await enterWrongCode()
    await waitFor(() =>
      expect(code).toHaveAccessibleDescription('코드가 맞지 않아요. 4번 더 입력할 수 있어요.'),
    )
    expect(code).toHaveFocus()

    for (const left of [3, 2, 1]) {
      await enterWrongCode()
      await waitFor(() =>
        expect(code).toHaveAccessibleDescription(
          `코드가 맞지 않아요. ${left}번 더 입력할 수 있어요.`,
        ),
      )
    }
    await enterWrongCode()
    await waitFor(() =>
      expect(code).toHaveAccessibleDescription('코드가 맞지 않아요. 새 코드를 받아 주세요.'),
    )
    await enterWrongCode()
    await waitFor(() =>
      expect(code).toHaveAccessibleDescription('입력 횟수를 모두 썼어요. 새 코드를 받아 주세요.'),
    )
    expect(screen.getByRole('button', { name: /^다시 보내기/ })).toBeInTheDocument()
  })

  it('만료되면 코드 단계에 남고 다시 보내기가 있다', async () => {
    await openSignup()
    const code = await reachCode()
    db.signupVerification.codes[NEW_USER.email].expiresAt = 0
    await userEvent.type(code, '123456')
    await click('코드 확인')
    await waitFor(() =>
      expect(code).toHaveAccessibleDescription(
        '코드 유효 시간(10분)이 지났어요. 새 코드를 받아 주세요.',
      ),
    )
    expect(screen.getByRole('button', { name: /^다시 보내기/ })).toBeInTheDocument()
  })

  it('이메일 바꾸기: 이메일 단계로 돌아간다', async () => {
    await openSignup()
    await reachCode()
    await click('이메일 바꾸기')
    expect(await screen.findByRole('button', { name: '인증 코드 받기' })).toBeInTheDocument()
    expect(screen.queryByLabelText('인증 코드')).not.toBeInTheDocument()
  })

  it('네트워크 실패는 폼 상단에 알리고 입력을 지키며 다시 제출할 수 있다', async () => {
    server.use(
      http.post('/api/v1/auth/signup/code/confirm', () => fail('INTERNAL_ERROR', 'x', 500), {
        once: true,
      }),
    )
    await openSignup()
    const code = await reachCode()
    await enterMailedCode()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '서버에 문제가 생겼어요. 잠시 후 다시 시도해 주세요.',
    )
    expect(code).not.toHaveValue('')
    await click('코드 확인')
    expect(await screen.findByLabelText('이름')).toBeInTheDocument()
  })
})

describe('다시 보내기', () => {
  /* 화면 시계와 모의 서버가 함께 Date.now() 를 본다. Date 만 바꾸고 1초 간격은 실제로 돈다 */
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], now: Date.parse('2026-11-06T09:00:00Z') })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  async function reachCodeWithCountdown() {
    await openSignup()
    await reachCode()
    return screen.getByRole('button', { name: /^다시 보내기/ })
  }

  it('60초를 세고 지나면 누를 수 있다. 새 코드를 보내고 입력을 비운 뒤 다시 센다', async () => {
    const resend = await reachCodeWithCountdown()
    expect(resend).toBeDisabled()
    expect(resend).toHaveTextContent('다시 보내기 (60초)')

    await userEvent.type(screen.getByLabelText('인증 코드'), '111111')
    vi.setSystemTime(Date.now() + 60_000)
    await waitFor(() => expect(resend).toBeEnabled(), { timeout: 2000 })
    await userEvent.click(resend)

    expect(await screen.findByRole('status')).toHaveTextContent(
      'new@example.com 주소로 새 코드를 보냈어요.',
    )
    expect(db.signupVerification.outbox).toHaveLength(2)
    expect(screen.getByLabelText('인증 코드')).toHaveValue('')
    expect(screen.getByRole('button', { name: /^다시 보내기/ })).toHaveTextContent(
      '다시 보내기 (60초)',
    )
  })

  it('누르는 사이 서버 제한(cooldown)이 남아 있으면 그 초를 다시 센다', async () => {
    await reachCodeWithCountdown()
    vi.setSystemTime(Date.now() + 60_000)
    const resend = screen.getByRole('button', { name: /^다시 보내기/ })
    await waitFor(() => expect(resend).toBeEnabled(), { timeout: 2000 })
    server.use(
      http.post(
        '/api/v1/auth/signup/code',
        () => fail('SIGNUP_CODE_RATE_LIMITED', 'x', 429, { reason: 'cooldown', retry_after: 7 }),
        { once: true },
      ),
    )
    await userEvent.click(resend)
    expect(await screen.findByRole('button', { name: '다시 보내기 (7초)' })).toBeDisabled()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('한 시간 제한은 폼 상단에 알리고 코드 단계에 남는다', async () => {
    await reachCodeWithCountdown()
    vi.setSystemTime(Date.now() + 60_000)
    const resend = screen.getByRole('button', { name: /^다시 보내기/ })
    await waitFor(() => expect(resend).toBeEnabled(), { timeout: 2000 })
    server.use(
      http.post(
        '/api/v1/auth/signup/code',
        () => fail('SIGNUP_CODE_RATE_LIMITED', 'x', 429, { reason: 'hourly', retry_after: 1800 }),
        { once: true },
      ),
    )
    await userEvent.click(resend)
    expect(await screen.findByRole('alert')).toHaveTextContent('인증 코드를 너무 자주 요청했어요.')
    expect(screen.getByLabelText('인증 코드')).toBeInTheDocument()
  })
})

describe('프로필 단계', () => {
  it('가입 성공: 이메일 없이 증명 토큰으로 보내고 시작 작업 선택으로 간다', async () => {
    const bodies = recordRequestBodies('POST', '/auth/signup')
    const log = recordRequests()
    const app = await openSignup()
    await walkSignup(NEW_USER)

    expect(await screen.findByRole('heading', { name: '어떻게 시작할까요?' })).toBeInTheDocument()
    await app.expectPath('/onboarding/start')
    expect(app.queryClient.getQueryData(SESSION_QUERY_KEY)).toMatchObject({
      user: { email: NEW_USER.email, name: NEW_USER.name },
      workspaceCount: 0,
    })
    expect(bodies).toEqual([
      {
        verification_token: Object.keys(db.signupVerification.proofs)[0],
        password: NEW_USER.password,
        name: NEW_USER.name,
        link_kakao: false,
      },
    ])
    // 목록을 확보한 뒤에 옮긴다
    const signupAt = log.timeline.indexOf('answer POST /auth/signup')
    expect(log.timeline.indexOf('start GET /workspaces', signupAt)).toBeGreaterThan(signupAt)
  })

  it('인증한 이메일을 고칠 수 없게 보여 주고 이메일 바꾸기로 돌아갈 수 있다', async () => {
    await openSignup()
    await reachProfile()
    expect(screen.getByLabelText('이메일')).toHaveValue(NEW_USER.email)
    expect(screen.getByLabelText('이메일')).toHaveAttribute('readonly')
    await waitFor(() => expect(screen.getByLabelText('이름')).toHaveFocus())

    await click('이메일 바꾸기')
    expect(await screen.findByRole('button', { name: '인증 코드 받기' })).toBeInTheDocument()
  })

  it('이름·비밀번호 규칙을 입력 아래에 알린다. 보기 토글과 규칙 안내가 있다', async () => {
    await openSignup()
    await reachProfile()
    await click('계정 만들기')

    const name = screen.getByLabelText('이름')
    await waitFor(() => expect(name).toHaveAccessibleDescription(AUTH_MESSAGES.nameRequired))
    const password = screen.getByLabelText('비밀번호')
    expect(password).toHaveAccessibleDescription(
      `8자 이상, 숫자 포함 ${AUTH_MESSAGES.passwordRequired}`,
    )
    await click('비밀번호 보기')
    expect(password).toHaveAttribute('type', 'text')
    await userEvent.type(password, 'abcdefgh')
    await userEvent.tab()
    await waitFor(() =>
      expect(password).toHaveAccessibleDescription(
        `8자 이상, 숫자 포함 ${AUTH_MESSAGES.passwordRule}`,
      ),
    )
    await userEvent.type(password, '1')
    await waitFor(() => expect(password).not.toHaveAttribute('aria-invalid'))
  })

  it('증명이 만료되면 이메일 단계로 돌아가 까닭을 알린다', async () => {
    await openSignup()
    await reachProfile()
    for (const proof of Object.values(db.signupVerification.proofs)) proof.expiresAt = 0
    await userEvent.type(screen.getByLabelText('이름'), NEW_USER.name)
    await userEvent.type(screen.getByLabelText('비밀번호'), NEW_USER.password)
    await click('계정 만들기')

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '이메일 인증 시간이 지났어요. 이메일 인증을 다시 해 주세요.',
    )
    expect(screen.getByRole('button', { name: '인증 코드 받기' })).toBeInTheDocument()
  })

  it('그 사이 같은 이메일이 가입되면 로그인 경로를 보인다', async () => {
    const app = await openSignup(paths.signup({ next: NEXT }))
    await reachProfile()
    server.use(
      http.post('/api/v1/auth/signup', () => fail('EMAIL_ALREADY_EXISTS', 'x', 409), {
        once: true,
      }),
    )
    await userEvent.type(screen.getByLabelText('이름'), NEW_USER.name)
    await userEvent.type(screen.getByLabelText('비밀번호'), NEW_USER.password)
    await click('계정 만들기')

    expect(await screen.findByRole('alert')).toHaveTextContent('이미 가입된 이메일이에요.')
    await click('로그인')
    await app.expectPath('/login')
    await app.expectSearch('?next=%2Fworkspaces%2Fws_01%2Ftasks%2Ftk_01')
  })

  it('중복 제출 방지: 응답 전의 연속 제출은 가입 요청 하나다', async () => {
    const gate = deferred()
    server.use(
      http.post('/api/v1/auth/signup', async () => {
        await gate.promise
      }),
    )
    const log = recordRequests()
    await openSignup()
    await reachProfile()
    await userEvent.type(screen.getByLabelText('이름'), NEW_USER.name)
    await userEvent.type(screen.getByLabelText('비밀번호'), NEW_USER.password)

    const submitButton = screen.getByRole('button', { name: '계정 만들기' })
    const form = submitButton.closest('form')!
    fireEvent.submit(form)
    fireEvent.submit(form)
    await waitFor(() => expect(submitButton).toBeDisabled())
    await userEvent.click(submitButton)
    await userEvent.type(screen.getByLabelText('비밀번호'), '{Enter}')
    expect(submitButton).toHaveAttribute('aria-busy', 'true')

    gate.resolve()
    expect(await screen.findByRole('heading', { name: '어떻게 시작할까요?' })).toBeInTheDocument()
    expect(posts(log, '/auth/signup')).toHaveLength(1)
  })

  it('가입 뒤에는 next 가 있어도 시작 화면으로 간다 (#411)', async () => {
    const app = await openSignup(paths.signup({ next: paths.workspaceSelect() }))
    await walkSignup(NEW_USER)
    await app.expectPath('/onboarding/start')
  })
})

describe('카카오 버튼', () => {
  it('next 를 들고 현재 탭을 옮기고, 앞 사용자의 복귀 공간을 지운다', async () => {
    rememberReturnWorkspace('ws_09')
    await openSignup(paths.signup({ next: NEXT }))
    await click('카카오로 가입하기')
    expect(leaveApp).toHaveBeenCalledExactlyOnceWith(
      '/api/v1/auth/kakao/start?next=%2Fworkspaces%2Fws_01%2Ftasks%2Ftk_01',
    )
    expect(readReturnWorkspace()).toBeNull()
  })

  it('앱 밖 next 는 싣지 않는다', async () => {
    await openSignup('/signup?next=https%3A%2F%2Fevil.example')
    await click('카카오로 가입하기')
    expect(leaveApp).toHaveBeenCalledExactlyOnceWith('/api/v1/auth/kakao/start')
  })
})

describe('카카오 연결 가입: 인증된 이메일이 있다', () => {
  const kakaoPath = paths.signup({ kakao: true, next: paths.workspaceSelect() })

  beforeEach(() => {
    db.kakao.pending = KAKAO
  })

  async function openKakaoProfile(path: string = kakaoPath) {
    const app = await openSignup(path)
    await screen.findByLabelText('이름')
    return app
  }

  it('코드 없이 프로필부터다. 이메일은 잠겨 있고 이름은 닉네임으로 채워 고칠 수 있다', async () => {
    await openKakaoProfile()
    expect(screen.getByText('가입을 마치면 카카오 계정이 연결돼요.')).toBeInTheDocument()
    const email = screen.getByLabelText('이메일')
    expect(email).toHaveValue(KAKAO.email)
    expect(email).toHaveAttribute('readonly')
    expect(screen.queryByRole('button', { name: '이메일 바꾸기' })).not.toBeInTheDocument()

    const name = screen.getByLabelText('이름')
    expect(name).toHaveValue(KAKAO.nickname)
    await userEvent.clear(name)
    await userEvent.type(name, '고친 이름')
    expect(name).toHaveValue('고친 이름')
    expect(screen.queryByRole('button', { name: '카카오로 가입하기' })).not.toBeInTheDocument()
  })

  it('닉네임이 없으면 이름은 비어 있다', async () => {
    db.kakao.pending = { ...KAKAO, nickname: null }
    await openKakaoProfile()
    expect(screen.getByLabelText('이름')).toHaveValue('')
  })

  it('link_kakao 로 가입해 카카오가 이어지고, 다시 대기를 묻지 않으며 만료 안내도 스치지 않는다', async () => {
    const bodies = recordRequestBodies('POST', '/auth/signup')
    const log = recordRequests()
    const app = await openKakaoProfile()
    await userEvent.type(screen.getByLabelText('비밀번호'), NEW_USER.password)
    await click('계정 만들기')

    await app.expectPath('/onboarding/start')
    expect(bodies).toEqual([
      { password: NEW_USER.password, name: KAKAO.nickname, link_kakao: true },
    ])
    expect(db.accounts.at(-1)).toMatchObject({
      kakaoId: KAKAO.kakaoId,
      session: { user: { email: KAKAO.email } },
    })
    expect(log.started.filter(({ path }) => path === '/auth/kakao/pending')).toHaveLength(1)
    expect(screen.queryByText(/카카오 로그인 정보가 만료/)).not.toBeInTheDocument()
  })

  it('제출 직전 대기가 만료되면 안내와 카카오 다시 시작을 보인다', async () => {
    await openKakaoProfile()
    db.kakao.pending = null
    await userEvent.type(screen.getByLabelText('비밀번호'), NEW_USER.password)
    await click('계정 만들기')

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '카카오 로그인 정보가 만료됐어요. 카카오로 다시 시작해 주세요.',
    )
    await click('카카오로 다시 시작')
    expect(leaveApp).toHaveBeenCalledExactlyOnceWith('/api/v1/auth/kakao/start?next=%2Fworkspaces')
  })

  it.each([
    ['EMAIL_ALREADY_EXISTS', '이미 가입된 이메일이에요.'],
    ['KAKAO_ALREADY_LINKED', '이미 다른 계정에 연결된 카카오 계정이에요.'],
  ])('409 %s 는 로그인 경로를 보인다', async (code, message) => {
    server.use(http.post('/api/v1/auth/signup', () => fail(code, 'x', 409), { once: true }))
    const app = await openKakaoProfile()
    await userEvent.type(screen.getByLabelText('비밀번호'), NEW_USER.password)
    await click('계정 만들기')

    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    await click('로그인')
    await app.expectPath('/login')
    await app.expectSearch('?next=%2Fworkspaces')
  })

  it('카카오 없이 가입: 모드를 지우고 next 를 두고 이메일 단계부터 다시 한다', async () => {
    const bodies = recordRequestBodies('POST', '/auth/signup')
    const app = await openKakaoProfile()
    await click('카카오 없이 가입')

    expect(await screen.findByRole('button', { name: '인증 코드 받기' })).toBeInTheDocument()
    await app.expectSearch('?next=%2Fworkspaces')
    expect(screen.queryByText('가입을 마치면 카카오 계정이 연결돼요.')).not.toBeInTheDocument()

    await walkSignup(NEW_USER)
    await app.expectPath('/onboarding/start')
    expect(bodies).toEqual([
      {
        verification_token: Object.keys(db.signupVerification.proofs)[0],
        password: NEW_USER.password,
        name: NEW_USER.name,
        link_kakao: false,
      },
    ])
    expect(db.accounts.at(-1)?.kakaoId).toBeUndefined()
  })
})

describe('카카오 연결 가입: 이메일이 없다', () => {
  beforeEach(() => {
    db.kakao.pending = { ...KAKAO, email: null }
  })

  it('이메일 → 코드 → 프로필을 밟고 이름은 닉네임으로 채운다. 코드 증명과 link_kakao 로 가입한다', async () => {
    const bodies = recordRequestBodies('POST', '/auth/signup')
    const app = await openSignup(paths.signup({ kakao: true, next: paths.workspaceSelect() }))
    await screen.findByText('가입을 마치면 카카오 계정이 연결돼요.')
    await reachProfile()
    expect(screen.getByLabelText('이름')).toHaveValue(KAKAO.nickname)
    await userEvent.type(screen.getByLabelText('비밀번호'), NEW_USER.password)
    await click('계정 만들기')

    await app.expectPath('/onboarding/start')
    expect(bodies).toEqual([
      {
        verification_token: Object.keys(db.signupVerification.proofs)[0],
        password: NEW_USER.password,
        name: KAKAO.nickname,
        link_kakao: true,
      },
    ])
    expect(db.accounts.at(-1)).toMatchObject({
      kakaoId: KAKAO.kakaoId,
      session: { user: { email: NEW_USER.email } },
    })
  })

  it('이미 가입된 이메일은 그 계정에 잇지 않고 다른 이메일을 받는다', async () => {
    await openSignup(paths.signup({ kakao: true }))
    await screen.findByText('가입을 마치면 카카오 계정이 연결돼요.')
    await submitEmail('pm@example.com')

    const email = screen.getByLabelText('이메일')
    await waitFor(() =>
      expect(email).toHaveAccessibleDescription(
        '이미 가입된 이메일이에요. 다른 이메일을 입력해 주세요.',
      ),
    )
    expect(email).toHaveFocus()
    expect(db.accounts[0].kakaoId).toBeUndefined()
  })
})

describe('카카오 대기를 읽지 못했다', () => {
  it('대기가 없으면(위조·만료 주소) 안내와 다시 시작, 카카오 없이 가입을 보인다', async () => {
    const app = await openSignup(paths.signup({ kakao: true }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '카카오 로그인 정보가 만료됐어요. 카카오로 다시 시작해 주세요.',
    )
    expect(screen.queryByLabelText('이메일')).not.toBeInTheDocument()

    await click('카카오 없이 가입')
    expect(await screen.findByRole('button', { name: '인증 코드 받기' })).toBeInTheDocument()
    await app.expectSearch('')
  })

  it('서버 실패는 다시 시도할 수 있다', async () => {
    let failing = true
    server.use(
      http.get('/api/v1/auth/kakao/pending', () =>
        failing ? fail('INTERNAL_ERROR', 'x', 500) : undefined,
      ),
    )
    db.kakao.pending = KAKAO
    await openSignup(paths.signup({ kakao: true }))
    // 5xx 조회는 1초 뒤 한 번 더 요청한다 (Query 공통 정책)
    const retry = await screen.findByRole('button', { name: '다시 시도' }, { timeout: 4000 })
    failing = false
    await act(() => userEvent.click(retry))
    expect(await screen.findByLabelText('이름')).toBeInTheDocument()
  })
})
