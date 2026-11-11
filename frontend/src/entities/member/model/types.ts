import type { UnknownValue } from '@/shared/api/unknownValue'
import type { Role } from '@/shared/types/common'
export interface Member {
  id: string
  workspaceId: string
  displayName: string
  discordUserId: string | null
  notionName: string | null
  role: Role
  hasLoginAccount: boolean
  createdAt: string
}
export const ALIAS_SOURCES = ['manual', 'discord_profile', 'learned', 'display_name'] as const
export type AliasSource = (typeof ALIAS_SOURCES)[number]
export interface MemberAlias {
  id: string
  memberId: string
  workspaceId: string
  text: string
  /** 표시용 분류다. 모르는 출처는 받은 값을 남긴다 */
  source: AliasSource | UnknownValue
  confidence: number
  verified: boolean
  createdAt: string
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
