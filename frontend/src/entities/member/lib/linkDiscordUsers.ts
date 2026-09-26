import type { DiscordUser, Member } from '../model/types'
export type MemberLinkKind = 'linked' | 'unlinked' | 'inactive'
export interface MemberLink {
  kind: MemberLinkKind
  discordUser: DiscordUser | null
  member: Member | null
  label: string
}
export function linkDiscordUsers(discordUsers: DiscordUser[], members: Member[]): MemberLink[] {
  const linked = new Map(
    members
      .filter((member) => member.discordUserId !== null)
      .map((member) => [member.discordUserId, member]),
  )
  const active = discordUsers.filter((user) => !user.isBot)
  const rows = active.map((discordUser) => {
    const member = linked.get(discordUser.discordUserId) ?? null
    return {
      kind: member ? ('linked' as const) : ('unlinked' as const),
      discordUser,
      member,
      label: member?.displayName ?? discordUser.username,
    }
  })
  const ids = new Set(active.map(({ discordUserId }) => discordUserId))
  return [
    ...rows,
    ...members
      .filter((member) => member.discordUserId !== null && !ids.has(member.discordUserId))
      .map((member) => ({
        kind: 'inactive' as const,
        discordUser: null,
        member,
        label: member.displayName,
      })),
  ]
}
