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
import { integrationFixtures } from './fixtures/integration'
import { meetingFixtures, meetingSummaryFixtures } from './fixtures/meeting'
import { minutesFixtures } from './fixtures/minutes'

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
  integrations: typeof integrationFixtures
  meetings: typeof meetingFixtures
  meetingSummaries: typeof meetingSummaryFixtures
  minutes: typeof minutesFixtures
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
    integrations: structuredClone(integrationFixtures),
    meetings: structuredClone(meetingFixtures),
    meetingSummaries: structuredClone(meetingSummaryFixtures),
    minutes: structuredClone(minutesFixtures),
  }
}
export const db: MockDb = initialDb()

export function resetDb(): void {
  Object.assign(db, initialDb())
}
