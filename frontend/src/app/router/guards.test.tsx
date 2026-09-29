import { screen, waitFor } from '@testing-library/react'
import { db } from '@/shared/mock/db'
import { businessRequests, recordRequests } from '@/shared/test/requests'
import { renderApp } from '../test/renderApp'

type RenderedApp = ReturnType<typeof renderApp>

async function landsOn(app: RenderedApp, path: string) {
  await app.expectPath(path)
}

/** 로그인한 PM(us_01)의 소속과 마지막 공간을 바꾼다 */
function signIn(workspaceIds: string[], lastWorkspaceId: string | null) {
  db.accounts[0].workspaceIds = workspaceIds
  db.session.workspace_count = workspaceIds.length
  db.session.last_workspace_id = lastWorkspaceId
}

/* app 레이어는 @/shared/types/api 를 import 하지 않는다. 목 DB 의 행 타입으로 적는다 */
type WorkspaceRecord = (typeof db.workspaces)[number]

function workspaceDto(id: string): WorkspaceRecord {
  const found = db.workspaces.find(({ workspace_id }) => workspace_id === id)
  if (!found) throw new Error(`fixture ${id} is missing`)
  return found
}

describe('RequireAuth', () => {
  it('비로그인은 보호 화면 대신 로그인으로 가고 업무 API 를 부르지 않는다', async () => {
    db.authenticated = false
    const log = recordRequests()
    const app = renderApp('/workspaces/ws_01/approvals/ap_01')
    expect(await screen.findByRole('heading', { name: '로그인' })).toBeInTheDocument()
    await app.expectPath('/login')
    expect(businessRequests(log.started)).toEqual([])
  })
})

describe('인증 화면 재접근 (RedirectIfAuthed)', () => {
  it.each([
    { label: '공간 0개', ids: [], last: null, from: '/login', to: '/onboarding/create_workspace' },
    {
      label: '공간 1개',
      ids: ['ws_01'],
      last: null,
      from: '/login',
      to: '/workspaces/ws_01/dashboard',
    },
    { label: '여러 개', ids: ['ws_01', 'ws_02'], last: null, from: '/signup', to: '/workspaces' },
    {
      label: '유효한 lastWorkspaceId',
      ids: ['ws_01', 'ws_02'],
      last: 'ws_01',
      from: '/login',
      to: '/workspaces/ws_01/dashboard',
    },
    {
      label: 'lastWorkspaceId 가 미완료 공간',
      ids: ['ws_01', 'ws_02'],
      last: 'ws_02',
      from: '/',
      to: '/onboarding/ws_02/connect_notion',
    },
    {
      label: '무효한 lastWorkspaceId + 여러 개',
      ids: ['ws_01', 'ws_02'],
      last: 'ws_99',
      from: '/login',
      to: '/workspaces',
    },
    {
      label: '무효한 lastWorkspaceId + 1개',
      ids: ['ws_01'],
      last: 'ws_99',
      from: '/login',
      to: '/workspaces/ws_01/dashboard',
    },
  ])('$label: $from → $to', async ({ ids, last, from, to }) => {
    signIn(ids, last)
    const log = recordRequests()
    const app = renderApp(from)
    await landsOn(app, to)
    expect(businessRequests(log.started)).toEqual([])
  })
})

describe('RequireTeamMember', () => {
  it('목록에 없는 공간은 접근 불가 화면이고 업무 API 를 부르지 않는다', async () => {
    const log = recordRequests()
    renderApp('/workspaces/ws_99/members')
    expect(
      await screen.findByRole('heading', { name: '이 워크스페이스에 접근할 수 없어요' }),
    ).toBeInTheDocument()
    expect(businessRequests(log.started)).toEqual([])
  })

  it('공간이 있어도 목록에 없으면 비소속이다 — 상세 조회로 소속을 확인하지 않는다', async () => {
    signIn(['ws_02'], null)
    const log = recordRequests()
    renderApp('/workspaces/ws_01/dashboard')
    expect(
      await screen.findByRole('heading', { name: '이 워크스페이스에 접근할 수 없어요' }),
    ).toBeInTheDocument()
    // GET /workspaces/ws_01 도 업무 API 로 센다. 0 이면 상세를 부르지 않은 것이다
    expect(businessRequests(log.started)).toEqual([])
  })

  it('ID 모양이 틀리면 404 이고 API 를 부르지 않는다', async () => {
    const log = recordRequests()
    renderApp('/workspaces/bad%20id/dashboard')
    expect(
      await screen.findByRole('heading', { name: '페이지를 찾을 수 없어요' }),
    ).toBeInTheDocument()
    expect(businessRequests(log.started)).toEqual([])
  })
})

