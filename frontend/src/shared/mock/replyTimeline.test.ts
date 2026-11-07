import { ApiError } from '@/shared/api/errors'
import { fetchDto, jsonRequest } from '@/shared/test/api'
import type { ListDto } from '@/shared/types/api/envelope'
import type { TimelineItemDto, TimelineReplyDto } from '@/shared/types/api/reply'
import type { TaskDto, TaskHistoryDto } from '@/shared/types/api/task'
import { applyScenario } from './scenarios'

const timeline = async (taskId = 'tk_03') =>
  (await fetchDto<ListDto<TimelineItemDto>>(`/tasks/${taskId}/timeline`)).items
const history = async (taskId = 'tk_03') =>
  (await fetchDto<ListDto<TaskHistoryDto>>(`/tasks/${taskId}/history`)).items
const undo = (changeId = 'rc_02', taskId = 'tk_03') =>
  fetchDto<TaskDto>(`/tasks/${taskId}/reply-changes/${changeId}/undo`, { method: 'POST' })

function replyOf(items: readonly TimelineItemDto[], messageId = 'mg_31'): TimelineReplyDto {
  const found = items.find(
    (item): item is TimelineReplyDto => item.kind === 'reply' && item.message_id === messageId,
  )
  if (!found) throw new Error(`reply ${messageId} is missing`)
  return found
}
const historyIds = (items: readonly TimelineItemDto[]) =>
  items.flatMap((item) => (item.kind === 'history' ? [item.history_id] : []))
const change = (items: readonly TimelineItemDto[], changeId: string) =>
  replyOf(items).changes.find(({ change_id }) => change_id === changeId)

async function failure(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise
  } catch (error) {
    if (error instanceof ApiError) return error
    throw error
  }
  throw new Error('요청이 성공했다')
}

describe('태스크 기록 (GET /tasks/{id}/timeline)', () => {
  beforeEach(() => applyScenario('reply-judgment'))

  it('답장이 자동 반영한 이력은 답장 아래에만 있고 따로 한 줄이 되지 않는다', async () => {
    const items = await timeline()
    const reply = replyOf(items)
    expect(reply.body).toContain('DB 스키마 정리는 끝냈어요')
    expect(
      reply.changes.map(({ change_id, result, undoable }) => [change_id, result, undoable]),
    ).toEqual([
      ['rc_02', 'applied', true],
      ['rc_03', 'pending', false],
    ])
    expect(historyIds(items)).not.toContain('hs_31')
    // /history 는 그대로다
    expect((await history()).map(({ history_id }) => history_id)).toContain('hs_31')
  })

  it('답장이 바꾸지 않은 태스크에는 답장 칸이 없다', async () => {
    expect((await timeline('tk_01')).every(({ kind }) => kind === 'history')).toBe(true)
  })

  it('PM 이 ap_31 을 승인하면 rc_03 이 승인함이 되고 마감 이력은 따로 한 줄이 되지 않는다', async () => {
    const before = new Set(historyIds(await timeline()))
    await fetchDto(`/approvals/ap_31`, jsonRequest('PATCH', { status: 'approved' }))

    const items = await timeline()
    expect(change(items, 'rc_03')).toMatchObject({ result: 'approved', new_value: '2026-09-26' })
    expect(historyIds(items).filter((id) => !before.has(id))).toEqual([])
    const dueRows = (await history()).filter(({ changed_field }) => changed_field === 'due_date')
    expect(dueRows[0]).toMatchObject({ new_value: '2026-09-26', change_source: 'reminder_reply' })
  })
})

describe('일반 팀원의 태스크 기록', () => {
  beforeEach(() => applyScenario('reply-judgment-member'))

  it('답장 글·AI 해석·근거는 null 이고 무엇이 바뀌었는지는 보인다', async () => {
    const reply = replyOf(await timeline())
    expect(reply.body).toBeNull()
    expect(reply.changes.map(({ summary, evidence_quote }) => [summary, evidence_quote])).toEqual([
      [null, null],
      [null, null],
    ])
    expect(reply.changes[0]).toMatchObject({ field: 'status', new_value: 'done' })
  })

  it('되돌리기는 403 이고 아무것도 바꾸지 않는다', async () => {
    const error = await failure(undo())
    expect([error.status, error.code]).toEqual([403, 'FORBIDDEN'])
    expect((await fetchDto<TaskDto>('/tasks/tk_03')).status).toBe('done')
  })
})

describe('답장 자동 반영 되돌리기 (POST …/reply-changes/{id}/undo)', () => {
  beforeEach(() => applyScenario('reply-judgment'))

  it('되돌리면 상태가 막힘으로 돌아가고 줄은 되돌림이다. 두 번째는 409 다', async () => {
    const task = await undo()
    expect(task.status).toBe('blocked')

    const items = await timeline()
    expect(change(items, 'rc_02')).toMatchObject({ result: 'undone', undoable: false })
    // 되돌린 값은 새 이력 한 줄로 남는다
    const newest = items[0]
    expect(newest).toMatchObject({
      kind: 'history',
      changed_field: 'status',
      old_value: 'done',
      new_value: 'blocked',
    })

    const error = await failure(undo())
    expect([error.status, error.code]).toEqual([409, 'REPLY_CHANGE_NOT_UNDOABLE'])
  })

  it('그 뒤 상태가 바뀌었으면 409 이고 상태는 그대로다', async () => {
    await fetchDto('/tasks/tk_03', jsonRequest('PATCH', { status: 'in_progress' }))
    const error = await failure(undo())
    expect([error.status, error.code]).toEqual([409, 'REPLY_CHANGE_NOT_UNDOABLE'])
    expect((await fetchDto<TaskDto>('/tasks/tk_03')).status).toBe('in_progress')
  })
})
