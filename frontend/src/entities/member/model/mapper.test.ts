import { toDiscordUser, toMember } from './mapper'

it('maps member and discord null leaves', () => {
  expect(
    toMember({
      member_id: 'mb_01',
      workspace_id: 'ws_01',
      display_name: '김서연',
      discord_user_id: null,
      notion_name: null,
      role: 'pm',
      created_at: '2026-09-01T00:00:00Z',
    }),
  ).toMatchObject({ id: 'mb_01', discordUserId: null })
  expect(
    toDiscordUser({
      discord_user_id: '1125',
      username: 'jihun_dev',
      display_name: null,
      avatar_url: null,
      is_bot: false,
    }),
  ).toMatchObject({ displayName: null })
})

it('maps aliases and falls back unknown unions without throwing', async () => {
  const { toMemberAlias } = await import('./mapper')
  expect(
    toMemberAlias({
      alias_id: 'al',
      member_id: 'mb',
      workspace_id: 'ws',
      alias_text: '별명',
      alias_type: 'new',
      source: 'new',
      confidence: 0.2,
      verified: false,
      created_at: '',
    }),
  ).toMatchObject({ type: 'nickname', source: 'manual', verified: false })
})
