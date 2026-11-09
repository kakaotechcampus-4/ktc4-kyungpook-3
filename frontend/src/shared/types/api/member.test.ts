import { aliasFixtures, discordUserFixtures, memberFixtures } from '@/shared/mock/fixtures/member'
import { applyScenario } from '@/shared/mock/scenarios'
import { fetchDto } from '@/shared/test/api'
import {
  discordUserListSchema,
  memberAliasListSchema,
  memberAliasSchema,
  memberListSchema,
  memberSchema,
} from './member'

const valid = {
  member_id: 'mb_01',
  workspace_id: 'ws_01',
  display_name: '김서연',
  discord_user_id: '1123',
  notion_name: null,
  role: 'pm',
  has_login_account: true,
  created_at: '2026-09-01T00:00:00Z',
}

describe('팀원 스키마', () => {
  it('모르는 역할과 별칭 출처는 거절하지 않는다. mapper 가 팀원·알 수 없는 출처로 읽는다', () => {
    expect(memberSchema.safeParse({ ...valid, role: 'owner' }).success).toBe(true)
    expect(memberAliasSchema.safeParse({ ...aliasFixtures[0], source: 'import' }).success).toBe(
      true,
    )
  })

  it.each([
    ['로그인 계정 여부 누락', { has_login_account: undefined }],
    ['숫자 이름', { display_name: 3 }],
  ])('%s 는 읽지 않는다', (_, patch) => {
    expect(memberSchema.safeParse({ ...valid, ...patch }).success).toBe(false)
  })

  it('목록 한 건만 틀려도 전체를 읽지 않는다', () => {
    const result = memberListSchema.safeParse({ items: [valid, { ...valid, role: undefined }] })
    expect(result.error?.issues[0]?.path).toEqual(['items', 1, 'role'])
  })
})

describe('MSW handler 응답이 같은 스키마를 따른다', () => {
  it('팀원·별칭·Discord 사용자 픽스처', () => {
    for (const fixture of memberFixtures) memberSchema.parse(fixture)
    for (const fixture of aliasFixtures) memberAliasSchema.parse(fixture)
    discordUserListSchema.parse({ items: discordUserFixtures })
  })

  it('settings-unmapped 상태의 팀원·별칭·Discord 사용자 목록', async () => {
    applyScenario('settings-unmapped')
    const { items } = memberListSchema.parse(await fetchDto('/members?workspace_id=ws_01'))
    expect(items.length).toBeGreaterThan(0)
    memberAliasListSchema.parse(await fetchDto('/members/aliases?workspace_id=ws_01'))
    discordUserListSchema.parse(await fetchDto('/workspaces/ws_01/discord/members'))
  })
})
