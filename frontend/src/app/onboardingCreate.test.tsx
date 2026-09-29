import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { rememberReturnWorkspace } from '@/shared/lib/return-workspace'
import { db } from '@/shared/mock/db'
import { fail } from '@/shared/mock/envelope'
import { applyScenario } from '@/shared/mock/scenarios'
import { server } from '@/shared/mock/server'
import { recordRequests } from '@/shared/test/requests'
import type { RecordedRequest } from '@/shared/test/requests'
import { renderApp } from './test/renderApp'

/* U3-1·U3-2·U3-5·U3-6·U3-7. 제품과 같은 배선(renderApp) + MSW + 실제 request 경로 */

const count = (requests: RecordedRequest[], method: string, path: string | RegExp) =>
  requests.filter(
    (request) =>
      request.method === method &&
      (typeof path === 'string' ? request.path === path : path.test(request.path)),
  ).length

async function openCreate() {
  const app = renderApp('/onboarding/create_workspace')
  await screen.findByRole('heading', { name: '워크스페이스 만들기' })
  return app
}

afterEach(() => sessionStorage.clear())

describe('공통 온보딩 레이아웃 (U3-1)', () => {
  it('단계 표시 · 매스 말풍선 · 단계 카드 · n / 4 가 있고 하단 이전/다음은 없다', async () => {
    await openCreate()
    expect(screen.getByRole('img', { name: '4단계 중 1단계' })).toBeInTheDocument()
    expect(
      screen.getByText('먼저 팀 이름만 알려주세요. 나중에 언제든 바꿀 수 있어요.'),
    ).toBeInTheDocument()
    const card = screen.getByRole('region', { name: '팀 만들기' })
    expect(within(card).getByRole('heading', { name: '팀 만들기' })).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: '만들기' })).toBeInTheDocument()
    expect(screen.getByText('1 / 4')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '이전' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '다음' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: '온보딩 나가기' })).toBeInTheDocument()
  })

  it.each([
    ['connect_discord', '4단계 중 2단계', '디스코드 연동', ['연결하기', '건너뛰기']],
    ['connect_notion', '4단계 중 3단계', '노션 연동', ['연결하기', '건너뛰기']],
  ])('%s 도 같은 틀이다', async (step, dots, cardTitle, buttons) => {
    applyScenario('incomplete-workspace')
    const ws03 = db.workspaces.find(({ workspace_id }) => workspace_id === 'ws_03')!
    if (step === 'connect_notion') {
      ws03.onboarding.steps[1].status = 'completed'
      ws03.onboarding.current_step = 'connect_notion'
    }
    renderApp(`/onboarding/ws_03/${step}`)
    const card = await screen.findByRole('region', { name: cardTitle })
    expect(screen.getByRole('img', { name: dots })).toBeInTheDocument()
    for (const name of buttons)
      expect(await within(card).findByRole('button', { name })).toBeInTheDocument()
  })
})

