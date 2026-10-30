/*
 * 메시지 화면의 임시 도메인 모델. 메시지 API 가 없어 시안에서 최소 필드만 골랐다 — 계약이 아니고
 * 결정 4·실제 API 뒤 바뀐다 (M8 계획 C-3, C-8). 화면은 DTO 대신 이 타입만 쓴다.
 */

export type MessageSender = 'bot' | 'counterpart'

export type MessageThreadKind = 'direct' | 'channel'

export interface Message {
  id: string
  sender: MessageSender
  body: string
  sentAt: string
}

/** 보내기 전 확인 항목 — 수신자 한 명에게 가는 DM 한 건 (결정 4 의 임시 기본값) */
export interface MessageReview {
  id: string
  recipientName: string
  summary: string
  body: string
  createdAt: string
}

export interface MessageThreadSummary {
  id: string
  kind: MessageThreadKind
  name: string
  lastMessage: Message | null
  awaitingReply: boolean
}

export interface MessageInbox {
  reviews: MessageReview[]
  threads: MessageThreadSummary[]
}

export interface MessageThread {
  id: string
  kind: MessageThreadKind
  name: string
  messages: Message[]
  awaitingReply: boolean
}
