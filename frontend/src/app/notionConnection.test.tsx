import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { integrationsQueryOptions } from '@/entities/integration'
import { paths } from '@/shared/config/routes'
import { leaveApp } from '@/shared/lib/location'
import { withOAuthResult } from '@/shared/lib/oauth'
import type { OAuthOutcome } from '@/shared/lib/oauth'
import { db } from '@/shared/mock/db'
import { fail, ok } from '@/shared/mock/envelope'
import { completeMeeting } from '@/shared/mock/meetingFlow'
import { settleMockOAuth } from '@/shared/mock/oauth/mockOAuth'
import { server } from '@/shared/mock/server'
import { setMockRole } from '@/shared/mock/sessions'
import { deferred } from '@/shared/test/deferred'
import { recordRequests } from '@/shared/test/requests'
import { renderApp } from './test/renderApp'

/* M5 U3-2·U3-3 — 설정의 Notion 연결 영역과 OAuth 복귀. 현재 탭 이동은 jsdom 이 못 해 leaveApp 만 바꿔 끼운다 */
vi.mock('@/shared/lib/location', () => ({ leaveApp: vi.fn() }))
// 준비 중 다시 묻기를 3초가 아니라 짧게 돈다 — 진짜 시간으로 기다린다
vi.mock('@/entities/integration', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/entities/integration')>()),
  CONNECTING_POLL_MS: 20,
}))

const UPLOAD_PATH = paths.meetingUpload('ws_01')
const SETTINGS_NOTION = paths.settingsNotion('ws_01')

beforeEach(() => {
  vi.mocked(leaveApp).mockClear()
  // 업로드로 잘못 가더라도 처리 화면으로 새지 않게 픽스처의 정리 중 회의를 끝내 둔다
  completeMeeting('mt_10')
})

function notion(status: 'connected' | 'not_connected' | 'revoked') {
  db.integrations.ws_01.notion = {
    status,
    display_name: status === 'connected' ? 'Notion 연결됨' : null,
    connected_at: status === 'connected' ? '2026-09-01T00:00:00Z' : null,
  }
}

/**
 * 연동 조회의 처음 `times` 번은 Notion 을 준비 중(connecting)으로 답한다. 그 뒤로는 모의 db 의 값이다.
 * 실제 서버가 DB 를 붙이는 동안 내리는 값이다 (#204). 받은 조회 수를 돌려준다.
 * `hold` 를 주면 그 다음 조회는 풀 때까지 붙잡는다 — `준비 중` 표시를 다음 답이 지우기 전에 검사한다
 */
function connectingFirst(times: number, hold?: ReturnType<typeof deferred>): () => number {
  let asked = 0
  server.use(
    http.get('/api/v1/workspaces/ws_01/integrations', async () => {
      asked += 1
      if (asked === times + 1 && hold) await hold.promise
      if (asked > times) return undefined
      return ok({
        ...db.integrations.ws_01,
        notion: { status: 'connecting', display_name: 'Notion 준비 중', connected_at: null },
      })
    }),
  )
  return () => asked
}

function returnFrom(path: string, outcome: OAuthOutcome) {
  return withOAuthResult(path, 'notion', outcome)
}

async function section() {
  return within(await screen.findByTestId('notion-connection'))
}

function startedState(): string | null {
  const url = new URL(vi.mocked(leaveApp).mock.calls[0][0], location.origin)
  expect(url.pathname).toBe('/api/v1/workspaces/ws_01/integrations/notion/start')
  return url.searchParams.get('state')
}

