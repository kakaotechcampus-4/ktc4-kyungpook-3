import { fetchDto, fetchSessionDto, jsonRequest, signUpVerified } from '@/shared/test/api'
import type { ListDto } from '@/shared/types/api/envelope'
import type { InvitationDto, MyInvitationDto, UserSummaryDto } from '@/shared/types/api/invitation'
import type { MemberDto } from '@/shared/types/api/member'
import type { WorkspaceDto } from '@/shared/types/api/workspace'
import { db } from './db'
import { applyScenario } from './scenarios'
import { setMockRole } from './sessions'

/*
 * #320 — 팀원 초대 handler 는 백엔드 api/invitations.py 의 검사 순서와 상태 전이를 따른다.
 * 수락한 초대가 계정과 팀원을 잇는다: 소속·역할·세션 팀원이 거기서 나온다.
 * #632 — 초대는 아이디로 찾은 가입자(user_id)에게 간다. team-invitations 의 한도윤(us_05, doyun)은 어느 팀원과도 이어지지 않았다.
 */

const invite = (memberId: string, userId: string) =>
  fetchDto<InvitationDto>(
    '/workspaces/ws_01/invitations',
    jsonRequest('POST', { member_id: memberId, user_id: userId }),
  )
const search = async (q: string) =>
  (
    await fetchDto<{ items: UserSummaryDto[] }>('/users/search', {
      params: { q, workspace_id: 'ws_01' },
    })
  ).items
const pmInvitations = async () =>
  (await fetchDto<ListDto<InvitationDto>>('/workspaces/ws_01/invitations')).items
const myInvitations = async () =>
  (await fetchDto<ListDto<MyInvitationDto>>('/invitations/me')).items
const act = (invitationId: string, action: string) =>
  fetchDto(`/invitations/${invitationId}/${action}`, { method: 'POST' })
const login = (email: string) =>
  fetchDto('/auth/login', jsonRequest('POST', { email, password: 'mock-password' }))
const signup = (email: string) => signUpVerified({ email, password: 'pass1234', name: '다른 사람' })
const listedWorkspaces = async () =>
  (await fetchDto<ListDto<WorkspaceDto>>('/workspaces')).items.map(({ workspace_id, role }) => ({
    id: workspace_id,
    role,
  }))
const statusOf = (invitationId: string) =>
  db.invitations.find(({ invitation_id }) => invitation_id === invitationId)?.status

const doyun = { user_id: 'us_05', username: 'doyun', name: '한도윤' }

describe('초대할 가입자 찾기', () => {
  beforeEach(() => applyScenario('team-invitations'))

  it('아이디가 대소문자와 앞뒤 공백만 빼고 같아야 한 명이 나오고, 이메일은 없다', async () => {
    await expect(search(' DoYun ')).resolves.toEqual([doyun])
    await expect(search('doyu')).resolves.toEqual([])
    await expect(search('한도윤')).resolves.toEqual([])
  })

  it('이 공간의 팀원은 빠지고, 아이디 규칙 밖 값은 오류 없이 빈 목록이다', async () => {
    await expect(search('minsu')).resolves.toEqual([])
    await expect(search('userpm')).resolves.toEqual([])
    await expect(search('do')).resolves.toEqual([])
    await expect(search('doyun!')).resolves.toEqual([])
  })

  it('PM 이 아니면 아이디 형식과 상관없이 403 이다', async () => {
    setMockRole('member')

    for (const q of ['doyun', 'do'])
      await expect(search(q)).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 })
  })
})

