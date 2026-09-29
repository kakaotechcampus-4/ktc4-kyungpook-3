import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { leaveApp } from '@/shared/lib/location'
import { db } from '@/shared/mock/db'
import { finishMockOAuth, settleMockOAuth } from '@/shared/mock/oauth/mockOAuth'
import { applyScenario } from '@/shared/mock/scenarios'
import { server } from '@/shared/mock/server'
import { deferred } from '@/shared/test/deferred'
import { recordRequestBodies, recordRequests } from '@/shared/test/requests'
import type { RecordedRequest } from '@/shared/test/requests'
import { renderApp } from './test/renderApp'

/* 카운터 양옆 화살표(`이전 단계`/`다음 단계`)와 지난 단계 둘러보기(`?review=1`).
   docs/impl-decision/2026-09-28-onboarding-layout.md (2026-09-29). ws_03 은 생성만 마치고 Discord 단계다 */
vi.mock('@/shared/lib/location', () => ({ leaveApp: vi.fn() }))

const ONBOARDING_PATCH = '/workspaces/ws_03/onboarding'

const patches = (requests: RecordedRequest[]) =>
  requests.filter(({ method, path }) => method === 'PATCH' && path === ONBOARDING_PATCH)

function ws03() {
  return db.workspaces.find(({ workspace_id }) => workspace_id === 'ws_03')!
}

/** ws_03 을 Notion 단계로 옮긴다. Discord 를 건너뛰어도 팀원 연결은 pending 이다 (D-073 개정) */
function atNotion(discord: 'completed' | 'skipped') {
  ws03().onboarding.steps[1].status = discord
  ws03().onboarding.current_step = 'connect_notion'
  if (discord === 'completed')
    settleMockOAuth({ workspaceId: 'ws_03', provider: 'discord', outcome: 'success' })
}

function atMembers() {
  atNotion('completed')
  ws03().onboarding.steps[2].status = 'completed'
  ws03().onboarding.current_step = 'connect_members'
  settleMockOAuth({ workspaceId: 'ws_03', provider: 'notion', outcome: 'success' })
}

const stepNav = () => screen.getByRole('navigation', { name: '단계 이동' })

beforeEach(() => {
  applyScenario('incomplete-workspace')
  vi.mocked(leaveApp).mockClear()
})
afterEach(() => sessionStorage.clear())

describe('둘러보기 가드', () => {
  it('이어 갈 단계보다 앞의 저장된 단계는 둘러보기로 보여 준다', async () => {
    const app = renderApp('/onboarding/ws_03/create_workspace?review=1')
    expect(await screen.findByRole('heading', { name: '워크스페이스 만들기' })).toBeInTheDocument()
    await app.expectPath('/onboarding/ws_03/create_workspace')
    await app.expectSearch('?review=1')
  })

  it.each([
    ['이어 갈 단계 자신', '/onboarding/ws_03/connect_discord?review=1'],
    ['이어 갈 단계 뒤의 pending 단계', '/onboarding/ws_03/connect_notion?review=1'],
    ['모르는 단계', '/onboarding/ws_03/connect_slack?review=1'],
  ])('%s 둘러보기는 표시 없는 이어 갈 단계로 보낸다', async (_case, url) => {
    const app = renderApp(url)
    expect(await screen.findByRole('heading', { name: 'Discord 연결' })).toBeInTheDocument()
    await app.expectPath('/onboarding/ws_03/connect_discord')
    await app.expectSearch('')
  })

  it('이어 갈 단계 뒤면 건너뜀으로 저장됐어도 둘러볼 수 없다', async () => {
    atNotion('skipped')
    // D-073 개정 전에 저장된 데이터 — 팀원 연결이 이미 건너뜀이다
    ws03().onboarding.steps[3].status = 'skipped'
    const app = renderApp('/onboarding/ws_03/connect_members?review=1')
    expect(await screen.findByRole('heading', { name: 'Notion 연결' })).toBeInTheDocument()
    await app.expectPath('/onboarding/ws_03/connect_notion')
    await app.expectSearch('')
  })

  it('앞이어도 pending 인 단계는 둘러볼 수 없다', async () => {
    ws03().onboarding.current_step = 'connect_notion'
    const app = renderApp('/onboarding/ws_03/connect_discord?review=1')
    expect(await screen.findByRole('heading', { name: 'Notion 연결' })).toBeInTheDocument()
    await app.expectPath('/onboarding/ws_03/connect_notion')
    await app.expectSearch('')
  })

  it('온보딩을 마친 공간의 둘러보기는 대시보드로 간다', async () => {
    applyScenario('multiple-workspaces')
    const app = renderApp('/onboarding/ws_01/connect_discord?review=1')
    expect(await screen.findByRole('heading', { name: '대시보드' })).toBeInTheDocument()
    await app.expectPath('/workspaces/ws_01/dashboard')
  })
})

