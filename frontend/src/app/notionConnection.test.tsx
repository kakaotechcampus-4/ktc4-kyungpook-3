import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { integrationsQueryOptions } from '@/entities/integration'
import { paths } from '@/shared/config/routes'
import { leaveApp } from '@/shared/lib/location'
import { withOAuthResult } from '@/shared/lib/oauth'
import type { OAuthOutcome } from '@/shared/lib/oauth'
import { db } from '@/shared/mock/db'
import { fail } from '@/shared/mock/envelope'
import { completeMeeting } from '@/shared/mock/meetingFlow'
import { settleMockOAuth } from '@/shared/mock/oauth/mockOAuth'
import { server } from '@/shared/mock/server'
import { setMockRole } from '@/shared/mock/sessions'
import { deferred } from '@/shared/test/deferred'
import { recordRequests } from '@/shared/test/requests'
import { renderApp } from './test/renderApp'

/* M5 U3-2·U3-3 — 설정의 Notion 연결 영역과 OAuth 복귀. 현재 탭 이동은 jsdom 이 못 해 leaveApp 만 바꿔 끼운다 */
vi.mock('@/shared/lib/location', () => ({ leaveApp: vi.fn() }))

const UPLOAD_PATH = paths.meetingUpload('ws_01')
const FROM_MODAL = paths.settingsNotion('ws_01', UPLOAD_PATH)

beforeEach(() => {
  vi.mocked(leaveApp).mockClear()
  // 업로드로 돌아왔을 때 처리 화면으로 가지 않도록 픽스처의 정리 중 회의를 끝내 둔다
  completeMeeting('mt_10')
})

function notion(status: 'connected' | 'not_connected' | 'revoked') {
  db.integrations.ws_01.notion = {
    status,
    display_name: status === 'connected' ? 'Notion 연결됨' : null,
    connected_at: status === 'connected' ? '2026-09-01T00:00:00Z' : null,
  }
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
  it('설정 화면에는 기존 입력과 Notion 연결 영역만 있다 — 연결됨이면 연결 액션이 없다', async () => {
    renderApp(paths.settings('ws_01'))
    const area = await section()
    expect(await area.findByText('연결됨')).toBeInTheDocument()
    expect(area.queryByRole('button')).toBeNull()
    expect(screen.getByLabelText('워크스페이스 이름')).toBeInTheDocument()
    // Settings 캔버스의 다른 절(자동 반영·알림·팀 삭제·Discord)은 M8 이다
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      'Notion 연결',
    ])
  })

  it.each([
    ['not_connected', '연결 안 됨', 'Notion 연결하기'],
    ['revoked', '연결 끊김', 'Notion 다시 연결하기'],
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

  it.each(['not_connected', 'revoked'] as const)(
    '일반 팀원 — %s 상태와 PM 에게 연결을 요청하라는 안내만 본다',
    async (status) => {
      notion(status)
      setMockRole('member')
      renderApp(paths.settings('ws_01'))
      const area = await section()
      expect(
        await area.findByText(
          'Notion 연결은 PM만 할 수 있어요. 회의를 정리하려면 PM에게 Notion 연결을 요청해 주세요.',
        ),
      ).toBeInTheDocument()
      expect(area.queryByRole('button')).toBeNull()
      expect(area.queryByRole('link')).toBeNull()
    },
  )

  it('연동 상태를 불러오지 못하면 다시 시도를 준다', async () => {
    server.use(
      http.get('/api/v1/workspaces/:workspaceId/integrations', () => fail('FORBIDDEN', 'no', 403), {
        once: true,
      }),
    )
    const user = userEvent.setup()
    renderApp(paths.settings('ws_01'))
    const area = await section()
    await user.click(await area.findByRole('button', { name: '다시 시도' }))
    expect(await area.findByText('연결됨')).toBeInTheDocument()
  })
})

