import { applyScenario } from '@/shared/mock/scenarios'
import { fetchDto, signUpVerified } from '@/shared/test/api'
import { invitationListSchema, invitationSchema, myInvitationListSchema } from './invitation'

const valid = {
  invitation_id: 'iv_01',
  member_id: 'mb_03',
  email: 'jaehwan@example.com',
  status: 'pending',
  accepted_user: null,
  created_at: '2026-09-10T00:00:00Z',
}

describe('초대 스키마', () => {
  it('모르는 초대 상태는 취소로 바꾸지 않고 읽지 않는다', () => {
    expect(invitationSchema.safeParse({ ...valid, status: 'expired' }).success).toBe(false)
  })

  it('목록 한 건만 틀려도 전체를 읽지 않는다', () => {
    const result = invitationListSchema.safeParse({
      items: [valid, { ...valid, invitation_id: 'iv_02', accepted_user: { user_id: 'us_02' } }],
    })
    expect(result.error?.issues[0]?.path).toEqual(['items', 1, 'accepted_user', 'name'])
  })
})

describe('MSW handler 응답이 같은 스키마를 따른다', () => {
  it('team-invitations 상태의 PM 초대 목록', async () => {
    applyScenario('team-invitations')
    const { items } = invitationListSchema.parse(await fetchDto('/workspaces/ws_01/invitations'))
    expect(items.length).toBeGreaterThan(0)
  })

  it('invitation-pending 상태의 받을 초대', async () => {
    applyScenario('invitation-pending')
    await signUpVerified({ email: 'jaehwan@example.com', password: 'pass1234', name: '이재환' })
    const { items } = myInvitationListSchema.parse(await fetchDto('/invitations/me'))
    expect(items).toHaveLength(1)
  })
})
