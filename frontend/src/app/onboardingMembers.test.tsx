import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { rememberReturnWorkspace } from '@/shared/lib/return-workspace'
import { hasUnsavedChanges } from '@/shared/lib/unsaved-changes'
import { paths } from '@/shared/config/routes'
import { db } from '@/shared/mock/db'
import { fail } from '@/shared/mock/envelope'
import { MOCK_NOW } from '@/shared/mock/fixtures/constants'
import { settleMockOAuth } from '@/shared/mock/oauth/mockOAuth'
import { applyScenario } from '@/shared/mock/scenarios'
import { server } from '@/shared/mock/server'
import { deferred } from '@/shared/test/deferred'
import { recordRequestBodies, recordRequests } from '@/shared/test/requests'
import type { RecordedRequest } from '@/shared/test/requests'
import { REVEAL_TARGETS } from '@/shared/ui/deferred-skeleton'
import { onTestFinished } from 'vitest'
import { renderApp } from './test/renderApp'

/* U3-7·U3-8·U3-9·U3-10, #647. ws_03 을 팀원 연결 단계로 둔다. 팀원은 생성자 PM(mb_90 최진호) 하나다.
   모의 Discord 서버: 1123 seoyeon_01(서연) · 1124 minsu · 1125 jihun_dev(지훈) · 1199 manager_bot(봇).
   목록은 팀원 한 명이 한 줄이고 줄마다 바로 저장한다 — 목록 자체의 규칙은 memberRows.test.tsx 가 본다 */

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

const memberListReads = (requests: RecordedRequest[]) =>
  requests.filter(({ method, path }) => method === 'GET' && path === '/members?workspace_id=ws_03')

const ws03Members = () => db.members.filter(({ workspace_id }) => workspace_id === 'ws_03')

const accountField = (name: string) =>
  screen.getByRole('combobox', { name: `${name}의 디스코드 계정` })

const addAccount = (username: string) =>
  screen.getByRole('button', { name: `@${username} 팀원으로 추가` })

async function pickAccount(name: string, username: string) {
  await userEvent.click(accountField(name))
  await userEvent.click(await screen.findByRole('option', { name: new RegExp(`^@${username}`) }))
  await waitFor(() => expect(accountField(name)).toHaveTextContent(`@${username}`))
}

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
        has_login_account: false,
        created_at: MOCK_NOW,
      })
      return HttpResponse.error()
    },
    { once: true },
  )

async function openMembers() {
  const app = renderApp('/onboarding/ws_03/connect_members')
  await screen.findByRole('combobox', { name: '최진호의 디스코드 계정' })
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

  it('팀원 한 명이 한 줄이고 이미 이은 계정은 골라져 있다. 봇과 초대는 없다', async () => {
    db.members.push({
      member_id: 'mb_91',
      workspace_id: 'ws_03',
      display_name: '이지훈',
      discord_user_id: '1125',
      notion_name: null,
      role: 'member',
      has_login_account: false,
      created_at: MOCK_NOW,
    })
    await openMembers()
    expect(screen.getAllByRole('combobox', { name: /의 디스코드 계정$/ })).toHaveLength(2)
    expect(accountField('이지훈')).toHaveTextContent('@jihun_dev')
    expect(accountField('최진호')).toHaveTextContent('계정 고르기')
    expect(
      screen.getByRole('heading', { name: '아직 팀원에 연결되지 않은 디스코드 계정 2개' }),
    ).toBeInTheDocument()
    expect(screen.queryByText(/@manager_bot/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /초대/ })).toBeNull()
    expect(screen.getByText(/디스코드에서 팀원 3명을 찾았어요/)).toBeInTheDocument()
    expect(screen.getByText(/2명은 누구인지 모르겠어요/)).toBeInTheDocument()
    expect(screen.getByText('노션 연동 완료')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '1명 확인 완료' })).toBeEnabled()
    // 두 목록을 기다린 뒤 나타난 카드 본문과 버튼에는 불투명도 전환이 걸린다 (#508)
    expect(accountField('이지훈').closest(REVEAL_TARGETS)).not.toBeNull()
    expect(
      screen.getByRole('button', { name: '나중에 하기' }).closest(REVEAL_TARGETS),
    ).not.toBeNull()
  })

  it('디스코드에 연결된 팀원이 없으면 확인 완료는 비활성이고 `나중에 하기` 로 건너뛴다', async () => {
    const bodies = recordRequestBodies('PATCH', '/workspaces/ws_03/onboarding')
    const app = await openMembers()
    expect(screen.getByRole('button', { name: '0명 확인 완료' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: '나중에 하기' }))
    expect(await screen.findByRole('heading', { name: '대시보드' })).toBeInTheDocument()
    await app.expectPath('/workspaces/ws_03/dashboard')
    await waitFor(() => expect(bodies).toEqual([{ step: 'connect_members', action: 'skip' }]))
  })
})

