import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { paths } from '@/shared/config/routes'
import { leaveApp } from '@/shared/lib/location'
import { withOAuthResult } from '@/shared/lib/oauth'
import type { OAuthOutcome } from '@/shared/lib/oauth'
import { db } from '@/shared/mock/db'
import { fail } from '@/shared/mock/envelope'
import { settleMockOAuth } from '@/shared/mock/oauth/mockOAuth'
import { applyScenario } from '@/shared/mock/scenarios'
import { server } from '@/shared/mock/server'
import { recordRequests } from '@/shared/test/requests'
import { renderApp } from './test/renderApp'

/* M8-B B-1 — 설정의 Discord 연결 영역과 OAuth 복귀. 현재 탭 이동은 jsdom 이 못 해 leaveApp 만 바꿔 끼운다 */
vi.mock('@/shared/lib/location', () => ({ leaveApp: vi.fn() }))

/** settings-discord-skipped 의 공간. 온보딩에서 Discord·팀원 연결을 건너뛰고 마쳤다 */
const WS = 'ws_03'
const SETTINGS = paths.settings(WS)

beforeEach(() => {
  vi.mocked(leaveApp).mockClear()
  applyScenario('settings-discord-skipped')
})

async function discordArea() {
  return within(await screen.findByTestId('discord-connection'))
}

async function notionArea() {
  return within(await screen.findByTestId('notion-connection'))
}

function returnFrom(outcome: OAuthOutcome) {
  return withOAuthResult(SETTINGS, 'discord', outcome)
}

const onboardingOf = (workspaceId: string) =>
  structuredClone(
    db.workspaces.find(({ workspace_id }) => workspace_id === workspaceId)?.onboarding,
  )

const integrationReads = (log: ReturnType<typeof recordRequests>) =>
  log.started.filter(
    ({ method, path }) => method === 'GET' && path === `/workspaces/${WS}/integrations`,
  )

describe('설정의 Discord 연결 영역 — PM', () => {
  it('미연결이면 `Discord 연결하기` 가 현재 탭을 OAuth 로 옮기고, 복귀는 설정이다', async () => {
    const user = userEvent.setup()
    renderApp(SETTINGS)
    const area = await discordArea()
    expect(await area.findByText('연결 안 됨')).toBeInTheDocument()
    await user.click(area.getByRole('button', { name: 'Discord 연결하기' }))
    expect(leaveApp).toHaveBeenCalledOnce()
    const url = new URL(vi.mocked(leaveApp).mock.calls[0][0], location.origin)
    expect(url.pathname).toBe(`/api/v1/workspaces/${WS}/integrations/discord/start`)
    expect(url.searchParams.get('state')).toBe(SETTINGS)
    // Notion 은 연결돼 있어 연결 버튼이 없다. 연결된 카드의 관리 버튼(Settings 캔버스)만 있다
    expect((await notionArea()).queryByRole('button', { name: /연결하기/ })).toBeNull()
  })

  it('연결된 Discord 에는 연결 액션 대신 `채널 바꾸기` 와 `연결 끊기` 만 있다', async () => {
    db.integrations[WS].discord = {
      status: 'connected',
      display_name: 'Discord 연결됨',
      connected_at: '2026-09-01T00:00:00Z',
    }
    renderApp(SETTINGS)
    const area = await discordArea()
    expect(await area.findByText('연결됨')).toBeInTheDocument()
    expect(area.getAllByRole('button').map((button) => button.textContent)).toEqual([
      '채널 바꾸기',
      '연결 끊기',
    ])
  })

  it('끊긴(revoked) Discord 는 `연결 끊김` 과 `Discord 다시 연결하기` 다 — 문구로도 구분한다', async () => {
    db.integrations[WS].discord = { status: 'revoked', display_name: null, connected_at: null }
    renderApp(SETTINGS)
    const area = await discordArea()
    expect(await area.findByText('연결 끊김')).toBeInTheDocument()
    expect(area.getByRole('button', { name: 'Discord 다시 연결하기' })).toBeInTheDocument()
  })

  it('성공 복귀는 연동을 다시 조회해 connected 면 팀 화면의 팀원 연결 창으로 간다 (D-074)', async () => {
    settleMockOAuth({ workspaceId: WS, provider: 'discord', outcome: 'success' })
    const log = recordRequests()
    const app = renderApp(returnFrom('success'))
    expect(await screen.findByRole('dialog', { name: '팀원 연결' })).toBeInTheDocument()
    await app.expectPath(paths.members(WS))
    await app.expectSearch('?connect=members')
    // 창 뒤는 팀 화면이다 — 모달이 열려 있어 나머지는 접근성 트리에서 가려져 있다
    expect(screen.getByRole('heading', { level: 1, name: '팀', hidden: true })).toBeInTheDocument()
    expect(integrationReads(log).length).toBeGreaterThanOrEqual(1)
  })

  it('설정에서 연결해도 온보딩 단계 저장을 보내지 않고, 건너뜀으로 저장된 단계가 그대로다 (D-173)', async () => {
    const before = onboardingOf(WS)
    settleMockOAuth({ workspaceId: WS, provider: 'discord', outcome: 'success' })
    const log = recordRequests()
    renderApp(returnFrom('success'))
    expect(await screen.findByRole('dialog', { name: '팀원 연결' })).toBeInTheDocument()
    expect(log.started.filter(({ method }) => method === 'PATCH')).toEqual([])
    expect(onboardingOf(WS)).toEqual(before)
    expect(before?.steps).toContainEqual({ step: 'connect_discord', status: 'skipped' })
  })

  it('성공이라고 돌아왔어도 다시 조회한 상태가 connected 가 아니면 실패를 안내하고 다시 연결할 수 있다', async () => {
    const app = renderApp(returnFrom('success'))
    const area = await discordArea()
    expect(
      await area.findByText('Discord를 연결하지 못했어요. 잠시 후 다시 시도해 주세요.'),
    ).toBeInTheDocument()
    expect(await area.findByRole('button', { name: 'Discord 연결하기' })).toBeInTheDocument()
    await app.expectSearch('')
  })

  it.each([
    ['cancelled', 'Discord 연결을 취소했어요. 연결하려면 다시 시도해 주세요.'],
    ['failed', 'Discord를 연결하지 못했어요. 잠시 후 다시 시도해 주세요.'],
  ] as const)('%s 는 설정에 머물며 안내를 보이고 재조회하지 않는다', async (outcome, message) => {
    const log = recordRequests()
    const app = renderApp(returnFrom(outcome))
    const area = await discordArea()
    expect(await area.findByText(message)).toBeInTheDocument()
    expect(await area.findByRole('button', { name: 'Discord 연결하기' })).toBeInTheDocument()
    await app.expectPath(SETTINGS)
    await app.expectSearch('')
    expect(integrationReads(log)).toHaveLength(1)
  })

  it('다시 연결하면 안내를 지운다', async () => {
    const user = userEvent.setup()
    renderApp(returnFrom('cancelled'))
    const area = await discordArea()
    expect(await area.findByRole('alert')).toBeInTheDocument()
    // 안내는 복귀를 읽자마자 보인다. 버튼은 연동 상태를 받은 뒤다
    await user.click(await area.findByRole('button', { name: 'Discord 연결하기' }))
    expect(area.queryByRole('alert')).toBeNull()
    expect(leaveApp).toHaveBeenCalledOnce()
  })

  it('연동 조회가 실패하면 미연결로 보이지 않고 인라인 안내와 다시 시도를 보이며, 다시 시도하면 회복한다', async () => {
    server.use(
      http.get(`/api/v1/workspaces/${WS}/integrations`, () => fail('FORBIDDEN', 'denied', 403), {
        once: true,
      }),
    )
    const user = userEvent.setup()
    renderApp(SETTINGS)
    const area = await discordArea()
    const retry = await area.findByRole('button', { name: '다시 시도' })
    expect(area.queryByText('연결 안 됨')).toBeNull()
    await user.click(retry)
    expect(await area.findByText('연결 안 됨')).toBeInTheDocument()
    expect(area.getByRole('button', { name: 'Discord 연결하기' })).toBeInTheDocument()
  })

  it('Notion 복귀는 Discord 영역이 확인하지 않는다 — Discord 는 안내 없이 상태만 보인다', async () => {
    db.integrations[WS].notion = { status: 'not_connected', display_name: null, connected_at: null }
    settleMockOAuth({ workspaceId: WS, provider: 'notion', outcome: 'success' })
    renderApp(withOAuthResult(paths.settingsNotion(WS), 'notion', 'success'))
    expect(await (await notionArea()).findByText('연결됨')).toBeInTheDocument()
    const area = await discordArea()
    expect(await area.findByText('연결 안 됨')).toBeInTheDocument()
    expect(area.queryByRole('alert')).toBeNull()
    expect(area.queryByText('연결을 확인하고 있어요.')).toBeNull()
  })
})

