import type {
  DiscordUserDto,
  MemberAliasDto,
  MemberDto,
  UnresolvedAliasDto,
} from '@/shared/types/api/member'
const memberSeeds: [string, string, string | null, string][] = [
  ['mb_01', '김서연', '1123', 'pm'],
  ['mb_02', '박민수', '1124', 'member'],
  ['mb_03', '이재환', null, 'member'],
  ['mb_04', '정하늘', '1126', 'member'],
]
export const memberFixtures: MemberDto[] = memberSeeds.map(
  ([member_id, display_name, discord_user_id, role]) => ({
    member_id,
    workspace_id: 'ws_01',
    display_name,
    discord_user_id,
    notion_name: null,
    role,
    created_at: '2026-09-01T00:00:00Z',
  }),
)
export const discordUserFixtures: DiscordUserDto[] = [
  {
    discord_user_id: '1123',
    username: 'seoyeon_01',
    display_name: '서연',
    avatar_url: null,
    is_bot: false,
  },
  {
    discord_user_id: '1124',
    username: 'minsu',
    display_name: null,
    avatar_url: null,
    is_bot: false,
  },
  {
    discord_user_id: '1125',
    username: 'jihun_dev',
    display_name: '지훈',
    avatar_url: null,
    is_bot: false,
  },
  {
    discord_user_id: '1199',
    username: 'manager_bot',
    display_name: '매니저봇',
    avatar_url: null,
    is_bot: true,
  },
]
export const aliasFixtures: MemberAliasDto[] = [
  {
    alias_id: 'al_01',
    member_id: 'mb_01',
    workspace_id: 'ws_01',
    alias_text: '서연',
    alias_type: 'nickname',
    source: 'manual',
    confidence: 1,
    verified: true,
    created_at: '2026-09-15T00:00:00Z',
  },
]
export const unresolvedAliasFixtures: UnresolvedAliasDto[] = [
  { alias_text: '지훈', occurrences: 3, last_seen_at: '2026-09-15T06:00:00Z' },
]