describe('줄마다 저장하고 확인 완료는 단계만 완료한다 (U3-9)', () => {
  it('PM 줄에서 계정을 고르면 PM 에 Discord 사용자만 잇고, 계정으로 추가한 팀원은 이름을 고친 뒤 완료한다', async () => {
    const pmBodies = recordRequestBodies('PATCH', '/members/mb_90')
    const created = recordRequestBodies('POST', '/members')
    const log = recordRequests()
    await openMembers()
    await pickAccount('최진호', 'seoyeon_01')
    await waitFor(() => expect(pmBodies).toEqual([{ discord_user_id: '1123' }]))

    await userEvent.click(addAccount('minsu'))
    const editor = await screen.findByRole('textbox', { name: 'minsu의 새 이름' })
    await userEvent.clear(editor)
    await userEvent.type(editor, '박민수{Enter}')
    expect(await screen.findByRole('button', { name: '박민수 이름 고치기' })).toBeInTheDocument()
    await waitFor(() =>
      expect(created).toEqual([
        { workspace_id: 'ws_03', display_name: 'minsu', discord_user_id: '1124' },
      ]),
    )

    await userEvent.click(screen.getByRole('button', { name: '2명 확인 완료' }))
    await screen.findByRole('heading', { name: '대시보드' })
    const newId = ws03Members()[1]?.member_id
    expect(memberWrites(log.started)).toEqual([
      'PATCH /members/mb_90',
      'POST /members',
      `PATCH /members/${newId}`,
    ])
    const writes = log.timeline.filter((line) => /(POST|PATCH) \/workspaces/.test(line))
    expect(writes).toEqual([
      'start PATCH /workspaces/ws_03/onboarding',
      'answer PATCH /workspaces/ws_03/onboarding',
    ])
    expect(
      ws03Members().map(({ display_name, discord_user_id, role }) => [
        display_name,
        discord_user_id,
        role,
      ]),
    ).toEqual([
      ['최진호', '1123', 'pm'],
      ['박민수', '1124', 'member'],
    ])
  })

  it('다른 팀원에 연결된 계정을 PM 줄에서 고르면 옮길지 묻고, 앞 팀원은 이름 그대로 연결만 풀린다', async () => {
    db.members.push({
      member_id: 'mb_91',
      workspace_id: 'ws_03',
      display_name: '김서연',
      discord_user_id: '1123',
      notion_name: null,
      role: 'member',
      has_login_account: false,
      created_at: MOCK_NOW,
    })
    const log = recordRequests()
    await openMembers()
    await userEvent.click(accountField('최진호'))
    await userEvent.click(await screen.findByRole('option', { name: /^@seoyeon_01/ }))
    await userEvent.click(
      within(await screen.findByRole('dialog', { name: '김서연 님에서 옮길까요?' })).getByRole(
        'button',
        { name: '옮기기' },
      ),
    )

    await waitFor(() => expect(accountField('최진호')).toHaveTextContent('@seoyeon_01'))
    // 연결을 먼저 풀어야 1:1 제약(409 DISCORD_USER_ALREADY_MAPPED)에 걸리지 않는다
    expect(memberWrites(log.started)).toEqual(['PATCH /members/mb_91', 'PATCH /members/mb_90'])
    expect(
      ws03Members().map(({ member_id, display_name, discord_user_id }) => [
        member_id,
        display_name,
        discord_user_id,
      ]),
    ).toEqual([
      ['mb_90', '최진호', '1123'],
      ['mb_91', '김서연', null],
    ])
  })

  it('서버는 팀원을 만들었는데 응답이 유실되면 목록을 다시 읽어 만든 팀원을 보이고, 같은 계정을 다시 만들 수 없다', async () => {
    server.use(createMemberButLoseResponse())
    const log = recordRequests()
    await openMembers()
    await userEvent.click(addAccount('minsu'))

    expect(await screen.findByRole('button', { name: 'minsu 이름 고치기' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '@minsu 팀원으로 추가' })).toBeNull()
    expect(accountField('minsu')).toHaveTextContent('@minsu')
    expect(memberWrites(log.started)).toEqual(['POST /members'])
    expect(ws03Members().filter(({ discord_user_id }) => discord_user_id === '1124')).toHaveLength(
      1,
    )
  })

  it('서버가 거절한 요청(4xx)은 반영된 게 없으니 줄에 문구만 두고 팀원 목록을 다시 읽지 않는다', async () => {
    server.use(
      http.patch('/api/v1/members/mb_90', () => fail('INVALID_REQUEST', 'x', 400), { once: true }),
    )
    const log = recordRequests()
    await openMembers()
    await userEvent.click(accountField('최진호'))
    await userEvent.click(await screen.findByRole('option', { name: /^@seoyeon_01/ }))

    const row = within(accountField('최진호').closest('li')!)
    expect(await row.findByRole('alert')).toHaveTextContent('요청 내용을 다시 확인해 주세요.')
    // 처음 화면을 열 때 한 번뿐이다
    expect(memberListReads(log.started)).toHaveLength(1)
  })

  it('유실 직후 다시 읽기도 실패하면, 다음 쓰기는 목록을 읽기 전에는 보내지 않는다', async () => {
    const log = recordRequests()
    await openMembers()
    const listFails = () =>
      http.get('/api/v1/members', () => fail('INVALID_REQUEST', 'x', 400), { once: true })
    server.use(createMemberButLoseResponse(), listFails(), listFails())
    await userEvent.click(addAccount('minsu'))
    const item = () => within(addAccount('minsu').closest('li')!)
    expect(await item().findByRole('alert')).toHaveTextContent(
      '네트워크에 연결할 수 없어요. 연결을 확인해 주세요.',
    )
    // 유실 직후 다시 읽기: 실패했다
    await waitFor(() => expect(memberListReads(log.started)).toHaveLength(2))

    // 두 번째 쓰기는 읽기부터 한다. 읽지 못하면 쓰기 없이 멈춘다
    await userEvent.click(addAccount('minsu'))
    expect(await item().findByText('요청 내용을 다시 확인해 주세요.')).toBeInTheDocument()
    expect(memberListReads(log.started)).toHaveLength(3)
    expect(memberWrites(log.started)).toEqual(['POST /members'])

    // 세 번째는 읽기에 성공해 이미 만들어진 팀원을 알아보고 보내지 않는다
    await userEvent.click(addAccount('minsu'))
    expect(await screen.findByRole('button', { name: 'minsu 이름 고치기' })).toBeInTheDocument()
    expect(memberWrites(log.started)).toEqual(['POST /members'])
    expect(ws03Members()).toHaveLength(2)
  })

  it('확인 완료 요청이 실패하면 다시 누를 때 완료 요청만 보낸다', async () => {
    db.members.find(({ member_id }) => member_id === 'mb_90')!.discord_user_id = '1123'
    server.use(
      http.patch(
        '/api/v1/workspaces/:workspaceId/onboarding',
        () => fail('INTERNAL_ERROR', 'x', 500),
        { once: true },
      ),
    )
    const log = recordRequests()
    await openMembers()
    await userEvent.click(screen.getByRole('button', { name: '1명 확인 완료' }))
    expect(
      await screen.findByText('서버에 문제가 생겼어요. 잠시 후 다시 시도해 주세요.'),
    ).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '1명 확인 완료' }))
    await screen.findByRole('heading', { name: '대시보드' })
    expect(memberWrites(log.started)).toEqual([])
    expect(onboardingPatches(log.started)).toHaveLength(2)
  })

  it('쓰는 동안에는 확인 완료·나중에 하기·다음 단계를 막는다', async () => {
    const gate = deferred()
    onTestFinished(() => gate.resolve())
    server.use(
      http.post('/api/v1/members', async () => {
        await gate.promise
        // 아무것도 돌려주지 않아 기본 handler 가 저장한다
      }),
    )
    const log = recordRequests()
    await openMembers()
    await pickAccount('최진호', 'seoyeon_01')
    await userEvent.click(addAccount('minsu'))
    await waitFor(() => expect(memberWrites(log.started)).toContain('POST /members'))

    const nav = screen.getByRole('navigation', { name: '단계 이동' })
    expect(screen.getByRole('button', { name: '나중에 하기' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '1명 확인 완료' })).toBeDisabled()
    expect(within(nav).getByRole('button', { name: '다음 단계' })).toBeDisabled()

    gate.resolve()
    expect(await screen.findByRole('button', { name: '2명 확인 완료' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '나중에 하기' })).toBeEnabled()
    expect(onboardingPatches(log.started)).toHaveLength(0)
  })

  it('`나중에 하기` 가 실패하면 화면에 남고, 다시 누르면 건너뛴다', async () => {
    server.use(
      http.patch(
        '/api/v1/workspaces/:workspaceId/onboarding',
        () => fail('INTERNAL_ERROR', 'x', 500),
        { once: true },
      ),
    )
    const app = await openMembers()
    await userEvent.click(screen.getByRole('button', { name: '나중에 하기' }))

    expect(
      await screen.findByText('서버에 문제가 생겼어요. 잠시 후 다시 시도해 주세요.'),
    ).toBeInTheDocument()
    await app.expectPath('/onboarding/ws_03/connect_members')

    await userEvent.click(screen.getByRole('button', { name: '나중에 하기' }))
    expect(await screen.findByRole('heading', { name: '대시보드' })).toBeInTheDocument()
  })
})