describe('설정의 연결 영역 — 일반 팀원', () => {
  beforeEach(() => {
    applyScenario('settings-member')
  })

  it('Discord·Notion 상태와 요청 안내만 보고 연결 버튼이 없다', async () => {
    renderApp(paths.settings('ws_01'))
    const discord = await discordArea()
    expect(await discord.findByText('연결 안 됨')).toBeInTheDocument()
    expect(
      discord.getByText(
        'Discord 연결은 PM만 할 수 있어요. 마감 알림을 받으려면 PM에게 Discord 연결을 요청해 주세요.',
      ),
    ).toBeInTheDocument()
    expect(discord.queryByRole('button')).toBeNull()
    const notion = await notionArea()
    expect(await notion.findByText('Notion 연결은 PM이 관리해요.')).toBeInTheDocument()
    expect(notion.queryByRole('button')).toBeNull()
  })

  it('연결된 Discord 는 PM 이 관리한다는 안내만 본다', async () => {
    db.integrations.ws_01.discord = {
      status: 'connected',
      display_name: 'Discord 연결됨',
      connected_at: '2026-09-01T00:00:00Z',
    }
    renderApp(paths.settings('ws_01'))
    const discord = await discordArea()
    expect(await discord.findByText('Discord 연결은 PM이 관리해요.')).toBeInTheDocument()
    expect(discord.queryByRole('button')).toBeNull()
  })

  it('모의 OAuth 를 허용해도 실패로 돌아와 연결되지 않는다 — 서버가 PM 만 연결한다', async () => {
    const outcome = settleMockOAuth({
      workspaceId: 'ws_01',
      provider: 'discord',
      outcome: 'success',
    })
    expect(outcome).toBe('failed')
    renderApp(withOAuthResult(paths.settings('ws_01'), 'discord', outcome))
    const discord = await discordArea()
    expect(
      await discord.findByText('Discord를 연결하지 못했어요. 잠시 후 다시 시도해 주세요.'),
    ).toBeInTheDocument()
    expect(await discord.findByText('연결 안 됨')).toBeInTheDocument()
    expect(discord.queryByRole('button')).toBeNull()
  })
})
