import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { onTestFinished } from 'vitest'
import { SESSION_QUERY_KEY } from '@/entities/user'
import { RESET_LINK_MESSAGES } from '@/features/auth'
import { db } from '@/shared/mock/db'
import { fail, ok } from '@/shared/mock/envelope'
import { applyScenario } from '@/shared/mock/scenarios'
import { server } from '@/shared/mock/server'
import { recordRequestBodies, recordRequests } from '@/shared/test/requests'
import { ENDPOINT, KEYS, installPushBrowser } from './test/pushBrowser'
import { renderApp } from './test/renderApp'

/* #356 비밀번호 재설정. 제품과 같은 배선(renderApp)에 MSW + 실제 request 경로다 */

const TOKEN = 'mock-reset-normal'

const RESET_LINK = `/reset-password#token=${TOKEN}`

const VERIFY = '/auth/password-reset/verify'

const MAIL_UNAVAILABLE = '지금은 메일을 보낼 수 없어요. 잠시 뒤 다시 시도해 주세요.'

const PASSWORD_CHANGED = '비밀번호를 바꿨어요. 새 비밀번호로 로그인해 주세요.'

const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms))

async function openForgot() {
  const app = renderApp('/forgot-password')
  await screen.findByRole('heading', { name: '비밀번호 재설정 요청' })
  return app
}

async function requestMail(email = 'pm@example.com') {
  await userEvent.type(screen.getByLabelText('이메일'), email)
  await userEvent.click(screen.getByRole('button', { name: '재설정 링크 보내기' }))
}

async function changePassword(password: string) {
  await userEvent.type(await screen.findByLabelText('새 비밀번호'), password)
  await userEvent.click(screen.getByRole('button', { name: '비밀번호 바꾸기' }))
}

/** 확인 요청이 시작될 때마다 그 순간의 화면 주소(fragment)를 적는다 */
function recordHashAtVerify(app: () => ReturnType<typeof renderApp>): string[] {
  const hashes: string[] = []
  const onStart = ({ request }: { request: Request }) => {
    if (new URL(request.url).pathname.endsWith(VERIFY)) hashes.push(app().visited().at(-1)!.hash)
  }
  server.events.on('request:start', onStart)
  onTestFinished(() => {
    server.events.removeListener('request:start', onStart)
  })
  return hashes
}

describe('경로와 가드', () => {
  it('비로그인은 요청 화면을 연다', async () => {
    applyScenario('password-reset')
    const app = await openForgot()
    await app.expectPath('/forgot-password')
  })

  it('로그인한 채 /forgot-password 로 오면 공개 화면처럼 돌려보낸다', async () => {
    const app = renderApp('/forgot-password')
    await app.expectPath('/workspaces/ws_01/dashboard')
    expect(screen.queryByRole('heading', { name: '비밀번호 재설정 요청' })).toBeNull()
  })

  it('로그인한 채 메일 링크를 열어도 변경 화면이 보인다', async () => {
    applyScenario('password-reset')
    db.authenticated = true
    const app = renderApp(RESET_LINK)
    expect(await screen.findByLabelText('새 비밀번호')).toBeInTheDocument()
    await app.expectPath('/reset-password')
  })
})

