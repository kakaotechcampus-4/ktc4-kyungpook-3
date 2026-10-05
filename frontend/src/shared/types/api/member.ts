export interface MemberDto {
  member_id: string
  workspace_id: string
  display_name: string
  discord_user_id: string | null
  notion_name: string | null
  role: string
  created_at: string
}
export interface MemberAliasDto {
  alias_id: string
  member_id: string
  workspace_id: string
  alias_text: string
  alias_type: string
  source: string
  confidence: number
  verified: boolean
  created_at: string
}
export interface UnresolvedAliasDto {
  alias_text: string
  occurrences: number
  last_seen_at: string
}
export interface DiscordUserDto {
  discord_user_id: string
  username: string
  display_name: string | null
  avatar_url: string | null
  is_bot: boolean
}
// 백엔드 MemberCreateRequest. role 을 빼면 member 다
export interface MemberCreateDto {
  workspace_id: string
  display_name: string
  discord_user_id?: string | null
  notion_name?: string | null
  role?: 'pm' | 'member'
}
// 백엔드 MemberUpdateRequest. 보낸 키만 바뀐다. discord_user_id·notion_name 은 null 로 지울 수 있다
export interface MemberUpdateDto {
  display_name?: string
  discord_user_id?: string | null
  notion_name?: string | null
  role?: 'pm' | 'member'
}
