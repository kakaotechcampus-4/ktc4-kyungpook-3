import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { leaveApp } from '@/shared/lib/location'
import { db } from '@/shared/mock/db'
import { fail } from '@/shared/mock/envelope'
import { settleMockOAuth } from '@/shared/mock/oauth/mockOAuth'
import { applyScenario } from '@/shared/mock/scenarios'
import { server } from '@/shared/mock/server'
import { recordRequestBodies, recordRequests } from '@/shared/test/requests'
import type { RecordedRequest, RequestLog } from '@/shared/test/requests'
import { renderApp } from './test/renderApp'

/* U3-3·U3-4·U3-5. 현재 탭 이동은 jsdom 이 못 하므로 leaveApp 만 바꿔 끼워 주소를 본다 */
vi.mock('@/shared/lib/location', () => ({ leaveApp: vi.fn() }))

const ONBOARDING_PATCH = '/workspaces/ws_03/onboarding'

const patches = (requests: RecordedRequest[]) =>
  requests.filter(({ method, path }) => method === 'PATCH' && path === ONBOARDING_PATCH)

/** 실패한 건너뛰기 뒤의 서버 상태 확인(상세 GET)이 응답을 받을 때까지 기다린다 */
async function afterSkipCheck(log: RequestLog) {
  await waitFor(() => {
    const failedAt = log.timeline.lastIndexOf(`start PATCH ${ONBOARDING_PATCH}`)
    expect(failedAt).toBeGreaterThanOrEqual(0)
    expect(log.timeline.slice(failedAt)).toContain('answer GET /workspaces/ws_03')
  })
}

function ws03() {
  return db.workspaces.find(({ workspace_id }) => workspace_id === 'ws_03')!
}

/** ws_03 을 Notion 단계로 옮겨 둔다. Discord 는 연결 또는 건너뜀 */
function atNotion(discord: 'completed' | 'skipped') {
  ws03().onboarding.steps[1].status = discord
  ws03().onboarding.current_step = 'connect_notion'
  if (discord === 'completed')
    settleMockOAuth({ workspaceId: 'ws_03', provider: 'discord', outcome: 'success' })
}

beforeEach(() => {
  applyScenario('incomplete-workspace')
  vi.mocked(leaveApp).mockClear()
})

