import { act, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { workspaceListQueryOptions } from '@/entities/workspace'
import { paths } from '@/shared/config/routes'
import { db } from '@/shared/mock/db'
import { applyScenario } from '@/shared/mock/scenarios'
import { renderApp } from './test/renderApp'

/*
 * #430 첫 방문 인트로. 같은 인트로가 두 곳에 나온다.
 * - 랜딩: 이 기기에서 로그인·가입 버튼을 처음 누를 때. 닫으면 원래 가던 곳으로 간다. 랜딩을 열 때는 덮지 않는다
 * - 대시보드: 이 브라우저에서 온보딩을 마친 계정(PM 완료·팀원 첫 입장)이 처음 들어올 때. 계정당 한 번
 */

vi.setConfig({ testTimeout: 30_000 })

const LANDING_HEADING = /한 번의 클릭으로/
const FIRST_LINE = '안녕하세요, 저는 매스예요.'

const intro = () => screen.queryByRole('dialog', { name: '매스 소개' })

const throwing = () => {
  throw new DOMException('blocked', 'SecurityError')
}

afterEach(() => vi.restoreAllMocks())

async function openLanding() {
  db.authenticated = false
  const app = renderApp('/')
  // 파일의 첫 렌더는 lazy 화면 변환이 부하를 받으면 기본 3초를 넘길 때가 있다. 뒤의 단언은 기본 한도다
  await screen.findByRole('heading', { level: 1, name: LANDING_HEADING }, { timeout: 10_000 })
  return app
}

const headerStart = () => within(screen.getByRole('banner')).getByRole('link', { name: '시작하기' })

async function logIn(email: string) {
  await screen.findByRole('heading', { name: '로그인' })
  await userEvent.type(screen.getByLabelText('이메일'), email)
  await userEvent.type(screen.getByLabelText('비밀번호'), 'mock-password')
  await userEvent.click(screen.getByRole('button', { name: '로그인' }))
}

/** 다른 요청의 401 로 지금 세션이 끝난다 — 인트로를 닫지 않은 채 로그인 화면으로 간다 */
async function expireSession(app: ReturnType<typeof renderApp>) {
  db.authenticated = false
  await act(async () => {
    await app.queryClient.invalidateQueries({
      queryKey: workspaceListQueryOptions().queryKey,
      refetchType: 'all',
    })
  })
  await app.expectPath('/login')
}

function addMemberAccount() {
  db.accounts.push({
    session: {
      user: { user_id: 'us_02', email: 'member@example.com', name: '이재환', avatar_url: null },
      workspace_count: 1,
      last_workspace_id: 'ws_01',
    },
    password: 'mock-password',
    workspaceIds: ['ws_01'],
    memberIds: { ws_01: 'mb_03' },
  })
}

/** 팀원 온보딩에서 공간을 고른다 — 이 계정의 첫 입장이다 */
async function chooseOnMemberOnboarding(app: ReturnType<typeof renderApp>) {
  act(() => app.navigate(paths.onboardingMember()))
  // 이동 전 대시보드 헤더의 `워크스페이스 바꾸기 카테캠 3팀` 을 누르지 않게 화면이 바뀐 뒤 찾는다
  await app.expectPath(paths.onboardingMember())
  await userEvent.click(await screen.findByRole('button', { name: /카테캠 3팀/ }))
  await app.expectPath(paths.dashboard('ws_01'))
}

describe('랜딩의 첫 방문 인트로 (#430)', () => {
  it('랜딩을 열 때는 덮지 않는다 — 랜딩 본문이 그대로 보인다', async () => {
    await openLanding()
    expect(intro()).toBeNull()
    expect(screen.getAllByRole('link', { name: '시작하기' })).toHaveLength(3)
  })

  it.each(['시작하기', '건너뛰기'])(
    '처음 누르면 인트로가 먼저 뜨고, `%s` 를 누르면 로그인으로 간다',
    async (close) => {
      const app = await openLanding()
      await userEvent.click(headerStart())

      const dialog = await screen.findByRole('dialog', { name: '매스 소개' })
      expect(within(dialog).getByText(FIRST_LINE)).toBeInTheDocument()
      await app.expectPath('/')

      await userEvent.click(within(dialog).getByRole('button', { name: close }))
      expect(await screen.findByRole('heading', { name: '로그인' })).toBeInTheDocument()
      await app.expectPath('/login')
      expect(intro()).toBeNull()
    },
  )

  it('Esc 로 닫아도 로그인으로 간다', async () => {
    const app = await openLanding()
    await userEvent.click(headerStart())
    await screen.findByRole('dialog', { name: '매스 소개' })
    await userEvent.keyboard('{Escape}')
    await app.expectPath('/login')
  })

  it.each([
    ['히어로', 1],
    ['마지막 CTA', 2],
  ])('%s 의 `시작하기` 도 처음 누를 때는 인트로를 먼저 보인다', async (_place, at) => {
    const app = await openLanding()
    await userEvent.click(screen.getAllByRole('link', { name: '시작하기' })[at])
    expect(await screen.findByRole('dialog', { name: '매스 소개' })).toBeInTheDocument()
    await app.expectPath('/')
  })

  it('한 번 본 기기는 다시 누르면 바로 로그인으로 간다', async () => {
    let app = await openLanding()
    await userEvent.click(headerStart())
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: '건너뛰기' }),
    )
    await app.expectPath('/login')
    app.unmount()

    app = await openLanding()
    await userEvent.click(screen.getAllByRole('link', { name: '시작하기' })[2])
    expect(await screen.findByRole('heading', { name: '로그인' })).toBeInTheDocument()
    await app.expectPath('/login')
    expect(intro()).toBeNull()
  })

  it.each([
    ['/login', '로그인'],
    [`/login?next=${encodeURIComponent(paths.tasks('ws_01'))}`, '로그인'],
    ['/signup', '회원가입'],
  ])('%s 로 바로 들어오면 인트로가 없다', async (path, heading) => {
    db.authenticated = false
    renderApp(path)
    expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument()
    expect(intro()).toBeNull()
  })

  it('저장소를 읽지도 쓰지도 못하면 누를 때마다 인트로를 보이고, 닫으면 그대로 로그인으로 간다', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(throwing)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(throwing)
    const app = await openLanding()
    await userEvent.click(headerStart())
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: '시작하기' }),
    )
    expect(await screen.findByRole('heading', { name: '로그인' })).toBeInTheDocument()
    await app.expectPath('/login')
  })
})