describe('초대 만들기', () => {
  it('검사는 백엔드 순서다 — 본문, 사용자, 팀원, 연결, PM, 이미 소속, 다른 팀원의 대기 초대', async () => {
    applyScenario('team-invitations')
    const before = structuredClone(db.invitations)

    await expect(
      fetchDto('/workspaces/ws_01/invitations', jsonRequest('POST', { member_id: 'mb_03' })),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST', status: 400 })
    await expect(invite('mb_99', 'us_99')).rejects.toMatchObject({
      code: 'USER_NOT_FOUND',
      status: 404,
      details: { user_id: 'us_99' },
    })
    await expect(invite('mb_99', 'us_05')).rejects.toMatchObject({
      code: 'MEMBER_NOT_FOUND',
      status: 404,
    })
    // mb_01 은 PM 이면서 픽스처 계정과 이어져 있다. 연결을 먼저 본다
    await expect(invite('mb_01', 'us_05')).rejects.toMatchObject({
      code: 'MEMBER_ALREADY_LINKED',
      status: 409,
    })
    await expect(invite('mb_02', 'us_05')).rejects.toMatchObject({
      code: 'MEMBER_ALREADY_LINKED',
    })
    db.members.find(({ member_id }) => member_id === 'mb_04')!.role = 'pm'
    await expect(invite('mb_04', 'us_05')).rejects.toMatchObject({
      code: 'PM_MEMBER_NOT_INVITABLE',
      status: 409,
    })
    db.members.find(({ member_id }) => member_id === 'mb_04')!.role = 'member'
    for (const userId of ['us_01', 'us_02'])
      await expect(invite('mb_04', userId)).rejects.toMatchObject({
        code: 'ALREADY_WORKSPACE_MEMBER',
        status: 409,
        details: { user_id: userId },
      })
    await expect(invite('mb_04', 'us_03')).rejects.toMatchObject({
      code: 'USER_ALREADY_INVITED',
      status: 409,
      details: { user_id: 'us_03' },
    })
    expect(db.invitations).toEqual(before)
  })

  it('같은 팀원을 다시 초대하면 열린 초대가 취소되고 고른 계정으로 더 최근 초대가 생긴다', async () => {
    applyScenario('team-invitations')

    const created = await invite('mb_03', 'us_05')

    expect(created).toMatchObject({
      member_id: 'mb_03',
      member_display_name: '이재환',
      invited_user: doyun,
      status: 'pending',
      invited_by_name: '최진호',
      accepted_user: null,
    })
    expect(created).not.toHaveProperty('email')
    expect(statusOf('iv_02')).toBe('canceled')
    const [newest] = await pmInvitations()
    expect(newest.invitation_id).toBe(created.invitation_id)
    expect(
      (await pmInvitations()).filter(
        ({ member_id, status }) => member_id === 'mb_03' && status === 'pending',
      ),
    ).toHaveLength(1)
  })

  it('PM 이 아니면 사용자가 없어도 403 이고 목록도 볼 수 없다', async () => {
    applyScenario('team-invitations')
    setMockRole('member')

    for (const userId of ['us_05', 'us_99'])
      await expect(invite('mb_04', userId)).rejects.toMatchObject({
        code: 'FORBIDDEN',
        status: 403,
      })
    await expect(pmInvitations()).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 })
  })
})

describe('취소와 연결 끊기', () => {
  it('대기 초대만 취소한다. 없는 초대는 404 다', async () => {
    applyScenario('team-invitations')

    await expect(act('iv_02', 'cancel')).resolves.toMatchObject({ status: 'canceled' })
    await expect(act('iv_02', 'cancel')).rejects.toMatchObject({
      code: 'INVITATION_NOT_PENDING',
      status: 409,
    })
    await expect(act('iv_99', 'cancel')).rejects.toMatchObject({
      code: 'INVITATION_NOT_FOUND',
      status: 404,
    })
  })

  it('끊으면 수락한 계정이 공간을 잃고 그 계정의 대기 초대도 닫힌다. 수락한 계정은 응답에 남는다', async () => {
    applyScenario('team-invitations')
    db.invitations.push({
      ...structuredClone(db.invitations.find(({ invitation_id }) => invitation_id === 'iv_03')!),
      invitation_id: 'iv_04',
      invited_user_id: 'us_02',
      status: 'pending',
      responded_at: null,
    })

    await expect(act('iv_03', 'revoke')).rejects.toMatchObject({
      code: 'INVITATION_NOT_ACCEPTED',
      status: 409,
    })
    await expect(act('iv_01', 'revoke')).resolves.toMatchObject({
      status: 'revoked',
      accepted_user: { user_id: 'us_02', name: '박민수', email: 'minsu@example.com' },
    })
    expect(statusOf('iv_04')).toBe('canceled')

    await login('minsu@example.com')
    await expect(listedWorkspaces()).resolves.toEqual([])
  })

  it('이어진 다른 PM 이 없으면 PM 팀원의 연결을 끊지 못한다', async () => {
    applyScenario('team-invitations')
    db.members.find(({ member_id }) => member_id === 'mb_02')!.role = 'pm'
    db.members.find(({ member_id }) => member_id === 'mb_01')!.role = 'member'

    await expect(act('iv_01', 'revoke')).rejects.toMatchObject({
      code: 'LAST_PM_REQUIRED',
      status: 409,
    })
    expect(statusOf('iv_01')).toBe('accepted')
  })

  it('대기 초대가 있는 팀원은 PM 으로 올리지 못하고 아무것도 바뀌지 않는다', async () => {
    applyScenario('team-invitations')
    const before = structuredClone(db.members)

    await expect(
      fetchDto('/members/mb_03', jsonRequest('PATCH', { role: 'pm', display_name: '바뀜' })),
    ).rejects.toMatchObject({ code: 'MEMBER_HAS_PENDING_INVITATION', status: 409 })
    expect(db.members).toEqual(before)
    await expect(
      fetchDto<MemberDto>('/members/mb_04', jsonRequest('PATCH', { role: 'pm' })),
    ).resolves.toMatchObject({ role: 'pm' })
  })
})

