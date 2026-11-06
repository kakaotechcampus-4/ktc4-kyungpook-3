import type { TaskFieldsPatch } from '@/entities/task'

/** 상세의 저장 줄이 함께 저장하는 값. null 은 담당자 없음·마감 없음이다 */
export interface TaskFields {
  assigneeMemberId: string | null
  dueDate: string | null
}

export type TaskFieldChange =
  | { field: 'assignee'; from: string | null; to: string | null }
  | { field: 'dueDate'; from: string | null; to: string | null }

/** 변경 항목이 바꾸는 태스크 값의 키 */
const KEY_OF = {
  assignee: 'assigneeMemberId',
  dueDate: 'dueDate',
} as const satisfies Record<TaskFieldChange['field'], keyof TaskFields>

const FIELD_ORDER = ['assignee', 'dueDate'] as const

/** 서버 값과 고친 값을 비교해 바뀐 것만 담당자, 마감 순서로 */
export function taskFieldChanges(original: TaskFields, draft: TaskFields): TaskFieldChange[] {
  return FIELD_ORDER.flatMap((field) => {
    const key = KEY_OF[field]
    return original[key] === draft[key] ? [] : [{ field, from: original[key], to: draft[key] }]
  })
}

/** 바뀐 키만 담은 요청 본문. 바뀌지 않은 값은 보내지 않는다 — 그 사이 다른 사람이 바꾼 값을 덮지 않는다 */
export function toTaskFieldsPatch(changes: readonly TaskFieldChange[]): TaskFieldsPatch {
  return Object.fromEntries(changes.map(({ field, to }) => [KEY_OF[field], to]))
}
