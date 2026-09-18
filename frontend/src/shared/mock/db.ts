import type { SessionDto } from '@/shared/types/api/auth'
import type { MemberAliasDto, MemberDto } from '@/shared/types/api/member'
import type { WorkspaceDto } from '@/shared/types/api/workspace'
import { sessionFixture } from './fixtures/auth'
import {
  aliasFixtures,
  discordUserFixtures,
  memberFixtures,
  unresolvedAliasFixtures,
} from './fixtures/member'
import { workspaceFixtures } from './fixtures/workspace'

interface MockAccount {
  session: SessionDto
  password: string
  workspaceIds: string[]
}
export interface MockDb {
  session: SessionDto
  authenticated: boolean
  accounts: MockAccount[]
  workspaces: WorkspaceDto[]
  members: MemberDto[]
  aliases: MemberAliasDto[]
  unresolvedAliases: typeof unresolvedAliasFixtures
  discordUsers: typeof discordUserFixtures
}
function initialDb(): MockDb {
  return {
    session: structuredClone(sessionFixture),
    authenticated: true,
    accounts: [
      {
        session: structuredClone(sessionFixture),
        password: 'mock-password',
        workspaceIds: ['ws_01', 'ws_02'],
      },
    ],
    workspaces: structuredClone(workspaceFixtures),
    members: structuredClone(memberFixtures),
    aliases: structuredClone(aliasFixtures),
    unresolvedAliases: structuredClone(unresolvedAliasFixtures),
    discordUsers: structuredClone(discordUserFixtures),
  }
}
export const db: MockDb = initialDb()

export function resetDb(): void {
  Object.assign(db, initialDb())
}