describe('Discord·Notion 연결 (U3-3)', () => {
  it('`연결하기` 는 현재 탭을 OAuth 시작 주소로 옮기고 state 에 이 단계를 싣는다', async () => {
    renderApp('/onboarding/ws_03/connect_discord')
    await userEvent.click(await screen.findByRole('button', { name: '연결하기' }))
    expect(leaveApp).toHaveBeenCalledOnce()
    const url = new URL(vi.mocked(leaveApp).mock.calls[0][0], location.origin)
    expect(url.pathname).toBe('/api/v1/workspaces/ws_03/integrations/discord/start')
    expect(url.searchParams.get('state')).toBe('/onboarding/ws_03/connect_discord')
  })

  it('복귀 뒤 연동 상태를 다시 조회해 connected 일 때만 단계를 완료한다', async () => {
    settleMockOAuth({ workspaceId: 'ws_03', provider: 'discord', outcome: 'success' })
    const log = recordRequests()
    const bodies = recordRequestBodies('PATCH', ONBOARDING_PATCH)
    const app = renderApp('/onboarding/ws_03/connect_discord?oauth=discord&oauth_result=success')

    expect(await screen.findByRole('heading', { name: 'Notion 연결' })).toBeInTheDocument()
    await app.expectPath('/onboarding/ws_03/connect_notion')
    expect(bodies).toEqual([{ step: 'connect_discord', action: 'complete' }])
    // 완료 요청 전에 연동 상태를 새로 받았다
    const started = log.timeline.filter((line) => line.startsWith('start'))
    expect(started.indexOf('start GET /workspaces/ws_03/integrations')).toBeLessThan(
      started.indexOf(`start PATCH ${ONBOARDING_PATCH}`),
    )
    // 이전 단계 연결을 알린다. 생성 문자열 display_name 은 쓰지 않는다
    expect(await screen.findByText('디스코드 연동 완료')).toBeInTheDocument()
    expect(screen.queryByText(/Discord 연결됨/)).not.toBeInTheDocument()
  })

  // 브라우저는 StrictMode 다. 재마운트로 구독이 잠깐 끊겨도 복귀 확인이 취소돼 실패로 끝나면 안 된다
  it('StrictMode 에서도 복귀 확인이 끝까지 가서 단계를 완료한다', async () => {
    settleMockOAuth({ workspaceId: 'ws_03', provider: 'discord', outcome: 'success' })
    const bodies = recordRequestBodies('PATCH', ONBOARDING_PATCH)
    const app = renderApp('/onboarding/ws_03/connect_discord?oauth=discord&oauth_result=success', {
      strict: true,
    })
    expect(await screen.findByRole('heading', { name: 'Notion 연결' })).toBeInTheDocument()
    await app.expectPath('/onboarding/ws_03/connect_notion')
    expect(screen.queryByText('연결하지 못했어요. 다시 시도하거나 건너뛸 수 있어요.')).toBeNull()
    // 효과가 두 번 돌아도 완료 요청은 한 번이다
    await waitFor(() => expect(bodies).toEqual([{ step: 'connect_discord', action: 'complete' }]))
  })

  it.each([false, true])(
    '복귀 확인 중 연동 상태 조회는 한 번이다 (strict=%s, U3-r1 #3)',
    async (strict) => {
      settleMockOAuth({ workspaceId: 'ws_03', provider: 'discord', outcome: 'success' })
      const log = recordRequests()
      renderApp('/onboarding/ws_03/connect_discord?oauth=discord&oauth_result=success', { strict })
      await screen.findByRole('heading', { name: 'Notion 연결' })
      const integrationGets = log.started.filter(
        ({ method, path }) => method === 'GET' && path === '/workspaces/ws_03/integrations',
      )
      // 복귀 확인 한 번. Notion 단계는 그 결과(캐시)를 그대로 쓴다
      expect(integrationGets).toHaveLength(1)
    },
  )

  it('복귀 표시가 success 여도 실제로 연결되지 않았으면 완료하지 않는다', async () => {
    const log = recordRequests()
    const app = renderApp('/onboarding/ws_03/connect_discord?oauth=discord&oauth_result=success')
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '연결하지 못했어요. 다시 시도하거나 건너뛸 수 있어요.',
    )
    expect(patches(log.started)).toHaveLength(0)
    await app.expectPath('/onboarding/ws_03/connect_discord')
    // 복귀 표시는 주소에서 지운다
    await app.expectSearch('')
  })

  it.each([
    ['cancelled', '연결을 취소했어요. 다시 연결하거나 건너뛸 수 있어요.'],
    ['failed', '연결하지 못했어요. 다시 시도하거나 건너뛸 수 있어요.'],
  ])('%s 복귀는 단계를 완료하지 않고 안내한다', async (outcome, message) => {
    const log = recordRequests()
    const app = renderApp(`/onboarding/ws_03/connect_discord?oauth=discord&oauth_result=${outcome}`)
    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    expect(patches(log.started)).toHaveLength(0)
    expect(ws03().onboarding.steps[1].status).toBe('pending')
    await app.expectSearch('')
    // 다시 연결하거나 건너뛸 수 있다
    expect(screen.getByRole('button', { name: '연결하기' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '건너뛰기' })).toBeEnabled()
  })

  it('연결은 됐는데 완료 저장이 실패하면 `다음` 으로 저장만 다시 한다', async () => {
    settleMockOAuth({ workspaceId: 'ws_03', provider: 'discord', outcome: 'success' })
    server.use(
      http.patch(
        '/api/v1/workspaces/:workspaceId/onboarding',
        () => fail('INTERNAL_ERROR', 'x', 500),
        {
          once: true,
        },
      ),
    )
    const log = recordRequests()
    renderApp('/onboarding/ws_03/connect_discord?oauth=discord&oauth_result=success')
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '서버에 문제가 생겼어요. 잠시 후 다시 시도해 주세요.',
    )
    expect(screen.getByText('연결됨')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '다음' }))
    expect(await screen.findByRole('heading', { name: 'Notion 연결' })).toBeInTheDocument()
    expect(patches(log.started)).toHaveLength(2)
    expect(leaveApp).not.toHaveBeenCalled()
  })

  it('Notion 은 데이터베이스 선택 없이 연결·건너뛰기만 있다', async () => {
    atNotion('completed')
    renderApp('/onboarding/ws_03/connect_notion')
    const card = await screen.findByRole('region', { name: '노션 연동' })
    expect(within(card).queryByRole('combobox')).not.toBeInTheDocument()
    expect(within(card).queryByText('이 보드로 연결')).not.toBeInTheDocument()
    await userEvent.click(await within(card).findByRole('button', { name: '연결하기' }))
    const url = new URL(vi.mocked(leaveApp).mock.calls[0][0], location.origin)
    expect(url.pathname).toBe('/api/v1/workspaces/ws_03/integrations/notion/start')
    expect(url.searchParams.get('state')).toBe('/onboarding/ws_03/connect_notion')
  })

  it('Notion 복귀 성공 → 팀원 연결 단계로 간다', async () => {
    atNotion('completed')
    settleMockOAuth({ workspaceId: 'ws_03', provider: 'notion', outcome: 'success' })
    const app = renderApp('/onboarding/ws_03/connect_notion?oauth=notion&oauth_result=success')
    expect(await screen.findByRole('heading', { level: 1, name: '팀원 연결' })).toBeInTheDocument()
    await app.expectPath('/onboarding/ws_03/connect_members')
  })
})

