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
