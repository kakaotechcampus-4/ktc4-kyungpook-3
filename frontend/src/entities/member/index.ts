export type {
  AliasSource,
  AliasType,
  DiscordUser,
  Member,
  MemberAlias,
  UnresolvedAlias,
} from './model/types'
export { toDiscordUser, toMember, toMemberAlias, toUnresolvedAlias } from './model/mapper'
export type { MemberLink, MemberLinkKind } from './lib/linkDiscordUsers'
export { linkDiscordUsers } from './lib/linkDiscordUsers'
