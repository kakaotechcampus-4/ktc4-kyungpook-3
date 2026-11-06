import type {
  ReplyAttributionDto,
  TaskRefDto,
  TimelineChangeDto,
  TimelineChangeField,
  TimelineChangeResult,
  TimelineItemDto,
} from '@/shared/types/api/reply'
import type { TaskHistoryDto } from '@/shared/types/api/task'
import { db } from './db'
import type { MockDb } from './db'
import { MOCK_NOW } from './fixtures/constants'
import type { MockTask } from './fixtures/task'
import { addHistory, enqueueTaskSync, taskFields } from './task-state'

/*
 * 리마인드 답장 판단 (계약 §5.7, backend services/replies.py). 판단 자체(봇·AI)는 흉내 내지 않는다.
 * 시나리오가 판단이 끝난 결과를 넣고, handler 는 그 결과의 조회·태스크 고르기·되돌리기만 한다.
 * PM 이 태스크를 고르면 BE 는 그 태스크로 다시 판단하지만 목은 다시 판단하지 않는다
 */

export type MockReplyJudgmentState = 'pending' | 'done' | 'needs_pm' | 'failed' | 'timed_out'

export type MockReplyChangeOutcome =
  'applied' | 'proposed' | 'unknown' | 'noted' | 'recorded' | 'dismissed' | 'picked' | 'skipped'

/** 답장 한 통의 판단. 후보가 없는 답장에는 행이 없다 */
export interface MockReplyJudgment {
  message_id: string
  workspace_id: string
  thread_id: string
  state: MockReplyJudgmentState
  candidates: string[]
  picked_task_id: string | null
}

/** 판단이 낸 줄 하나. 태스크를 모르는 줄(`unknown`)은 task_id 가 null 이다 */
export interface MockReplyChange {
  change_id: string
  message_id: string
  task_id: string | null
  field: TimelineChangeField
  new_value: string | null
  evidence_status: 'certain' | 'inferred' | null
  summary: string | null
  evidence_quote: string | null
  outcome: MockReplyChangeOutcome
  /** 승인 카드로 간 줄의 승인 */
  approval_id: string | null
}

export interface MockReplies {
  judgments: MockReplyJudgment[]
  changes: MockReplyChange[]
  /** 답장 줄에 이어진 이력. BE TaskHistory.reply_change_id 에 대응한다 (history_id → change_id) */
  historyLinks: Record<string, string>
}

const ATTRIBUTION_OUTCOMES: ReadonlySet<MockReplyChangeOutcome> = new Set([
  'unknown',
  'picked',
  'dismissed',
])

function liveTaskIds(taskIds: readonly string[], state: MockDb): Set<string> {
  return new Set(
    state.tasks.filter(({ task_id }) => taskIds.includes(task_id)).map(({ task_id }) => task_id),
  )
}

function taskRef(taskId: string, state: MockDb): TaskRefDto | null {
  const task = state.tasks.find(({ task_id }) => task_id === taskId)
  return task === undefined ? null : { task_id: task.task_id, title: task.title }
}

/** BE `attributions`. 그 대화에서 PM 이 태스크를 골라야 하거나 고른 답장들 */
export function replyAttributions(
  workspaceId: string,
  threadId: string,
  state: MockDb = db,
): ReplyAttributionDto[] {
  return state.replies.judgments
    .filter((row) => row.workspace_id === workspaceId && row.thread_id === threadId)
    .flatMap((row): ReplyAttributionDto[] => {
      const line = state.replies.changes.find(
        (change) =>
          change.message_id === row.message_id && ATTRIBUTION_OUTCOMES.has(change.outcome),
      )
      if (line === undefined) return []
      if (line.outcome === 'unknown') {
        const live = liveTaskIds(row.candidates, state)
        return [
          {
            message_id: row.message_id,
            status: 'needs_pm',
            candidates: row.candidates
              .filter((id) => live.has(id))
              .flatMap((id) => taskRef(id, state) ?? []),
            task: null,
          },
        ]
      }
      return [
        {
          message_id: row.message_id,
          status: 'resolved',
          candidates: null,
          task: row.picked_task_id === null ? null : taskRef(row.picked_task_id, state),
        },
      ]
    })
}