/* D-073 개정(2026-09-29, 사용자 결정): Discord 를 건너뛰어도 팀원 연결을 함께 건너뛰지 않는다.
   아래 테스트는 예전 연쇄(팀원 건너뜀 PATCH 가 뒤따름)를 단언했다 — 이제 PATCH 는 Discord 하나이고 팀원 단계는 pending 이다.
   "중간 실패" 는 연쇄의 두 번째 요청 대신, PATCH 는 됐는데 뒤의 상세 재조회가 실패한 경우로 옮겼다 */
describe('Discord 건너뛰기 (U3-4, D-073 개정)', () => {
  it('Discord 를 건너뛰면 Discord 만 건너뜀으로 저장한다 — 팀원 연결은 pending 이다', async () => {
    const bodies = recordRequestBodies('PATCH', ONBOARDING_PATCH)
    const app = renderApp('/onboarding/ws_03/connect_discord')
    await userEvent.click(await screen.findByRole('button', { name: '건너뛰기' }))

    expect(await screen.findByRole('heading', { name: 'Notion 연결' })).toBeInTheDocument()
    await app.expectPath('/onboarding/ws_03/connect_notion')
    await waitFor(() => expect(bodies).toEqual([{ step: 'connect_discord', action: 'skip' }]))
    expect(ws03().onboarding.steps.map(({ status }) => status)).toEqual([
      'completed',
      'skipped',
      'pending',
      'pending',
    ])
  })

  it('저장 뒤 재조회가 실패하면 저장된 상태를 다시 읽어 남은 요청만 재시도한다 — 다시 보낼 PATCH 가 없다', async () => {
    // PATCH 는 되고, 그 뒤의 상세 재조회만 한 번 실패한다
    let patched = false
    let failedOnce = false
    server.use(
      http.patch('/api/v1/workspaces/:workspaceId/onboarding', () => {
        patched = true
        return undefined
      }),
      http.get('/api/v1/workspaces/:workspaceId', () => {
        if (!patched || failedOnce) return undefined
        failedOnce = true
        // 재시도하지 않는 오류라야 한 번의 실패가 그대로 드러난다(5xx 는 조회가 한 번 더 시도한다)
        return fail('FORBIDDEN', 'x', 403)
      }),
    )
    const bodies = recordRequestBodies('PATCH', ONBOARDING_PATCH)
    const log = recordRequests()
    const app = renderApp('/onboarding/ws_03/connect_discord')
    await userEvent.click(await screen.findByRole('button', { name: '건너뛰기' }))

    // 실패는 PATCH 뒤 상세 재조회(403)다. 그 오류 문구가 그대로 보인다
    expect(await screen.findByRole('alert')).toHaveTextContent('접근 권한이 없어요.')
    // 목록은 바뀌지 않았다 — 화면이 그대로라 재시도할 수 있다
    await app.expectPath('/onboarding/ws_03/connect_discord')
    expect(ws03().onboarding.steps[1].status).toBe('skipped')

    await userEvent.click(screen.getByRole('button', { name: '건너뛰기' }))
    expect(await screen.findByRole('heading', { name: 'Notion 연결' })).toBeInTheDocument()
    // 재시도는 저장된 상태를 다시 읽고 끝난다 — PATCH 는 처음 하나뿐이다
    expect(bodies).toEqual([{ step: 'connect_discord', action: 'skip' }])
    expect(patches(log.started)).toHaveLength(1)
    expect(ws03().onboarding.steps[3].status).toBe('pending')
  })

  it('건너뛰기가 서버에는 저장된 채 실패한 화면에서는 연결하기를 막고 건너뛰기 재시도만 허용한다 (U3-r1 #4)', async () => {
    let patched = false
    let failedOnce = false
    server.use(
      http.patch('/api/v1/workspaces/:workspaceId/onboarding', () => {
        patched = true
        return undefined
      }),
      http.get('/api/v1/workspaces/:workspaceId', () => {
        if (!patched || failedOnce) return undefined
        failedOnce = true
        // 재시도하지 않는 오류라야 한 번의 실패가 그대로 드러난다(5xx 는 조회가 한 번 더 시도한다)
        return fail('FORBIDDEN', 'x', 403)
      }),
    )
    const log = recordRequests()
    renderApp('/onboarding/ws_03/connect_discord')
    await userEvent.click(await screen.findByRole('button', { name: '건너뛰기' }))
    await screen.findByRole('alert')
    await afterSkipCheck(log)
    // 서버는 이미 Discord 건너뜀이다. 여기서 연결하면 서버와 화면이 갈린다
    expect(ws03().onboarding.steps[1].status).toBe('skipped')
    await waitFor(() => expect(screen.getByRole('button', { name: '연결하기' })).toBeDisabled())
    await userEvent.click(screen.getByRole('button', { name: '연결하기' }))
    expect(leaveApp).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: '건너뛰기' }))
    expect(await screen.findByRole('heading', { name: 'Notion 연결' })).toBeInTheDocument()
  })

  // 막는 것은 서버가 이미 건너뜀일 때뿐이다 (F-r1 #6)
  it('건너뛰기 PATCH 부터 실패해 서버가 pending 이면 연결하기를 막지 않는다', async () => {
    server.use(
      http.patch('/api/v1/workspaces/:workspaceId/onboarding', () =>
        fail('INTERNAL_ERROR', 'x', 500),
      ),
    )
    const log = recordRequests()
    renderApp('/onboarding/ws_03/connect_discord')
    await userEvent.click(await screen.findByRole('button', { name: '건너뛰기' }))
    await screen.findByRole('alert')
    expect(ws03().onboarding.steps[1].status).toBe('pending')
    await afterSkipCheck(log)
    await waitFor(() => expect(screen.getByRole('button', { name: '연결하기' })).toBeEnabled())
    await userEvent.click(screen.getByRole('button', { name: '연결하기' }))
    expect(leaveApp).toHaveBeenCalledOnce()
  })

  it('Notion 건너뛰기가 실패해 서버가 pending 이면 연결하기를 막지 않는다', async () => {
    atNotion('completed')
    server.use(
      http.patch('/api/v1/workspaces/:workspaceId/onboarding', () =>
        fail('INTERNAL_ERROR', 'x', 500),
      ),
    )
    const log = recordRequests()
    renderApp('/onboarding/ws_03/connect_notion')
    await userEvent.click(await screen.findByRole('button', { name: '건너뛰기' }))
    await screen.findByRole('alert')
    expect(ws03().onboarding.steps[2].status).toBe('pending')
    await afterSkipCheck(log)
    await waitFor(() => expect(screen.getByRole('button', { name: '연결하기' })).toBeEnabled())
    await userEvent.click(screen.getByRole('button', { name: '연결하기' }))
    expect(leaveApp).toHaveBeenCalledOnce()
  })

  it('실패 뒤 서버 상태를 확인하지 못하면 건너뜀일 수 있다고 보고 연결하기를 막는다', async () => {
    let failDetail = false
    server.use(
      http.patch('/api/v1/workspaces/:workspaceId/onboarding', () => {
        failDetail = true
        return fail('INTERNAL_ERROR', 'x', 500)
      }),
      http.get('/api/v1/workspaces/:workspaceId', () =>
        failDetail ? fail('FORBIDDEN', 'x', 403) : undefined,
      ),
    )
    const log = recordRequests()
    renderApp('/onboarding/ws_03/connect_discord')
    await userEvent.click(await screen.findByRole('button', { name: '건너뛰기' }))
    await screen.findByRole('alert')
    await afterSkipCheck(log)
    // 확인 실패가 반영된 뒤에도 막혀 있다
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(screen.getByRole('button', { name: '연결하기' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: '연결하기' }))
    expect(leaveApp).not.toHaveBeenCalled()
  })

  // D-073 개정 뒤에도 이미 건너뜀으로 저장된 팀원 단계는 그대로 둔다(되돌리지 않는다) — 예전 데이터의 경우다
  it('팀원 단계가 이미 건너뜀으로 저장돼 있으면 Notion 뒤 바로 새 공간 대시보드로 간다 (D-013)', async () => {
    atNotion('skipped')
    ws03().onboarding.steps[3].status = 'skipped'
    const app = renderApp('/onboarding/ws_03/connect_notion')
    await userEvent.click(await screen.findByRole('button', { name: '건너뛰기' }))
    expect(await screen.findByRole('heading', { name: '대시보드' })).toBeInTheDocument()
    await app.expectPath('/workspaces/ws_03/dashboard')
    expect(ws03().onboarding.completed).toBe(true)
  })

  // D-073 개정(2026-09-29): 예전에는 Notion 저장이 팀원 건너뜀을 함께 채워 대시보드로 갔다. 이제 팀원 연결 단계로 간다
  it('Discord 만 건너뜀이면 Notion 저장은 Notion 하나이고 팀원 연결 단계로 간다', async () => {
    atNotion('skipped')
    const bodies = recordRequestBodies('PATCH', ONBOARDING_PATCH)
    const app = renderApp('/onboarding/ws_03/connect_notion')
    await userEvent.click(await screen.findByRole('button', { name: '건너뛰기' }))
    expect(
      await screen.findByText(
        '디스코드를 연결하지 않아 팀원을 불러올 수 없어요. 이전 단계에서 연결하거나 건너뛸 수 있어요.',
      ),
    ).toBeInTheDocument()
    await app.expectPath('/onboarding/ws_03/connect_members')
    await waitFor(() => expect(bodies).toEqual([{ step: 'connect_notion', action: 'skip' }]))
    expect(ws03().onboarding.steps[3].status).toBe('pending')
  })
})

