import type {
  DiscordUserDto,
  MemberAliasDto,
  MemberDto,
  UnresolvedAliasDto,
} from '@/shared/types/api/member'
import type {
  AliasSource,
  AliasType,
  DiscordUser,
  Member,
  MemberAlias,
  UnresolvedAlias,
} from './types'
const aliasTypes: AliasType[] = ['realname', 'nickname', 'mention', 'inferred']
const sources: AliasSource[] = ['manual', 'discord_profile', 'learned']
function warnUnknown(field: string, value: string): void {
  if (import.meta.env.DEV) console.warn(`Unknown ${field}: ${value}`)
}
export function toMember(dto: MemberDto): Member {
  if (dto.role !== 'pm' && dto.role !== 'member') warnUnknown('member role', dto.role)
  return {
    id: dto.member_id,
    workspaceId: dto.workspace_id,
    displayName: dto.display_name,
    discordUserId: dto.discord_user_id,
    notionName: dto.notion_name,
    role: dto.role === 'pm' ? 'pm' : 'member',
    createdAt: dto.created_at,
  }
}
export function toMemberAlias(dto: MemberAliasDto): MemberAlias {
  const type = aliasTypes.includes(dto.alias_type as AliasType)
    ? (dto.alias_type as AliasType)
    : (warnUnknown('alias type', dto.alias_type), 'nickname')
  const source = sources.includes(dto.source as AliasSource)
    ? (dto.source as AliasSource)
    : (warnUnknown('alias source', dto.source), 'manual')
  return {
    id: dto.alias_id,
    memberId: dto.member_id,
    workspaceId: dto.workspace_id,
    text: dto.alias_text,
    type,
    source,
    confidence: dto.confidence,
    verified: dto.verified,
    createdAt: dto.created_at,
  }
}
export function toUnresolvedAlias(dto: UnresolvedAliasDto): UnresolvedAlias {
  return { text: dto.alias_text, occurrences: dto.occurrences, lastSeenAt: dto.last_seen_at }
}
export function toDiscordUser(dto: DiscordUserDto): DiscordUser {
  return {
    discordUserId: dto.discord_user_id,
    username: dto.username,
    displayName: dto.display_name,
    avatarUrl: dto.avatar_url,
    isBot: dto.is_bot,
  }
}
