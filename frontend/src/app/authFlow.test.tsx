import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { SESSION_QUERY_KEY } from '@/entities/user'
import { WORKSPACE_LIST_QUERY_KEY } from '@/entities/workspace'
import { AUTH_MESSAGES } from '@/features/auth'
import { workspaceKey } from '@/shared/api/queryKeys'
import { db } from '@/shared/mock/db'
import { fail } from '@/shared/mock/envelope'
import { applyScenario } from '@/shared/mock/scenarios'
import { server } from '@/shared/mock/server'
import { deferred } from '@/shared/test/deferred'
import { recordRequests } from '@/shared/test/requests'
import { renderApp } from './test/renderApp'

/* U2-2~U2-6, U2-8. 제품과 같은 배선(renderApp)에 MSW + 실제 request 경로다 */

async function openLogin() {
  db.authenticated = false
  const app = renderApp('/login')
  await screen.findByRole('heading', { name: '로그인' })
  return app
}

async function openSignup() {
  db.authenticated = false
  const app = renderApp('/signup')
  await screen.findByRole('heading', { name: '회원가입' })
  return app
}

async function fillLogin(email: string, password: string) {
  await userEvent.type(screen.getByLabelText('이메일'), email)
  await userEvent.type(screen.getByLabelText('비밀번호'), password)
}

async function fillSignup(values: { name: string; email: string; password: string }) {
  await userEvent.type(screen.getByLabelText('이름'), values.name)
  await userEvent.type(screen.getByLabelText('이메일'), values.email)
  await userEvent.type(screen.getByLabelText('비밀번호'), values.password)
}

const posts = (log: ReturnType<typeof recordRequests>, path: string) =>
  log.started.filter((request) => request.method === 'POST' && request.path === path)

