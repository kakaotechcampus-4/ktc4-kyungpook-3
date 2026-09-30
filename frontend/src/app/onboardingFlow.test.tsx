import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { leaveApp } from '@/shared/lib/location'
import { db } from '@/shared/mock/db'
import { finishMockOAuth } from '@/shared/mock/oauth/mockOAuth'
import { applyScenario } from '@/shared/mock/scenarios'
import { recordRequestBodies } from '@/shared/test/requests'
import { renderApp } from './test/renderApp'

/* U3-11 전체 흐름. OAuth 는 현재 탭 이동이라 복귀는 새 문서다 — 화면을 내리고 복귀 주소로 새로 띄워 흉내낸다.
   모의 OAuth 화면이 하는 일(finishMockOAuth)을 그대로 불러 복귀 주소를 얻는다 */
vi.mock('@/shared/lib/location', () => ({ leaveApp: vi.fn() }))

type App = ReturnType<typeof renderApp>

/** `연결하기` → 모의 OAuth 허용 → 복귀 주소로 새로 띄운다 */
async function connectVia(app: App, provider: 'discord' | 'notion'): Promise<App> {
  vi.mocked(leaveApp).mockClear()
  await userEvent.click(await screen.findByRole('button', { name: '연결하기' }))
  const start = new URL(vi.mocked(leaveApp).mock.calls[0][0], location.origin)
  const back = finishMockOAuth(
    {
      workspaceId: 'ws_03',
      provider,
      state: start.searchParams.get('state'),
      outcome: 'success',
    },
    sessionStorage,
  )
  app.unmount()
  return renderApp(back)
}

afterEach(() => sessionStorage.clear())

// 한 테스트가 온보딩 네 단계와 OAuth 왕복 두 번을 끝까지 돈다. 단독으로 3~4초라 전체 실행 부하에서
// 기본 5초를 넘길 때가 있다 (F-r3). 기다리는 조건은 그대로 두고 이 흐름들만 한도를 늘린다
describe('온보딩 전체 흐름 (U3-11)', { timeout: 15_000 }, () => {
  it('공간 0개 사용자: 만들기 → 전 단계 연결 → 팀원 연결 → 새 공간 대시보드', async () => {
    applyScenario('no-workspace')
    const bodies = recordRequestBodies('PATCH', '/workspaces/ws_03/onboarding')
    let app = renderApp('/login')
    expect(await screen.findByRole('heading', { name: '워크스페이스 만들기' })).toBeInTheDocument()

    await userEvent.type(screen.getByLabelText('팀 이름'), '캡스톤 5조')
    await userEvent.click(screen.getByRole('button', { name: '만들기' }))
    await screen.findByRole('heading', { name: 'Discord 연결' })

    app = await connectVia(app, 'discord')
    expect(await screen.findByRole('heading', { name: 'Notion 연결' })).toBeInTheDocument()

    app = await connectVia(app, 'notion')
    await screen.findByLabelText('@seoyeon_01의 팀원 이름', {}, { timeout: 3000 })
    await userEvent.type(screen.getByLabelText('@seoyeon_01의 팀원 이름'), '최진호')
    await userEvent.type(screen.getByLabelText('@minsu의 팀원 이름'), '박민수')
    await userEvent.click(screen.getByRole('button', { name: '2명 확인 완료' }))

    expect(await screen.findByRole('heading', { name: '대시보드' })).toBeInTheDocument()
    await app.expectPath('/workspaces/ws_03/dashboard')
    expect(bodies).toEqual([
      { step: 'create_workspace', action: 'complete' },
      { step: 'connect_discord', action: 'complete' },
      { step: 'connect_notion', action: 'complete' },
      { step: 'connect_members', action: 'complete' },
    ])
    expect(db.integrations.ws_03).toMatchObject({
      discord: { status: 'connected' },
      notion: { status: 'connected' },
    })
  })

  // D-073 개정(2026-09-29, 사용자 결정): 예전에는 팀원 연결이 Discord 건너뛰기에 딸려 건너뜀이라 Notion 뒤 바로 대시보드였다.
  // 이제 Notion 뒤에는 언제나 팀원 연결이 오고, Discord 가 없으면 안내와 `건너뛰기` 를 보인다
  it('전 단계 건너뛰기 → 팀원 연결(Discord 없음 안내)도 건너뛰기 → 새 공간 대시보드', async () => {
    applyScenario('no-workspace')
    const bodies = recordRequestBodies('PATCH', '/workspaces/ws_03/onboarding')
    const app = renderApp('/onboarding/create_workspace')
    await userEvent.type(await screen.findByLabelText('팀 이름'), '건너뛰는 팀')
    await userEvent.click(screen.getByRole('button', { name: '만들기' }))

    await screen.findByRole('heading', { name: 'Discord 연결' })
    await userEvent.click(await screen.findByRole('button', { name: '건너뛰기' }))
    await screen.findByRole('heading', { name: 'Notion 연결' })
    await userEvent.click(await screen.findByRole('button', { name: '건너뛰기' }))

    await screen.findByRole('heading', { level: 1, name: '팀원 연결' })
    await app.expectPath('/onboarding/ws_03/connect_members')
    expect(
      await screen.findByText(
        '디스코드를 연결하지 않아 팀원을 불러올 수 없어요. 이전 단계에서 연결하거나 건너뛸 수 있어요.',
      ),
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '건너뛰기' }))

    expect(await screen.findByRole('heading', { name: '대시보드' })).toBeInTheDocument()
    await app.expectPath('/workspaces/ws_03/dashboard')
    expect(bodies).toEqual([
      { step: 'create_workspace', action: 'complete' },
      { step: 'connect_discord', action: 'skip' },
      { step: 'connect_notion', action: 'skip' },
      { step: 'connect_members', action: 'skip' },
    ])
  })

  it('중간에 새로고침하면 저장된 미완료 단계로 돌아온다 (U3-5)', async () => {
    applyScenario('no-workspace')
    let app = renderApp('/onboarding/create_workspace')
    await userEvent.type(await screen.findByLabelText('팀 이름'), '새로고침 팀')
    await userEvent.click(screen.getByRole('button', { name: '만들기' }))
    await screen.findByRole('heading', { name: 'Discord 연결' })

    // 새로고침: 앱을 새로 띄운다. 서버(MSW db)의 상태만 남는다
    app.unmount()
    app = renderApp('/')
    expect(await screen.findByRole('heading', { name: 'Discord 연결' })).toBeInTheDocument()
    await app.expectPath('/onboarding/ws_03/connect_discord')
  })
})