describe('받은 초대', () => {
  it('초대는 계정에 묶여 이메일이 없어도 내 초대로 보인다', async () => {
    applyScenario('invitation-pending')
    await login('jaehwan@example.com')
    db.session.user.email = null

    await expect(myInvitations()).resolves.toEqual([
      {
        invitation_id: 'iv_02',
        workspace_id: 'ws_01',
        workspace_name: '카테캠 3팀',
        member_display_name: '이재환',
        invited_by_name: '최진호',
        created_at: '2026-09-16T09:00:00Z',
      },
    ])
  })

  it('수락하면 그 공간의 일반 팀원이 된다. PM 쓰기는 403 이고 픽스처 PM 의 역할은 그대로다', async () => {
    applyScenario('invitation-pending')
    await login('jaehwan@example.com')

    await expect(act('iv_02', 'accept')).resolves.toEqual({
      workspace_id: 'ws_01',
      member_id: 'mb_03',
    })

    await expect(listedWorkspaces()).resolves.toEqual([{ id: 'ws_01', role: 'member' }])
    await expect(myInvitations()).resolves.toEqual([])
    await expect(fetchSessionDto()).resolves.toMatchObject({ last_workspace_id: null })
    await expect(
      fetchDto('/members/mb_04', jsonRequest('PATCH', { display_name: '바뀜' })),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 })
    await expect(act('iv_02', 'accept')).rejects.toMatchObject({
      code: 'INVITATION_NOT_PENDING',
      status: 409,
    })

    await login('pm@example.com')
    await expect(listedWorkspaces()).resolves.toEqual([
      { id: 'ws_02', role: 'member' },
      { id: 'ws_01', role: 'pm' },
    ])
    expect(
      (await pmInvitations()).find(({ invitation_id }) => invitation_id === 'iv_02'),
    ).toMatchObject({
      status: 'accepted',
      accepted_user: { name: '이재환', email: 'jaehwan@example.com' },
    })
  })

  it('수락하면 인증 응답의 소속 수가 수락한 공간을 센다. 다시 로그인해도 같다', async () => {
    applyScenario('invitation-pending')
    await expect(login('jaehwan@example.com')).resolves.toMatchObject({ workspace_count: 0 })

    await act('iv_02', 'accept')

    await expect(fetchSessionDto()).resolves.toMatchObject({ workspace_count: 1 })
    await fetchDto('/auth/logout', { method: 'POST' })
    await expect(
      fetchDto(
        '/auth/login',
        jsonRequest('POST', { email: 'jaehwan@example.com', password: 'mock-password' }),
      ),
    ).resolves.toMatchObject({ workspace_count: 1 })
  })

  it('이미 그 공간 팀원이면 수락이 409 이고 초대는 대기로 남는다', async () => {
    applyScenario('invitation-pending')
    db.invitations[0].invited_user_id = 'us_01'
    await login('pm@example.com')

    await expect(act('iv_02', 'accept')).rejects.toMatchObject({
      code: 'ALREADY_WORKSPACE_MEMBER',
      status: 409,
    })
    expect(statusOf('iv_02')).toBe('pending')
  })

  it('거절하면 내 초대에서 빠진다. 나에게 온 초대가 아니면 있는지도 알리지 않는다', async () => {
    applyScenario('invitation-pending')
    await signup('other@example.com')
    await expect(act('iv_02', 'decline')).rejects.toMatchObject({
      code: 'INVITATION_NOT_FOUND',
      status: 404,
    })
    await expect(act('iv_02', 'accept')).rejects.toMatchObject({
      code: 'INVITATION_NOT_FOUND',
      status: 404,
    })

    await login('jaehwan@example.com')
    await expect(act('iv_02', 'decline')).resolves.toEqual({
      invitation_id: 'iv_02',
      status: 'declined',
    })
    await expect(myInvitations()).resolves.toEqual([])
  })
})
