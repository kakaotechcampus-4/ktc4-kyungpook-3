import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { rememberReturnWorkspace } from '@/shared/lib/return-workspace'
import { hasUnsavedChanges } from '@/shared/lib/unsaved-changes'
import { db } from '@/shared/mock/db'
import { fail } from '@/shared/mock/envelope'
import { MOCK_NOW } from '@/shared/mock/fixtures/constants'
import { settleMockOAuth } from '@/shared/mock/oauth/mockOAuth'
import { applyScenario } from '@/shared/mock/scenarios'
import { server } from '@/shared/mock/server'
import { recordRequestBodies, recordRequests } from '@/shared/test/requests'
import type { RecordedRequest } from '@/shared/test/requests'
import { renderApp } from './test/renderApp'

/* U3-7·U3-8·U3-9·U3-10. ws_03 을 팀원 연결 단계로 둔다. 팀원은 생성자 PM(mb_90 최진호) 하나다.
   모의 Discord 서버: 1123 seoyeon_01 · 1124 minsu · 1125 jihun_dev · 1199 manager_bot(봇) */

function atMembers() {
  applyScenario('incomplete-workspace')
  const ws03 = db.workspaces.find(({ workspace_id }) => workspace_id === 'ws_03')!
  ws03.onboarding.steps[1].status = 'completed'
  ws03.onboarding.steps[2].status = 'completed'
  ws03.onboarding.current_step = 'connect_members'
  settleMockOAuth({ workspaceId: 'ws_03', provider: 'discord', outcome: 'success' })
  settleMockOAuth({ workspaceId: 'ws_03', provider: 'notion', outcome: 'success' })
}

const memberWrites = (requests: RecordedRequest[]) =>
  requests
    .filter(
      ({ method, path }) =>
        (method === 'POST' || method === 'PATCH') && path.startsWith('/members'),
    )
    .map(({ method, path }) => `${method} ${path}`)

const onboardingPatches = (requests: RecordedRequest[]) =>
  requests.filter(
    ({ method, path }) => method === 'PATCH' && path === '/workspaces/ws_03/onboarding',
  )

const nameInput = (username: string) => screen.getByLabelText(`@${username}의 팀원 이름`)

async function openMembers() {
  const app = renderApp('/onboarding/ws_03/connect_members')
  await screen.findByLabelText('@seoyeon_01의 팀원 이름')
  return app
}

beforeEach(() => atMembers())
afterEach(() => sessionStorage.clear())

describe('팀원 연결 목록 (U3-8)', () => {
  it('Discord 사용자와 팀원을 함께 조회한다 — 서로 기다리지 않는다', async () => {
    const log = recordRequests()
    await openMembers()
    const discord = log.timeline.indexOf('start GET /workspaces/ws_03/discord/members')
    const members = log.timeline.indexOf('start GET /members?workspace_id=ws_03')
    expect(discord).toBeGreaterThanOrEqual(0)
    expect(members).toBeGreaterThanOrEqual(0)
    // 둘 다 시작한 뒤에야 첫 응답이 온다
    const firstAnswer = Math.min(
      log.timeline.indexOf('answer GET /workspaces/ws_03/discord/members'),
      log.timeline.indexOf('answer GET /members?workspace_id=ws_03'),
    )
    expect(Math.max(discord, members)).toBeLessThan(firstAnswer)
  })

  it('봇은 빼고, 기존 매핑은 이름을 채워 보여 준다', async () => {
    db.members.push({
      member_id: 'mb_91',
      workspace_id: 'ws_03',
      display_name: '이지훈',
      discord_user_id: '1125',
      notion_name: null,
      role: 'member',
      created_at: MOCK_NOW,
    })
    await openMembers()
    expect(screen.queryByText('@manager_bot')).not.toBeInTheDocument()
    expect(screen.getAllByRole('textbox')).toHaveLength(3)
    expect(nameInput('jihun_dev')).toHaveValue('이지훈')
    expect(nameInput('seoyeon_01')).toHaveValue('')
    expect(screen.getByText(/디스코드에서 팀원 3명을 찾았어요/)).toBeInTheDocument()
    expect(screen.getByText(/2명은 누구인지 모르겠어요/)).toBeInTheDocument()
    expect(screen.getByText('노션 연동 완료')).toBeInTheDocument()
  })

  it('같은 이름을 두 줄에 쓰면 저장 요청 없이 막는다 (1:1)', async () => {
    const log = recordRequests()
    await openMembers()
    await userEvent.type(nameInput('seoyeon_01'), '김서연')
    await userEvent.type(nameInput('minsu'), '김서연')
    await userEvent.click(screen.getByRole('button', { name: '2명 확인 완료' }))

    await waitFor(() =>
      expect(nameInput('seoyeon_01')).toHaveAccessibleDescription(
        '같은 팀원 이름을 두 줄에 쓸 수 없어요.',
      ),
    )
    expect(nameInput('minsu')).toHaveAttribute('aria-invalid', 'true')
    expect(memberWrites(log.started)).toEqual([])
    expect(onboardingPatches(log.started)).toHaveLength(0)
  })

  it('빈 줄은 빼고 일부만 저장한 채 완료한다 (D-029)', async () => {
    const bodies = recordRequestBodies('POST', '/members')
    const log = recordRequests()
    const app = await openMembers()
    await userEvent.type(nameInput('minsu'), '박민수')
    await userEvent.click(screen.getByRole('button', { name: '1명 확인 완료' }))

    expect(await screen.findByRole('heading', { name: '대시보드' })).toBeInTheDocument()
    await app.expectPath('/workspaces/ws_03/dashboard')
    await waitFor(() =>
      expect(bodies).toEqual([
        { workspace_id: 'ws_03', display_name: '박민수', discord_user_id: '1124' },
      ]),
    )
    expect(memberWrites(log.started)).toEqual(['POST /members'])
  })

  it('아무것도 적지 않으면 확인 완료는 비활성이고 `나중에 하기` 로 건너뛴다', async () => {
    const bodies = recordRequestBodies('PATCH', '/workspaces/ws_03/onboarding')
    const app = await openMembers()
    expect(screen.getByRole('button', { name: '0명 확인 완료' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: '나중에 하기' }))
    expect(await screen.findByRole('heading', { name: '대시보드' })).toBeInTheDocument()
    await app.expectPath('/workspaces/ws_03/dashboard')
    await waitFor(() => expect(bodies).toEqual([{ step: 'connect_members', action: 'skip' }]))
  })
})

