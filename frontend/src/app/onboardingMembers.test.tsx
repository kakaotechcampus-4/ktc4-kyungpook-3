import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { rememberReturnWorkspace } from '@/shared/lib/return-workspace'
import { hasUnsavedChanges } from '@/shared/lib/unsaved-changes'
import { db } from '@/shared/mock/db'
import { fail } from '@/shared/mock/envelope'
import { MOCK_NOW } from '@/shared/mock/fixtures/constants'
import { settleMockOAuth } from '@/shared/mock/oauth/mockOAuth'
import { applyScenario } from '@/shared/mock/scenarios'
import { server } from '@/shared/mock/server'
import { deferred } from '@/shared/test/deferred'
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

const memberListReads = (requests: RecordedRequest[]) =>
  requests.filter(({ method, path }) => method === 'GET' && path.startsWith('/members?'))

/** 서버는 팀원을 만들었는데 응답이 도중에 끊긴다. 화면은 만들어졌는지 모른다 */
const createMemberButLoseResponse = () =>
  http.post(
    '/api/v1/members',
    async ({ request }) => {
      const body = (await request.json()) as {
        workspace_id: string
        display_name: string
        discord_user_id: string
      }
      db.members.push({
        member_id: `mb_${String(db.members.length + 1).padStart(2, '0')}`,
        workspace_id: body.workspace_id,
        display_name: body.display_name,
        discord_user_id: body.discord_user_id,
        notion_name: null,
        role: 'member',
        created_at: MOCK_NOW,
      })
      return HttpResponse.error()
    },
    { once: true },
  )

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

  it('서버는 팀원을 만들었는데 응답이 유실되면, 재시도는 목록을 다시 읽고 같은 POST 를 보내지 않는다', async () => {
    server.use(createMemberButLoseResponse())
    const log = recordRequests()
    await openMembers()
    await userEvent.type(nameInput('minsu'), '박민수')
    await userEvent.click(screen.getByRole('button', { name: '1명 확인 완료' }))
    await waitFor(() => expect(nameInput('minsu')).toHaveAttribute('aria-invalid', 'true'))

    await userEvent.click(screen.getByRole('button', { name: '1명 확인 완료' }))
    await screen.findByRole('heading', { name: '대시보드' })

    // 유실된 POST 하나뿐이다. 재시도는 서버 목록에서 이미 만들어진 팀원을 보고 넘어간다 (409 가 반복되지 않는다)
    expect(memberWrites(log.started)).toEqual(['POST /members'])
    expect(onboardingPatches(log.started)).toHaveLength(1)
    const created = db.members.filter(
      ({ workspace_id, display_name }) => workspace_id === 'ws_03' && display_name === '박민수',
    )
    expect(created).toHaveLength(1)
  })

  it('서버가 거절한 요청(4xx)은 반영된 게 없으니 팀원 목록을 다시 읽지 않는다', async () => {
    server.use(
      http.post('/api/v1/members', () => fail('DISCORD_USER_ALREADY_MAPPED', 'x', 409), {
        once: true,
      }),
    )
    const log = recordRequests()
    await openMembers()
    await userEvent.type(nameInput('minsu'), '박민수')
    await userEvent.click(screen.getByRole('button', { name: '1명 확인 완료' }))
    await waitFor(() => expect(nameInput('minsu')).toHaveAttribute('aria-invalid', 'true'))

    // 처음 화면을 열 때 한 번뿐이다
    expect(memberListReads(log.started)).toHaveLength(1)
  })

  it('유실 직후 다시 읽기도 실패하면, 다음 저장은 목록을 읽기 전에는 POST 를 보내지 않는다', async () => {
    const log = recordRequests()
    await openMembers()
    const listFails = () =>
      http.get('/api/v1/members', () => fail('INVALID_REQUEST', 'x', 400), { once: true })
    server.use(createMemberButLoseResponse(), listFails(), listFails())
    await userEvent.type(nameInput('minsu'), '박민수')
    await userEvent.click(screen.getByRole('button', { name: '1명 확인 완료' }))
    await waitFor(() => expect(nameInput('minsu')).toHaveAttribute('aria-invalid', 'true'))
    // 유실 직후 다시 읽기: 실패했다
    expect(memberListReads(log.started)).toHaveLength(2)

    // 두 번째 저장은 읽기부터 한다. 읽지 못하면 쓰기 없이 멈춘다
    await userEvent.click(screen.getByRole('button', { name: '1명 확인 완료' }))
    await screen.findByText('요청 내용을 다시 확인해 주세요.')
    expect(memberListReads(log.started)).toHaveLength(3)
    expect(memberWrites(log.started)).toEqual(['POST /members'])

    // 세 번째는 읽기에 성공해 이미 만들어진 팀원을 알아보고 완료까지 간다
    await userEvent.click(screen.getByRole('button', { name: '1명 확인 완료' }))
    await screen.findByRole('heading', { name: '대시보드' })
    expect(memberListReads(log.started)).toHaveLength(4)
    expect(memberWrites(log.started)).toEqual(['POST /members'])
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
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await app.expectPath('/onboarding/ws_03/connect_members')
    expect(nameInput('minsu')).toHaveValue('박민수')
    // 목록에 들렀다 온 것도 아니다
    expect(screen.getByRole('heading', { level: 1, name: '팀원 연결' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '워크스페이스 선택' })).not.toBeInTheDocument()
    expect(app.visited().map(({ pathname }) => pathname)).toEqual([
      '/onboarding/ws_03/connect_members',
    ])
    expect(hasUnsavedChanges()).toBe(true)
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

/* F-r1 #7. 나가기 저장과 확인 완료 제출이 겹치면 같은 팀원 캐시로 계획해 같은 줄에 POST 가 두 번 나갈 수 있다 */
describe('팀원 연결 저장은 한 번에 하나다', () => {
  function holdMemberPost() {
    const gate = deferred()
    server.use(
      http.post('/api/v1/members', async () => {
        await gate.promise
        // 아무것도 돌려주지 않아 기본 handler 가 저장한다
      }),
    )
    return gate
  }

  it('확인 완료 저장 중에는 나가기를 눌러도 나가지 않는다', async () => {
    rememberReturnWorkspace('ws_01')
    const gate = holdMemberPost()
    const log = recordRequests()
    const app = await openMembers()
    await userEvent.type(nameInput('minsu'), '박민수')
    await userEvent.click(screen.getByRole('button', { name: '1명 확인 완료' }))
    await waitFor(() => expect(memberWrites(log.started)).toEqual(['POST /members']))

    await userEvent.click(screen.getByRole('link', { name: '온보딩 나가기' }))
    gate.resolve()

    await waitFor(() => expect(onboardingPatches(log.started)).toHaveLength(1))
    expect(memberWrites(log.started)).toEqual(['POST /members'])
    expect(app.visited().map(({ pathname }) => pathname)).not.toContain(
      '/workspaces/ws_01/dashboard',
    )
  })

  it('나가기 저장 중의 제출은 무시한다 — 팀원 저장도 단계 완료도 더 나가지 않는다', async () => {
    rememberReturnWorkspace('ws_01')
    db.accounts[0].workspaceIds.unshift('ws_01')
    const gate = holdMemberPost()
    const log = recordRequests()
    const app = await openMembers()
    await userEvent.type(nameInput('minsu'), '박민수')
    await userEvent.click(screen.getByRole('link', { name: '온보딩 나가기' }))
    await waitFor(() => expect(memberWrites(log.started)).toEqual(['POST /members']))

    // 버튼 비활성을 거치지 않는 제출 — Enter 와 같다
    fireEvent.submit(nameInput('minsu').closest('form')!)
    gate.resolve()

    expect(await screen.findByRole('heading', { name: '대시보드' })).toBeInTheDocument()
    await app.expectPath('/workspaces/ws_01/dashboard')
    expect(memberWrites(log.started)).toEqual(['POST /members'])
    expect(onboardingPatches(log.started)).toHaveLength(0)
  })
})

/* D-073 개정(2026-09-29, 사용자 결정): Discord 를 건너뛰어도 팀원 연결 단계가 온다.
   Discord 가 없으면 불러올 사용자가 없다 — 다시 시도만 있는 오류 대신 안내와 `건너뛰기` 를 보인다 */
describe('Discord 없이 온 팀원 연결 (D-073 개정)', () => {
  const NOT_CONNECTED =
    '디스코드를 연결하지 않아 팀원을 불러올 수 없어요. 이전 단계에서 연결하거나 건너뛸 수 있어요.'

  /** Discord 는 건너뛰고 Notion 은 연결한 채 팀원 연결 단계다 */
  function atMembersWithoutDiscord() {
    applyScenario('incomplete-workspace')
    const ws03 = db.workspaces.find(({ workspace_id }) => workspace_id === 'ws_03')!
    ws03.onboarding.steps[1].status = 'skipped'
    ws03.onboarding.steps[2].status = 'completed'
    ws03.onboarding.current_step = 'connect_members'
    settleMockOAuth({ workspaceId: 'ws_03', provider: 'notion', outcome: 'success' })
  }

  const discordUserGets = (requests: RecordedRequest[]) =>
    requests.filter(
      ({ method, path }) => method === 'GET' && path === '/workspaces/ws_03/discord/members',
    )

  beforeEach(() => atMembersWithoutDiscord())

  it('안내와 `건너뛰기` 를 보이고, 건너뛰면 팀원 연결을 건너뜀으로 저장해 대시보드로 간다', async () => {
    const bodies = recordRequestBodies('PATCH', '/workspaces/ws_03/onboarding')
    const app = renderApp('/onboarding/ws_03/connect_members')
    expect(await screen.findByText(NOT_CONNECTED)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '다시 시도' })).not.toBeInTheDocument()
    expect(screen.queryAllByRole('textbox')).toEqual([])

    await userEvent.click(screen.getByRole('button', { name: '건너뛰기' }))
    expect(await screen.findByRole('heading', { name: '대시보드' })).toBeInTheDocument()
    await app.expectPath('/workspaces/ws_03/dashboard')
    expect(bodies).toEqual([{ step: 'connect_members', action: 'skip' }])
  })

  it('`다음 단계` 도 같은 건너뛰기다', async () => {
    const bodies = recordRequestBodies('PATCH', '/workspaces/ws_03/onboarding')
    const app = renderApp('/onboarding/ws_03/connect_members')
    await screen.findByText(NOT_CONNECTED)
    const nav = screen.getByRole('navigation', { name: '단계 이동' })
    await userEvent.click(within(nav).getByRole('button', { name: '다음 단계' }))
    expect(await screen.findByRole('heading', { name: '대시보드' })).toBeInTheDocument()
    await app.expectPath('/workspaces/ws_03/dashboard')
    expect(bodies).toEqual([{ step: 'connect_members', action: 'skip' }])
  })

  it('`이전 단계` 는 Notion 둘러보기다 — 거기서 Discord 로 돌아가 연결할 수 있다', async () => {
    const app = renderApp('/onboarding/ws_03/connect_members')
    await screen.findByText(NOT_CONNECTED)
    const nav = screen.getByRole('navigation', { name: '단계 이동' })
    await userEvent.click(within(nav).getByRole('button', { name: '이전 단계' }))
    expect(await screen.findByRole('heading', { name: 'Notion 연결' })).toBeInTheDocument()
    await app.expectPath('/onboarding/ws_03/connect_notion')
    await app.expectSearch('?review=1')
  })

  it('건너뛰기 저장이 실패하면 안내와 함께 화면에 남고, 다시 누르면 저장한다', async () => {
    server.use(
      http.patch(
        '/api/v1/workspaces/:workspaceId/onboarding',
        () => fail('INTERNAL_ERROR', 'x', 500),
        { once: true },
      ),
    )
    const app = renderApp('/onboarding/ws_03/connect_members')
    await screen.findByText(NOT_CONNECTED)
    await userEvent.click(screen.getByRole('button', { name: '건너뛰기' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '서버에 문제가 생겼어요. 잠시 후 다시 시도해 주세요.',
    )
    await app.expectPath('/onboarding/ws_03/connect_members')
    await userEvent.click(screen.getByRole('button', { name: '건너뛰기' }))
    expect(await screen.findByRole('heading', { name: '대시보드' })).toBeInTheDocument()
  })

  it('처음 들어와 연동 상태를 모를 때 409 `INTEGRATION_NOT_CONNECTED` 가 와도 같은 안내다', async () => {
    const log = recordRequests()
    renderApp('/onboarding/ws_03/connect_members')
    expect(await screen.findByText(NOT_CONNECTED)).toBeInTheDocument()
    // 연동 상태와 Discord 사용자는 같은 렌더에서 함께 시작한다 — 409 는 한 번이고 다시 부르지 않는다
    expect(discordUserGets(log.started).length).toBeLessThanOrEqual(1)
  })

  it('Notion 단계에서 넘어오면 연동 상태를 이미 알아 Discord 사용자를 부르지 않는다 — 409 가 없다', async () => {
    const ws03 = db.workspaces.find(({ workspace_id }) => workspace_id === 'ws_03')!
    ws03.onboarding.steps[2].status = 'pending'
    ws03.onboarding.current_step = 'connect_notion'
    db.integrations.ws_03.notion = {
      status: 'not_connected',
      display_name: null,
      connected_at: null,
    }
    const log = recordRequests()
    const app = renderApp('/onboarding/ws_03/connect_notion')
    await userEvent.click(await screen.findByRole('button', { name: '건너뛰기' }))
    expect(await screen.findByText(NOT_CONNECTED)).toBeInTheDocument()
    await app.expectPath('/onboarding/ws_03/connect_members')
    expect(discordUserGets(log.started)).toHaveLength(0)
  })
})