describe('재설정 메일 요청', () => {
  beforeEach(() => {
    applyScenario('signed-out')
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('보내면 안내를 보이고 60초 동안 다시 보내기를 막은 뒤 같은 이메일로 다시 보낸다', async () => {
    const bodies = recordRequestBodies('POST', '/auth/password-reset/request')
    await openForgot()
    await requestMail()

    const sent = await screen.findByRole('status')
    expect(sent).toHaveTextContent(
      'pm@example.com 주소로 가입한 계정이 있으면 재설정 링크를 보냈어요.',
    )
    expect(sent).toHaveTextContent('스팸함')
    expect(screen.getByRole('button', { name: '다시 보내기 (60초)' })).toBeDisabled()

    await advance(1000)
    expect(screen.getByRole('button', { name: '다시 보내기 (59초)' })).toBeDisabled()

    await advance(59_000)
    const resend = screen.getByRole('button', { name: '다시 보내기' })
    expect(resend).toBeEnabled()
    await userEvent.click(resend)

    expect(await screen.findByRole('button', { name: '다시 보내기 (60초)' })).toBeDisabled()
    expect(bodies).toEqual([{ email: 'pm@example.com' }, { email: 'pm@example.com' }])
    // 서버 쿨다운도 끝난 뒤라 두 번 모두 메일이 갔다
    expect(db.passwordReset.outbox).toHaveLength(2)
  })

  it('서버가 메일을 보낼 수 없으면 폼 위에 503 안내를 띄우고 폼에 남는다', async () => {
    applyScenario('password-reset-mail-unavailable')
    await openForgot()
    await requestMail()

    expect(await screen.findByRole('alert')).toHaveTextContent(MAIL_UNAVAILABLE)
    expect(screen.getByRole('button', { name: '재설정 링크 보내기' })).toBeEnabled()
  })

  it('다시 보내기가 실패하면 안내 위에 오류를 띄우고 다시 보낼 수 있다', async () => {
    await openForgot()
    await requestMail()
    await screen.findByRole('status')
    await advance(60_000)
    db.passwordReset.failure = 'mail-unavailable'
    await userEvent.click(screen.getByRole('button', { name: '다시 보내기' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(MAIL_UNAVAILABLE)
    expect(screen.getByRole('button', { name: '다시 보내기' })).toBeEnabled()
  })
})

describe('메일 링크의 토큰', () => {
  beforeEach(() => {
    applyScenario('password-reset')
  })

  it('StrictMode 에서도 확인 전에 주소의 토큰을 replace 로 지우고 본문으로만 한 번 보낸다', async () => {
    const log = recordRequests()
    const bodies = recordRequestBodies('POST', VERIFY)
    let app: ReturnType<typeof renderApp> | null = null
    const hashes = recordHashAtVerify(() => app!)
    app = renderApp(RESET_LINK, { strict: true })

    expect(await screen.findByLabelText('새 비밀번호')).toBeInTheDocument()
    expect(hashes).toEqual([''])
    expect(bodies).toEqual([{ token: 'mock-reset-normal' }])
    // 새 기록 항목 없이 지금 항목을 바꿨다
    expect(app.visited().map(({ hash }) => hash)).toEqual(['#token=mock-reset-normal', ''])
    expect(app.visitedActions()).toEqual(['POP', 'REPLACE'])
    expect(log.started.some(({ path }) => path.includes('mock-reset-normal'))).toBe(false)
  })

  it('토큰은 Query·Mutation 캐시의 key·hash·값 어디에도 남지 않고, 화면을 떠나면 확인 결과도 버린다', async () => {
    const app = renderApp(RESET_LINK)
    await screen.findByLabelText('새 비밀번호')

    const cached = () =>
      JSON.stringify([
        app.queryClient
          .getQueryCache()
          .getAll()
          .map(({ queryKey, queryHash, state }) => [queryKey, queryHash, state.data]),
        app.queryClient
          .getMutationCache()
          .getAll()
          .map(({ state }) => state.variables),
      ])
    expect(
      app.queryClient.getQueryCache().find({ queryKey: ['password-reset-link'], exact: false }),
    ).toBeDefined()
    expect(cached()).not.toContain(TOKEN)

    await userEvent.click(screen.getByRole('link', { name: '로그인' }))
    await app.expectPath('/login')
    await waitFor(() =>
      expect(
        app.queryClient.getQueryCache().find({ queryKey: ['password-reset-link'], exact: false }),
      ).toBeUndefined(),
    )
    expect(cached()).not.toContain(TOKEN)
  })

  it('확인한 링크의 가린 이메일로 어느 계정을 바꾸는지 보인다', async () => {
    renderApp(RESET_LINK)
    expect(await screen.findByLabelText('새 비밀번호')).toBeInTheDocument()
    expect(screen.getByText('p***@example.com')).toBeInTheDocument()
    expect(screen.getByText(/계정의 비밀번호를 바꿔요\./)).toBeInTheDocument()
  })

  it('주소에 토큰이 없으면 확인하지 않고 쓸 수 없는 링크로 본다', async () => {
    const log = recordRequests()
    renderApp('/reset-password')
    expect(await screen.findByRole('alert')).toHaveTextContent(RESET_LINK_MESSAGES.invalid)
    expect(log.started.some(({ path }) => path === VERIFY)).toBe(false)
  })
})

describe('쓸 수 없는 링크', () => {
  it.each([
    ['password-reset-expired', 'mock-reset-expired', 'expired', '링크 유효 시간(30분)이 지났어요.'],
    ['password-reset-used', 'mock-reset-used', 'used', '이미 사용한 링크예요.'],
    [
      'password-reset-invalid',
      'mock-reset-revoked',
      'invalid',
      '쓸 수 없는 링크예요. 다시 요청했다면 가장 최근 메일의 링크를 열어 주세요.',
    ],
  ] as const)('%s: %s 는 %s 안내와 다시 요청하기를 보인다', async (scenario, token, _, text) => {
    applyScenario(scenario)
    const app = renderApp(`/reset-password#token=${token}`)

    expect(await screen.findByRole('alert')).toHaveTextContent(text)
    expect(screen.queryByLabelText('새 비밀번호')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: '다시 요청하기' }))
    expect(await screen.findByRole('heading', { name: '비밀번호 재설정 요청' })).toBeInTheDocument()
    await app.expectPath('/forgot-password')
  })

  it('확인이 서버 오류면 다시 시도로 같은 링크를 다시 확인한다', async () => {
    applyScenario('password-reset-server-error')
    renderApp('/reset-password#token=mock-reset-server-error')

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '서버에 문제가 생겼어요. 잠시 후 다시 시도해 주세요.',
    )
    db.passwordReset.failure = 'none'
    await userEvent.click(screen.getByRole('button', { name: '다시 시도' }))
    expect(await screen.findByLabelText('새 비밀번호')).toBeInTheDocument()
  })

  it('입력하는 사이 링크를 쓸 수 없게 되면 변경 응답의 까닭으로 바꾼다', async () => {
    applyScenario('password-reset')
    renderApp(RESET_LINK)
    await screen.findByLabelText('새 비밀번호')
    db.passwordReset.tokens[0].status = 'used'
    await changePassword('newpass123')

    expect(await screen.findByRole('alert')).toHaveTextContent(RESET_LINK_MESSAGES.used)
    expect(screen.queryByLabelText('새 비밀번호')).toBeNull()
  })
})

describe('새 비밀번호', () => {
  beforeEach(() => {
    applyScenario('password-reset')
  })

  it('규칙에 맞지 않으면 요청하지 않고 입력 아래에 가입과 같은 규칙을 알린다', async () => {
    const bodies = recordRequestBodies('POST', '/auth/password-reset/confirm')
    renderApp(RESET_LINK)
    const field = await screen.findByLabelText('새 비밀번호')
    expect(field).toHaveAccessibleDescription('8자 이상, 숫자 포함')
    await changePassword('abcdefgh')

    await waitFor(() => expect(field).toHaveAttribute('aria-invalid', 'true'))
    expect(field).toHaveAccessibleDescription(
      '8자 이상, 숫자 포함 비밀번호는 8자 이상이고 숫자를 포함해야 해요.',
    )
    expect(bodies).toEqual([])
  })

  it('서버의 INVALID_REQUEST 는 새 비밀번호 칸의 오류이고, 고쳐 보내면 같은 링크로 바뀐다', async () => {
    // 클라이언트 규칙이 BE 와 같아 실제 handler 로는 400 까지 가지 않는다. 한 번만 400 을 돌려준다
    server.use(
      http.post(
        '/api/v1/auth/password-reset/confirm',
        () =>
          fail('INVALID_REQUEST', 'bad', 400, {
            fields: [{ loc: ['body', 'new_password'], msg: 'Value error' }],
          }),
        { once: true },
      ),
    )
    const bodies = recordRequestBodies('POST', '/auth/password-reset/confirm')
    const app = renderApp(RESET_LINK)
    await changePassword('newpass123')

    const field = screen.getByLabelText('새 비밀번호')
    await waitFor(() => expect(field).toHaveAttribute('aria-invalid', 'true'))
    expect(field).toHaveAccessibleDescription('8자 이상, 숫자 포함 요청 내용을 다시 확인해 주세요.')
    expect(field).toHaveFocus()

    await userEvent.clear(field)
    await changePassword('newpass456')
    expect(await screen.findByRole('status')).toHaveTextContent(PASSWORD_CHANGED)
    await app.expectPath('/login')
    expect(bodies).toEqual([
      { token: TOKEN, new_password: 'newpass123' },
      { token: TOKEN, new_password: 'newpass456' },
    ])
  })

  it('바꾸면 로그인으로 가서 안내를 띄우고, 새 비밀번호로 로그인된다', async () => {
    const app = renderApp(RESET_LINK)
    await changePassword('newpass123')

    expect(await screen.findByRole('status')).toHaveTextContent(PASSWORD_CHANGED)
    await app.expectPath('/login')
    expect(app.queryClient.getQueryData(SESSION_QUERY_KEY)).toBeNull()
    // 안내는 한 번 읽고 그 기록 항목의 state 를 지웠다. 새로고침·뒤로가기로 이 항목에 와도 다시 뜨지 않는다
    await waitFor(() => expect(app.visited().at(-1)!.state).toBeNull())
    expect(app.visitedActions().at(-1)).toBe('REPLACE')
    expect(app.visited().at(-1)!.pathname).toBe('/login')
    expect(screen.getByRole('status')).toHaveTextContent(PASSWORD_CHANGED)

    await userEvent.type(screen.getByLabelText('이메일'), 'pm@example.com')
    await userEvent.type(screen.getByLabelText('비밀번호'), 'newpass123')
    await userEvent.click(screen.getByRole('button', { name: '로그인' }))
    expect(await screen.findByRole('heading', { name: '워크스페이스 선택' })).toBeInTheDocument()
  })

  it('로그인한 채 바꿔도 세션을 비우고 로그인 화면에 머문다', async () => {
    db.authenticated = true
    const app = renderApp(RESET_LINK)
    await changePassword('newpass123')

    expect(await screen.findByRole('status')).toHaveTextContent(PASSWORD_CHANGED)
    await app.expectPath('/login')
    expect(app.queryClient.getQueryData(SESSION_QUERY_KEY)).toBeNull()
    expect(db.authenticated).toBe(false)
    await waitFor(() => expect(app.visited().at(-1)!.state).toBeNull())
    // RedirectIfAuthed 가 워크스페이스로 돌려보내지 않았다. 마지막 /login 은 안내 state 를 지운 replace 다
    expect(app.visited().map(({ pathname }) => pathname)).toEqual([
      '/reset-password',
      '/reset-password',
      '/login',
      '/login',
    ])
  })

  it.each([
    ['서버 세션이 끊겨 구독 해제가 401', false],
    ['구독 해제가 서버 오류 500', true],
  ] as const)('바꾸면 이 브라우저의 푸시 구독을 푼다 — %s 여도', async (_, serverDown) => {
    db.authenticated = true
    db.push.subscriptions = [{ endpoint: ENDPOINT, keys: KEYS, user_id: 'us_01' }]
    const browser = installPushBrowser({ permission: 'granted', subscribed: true })
    if (serverDown)
      server.use(
        http.delete('/api/v1/push/subscriptions', () => fail('INTERNAL_ERROR', 'down', 500)),
      )
    const deleteStatuses: number[] = []
    const onAnswer = ({ request, response }: { request: Request; response: Response }) => {
      if (request.method === 'DELETE') deleteStatuses.push(response.status)
    }
    server.events.on('response:mocked', onAnswer)
    onTestFinished(() => {
      server.events.removeListener('response:mocked', onAnswer)
    })
    const app = renderApp(RESET_LINK)
    await changePassword('newpass123')

    expect(await screen.findByRole('status')).toHaveTextContent(PASSWORD_CHANGED)
    await waitFor(() => expect(browser.subscription.unsubscribe).toHaveBeenCalledTimes(1))
    expect(deleteStatuses).toEqual([serverDown ? 500 : 401])
    expect(await browser.pushManager.getSubscription()).toBeNull()
    // 그 401 이 세션 만료 처리로 다른 곳에 보내지 않았다
    await app.expectPath('/login')
    expect(app.queryClient.getQueryData(SESSION_QUERY_KEY)).toBeNull()
  })
})

const CONFIRM = '/auth/password-reset/confirm'

const OTHER_TOKEN = 'mock-reset-minsu'

/** 두 번째 계정과 그 계정의 쓸 수 있는 재설정 링크 */
function addOtherAccount(): void {
  db.accounts.push({
    session: {
      user: {
        user_id: 'us_02',
        username: 'minsu',
        email: 'minsu@example.com',
        name: '박민수',
        avatar_url: null,
      },
      workspace_count: 0,
      last_workspace_id: null,
    },
    password: 'mock-password',
    workspaceIds: [],
    memberIds: {},
  })
  db.passwordReset.tokens.push({
    token: OTHER_TOKEN,
    email: 'minsu@example.com',
    expiresAt: '2099-12-31T00:00:00.000Z',
    status: 'active',
  })
}

function gate(): { held: Promise<void>; release: () => void } {
  let release!: () => void
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  return { held, release }
}

const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 50)))

