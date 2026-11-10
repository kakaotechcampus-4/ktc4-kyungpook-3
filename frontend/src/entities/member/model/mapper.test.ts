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
      has_login_account: true,
      created_at: '2026-09-01T00:00:00Z',
    }),
  ).toMatchObject({ id: 'mb_01', discordUserId: null, hasLoginAccount: true })
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

it('keeps an unknown alias source as received instead of calling it manual (#348)', async () => {
  const { toMemberAlias } = await import('./mapper')
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  expect(
    toMemberAlias({
      alias_id: 'al',
      member_id: 'mb',
      workspace_id: 'ws',
      alias_text: '별명',
      source: 'new',
      confidence: 0.2,
      verified: false,
      created_at: '',
    }),
  ).toMatchObject({ source: { unknown: 'new' }, verified: false })
  expect(warn).toHaveBeenCalledWith('Unknown alias source: new')
  warn.mockRestore()
})

it('keeps the server-only display_name source as itself', async () => {
  const { toMemberAlias } = await import('./mapper')
  expect(
    toMemberAlias({
      alias_id: 'al',
      member_id: 'mb',
      workspace_id: 'ws',
      alias_text: '김서연',
      source: 'display_name',
      confidence: 1,
      verified: true,
      created_at: '',
    }),
  ).toMatchObject({ source: 'display_name' })
})