/* #228. 생성자 PM(mb_90 최진호)은 로그인 계정 이름으로 먼저 만들어진다. 이름이 달라도 PM 줄에서 계정을 골라 잇는다 */
describe('PM 의 디스코드 계정 (#228)', () => {
  it('PM 이 디스코드에 연결되지 않았으면 확인 완료는 저장 요청 없이 막고 PM 줄의 계정 고르기로 포커스를 옮긴다', async () => {
    const bodies = recordRequestBodies('PATCH', '/workspaces/ws_03/onboarding')
    const log = recordRequests()
    await openMembers()
    await userEvent.click(addAccount('minsu'))
    await screen.findByRole('textbox', { name: 'minsu의 새 이름' })
    await userEvent.click(screen.getByRole('button', { name: '1명 확인 완료' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'PM의 디스코드 계정을 골라야 완료할 수 있어요.',
    )
    await waitFor(() => expect(accountField('최진호')).toHaveFocus())
    expect(onboardingPatches(log.started)).toHaveLength(0)

    await pickAccount('최진호', 'seoyeon_01')
    await userEvent.click(screen.getByRole('button', { name: '2명 확인 완료' }))
    await screen.findByRole('heading', { name: '대시보드' })
    await waitFor(() => expect(bodies).toEqual([{ step: 'connect_members', action: 'complete' }]))
  })

  it('다시 들어오면 PM 줄에 계정이 골라져 있고, 그대로 완료하면 팀원 요청이 없다', async () => {
    db.members.find(({ member_id }) => member_id === 'mb_90')!.discord_user_id = '1123'
    const log = recordRequests()
    await openMembers()
    expect(accountField('최진호')).toHaveTextContent('@seoyeon_01')
    expect(screen.getByText('PM', { exact: true })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '1명 확인 완료' }))
    await screen.findByRole('heading', { name: '대시보드' })
    expect(memberWrites(log.started)).toEqual([])
    expect(onboardingPatches(log.started)).toHaveLength(1)
    expect(ws03Members()).toHaveLength(1)
  })
})