describe('회원가입 화면 (U2-3·U2-4)', () => {
  it('이름·이메일·비밀번호와 보기 토글이 있고 강도 표시·약관 동의는 없다', async () => {
    await openSignup()
    expect(screen.getByLabelText('이름')).toBeInTheDocument()
    expect(screen.getByLabelText('이메일')).toHaveAttribute('type', 'email')
    const password = screen.getByLabelText('비밀번호')
    expect(password).toHaveAttribute('type', 'password')
    await userEvent.click(screen.getByRole('button', { name: '비밀번호 보기' }))
    expect(password).toHaveAttribute('type', 'text')

    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.queryByText(/이용약관|개인정보 처리방침/)).not.toBeInTheDocument()
    expect(screen.queryByRole('img', { name: /비밀번호 강도/ })).not.toBeInTheDocument()
    // 규칙 안내 한 줄은 남는다. 입력의 설명으로 이어져 있다
    expect(password).toHaveAccessibleDescription('8자 이상, 숫자 포함')
  })

  it('필드 오류는 입력 아래에 있고 aria-invalid · aria-describedby 로 이어진다', async () => {
    await openSignup()
    await userEvent.click(screen.getByRole('button', { name: '계정 만들기' }))

    const name = screen.getByLabelText('이름')
    await waitFor(() => expect(name).toHaveAttribute('aria-invalid', 'true'))
    expect(name).toHaveAccessibleDescription(AUTH_MESSAGES.nameRequired)
    expect(screen.getByLabelText('이메일')).toHaveAccessibleDescription(AUTH_MESSAGES.emailRequired)
    expect(screen.getByLabelText('비밀번호')).toHaveAccessibleDescription(
      `8자 이상, 숫자 포함 ${AUTH_MESSAGES.passwordRequired}`,
    )
    // 첫 오류 칸으로 포커스가 간다 (shouldFocusError)
    expect(name).toHaveFocus()
    // 비필드 오류가 아니다 — 폼 상단 패널(alert)은 없다. 필드 오류도 alert 가 아니다 — 입력의 설명으로 한 번만 읽힌다
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('비밀번호가 8자 미만이거나 숫자가 없으면 입력 아래에 규칙을 알린다', async () => {
    await openSignup()
    const password = screen.getByLabelText('비밀번호')
    await userEvent.type(password, 'abcdefgh')
    await userEvent.tab()
    await waitFor(() => expect(password).toHaveAttribute('aria-invalid', 'true'))
    expect(password).toHaveAccessibleDescription(
      `8자 이상, 숫자 포함 ${AUTH_MESSAGES.passwordRule}`,
    )
    // 한 번 만진 칸은 고치는 즉시 다시 검사한다
    await userEvent.type(password, '1')
    await waitFor(() => expect(password).not.toHaveAttribute('aria-invalid'))
  })
})

describe('회원가입 제출 (U2-6·U2-8)', () => {
  it('가입 성공: 공간 0개라 워크스페이스 만들기로 간다', async () => {
    const log = recordRequests()
    const app = await openSignup()
    await fillSignup({ name: '새 사용자', email: 'new@example.com', password: 'pass1234' })
    await userEvent.click(screen.getByRole('button', { name: '계정 만들기' }))

    expect(await screen.findByRole('heading', { name: '워크스페이스 만들기' })).toBeInTheDocument()
    await app.expectPath('/onboarding/create_workspace')
    expect(app.queryClient.getQueryData(SESSION_QUERY_KEY)).toMatchObject({
      user: { email: 'new@example.com', name: '새 사용자' },
      workspaceCount: 0,
    })
    // 목록을 확보한 뒤에 옮긴다
    const signupAt = log.timeline.indexOf('answer POST /auth/signup')
    expect(log.timeline.indexOf('start GET /workspaces', signupAt)).toBeGreaterThan(signupAt)
  })

  it('중복 이메일: 이메일 입력 아래에 서버 오류를 두고 그 칸으로 포커스를 옮긴다 (setError)', async () => {
    const app = await openSignup()
    await fillSignup({ name: '중복', email: 'pm@example.com', password: 'pass1234' })
    await userEvent.click(screen.getByRole('button', { name: '계정 만들기' }))

    const email = screen.getByLabelText('이메일')
    await waitFor(() => expect(email).toHaveAttribute('aria-invalid', 'true'))
    expect(email).toHaveAccessibleDescription('이미 가입된 이메일이에요.')
    expect(email).toHaveFocus()
    // 입력값은 그대로다
    expect(screen.getByLabelText('이름')).toHaveValue('중복')
    await app.expectPath('/signup')

    // 이메일을 고치면 서버 오류가 풀린다
    await userEvent.clear(email)
    await userEvent.type(email, 'other@example.com')
    await waitFor(() => expect(email).not.toHaveAttribute('aria-invalid'))
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
    await fillSignup({ name: '새 사용자', email: 'new@example.com', password: 'pass1234' })

    const submitButton = screen.getByRole('button', { name: '계정 만들기' })
    const form = submitButton.closest('form')!
    fireEvent.submit(form)
    fireEvent.submit(form)
    await waitFor(() => expect(submitButton).toBeDisabled())
    await userEvent.click(submitButton)
    await userEvent.type(screen.getByLabelText('비밀번호'), '{Enter}')
    expect(submitButton).toHaveAttribute('aria-busy', 'true')

    gate.resolve()
    expect(await screen.findByRole('heading', { name: '워크스페이스 만들기' })).toBeInTheDocument()
    expect(posts(log, '/auth/signup')).toHaveLength(1)
  })
})

describe('로그인 화면 (U2-3·U2-5)', () => {
  it('Google 로그인과 `비밀번호를 잊으셨나요?` 는 비활성이다', async () => {
    await openLogin()
    expect(screen.getByRole('button', { name: 'Google 계정으로 로그인' })).toBeDisabled()
    const forgot = screen.getByRole('button', { name: '비밀번호를 잊으셨나요?' })
    expect(forgot).toBeDisabled()
    // 준비 중 문구·배지를 달지 않는다 (D-006)
    expect(screen.queryByText(/준비 중/)).not.toBeInTheDocument()
  })

  it('회원가입의 Google 버튼도 비활성이다', async () => {
    await openSignup()
    expect(screen.getByRole('button', { name: 'Google 계정으로 가입하기' })).toBeDisabled()
  })

  it('로그인은 이메일 형식과 비밀번호 빈 값만 검사한다', async () => {
    const log = recordRequests()
    await openLogin()
    await fillLogin('pm', 'x')
    await userEvent.click(screen.getByRole('button', { name: '로그인' }))

    const email = screen.getByLabelText('이메일')
    await waitFor(() => expect(email).toHaveAccessibleDescription(AUTH_MESSAGES.emailFormat))
    // 짧은 비밀번호도 로그인에서는 오류가 아니다
    expect(screen.getByLabelText('비밀번호')).not.toHaveAttribute('aria-invalid')
    expect(posts(log, '/auth/login')).toHaveLength(0)
  })
})

describe('로그인 제출 (U2-4·U2-6·U2-8)', () => {
  it('잘못된 자격 증명: 폼 상단 FormErrorPanel 에 알리고 입력은 유지한다', async () => {
    const app = await openLogin()
    await fillLogin('pm@example.com', 'wrong-password')
    await userEvent.click(screen.getByRole('button', { name: '로그인' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '이메일 또는 비밀번호가 올바르지 않아요.',
    )
    expect(screen.getByLabelText('이메일')).toHaveValue('pm@example.com')
    expect(screen.getByLabelText('이메일')).not.toHaveAttribute('aria-invalid')
    await app.expectPath('/login')
    expect(app.queryClient.getQueryData(SESSION_QUERY_KEY)).toBeNull()
  })

  it('서버 오류도 비필드 오류다. 다시 제출하면 패널이 사라지고 이어 간다', async () => {
    server.use(
      http.post('/api/v1/auth/login', () => fail('INTERNAL_ERROR', 'boom', 500), { once: true }),
    )
    const app = await openLogin()
    await fillLogin('pm@example.com', 'mock-password')
    await userEvent.click(screen.getByRole('button', { name: '로그인' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '서버에 문제가 생겼어요. 잠시 후 다시 시도해 주세요.',
    )

    await userEvent.click(screen.getByRole('button', { name: '로그인' }))
    expect(await screen.findByRole('heading', { name: '워크스페이스 선택' })).toBeInTheDocument()
    expect(screen.queryByText('서버에 문제가 생겼어요. 잠시 후 다시 시도해 주세요.')).toBeNull()
    await app.expectPath('/workspaces')
  })

  it('중복 제출 방지: 응답 전의 연속 제출은 로그인 요청 하나다', async () => {
    const gate = deferred()
    server.use(
      http.post('/api/v1/auth/login', async () => {
        await gate.promise
      }),
    )
    const log = recordRequests()
    await openLogin()
    await fillLogin('pm@example.com', 'mock-password')
    const form = screen.getByRole('button', { name: '로그인' }).closest('form')!
    fireEvent.submit(form)
    fireEvent.submit(form)
    fireEvent.submit(form)
    gate.resolve()
    await screen.findByRole('heading', { name: '워크스페이스 선택' })
    expect(posts(log, '/auth/login')).toHaveLength(1)
  })

  it.each([
    ['공간 0개', 'no-workspace', '/onboarding/create_workspace', '워크스페이스 만들기'],
    ['공간 1개', 'single-workspace', '/workspaces/ws_01/dashboard', '대시보드'],
    ['공간 여러 개', 'multiple-workspaces', '/workspaces', '워크스페이스 선택'],
    [
      '미완료 공간 1개',
      'incomplete-workspace',
      '/onboarding/ws_03/connect_discord',
      'Discord 연결',
    ],
  ] as const)('%s → %s (postLoginPath, D-010)', async (_, scenario, path, heading) => {
    applyScenario(scenario)
    const app = await openLogin()
    await fillLogin('pm@example.com', 'mock-password')
    await userEvent.click(screen.getByRole('button', { name: '로그인' }))

    expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument()
    await app.expectPath(path)
  })

  it('로그인 직후는 재방문이 아니다 — 마지막 공간(ws_01)이 있어도 선택 화면으로 가고 대시보드를 거치지 않는다', async () => {
    const app = await openLogin()
    await fillLogin('pm@example.com', 'mock-password')
    await userEvent.click(screen.getByRole('button', { name: '로그인' }))
    await screen.findByRole('heading', { name: '워크스페이스 선택' })

    expect(app.queryClient.getQueryData(SESSION_QUERY_KEY)).toMatchObject({
      lastWorkspaceId: 'ws_01',
    })
    expect(app.visited().map(({ pathname }) => pathname)).toEqual(['/login', '/workspaces'])
  })

  it('이전 사용자의 캐시와 진행 중 요청을 정리하고 새 목록을 받은 뒤 옮긴다', async () => {
    const stale = deferred()
    server.use(
      http.get('/api/v1/members', async () => {
        await stale.promise
      }),
    )
    const log = recordRequests()
    const app = await openLogin()
    // 앞 사용자가 남긴 워크스페이스 데이터와 아직 안 끝난 요청
    app.queryClient.setQueryData(workspaceKey('ws_99', 'members'), [{ id: 'mb_99' }])
    app.queryClient.setQueryData(WORKSPACE_LIST_QUERY_KEY, [])
    // 결과는 바로 받아 둔다 — 취소된 promise 가 처리되지 않은 거부로 남지 않게 한다
    const pending = app.queryClient
      .fetchQuery({
        queryKey: workspaceKey('ws_99', 'pending'),
        queryFn: async ({ signal }) => {
          await fetch(`${location.origin}/api/v1/members?workspace_id=ws_99`, { signal })
          return 'stale'
        },
      })
      .then(
        () => 'finished',
        () => 'cancelled',
      )

    await fillLogin('pm@example.com', 'mock-password')
    await userEvent.click(screen.getByRole('button', { name: '로그인' }))
    await screen.findByRole('heading', { name: '워크스페이스 선택' })

    await expect(pending).resolves.toBe('cancelled')
    expect(app.queryClient.getQueryData(workspaceKey('ws_99', 'members'))).toBeUndefined()
    expect(
      app.queryClient.getQueryCache().find({ queryKey: workspaceKey('ws_99', 'pending') }),
    ).toBe(undefined)
    // 빈 목록 캐시는 버리고 새로 받았다
    expect(app.queryClient.getQueryData(WORKSPACE_LIST_QUERY_KEY)).toHaveLength(2)
    const loginAt = log.timeline.indexOf('answer POST /auth/login')
    expect(log.timeline.indexOf('start GET /workspaces', loginAt)).toBeGreaterThan(loginAt)
    stale.resolve()
  })

  /* F-r1 #12 로 기대값을 바꿨다. 예전에는 비로그인 화면에 남았는데, 서버 세션은 이미 생겼고
     가입이라면 다시 제출이 409 로 막혔다. 이제 세션을 반영하고 가드의 목록 오류·다시 시도로 넘긴다 */
  it('목록 확보가 실패해도 로그인 상태로 넘어가 목록 오류와 다시 시도를 보인다', async () => {
    let failing = true
    server.use(
      // 실패를 끝내면 아무것도 돌려주지 않아 기본 handler 로 넘긴다
      http.get('/api/v1/workspaces', () =>
        failing ? fail('INTERNAL_ERROR', 'boom', 500) : undefined,
      ),
    )
    const app = await openLogin()
    await fillLogin('pm@example.com', 'mock-password')
    await userEvent.click(screen.getByRole('button', { name: '로그인' }))
    // 5xx 조회는 1초 뒤 한 번 더 요청한다 (Query 공통 정책)
    const retry = await screen.findByRole('button', { name: '다시 시도' }, { timeout: 6000 })
    expect(
      screen.getByText('서버에 문제가 생겼어요. 잠시 후 다시 시도해 주세요.'),
    ).toBeInTheDocument()
    expect(app.queryClient.getQueryData(SESSION_QUERY_KEY)).toMatchObject({
      user: { email: 'pm@example.com' },
    })

    failing = false
    await userEvent.click(retry)
    expect(await screen.findByRole('heading', { name: '워크스페이스 선택' })).toBeInTheDocument()
  }, 10_000)

  it('가입 뒤 목록 확보가 실패해도 다시 시도로 이어 가고 가입 요청은 한 번이다', async () => {
    let failing = true
    server.use(
      // 실패를 끝내면 아무것도 돌려주지 않아 기본 handler 로 넘긴다
      http.get('/api/v1/workspaces', () =>
        failing ? fail('INTERNAL_ERROR', 'boom', 500) : undefined,
      ),
    )
    const log = recordRequests()
    const app = await openSignup()
    await fillSignup({ name: '새 사용자', email: 'new@example.com', password: 'pass1234' })
    await userEvent.click(screen.getByRole('button', { name: '계정 만들기' }))
    const retry = await screen.findByRole('button', { name: '다시 시도' }, { timeout: 6000 })

    failing = false
    await userEvent.click(retry)
    expect(await screen.findByRole('heading', { name: '워크스페이스 만들기' })).toBeInTheDocument()
    await app.expectPath('/onboarding/create_workspace')
    expect(posts(log, '/auth/signup')).toHaveLength(1)
  }, 10_000)
})

describe('부팅 세션 조회가 실패한 뒤의 로그인', () => {
  // 401 이 아닌 실패(5xx·네트워크)도 조회가 끝났는데 사용자가 없는 상태다. 그 화면에서 로그인하면 로그인 직후다
  it('부팅 /auth/me 가 5xx 로 실패한 화면에서 로그인해도 공간 개수 분기로 간다', async () => {
    server.use(http.get('/api/v1/auth/me', () => fail('INTERNAL_ERROR', 'boom', 500)))
    const app = renderApp('/login')
    // 5xx 조회는 1초 뒤 한 번 더 요청한 다음 실패로 끝난다. 공개 화면은 그대로 보인다
    expect(
      await screen.findByRole('heading', { name: '로그인' }, { timeout: 3000 }),
    ).toBeInTheDocument()
    await waitFor(
      () => expect(app.queryClient.getQueryState(SESSION_QUERY_KEY)?.status).toBe('error'),
      {
        timeout: 3000,
      },
    )

    await fillLogin('pm@example.com', 'mock-password')
    await userEvent.click(screen.getByRole('button', { name: '로그인' }))
    // 공간이 여럿이고 마지막 공간(ws_01)이 있어도 재방문 규칙이 아니라 선택 화면이다 (D-010)
    expect(await screen.findByRole('heading', { name: '워크스페이스 선택' })).toBeInTheDocument()
    expect(app.visited().map(({ pathname }) => pathname)).not.toContain(
      '/workspaces/ws_01/dashboard',
    )
  })
})

describe('인증 화면 재방문 (U2-6·U2-8)', () => {
  it.each(['/', '/login', '/signup'])(
    '로그인 상태로 %s 에 오면 마지막 공간으로 간다 (authRevisitPath)',
    async (path) => {
      const app = renderApp(path)
      expect(await screen.findByRole('heading', { name: '대시보드' })).toBeInTheDocument()
      await app.expectPath('/workspaces/ws_01/dashboard')
    },
  )

  it('마지막 공간이 없으면 로그인 직후와 같은 분기다', async () => {
    applyScenario('no-workspace')
    const app = renderApp('/login')
    expect(await screen.findByRole('heading', { name: '워크스페이스 만들기' })).toBeInTheDocument()
    await app.expectPath('/onboarding/create_workspace')
  })
})