describe('1단계 둘러보기', () => {
  it('Discord 에서 `이전 단계` → 저장된 팀 이름을 읽기만 한다. `만들기` 가 없다', async () => {
    const log = recordRequests()
    const app = renderApp('/onboarding/ws_03/connect_discord')
    await userEvent.click(await within(await findNav()).findByRole('button', { name: '이전 단계' }))

    expect(await screen.findByRole('heading', { name: '워크스페이스 만들기' })).toBeInTheDocument()
    await app.expectPath('/onboarding/ws_03/create_workspace')
    await app.expectSearch('?review=1')
    expect(screen.getByLabelText('팀 이름')).toHaveValue('설정 중인 팀')
    expect(screen.getByLabelText('팀 이름')).toHaveAttribute('readonly')
    const card = screen.getByRole('region', { name: '팀 만들기' })
    // 2026-09-29 사용자 결정으로 둘러보기 카드에도 앞으로 가는 버튼을 되살렸다 — 예전 기대는 "카드 버튼 없음" 이었다
    expect(
      within(card)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['다음'])
    expect(screen.queryByRole('button', { name: '만들기' })).not.toBeInTheDocument()
    // 1단계라 `이전 단계` 는 비활성이고(자리는 남는다) `다음 단계` 만 쓸 수 있다
    expect(within(stepNav()).getByRole('button', { name: '이전 단계' })).toBeDisabled()
    expect(within(stepNav()).getByRole('button', { name: '다음 단계' })).toBeEnabled()
    expect(patches(log.started)).toHaveLength(0)
  })

  it('둘러보기의 `다음 단계` 는 요청 없이 이어 갈 단계로 돌아간다', async () => {
    const log = recordRequests()
    const app = renderApp('/onboarding/ws_03/create_workspace?review=1')
    await userEvent.click(await within(await findNav()).findByRole('button', { name: '다음 단계' }))

    expect(await screen.findByRole('heading', { name: 'Discord 연결' })).toBeInTheDocument()
    await app.expectPath('/onboarding/ws_03/connect_discord')
    await app.expectSearch('')
    expect(patches(log.started)).toHaveLength(0)
    expect(ws03().onboarding.steps.map(({ status }) => status)).toEqual([
      'completed',
      'pending',
      'pending',
      'pending',
    ])
  })

  it('Notion 에서 두 번 `이전 단계` 면 1단계, `다음 단계` 두 번이면 Discord 둘러보기를 지나 Notion 이다', async () => {
    atNotion('completed')
    const log = recordRequests()
    const app = renderApp('/onboarding/ws_03/connect_notion')
    await screen.findByRole('heading', { name: 'Notion 연결' })
    await userEvent.click(await within(await findNav()).findByRole('button', { name: '이전 단계' }))
    await screen.findByRole('heading', { name: 'Discord 연결' })
    await app.expectSearch('?review=1')
    await userEvent.click(within(stepNav()).getByRole('button', { name: '이전 단계' }))
    await screen.findByRole('heading', { name: '워크스페이스 만들기' })

    await userEvent.click(within(stepNav()).getByRole('button', { name: '다음 단계' }))
    await screen.findByRole('heading', { name: 'Discord 연결' })
    await app.expectPath('/onboarding/ws_03/connect_discord')
    await app.expectSearch('?review=1')
    await userEvent.click(within(stepNav()).getByRole('button', { name: '다음 단계' }))
    expect(await screen.findByRole('heading', { name: 'Notion 연결' })).toBeInTheDocument()
    await app.expectPath('/onboarding/ws_03/connect_notion')
    await app.expectSearch('')
    expect(patches(log.started)).toHaveLength(0)
  })
})

