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
    has_login_account: member_id === 'mb_01',
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

const alias = (
  alias_id: string,
  member_id: string,
  alias_text: string,
  rest: Pick<MemberAliasDto, 'alias_type' | 'source' | 'confidence' | 'verified' | 'created_at'>,
): MemberAliasDto => ({ alias_id, member_id, workspace_id: 'ws_01', alias_text, ...rest })

/* 백엔드가 팀원을 만들 때 채우는 이름 별칭(이름 전체와 성을 뗀 이름, 확인됨). 이미 같은 글자가 있으면 건너뛴다(services/member_aliases.py) */
const nameAlias = (alias_id: string, member_id: string, alias_text: string) =>
  alias(alias_id, member_id, alias_text, {
    alias_type: 'realname',
    source: 'display_name',
    confidence: 1,
    verified: true,
    created_at: '2026-09-01T00:00:00Z',
  })

/* 네 출처가 모두 보이게 둔다. '지훈' 은 아무에게도 주지 않는다 — 미해결 별칭과 승인 카드의 별칭 후보가 그 이름을 쓴다 */
export const aliasFixtures: MemberAliasDto[] = [
  alias('al_01', 'mb_01', '서연', {
    alias_type: 'nickname',
    source: 'manual',
    confidence: 1,
    verified: true,
    created_at: '2026-09-15T00:00:00Z',
  }),
  nameAlias('al_02', 'mb_01', '김서연'),
  nameAlias('al_03', 'mb_02', '박민수'),
  nameAlias('al_04', 'mb_02', '민수'),
  nameAlias('al_05', 'mb_03', '이재환'),
  nameAlias('al_06', 'mb_03', '재환'),
  nameAlias('al_07', 'mb_04', '정하늘'),
  nameAlias('al_08', 'mb_04', '하늘'),
  // Discord 서버 닉네임에서 온 별칭은 확인 전이다
  alias('al_09', 'mb_04', '하늘이', {
    alias_type: 'nickname',
    source: 'discord_profile',
    confidence: 0.8,
    verified: false,
    created_at: '2026-09-02T00:00:00Z',
  }),
  // 회의 전사가 '재환' 을 잘못 들은 표기를 승인에서 배웠다
  alias('al_10', 'mb_03', '재한', {
    alias_type: 'nickname',
    source: 'learned',
    confidence: 0.9,
    verified: true,
    created_at: '2026-09-16T00:00:00Z',
  }),
]
export const unresolvedAliasFixtures: UnresolvedAliasDto[] = [
  { alias_text: '지훈', occurrences: 3, last_seen_at: '2026-09-15T06:00:00Z' },
]