export type AttributeError =
  'REPLY_JUDGMENT_NOT_FOUND' | 'REPLY_ATTRIBUTION_NOT_NEEDED' | 'INVALID_REQUEST'

/** BE `attribute`. 실패하면 오류 코드를 돌려주고 아무것도 바꾸지 않는다 */
export function attributeReply(
  workspaceId: string,
  messageId: string,
  taskId: string | null,
  state: MockDb = db,
): AttributeError | null {
  const row = state.replies.judgments.find(({ message_id }) => message_id === messageId)
  if (row === undefined || row.workspace_id !== workspaceId) return 'REPLY_JUDGMENT_NOT_FOUND'
  if (row.state !== 'needs_pm') return 'REPLY_ATTRIBUTION_NOT_NEEDED'
  if (taskId !== null && !liveTaskIds(row.candidates, state).has(taskId)) return 'INVALID_REQUEST'
  for (const change of state.replies.changes)
    if (change.message_id === messageId && change.outcome === 'unknown')
      change.outcome = taskId === null ? 'dismissed' : 'picked'
  row.candidates = taskId === null ? [] : [taskId]
  row.state = taskId === null ? 'done' : 'pending'
  row.picked_task_id = taskId
  return null
}

function linkedEntries(changeId: string, state: MockDb): TaskHistoryDto[] {
  return state.taskHistory.filter(
    ({ history_id }) => state.replies.historyLinks[history_id] === changeId,
  )
}

/** BE `_result` */
function changeResult(
  line: MockReplyChange,
  entries: readonly TaskHistoryDto[],
  state: MockDb,
): TimelineChangeResult {
  if (line.outcome === 'proposed') {
    const stored = state.approvals.find(
      ({ approval_id }) => approval_id === line.approval_id,
    )?.status
    const status = stored === 'approved' || stored === 'rejected' ? stored : 'pending'
    // 담당자를 못 찾은 카드는 승인해도 바뀌는 값이 없다
    return status === 'approved' && line.field === 'assignee' && entries.length === 0
      ? 'noted'
      : status
  }
  if (line.outcome === 'applied' || line.outcome === 'recorded') return line.outcome
  return 'noted'
}

export interface TimelineViewer {
  memberId: string | null
  isPm: boolean
}

/** BE `timeline`. 최신순이고, 답장에 이어진 이력은 답장 아래에만 나온다 */
export function taskTimeline(
  task: MockTask,
  viewer: TimelineViewer,
  state: MockDb = db,
): TimelineItemDto[] {
  const lines = state.replies.changes.filter(({ task_id }) => task_id === task.task_id)
  const messageIds = [...new Set(lines.map(({ message_id }) => message_id))]
  const replies = messageIds.flatMap((messageId): TimelineItemDto[] => {
    const thread = state.messageThreads.find(({ messages }) =>
      messages.some(({ message_id }) => message_id === messageId),
    )
    const message = thread?.messages.find(({ message_id }) => message_id === messageId)
    if (thread === undefined || message === undefined) return []
    const readable = viewer.isPm || viewer.memberId === thread.member_id
    const owner = state.members.find(({ member_id }) => member_id === thread.member_id)
    return [
      {
        kind: 'reply',
        at: message.created_at,
        message_id: messageId,
        member_name: owner?.display_name ?? thread.name,
        channel: message.reply_channel,
        body: readable ? message.body : null,
        changes: lines
          .filter((line) => line.message_id === messageId)
          .map((line): TimelineChangeDto => {
            const entries = linkedEntries(line.change_id, state)
            const live = entries.filter(({ is_rolled_back }) => !is_rolled_back)
            // PM 이 고쳐 승인했으면 이력의 값이 실제 값이다
            const value =
              entries.find(({ changed_field }) => changed_field === line.field)?.new_value ??
              line.new_value
            return {
              change_id: line.change_id,
              field: line.field,
              new_value: value,
              evidence_status: line.evidence_status,
              summary: readable ? line.summary : null,
              evidence_quote: readable ? line.evidence_quote : null,
              result:
                entries.length > 0 && live.length === 0
                  ? 'undone'
                  : changeResult(line, entries, state),
              undoable: line.outcome === 'applied' && live.length > 0,
            }
          }),
      },
    ]
  })
  const history: TimelineItemDto[] = state.taskHistory
    .filter(
      ({ task_id, history_id }) =>
        task_id === task.task_id && !Object.hasOwn(state.replies.historyLinks, history_id),
    )
    .map((entry) => ({
      kind: 'history',
      at: entry.created_at,
      history_id: entry.history_id,
      changed_field: entry.changed_field,
      old_value: entry.old_value,
      new_value: entry.new_value,
      change_source: entry.change_source,
    }))
  return [...replies, ...history].sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
}

