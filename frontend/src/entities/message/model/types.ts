/*
 * 메시지 화면의 임시 도메인 모델. 메시지 API 가 없어 디자인 캔버스(Messages·MessagesThread)에 보이는 항목으로 골랐다 —
 * 계약이 아니고 실제 API 뒤 바뀐다 (M8 계획 C-8, 결정 4 의 UI 범위는 디자인 캔버스 기준 MSW 목). 화면은 DTO 대신 이 타입만 쓴다.
 */

export type MessageSender = 'bot' | 'member'

export type MessageThreadKind = 'direct' | 'channel'

export interface TaskRef {
  id: string
  title: string
}

export type ReplySource = 'discord' | 'web'

/** AI 가 정하지 못한 답장만 있다. 고른 뒤에는 바꾸지 않는다 */
export type ReplyAttribution =
  | { status: 'needs_pm'; candidates: readonly TaskRef[] }
  | { status: 'resolved'; task: TaskRef | null }

/** 봇 메시지. 상태마다 가진 칸이 다르다 */
export interface PendingBotMessage {
  sender: 'bot'
  status: 'pending'
  id: string
  body: string
  reviewId: string
  /** 나갈 시각. 승인하면 바로 보내면 null */
  scheduledAt: string | null
}
export interface ScheduledBotMessage {
  sender: 'bot'
  status: 'scheduled'
  id: string
  body: string
  reviewId: string
  scheduledAt: string
  approvedBy: string
}
export interface SentBotMessage {
  sender: 'bot'
  status: 'sent'
  id: string
  body: string
  sentAt: string
  /** null 이면 자동 발송 */
  approvedBy: string | null
}
export interface CancelledBotMessage {
  sender: 'bot'
  status: 'cancelled'
  id: string
  body: string
  /** 화면에 놓는 시각. 나가려던 시각이 나중이면 취소한 때로 당긴다 */
  at: string
  reason: 'dismissed' | 'responded'
}
export interface ExpiredBotMessage {
  sender: 'bot'
  status: 'expired'
  id: string
  body: string
  /** 화면에 놓는 시각 */
  at: string
}
export type BotMessage =
  PendingBotMessage | ScheduledBotMessage | SentBotMessage | CancelledBotMessage | ExpiredBotMessage
export type BotMessageStatus = BotMessage['status']

export interface MemberReply {
  sender: 'member'
  id: string
  body: string
  sentAt: string
  source: ReplySource
  attribution: ReplyAttribution | null
}
export type Message = BotMessage | MemberReply
/** 이미 대화에 남은 것 — 목록 미리보기가 보는 것 */
export type DeliveredMessage = SentBotMessage | MemberReply

/** `마감 하루 전` 선택지. 지났는지는 서버가 정한다 */
export type DeadlineSend =
  { status: 'none' } | { status: 'open'; at: string } | { status: 'passed'; at: string }

/** 언제 보낼까 — 마감 하루 전 · 지금 바로 · 직접 정한 시각 */
export type MessageSendTiming = 'day_before_deadline' | 'now' | 'custom'

/** 보내기 전 확인 항목의 단계. 승인 뒤에도 같은 항목이다 */
export type ReviewState = { status: 'pending' } | { status: 'scheduled'; approvedBy: string }

/** 보내기 전 확인 항목 — 수신자 한 명에게 가는 DM 한 건 */
export interface MessageReview {
  id: string
  threadId: string
  recipientName: string
  summary: string
  body: string
  createdAt: string
  /** 관련 태스크의 마감일 `YYYY-MM-DD`. 없으면 null */
  deadline: string | null
  /** 왜 보내려 하는가 */
  reason: string
  /** 근거가 된 마지막 Discord 메시지 주소 */
  reasonUrl: string | null
  sendTiming: MessageSendTiming
  /** 나갈 시각. 지금 바로 보내면 null */
  scheduledAt: string | null
  deadlineSend: DeadlineSend
  state: ReviewState
}

export interface MessageThreadSummary {
  id: string
  kind: MessageThreadKind
  name: string
  lastMessage: DeliveredMessage | null
  /** 답장을 기다리기 시작한 때. 서버가 정한다 — 기다리지 않으면 null */
  awaitingReplySince: string | null
  needsAttribution: boolean
}

export interface MessageInbox {
  reviews: MessageReview[]
  threads: MessageThreadSummary[]
}

export interface MessageThread {
  id: string
  kind: MessageThreadKind
  name: string
  /** 상대가 팀에서 맡은 일(시안 `백엔드`) */
  teamRole: string | null
  discordUrl: string | null
  messages: Message[]
  awaitingReplySince: string | null
}

/** Discord DM 한 건의 글자 수 한도. 미리보기와 답장이 같이 쓴다 */
export const MESSAGE_BODY_MAX_LENGTH = 2000

/** 발송 시점을 바꾸는 요청. 직접 정하기만 시각을 함께 보낸다 */
export type MessageSchedule =
  { timing: Exclude<MessageSendTiming, 'custom'> } | { timing: 'custom'; scheduledAt: string }

/**
 * 메시지 쓰기 전부. 대상 ID 가 행동 안에 있다 — 어느 항목의 행동인지 따로 넘기지 않는다.
 * 모두 서버가 성공해야 화면이 바뀐다 (D-137)
 */
export type MessageAction =
  | { kind: 'send'; reviewId: string }
  | { kind: 'dismiss'; reviewId: string }
  | { kind: 'edit'; reviewId: string; body: string }
  | ({ kind: 'schedule'; reviewId: string } & MessageSchedule)
  | { kind: 'reply'; threadId: string; body: string }
  | { kind: 'attribute'; messageId: string; taskId: string | null }
