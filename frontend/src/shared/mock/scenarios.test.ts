import { fetchDto, fetchSessionDto, jsonRequest, signUpVerified } from '@/shared/test/api'
import type { SessionDto } from '@/shared/types/api/auth'
import type { ListDto } from '@/shared/types/api/envelope'
import type { InvitationDto, MyInvitationDto } from '@/shared/types/api/invitation'
import type { DiscordUserDto, MemberDto } from '@/shared/types/api/member'
import type { WorkspaceDto } from '@/shared/types/api/workspace'
import { db, initialDb } from './db'
import { MOCK_SCENARIOS, applyScenario, createScenarioDb } from './scenarios'
import type { MockScenario } from './scenarios'

async function listedWorkspaces() {
  const { items } = await fetchDto<ListDto<WorkspaceDto>>('/workspaces')
  return items.map(({ workspace_id, role, onboarding }) => ({
    id: workspace_id,
    role,
    completed: onboarding.completed,
  }))
}

describe('E2E 시나리오', () => {
  it('비로그인: 세션이 없고, 픽스처 계정으로 로그인하면 공간 2개다', async () => {
    applyScenario('signed-out')
    await expect(fetchSessionDto()).resolves.toBeNull()
    await expect(
      fetchDto<SessionDto>(
        '/auth/login',
        jsonRequest('POST', { email: 'pm@example.com', password: 'mock-password' }),
      ),
    ).resolves.toMatchObject({ workspace_count: 2 })
  })

  it('공간 0개: 로그인돼 있고 목록이 비었다', async () => {
    applyScenario('no-workspace')
    await expect(fetchSessionDto()).resolves.toMatchObject({
      workspace_count: 0,
      last_workspace_id: null,
    })
    await expect(listedWorkspaces()).resolves.toEqual([])
  })

  it('공간 1개: 완료된 ws_01 하나다', async () => {
    applyScenario('single-workspace')
    await expect(fetchSessionDto()).resolves.toMatchObject({
      workspace_count: 1,
      last_workspace_id: 'ws_01',
    })
    await expect(listedWorkspaces()).resolves.toEqual([
      { id: 'ws_01', role: 'pm', completed: true },
    ])
  })

  it('공간 여러 개: Vitest 기본 상태와 같다', async () => {
    applyScenario('multiple-workspaces')
    expect(db).toEqual(initialDb())
    await expect(listedWorkspaces()).resolves.toEqual([
      { id: 'ws_02', role: 'member', completed: false },
      { id: 'ws_01', role: 'pm', completed: true },
    ])
  })

  it('미완료 공간: PM 인 공간 하나가 Discord 연결 단계에 멈춰 있다', async () => {
    applyScenario('incomplete-workspace')
    await expect(fetchSessionDto()).resolves.toMatchObject({
      workspace_count: 1,
      last_workspace_id: 'ws_03',
    })
    await expect(listedWorkspaces()).resolves.toEqual([
      { id: 'ws_03', role: 'pm', completed: false },
    ])
    await expect(fetchDto<WorkspaceDto>('/workspaces/ws_03')).resolves.toMatchObject({
      onboarding: { current_step: 'connect_discord' },
    })
    await expect(fetchDto('/workspaces/ws_03/integrations')).resolves.toMatchObject({
      discord: { status: 'not_connected' },
    })
    // 생성자가 PM 팀원으로 있다 — 팀원 연결 단계가 기존 PM 을 재사용한다
    await expect(fetchDto('/members?workspace_id=ws_03')).resolves.toMatchObject({
      items: [{ role: 'pm', display_name: '최진호' }],
    })
    // PM 이라 온보딩을 이어 갈 수 있다
    await expect(
      fetchDto(
        '/workspaces/ws_03/onboarding',
        jsonRequest('PATCH', { step: 'connect_discord', action: 'skip' }),
      ),
    ).resolves.toEqual({})
  })

  it('Discord 를 건너뛴 설정: 온보딩을 마친 ws_03 에서 Discord 만 미연결이고 팀원은 생성자 PM 하나다', async () => {
    applyScenario('settings-discord-skipped')
    await expect(listedWorkspaces()).resolves.toEqual([
      { id: 'ws_03', role: 'pm', completed: true },
    ])
    await expect(fetchDto<WorkspaceDto>('/workspaces/ws_03')).resolves.toMatchObject({
      onboarding: {
        steps: [
          { step: 'create_workspace', status: 'completed' },
          { step: 'connect_discord', status: 'skipped' },
          { step: 'connect_notion', status: 'completed' },
          { step: 'connect_members', status: 'skipped' },
        ],
      },
    })
    await expect(fetchDto('/workspaces/ws_03/integrations')).resolves.toMatchObject({
      discord: { status: 'not_connected' },
      notion: { status: 'connected' },
    })
    await expect(fetchDto('/members?workspace_id=ws_03')).resolves.toMatchObject({
      total: 1,
      items: [{ role: 'pm', discord_user_id: null }],
    })
    await expect(fetchDto('/workspaces/ws_03/discord/members')).rejects.toMatchObject({
      code: 'INTEGRATION_NOT_CONNECTED',
    })
  })

  it('미매핑 설정: ws_01 의 Discord 가 연결돼 있고 미매핑·서버를 떠난 사용자가 있다', async () => {
    applyScenario('settings-unmapped')
    await expect(listedWorkspaces()).resolves.toEqual([
      { id: 'ws_01', role: 'pm', completed: true },
    ])
    const { items: users } = await fetchDto<ListDto<DiscordUserDto>>(
      '/workspaces/ws_01/discord/members',
    )
    const { items: members } = await fetchDto<ListDto<MemberDto>>('/members?workspace_id=ws_01')
    const mapped = new Set(members.map(({ discord_user_id }) => discord_user_id))
    const listed = new Set(users.map(({ discord_user_id }) => discord_user_id))
    // 미매핑: 목록에 있는데 잇는 팀원이 없다. 봇은 뺀다
    expect(
      users.filter(({ is_bot, discord_user_id }) => !is_bot && !mapped.has(discord_user_id)),
    ).toMatchObject([{ discord_user_id: '1125' }])
    // 서버를 떠났다(inactive): 팀원은 이어져 있는데 목록에 없다
    expect(
      members.filter(
        ({ discord_user_id }) => discord_user_id !== null && !listed.has(discord_user_id),
      ),
    ).toMatchObject([{ member_id: 'mb_04', discord_user_id: '1126' }])
  })

  it('팀원 줄: 이재환에 잘못 이은 계정을 최지훈 줄에서 다시 고를 수 있고, 연결 안 된 계정과 떠난 계정이 있다 (#647)', async () => {
    applyScenario('member-rows')
    await expect(listedWorkspaces()).resolves.toEqual([
      { id: 'ws_01', role: 'pm', completed: true },
    ])
    const { items: users } = await fetchDto<ListDto<DiscordUserDto>>(
      '/workspaces/ws_01/discord/members',
    )
    const { items: members } = await fetchDto<ListDto<MemberDto>>('/members?workspace_id=ws_01')
    expect(
      members.map(({ member_id, display_name, discord_user_id, role }) => [
        member_id,
        display_name,
        discord_user_id,
        role,
      ]),
    ).toEqual([
      ['mb_01', '김서연', '1123', 'pm'],
      ['mb_02', '박민수', '1124', 'member'],
      ['mb_03', '이재환', '1125', 'member'],
      ['mb_04', '정하늘', '1126', 'member'],
      ['mb_05', '최지훈', null, 'member'],
    ])
    const mapped = new Set(members.map(({ discord_user_id }) => discord_user_id))
    const listed = new Set(users.map(({ discord_user_id }) => discord_user_id))
    expect(
      users.filter(({ is_bot, discord_user_id }) => !is_bot && !mapped.has(discord_user_id)),
    ).toMatchObject([{ discord_user_id: '1128', username: 'dahye' }])
    expect(listed.has('1126')).toBe(false)

    // 이슈의 재현: 이재환의 연결을 먼저 풀고 최지훈에 잇는다. 이재환은 이름이 그대로다
    await fetchDto('/members/mb_03', jsonRequest('PATCH', { discord_user_id: null }))
    await fetchDto('/members/mb_05', jsonRequest('PATCH', { discord_user_id: '1125' }))
    const { items: after } = await fetchDto<ListDto<MemberDto>>('/members?workspace_id=ws_01')
    expect(after.find(({ member_id }) => member_id === 'mb_03')).toMatchObject({
      display_name: '이재환',
      discord_user_id: null,
    })
    expect(after.find(({ member_id }) => member_id === 'mb_05')).toMatchObject({
      display_name: '최지훈',
      discord_user_id: '1125',
    })
  })

  it('일반 팀원 설정: ws_01 의 일반 팀원이다. 연동 조회는 되고 연결 쓰기는 403 이다', async () => {
    applyScenario('settings-member')
    await expect(listedWorkspaces()).resolves.toEqual([
      { id: 'ws_01', role: 'member', completed: true },
    ])
    await expect(fetchDto('/workspaces/ws_01/integrations')).resolves.toMatchObject({
      discord: { status: 'not_connected' },
      notion: { status: 'connected' },
    })
    await expect(
      fetchDto('/workspaces/ws_01/integrations/notion', { method: 'DELETE' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 })
  })

  it('팀원 초대: ws_01 PM 이 팀원마다 다른 최근 초대를 본다. 박민수 계정은 수락해 일반 팀원이다', async () => {
    applyScenario('team-invitations')
    const { items } = await fetchDto<ListDto<InvitationDto>>('/workspaces/ws_01/invitations')
    expect(
      items.map(({ invitation_id, member_id, status }) => [invitation_id, member_id, status]),
    ).toEqual([
      ['iv_03', 'mb_04', 'declined'],
      ['iv_02', 'mb_03', 'pending'],
      ['iv_01', 'mb_02', 'accepted'],
      ['iv_00', 'mb_03', 'canceled'],
    ])
    await fetchDto(
      '/auth/login',
      jsonRequest('POST', { email: 'minsu@example.com', password: 'mock-password' }),
    )
    await expect(listedWorkspaces()).resolves.toEqual([
      { id: 'ws_01', role: 'member', completed: true },
    ])
  })

  it('받을 초대: 비로그인이고 jaehwan@example.com 으로 로그인하면 공간 없이 초대 하나를 받는다', async () => {
    applyScenario('invitation-pending')
    await expect(fetchSessionDto()).resolves.toBeNull()
    await fetchDto(
      '/auth/login',
      jsonRequest('POST', { email: 'jaehwan@example.com', password: 'mock-password' }),
    )
    await expect(listedWorkspaces()).resolves.toEqual([])
    await expect(fetchDto<ListDto<MyInvitationDto>>('/invitations/me')).resolves.toMatchObject({
      items: [
        { invitation_id: 'iv_02', workspace_name: '카테캠 3팀', member_display_name: '이재환' },
      ],
    })
  })

  // 시나리오 수의 제곱만큼 적용·비교한다. 시나리오가 늘어 기본 한도(5초)를 넘으므로 한도를 따로 둔다
  it('시나리오끼리 독립적이다 — 앞 시나리오의 변경이 다음 적용에 남지 않는다', async () => {
    for (const first of MOCK_SCENARIOS) {
      applyScenario(first)
      // 앞 시나리오에서 상태를 바꾼다. 메일 미설정 시나리오에서는 가입 코드를 받을 수 없어 먼저 푼다
      db.passwordReset.failure = 'none'
      await signUpVerified({ email: `${first}@example.com`, password: 'pass1234', name: first })
      await fetchDto('/workspaces', jsonRequest('POST', { name: `${first} 팀` }))
      for (const next of MOCK_SCENARIOS) {
        applyScenario(next)
        expect({ first, next, db: structuredClone(db) }).toEqual({
          first,
          next,
          db: createScenarioDb(next),
        })
      }
    }
  }, 30_000)

  it('만들 때마다 새 객체다 — 한 시나리오 값을 고쳐도 다른 값에 번지지 않는다', () => {
    const scenarios = MOCK_SCENARIOS.map((name: MockScenario) => createScenarioDb(name))
    scenarios[0].accounts[0].workspaceIds.push('ws_99')
    scenarios[0].workspaces[0].name = '바뀜'
    expect(createScenarioDb('signed-out')).toEqual(createScenarioDb('signed-out'))
    expect(createScenarioDb('signed-out').accounts[0].workspaceIds).not.toContain('ws_99')
    expect(initialDb().workspaces[0].name).not.toBe('바뀜')
  })
})
