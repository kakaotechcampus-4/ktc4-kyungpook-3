import { z } from 'zod'

/*
 * 팀원 응답 스키마 (backend app/schemas/member.py, 계약 §4.4). FE 가 읽는 필드만 본다. 타입은 이 스키마에서 만든다 (#348)
 */

export const memberSchema = z.object({
  member_id: z.string(),
  workspace_id: z.string(),
  display_name: z.string(),
  discord_user_id: z.string().nullable(),
  notion_name: z.string().nullable(),
  // 모르는 값은 mapper 가 `member` 로 내린다(보수 폴백). PM 권한을 짐작해 주지 않는다
  role: z.string(),
  has_login_account: z.boolean(),
  created_at: z.string(),
})
export type MemberDto = z.infer<typeof memberSchema>

export const memberListSchema = z.object({ items: z.array(memberSchema) })

export const memberAliasSchema = z.object({
  alias_id: z.string(),
  member_id: z.string(),
  workspace_id: z.string(),
  alias_text: z.string(),
  // 표시용 분류다. 모르는 값은 mapper 가 받은 값을 남기고 화면은 `알 수 없는 출처` 로 읽는다
  source: z.string(),
  confidence: z.number(),
  verified: z.boolean(),
  created_at: z.string(),
})
export type MemberAliasDto = z.infer<typeof memberAliasSchema>

export const memberAliasListSchema = z.object({ items: z.array(memberAliasSchema) })

export const discordUserSchema = z.object({
  discord_user_id: z.string(),
  username: z.string(),
  display_name: z.string().nullable(),
  avatar_url: z.string().nullable(),
  is_bot: z.boolean(),
})
export type DiscordUserDto = z.infer<typeof discordUserSchema>

export const discordUserListSchema = z.object({ items: z.array(discordUserSchema) })

/** 백엔드 MemberCreateRequest. role 을 빼면 member 다 */
export interface MemberCreateDto {
  workspace_id: string
  display_name: string
  discord_user_id?: string | null
  notion_name?: string | null
  role?: 'pm' | 'member'
}
/** 백엔드 MemberUpdateRequest. 보낸 키만 바뀐다. discord_user_id·notion_name 은 null 로 지울 수 있다 */
export interface MemberUpdateDto {
  display_name?: string
  discord_user_id?: string | null
  notion_name?: string | null
  role?: 'pm' | 'member'
}
