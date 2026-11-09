import type { UnknownValue } from '@/shared/api/unknownValue'

/* 메시지 화면의 도메인 모델 (계약 §5.7). 화면은 DTO 대신 이 타입만 쓴다 */

export type MessageSender = 'bot' | 'pm' | 'member'

export type ReplyChannel = 'discord' | 'web'

export type DmFailureReason = 'dm_blocked' | 'discord_not_linked' | 'unknown'

/** 봇·PM 메시지가 Discord DM 으로 나갔는가. 실패해도 웹 대화에는 남는다 */
export type DmDelivery =
  | { status: 'pending' | 'claimed' | 'delivered' }
  | { status: 'failed'; reason: DmFailureReason | UnknownValue }

export interface BotMessage {
  sender: 'bot'
  id: string
  body: string
  createdAt: string
  dm: DmDelivery
}

/** PM 이 웹에서 쓴 메시지. 작성자 칸이 비어 와도 메시지는 그린다 — 이름은 `PM` 으로 대신한다 */
export interface PmMessage {
  sender: 'pm'
  id: string
  body: string
  createdAt: string
  dm: DmDelivery
  authorMemberId: string | null
  authorName: string | null
}

export interface MemberMessage {
  sender: 'member'
  id: string
  body: string
  createdAt: string
  replyChannel: ReplyChannel
}

export type Message = BotMessage | PmMessage | MemberMessage

/** 재촉 이유의 근거 — 그 태스크의 마지막 진행 소식. 답장이면 그 메시지가, 태스크 변경이면 그 태스크가 근거다 */
export type ReminderEvidence =
  { kind: 'reply'; at: string; messageId: string } | { kind: 'taskChange'; at: string }

/** 묶음 안의 태스크 하나. 태스크가 지워졌으면 제목·마감·이유·근거가 null 이다 */
export interface BundleTask {
  reminderId: string
  taskId: string | null
  title: string | null
  /** `YYYY-MM-DD` */
  dueDate: string | null
  note: string | null
  /** 왜 재촉하는지 한 문장. 서버가 만든다 */
  reason: string | null
  /** 진행 소식이 한 번도 없었으면 null 이다 */
  evidence: ReminderEvidence | null
}

export const BODY_SOURCES = ['pm', 'ai', 'rule'] as const
export type BodySource = (typeof BODY_SOURCES)[number]

/**
 * 화면이 다루는 묶음의 단계. 응답의 status·approved 조합에서 매퍼가 한 번만 정한다.
 * 예정(`scheduled`)이 아닌 묶음은 목록·대화 응답에 오지 않는다
 */
export type BundleStage = { stage: 'awaitingApproval' } | { stage: 'approved'; approvedAt: string }

/** 보낼 메시지 — 같은 받는 사람·같은 발송 시각의 리마인드를 묶은 DM 한 통 */
export type Bundle = BundleStage & {
  id: string
  threadId: string
  memberId: string
  recipientName: string
  scheduledAt: string
  body: string
  /** 표시용 분류. 모르는 값은 받은 글자를 남긴다 (#348) */
  bodySource: BodySource | UnknownValue
  /** AI 초안이 아직 오는 중이라 문구가 바뀔 수 있다 */
  drafting: boolean
  /** 승인할 때 그대로 돌려보내는 문구의 판 */
  draftVersion: number
  /** 목록 한 줄 — `API 명세서 진행 상황 확인` */
  summary: string
  tasks: BundleTask[]
}

export interface LastMessage {
  id: string
  sender: MessageSender
  body: string
  createdAt: string
  /** PM 메시지만 갖는다 */
  authorMemberId: string | null
  authorName: string | null
}

/** 그 팀원이 웹에서 답할 수 있는가. 서버가 칸을 보내지 않으면 unknown 이다 — 어느 쪽으로도 단정하지 않는다 */
export type WebReply = 'available' | 'unavailable' | 'unknown'

export interface MessageThreadSummary {
  id: string
  memberId: string
  name: string
  lastMessage: LastMessage | null
  /** 답장을 기다리기 시작한 때. 서버가 정한다 — 기다리지 않으면 null */
  awaitingReplySince: string | null
  /** 그 팀원에게 마지막으로 나간 봇·PM 메시지가 DM 으로 가지 못했다 */
  dmFailed: boolean
  webReply: WebReply
}

/** 목록은 보는 사람으로 갈린다. 팀원은 보낼 메시지를 받지 않는다 */
export type MessageInbox =
  | { viewer: 'pm'; bundles: Bundle[]; threads: MessageThreadSummary[] }
  | { viewer: 'member'; threads: MessageThreadSummary[] }

export interface MessageThread extends MessageThreadSummary {
  /** 시각 순 */
  messages: Message[]
  /** 이 대화의 예정 묶음. PM 에게만 오고 팀원에게는 비어 있다 */
  upcoming: Bundle[]
}

export interface TaskRef {
  id: string
  title: string
}

/**
 * 리마인드 답장이 어느 태스크에 대한 것인지. AI 가 정하지 못한 답장만 있다.
 * - needsPick: PM 이 후보에서 고를 차례다. 지운 태스크는 후보에 없다
 * - picked: PM 이 골랐다. task 가 null 이면 해당 없음이다
 */
export type ReplyAttribution =
  | { messageId: string; kind: 'needsPick'; candidates: TaskRef[] }
  | { messageId: string; kind: 'picked'; task: TaskRef | null }

/** Discord DM 한 건의 글자 수 한도. 미리보기와 답장이 같이 쓴다 */
export const MESSAGE_BODY_MAX_LENGTH = 2000

/**
 * 메시지 쓰기 전부. 대상 ID 가 행동 안에 있다 — 어느 항목의 행동인지 따로 넘기지 않는다.
 * 모두 서버가 성공해야 화면이 바뀐다 (D-137)
 */
export type MessageAction =
  | { kind: 'approve'; bundleId: string; draftVersion: number }
  | { kind: 'cancel'; bundleId: string }
  | { kind: 'edit'; bundleId: string; body: string }
  | { kind: 'schedule'; bundleId: string; scheduledAt: string }
  | { kind: 'reply'; threadId: string; body: string }
  | { kind: 'removeTask'; bundleId: string; reminderId: string }
  /** note 가 null 이면 메모를 지운다 */
  | { kind: 'editNote'; bundleId: string; reminderId: string; note: string | null }
  /** taskId 가 null 이면 해당 없음이다 */
  | { kind: 'attribute'; messageId: string; taskId: string | null }

/**
 * 쓰기의 결과.
 * - merged: 보낼 시각을 옮긴 자리에 같은 사람의 예정 묶음이 있어 서버가 그 묶음(into)으로 합쳤다
 * - closed: 마지막 태스크를 빼 묶음이 취소됐다 — 보내지 않음과 같이 이 묶음은 목록에서 사라진다
 */
export type MessageActionOutcome =
  { kind: 'done' } | { kind: 'merged'; into: Bundle } | { kind: 'closed' }

/** 재촉 만들기. 받는 사람이 그 태스크의 담당자인지는 서버가 보지 않는다 */
export interface ReminderCreateInput {
  memberId: string
  taskId: string
  scheduledAt: string
  note: string | null
}

/** 만든 재촉과 그것이 든 묶음. 같은 사람·같은 시각의 예정 묶음이 있었으면 그 묶음에 합쳐져 태스크가 여럿이다 */
export interface CreatedReminder {
  reminderId: string
  bundle: Bundle
}
