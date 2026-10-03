import { recordRequestBodies } from '@/shared/test/requests'
import { createMember, updateMember } from './memberMutations'

describe('createMember', () => {
  it('Member 로 돌려주고 MemberCreateRequest 모양으로 보낸다', async () => {
    const bodies = recordRequestBodies('POST', '/members')
    await expect(
      createMember({ workspaceId: 'ws_01', displayName: '새 팀원', discordUserId: '1125' }),
    ).resolves.toMatchObject({
      workspaceId: 'ws_01',
      displayName: '새 팀원',
      discordUserId: '1125',
      role: 'member',
    })
    await vi.waitFor(() =>
      expect(bodies).toEqual([
        { workspace_id: 'ws_01', display_name: '새 팀원', discord_user_id: '1125' },
      ]),
    )
  })

  it('이미 연결된 Discord 사용자는 409 DISCORD_USER_ALREADY_MAPPED 로 던진다', async () => {
    await expect(
      createMember({ workspaceId: 'ws_01', displayName: '중복', discordUserId: '1123' }),
    ).rejects.toMatchObject({ status: 409, code: 'DISCORD_USER_ALREADY_MAPPED' })
  })
})

describe('updateMember', () => {
  it('넣은 필드만 보낸다 — null 은 연결 해제다', async () => {
    const bodies = recordRequestBodies('PATCH', '/members/mb_01')
    await expect(updateMember('mb_01', { discordUserId: null })).resolves.toMatchObject({
      id: 'mb_01',
      discordUserId: null,
      displayName: '김서연',
    })
    await vi.waitFor(() => expect(bodies).toEqual([{ discord_user_id: null }]))
  })

  it('이름과 Discord 사용자를 함께 바꾼다', async () => {
    await expect(
      updateMember('mb_03', { displayName: '이재환2', discordUserId: '1125' }),
    ).resolves.toMatchObject({ displayName: '이재환2', discordUserId: '1125' })
  })

  it('없는 팀원은 404 로 던진다', async () => {
    await expect(updateMember('mb_99', { displayName: 'x' })).rejects.toMatchObject({
      status: 404,
      code: 'MEMBER_NOT_FOUND',
    })
  })
})
