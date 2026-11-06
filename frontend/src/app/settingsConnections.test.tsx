import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { onTestFinished } from 'vitest'
import { paths } from '@/shared/config/routes'
import { leaveApp } from '@/shared/lib/location'
import { withOAuthResult } from '@/shared/lib/oauth'
import type { OAuthOutcome } from '@/shared/lib/oauth'
import { db } from '@/shared/mock/db'
import { fail } from '@/shared/mock/envelope'
import { settleMockOAuth } from '@/shared/mock/oauth/mockOAuth'
import { applyScenario } from '@/shared/mock/scenarios'
import { server } from '@/shared/mock/server'
import { setMockRole } from '@/shared/mock/sessions'
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

  it('끊긴(revoked) Discord 는 `연결 끊김` 과 `Discord 다시 연결하기` 다 — 문구로도 구분한다', async () => {
    db.integrations[WS].discord = {
      status: 'revoked',
      display_name: null,
      connected_at: null,
      chat_channel: null,
    }
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

  it('연동 조회가 실패하면 인라인 안내와 다시 시도를 보이고, 다시 시도하면 회복한다', async () => {
    server.use(
      http.get(`/api/v1/workspaces/${WS}/integrations`, () => fail('FORBIDDEN', 'denied', 403), {
        once: true,
      }),
    )
    const user = userEvent.setup()
    renderApp(SETTINGS)
    const area = await discordArea()
    await user.click(await area.findByRole('button', { name: '다시 시도' }))
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
      chat_channel: null,
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

describe('Discord 연결 끊기 확인 — 회의 채팅 채널', () => {
  const DESCRIPTION = '연결을 끊으면 이미 반영한 내용은 그대로 남고, 새 내용만 쓰지 않게 됩니다.'

  beforeEach(() => {
    applyScenario('single-workspace')
  })

  async function openDisconnect() {
    const user = userEvent.setup()
    renderApp(paths.settings('ws_01'))
    const area = await discordArea()
    await user.click(await area.findByRole('button', { name: '연결 끊기' }))
    return { user, dialog: await screen.findByRole('dialog', { name: 'Discord 연결을 끊을까요?' }) }
  }

  it('채팅 채널이 있으면 그 채널의 수집도 함께 꺼진다고 알리고, 끊은 뒤에는 채널이 비어 있다', async () => {
    db.integrations.ws_01.discord.chat_channel = { channel_id: '1300000000000000001', name: '일반' }
    const { user, dialog } = await openDisconnect()
    expect(dialog).toHaveAccessibleDescription(
      `${DESCRIPTION} 회의 채팅 채널(#일반) 수집도 함께 꺼져요.`,
    )
    await user.click(within(dialog).getByRole('button', { name: '연결 끊기' }))
    expect(await (await discordArea()).findByText('연결 안 됨')).toBeInTheDocument()
    expect(db.integrations.ws_01.discord.chat_channel).toBeNull()
  })

  it('채팅 채널이 없으면 기존 설명만 보인다', async () => {
    const { dialog } = await openDisconnect()
    expect(dialog).toHaveAccessibleDescription(DESCRIPTION)
  })
})

describe('설정의 회의 채팅 채널 — PM (#429)', () => {
  const NOT_CONNECTED = 'Discord를 먼저 연결해 주세요. 연결하면 회의 채팅 채널을 고를 수 있어요.'
  const SAVE_NOTICE =
    '이 채널 대화는 매일 09:00에 읽혀 task 제안에 쓰여요. 저장하면 봇이 채널에 안내 메시지를 남겨요. 제안은 PM 승인 뒤에만 반영돼요.'
  const GENERAL = { channel_id: '1300000000000000001', name: '일반' }
  const CHAT_CHANNEL = '/workspaces/ws_01/integrations/discord/chat-channel'
  const CHANNELS = '/workspaces/ws_01/discord/channels'

  beforeEach(() => {
    applyScenario('single-workspace')
  })

  const requestsTo = (log: ReturnType<typeof recordRequests>, method: string, path: string) =>
    log.started.filter((request) => request.method === method && request.path === path)

  /** 목록을 받아 고를 수 있게 된 칸 */
  async function openField() {
    const user = userEvent.setup()
    renderApp(paths.settings('ws_01'))
    const area = await discordArea()
    const select = await area.findByRole('combobox', { name: '회의 채팅 채널' })
    await waitFor(() => expect(select).toBeEnabled())
    return { user, area, select }
  }

  /** 키보드로 목록을 열고 줄을 누른다. 목록은 포털이라 카드 밖에 있다 */
  async function openList(select: HTMLElement) {
    select.focus()
    await userEvent.keyboard('{Enter}')
    return screen.findByRole('listbox')
  }

  async function pick(user: ReturnType<typeof userEvent.setup>, label: string) {
    const select = screen.getByRole('combobox', { name: '회의 채팅 채널' })
    await user.click(within(await openList(select)).getByRole('option', { name: label }))
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull())
  }

  it('Discord 가 연결돼 있지 않으면 칸이 꺼져 있고 먼저 연결하라고 안내하며, 채널 목록을 묻지 않는다', async () => {
    applyScenario('settings-discord-skipped')
    const log = recordRequests()
    renderApp(SETTINGS)
    const select = await (await discordArea()).findByRole('combobox', { name: '회의 채팅 채널' })
    expect(select).toBeDisabled()
    expect(select).toHaveAccessibleDescription(NOT_CONNECTED)
    expect(select).toHaveTextContent('사용 안 함')
    expect(log.started.filter(({ path }) => path.endsWith('/discord/channels'))).toEqual([])
  })

  it('선택지는 `사용 안 함` 과 연결한 서버의 텍스트 채널이고, 지금 값은 사용 안 함이다', async () => {
    const { select } = await openField()
    expect(
      within(await openList(select))
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['사용 안 함', '#일반', '#회의록', '#운영-비공개', '#공지'])
    expect(select).toHaveTextContent('사용 안 함')
  })

  it('채널을 고르면 저장 전에 안내를 보이고, 저장하면 그 채널로 PUT 을 보내 저장한 값을 보인다', async () => {
    const bodies: unknown[] = []
    const onStart = ({ request }: { request: Request }) => {
      if (request.method === 'PUT')
        void request
          .clone()
          .json()
          .then((body: unknown) => bodies.push(body))
    }
    server.events.on('request:start', onStart)
    onTestFinished(() => server.events.removeListener('request:start', onStart))
    const { user, area, select } = await openField()
    const log = recordRequests()

    await pick(user, '#일반')
    expect(select).toHaveAccessibleDescription(SAVE_NOTICE)
    expect(requestsTo(log, 'PUT', CHAT_CHANNEL)).toEqual([])

    await user.click(area.getByRole('button', { name: '저장' }))
    expect(await screen.findByText('회의 채팅 채널을 저장했어요.')).toBeInTheDocument()
    expect(bodies).toEqual([{ channel_id: GENERAL.channel_id }])
    expect(db.integrations.ws_01.discord.chat_channel).toEqual(GENERAL)
    expect(select).toHaveTextContent('#일반')
    expect(area.queryByRole('button', { name: '저장' })).toBeNull()
    expect(area.queryByText(SAVE_NOTICE)).toBeNull()
  })

  it('되돌리기는 고른 값을 버리고 저장한 값으로 돌아간다', async () => {
    const { user, area, select } = await openField()
    await pick(user, '#회의록')
    await user.click(area.getByRole('button', { name: '되돌리기' }))
    expect(select).toHaveTextContent('사용 안 함')
    expect(area.queryByRole('button', { name: '저장' })).toBeNull()
    expect(area.queryByText(SAVE_NOTICE)).toBeNull()
  })

  it('`사용 안 함` 으로 저장하면 DELETE 를 보내고 수집을 껐다고 알린다', async () => {
    db.integrations.ws_01.discord.chat_channel = { ...GENERAL }
    const { user, area, select } = await openField()
    expect(select).toHaveTextContent('#일반')
    const log = recordRequests()

    await pick(user, '사용 안 함')
    // 끄면 새로 읽히는 채널이 없다 — 켬 안내를 보이지 않는다
    expect(area.queryByText(SAVE_NOTICE)).toBeNull()
    await user.click(area.getByRole('button', { name: '저장' }))
    expect(await screen.findByText('회의 채팅 채널 수집을 껐어요.')).toBeInTheDocument()
    expect(requestsTo(log, 'DELETE', CHAT_CHANNEL)).toHaveLength(1)
    expect(requestsTo(log, 'PUT', CHAT_CHANNEL)).toEqual([])
    expect(db.integrations.ws_01.discord.chat_channel).toBeNull()
    expect(select).toHaveTextContent('사용 안 함')
  })

  it.each([
    [
      '#운영-비공개',
      '봇이 이 채널을 읽을 수 없어요. Discord 채널 설정의 권한에 봇을 추가해 주세요.',
    ],
    [
      '#공지',
      '봇이 이 채널에 메시지를 보낼 수 없어요. Discord 채널 권한에서 봇에게 메시지 보내기 권한을 주세요.',
    ],
  ])(
    '봇이 다룰 수 없는 채널(%s)은 고칠 방법을 칸 아래에 알리고 저장하지 않는다',
    async (option, message) => {
      const { user, area, select } = await openField()
      await pick(user, option)
      await user.click(area.getByRole('button', { name: '저장' }))
      expect(await area.findByRole('alert')).toHaveTextContent(message)
      expect(db.integrations.ws_01.discord.chat_channel).toBeNull()
      expect(select).toHaveAccessibleDescription(expect.stringContaining(message))
      expect(select).toHaveAttribute('aria-invalid', 'true')
      // 고른 값은 남아 권한을 고친 뒤 다시 저장할 수 있다. 다른 채널을 고르면 지난 실패를 지운다
      expect(select).toHaveTextContent(option)
      await pick(user, '#일반')
      expect(area.queryByRole('alert')).toBeNull()
    },
  )

  it('목록을 받은 뒤 서버에서 사라진 채널은 다시 고르라고 알리고 목록을 다시 받는다', async () => {
    const { user, area, select } = await openField()
    const log = recordRequests()
    db.discordChannels = db.discordChannels.filter(({ name }) => name !== '회의록')

    await pick(user, '#회의록')
    await user.click(area.getByRole('button', { name: '저장' }))
    expect(await area.findByRole('alert')).toHaveTextContent(
      '연결된 Discord 서버에서 이 텍스트 채널을 찾을 수 없어요. 채널 목록을 다시 불러왔으니 다시 골라 주세요.',
    )
    await waitFor(() => expect(requestsTo(log, 'GET', CHANNELS)).toHaveLength(1))
    await waitFor(() => expect(select).toBeEnabled())
    expect(within(await openList(select)).queryByRole('option', { name: '#회의록' })).toBeNull()
    expect(screen.getByRole('option', { name: '#일반' })).toBeInTheDocument()
  })

  it('저장한 채널이 지금 목록에 없어도 지금 값으로 보인다', async () => {
    db.integrations.ws_01.discord.chat_channel = {
      channel_id: '1300000000000000099',
      name: '옛-회의',
    }
    const { select } = await openField()
    expect(select).toHaveTextContent('#옛-회의')
  })

  it('채널 목록을 받지 못하면 칸 아래에서 다시 시도할 수 있다', async () => {
    // 502 는 한 번 다시 묻는다. 다시 물어도 실패한 뒤에 Discord 가 돌아온다
    let failing = true
    server.use(
      http.get(`/api/v1${CHANNELS}`, () =>
        failing ? fail('DISCORD_API_FAILED', 'boom', 502) : undefined,
      ),
    )
    const user = userEvent.setup()
    renderApp(paths.settings('ws_01'))
    const area = await discordArea()
    expect(
      await area.findByText('채널 목록을 불러오지 못했어요', undefined, { timeout: 5_000 }),
    ).toBeInTheDocument()
    failing = false
    await user.click(area.getByRole('button', { name: '다시 시도' }))
    const select = area.getByRole('combobox', { name: '회의 채팅 채널' })
    await waitFor(() => expect(select).toBeEnabled())
    expect(
      within(await openList(select)).getByRole('option', { name: '#일반' }),
    ).toBeInTheDocument()
    expect(area.queryByText('채널 목록을 불러오지 못했어요')).toBeNull()
  })

  it('일반 팀원은 칸을 보지 않고 채널 목록도 묻지 않는다', async () => {
    setMockRole('member', 'ws_01')
    const log = recordRequests()
    renderApp(paths.settings('ws_01'))
    const area = await discordArea()
    expect(await area.findByText('Discord 연결은 PM이 관리해요.')).toBeInTheDocument()
    expect(area.queryByRole('combobox')).toBeNull()
    expect(requestsTo(log, 'GET', CHANNELS)).toEqual([])
  })
})