describe('지금 단계의 하단 버튼', () => {
  it('1단계(만든 공간의 생성 단계 저장 전)에는 두 화살표가 비활성이다', async () => {
    ws03().onboarding.steps[0].status = 'pending'
    ws03().onboarding.current_step = 'create_workspace'
    renderApp('/onboarding/ws_03/create_workspace')
    await screen.findByLabelText('팀 이름')
    expect(within(stepNav()).getByRole('button', { name: '이전 단계' })).toBeDisabled()
    expect(within(stepNav()).getByRole('button', { name: '다음 단계' })).toBeDisabled()
    // 단계 저장은 카드 안의 `다음` 하나뿐이다
    expect(screen.getAllByRole('button', { name: '다음' })).toHaveLength(1)
  })

  // D-073 개정(2026-09-29)으로 팀원 건너뜀이 뒤따르지 않는다 — 기대를 Discord 건너뜀 하나로 바꿨다
  it('Discord 의 `다음 단계` 는 `건너뛰기` 와 같은 요청을 보내고 다음 단계로 간다', async () => {
    const bodies = recordRequestBodies('PATCH', ONBOARDING_PATCH)
    const app = renderApp('/onboarding/ws_03/connect_discord')
    await screen.findByRole('button', { name: '건너뛰기' })
    await userEvent.click(within(stepNav()).getByRole('button', { name: '다음 단계' }))

    expect(await screen.findByRole('heading', { name: 'Notion 연결' })).toBeInTheDocument()
    await app.expectPath('/onboarding/ws_03/connect_notion')
    await waitFor(() => expect(bodies).toEqual([{ step: 'connect_discord', action: 'skip' }]))
    expect(leaveApp).not.toHaveBeenCalled()
  })

  it('저장 중에는 두 화살표가 막힌다', async () => {
    const answer = deferred()
    server.use(
      http.patch('/api/v1/workspaces/:workspaceId/onboarding', async () => {
        await answer.promise
        return undefined
      }),
    )
    renderApp('/onboarding/ws_03/connect_discord')
    await screen.findByRole('button', { name: '건너뛰기' })
    await userEvent.click(within(stepNav()).getByRole('button', { name: '다음 단계' }))
    await waitFor(() =>
      expect(within(stepNav()).getByRole('button', { name: '이전 단계' })).toBeDisabled(),
    )
    expect(within(stepNav()).getByRole('button', { name: '다음 단계' })).toBeDisabled()
    answer.resolve()
    expect(await screen.findByRole('heading', { name: 'Notion 연결' })).toBeInTheDocument()
  })

  it('Notion 의 `다음 단계` 는 건너뛰기다 — 팀원 연결로 간다', async () => {
    atNotion('completed')
    const bodies = recordRequestBodies('PATCH', ONBOARDING_PATCH)
    const app = renderApp('/onboarding/ws_03/connect_notion')
    await screen.findByRole('button', { name: '건너뛰기' })
    await userEvent.click(within(stepNav()).getByRole('button', { name: '다음 단계' }))
    // 제목은 불러오는 틀 → 입력 틀로 바뀌며 다시 그려진다. 마지막 화면의 입력 칸을 기다린다
    expect(await screen.findByLabelText('@seoyeon_01의 팀원 이름')).toBeInTheDocument()
    await app.expectPath('/onboarding/ws_03/connect_members')
    await waitFor(() => expect(bodies).toEqual([{ step: 'connect_notion', action: 'skip' }]))
  })

  it('팀원 연결의 `다음 단계` 는 `나중에 하기` 와 같다', async () => {
    atMembers()
    const bodies = recordRequestBodies('PATCH', ONBOARDING_PATCH)
    const app = renderApp('/onboarding/ws_03/connect_members')
    await screen.findByLabelText('@seoyeon_01의 팀원 이름')
    await userEvent.click(within(stepNav()).getByRole('button', { name: '다음 단계' }))

    expect(await screen.findByRole('heading', { name: '대시보드' })).toBeInTheDocument()
    await app.expectPath('/workspaces/ws_03/dashboard')
    expect(bodies).toEqual([{ step: 'connect_members', action: 'skip' }])
  })

  it('팀원 연결에서 입력 중 `이전 단계` 는 이탈 확인을 거치고, `계속 작성하기` 면 입력이 남는다', async () => {
    atMembers()
    const log = recordRequests()
    const app = renderApp('/onboarding/ws_03/connect_members')
    await userEvent.type(await screen.findByLabelText('@seoyeon_01의 팀원 이름'), '김서연')
    await userEvent.click(within(stepNav()).getByRole('button', { name: '이전 단계' }))

    expect(
      await screen.findByRole('dialog', { name: '저장하지 않은 변경 내용이 있어요' }),
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '계속 작성하기' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await app.expectPath('/onboarding/ws_03/connect_members')
    expect(screen.getByLabelText('@seoyeon_01의 팀원 이름')).toHaveValue('김서연')

    // 버리고 나가면 Notion 둘러보기다. 입력은 저장하지 않는다
    await userEvent.click(within(stepNav()).getByRole('button', { name: '이전 단계' }))
    await userEvent.click(await screen.findByRole('button', { name: '변경 내용 버리고 나가기' }))
    expect(await screen.findByRole('heading', { name: 'Notion 연결' })).toBeInTheDocument()
    await app.expectPath('/onboarding/ws_03/connect_notion')
    await app.expectSearch('?review=1')
    expect(log.started.filter(({ method }) => method === 'POST' || method === 'PATCH')).toEqual([])
  })
})

describe('연동 단계 둘러보기', () => {
  // 2026-09-29 사용자 결정: 둘러보기 카드에도 `다음` 을 둔다 — 예전 기대는 "카드 버튼 없음" 이었다
  it('연결한 Discord 는 `연결됨` 과 카드 `다음` 을 보인다', async () => {
    atNotion('completed')
    renderApp('/onboarding/ws_03/connect_discord?review=1')
    const card = await screen.findByRole('region', { name: '디스코드 연동' })
    expect(await within(card).findByText('연결됨')).toBeInTheDocument()
    expect(
      within(card)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['다음'])
    expect(within(stepNav()).getByRole('button', { name: '이전 단계' })).toBeEnabled()
    expect(within(stepNav()).getByRole('button', { name: '다음 단계' })).toBeEnabled()
  })

  it('건너뛴 Discord 는 `연결하기`·`건너뛰기` 가 있고, 다시 연결하면 둘러보기로 돌아와 `연결됨` 을 보인다 — 그 뒤 팀원 연결은 Discord 사용자를 불러온다', async () => {
    atNotion('skipped')
    let app = renderApp('/onboarding/ws_03/connect_notion')
    await screen.findByRole('heading', { name: 'Notion 연결' })
    await userEvent.click(await within(await findNav()).findByRole('button', { name: '이전 단계' }))
    const card = await screen.findByRole('region', { name: '디스코드 연동' })
    await within(card).findByRole('button', { name: '연결하기' })
    // 2026-09-29 사용자 결정으로 둘러보기에도 `건너뛰기` 를 되살렸다(요청 없이 옮기기만 한다) — 예전 기대는 "없음" 이었다
    expect(within(card).getByRole('button', { name: '건너뛰기' })).toBeEnabled()

    await userEvent.click(within(card).getByRole('button', { name: '연결하기' }))
    const start = new URL(vi.mocked(leaveApp).mock.calls[0][0], location.origin)
    expect(start.searchParams.get('state')).toBe('/onboarding/ws_03/connect_discord?review=1')

    // 현재 탭 이동으로 돌아온다 — 새 문서처럼 다시 띄운다
    const back = finishMockOAuth(
      {
        workspaceId: 'ws_03',
        provider: 'discord',
        state: start.searchParams.get('state'),
        outcome: 'success',
      },
      sessionStorage,
    )
    app.unmount()
    const log = recordRequests()
    app = renderApp(back)

    const returned = await screen.findByRole('region', { name: '디스코드 연동' })
    expect(await within(returned).findByText('연결됨')).toBeInTheDocument()
    await app.expectPath('/onboarding/ws_03/connect_discord')
    // 복귀 표시만 지우고 둘러보기는 남는다
    await app.expectSearch('?review=1')
    // 연동 상태를 다시 조회했다. 이미 건너뜀으로 저장된 단계라 완료 저장은 걸러진다
    expect(log.started).toContainEqual({ method: 'GET', path: '/workspaces/ws_03/integrations' })
    expect(patches(log.started)).toHaveLength(0)
    // 연결됐으니 `연결하기`·`건너뛰기` 대신 `다음` 이다
    expect(
      within(returned)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['다음'])

    await userEvent.click(within(stepNav()).getByRole('button', { name: '다음 단계' }))
    expect(await screen.findByRole('heading', { name: 'Notion 연결' })).toBeInTheDocument()
    await app.expectPath('/onboarding/ws_03/connect_notion')
    expect(await screen.findByText('디스코드 연동 완료')).toBeInTheDocument()

    // Notion 을 `›`(건너뛰기)로 넘기면 팀원 연결은 보통 화면이다 (D-073 개정)
    await userEvent.click(within(stepNav()).getByRole('button', { name: '다음 단계' }))
    expect(await screen.findByLabelText('@seoyeon_01의 팀원 이름')).toBeInTheDocument()
    await app.expectPath('/onboarding/ws_03/connect_members')
  })

  it.each([
    [
      '1단계 카드 `다음`',
      'create_workspace',
      '팀 만들기',
      '다음',
      '/onboarding/ws_03/connect_discord?review=1',
    ],
    [
      '연결한 Discord 카드 `다음`',
      'connect_discord',
      '디스코드 연동',
      '다음',
      '/onboarding/ws_03/connect_notion',
    ],
  ])('%s 는 요청 없이 다음으로 간다', async (_case, step, cardName, button, next) => {
    atNotion('completed')
    const log = recordRequests()
    const app = renderApp(`/onboarding/ws_03/${step}?review=1`)
    const card = await screen.findByRole('region', { name: cardName })
    await userEvent.click(await within(card).findByRole('button', { name: button }))
    const url = new URL(next, location.origin)
    await app.expectPath(url.pathname)
    await app.expectSearch(url.search)
    expect(patches(log.started)).toHaveLength(0)
  })

  it('건너뛴 Discord 둘러보기의 `건너뛰기` 는 요청 없이 이어 갈 단계로 간다 — 이미 건너뜀으로 저장돼 있다', async () => {
    atNotion('skipped')
    const log = recordRequests()
    const app = renderApp('/onboarding/ws_03/connect_discord?review=1')
    const card = await screen.findByRole('region', { name: '디스코드 연동' })
    await userEvent.click(await within(card).findByRole('button', { name: '건너뛰기' }))
    expect(await screen.findByRole('region', { name: '노션 연동' })).toBeInTheDocument()
    await app.expectPath('/onboarding/ws_03/connect_notion')
    await app.expectSearch('')
    expect(patches(log.started)).toHaveLength(0)
    expect(leaveApp).not.toHaveBeenCalled()
  })

  it('둘러보기에서 연결을 취소하고 돌아오면 안내를 보이고 둘러보기에 남는다', async () => {
    atNotion('skipped')
    const app = renderApp(
      '/onboarding/ws_03/connect_discord?review=1&oauth=discord&oauth_result=cancelled',
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '연결을 취소했어요. 다시 연결하거나 건너뛸 수 있어요.',
    )
    await app.expectPath('/onboarding/ws_03/connect_discord')
    await app.expectSearch('?review=1')
    expect(await screen.findByRole('button', { name: '연결하기' })).toBeEnabled()
  })
})

describe('일반 팀원', () => {
  it('둘러보기 주소로 들어와도 대기 안내만 있고 화살표가 없다', async () => {
    applyScenario('multiple-workspaces')
    const app = renderApp('/onboarding/ws_02/connect_discord?review=1')
    expect(
      await screen.findByRole('heading', { name: 'PM이 워크스페이스 설정을 마무리하고 있어요' }),
    ).toBeInTheDocument()
    await app.expectPath('/onboarding/ws_02/connect_discord')
    expect(screen.queryByRole('navigation', { name: '단계 이동' })).not.toBeInTheDocument()
    expect(screen.queryAllByRole('button')).toEqual([])
  })
})

/** 하단 줄은 공간 목록을 받은 뒤 그려진다 */
function findNav() {
  return screen.findByRole('navigation', { name: '단계 이동' })
}