describe('같은 화면에 새 메일 링크', () => {
  it('쓸 수 없던 링크 뒤 새 링크를 열면 새 토큰으로 다시 확인하고 그 링크로 바꾼다', async () => {
    applyScenario('password-reset-invalid')
    const verifies = recordRequestBodies('POST', VERIFY)
    const confirms = recordRequestBodies('POST', CONFIRM)
    const app = renderApp('/reset-password#token=mock-reset-revoked')
    expect(await screen.findByRole('alert')).toHaveTextContent(RESET_LINK_MESSAGES.invalid)

    act(() => app.navigate('/reset-password#token=mock-reset-newer'))
    await changePassword('newpass123')

    expect(await screen.findByRole('status')).toHaveTextContent(PASSWORD_CHANGED)
    expect(verifies).toEqual([{ token: 'mock-reset-revoked' }, { token: 'mock-reset-newer' }])
    expect(confirms).toEqual([{ token: 'mock-reset-newer', new_password: 'newpass123' }])
    const hashes = app.visited().map(({ hash }) => hash)
    expect(hashes.slice(hashes.indexOf('#token=mock-reset-newer'))[1]).toBe('')
  })

  it('다른 계정의 링크를 열면 그 계정을 보이고 그 계정의 비밀번호만 바꾼다', async () => {
    applyScenario('password-reset')
    addOtherAccount()
    const confirms = recordRequestBodies('POST', CONFIRM)
    const app = renderApp(RESET_LINK)
    expect(await screen.findByText('p***@example.com')).toBeInTheDocument()

    act(() => app.navigate(`/reset-password#token=${OTHER_TOKEN}`))
    expect(await screen.findByText('mi***@example.com')).toBeInTheDocument()
    expect(screen.queryByText('p***@example.com')).toBeNull()
    await changePassword('newpass123')

    expect(await screen.findByRole('status')).toHaveTextContent(PASSWORD_CHANGED)
    expect(confirms).toEqual([{ token: OTHER_TOKEN, new_password: 'newpass123' }])
    const password = (email: string) =>
      db.accounts.find(({ session }) => session.user.email === email)!.password
    expect(password('pm@example.com')).toBe('mock-password')
    expect(password('minsu@example.com')).toBe('newpass123')
  })

  it('앞 링크를 확인하는 중에 새 링크를 열면 앞 확인을 취소하고 그 결과를 쓰지 않는다', async () => {
    applyScenario('password-reset')
    addOtherAccount()
    const { held, release } = gate()
    // MSW 의 XHR 가로채기는 요청의 signal 을 잇지 않는다. 취소는 XHR 의 abort 로 본다 (pushApi.test.ts 와 같다)
    const abort = vi.spyOn(XMLHttpRequest.prototype, 'abort')
    onTestFinished(() => abort.mockRestore())
    server.use(
      http.post(`/api/v1${VERIFY}`, async ({ request }) => {
        const { token } = (await request.clone().json()) as { token: string }
        if (token === TOKEN) await held
        return undefined
      }),
    )
    const app = renderApp(RESET_LINK)
    expect(await screen.findByText('링크를 확인하고 있어요.')).toBeInTheDocument()

    act(() => app.navigate(`/reset-password#token=${OTHER_TOKEN}`))
    expect(await screen.findByText('mi***@example.com')).toBeInTheDocument()
    expect(abort).toHaveBeenCalledTimes(1)
    release()
    await settle()

    expect(screen.getByText('mi***@example.com')).toBeInTheDocument()
    expect(screen.queryByText('p***@example.com')).toBeNull()
  })
})

