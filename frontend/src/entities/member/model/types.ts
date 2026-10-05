import type { Role } from '@/shared/types/common'
export interface Member {
  id: string
  workspaceId: string
  displayName: string
  discordUserId: string | null
  notionName: string | null
  role: Role
  createdAt: string
}
export type AliasType = 'realname' | 'nickname' | 'mention' | 'inferred'
export type AliasSource = 'manual' | 'discord_profile' | 'learned'
export interface MemberAlias {
  id: string
  memberId: string
  workspaceId: string
  text: string
  type: AliasType
  source: AliasSource
  confidence: number
  verified: boolean
  createdAt: string
}
export interface UnresolvedAlias {
  text: string
  occurrences: number
  lastSeenAt: string
}
export interface DiscordUser {
  discordUserId: string
  username: string
  displayName: string | null
  avatarUrl: string | null
  isBot: boolean
}
/** 팀원 생성 요청. role 을 빼면 member 다 */
export interface CreateMemberInput {
  workspaceId: string
  displayName: string
  discordUserId?: string | null
  notionName?: string | null
  role?: Role
}
/** 팀원 수정 요청. 넣은 필드만 보낸다. discordUserId·notionName 은 null 로 지운다 */
export interface UpdateMemberInput {
  displayName?: string
  discordUserId?: string | null
  notionName?: string | null
  role?: Role
}