describe('팀원 저장 규칙 (U3-9)', () => {
  it('생성자 PM 은 같은 이름이면 새로 만들지 않고 연결한다. 나머지는 POST, 순서대로 저장한 뒤에만 완료 요청', async () => {
    const log = recordRequests()
    await openMembers()
    await userEvent.type(nameInput('seoyeon_01'), '최진호')
    await userEvent.type(nameInput('minsu'), '박민수')
    await userEvent.click(screen.getByRole('button', { name: '2명 확인 완료' }))
    await screen.findByRole('heading', { name: '대시보드' })

    expect(memberWrites(log.started)).toEqual(['PATCH /members/mb_90', 'POST /members'])
    const writes = log.timeline.filter((line) => /(POST|PATCH) \/(members|workspaces)/.test(line))
    expect(writes).toEqual([
      'start PATCH /members/mb_90',
      'answer PATCH /members/mb_90',
      'start POST /members',
      'answer POST /members',
      'start PATCH /workspaces/ws_03/onboarding',
      'answer PATCH /workspaces/ws_03/onboarding',
    ])
    const members = db.members.filter(({ workspace_id }) => workspace_id === 'ws_03')
    expect(
      members.map(({ display_name, discord_user_id }) => [display_name, discord_user_id]),
    ).toEqual([
      ['최진호', '1123'],
      ['박민수', '1124'],
    ])
  })

  it('기존 매핑은 이름이 바뀐 줄만 PATCH 한다', async () => {
    db.members.push({
      member_id: 'mb_91',
      workspace_id: 'ws_03',
      display_name: '이지훈',
      discord_user_id: '1125',
      notion_name: null,
      role: 'member',
      created_at: MOCK_NOW,
    })
    const bodies = recordRequestBodies('PATCH', '/members/mb_91')
    const log = recordRequests()
    await openMembers()
    await userEvent.clear(nameInput('jihun_dev'))
    await userEvent.type(nameInput('jihun_dev'), '정지훈')
    await userEvent.click(screen.getByRole('button', { name: '1명 확인 완료' }))
    await screen.findByRole('heading', { name: '대시보드' })

    expect(memberWrites(log.started)).toEqual(['PATCH /members/mb_91'])
    await waitFor(() => expect(bodies).toEqual([{ display_name: '정지훈' }]))
  })

  it('일부가 실패하면 실패한 줄과 남은 입력을 유지하고, 재시도는 성공한 줄을 다시 보내지 않는다', async () => {
    server.use(http.post('/api/v1/members', () => fail('INTERNAL_ERROR', 'x', 500), { once: true }))
    const log = recordRequests()
    const app = await openMembers()
    await userEvent.type(nameInput('seoyeon_01'), '최진호')
    await userEvent.type(nameInput('minsu'), '박민수')
    await userEvent.type(nameInput('jihun_dev'), '정지훈')
    await userEvent.click(screen.getByRole('button', { name: '3명 확인 완료' }))

    await waitFor(() => expect(nameInput('minsu')).toHaveAttribute('aria-invalid', 'true'))
    expect(nameInput('minsu')).toHaveAccessibleDescription(
      '서버에 문제가 생겼어요. 잠시 후 다시 시도해 주세요.',
    )
    expect(
      screen.getByText('일부 팀원을 저장하지 못했어요. 남은 줄만 다시 저장해요.'),
    ).toBeInTheDocument()
    // 입력은 그대로다. 완료 요청은 나가지 않았다
    expect(nameInput('minsu')).toHaveValue('박민수')
    expect(nameInput('jihun_dev')).toHaveValue('정지훈')
    expect(onboardingPatches(log.started)).toHaveLength(0)
    await app.expectPath('/onboarding/ws_03/connect_members')

    await userEvent.click(screen.getByRole('button', { name: '3명 확인 완료' }))
    await screen.findByRole('heading', { name: '대시보드' })
    expect(memberWrites(log.started)).toEqual([
      'PATCH /members/mb_90',
      'POST /members',
      // 재시도: mb_90 연결은 이미 저장돼 다시 보내지 않는다
      'POST /members',
      'POST /members',
    ])
    expect(onboardingPatches(log.started)).toHaveLength(1)
    const names = db.members
      .filter(({ workspace_id }) => workspace_id === 'ws_03')
      .map(({ display_name }) => display_name)
    expect(names).toEqual(['최진호', '박민수', '정지훈'])
  })

  it('매핑은 모두 저장됐는데 완료 요청이 실패하면 재시도는 완료 요청만 보낸다', async () => {
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
    await openMembers()
    await userEvent.type(nameInput('minsu'), '박민수')
    await userEvent.click(screen.getByRole('button', { name: '1명 확인 완료' }))
    expect(
      await screen.findByText('서버에 문제가 생겼어요. 잠시 후 다시 시도해 주세요.'),
    ).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '1명 확인 완료' }))
    await screen.findByRole('heading', { name: '대시보드' })
    expect(memberWrites(log.started)).toEqual(['POST /members'])
    expect(onboardingPatches(log.started)).toHaveLength(2)
  })
})

