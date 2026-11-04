/*
 * 메시지 화면의 임시 응답 모양. 메시지 API 가 없어 시안(Messages·MessagesThread)에 보이는 항목으로 골랐다 — 계약이 아니고
 * 실제 API 가 생기면 OpenAPI 생성 타입으로 바뀐다 (M8 계획 C-8, 결정 4 의 UI 범위는 디자인 캔버스 기준 MSW 목).
 * 대표 계약 문서에 올리지 않는다.
 */

/** 봇이 보낸 메시지인가, 팀원이 보낸 메시지인가 */
export type MessageSenderDto = 'bot' | 'member'

/** 사람별 DM 대화인가, 채널 항목인가 */
export type MessageThreadKindDto = 'direct' | 'channel'

/** 재촉 한 건의 단계. 팀원 답장은 항상 `sent` 다 */
export type MessageStatusDto = 'pending' | 'scheduled' | 'sent' | 'cancelled' | 'expired'

export interface TaskRefDto {
  task_id: string
  title: string
}

/** 팀원 답장이 어느 태스크인지. PM 만 받는다 */
export type MessageAttributionDto =
  { status: 'needs_pm'; candidates: TaskRefDto[] } | { status: 'resolved'; task: TaskRefDto | null }

export interface MessageDto {
  /** 재촉 행은 검토 ID(`rv_*`)를 그대로 쓴다. 대화에 쌓인 메시지(`mg_*`)와 겹치지 않는다 */
  message_id: string
  sender: MessageSenderDto
  body: string
  status: MessageStatusDto
  /**
   * 자리의 시각. 승인 대기·예약은 나갈 시각(승인 대기의 지금 바로는 null).
   * 발송됨은 나간 시각. 취소됨·만료됨은 화면에 놓는 시각
   */
  at: string | null
  /** 발송됨·예약의 승인자. 발송됨의 null 은 자동 발송 */
  approved_by: string | null
  /** 승인 대기·예약만. `확인하기` 가 연다 */
  review_id: string | null
  cancel_reason: 'dismissed' | 'responded' | null
  /** 팀원 답장만 */
  source: 'discord' | 'web' | null
  /** 팀원 답장만, PM 에게만 */
  attribution: MessageAttributionDto | null
  /** 승인 대기의 나갈 시각이 지금이거나 그 전인가. 서버가 정한다. 그 밖은 false */
  schedule_passed: boolean
}

/** 언제 보낼까 — 마감 하루 전 · 지금 바로 · 직접 정한 시각 (Messages 시안) */
export type MessageSendTimingDto = 'day_before_deadline' | 'now' | 'custom'

/** 보내기 전 확인 항목. 수신자 한 명에게 가는 DM 한 건이다 */
export interface MessageReviewDto {
  review_id: string
  /** 보내면 메시지가 쌓일 대화 */
  thread_id: string
  recipient_name: string
  /** 목록 한 줄 요약 */
  summary: string
  /** 나갈 DM 본문 */
  body: string
  created_at: string
  /** 관련 태스크의 마감일 `YYYY-MM-DD`. 없으면 null */
  deadline: string | null
  /** 왜 보내려 하는가 — 서버가 만든 한 문장 */
  reason: string
  /** 근거가 된 마지막 Discord 메시지 주소. 없으면 null */
  reason_url: string | null
  send_timing: MessageSendTimingDto
  /** 나갈 시각. `now` 이면 null */
  scheduled_at: string | null
  /** `마감 하루 전` 을 고르면 나갈 시각. 마감이 없으면 null 이고 그 선택지는 고를 수 없다 */
  deadline_send_at: string | null
  /** 승인 전인가, 승인한 뒤 시각을 기다리는가 */
  status: 'pending' | 'scheduled'
  /** `scheduled` 일 때 승인한 사람 이름 */
  approved_by: string | null
  /** `deadline_send_at` 이 지금이거나 그 전인가. 서버가 정한다 */
  deadline_send_passed: boolean
}

export interface MessageThreadSummaryDto {
  thread_id: string
  kind: MessageThreadKindDto
  name: string
  /** 이미 대화에 남은 마지막 메시지. 아직 나가지 않은 재촉은 넣지 않는다 */
  last_message: MessageDto | null
  /** 답장을 기다리기 시작한 때 — 상대의 마지막 답 뒤에 처음 나간 봇 메시지의 시각. 기다리지 않으면 null, 채널은 늘 null */
  awaiting_reply_since: string | null
  /** 태스크를 정하지 못한 답장이 있는가. PM 만 true 가 된다 */
  needs_attribution: boolean
}

/** `GET /workspaces/{workspace_id}/messages` (임시) */
export interface MessageInboxDto {
  reviews: MessageReviewDto[]
  threads: MessageThreadSummaryDto[]
}

/** `GET /workspaces/{workspace_id}/messages/threads/{thread_id}` (임시). 메시지는 자리 시각 순이다 */
export interface MessageThreadDto {
  thread_id: string
  kind: MessageThreadKindDto
  name: string
  /** 상대가 팀에서 맡은 일(시안 `백엔드`). 채널이거나 모르면 null */
  team_role: string | null
  /** Discord 에서 이 대화를 여는 주소. 없으면 null */
  discord_url: string | null
  messages: MessageDto[]
  awaiting_reply_since: string | null
}

/** `PATCH /workspaces/{workspace_id}/messages/reviews/{review_id}` (임시). 준 칸만 바꾼다 */
export interface MessageReviewPatchDto {
  body?: string
  send_timing?: MessageSendTimingDto
  /** `custom` 일 때만 쓴다 */
  scheduled_at?: string
}

/** `POST /workspaces/{workspace_id}/messages/threads/{thread_id}/replies` (임시) */
export interface MessageReplyRequestDto {
  body: string
}

/** `POST /workspaces/{workspace_id}/messages/replies/{message_id}/attribution` (임시) */
export interface MessageAttributionRequestDto {
  task_id: string | null
}
