import type { TaskDto } from '@/shared/types/api/task'
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
  // 계약 §4.7-6 반영 뒤 start_date 는 항상 온다. 서버가 빠뜨려도 폴백이 도는지만 지킨다
  const dto = { ...structuredClone(taskFixtures[6]), start_date: undefined } as unknown as TaskDto
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

// PR #59 가 ChangedField 에 start_date 를 넣었다. 허용 목록에 없으면 폴백인 title 로 강등돼
// 시작일 변경이 "제목 변경"으로 표시된다. 경고는 개발 모드에만 찍혀 프로덕션에서는 조용하다
it('keeps start_date history as its own field instead of falling back to title', () => {
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
  try {
    expect(
      toTaskHistory({
        ...taskHistoryFixtures[0],
        changed_field: 'start_date',
        old_value: null,
        new_value: '2026-09-15',
      }),
    ).toMatchObject({ field: 'start_date', oldValue: null, newValue: '2026-09-15' })
    expect(warning).not.toHaveBeenCalled()
  } finally {
    warning.mockRestore()
  }
})