describe('미저장 변경 확인 (U3-10)', () => {
  it('이름 고치기 칸에 글자를 바꾸면 등록되고(브라우저 이탈 경고 포함) 링크 이동은 공통 확인을 거친다', async () => {
    const app = await openMembers()
    expect(hasUnsavedChanges()).toBe(false)
    await userEvent.click(screen.getByRole('button', { name: '최진호 이름 고치기' }))
    const editor = screen.getByRole('textbox', { name: '최진호의 새 이름' })
    await userEvent.type(editor, '님')
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
    expect(screen.getByRole('textbox', { name: '최진호의 새 이름' })).toHaveValue('최진호님')
    // 목록에 들렀다 온 것도 아니다
    expect(screen.getByRole('heading', { level: 1, name: '팀원 연결' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '워크스페이스 선택' })).not.toBeInTheDocument()
    expect(app.visited().map(({ pathname }) => pathname)).toEqual([
      '/onboarding/ws_03/connect_members',
    ])
    expect(hasUnsavedChanges()).toBe(true)

    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(hasUnsavedChanges()).toBe(false))
  })
})

describe('팀원 연결에서 나가기 (U3-7)', () => {
  it('줄마다 이미 저장돼 나가기는 따로 저장하지 않고 시작한 공간의 대시보드로 간다 — 단계는 완료하지 않는다', async () => {
    // ws_01 에서 새 공간 만들기를 시작한 사용자다
    db.accounts[0].workspaceIds.unshift('ws_01')
    rememberReturnWorkspace('ws_01')
    const log = recordRequests()
    const app = await openMembers()
    await pickAccount('최진호', 'seoyeon_01')
    await userEvent.click(screen.getByRole('link', { name: '온보딩 나가기' }))

    expect(await screen.findByRole('heading', { name: '대시보드' })).toBeInTheDocument()
    await app.expectPath('/workspaces/ws_01/dashboard')
    expect(memberWrites(log.started)).toEqual(['PATCH /members/mb_90'])
    expect(onboardingPatches(log.started)).toHaveLength(0)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('바꾸지 않았으면 저장 없이 나간다', async () => {
    const log = recordRequests()
    const app = await openMembers()
    await userEvent.click(screen.getByRole('link', { name: '온보딩 나가기' }))
    expect(await screen.findByRole('heading', { name: '워크스페이스 선택' })).toBeInTheDocument()
    await app.expectPath('/workspaces')
    expect(memberWrites(log.started)).toEqual([])
  })
})

/* D-073 개정(2026-09-29, 사용자 결정): Discord 를 건너뛰어도 팀원 연결 단계가 온다.
   Discord 가 없으면 불러올 사용자가 없다 — 다시 시도만 있는 오류 대신 안내와 `건너뛰기` 를 보인다 */
describe('Discord 없이 온 팀원 연결 (D-073 개정)', () => {
  const NOT_CONNECTED =
    '디스코드를 연결하지 않아 팀원을 불러올 수 없어요. 이름으로 팀원을 추가하거나, 이전 단계에서 연결하거나, 건너뛸 수 있어요.'

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
    expect(screen.queryByRole('combobox')).toBeNull()
    // 기다린 뒤 나타난 안내와 버튼에는 불투명도 전환이 걸린다 (#508)
    expect(screen.getByText(NOT_CONNECTED).closest(REVEAL_TARGETS)).not.toBeNull()
    expect(screen.getByRole('button', { name: '건너뛰기' }).closest(REVEAL_TARGETS)).not.toBeNull()

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

  it('이름만 적어 팀원을 추가하면 Discord 사용자 없이 만들고 목록의 새 줄이 된다. `건너뛰기` 는 `다음` 이 된다 (#613)', async () => {
    const bodies = recordRequestBodies('POST', '/members')
    const user = userEvent.setup()
    renderApp('/onboarding/ws_03/connect_members')
    const name = await screen.findByRole('textbox', { name: '팀원 이름' })
    expect(screen.getByRole('button', { name: '추가' })).toBeDisabled()
    await user.type(name, '  김서연 ')
    await user.click(screen.getByRole('button', { name: '추가' }))

    expect(await screen.findByRole('button', { name: '김서연 이름 고치기' })).toBeInTheDocument()
    // 띄어 쓰지 않은 긴 이름도 줄 안에서 접는다
    expect(within(screen.getByRole('list', { name: '팀원' })).getByText('김서연')).toHaveClass(
      'wrap-anywhere',
    )
    expect(name).toHaveValue('')
    expect(bodies).toEqual([{ workspace_id: 'ws_03', display_name: '김서연' }])
    expect(db.members).toContainEqual(
      expect.objectContaining({
        workspace_id: 'ws_03',
        display_name: '김서연',
        discord_user_id: null,
      }),
    )
    expect(screen.getByRole('button', { name: '다음' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: '건너뛰기' })).toBeNull()
  })

  it('팀원을 추가한 뒤 `다음` 을 누르면 팀원 연결을 완료로 저장해 대시보드로 간다 (#613)', async () => {
    const bodies = recordRequestBodies('PATCH', '/workspaces/ws_03/onboarding')
    const user = userEvent.setup()
    const app = renderApp('/onboarding/ws_03/connect_members')
    const name = await screen.findByRole('textbox', { name: '팀원 이름' })
    expect(screen.getByRole('button', { name: '건너뛰기' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '다음' })).toBeNull()
    await user.type(name, '김서연')
    await user.click(screen.getByRole('button', { name: '추가' }))

    await user.click(await screen.findByRole('button', { name: '다음' }))
    expect(await screen.findByRole('heading', { name: '대시보드' })).toBeInTheDocument()
    await app.expectPath('/workspaces/ws_03/dashboard')
    expect(bodies).toEqual([{ step: 'connect_members', action: 'complete' }])
  })

  it('팀원 목록을 받는 동안은 추가 칸 대신 기다림 표시를 보이고 오류는 보이지 않는다 (#613)', async () => {
    const gate = deferred()
    onTestFinished(() => gate.resolve())
    server.use(
      http.get(
        '/api/v1/members',
        async () => {
          await gate.promise
          return undefined
        },
        { once: true },
      ),
    )
    const user = userEvent.setup()
    renderApp('/onboarding/ws_03/connect_members')
    await screen.findByText(NOT_CONNECTED)
    expect(screen.queryByRole('textbox', { name: '팀원 이름' })).toBeNull()
    expect(screen.queryByRole('button', { name: '다시 시도' })).toBeNull()

    gate.resolve()
    const name = await screen.findByRole('textbox', { name: '팀원 이름' })
    await user.type(name, '김서연')
    expect(screen.getByRole('button', { name: '추가' })).toBeEnabled()
  })

  it('팀원 목록을 받지 못하면 추가 칸 대신 오류와 `다시 시도` 를 보이고, 다시 받으면 추가할 수 있다 (#613)', async () => {
    let failing = true
    server.use(
      http.get('/api/v1/members', () => (failing ? fail('FORBIDDEN', 'x', 403) : undefined)),
    )
    const user = userEvent.setup()
    renderApp('/onboarding/ws_03/connect_members')
    const retry = await screen.findByRole('button', { name: '다시 시도' })
    expect(screen.getByText('정보를 불러오지 못했어요')).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: '팀원 이름' })).toBeNull()

    failing = false
    await user.click(retry)
    const name = await screen.findByRole('textbox', { name: '팀원 이름' })
    expect(screen.queryByRole('button', { name: '다시 시도' })).toBeNull()
    await user.type(name, '김서연')
    await user.click(screen.getByRole('button', { name: '추가' }))
    expect(await screen.findByRole('button', { name: '김서연 이름 고치기' })).toBeInTheDocument()
  })

  it('한글 조합을 확정하는 Enter 는 제출을 막고, 조합이 끝난 Enter 로 추가한다 (#613)', async () => {
    const log = recordRequests()
    const user = userEvent.setup()
    renderApp('/onboarding/ws_03/connect_members')
    const name = await screen.findByRole('textbox', { name: '팀원 이름' })
    await user.type(name, '김서연')
    await waitFor(() => expect(screen.getByRole('button', { name: '추가' })).toBeEnabled())
    const memberPosts = () =>
      log.started.filter(({ method, path }) => method === 'POST' && path === '/members')

    expect(fireEvent.keyDown(name, { key: 'Enter', isComposing: true })).toBe(false)
    expect(fireEvent.keyDown(name, { key: 'Enter', keyCode: 229 })).toBe(false)
    expect(fireEvent.keyDown(name, { key: 'Enter' })).toBe(true)

    await user.keyboard('{Enter}')
    expect(await screen.findByRole('button', { name: '김서연 이름 고치기' })).toBeInTheDocument()
    expect(memberPosts()).toHaveLength(1)
  })

  it('같은 이름은 두 번 추가하지 못한다 — 앞뒤 공백만 달라도 막고, 대소문자가 다르면 다른 이름이다 (#613)', async () => {
    const log = recordRequests()
    const user = userEvent.setup()
    renderApp('/onboarding/ws_03/connect_members')
    const name = await screen.findByRole('textbox', { name: '팀원 이름' })
    const memberPosts = () =>
      log.started.filter(({ method, path }) => method === 'POST' && path === '/members')

    // 생성자 PM 도 같은 이름의 팀원이다
    await user.type(name, ' 최진호 ')
    await user.click(screen.getByRole('button', { name: '추가' }))
    expect(await screen.findByText('이미 같은 이름의 팀원이 있어요.')).toBeInTheDocument()
    expect(name).toHaveAccessibleDescription('이미 같은 이름의 팀원이 있어요.')
    await user.clear(name)
    expect(screen.queryByText('이미 같은 이름의 팀원이 있어요.')).toBeNull()

    await user.type(name, 'Alex')
    await user.click(screen.getByRole('button', { name: '추가' }))
    await waitFor(() => expect(name).toHaveValue(''))
    await user.type(name, 'Alex  ')
    await user.click(screen.getByRole('button', { name: '추가' }))
    expect(await screen.findByText('이미 같은 이름의 팀원이 있어요.')).toBeInTheDocument()

    await user.clear(name)
    await user.type(name, 'alex')
    await user.click(screen.getByRole('button', { name: '추가' }))
    await waitFor(() => expect(name).toHaveValue(''))

    expect(memberPosts()).toHaveLength(2)
    expect(
      db.members
        .filter(({ workspace_id, role }) => workspace_id === 'ws_03' && role === 'member')
        .map(({ display_name }) => display_name),
    ).toEqual(['Alex', 'alex'])
  })

  it('같은 틱에 두 번 제출해도 팀원은 하나만 만든다 (#613)', async () => {
    const log = recordRequests()
    const user = userEvent.setup()
    renderApp('/onboarding/ws_03/connect_members')
    const name = await screen.findByRole('textbox', { name: '팀원 이름' })
    await user.type(name, '박민수')
    await waitFor(() => expect(screen.getByRole('button', { name: '추가' })).toBeEnabled())
    const form = name.closest('form')!
    fireEvent.submit(form)
    fireEvent.submit(form)

    await waitFor(() => expect(name).toHaveValue(''))
    expect(
      log.started.filter(({ method, path }) => method === 'POST' && path === '/members'),
    ).toHaveLength(1)
    expect(
      db.members.filter(
        ({ workspace_id, display_name }) => workspace_id === 'ws_03' && display_name === '박민수',
      ),
    ).toHaveLength(1)
  })

  it('추가한 팀원의 이름을 그 줄에서 고친다 — 다른 팀원과 같은 이름은 보내지 않는다', async () => {
    const user = userEvent.setup()
    renderApp('/onboarding/ws_03/connect_members')
    await user.type(await screen.findByRole('textbox', { name: '팀원 이름' }), '김서연{Enter}')
    await user.click(await screen.findByRole('button', { name: '김서연 이름 고치기' }))
    const editor = screen.getByRole('textbox', { name: '김서연의 새 이름' })
    await user.clear(editor)
    await user.type(editor, '최진호{Enter}')
    expect(editor).toHaveAccessibleDescription('이미 같은 이름의 팀원이 있어요.')

    const added = db.members.find(
      ({ workspace_id, display_name }) => workspace_id === 'ws_03' && display_name === '김서연',
    )!
    const bodies = recordRequestBodies('PATCH', `/members/${added.member_id}`)
    await user.clear(editor)
    await user.type(editor, '김서윤{Enter}')
    expect(await screen.findByRole('button', { name: '김서윤 이름 고치기' })).toBeInTheDocument()
    await waitFor(() => expect(bodies).toEqual([{ display_name: '김서윤' }]))
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

describe('Discord 서버에 없는 사람을 이름으로 추가 (#660)', () => {
  it('Discord 사용자가 없어도 이름으로 팀원을 추가하고, 단계를 마친 뒤 팀 화면의 그 팀원 줄에 `초대` 가 있다', async () => {
    db.discordUsers.length = 0
    const bodies = recordRequestBodies('POST', '/members')
    const user = userEvent.setup()
    const app = await openMembers()
    expect(
      screen.getByText(/^Discord 서버에 없는 팀원은 이름으로 추가할 수 있어요\./),
    ).toBeInTheDocument()

    await user.type(screen.getByRole('textbox', { name: '팀원 이름' }), '김서연')
    await user.click(screen.getByRole('button', { name: '추가' }))
    expect(await screen.findByRole('button', { name: '김서연 이름 고치기' })).toBeInTheDocument()
    expect(bodies).toEqual([{ workspace_id: 'ws_03', display_name: '김서연' }])

    expect(screen.getByRole('button', { name: '0명 확인 완료' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: '나중에 하기' }))
    await screen.findByRole('heading', { name: '대시보드' })
    app.navigate(paths.members('ws_03'))
    const added = within(await screen.findByRole('region', { name: '김서연' }))
    expect(await added.findByRole('button', { name: '초대' })).toBeInTheDocument()
  })

  it('다른 줄에서 고치던 이름은 이름 추가 뒤에도 남고, 추가한 팀원은 목록의 새 줄이다', async () => {
    const user = userEvent.setup()
    await openMembers()
    await user.click(screen.getByRole('button', { name: '최진호 이름 고치기' }))
    const editor = screen.getByRole('textbox', { name: '최진호의 새 이름' })
    await user.type(editor, '님')

    await user.type(screen.getByRole('textbox', { name: '팀원 이름' }), '박민수')
    await user.click(screen.getByRole('button', { name: '추가' }))
    expect(await screen.findByRole('button', { name: '박민수 이름 고치기' })).toBeInTheDocument()
    expect(editor).toHaveValue('최진호님')
    expect(accountField('박민수')).toHaveTextContent('계정 고르기')
  })

  it('이름을 추가하는 동안에는 `확인 완료`·`나중에 하기`·`다음 단계` 가 잠기고 단계를 저장하지 않는다', async () => {
    const gate = deferred()
    onTestFinished(() => gate.resolve())
    server.use(
      http.post(
        '/api/v1/members',
        async () => {
          await gate.promise
        },
        { once: true },
      ),
    )
    const log = recordRequests()
    const user = userEvent.setup()
    const app = await openMembers()
    await pickAccount('최진호', 'seoyeon_01')
    await user.type(screen.getByRole('textbox', { name: '팀원 이름' }), '박민수')
    await user.click(screen.getByRole('button', { name: '추가' }))

    const nav = screen.getByRole('navigation', { name: '단계 이동' })
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '1명 확인 완료' })).toBeDisabled(),
    )
    expect(screen.getByRole('button', { name: '나중에 하기' })).toBeDisabled()
    expect(within(nav).getByRole('button', { name: '다음 단계' })).toBeDisabled()
    await app.expectPath('/onboarding/ws_03/connect_members')

    gate.resolve()
    expect(await screen.findByRole('button', { name: '박민수 이름 고치기' })).toBeInTheDocument()
    expect(memberWrites(log.started)).toEqual(['PATCH /members/mb_90', 'POST /members'])
    expect(onboardingPatches(log.started)).toHaveLength(0)
  })
})