/* 카드 버튼과 하단 `›` 는 같은 저장을 부른다. 버튼 비활성은 다음 렌더에야 걸려, 같은 틱의 두 입력은 둘 다 들어온다 */
describe('연동 단계 저장은 한 번에 하나다', () => {
  it('같은 틱에 `건너뛰기` 와 `다음 단계` 를 눌러도 PATCH 는 하나이고 오류 없이 넘어간다', async () => {
    const log = recordRequests()
    renderApp('/onboarding/ws_03/connect_discord')
    const card = await screen.findByRole('button', { name: '건너뛰기' })
    const next = screen.getByRole('button', { name: '다음 단계' })
    await waitFor(() => expect(next).toBeEnabled())

    act(() => {
      card.click()
      next.click()
    })

    expect(await screen.findByRole('heading', { name: 'Notion 연결' })).toBeInTheDocument()
    expect(patches(log.started)).toHaveLength(1)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('`다음 단계` 를 같은 틱에 두 번 눌러도 PATCH 는 하나다', async () => {
    const log = recordRequests()
    renderApp('/onboarding/ws_03/connect_discord')
    const next = await screen.findByRole('button', { name: '다음 단계' })
    await waitFor(() => expect(next).toBeEnabled())

    act(() => {
      next.click()
      next.click()
    })

    expect(await screen.findByRole('heading', { name: 'Notion 연결' })).toBeInTheDocument()
    expect(patches(log.started)).toHaveLength(1)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
