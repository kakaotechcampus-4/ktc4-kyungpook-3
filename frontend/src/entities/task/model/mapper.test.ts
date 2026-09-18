import { taskFixtures, taskHistoryFixtures } from '@/shared/mock/fixtures/task'
import { toTask, toTaskHistory } from './mapper'

it('maps snake case and derives Notion sync while retaining date strings', () => {
  expect(toTask(taskFixtures[0])).toEqual({
    id: 'tk_01',
    workspaceId: 'ws_01',
    meetingId: 'mt_09',
    title: '로그인 API 연동',
    assigneeMemberId: 'mb_01',
    status: 'in_progress',
    progress: 40,
    blocker: null,
    dueDate: '2026-09-20',
    startDate: '2026-09-15',
    notionPageId: 'notion_tk_01',
    isSyncedToNotion: true,
    createdAt: '2026-09-15T04:00:00Z',
    updatedAt: '2026-09-17T04:00:00Z',
  })
})

it('falls back null and omitted start dates to creation date and preserves other null values', () => {
  expect(toTask(taskFixtures[1])).toMatchObject({
    startDate: '2026-09-10',
    notionPageId: null,
    isSyncedToNotion: false,
  })
  const dto = structuredClone(taskFixtures[6])
  delete dto.start_date
  expect(toTask(dto)).toMatchObject({
    startDate: '2026-09-08',
    assigneeMemberId: null,
    progress: null,
    blocker: null,
    meetingId: null,
  })
})

it('maps task history flags and unknown enum fallbacks', () => {
  expect(toTaskHistory(taskHistoryFixtures[0])).toEqual({
    id: 'hs_01',
    taskId: 'tk_01',
    field: 'due_date',
    oldValue: '2026-09-13',
    newValue: '2026-09-20',
    source: 'meeting',
    changedBy: null,
    isAuto: true,
    isRolledBack: false,
    rolledBackAt: null,
    createdAt: '2026-09-15T06:00:00Z',
  })
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
  try {
    expect(toTask({ ...taskFixtures[0], status: 'future' }).status).toBe('todo')
    expect(
      toTaskHistory({
        ...taskHistoryFixtures[0],
        changed_field: 'future',
        change_source: 'future',
      }),
    ).toMatchObject({ field: 'title', source: 'manual' })
    expect(warning).toHaveBeenCalledTimes(3)
  } finally {
    warning.mockRestore()
  }
})
