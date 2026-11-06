import type { SessionDto } from '@/shared/types/api/auth'
import type { SpeakerViewDto } from '@/shared/types/api/meeting'
import type { MemberAliasDto, MemberDto } from '@/shared/types/api/member'
import type { MessageSettingsDto } from '@/shared/types/api/messageSettings'
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
import type { MockReplies } from './reply-state'

/**
 * 처리 중 회의를 상세 조회(`GET /meetings/{id}`)가 어떻게 진행시키는가. 진행 규칙은 meetingFlow.ts 에 있다.
 * - `manual`: 저절로 바뀌지 않는다. 테스트가 `advanceMeeting` 등으로 직접 바꾼다 — Vitest 와 기존 시나리오의 기본값
 * - `staged`: 조회마다 한 단계(`audio_merged` → `transcribed` → `extracted` → `done`). 브라우저 데모용
 * - `instant`: 첫 조회에 바로 `done`. 인위적 지연이 없다 — E2E 용
 * - `fail`: 첫 조회에 `failed`
 * - `fail-notion-revoked`: 첫 조회에 `failed`, 그 공간의 Notion 연동이 `revoked` 가 된다 (D-099, D-100)
 * - `speakers`: 업로드 회의가 첫 조회에 화자 지정 대기가 된다. PM 이 지정을 내면 조회마다 한 단계씩(`staged`) 끝난다 (#256)
 */
export type MeetingFlowMode =
  | 'manual'
  | 'staged'
  | 'instant'
  | 'fail'
  | 'fail-notion-revoked'
  | 'fail-diarize'
  | 'fail-expired'
  | 'speakers'

export const MEETING_FLOW_MODES = [
  'manual',
  'staged',
  'instant',
  'fail',
  'fail-notion-revoked',
  'fail-diarize',
  'fail-expired',
  'speakers',
] as const satisfies readonly MeetingFlowMode[]

/** 업로드 회의의 화자 지정 상태. 백엔드 meeting_upload 행의 화자 칸에 대응한다 (계약 §2.3.1) */
export interface MockSpeakerUpload {
  /** AI 가 보낸 라벨. 보내기 전에는 빈 목록이다 */
  speakers: SpeakerViewDto['speakers']
  /** 제출한 지정. 라벨 → 팀원 ID, 외부 참석자는 null */
  mapping: Record<string, string | null> | null
  /** 녹음 폴더가 있다. 있어도 처리가 done·failed 로 끝나면 지워진 것으로 본다 */
  audio: boolean
  expireOnSubmit: boolean
}

export interface MeetingFlowState {
  mode: MeetingFlowMode
  /** 업로드가 받은 참석자 ID. 실 API 는 받고 버린다(계약 §4.0-②-9). 정리 결과의 참석자·발화자가 된다 */
  attendees: Record<string, string[]>
  /** 업로드 회의마다 하나. 봇 회의에는 없다 — 화자 경로가 404 다 */
  speakers: Record<string, MockSpeakerUpload>
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

/** #356 비밀번호 재설정 토큰. 실 API 는 해시만 저장하지만 모의 메일함이 링크를 보여야 해서 원문을 둔다 */
export interface MockResetToken {
  token: string
  email: string
  expiresAt: string
  /** `revoked` 는 같은 이메일의 새 요청으로 무효가 된 것이다 */
  status: 'active' | 'used' | 'revoked'
}

/** 보낸 재설정 메일 */
export interface MockMail {
  to: string
  /** 메일 링크의 앱 안 경로 `/reset-password#token=...`. 메일함이 지금 주소를 앞에 붙여 보인다 */
  resetPath: string
  sentAt: string
}

/** `server-error` 는 세 경로 모두 500, `mail-unavailable` 은 요청만 503 이다 */
export type PasswordResetFailure = 'none' | 'server-error' | 'mail-unavailable'

export const PASSWORD_RESET_FAILURES = [
  'none',
  'server-error',
  'mail-unavailable',
] as const satisfies readonly PasswordResetFailure[]

export interface MockPasswordReset {
  tokens: MockResetToken[]
  /** 이메일별로 다음 메일을 보낼 수 있는 시각(ms). 그 전의 요청은 메일 없이 200 이다 */
  nextMailAt: Record<string, number>
  /** 보낸 순서다. 모의 메일함(devPaths.mockMail)이 최근 것부터 보인다 */
  outbox: MockMail[]
  failure: PasswordResetFailure
}

/** 백엔드에서 막힘을 직접 건(applied) 열린 무응답 감시 기록에 대응한다. 막기 전 상태·사유를 든다 */
export interface MockAutoBlock {
  prev_status: string
  prev_blocker: string | null
}

/** 저장한 메시지·알림 설정 행. 응답의 `saved`·`pms` 는 handler 가 붙인다 */
export type MockMessageSettings = Omit<MessageSettingsDto, 'saved' | 'pms'>

interface MockAccount {
  session: SessionDto
  password: string
  workspaceIds: string[]
  /** 공간별로 이 계정이 연결된 팀원 행. 백엔드 Member.user_id 의 대응이다. 초대로 이어진 행은 수락한 초대가 대응이라 여기 두지 않는다 */
  memberIds: Record<string, string>
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
  autoBlocks: Record<string, MockAutoBlock>
  /** #344 리마인드 답장 판단 결과. 판단은 시나리오가 넣는다 (reply-state.ts) */
  replies: MockReplies
  approvals: typeof approvalFixtures
  /** 회의 정리 흐름. 원본 파일은 담지 않는다 — 생성 결과는 위의 meetings·minutes·extractions·tasks·approvals 에 들어간다 */
  meetingFlow: MeetingFlowState
  /** M8 메시지 (계약 §5.7). 보낼 메시지(묶음)와 대화는 공간별이다 */
  messageBundles: typeof messageBundleFixtures
  messageThreads: typeof messageThreadFixtures
  messageFailures: MessageFailures
  /** #340 공간별 메시지·알림 설정. 저장한 적 없는 공간은 행이 없다 */
  messageSettings: Record<string, MockMessageSettings>
  /** #330 알림. 받는 팀원별 행이다 */
  notifications: MockNotification[]
  /** #330 브라우저 푸시. 공개키가 null 이면 서버에 키가 없는 것이다 */
  push: { publicKey: string | null; subscriptions: MockPushSubscription[] }
  invitations: MockInvitation[]
  passwordReset: MockPasswordReset
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
        memberIds: { ws_01: 'mb_01' },
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
    autoBlocks: {},
    replies: { judgments: [], changes: [], historyLinks: {} },
    approvals: structuredClone(approvalFixtures),
    meetingFlow: { mode: 'manual', attendees: {}, speakers: {} },
    messageBundles: structuredClone(messageBundleFixtures),
    messageThreads: structuredClone(messageThreadFixtures),
    messageFailures: { inbox: false, threadIds: [], actions: false },
    messageSettings: {},
    notifications: [],
    push: { publicKey: null, subscriptions: [] },
    invitations: [],
    passwordReset: { tokens: [], nextMailAt: {}, outbox: [], failure: 'none' },
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
