import { z } from 'zod'

/*
 * 메시지 응답 스키마 (backend app/schemas/message.py, 계약 §5.7). FE 가 읽는 필드만 본다. 타입은 이 스키마에서 만든다 (#348).
 * 시각은 서버가 UTC ISO 로 준다. 서버 스키마는 상태·종류를 `str` 로 내린다
 */

/** 묶음 상태. 예정(`scheduled`)인 묶음만 보내기 전 확인·승인 대상이라 모르는 값이면 응답 전체가 `INVALID_RESPONSE` 다 */
export const bundleStatusSchema = z.enum(['scheduled', 'sent', 'cancelled', 'expired'])

/** 보낸 쪽. 무엇을 그릴지(DM 전달·답장 경로·작성자) 정해 모르는 값이면 응답 전체가 `INVALID_RESPONSE` 다 */
export const messageSenderSchema = z.enum(['bot', 'pm', 'member'])

/** DM 전달 상태. 실패 표시와 다시 보내기 판단의 기준이라 모르는 값이면 `INVALID_RESPONSE` 다 */
const dmStatusSchema = z.enum(['pending', 'claimed', 'delivered', 'failed'])

/**
 * 그 태스크의 마지막 진행 소식(#418). `kind` 는 reply | task_change 다. 근거 링크 하나라 모르는 종류는 mapper 가 근거 없음으로
 * 둔다. message_id 는 reply 에만 있다
 */
const reminderEvidenceSchema = z.object({
  kind: z.string(),
  at: z.string(),
  message_id: z.string().nullable(),
})

/** 태스크가 지워졌으면 task_*·reason·evidence 칸이 null 이다. reason·evidence 는 #418 이전 서버가 보내지 않는다 */
export const reminderSchema = z.object({
  reminder_id: z.string(),
  task_id: z.string().nullable(),
  task_title: z.string().nullable(),
  // `YYYY-MM-DD`
  due_date: z.string().nullable(),
  note: z.string().nullable(),
  reason: z.string().nullish(),
  evidence: reminderEvidenceSchema.nullish(),
})
export type ReminderDto = z.infer<typeof reminderSchema>

/** 보낼 메시지 한 통 (`BundleResponse`) */
export const bundleSchema = z
  .object({
    bundle_id: z.string(),
    thread_id: z.string(),
    member_id: z.string(),
    recipient_name: z.string(),
    scheduled_at: z.string(),
    status: bundleStatusSchema,
    approved: z.boolean(),
    approved_at: z.string().nullable(),
    body: z.string(),
    // pm | ai | rule. 표시용 분류라 모르는 값은 mapper 가 받은 글자를 남긴다
    body_source: z.string(),
    // needed | claimed | done. 모르는 값은 mapper 가 작성 중으로 본다(보수 폴백, 승인을 늦출 뿐이다)
    draft_status: z.string(),
    // 승인할 때 그대로 돌려보내는 문구의 판
    draft_version: z.number().int(),
    // 목록 한 줄. #418 이전 서버는 보내지 않아 mapper 가 태스크 제목으로 줄인다
    summary: z.string().optional(),
    reminders: z.array(reminderSchema),
  })
  .superRefine((bundle, context) => {
    // 승인한 예정 묶음은 승인 시각을 보인다. 없으면 승인했는지를 믿을 수 없다
    if (bundle.status === 'scheduled' && bundle.approved && bundle.approved_at === null)
      context.addIssue({
        code: 'custom',
        path: ['approved_at'],
        message: 'approved bundle has no approved_at',
      })
  })
export type BundleDto = z.infer<typeof bundleSchema>

/**
 * `MessageResponse`. reply_channel 은 팀원 메시지만, dm_* 는 봇·PM 메시지만 갖는다. 보낸 쪽과 칸이 맞지 않으면 그릴 수 없어
 * `INVALID_RESPONSE` 다. author_* 는 PM 이 웹에서 쓴 메시지만 갖고, #519 이전 서버는 보내지 않는다
 */