describe('설정의 Notion 연결 영역 (U3-3)', () => {
  it('설정 화면은 Settings 캔버스의 절을 갖고, 연결된 Notion 에는 연결 액션 대신 관리 버튼만 있다', async () => {
    renderApp(paths.settings('ws_01'))
    const area = await section()
    expect(await area.findByText('연결됨')).toBeInTheDocument()
    expect(area.getAllByRole('button').map((button) => button.textContent)).toEqual([
      '속성 다시 맞추기',
      '연결 끊기',
    ])
    expect(screen.getByLabelText('워크스페이스 이름')).toBeInTheDocument()
    // M8-B 에서 설정을 Settings 캔버스대로 만들었다. 연결 절 안에 Discord·Notion 카드가 있다
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      '일반',
      '연결',
      '자동 반영 기준',
      '알림',
      '계정',
      '이 팀 삭제하기',
    ])
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
      'Discord 연결',
      'Notion 연결',
    ])
  })

  it.each([
    ['not_connected', '연결 안 됨', 'Notion 연결하기'],
    ['revoked', '연결 실패', 'Notion 다시 연결하기'],
  ] as const)('PM — %s 는 %s 와 `%s`', async (status, label, action) => {
    notion(status)
    const user = userEvent.setup()
    renderApp(paths.settings('ws_01'))
    const area = await section()
    expect(await area.findByText(label)).toBeInTheDocument()
    await user.click(area.getByRole('button', { name: action }))
    expect(leaveApp).toHaveBeenCalledOnce()
    // 그냥 설정에서 시작하면 복귀는 설정의 Notion 영역이다 — 업로드로 가지 않는다
    expect(startedState()).toBe(paths.settingsNotion('ws_01'))
  })

  it.each([
    ['not_connected', '연결 안 됨'],
    ['revoked', '연결 실패'],
  ] as const)(
    '일반 팀원 — %s 는 %s 상태와 PM 에게 연결을 요청하라는 안내만 본다',
    async (status, label) => {
      notion(status)
      setMockRole('member')
      renderApp(paths.settings('ws_01'))
      const area = await section()
      expect(await area.findByText(label)).toBeInTheDocument()
      expect(
        await area.findByText(
          'Notion 연결은 PM만 할 수 있어요. 태스크를 Notion에도 올리려면 PM에게 연결을 요청해 주세요.',
        ),
      ).toBeInTheDocument()
      expect(area.queryByRole('button')).toBeNull()
      expect(area.queryByRole('link')).toBeNull()
    },
  )

  it('연결하지 않았으면 선택 기능임을 알린다 — 연결하지 않아도 된다 (D-182)', async () => {
    notion('not_connected')
    renderApp(paths.settings('ws_01'))
    const area = await section()
    expect(
      await area.findByText('연결하지 않아도 돼요. 연결하면 승인한 태스크가 Notion에도 올라가요.'),
    ).toBeInTheDocument()
  })

  it('복귀 없이 열어도 준비 중이면 `준비 중` 을 보이고 다시 연결하게 하지 않는다 (#204)', async () => {
    db.integrations.ws_01.notion = {
      status: 'connecting',
      display_name: 'Notion 준비 중',
      connected_at: null,
    }
    renderApp(paths.settings('ws_01'))

    const area = await section()
    expect(await area.findByText('준비 중')).toBeInTheDocument()
    expect(area.getByText('Notion을 준비하고 있어요. 1분 정도 걸릴 수 있어요.')).toBeInTheDocument()
    expect(area.queryByRole('button', { name: /Notion .*연결하기/ })).toBeNull()
  })

  it('연동 상태를 불러오지 못하면 미연결로 보이지 않고 다시 시도를 준다', async () => {
    server.use(
      http.get('/api/v1/workspaces/:workspaceId/integrations', () => fail('FORBIDDEN', 'no', 403), {
        once: true,
      }),
    )
    const user = userEvent.setup()
    renderApp(paths.settings('ws_01'))
    const area = await section()
    const retry = await area.findByRole('button', { name: '다시 시도' })
    expect(area.queryByText('연결 안 됨')).toBeNull()
    await user.click(retry)
    expect(await area.findByText('연결됨')).toBeInTheDocument()
  })
})

