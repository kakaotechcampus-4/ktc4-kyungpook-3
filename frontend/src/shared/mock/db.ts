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
import { extractionFixtures } from './fixtures/extraction'
import { taskFixtures, taskHistoryFixtures } from './fixtures/task'
import { approvalFixtures } from './fixtures/approval'

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
  extractions: typeof extractionFixtures
  tasks: typeof taskFixtures
  taskHistory: typeof taskHistoryFixtures
  approvals: typeof approvalFixtures
}
/** Vitest 가 테스트마다 돌아가는 상태다. 로그인돼 있고 ws_01·ws_02 에 속한다. 브라우저 시작 상태는 scenarios.ts 가 정한다 */
export function initialDb(): MockDb {
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
    extractions: structuredClone(extractionFixtures),
    tasks: structuredClone(taskFixtures),
    taskHistory: structuredClone(taskHistoryFixtures),
    approvals: structuredClone(approvalFixtures),
  }
}
export const db: MockDb = initialDb()

export function resetDb(): void {
  Object.assign(db, initialDb())
}

/** 통째로 바꾼다. 시나리오 적용과 sessionStorage 복원이 쓴다. `db` 참조는 그대로라 handler 가 새 값을 본다 */
export function replaceDb(next: MockDb): void {
  Object.assign(db, next)
}