describe('차단 모달에서 시작한 연결 (U3-2, D-098)', () => {
  it('모달에서 오면 Notion 영역 제목에 포커스가 가고, 연결 시작은 복귀 목적지를 그대로 싣는다', async () => {
    notion('not_connected')
    const user = userEvent.setup()
    renderApp(FROM_MODAL)
    expect(await screen.findByRole('heading', { name: 'Notion 연결' })).toHaveFocus()
    const area = await section()
    await user.click(await area.findByRole('button', { name: 'Notion 연결하기' }))
    expect(startedState()).toBe(FROM_MODAL)
  })

  it('성공 콜백 뒤 연동 상태를 다시 조회해 connected 면 업로드로 replace 복귀한다', async () => {
    settleMockOAuth({ workspaceId: 'ws_01', provider: 'notion', outcome: 'success' })
    const log = recordRequests()
    const app = renderApp(returnFrom(FROM_MODAL, 'success'))

    expect(await screen.findByRole('heading', { name: '회의를 올려 주세요' })).toBeInTheDocument()
    await app.expectPath(UPLOAD_PATH)
    // 방금 받은 연동 캐시가 있어도 업로드 진입 판정을 끝내 폼이 열린다
    expect(await screen.findByRole('button', { name: '정리 시작하기' })).toBeInTheDocument()
    // 복귀 표시만 믿지 않았다 — 업로드로 가기 전에 연동 상태를 새로 받았다
    const started = log.timeline.filter((line) => line.startsWith('start'))
    expect(started).toContain('start GET /workspaces/ws_01/integrations')
    expect(started.indexOf('start GET /workspaces/ws_01/integrations')).toBeLessThan(
      started.indexOf('start GET /workspaces/ws_01/meetings'),
    )
    expect(leaveApp).not.toHaveBeenCalled()
  })

  it('StrictMode 에서도 복귀 확인이 끝까지 가서 업로드로 돌아간다', async () => {
    settleMockOAuth({ workspaceId: 'ws_01', provider: 'notion', outcome: 'success' })
    const app = renderApp(returnFrom(FROM_MODAL, 'success'), { strict: true })
    await app.expectPath(UPLOAD_PATH)
    expect(await screen.findByRole('heading', { name: '회의를 올려 주세요' })).toBeInTheDocument()
  })

  it('성공이라고 돌아왔어도 다시 조회한 상태가 connected 가 아니면 설정에 머물고 안내한다', async () => {
    notion('not_connected')
    const app = renderApp(returnFrom(FROM_MODAL, 'success'))
    const area = await section()
    expect(
      await area.findByText('Notion을 연결하지 못했어요. 잠시 후 다시 시도해 주세요.'),
    ).toBeInTheDocument()
    await app.expectPath(paths.settings('ws_01'))
    // 복귀 표시는 지우고 `section`·`next` 는 남긴다 — 다시 연결해도 업로드로 돌아간다
    await app.expectSearch(`?section=notion&next=${encodeURIComponent(UPLOAD_PATH)}`)
  })

  it.each([
    ['cancelled', 'Notion 연결을 취소했어요. 연결하려면 다시 시도해 주세요.'],
    ['failed', 'Notion을 연결하지 못했어요. 잠시 후 다시 시도해 주세요.'],
  ] as const)('%s 는 설정에 머물며 안내를 보이고 재조회하지 않는다', async (outcome, message) => {
    notion('not_connected')
    const log = recordRequests()
    const app = renderApp(returnFrom(FROM_MODAL, outcome))
    const area = await section()
    expect(await area.findByText(message)).toBeInTheDocument()
    await app.expectSearch(`?section=notion&next=${encodeURIComponent(UPLOAD_PATH)}`)
    await app.expectPath(paths.settings('ws_01'))
    expect(app.visited().map(({ pathname }) => pathname)).not.toContain(UPLOAD_PATH)
    // 연결 버튼이 그대로 있다
    expect(await area.findByRole('button', { name: 'Notion 연결하기' })).toBeInTheDocument()
    expect(
      log.started.filter(({ path }) => path === '/workspaces/ws_01/integrations'),
    ).toHaveLength(1)
  })

  it.each([
    ['다른 공간의 업로드', '/workspaces/ws_02/meetings/upload'],
    ['외부 주소', 'https://evil.example/workspaces/ws_01/meetings/upload'],
    ['프로토콜 상대 주소', '//evil.example/workspaces/ws_01/meetings/upload'],
    ['같은 공간의 다른 화면', '/workspaces/ws_01/tasks'],
  ])('복귀 목적지가 %s 면 성공해도 설정에 머문다', async (_, next) => {
    settleMockOAuth({ workspaceId: 'ws_01', provider: 'notion', outcome: 'success' })
    const app = renderApp(returnFrom(paths.settingsNotion('ws_01', next), 'success'))
    const area = await section()
    expect(await area.findByText('연결됨')).toBeInTheDocument()
    await waitFor(() => expect(area.queryByText('연결을 확인하고 있어요.')).toBeNull())
    await app.expectPath(paths.settings('ws_01'))
    // 복귀 표시를 지우는 replace 만 있었다 — 다른 경로를 거치지 않았다
    expect(new Set(app.visited().map(({ pathname }) => pathname))).toEqual(
      new Set([paths.settings('ws_01')]),
    )
    expect(leaveApp).not.toHaveBeenCalled()
  })

  it('목적지가 없으면 성공해도 설정에 머문다 — 연결됨을 보인다', async () => {
    settleMockOAuth({ workspaceId: 'ws_01', provider: 'notion', outcome: 'success' })
    const app = renderApp(returnFrom(paths.settingsNotion('ws_01'), 'success'))
    const area = await section()
    expect(await area.findByText('연결됨')).toBeInTheDocument()
    await app.expectSearch('?section=notion')
  })

  it('이미 연결된 채 모달에서 왔으면 업로드로 돌아가는 링크를 준다', async () => {
    const user = userEvent.setup()
    const app = renderApp(FROM_MODAL)
    const area = await section()
    await user.click(await area.findByRole('link', { name: '회의 올리기로 돌아가기' }))
    await app.expectPath(UPLOAD_PATH)
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

  /** 확인을 기다리는 설정 화면을 StrictMode 로 연다 */
  async function openVerifying() {
    settleMockOAuth({ workspaceId: 'ws_01', provider: 'notion', outcome: 'success' })
    const gate = holdVerification()
    const user = userEvent.setup()
    const app = renderApp(returnFrom(FROM_MODAL, 'success'), { strict: true })
    const area = await section()
    expect(await area.findByText('연결을 확인하고 있어요.')).toBeInTheDocument()
    return { gate, user, app, area }
  }

  /** 붙잡았던 확인을 풀고 그 결과가 캐시에 들어갈 때까지 기다린다 — 이동을 한다면 이 직후다 */
  async function release(app: ReturnType<typeof renderApp>, gate: ReturnType<typeof deferred>) {
    gate.resolve()
    await waitFor(() =>
      expect(
        app.queryClient.getQueryData(integrationsQueryOptions('ws_01').queryKey)?.notion.status,
      ).toBe('connected'),
    )
    await act(async () => {})
  }

  it('확인을 기다리는 동안 다른 화면으로 갔으면 끝나도 업로드로 데려오지 않는다', async () => {
    const { gate, user, app } = await openVerifying()
    await user.click(screen.getByRole('link', { name: '대시보드' }))
    await app.expectPath(paths.dashboard('ws_01'))

    await release(app, gate)
    await app.expectPath(paths.dashboard('ws_01'))
    expect(app.visited().map(({ pathname }) => pathname)).not.toContain(UPLOAD_PATH)
  })

  it('확인 중에 고친 입력이 있으면 끝났을 때 이탈 확인을 묻는다 — 머무르면 입력이 남는다', async () => {
    const { gate, user, app, area } = await openVerifying()
    const name = screen.getByLabelText('워크스페이스 이름')
    await user.clear(name)
    await user.type(name, 'unsaved-review-draft')

    await release(app, gate)
    const dialog = await screen.findByRole('dialog', { name: '저장하지 않은 변경 내용이 있어요' })
    await app.expectPath(paths.settings('ws_01'))
    await user.click(within(dialog).getByRole('button', { name: '계속 작성하기' }))

    await app.expectPath(paths.settings('ws_01'))
    expect(screen.getByLabelText('워크스페이스 이름')).toHaveValue('unsaved-review-draft')
    expect(app.visited().map(({ pathname }) => pathname)).not.toContain(UPLOAD_PATH)
    // 확인은 끝났다 — 연결됨과 업로드로 돌아가는 링크가 남는다
    expect(await area.findByText('연결됨')).toBeInTheDocument()
    expect(area.getByRole('link', { name: '회의 올리기로 돌아가기' })).toBeInTheDocument()
  })

  it('확인 중에 고친 입력은 이탈 확인에서 버리기를 골라야 업로드로 간다', async () => {
    const { gate, user, app } = await openVerifying()
    await user.type(screen.getByLabelText('워크스페이스 이름'), ' 수정')

    await release(app, gate)
    const dialog = await screen.findByRole('dialog', { name: '저장하지 않은 변경 내용이 있어요' })
    await user.click(within(dialog).getByRole('button', { name: '변경 내용 버리고 나가기' }))
    await app.expectPath(UPLOAD_PATH)
  })

  it('다른 곳으로 가려다 이탈 확인을 고르는 중이면 끝나도 그 이동을 가로채지 않는다', async () => {
    const { gate, user, app } = await openVerifying()
    await user.type(screen.getByLabelText('워크스페이스 이름'), ' 수정')
    await user.click(screen.getByRole('link', { name: '대시보드' }))
    const dialog = await screen.findByRole('dialog', { name: '저장하지 않은 변경 내용이 있어요' })

    await release(app, gate)
    await app.expectPath(paths.settings('ws_01'))
    await user.click(within(dialog).getByRole('button', { name: '변경 내용 버리고 나가기' }))
    await app.expectPath(paths.dashboard('ws_01'))
    expect(app.visited().map(({ pathname }) => pathname)).not.toContain(UPLOAD_PATH)
  })
})

describe('모달 → 설정 → OAuth → 업로드 한 바퀴 (U3-1·U3-2)', () => {
  it('미연결 모달의 `Notion 연결하기` 부터 업로드 복귀까지', async () => {
    notion('not_connected')
    const user = userEvent.setup()
    const first = renderApp(UPLOAD_PATH)
    const dialog = await screen.findByRole('dialog', { name: 'Notion 연결이 필요해요' })
    await user.click(within(dialog).getByRole('button', { name: 'Notion 연결하기' }))
    await first.expectPath(paths.settings('ws_01'))
    const area = await section()
    await user.click(await area.findByRole('button', { name: 'Notion 연결하기' }))
    const state = startedState()
    expect(state).toBe(FROM_MODAL)
    first.unmount()

    // 모의 OAuth 가 연결을 허용하고 state 로 돌려보냈다
    settleMockOAuth({ workspaceId: 'ws_01', provider: 'notion', outcome: 'success' })
    const back = renderApp(returnFrom(state!, 'success'))
    await back.expectPath(UPLOAD_PATH)
    expect(await screen.findByRole('button', { name: '정리 시작하기' })).toBeInTheDocument()
  })
})