describe('OAuth 복귀 (U3-2)', () => {
  it('Notion 영역으로 오면 제목에 포커스가 가고, 연결 시작의 복귀는 설정의 Notion 영역이다', async () => {
    notion('not_connected')
    const user = userEvent.setup()
    renderApp(SETTINGS_NOTION)
    expect(await screen.findByRole('heading', { name: 'Notion 연결' })).toHaveFocus()
    const area = await section()
    await user.click(await area.findByRole('button', { name: 'Notion 연결하기' }))
    expect(startedState()).toBe(SETTINGS_NOTION)
  })

  it('성공 콜백 뒤 연동 상태를 다시 조회해 connected 면 설정에 머물며 연결됨을 보인다 (D-182)', async () => {
    settleMockOAuth({ workspaceId: 'ws_01', provider: 'notion', outcome: 'success' })
    const log = recordRequests()
    const app = renderApp(returnFrom(SETTINGS_NOTION, 'success'))

    const area = await section()
    expect(await area.findByText('연결됨')).toBeInTheDocument()
    await waitFor(() => expect(area.queryByText('연결을 확인하고 있어요.')).toBeNull())
    await app.expectPath(paths.settings('ws_01'))
    await app.expectSearch('?section=notion')
    // 복귀 표시만 믿지 않았다 — 연동 상태를 새로 받았다
    expect(log.started.map(({ path }) => path)).toContain('/workspaces/ws_01/integrations')
    expect(app.visited().map(({ pathname }) => pathname)).not.toContain(UPLOAD_PATH)
    expect(leaveApp).not.toHaveBeenCalled()
  })

  it('StrictMode 에서도 복귀 확인이 끝까지 가서 연결됨을 보인다', async () => {
    settleMockOAuth({ workspaceId: 'ws_01', provider: 'notion', outcome: 'success' })
    const app = renderApp(returnFrom(SETTINGS_NOTION, 'success'), { strict: true })
    const area = await section()
    expect(await area.findByText('연결됨')).toBeInTheDocument()
    await app.expectPath(paths.settings('ws_01'))
  })

  it('복귀 확인에서 준비 중(connecting)이면 실패로 보지 않고 기다렸다가, connected 가 되면 연결됨을 보인다 (#204)', async () => {
    settleMockOAuth({ workspaceId: 'ws_01', provider: 'notion', outcome: 'success' })
    const next = deferred()
    const asked = connectingFirst(1, next)
    const app = renderApp(returnFrom(SETTINGS_NOTION, 'success'))

    const area = await section()
    // 두 번째 조회를 붙잡아 둔 동안 `준비 중` 이 보인다
    await waitFor(() => expect(asked()).toBe(2))
    expect(area.getByText('Notion을 준비하고 있어요. 1분 정도 걸릴 수 있어요.')).toBeInTheDocument()
    next.resolve()
    expect(await area.findByText('연결됨')).toBeInTheDocument()
    await app.expectPath(paths.settings('ws_01'))
    expect(asked()).toBeGreaterThanOrEqual(2)
  })

  it('준비 중 뒤 revoked 가 오면 설정에 머물고 실패를 안내한다 — 다시 연결할 수 있다', async () => {
    settleMockOAuth({ workspaceId: 'ws_01', provider: 'notion', outcome: 'success' })
    notion('revoked')
    connectingFirst(2)
    const app = renderApp(returnFrom(SETTINGS_NOTION, 'success'))

    const area = await section()
    expect(
      await area.findByText('Notion을 연결하지 못했어요. 잠시 후 다시 시도해 주세요.'),
    ).toBeInTheDocument()
    expect(area.queryByText('Notion을 준비하고 있어요. 1분 정도 걸릴 수 있어요.')).toBeNull()
    expect(await area.findByRole('button', { name: 'Notion 다시 연결하기' })).toBeInTheDocument()
    await app.expectPath(paths.settings('ws_01'))
  })

  it('성공이라고 돌아왔어도 다시 조회한 상태가 connected 가 아니면 설정에 머물고 안내한다', async () => {
    notion('not_connected')
    const app = renderApp(returnFrom(SETTINGS_NOTION, 'success'))
    const area = await section()
    expect(
      await area.findByText('Notion을 연결하지 못했어요. 잠시 후 다시 시도해 주세요.'),
    ).toBeInTheDocument()
    await app.expectPath(paths.settings('ws_01'))
    // 복귀 표시는 지우고 `section` 은 남긴다
    await app.expectSearch('?section=notion')
  })

  it.each([
    ['cancelled', 'Notion 연결을 취소했어요. 연결하려면 다시 시도해 주세요.'],
    ['failed', 'Notion을 연결하지 못했어요. 잠시 후 다시 시도해 주세요.'],
  ] as const)('%s 는 설정에 머물며 안내를 보이고 재조회하지 않는다', async (outcome, message) => {
    notion('not_connected')
    const log = recordRequests()
    const app = renderApp(returnFrom(SETTINGS_NOTION, outcome))
    const area = await section()
    expect(await area.findByText(message)).toBeInTheDocument()
    await app.expectSearch('?section=notion')
    await app.expectPath(paths.settings('ws_01'))
    // 연결 버튼이 그대로 있다
    expect(await area.findByRole('button', { name: 'Notion 연결하기' })).toBeInTheDocument()
    expect(
      log.started.filter(({ path }) => path === '/workspaces/ws_01/integrations'),
    ).toHaveLength(1)
  })

  it('옛 차단 모달의 복귀 주소(`next` = 업로드)로 돌아와도 설정에 머문다 (D-182)', async () => {
    settleMockOAuth({ workspaceId: 'ws_01', provider: 'notion', outcome: 'success' })
    const legacy = `${SETTINGS_NOTION}&next=${encodeURIComponent(UPLOAD_PATH)}`
    const app = renderApp(returnFrom(legacy, 'success'))
    const area = await section()
    expect(await area.findByText('연결됨')).toBeInTheDocument()
    await waitFor(() => expect(area.queryByText('연결을 확인하고 있어요.')).toBeNull())
    await app.expectPath(paths.settings('ws_01'))
    expect(app.visited().map(({ pathname }) => pathname)).not.toContain(UPLOAD_PATH)
    expect(area.queryByRole('link')).toBeNull()
  })
})

