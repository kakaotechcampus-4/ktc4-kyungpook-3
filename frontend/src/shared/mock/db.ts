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

/**
 * 처리 중 회의를 상세 조회(`GET /meetings/{id}`)가 어떻게 진행시키는가. 진행 규칙은 meetingFlow.ts 에 있다.
 * - `manual`: 저절로 바뀌지 않는다. 테스트가 `advanceMeeting` 등으로 직접 바꾼다 — Vitest 와 기존 시나리오의 기본값
 * - `staged`: 조회마다 한 단계(`audio_merged` → `transcribed` → `extracted` → `done`). 브라우저 데모용
 * - `instant`: 첫 조회에 바로 `done`. 인위적 지연이 없다 — E2E 용
 * - `fail`: 첫 조회에 `failed`
 * - `fail-notion-revoked`: 첫 조회에 `failed`, 그 공간의 Notion 연동이 `revoked` 가 된다 (D-099, D-100)
 */
export type MeetingFlowMode = 'manual' | 'staged' | 'instant' | 'fail' | 'fail-notion-revoked'

export const MEETING_FLOW_MODES = [
  'manual',
  'staged',
  'instant',
  'fail',
  'fail-notion-revoked',
] as const satisfies readonly MeetingFlowMode[]

export interface MeetingFlowState {
  mode: MeetingFlowMode
  /** 업로드가 받은 참석자 ID. 실 API 는 받고 버린다(계약 §4.0-②-9). 정리 결과의 참석자·발화자가 된다 */
  attendees: Record<string, string[]>
}

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
  /** 회의 정리 흐름. 원본 파일은 담지 않는다 — 생성 결과는 위의 meetings·minutes·extractions·tasks·approvals 에 들어간다 */
  meetingFlow: MeetingFlowState
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
    meetingFlow: { mode: 'manual', attendees: {} },
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