describe('온보딩을 마친 뒤 첫 대시보드의 인트로 (#430)', () => {
  it('PM 이 온보딩을 마치면 대시보드에서 한 번 보이고, 닫은 뒤 새로고침해도 다시 보이지 않는다', async () => {
    applyScenario('incomplete-workspace')
    let app = renderApp('/onboarding/ws_03/connect_discord')
    await userEvent.click(await screen.findByRole('button', { name: '건너뛰기' }))
    await screen.findByRole('heading', { name: 'Notion 연결' })
    await userEvent.click(await screen.findByRole('button', { name: '건너뛰기' }))
    await screen.findByRole('heading', { level: 1, name: '팀원 연결' })
    await userEvent.click(screen.getByRole('button', { name: '건너뛰기' }))

    const dialog = await screen.findByRole('dialog', { name: '매스 소개' })
    await app.expectPath(paths.dashboard('ws_03'))
    await userEvent.click(within(dialog).getByRole('button', { name: '시작하기' }))
    expect(intro()).toBeNull()
    expect(await screen.findByRole('heading', { name: '대시보드' })).toBeInTheDocument()

    app.unmount()
    app = renderApp(paths.dashboard('ws_03'))
    expect(await screen.findByRole('heading', { name: '대시보드' })).toBeInTheDocument()
    expect(intro()).toBeNull()
  })

  it('팀원 온보딩에서 공간을 고르면 그 대시보드에서 한 번 보이고, 다시 들어와도 보이지 않는다', async () => {
    applyScenario('single-workspace')
    const app = renderApp(paths.onboardingMember())
    await userEvent.click(await screen.findByRole('button', { name: /카테캠 3팀/ }))

    const dialog = await screen.findByRole('dialog', { name: '매스 소개' })
    await userEvent.click(within(dialog).getByRole('button', { name: '건너뛰기' }))
    expect(await screen.findByRole('heading', { name: '대시보드' })).toBeInTheDocument()

    act(() => app.navigate(paths.tasks('ws_01')))
    await app.expectPath(paths.tasks('ws_01'))
    act(() => app.navigate(paths.dashboard('ws_01')))
    expect(await screen.findByRole('heading', { name: '대시보드' })).toBeInTheDocument()
    expect(intro()).toBeNull()
  })

  it('시작 화면에서 받은 초대를 수락해 들어가도 첫 입장이라 한 번 보인다', async () => {
    applyScenario('invitation-pending')
    const app = renderApp('/signup')
    await screen.findByRole('heading', { name: '회원가입' })
    await userEvent.type(screen.getByLabelText('이름'), '이재환')
    await userEvent.type(screen.getByLabelText('이메일'), 'jaehwan@example.com')
    await userEvent.type(screen.getByLabelText('비밀번호'), 'pass1234')
    await userEvent.click(screen.getByRole('button', { name: '계정 만들기' }))
    await app.expectPath('/onboarding/start')

    const invitations = within(await screen.findByRole('region', { name: '받은 초대' }))
    await userEvent.click(invitations.getByRole('button', { name: '수락' }))
    expect(await screen.findByRole('dialog', { name: '매스 소개' })).toBeInTheDocument()
    await app.expectPath(paths.dashboard('ws_01'))
  })

  it('이미 쓰던 계정이 로그인해 대시보드에 들어오면 보이지 않는다', async () => {
    applyScenario('single-workspace')
    db.authenticated = false
    const app = renderApp('/login')
    await logIn('pm@example.com')
    expect(await screen.findByRole('heading', { name: '대시보드' })).toBeInTheDocument()
    await app.expectPath(paths.dashboard('ws_01'))
    expect(intro()).toBeNull()
  })

  it('선택 화면에서 공간을 고르는 것은 첫 입장이 아니라 보이지 않는다', async () => {
    applyScenario('multiple-workspaces')
    const app = renderApp(paths.workspaceSelect())
    await userEvent.click(await screen.findByRole('button', { name: /카테캠 3팀/ }))
    expect(await screen.findByRole('heading', { name: '대시보드' })).toBeInTheDocument()
    await app.expectPath(paths.dashboard('ws_01'))
    expect(intro()).toBeNull()
  })

  it('같은 기기의 두 번째 계정은 자기 신호로 따로 한 번 본다', async () => {
    applyScenario('single-workspace')
    addMemberAccount()
    const app = renderApp(paths.onboardingMember())
    await userEvent.click(await screen.findByRole('button', { name: /카테캠 3팀/ }))
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: '시작하기' }),
    )

    await expireSession(app)
    await logIn('member@example.com')
    expect(await screen.findByRole('heading', { name: '대시보드' })).toBeInTheDocument()
    expect(intro()).toBeNull()

    await chooseOnMemberOnboarding(app)
    expect(await screen.findByRole('dialog', { name: '매스 소개' })).toBeInTheDocument()
  })

  it('닫기 전에 세션이 끝나면 본 것으로 적지 않는다 — 다시 로그인하면 또 보인다', async () => {
    applyScenario('single-workspace')
    const app = renderApp(paths.onboardingMember())
    await userEvent.click(await screen.findByRole('button', { name: /카테캠 3팀/ }))
    await screen.findByRole('dialog', { name: '매스 소개' })

    await expireSession(app)
    expect(intro()).toBeNull()
    await logIn('pm@example.com')
    await app.expectPath(paths.dashboard('ws_01'))
    expect(await screen.findByRole('dialog', { name: '매스 소개' })).toBeInTheDocument()
  })

  it('저장소를 읽지 못하면 신호가 없는 것으로 보고 인트로 없이 대시보드가 열린다', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(throwing)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(throwing)
    applyScenario('single-workspace')
    const app = renderApp(paths.onboardingMember())
    await userEvent.click(await screen.findByRole('button', { name: /카테캠 3팀/ }))
    expect(await screen.findByRole('heading', { name: '대시보드' })).toBeInTheDocument()
    await app.expectPath(paths.dashboard('ws_01'))
    expect(intro()).toBeNull()
  })
})