describe('복귀 확인이 늦게 끝날 때 (U3-2)', () => {
  /**
   * 복귀 확인의 연동 조회를 풀 때까지 모두 붙잡는다. 풀면 원래 handler 가 응답한다.
   * StrictMode 의 시험 재마운트가 이 영역의 구독을 잠깐 내리면 첫 조회가 취소되고, 확인은 같은 Query 를 다시 묻는다
   * (fetchFresh, U4 r4 M06) — 그 조회도 붙잡아야 확인이 늦게 끝나는 모양이 된다
   */
  function holdVerification() {
    const gate = deferred()
    server.use(
      http.get('/api/v1/workspaces/:workspaceId/integrations', async () => {
        await gate.promise
        return undefined
      }),
    )
    return gate
  }

  it('확인 중에 고친 입력이 있어도 끝났을 때 옮기거나 묻지 않는다 — 입력과 연결됨이 남는다', async () => {
    settleMockOAuth({ workspaceId: 'ws_01', provider: 'notion', outcome: 'success' })
    const gate = holdVerification()
    const user = userEvent.setup()
    const app = renderApp(returnFrom(SETTINGS_NOTION, 'success'), { strict: true })
    const area = await section()
    expect(await area.findByText('연결을 확인하고 있어요.')).toBeInTheDocument()
    const name = screen.getByLabelText('워크스페이스 이름')
    await user.clear(name)
    await user.type(name, 'unsaved-review-draft')

    gate.resolve()
    await waitFor(() =>
      expect(
        app.queryClient.getQueryData(integrationsQueryOptions('ws_01').queryKey)?.notion.status,
      ).toBe('connected'),
    )
    expect(await area.findByText('연결됨')).toBeInTheDocument()
    await act(async () => {})
    expect(screen.queryByRole('dialog')).toBeNull()
    await app.expectPath(paths.settings('ws_01'))
    expect(screen.getByLabelText('워크스페이스 이름')).toHaveValue('unsaved-review-draft')
  })
})