describe('세션 경계', () => {
  it('변경 응답을 기다리는 사이 다른 계정으로 로그인하면 늦은 응답이 그 세션·화면·푸시 구독을 건드리지 않는다', async () => {
    applyScenario('password-reset')
    addOtherAccount()
    db.push.subscriptions = [{ endpoint: ENDPOINT, keys: KEYS, user_id: 'us_02' }]
    const browser = installPushBrowser({ permission: 'granted', subscribed: true })
    const { held, release } = gate()
    server.use(
      http.post(`/api/v1${CONFIRM}`, async () => {
        await held
        return ok({})
      }),
    )
    const log = recordRequests()
    const app = renderApp(RESET_LINK)
    await changePassword('newpass123')

    await userEvent.click(screen.getByRole('link', { name: '로그인' }))
    await userEvent.type(await screen.findByLabelText('이메일'), 'minsu@example.com')
    await userEvent.type(screen.getByLabelText('비밀번호'), 'mock-password')
    await userEvent.click(screen.getByRole('button', { name: '로그인' }))
    await waitFor(() => expect(app.visited().at(-1)!.pathname).not.toBe('/login'))
    const signedIn = app.queryClient.getQueryData(SESSION_QUERY_KEY)
    expect(JSON.stringify(signedIn)).toContain('minsu@example.com')
    const pathAfterLogin = app.visited().at(-1)!.pathname

    release()
    await settle()

    expect(app.queryClient.getQueryData(SESSION_QUERY_KEY)).toEqual(signedIn)
    expect(app.visited().at(-1)!.pathname).toBe(pathAfterLogin)
    expect(screen.queryByText(PASSWORD_CHANGED)).toBeNull()
    expect(browser.subscription.unsubscribe).not.toHaveBeenCalled()
    expect(log.started.filter(({ method }) => method === 'DELETE')).toEqual([])
  })
})
