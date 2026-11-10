import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { db } from '@/shared/mock/db'
import { fail } from '@/shared/mock/envelope'
import { applyScenario } from '@/shared/mock/scenarios'
import { server } from '@/shared/mock/server'
import { recordRequests } from '@/shared/test/requests'
import { renderApp } from './test/renderApp'

function expectNoWorkspaceWrites(log: ReturnType<typeof recordRequests>) {
  expect(
    log.started.filter(
      ({ method, path }) =>
        (method === 'POST' && path === '/workspaces') ||
        (method === 'PATCH' && /^\/workspaces\/[^/]+\/onboarding$/.test(path)),
    ),
  ).toEqual([])
}

describe('시작 작업 선택', () => {
  it('팀원 선택은 빈 소속 목록만 확인하고 다시 조회하거나 선택 화면으로 돌아간다', async () => {
    applyScenario('no-workspace')
    const log = recordRequests()
    const app = renderApp('/login')
    await screen.findByRole('heading', { name: '어떻게 시작할까요?' })
    await app.expectPath('/onboarding/start')
    await userEvent.click(screen.getByRole('link', { name: /팀원으로 시작/ }))
    await app.expectPath('/onboarding/member')
    expect(await screen.findByText('아직 소속된 워크스페이스가 없어요.')).toBeInTheDocument()
    expect(
      await screen.findByText('PM에게 내 아이디(userpm)를 알려 주고 초대를 요청하세요.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '새 워크스페이스 만들기' })).not.toBeInTheDocument()

    const before = log.started.filter(({ path }) => path === '/workspaces').length
    const invitationsBefore = log.started.filter(({ path }) => path === '/invitations/me').length
    await userEvent.click(screen.getByRole('button', { name: '목록 다시 확인' }))
    await screen.findByRole('button', { name: '목록 다시 확인', busy: false })
    expect(log.started.filter(({ path }) => path === '/workspaces').length).toBeGreaterThan(before)
    expect(log.started.filter(({ path }) => path === '/invitations/me').length).toBeGreaterThan(
      invitationsBefore,
    )
    await userEvent.click(screen.getByRole('link', { name: '시작 방식 다시 선택' }))
    await app.expectPath('/onboarding/start')
    expectNoWorkspaceWrites(log)
  })

  it('PM 선택은 기존 생성 화면에서 실제 공간을 만들고 네 단계 온보딩을 시작한다', async () => {
    applyScenario('no-workspace')
    const log = recordRequests()
    const app = renderApp('/onboarding/start')
    await userEvent.click(await screen.findByRole('link', { name: /PM으로 팀 만들기/ }))
    await app.expectPath('/onboarding/create_workspace')
    expect(await screen.findByRole('img', { name: '4단계 중 1단계' })).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('팀 이름'), '시작 선택 팀')
    await userEvent.click(screen.getByRole('button', { name: '만들기' }))
    await screen.findByRole('heading', { name: 'Discord 연결' })
    await app.expectPath('/onboarding/ws_03/connect_discord')
    expect(db.workspaces.find(({ name }) => name === '시작 선택 팀')).toMatchObject({ role: 'pm' })
    expect(
      log.started.filter(({ method, path }) => method === 'POST' && path === '/workspaces'),
    ).toHaveLength(1)
  })

  it.each([
    ['single-workspace', '카테캠 3팀', '/workspaces/ws_01/dashboard', '대시보드'],
    ['incomplete-workspace', '설정 중인 팀', '/onboarding/ws_03/connect_discord', 'Discord 연결'],
  ] as const)(
    '내 팀 목록의 %s 소속은 기존 진입 규칙을 따른다',
    async (scenario, name, path, heading) => {
      applyScenario(scenario)
      const log = recordRequests()
      const app = renderApp('/onboarding/member')
      await userEvent.click(await screen.findByRole('button', { name: new RegExp(name) }))
      expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument()
      await app.expectPath(path)
      expectNoWorkspaceWrites(log)
    },
  )

  it('직접 팀 확인에 들어가 조회가 실패해도 다시 시도로 소속 목록을 확인한다', async () => {
    applyScenario('single-workspace')
    let failing = true
    server.use(
      http.get('/api/v1/workspaces', () =>
        failing ? fail('INVALID_REQUEST', 'boom', 400) : undefined,
      ),
    )
    const log = recordRequests()
    const app = renderApp('/onboarding/member')
    await screen.findByRole('button', { name: '다시 시도' })
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    failing = false
    await userEvent.click(screen.getByRole('button', { name: '다시 시도' }))
    expect(await screen.findByRole('button', { name: /카테캠 3팀/ })).toBeInTheDocument()
    await app.expectPath('/onboarding/member')
    expectNoWorkspaceWrites(log)
  })

  it('미완료 팀의 일반 팀원은 기존 대기 화면으로 들어간다', async () => {
    const log = recordRequests()
    const app = renderApp('/onboarding/member')
    await userEvent.click(await screen.findByRole('button', { name: /사이드 프로젝트/ }))
    await screen.findByRole('heading', { name: 'PM이 워크스페이스 설정을 마무리하고 있어요' })
    await app.expectPath('/onboarding/ws_02/connect_notion')
    expectNoWorkspaceWrites(log)
  })

  it('빈 목록을 다시 확인하다 실패하면 오류를 보이고 재시도할 수 있다', async () => {
    applyScenario('no-workspace')
    const log = recordRequests()
    renderApp('/onboarding/member')
    await screen.findByText('아직 소속된 워크스페이스가 없어요.')
    let failing = true
    server.use(
      http.get('/api/v1/workspaces', () =>
        failing ? fail('INVALID_REQUEST', 'boom', 400) : undefined,
      ),
    )
    await userEvent.click(screen.getByRole('button', { name: '목록 다시 확인' }))
    const retry = await screen.findByRole('button', { name: '다시 시도' })
    failing = false
    await userEvent.click(retry)
    await screen.findByRole('button', { name: '목록 다시 확인', busy: false })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expectNoWorkspaceWrites(log)
  })

  it.each(['/onboarding/start', '/onboarding/member'])(
    '비로그인 직접 접근 %s는 로그인으로 간다',
    async (path) => {
      applyScenario('signed-out')
      const app = renderApp(path)
      await screen.findByRole('heading', { name: '로그인' })
      await app.expectPath('/login')
    },
  )

  it('팀 확인 화면에서 사용자 메뉴로 로그아웃한다', async () => {
    applyScenario('no-workspace')
    const app = renderApp('/onboarding/member')
    await userEvent.click(await screen.findByRole('button', { name: /내 계정:/ }))
    await userEvent.click(screen.getByRole('menuitem', { name: '로그아웃' }))
    await screen.findByRole('heading', { name: '로그인' })
    await app.expectPath('/login')
  })

  it('공간 선택의 빈 상태에서도 시작 방식을 다시 선택한다', async () => {
    applyScenario('no-workspace')
    const app = renderApp('/workspaces')
    expect(
      await screen.findByText('PM에게 내 아이디(userpm)를 알려 주고 초대를 요청하세요.'),
    ).toBeInTheDocument()
    await userEvent.click(await screen.findByRole('link', { name: '시작 방식 다시 선택' }))
    await app.expectPath('/onboarding/start')
  })
})
