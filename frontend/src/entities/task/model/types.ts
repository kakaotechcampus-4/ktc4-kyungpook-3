import type { UnknownValue } from '@/shared/api/unknownValue'
import type { TaskStatus } from '@/shared/types/common'
export type { TaskStatus } from '@/shared/types/common'
/** 서버 NotionSyncStatus. 미연동이면 Task 의 값이 null 이다. `synced` 만 반영 완료다 */
export type NotionSyncStatus = 'pending' | 'synced' | 'failed'
export interface Task {
  id: string
  workspaceId: string
  meetingId: string | null
  title: string
  assigneeMemberId: string | null
  status: TaskStatus
  blocker: string | null
  dueDate: string | null
  startDate: string
  notionPageId: string | null
  /** 서버가 정한 정수 버전. task_update 충돌을 다시 승인할 때 이 값을 confirm_task_version 으로 보낸다 */
  version: number
  /** 페이지 ID 가 있어도 `synced` 가 아니면 반영 완료가 아니다. 모르는 값은 null 로 둔다 */
  notionSyncStatus: NotionSyncStatus | null
  /** 지금 자동 막힘 풀기가 성공하는 상태다. 서버의 `auto_blocked` 다 */
  autoBlocked: boolean
  createdAt: string
  updatedAt: string
}
export type TaskTab = 'all' | 'needs_review' | 'in_progress' | 'done'
/** 서버 ChangedField (계약 §2.6). scope 는 범위 변경 승인이 남긴다 */
export const TASK_HISTORY_FIELDS = [
  'assignee',
  'start_date',
  'due_date',
  'status',
  'title',
  'progress',
  'blocker',
  'scope',
] as const
export type TaskHistoryField = (typeof TASK_HISTORY_FIELDS)[number]

export const TASK_HISTORY_SOURCES = [
  'meeting',
  'chat',
  'checkin',
  'notion',
  'reminder_reply',
  'manual',
  'scheduler',
] as const
export type TaskHistorySource = (typeof TASK_HISTORY_SOURCES)[number]

export interface TaskHistoryEntry {
  id: string
  taskId: string
  /** 모르는 값은 받은 문자열 그대로 남는다. 화면은 `알 수 없는 항목` 으로 읽는다 */
  field: TaskHistoryField | UnknownValue
  oldValue: string | null
  newValue: string | null
  source: TaskHistorySource | UnknownValue
  changedBy: string | null
  isAuto: boolean
  isRolledBack: boolean
  rolledBackAt: string | null
  createdAt: string
}

/** 답장 판단이 낸 줄의 종류. `unknown`·`due_clear`·`failed`·`none` 은 값이 없는 줄이다 (계약 §5.7) */
export type ReplyChangeField =
  'status' | 'due_date' | 'assignee' | 'scope' | 'unknown' | 'due_clear' | 'failed' | 'none'

/** 승인은 따로 줄이 되지 않고 이 결과로 읽는다 */
export type ReplyChangeResult =
  'applied' | 'undone' | 'pending' | 'approved' | 'rejected' | 'noted' | 'recorded'

export interface ReplyChangeLine {
  id: string
  /** 모르는 값은 받은 문자열 그대로 남는다 */
  field: ReplyChangeField | UnknownValue
  newValue: string | null
  evidenceStatus: 'certain' | 'inferred' | null
  /** AI 해석. 대화 주인과 PM 이 아니면 null 이다 */
  summary: string | null
  evidenceQuote: string | null
  result: ReplyChangeResult | UnknownValue
  /** 되돌리기는 이 값만 따른다. 줄 종류·결과를 몰라도 바뀌지 않는다 */
  undoable: boolean
}

/** 태스크 기록 한 칸. 답장에 이어진 이력은 답장 아래에만 있고 `history` 칸이 되지 않는다 */
export type TaskTimelineItem =
  | {
      kind: 'reply'
      /** 답장 메시지 ID */
      id: string
      at: string
      memberName: string
      channel: 'discord' | 'web' | null
      /** 대화 주인과 PM 이 아니면 null 이다 */
      body: string | null
      changes: ReplyChangeLine[]
    }
  | { kind: 'history'; entry: TaskHistoryEntry }