function fieldKey(changedField: string): keyof MockTask | null {
  const key = changedField === 'assignee' ? 'assignee_member_id' : changedField
  return (taskFields as readonly string[]).includes(key) ? (key as keyof MockTask) : null
}

function currentValue(task: MockTask, key: keyof MockTask): string | null {
  const value = task[key]
  return value === null || value === undefined ? null : String(value)
}

/**
 * BE `undo_change`. 이어진 이력 중 하나라도 그 뒤 바뀌었으면 하나도 되돌리지 않고 409 다.
 * 되돌린 값은 새 이력으로 남는다. 무응답 자동 막힘을 넘어온 변경의 막기 전 상태 복원은 흉내 내지 않는다
 */
export function undoReplyChange(
  task: MockTask,
  changeId: string,
  actor: string,
  state: MockDb = db,
): 'REPLY_CHANGE_NOT_UNDOABLE' | null {
  const change = state.replies.changes.find(({ change_id }) => change_id === changeId)
  if (change === undefined || change.task_id !== task.task_id || change.outcome !== 'applied')
    return 'REPLY_CHANGE_NOT_UNDOABLE'
  const entries = linkedEntries(changeId, state)
    .filter(({ is_rolled_back }) => !is_rolled_back)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
  if (entries.length === 0) return 'REPLY_CHANGE_NOT_UNDOABLE'
  const changed = entries.some((entry) => {
    const key = fieldKey(entry.changed_field)
    return key === null || currentValue(task, key) !== entry.new_value
  })
  if (changed) return 'REPLY_CHANGE_NOT_UNDOABLE'
  for (const entry of entries) {
    const key = fieldKey(entry.changed_field) as keyof MockTask
    Object.assign(task, { [key]: entry.old_value })
    entry.is_rolled_back = true
    entry.rolled_back_at = MOCK_NOW
    addHistory(
      task.task_id,
      entry.changed_field,
      entry.new_value,
      entry.old_value,
      actor,
      entry.change_source,
      state,
    )
  }
  task.updated_at = MOCK_NOW
  task.version += 1
  enqueueTaskSync(task, state)
  return null
}

/**
 * BE `link_history`. 답장 승인 카드를 승인하며 남긴 이력(`since` 번째부터)을 제안한 줄에 잇는다.
 * 답장에서 온 카드가 아니면 아무것도 하지 않는다
 */
export function linkApprovalHistory(approvalId: string, since: number, state: MockDb = db): void {
  const byField = new Map(
    state.replies.changes
      .filter(({ approval_id }) => approval_id === approvalId)
      .map(({ field, change_id }) => [field as string, change_id]),
  )
  if (byField.size === 0) return
  for (const entry of state.taskHistory.slice(since)) {
    const changeId = byField.get(entry.changed_field)
    if (changeId !== undefined) state.replies.historyLinks[entry.history_id] = changeId
  }
}