describe('워크스페이스 만들기 (U3-2)', () => {
  it('이름을 정규화해 만들고 생성 단계를 저장한 뒤 Discord 단계로 간다', async () => {
    const log = recordRequests()
    const app = await openCreate()
    await userEvent.type(screen.getByLabelText('팀 이름'), '  새   팀  ')
    await userEvent.click(screen.getByRole('button', { name: '만들기' }))

    expect(await screen.findByRole('heading', { name: 'Discord 연결' })).toBeInTheDocument()
    await app.expectPath('/onboarding/ws_03/connect_discord')
    expect(db.workspaces.find(({ workspace_id }) => workspace_id === 'ws_03')?.name).toBe('새 팀')
    expect(count(log.started, 'POST', '/workspaces')).toBe(1)
    expect(count(log.started, 'PATCH', '/workspaces/ws_03/onboarding')).toBe(1)
  })

  it.each([
    ['   ', '팀 이름을 입력해 주세요.'],
    ['가'.repeat(21), '팀 이름은 20자까지 쓸 수 있어요.'],
    // 소속 공간 이름과 공백만 다르면 같은 이름이다 (D-016, D-018)
    [' 카테캠   3팀 ', '이미 있는 팀 이름이에요.'],
  ])('%j 는 요청 없이 입력 아래에서 막는다', async (value, message) => {
    const log = recordRequests()
    await openCreate()
    const input = screen.getByLabelText('팀 이름')
    await userEvent.type(input, value)
    await userEvent.click(screen.getByRole('button', { name: '만들기' }))
    await waitFor(() => expect(input).toHaveAccessibleDescription(message))
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(count(log.started, 'POST', '/workspaces')).toBe(0)
  })

  it('20자는 된다 — 이모지도 한 글자로 센다', async () => {
    await openCreate()
    await userEvent.type(screen.getByLabelText('팀 이름'), `${'가'.repeat(19)}🙂`)
    await userEvent.click(screen.getByRole('button', { name: '만들기' }))
    expect(await screen.findByRole('heading', { name: 'Discord 연결' })).toBeInTheDocument()
  })

  it('대소문자만 다르면 다른 이름이다 (D-019)', async () => {
    db.workspaces[0].name = 'Alpha'
    await openCreate()
    await userEvent.type(screen.getByLabelText('팀 이름'), 'alpha')
    await userEvent.click(screen.getByRole('button', { name: '만들기' }))
    expect(await screen.findByRole('heading', { name: 'Discord 연결' })).toBeInTheDocument()
  })

  it('서버의 중복 응답도 이름 입력 아래에 둔다', async () => {
    server.use(
      http.post('/api/v1/workspaces', () =>
        fail('WORKSPACE_NAME_DUPLICATED', '이미 존재하는 이름입니다.', 409),
      ),
    )
    await openCreate()
    const input = screen.getByLabelText('팀 이름')
    await userEvent.type(input, '다른 팀')
    await userEvent.click(screen.getByRole('button', { name: '만들기' }))
    await waitFor(() =>
      expect(input).toHaveAccessibleDescription('이미 사용 중인 워크스페이스 이름이에요.'),
    )
    expect(input).toHaveFocus()
  })

  it('생성 뒤 단계 저장이 실패해도 재시도는 워크스페이스 POST 를 다시 보내지 않는다', async () => {
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
    const app = await openCreate()
    await userEvent.type(screen.getByLabelText('팀 이름'), '새 팀')
    await userEvent.click(screen.getByRole('button', { name: '만들기' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '서버에 문제가 생겼어요. 잠시 후 다시 시도해 주세요.',
    )
    // 만든 공간의 이름은 잠긴다
    expect(screen.getByLabelText('팀 이름')).toHaveAttribute('readonly')
    await userEvent.click(screen.getByRole('button', { name: '다시 시도' }))

    expect(await screen.findByRole('heading', { name: 'Discord 연결' })).toBeInTheDocument()
    await app.expectPath('/onboarding/ws_03/connect_discord')
    expect(count(log.started, 'POST', '/workspaces')).toBe(1)
    expect(count(log.started, 'PATCH', '/workspaces/ws_03/onboarding')).toBe(2)
    expect(db.workspaces.filter(({ name }) => name === '새 팀')).toHaveLength(1)
  })

  it('생성 단계가 저장되지 않은 채 돌아오면 이름을 잠그고 단계 저장만 한다', async () => {
    applyScenario('incomplete-workspace')
    const ws03 = db.workspaces.find(({ workspace_id }) => workspace_id === 'ws_03')!
    ws03.onboarding.steps[0].status = 'pending'
    ws03.onboarding.current_step = 'create_workspace'
    const log = recordRequests()
    const app = renderApp('/workspaces/ws_03/dashboard')

    await screen.findByRole('heading', { name: '워크스페이스 만들기' })
    await app.expectPath('/onboarding/ws_03/create_workspace')
    expect(screen.getByLabelText('팀 이름')).toHaveValue('설정 중인 팀')
    await userEvent.click(screen.getByRole('button', { name: '다음' }))
    expect(await screen.findByRole('heading', { name: 'Discord 연결' })).toBeInTheDocument()
    expect(count(log.started, 'POST', '/workspaces')).toBe(0)
  })
})

describe('저장된 단계로 복귀 (U3-5)', () => {
  it('직접 URL 로 다른 단계에 들어와도 저장된 미완료 단계로 간다', async () => {
    applyScenario('incomplete-workspace')
    const app = renderApp('/onboarding/ws_03/connect_members')
    expect(await screen.findByRole('heading', { name: 'Discord 연결' })).toBeInTheDocument()
    await app.expectPath('/onboarding/ws_03/connect_discord')
  })

  it('미완료 공간의 대시보드 직접 진입은 막고 저장된 단계로 보낸다', async () => {
    applyScenario('incomplete-workspace')
    const app = renderApp('/workspaces/ws_03/dashboard')
    await screen.findByRole('heading', { name: 'Discord 연결' })
    await app.expectPath('/onboarding/ws_03/connect_discord')
  })

  it('재로그인하면 마지막 미완료 단계로 간다 (D-072)', async () => {
    applyScenario('incomplete-workspace')
    db.authenticated = false
    const app = renderApp('/login')
    await screen.findByRole('heading', { name: '로그인' })
    await userEvent.type(screen.getByLabelText('이메일'), 'pm@example.com')
    await userEvent.type(screen.getByLabelText('비밀번호'), 'mock-password')
    await userEvent.click(screen.getByRole('button', { name: '로그인' }))
    expect(await screen.findByRole('heading', { name: 'Discord 연결' })).toBeInTheDocument()
    await app.expectPath('/onboarding/ws_03/connect_discord')
  })

  it('온보딩을 마친 공간의 단계 URL 은 대시보드로 간다', async () => {
    const app = renderApp('/onboarding/ws_01/connect_notion')
    expect(await screen.findByRole('heading', { name: '대시보드' })).toBeInTheDocument()
    await app.expectPath('/workspaces/ws_01/dashboard')
  })
})

describe('일반 팀원 (U3-6)', () => {
  it.each(['connect_notion', 'connect_members', 'connect_discord'])(
    '%s 로 들어와도 대기 안내만 보고 온보딩 PATCH 는 0회다',
    async (step) => {
      const log = recordRequests()
      const app = renderApp(`/onboarding/ws_02/${step}`)
      expect(
        await screen.findByRole('heading', { name: 'PM이 워크스페이스 설정을 마무리하고 있어요' }),
      ).toBeInTheDocument()
      await app.expectPath('/onboarding/ws_02/connect_notion')
      expect(screen.queryAllByRole('button')).toEqual([])
      expect(screen.queryAllByRole('textbox')).toEqual([])
      expect(count(log.started, 'PATCH', /onboarding$/)).toBe(0)
    },
  )
})

describe('나가기 (U3-7)', () => {
  it('기존 공간에서 새 공간을 만들다 나가면 그 공간의 대시보드로 간다', async () => {
    rememberReturnWorkspace('ws_01')
    const app = await openCreate()
    await userEvent.click(screen.getByRole('link', { name: '온보딩 나가기' }))
    expect(await screen.findByRole('heading', { name: '대시보드' })).toBeInTheDocument()
    await app.expectPath('/workspaces/ws_01/dashboard')
  })

  it('최초 가입자는 워크스페이스 선택 화면으로 간다', async () => {
    applyScenario('no-workspace')
    const app = await openCreate()
    await userEvent.click(screen.getByRole('link', { name: '온보딩 나가기' }))
    expect(await screen.findByRole('heading', { name: '워크스페이스 선택' })).toBeInTheDocument()
    await app.expectPath('/workspaces')
  })

  it('만든 공간의 온보딩을 이어 가다 나가도 시작한 공간으로 돌아간다 — 진행은 서버에 남아 있다', async () => {
    rememberReturnWorkspace('ws_01')
    const app = await openCreate()
    await userEvent.type(screen.getByLabelText('팀 이름'), '새 팀')
    await userEvent.click(screen.getByRole('button', { name: '만들기' }))
    await screen.findByRole('heading', { name: 'Discord 연결' })

    await userEvent.click(screen.getByRole('link', { name: '온보딩 나가기' }))
    expect(await screen.findByRole('heading', { name: '대시보드' })).toBeInTheDocument()
    await app.expectPath('/workspaces/ws_01/dashboard')
    expect(
      db.workspaces.find(({ workspace_id }) => workspace_id === 'ws_03')?.onboarding,
    ).toMatchObject({ current_step: 'connect_discord' })
  })

  it('이름을 적다 나가면 공통 이탈 확인을 거친다', async () => {
    rememberReturnWorkspace('ws_01')
    const app = await openCreate()
    await userEvent.type(screen.getByLabelText('팀 이름'), '적는 중')
    await userEvent.click(screen.getByRole('link', { name: '온보딩 나가기' }))
    expect(
      await screen.findByRole('dialog', { name: '저장하지 않은 변경 내용이 있어요' }),
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '계속 작성하기' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await app.expectPath('/onboarding/create_workspace')
    // 적던 이름 그대로이고, 대시보드에 들렀다 온 것도 아니다
    expect(screen.getByRole('heading', { name: '워크스페이스 만들기' })).toBeInTheDocument()
    expect(screen.getByLabelText('팀 이름')).toHaveValue('적는 중')
    expect(screen.queryByRole('heading', { name: '대시보드' })).not.toBeInTheDocument()
    expect(app.visited().map(({ pathname }) => pathname)).toEqual(['/onboarding/create_workspace'])
  })
})
