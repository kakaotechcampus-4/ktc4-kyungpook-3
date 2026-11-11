import { displayValue, fallbackValue } from '@/shared/api/unknownValue'
import type { DiscordUserDto, MemberAliasDto, MemberDto } from '@/shared/types/api/member'
import { ALIAS_SOURCES } from './types'
import type { DiscordUser, Member, MemberAlias } from './types'

export function toMember(dto: MemberDto): Member {
  return {
    id: dto.member_id,
    workspaceId: dto.workspace_id,
    displayName: dto.display_name,
    discordUserId: dto.discord_user_id,
    notionName: dto.notion_name,
    role: fallbackValue(dto.role, ['pm', 'member'], 'member', 'member role'),
    hasLoginAccount: dto.has_login_account,
    createdAt: dto.created_at,
  }
}
export function toMemberAlias(dto: MemberAliasDto): MemberAlias {
  return {
    id: dto.alias_id,
    memberId: dto.member_id,
    workspaceId: dto.workspace_id,
    text: dto.alias_text,
    source: displayValue(dto.source, ALIAS_SOURCES, 'alias source'),
    confidence: dto.confidence,
    verified: dto.verified,
    createdAt: dto.created_at,
  }
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
