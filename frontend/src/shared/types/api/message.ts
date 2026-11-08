/*
 * 메시지 API 응답·요청 모양. 백엔드 `app/schemas/message.py` 와 칸이 1:1 이다 (계약 §5.7).
 * 시각은 서버가 UTC ISO 로 준다. 값이 정해진 칸은 백엔드 `app/models` 의 StrEnum 값이다
 */

export type ReminderStatusDto = 'scheduled' | 'sent' | 'cancelled' | 'expired'
export type BodySourceDto = 'pm' | 'ai' | 'rule'
export type DraftStatusDto = 'needed' | 'claimed' | 'done'
export type MessageSenderDto = 'bot' | 'member'
export type ReplyChannelDto = 'discord' | 'web'
export type DmStatusDto = 'pending' | 'claimed' | 'delivered' | 'failed'
export type DmFailureReasonDto = 'dm_blocked' | 'discord_not_linked' | 'unknown'

/** `ReminderEvidence` — 그 태스크의 마지막 진행 소식. message_id 는 reply 에만 있다 */
export interface ReminderEvidenceDto {
  kind: 'reply' | 'task_change'
  at: string
  message_id: string | null
}

/** `ReminderResponse`. 태스크가 지워졌으면 task_*·reason·evidence 칸이 null 이다 */
export interface ReminderDto {
  reminder_id: string
  bundle_id: string
  task_id: string | null
  task_title: string | null
  /** `YYYY-MM-DD` */
  due_date: string | null
  note: string | null
  status: ReminderStatusDto
  kind: 'nudge'
  origin: 'pm' | 'scheduler'
  created_at: string
  // reason·evidence·summary 는 #418 이전 서버가 보내지 않아 선택 칸이다. 매퍼가 채운다
  reason?: string | null
  /** 진행 소식이 한 번도 없었으면 null */
  evidence?: ReminderEvidenceDto | null
}

/** `BundleResponse` — 보낼 메시지 한 통 */
export interface BundleDto {
  bundle_id: string
  thread_id: string
  member_id: string
  recipient_name: string
  scheduled_at: string
  status: ReminderStatusDto
  approved: boolean
  approved_at: string | null
  body: string
  body_source: BodySourceDto
  draft_status: DraftStatusDto
  draft_version: number
  /** 목록 한 줄 — `API 명세서 진행 상황 확인`, 여럿이면 `퍼블리싱 외 1건 진행 상황 확인` */
  summary?: string
  reminders: ReminderDto[]
}

/** `MessageResponse`. reply_channel 은 팀원 메시지만, dm_* 는 봇 메시지만 갖는다 */
export interface MessageDto {
  message_id: string
  thread_id: string
  sender: MessageSenderDto
  body: string
  created_at: string
  reply_channel: ReplyChannelDto | null
  dm_status: DmStatusDto | null
  dm_failure_reason: DmFailureReasonDto | null
  scheduled_at: string | null
}

/** `LastMessage` */
export interface LastMessageDto {
  message_id: string
  sender: MessageSenderDto
  body: string
  created_at: string
}

/** `ThreadSummary` */
export interface ThreadSummaryDto {
  thread_id: string
  member_id: string
  name: string
  last_message: LastMessageDto | null
  awaiting_reply_since: string | null
  dm_failed: boolean
}

/** `GET /workspaces/{workspace_id}/messages` — `InboxResponse`. 팀원에게는 bundles 가 null 이다 */
export interface InboxDto {
  threads: ThreadSummaryDto[]
  bundles: BundleDto[] | null
}

/** `GET …/messages/threads/{thread_id}` — `ThreadDetailResponse`. 팀원에게는 bundles 가 null 이다 */
export interface ThreadDetailDto {
  thread: ThreadSummaryDto
  messages: MessageDto[]
  bundles: BundleDto[] | null
}

/** `PATCH …/messages/bundles/{bundle_id}` — `BundleUpdateRequest`. 둘 중 하나는 있어야 한다 */
export interface BundleUpdateRequestDto {
  body?: string
  scheduled_at?: string
}

/** `POST …/messages/bundles/{bundle_id}/approve` — `BundleApproveRequest` */
export interface BundleApproveRequestDto {
  draft_version: number
}

/** `POST …/messages/threads/{thread_id}/replies` — `ReplyCreateRequest` */
export interface ReplyCreateRequestDto {
  body: string
}

/** `POST …/messages/reminders` — `ReminderCreateRequest`. scheduled_at 은 시간대가 있어야 한다 */
export interface ReminderCreateRequestDto {
  member_id: string
  task_id: string
  scheduled_at: string
  note?: string | null
}

/** `PATCH …/messages/reminders/{reminder_id}` — `ReminderUpdateRequest`. note 를 null·빈 글로 보내면 메모를 지우고, 빼면 그대로 둔다 */
export interface ReminderUpdateRequestDto {
  note?: string | null
  scheduled_at?: string
}

/** 리마인드 만들기·고치기·빼기의 응답 — `ReminderWithBundleResponse`. bundle 은 그 리마인드가 지금 든 묶음이다 */
export interface ReminderWithBundleDto {
  reminder: ReminderDto
  bundle: BundleDto
}
