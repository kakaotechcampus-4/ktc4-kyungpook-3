/*
 * 메시지 화면의 임시 응답 모양. 메시지 API 가 없어 시안에서 최소 필드만 골랐다 — 계약이 아니고
 * 결정 4·실제 API 가 생기면 OpenAPI 생성 타입으로 바뀐다 (M8 계획 C-3, C-8). 대표 계약 문서에 올리지 않는다.
 */

/** 봇이 보낸 메시지인가, 상대(사람·채널)가 보낸 메시지인가 */
export type MessageSenderDto = 'bot' | 'counterpart'

/** 사람별 DM 대화인가, 채널 항목인가 */
export type MessageThreadKindDto = 'direct' | 'channel'

export interface MessageDto {
  message_id: string
  sender: MessageSenderDto
  body: string
  sent_at: string
}

/** 보내기 전 확인 항목. 수신자 한 명에게 가는 DM 한 건이다 (결정 4 의 임시 기본값) */
export interface MessageReviewDto {
  review_id: string
  recipient_name: string
  /** 목록 한 줄 요약 */
  summary: string
  /** 나갈 DM 본문 */
  body: string
  created_at: string
}

export interface MessageThreadSummaryDto {
  thread_id: string
  kind: MessageThreadKindDto
  name: string
  last_message: MessageDto | null
}

/** `GET /workspaces/{workspace_id}/messages` (임시) */
export interface MessageInboxDto {
  reviews: MessageReviewDto[]
  threads: MessageThreadSummaryDto[]
}

/** `GET /workspaces/{workspace_id}/messages/threads/{thread_id}` (임시). 메시지는 보낸 시각 순이다 */
export interface MessageThreadDto {
  thread_id: string
  kind: MessageThreadKindDto
  name: string
  messages: MessageDto[]
}
