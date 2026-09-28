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