describe('RequireOnboardingComplete · 온보딩', () => {
  it('미완료 공간의 서비스 화면은 서버의 현재 단계로 보낸다', async () => {
    const log = recordRequests()
    const app = renderApp('/workspaces/ws_02/dashboard')
    await landsOn(app, '/onboarding/ws_02/connect_notion')
    expect(businessRequests(log.started)).toEqual([])
  })

  it('현재 단계가 잘못되면 첫 pending 단계로 보낸다', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const ws02 = workspaceDto('ws_02')
    ws02.onboarding.current_step = 'future_step'
    ws02.onboarding.steps = [
      { step: 'create_workspace', status: 'completed' },
      { step: 'connect_discord', status: 'skipped' },
      { step: 'connect_notion', status: 'completed' },
      { step: 'connect_members', status: 'pending' },
    ]
    const app = renderApp('/workspaces/ws_02/tasks')
    await landsOn(app, '/onboarding/ws_02/connect_members')
    warn.mockRestore()
  })

  it('pending 도 없으면 생성 단계로 보낸다', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const ws02 = workspaceDto('ws_02')
    ws02.onboarding.current_step = 'future_step'
    ws02.onboarding.steps = [{ step: 'create_workspace', status: 'completed' }]
    const app = renderApp('/workspaces/ws_02/tasks')
    await landsOn(app, '/onboarding/ws_02/create_workspace')
    warn.mockRestore()
  })

  it('온보딩 경로에는 완료 가드가 없어 루프 없이 그 자리에 머문다', async () => {
    const app = renderApp('/onboarding/ws_02/connect_notion')
    expect(
      await screen.findByRole('heading', { name: 'PM이 워크스페이스 설정을 마무리하고 있어요' }),
    ).toBeInTheDocument()
    await app.expectPath('/onboarding/ws_02/connect_notion')
  })

  it('미완료 공간의 일반 팀원은 대기 안내만 보고 아무것도 고칠 수 없다', async () => {
    const log = recordRequests()
    renderApp('/workspaces/ws_02/settings')
    expect(
      await screen.findByRole('heading', { name: 'PM이 워크스페이스 설정을 마무리하고 있어요' }),
    ).toBeInTheDocument()
    expect(screen.queryAllByRole('textbox')).toEqual([])
    expect(screen.queryAllByRole('button')).toEqual([])
    expect(businessRequests(log.started)).toEqual([])
  })

  it('미완료 공간의 PM 은 그 단계 화면을 본다', async () => {
    workspaceDto('ws_02').role = 'pm'
    renderApp('/onboarding/ws_02/connect_notion')
    expect(await screen.findByRole('heading', { name: 'Notion 연결' })).toBeInTheDocument()
  })

  it('모르는 단계 URL 은 이어 갈 단계로 고친다', async () => {
    const app = renderApp('/onboarding/ws_02/bogus')
    await landsOn(app, '/onboarding/ws_02/connect_notion')
  })

  it('소속이 아닌 공간의 온보딩은 접근 불가 화면이다', async () => {
    renderApp('/onboarding/ws_99/connect_notion')
    expect(
      await screen.findByRole('heading', { name: '이 워크스페이스에 접근할 수 없어요' }),
    ).toBeInTheDocument()
  })
})

describe('RequirePM', () => {
  it('PM 은 승인 상세를 본다 — 업무 요청은 부팅 조회 응답 뒤에 한 번 시작한다', async () => {
    const title = String(db.approvals[0].payload.task_title)
    const log = recordRequests()
    renderApp('/workspaces/ws_01/approvals/ap_01')
    expect(await screen.findByText(title)).toBeInTheDocument()

    expect(businessRequests(log.started)).toEqual([{ method: 'GET', path: '/approvals/ap_01' }])
    const started = log.timeline.indexOf('start GET /approvals/ap_01')
    expect(started).toBeGreaterThan(log.timeline.indexOf('answer GET /auth/me'))
    expect(started).toBeGreaterThan(log.timeline.indexOf('answer GET /workspaces'))
  })

  it('일반 팀원은 업무 API 0회로 태스크 목록에 가고 토스트를 한 번 본다', async () => {
    workspaceDto('ws_01').role = 'member'
    const log = recordRequests()
    const app = renderApp('/workspaces/ws_01/approvals/ap_01')

    expect(await screen.findByRole('heading', { name: '태스크' })).toBeInTheDocument()
    await app.expectPath('/workspaces/ws_01/tasks')
    await waitFor(() =>
      expect(document.querySelectorAll('[data-toast-key="access-denied"]')).toHaveLength(1),
    )
    expect(document.querySelector('[data-toast-key="access-denied"]')).toHaveTextContent(
      '접근 권한이 없어요',
    )
    expect(businessRequests(log.started)).toEqual([])
  })
})

describe('경로', () => {
  it('메시지는 준비 중 화면이고 API 를 부르지 않는다', async () => {
    const log = recordRequests()
    renderApp('/workspaces/ws_01/messages/threads/1')
    expect(
      await screen.findByRole('heading', { name: '메시지는 준비 중이에요' }),
    ).toBeInTheDocument()
    expect(businessRequests(log.started)).toEqual([])
  })

  it.each([
    '/nope',
    '/onboarding',
    '/onboarding/ws_02',
    '/workspaces/ws_01',
    '/workspaces/ws_01/unknown',
    '/workspaces/ws_01/approvals',
    '/workspaces/ws_01/dashboard/extra',
  ])('알 수 없는 경로 %s 는 404 다', async (path) => {
    const log = recordRequests()
    renderApp(path)
    expect(
      await screen.findByRole('heading', { name: '페이지를 찾을 수 없어요' }),
    ).toBeInTheDocument()
    expect(businessRequests(log.started)).toEqual([])
  })
})