describe('매핑 옮기기와 나중에 하기 (U3-r1 #5·#6)', () => {
  it('한 줄의 매핑을 지우고 그 이름을 다른 줄에 적으면 같은 이름의 팀원을 새로 만들지 않고 옮긴다', async () => {
    db.members.push({
      member_id: 'mb_91',
      workspace_id: 'ws_03',
      display_name: '이지훈',
      discord_user_id: '1125',
      notion_name: null,
      role: 'member',
      created_at: MOCK_NOW,
    })
    const bodies = recordRequestBodies('PATCH', '/members/mb_91')
    const log = recordRequests()
    await openMembers()
    await userEvent.clear(nameInput('jihun_dev'))
    await userEvent.type(nameInput('minsu'), '이지훈')
    await userEvent.click(screen.getByRole('button', { name: '1명 확인 완료' }))
    await screen.findByRole('heading', { name: '대시보드' })

    expect(memberWrites(log.started)).toEqual(['PATCH /members/mb_91'])
    await waitFor(() => expect(bodies).toEqual([{ discord_user_id: '1124' }]))
    const named = db.members.filter(
      ({ workspace_id, display_name }) => workspace_id === 'ws_03' && display_name === '이지훈',
    )
    expect(named).toHaveLength(1)
    expect(named[0].discord_user_id).toBe('1124')
  })

  it('이미 연결된 줄로 매핑을 옮기면 그 줄의 연결을 풀고 옮겨 온 팀원을 잇는다 — 같은 이름이 둘 생기지 않는다', async () => {
    db.members.push(
      {
        member_id: 'mb_91',
        workspace_id: 'ws_03',
        display_name: '김서연',
        discord_user_id: '1123',
        notion_name: null,
        role: 'member',
        created_at: MOCK_NOW,
      },
      {
        member_id: 'mb_92',
        workspace_id: 'ws_03',
        display_name: '박민수',
        discord_user_id: '1124',
        notion_name: null,
        role: 'member',
        created_at: MOCK_NOW,
      },
    )
    const unlinkBodies = recordRequestBodies('PATCH', '/members/mb_92')
    const linkBodies = recordRequestBodies('PATCH', '/members/mb_91')
    const log = recordRequests()
    await openMembers()
    expect(nameInput('minsu')).toHaveValue('박민수')
    await userEvent.clear(nameInput('seoyeon_01'))
    await userEvent.clear(nameInput('minsu'))
    await userEvent.type(nameInput('minsu'), '김서연')
    await userEvent.click(screen.getByRole('button', { name: '1명 확인 완료' }))
    await screen.findByRole('heading', { name: '대시보드' })

    // 연결을 먼저 풀어야 1:1 제약(409 DISCORD_USER_ALREADY_MAPPED)에 걸리지 않는다
    expect(memberWrites(log.started)).toEqual(['PATCH /members/mb_92', 'PATCH /members/mb_91'])
    await waitFor(() => expect(unlinkBodies).toEqual([{ discord_user_id: null }]))
    await waitFor(() => expect(linkBodies).toEqual([{ discord_user_id: '1124' }]))
    const ws03 = db.members.filter(({ workspace_id }) => workspace_id === 'ws_03')
    expect(ws03.filter(({ display_name }) => display_name === '김서연')).toEqual([
      expect.objectContaining({ member_id: 'mb_91', discord_user_id: '1124' }),
    ])
    expect(ws03.find(({ member_id }) => member_id === 'mb_92')).toMatchObject({
      display_name: '박민수',
      discord_user_id: null,
    })
  })

  it('`나중에 하기` 가 실패하면 입력과 이탈 확인이 남는다 — 성공한 뒤에만 푼다', async () => {
    server.use(
      http.patch(
        '/api/v1/workspaces/:workspaceId/onboarding',
        () => fail('INTERNAL_ERROR', 'x', 500),
        {
          once: true,
        },
      ),
    )
    const app = await openMembers()
    await userEvent.type(nameInput('minsu'), '박민수')
    await waitFor(() => expect(hasUnsavedChanges()).toBe(true))
    await userEvent.click(screen.getByRole('button', { name: '나중에 하기' }))

    expect(
      await screen.findByText('서버에 문제가 생겼어요. 잠시 후 다시 시도해 주세요.'),
    ).toBeInTheDocument()
    expect(hasUnsavedChanges()).toBe(true)
    expect(nameInput('minsu')).toHaveValue('박민수')
    await app.expectPath('/onboarding/ws_03/connect_members')

    await userEvent.click(screen.getByRole('button', { name: '나중에 하기' }))
    expect(await screen.findByRole('heading', { name: '대시보드' })).toBeInTheDocument()
    await waitFor(() => expect(hasUnsavedChanges()).toBe(false))
  })
})

