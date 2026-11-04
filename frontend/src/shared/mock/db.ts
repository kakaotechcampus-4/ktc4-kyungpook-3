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
import { messageBundleFixtures, messageThreadFixtures } from './fixtures/message'
import type { MockNotification, MockPushSubscription } from './fixtures/notification'

/**
 * 처리 중 회의를 상세 조회(`GET /meetings/{id}`)가 어떻게 진행시키는가. 진행 규칙은 meetingFlow.ts 에 있다.
 * - `manual`: 저절로 바뀌지 않는다. 테스트가 `advanceMeeting` 등으로 직접 바꾼다 — Vitest 와 기존 시나리오의 기본값
 * - `staged`: 조회마다 한 단계(`audio_merged` → `transcribed` → `extracted` → `done`). 브라우저 데모용
 * - `instant`: 첫 조회에 바로 `done`. 인위적 지연이 없다 — E2E 용
 * - `fail`: 첫 조회에 `failed`
 * - `fail-notion-revoked`: 첫 조회에 `failed`, 그 공간의 Notion 연동이 `revoked` 가 된다 (D-099, D-100)
 */
export type MeetingFlowMode =
  'manual' | 'staged' | 'instant' | 'fail' | 'fail-notion-revoked' | 'fail-diarize' | 'fail-expired'

export const MEETING_FLOW_MODES = [
  'manual',
  'staged',
  'instant',
  'fail',
  'fail-notion-revoked',
  'fail-diarize',
  'fail-expired',
] as const satisfies readonly MeetingFlowMode[]

export interface MeetingFlowState {
  mode: MeetingFlowMode
  /** 업로드가 받은 참석자 ID. 실 API 는 받고 버린다(계약 §4.0-②-9). 정리 결과의 참석자·발화자가 된다 */
  attendees: Record<string, string[]>
}

/**
 * 메시지 요청을 일부러 실패(5xx)시킨다 — 계획 C-7 의 오류 시나리오. `inbox` 는 목록, `threadIds` 는 그 대화만,
 * `actions` 는 승인·보내지 않음·문구·시각 고치기·답장이다(db 는 바뀌지 않는다)
 */
export interface MessageFailures {
  inbox: boolean
  threadIds: string[]
  actions: boolean
}

/**
 * 팀원 초대. 백엔드 invitations 표 모양으로 두고 이름은 응답할 때 붙인다 — 수락한 계정 이름이 끊긴 뒤에도 남는다.
 * 수락한 초대가 곧 계정과 팀원의 연결이다(백엔드 member.user_id). 소속·역할은 sessions.ts 가 여기서 읽는다
 */
export interface MockInvitation {
  invitation_id: string
  workspace_id: string
  member_id: string
  /** 앞뒤 공백을 빼고 소문자로 바꾼 값 */
  email: string
  status: 'pending' | 'accepted' | 'declined' | 'canceled' | 'revoked'
  invited_by_user_id: string | null
  accepted_user_id: string | null
  created_at: string
  responded_at: string | null
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
  /** M8 메시지 (계약 §5.7). 보낼 메시지(묶음)와 대화는 공간별이다 */
  messageBundles: typeof messageBundleFixtures
  messageThreads: typeof messageThreadFixtures
  messageFailures: MessageFailures
  /** #330 알림. 받는 팀원별 행이다 */
  notifications: MockNotification[]
  /** #330 브라우저 푸시. 공개키가 null 이면 서버에 키가 없는 것이다 */
  push: { publicKey: string | null; subscriptions: MockPushSubscription[] }
  invitations: MockInvitation[]
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
    messageBundles: structuredClone(messageBundleFixtures),
    messageThreads: structuredClone(messageThreadFixtures),
    messageFailures: { inbox: false, threadIds: [], actions: false },
    notifications: [],
    push: { publicKey: null, subscriptions: [] },
    invitations: [],
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
