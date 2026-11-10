import { z } from 'zod'
import { taskStatusSchema } from './task'

/*
 * 승인 응답 스키마 (backend app/schemas/approval.py). FE 가 읽는 필드만 본다. 타입은 이 스키마에서 만든다 (#348)
 */

/** 서버 ApprovalStatus. 대기인지가 승인 버튼과 확인 필요 목록을 정하므로 모르는 값이면 응답 전체가 `INVALID_RESPONSE` 다 */
export const approvalStatusSchema = z.enum(['pending', 'approved', 'rejected'])

/**
 * 승인하며 PM 이 고친 값 (backend approvals.py `_normalize_overrides`). 키가 없으면 제안 그대로, null 이면 미정이다.
 * 생성·수정 카드의 키를 한 모양으로 본다. 서버는 그 종류가 고칠 수 없는 키를 저장하지 않는다
 */
const storedOverridesSchema = z.object({
  task_title: z.string().optional(),
  assignee_member_id: z.string().nullable().optional(),
  due_date: z.string().nullable().optional(),
  status: taskStatusSchema.optional(),
})

/**
 * 전사 오인식 의심 한 개 (#643, backend schemas/meeting.py `AsrSuspect`). `source` 는 서버도 자유 문자열이라
 * 모르는 값은 mapper 가 버린다. 표시만 하는 값이라 모양이 틀린 항목은 null 로 두고 응답을 막지 않는다 (D-184)
 */
const asrSuspectSchema = z
  .object({
    word: z.string(),
    source: z.string(),
    candidates: z.array(z.string()).catch([]),
  })
  .nullable()
  .catch(null)

/** 자유 dict 다. 제안 값·근거는 mapper 가 글자일 때만 읽고, 아래 키만 모양을 본다 */
const approvalPayloadSchema = z.looseObject({
  task_overrides: storedOverridesSchema.optional(),
  // 이 카드에 합쳐진 다른 회의의 항목 (#512, backend services/pending_merge.py). 항목의 근거 키는 mapper 가 읽는다
  merged_items: z.array(z.looseObject({})).nullish(),
  // 합치며 담당자를 바꾼 항목. 없으면 카드를 만든 항목이다
  assignee_item_id: z.string().nullish(),
  // null 은 확인하지 않은 옛 AI, [] 는 확인했고 의심이 없다. 배열이 아니면 null 로 둔다
  asr_suspects: z.array(asrSuspectSchema).nullable().catch(null).optional(),
})

export const approvalSchema = z.object({
  approval_id: z.string(),
  workspace_id: z.string(),
  // task_create | task_update. 모르는 종류는 거절하지 않고 지원하지 않는 요청으로 읽는다
  type: z.string(),
  payload: approvalPayloadSchema,
  related_task_id: z.string().nullable(),
  requested_by: z.string().nullable(),
  status: approvalStatusSchema,
  resolved_by: z.string().nullable(),
  created_at: z.string(),
  resolved_at: z.string().nullable(),
  // task_create 카드 payload 의 지문 (#547). 같은지만 비교하고 형식에 기대지 않는다. 그 밖의 종류는 null, #547 이전 서버는 없다
  payload_version: z.string().nullish(),
  // 담당자를 못 찾은 이름 지목의 pending 생성 승인이고 아직 누구의 별칭도 아니면 true (#523). 처리 뒤에는 늘 false.
  // #523 이전 서버는 없다
  alias_candidate: z.boolean().optional(),
  // 별칭으로 저장될 글자. `alias_candidate` 가 false 면 null
  alias_text: z.string().nullish(),
})
export type ApprovalDto = z.infer<typeof approvalSchema>

export const approvalListSchema = z.object({ items: z.array(approvalSchema) })

/** 409 APPROVAL_CONFLICT 의 `details`. 모양이 틀리면 재승인 기준이 없다 */
export const approvalConflictDetailsSchema = z.object({
  approval_id: z.string(),
  task_id: z.string(),
  task_version: z.number().int().min(1),
  conflicts: z.array(
    z.object({ field: z.string(), base: z.unknown(), current: z.unknown(), proposed: z.unknown() }),
  ),
})

/** 409 APPROVAL_CHANGED 의 `details`. `payload_version` 은 지금 값이다. 화면은 새 카드를 다시 받아 비교하므로 읽지 않는다 */
export const approvalChangedDetailsSchema = z.object({
  approval_id: z.string(),
  payload_version: z.string(),
})

/** 409 APPROVAL_ALREADY_RESOLVED 의 `details`. 모르는 상태는 null 로 둔다 */
export const approvalAlreadyResolvedDetailsSchema = z.object({
  approval_id: z.string().nullable().catch(null),
  current_status: approvalStatusSchema.nullable().catch(null),
})

export type TaskOverridesDto =
  | Partial<{ task_title: string; assignee_member_id: string | null; due_date: string | null }>
  | Partial<{
      status: 'todo' | 'in_progress' | 'blocked' | 'done'
      due_date: string | null
      assignee_member_id: string | null
    }>

export interface ApprovalResolveRequestDto {
  status: 'approved' | 'rejected'
  confirm_task_version?: number
  task_overrides?: TaskOverridesDto
  /** 생성 승인에서 고른 담당자에게 `alias_text` 를 별칭으로 저장한다. 서버는 후보가 아니거나 미정이면 무시한다 */
  save_alias?: boolean
  /** PM 이 본 카드의 `payload_version`. 처리할 때 값이 다르면 409 APPROVAL_CHANGED 다 */
  payload_version?: string
}