describe('미저장 변경 확인 (U3-10)', () => {
  it('입력하면 등록되고(브라우저 이탈 경고 포함) 링크 이동은 공통 확인을 거친다', async () => {
    const app = await openMembers()
    expect(hasUnsavedChanges()).toBe(false)
    await userEvent.type(nameInput('minsu'), '박민수')
    await waitFor(() => expect(hasUnsavedChanges()).toBe(true))

    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)

    app.navigate('/workspaces')
    expect(
      await screen.findByRole('dialog', { name: '저장하지 않은 변경 내용이 있어요' }),
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '계속 작성하기' }))
    await app.expectPath('/onboarding/ws_03/connect_members')
    expect(nameInput('minsu')).toHaveValue('박민수')
  })
})

describe('팀원 연결에서 나가기 (U3-7)', () => {
  it('입력 중 매핑을 저장한 뒤 시작한 공간의 대시보드로 간다 — 단계는 완료하지 않는다', async () => {
    // ws_01 에서 새 공간 만들기를 시작한 사용자다
    db.accounts[0].workspaceIds.unshift('ws_01')
    rememberReturnWorkspace('ws_01')
    const log = recordRequests()
    const app = await openMembers()
    await userEvent.type(nameInput('minsu'), '박민수')
    await userEvent.click(screen.getByRole('link', { name: '온보딩 나가기' }))

    expect(await screen.findByRole('heading', { name: '대시보드' })).toBeInTheDocument()
    await app.expectPath('/workspaces/ws_01/dashboard')
    expect(memberWrites(log.started)).toEqual(['POST /members'])
    expect(onboardingPatches(log.started)).toHaveLength(0)
    // 저장했으니 이탈 확인은 뜨지 않았다
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('저장이 실패하면 화면에 남는다', async () => {
    rememberReturnWorkspace('ws_01')
    server.use(http.post('/api/v1/members', () => fail('INTERNAL_ERROR', 'x', 500)))
    const app = await openMembers()
    await userEvent.type(nameInput('minsu'), '박민수')
    await userEvent.click(screen.getByRole('link', { name: '온보딩 나가기' }))

    await waitFor(() => expect(nameInput('minsu')).toHaveAttribute('aria-invalid', 'true'))
    await app.expectPath('/onboarding/ws_03/connect_members')
    expect(nameInput('minsu')).toHaveValue('박민수')
  })

  it('입력이 없으면 저장 없이 나간다', async () => {
    const log = recordRequests()
    const app = await openMembers()
    await userEvent.click(screen.getByRole('link', { name: '온보딩 나가기' }))
    expect(await screen.findByRole('heading', { name: '워크스페이스 선택' })).toBeInTheDocument()
    await app.expectPath('/workspaces')
    expect(memberWrites(log.started)).toEqual([])
  })
})