export const messageSchema = z
  .object({
    message_id: z.string(),
    sender: messageSenderSchema,
    body: z.string(),
    created_at: z.string(),
    // discord | web. 모르는 값은 mapper 가 웹 표시 없이 읽는다
    reply_channel: z.string().nullable(),
    dm_status: dmStatusSchema.nullable(),
    // dm_blocked | discord_not_linked | unknown. 모르는 값은 mapper 가 이유를 알 수 없음(unknown)으로 읽는다
    dm_failure_reason: z.string().nullable(),
    author_member_id: z.string().nullish(),
    author_name: z.string().nullish(),
  })
  .superRefine((message, context) => {
    if (message.sender === 'member' && message.reply_channel === null)
      context.addIssue({
        code: 'custom',
        path: ['reply_channel'],
        message: 'member message has no reply_channel',
      })
    if (message.sender !== 'member' && message.dm_status === null)
      context.addIssue({
        code: 'custom',
        path: ['dm_status'],
        message: 'bot or pm message has no dm_status',
      })
  })
export type MessageDto = z.infer<typeof messageSchema>

/** 대화 요약 (`ThreadSummary`) */
export const threadSummarySchema = z.object({
  thread_id: z.string(),
  member_id: z.string(),
  name: z.string(),
  last_message: z
    .object({
      message_id: z.string(),
      sender: messageSenderSchema,
      body: z.string(),
      created_at: z.string(),
      author_member_id: z.string().nullish(),
      author_name: z.string().nullish(),
    })
    .nullable(),
  awaiting_reply_since: z.string().nullable(),
  dm_failed: z.boolean(),
  // 그 팀원에게 연결된 웹 계정이 있다(#525). 이 칸이 생기기 전 서버는 보내지 않아 mapper 가 모름으로 둔다
  web_reply_available: z.boolean().optional(),
})
export type ThreadSummaryDto = z.infer<typeof threadSummarySchema>

/** `GET /workspaces/{workspace_id}/messages`. 팀원에게는 bundles 가 null 이다 */
export const inboxSchema = z.object({
  threads: z.array(threadSummarySchema),
  bundles: z.array(bundleSchema).nullable(),
})
export type InboxDto = z.infer<typeof inboxSchema>

/** `GET …/messages/threads/{thread_id}`. 팀원에게는 bundles 가 null 이다 */
export const threadDetailSchema = z.object({
  thread: threadSummarySchema,
  messages: z.array(messageSchema),
  bundles: z.array(bundleSchema).nullable(),
})
export type ThreadDetailDto = z.infer<typeof threadDetailSchema>

/** 리마인드 만들기·고치기·빼기의 응답 (`ReminderWithBundleResponse`). bundle 은 그 리마인드가 지금 든 묶음이다 */
export const reminderWithBundleSchema = z.object({
  reminder: reminderSchema,
  bundle: bundleSchema,
})
export type ReminderWithBundleDto = z.infer<typeof reminderWithBundleSchema>

/** 막 만든 리마인드의 묶음은 늘 예정이다. 아니면 만든 것을 보일 수 없어 `INVALID_RESPONSE` 다 */
export const createdReminderSchema = reminderWithBundleSchema.superRefine((dto, context) => {
  if (dto.bundle.status !== 'scheduled')
    context.addIssue({
      code: 'custom',
      path: ['bundle', 'status'],
      message: 'created reminder bundle is not scheduled',
    })
})

/** 대화 신호 웹소켓의 프레임 (계약 §5.7 「대화 신호 웹소켓」, #558). 모르는 프레임은 버린다 */
export const threadUpdatedSignalSchema = z.object({
  type: z.literal('thread_updated'),
  thread_id: z.string(),
})

/** `PATCH …/messages/bundles/{bundle_id}` — `BundleUpdateRequest`. 둘 중 하나는 있어야 한다 */
export interface BundleUpdateRequestDto {
  body?: string
  scheduled_at?: string
}

/** `POST …/messages/bundles/{bundle_id}/approve` — `BundleApproveRequest` */
export interface BundleApproveRequestDto {
  draft_version: number
}

/** `POST …/messages/threads` — `ThreadOpenRequest`. 그 팀원과의 대화가 없으면 만들고, 있으면 그 대화다 */
export interface ThreadOpenRequestDto {
  member_id: string
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
