import { z } from 'zod'

/*
 * 태스크 응답 스키마 (backend app/schemas/task.py). FE 가 읽는 필드만 본다. 타입은 이 스키마에서 만든다 (#348)
 */

/** 서버 TaskStatus. 상태 판단·쓰기 기준이라 모르는 값이면 응답 전체가 `INVALID_RESPONSE` 다 */
export const taskStatusSchema = z.enum(['todo', 'in_progress', 'blocked', 'done'])

export const taskSchema = z.object({
  task_id: z.string(),
  workspace_id: z.string(),
  meeting_id: z.string().nullable(),
  // 원본 회의를 지웠어도 태스크는 남고 출처는 `meeting_id` 로 남는다(#576). 빠진 옛 응답은 지우지 않은 회의다
  meeting_deleted: z.boolean().optional(),
  title: z.string(),
  assignee_member_id: z.string().nullable(),
  status: taskStatusSchema,
  blocker: z.string().nullable(),
  due_date: z.string().nullable(),
  // 계약 §4.7-6 뒤로는 항상 온다. 빠진 옛 응답은 생성일로 채운다
  start_date: z.string().nullish(),
  notion_page_id: z.string().nullable(),
  // 변경마다 1씩 오르는 정수. task_update 충돌 확인(confirm_task_version)의 기준이다
  version: z.number().int(),
  // pending | synced | failed, 미연동이면 null. 모르는 값은 mapper 가 null 로 내린다
  notion_sync_status: z.string().nullish(),
  // 지금 POST /tasks/{id}/auto-block/undo 가 성공하는 상태인가. 풀기 버튼만 정하므로 보수 폴백이다. 불리언이 아니거나
  // 빠지면(#373 전 BE) 풀 수 없는 것(false)으로 읽는다 (#365)
  auto_blocked: z.boolean().catch(({ input }) => {
    if (import.meta.env.DEV) console.warn('Unknown task auto_blocked:', input)
    return false
  }),
  created_at: z.string(),
  updated_at: z.string(),
})
export type TaskDto = z.infer<typeof taskSchema>

export const taskListSchema = z.object({ items: z.array(taskSchema) })

export const taskHistorySchema = z.object({
  history_id: z.string(),
  task_id: z.string(),
  // 표시용 분류다. 모르는 값은 mapper 가 `알 수 없는 ○○` 로 남긴다
  changed_field: z.string(),
  old_value: z.string().nullable(),
  new_value: z.string().nullable(),
  change_source: z.string(),
  changed_by: z.string().nullable(),
  is_auto: z.boolean(),
  is_rolled_back: z.boolean(),
  rolled_back_at: z.string().nullable(),
  created_at: z.string(),
})
export type TaskHistoryDto = z.infer<typeof taskHistorySchema>

export const taskHistoryListSchema = z.object({ items: z.array(taskHistorySchema) })
