/*
 * 메시지 화면의 임시 도메인 모델. 메시지 API 가 없어 디자인 캔버스(Messages·MessagesThread)에 보이는 항목으로 골랐다 —
 * 계약이 아니고 실제 API 뒤 바뀐다 (M8 계획 C-8, 결정 4 의 UI 범위는 디자인 캔버스 기준 MSW 목). 화면은 DTO 대신 이 타입만 쓴다.
 */

export type MessageSender = 'bot' | 'counterpart'

export type MessageThreadKind = 'direct' | 'channel'

/** 이미 나갔는가, 승인을 받아 정한 시각을 기다리는가 */
export type MessageStatus = 'sent' | 'scheduled'

/** 봇 메시지가 규칙에 따라 자동으로 나갔는가, 사람이 승인해서 나갔는가 */
export type MessageDelivery = 'auto' | 'approved'

export interface Message {
  id: string
  sender: MessageSender
  body: string
  /** 나간 시각. `scheduled` 이면 나갈 시각이다 */
  sentAt: string
  status: MessageStatus
  /** 봇 메시지만 있다 */
  delivery: MessageDelivery | null
  approvedBy: string | null
}

/** 언제 보낼까 — 마감 하루 전 · 지금 바로 · 직접 정한 시각 */
export type MessageSendTiming = 'day_before_deadline' | 'now' | 'custom'

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
  /** `마감 하루 전` 의 시각. 마감이 없으면 null 이고 그 선택지는 고를 수 없다 */
  deadlineSendAt: string | null
}

export interface MessageThreadSummary {
  id: string
  kind: MessageThreadKind
  name: string
  lastMessage: Message | null
  /** 답장을 기다리기 시작한 때. 서버가 정한다 — 기다리지 않으면 null */
  awaitingReplySince: string | null
}

export interface MessageInbox {
  reviews: MessageReview[]
  threads: MessageThreadSummary[]
}

/** 대화 안에서 승인을 기다리는 보내기 전 확인 항목 */
export interface PendingMessageReview {
  id: string
  body: string
  scheduledAt: string | null
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
  pendingReviews: PendingMessageReview[]
}

/** 보내기 전 확인 항목에 대한 행동. 모두 서버가 성공해야 화면이 바뀐다 (D-137) */
export type MessageReviewAction =
  | { kind: 'send' }
  | { kind: 'dismiss' }
  | { kind: 'edit'; body: string }
  | { kind: 'schedule'; timing: Exclude<MessageSendTiming, 'custom'> }
  | { kind: 'schedule'; timing: 'custom'; scheduledAt: string }
