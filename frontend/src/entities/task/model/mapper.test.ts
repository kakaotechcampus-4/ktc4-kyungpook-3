import type { TimelineItemDto } from '@/shared/types/api/reply'
import type { TaskDto } from '@/shared/types/api/task'
import { taskFixtures, taskHistoryFixtures } from '@/shared/mock/fixtures/task'
import { isNotionSynced, toTask, toTaskHistory, toTaskTimeline } from './mapper'

const taskDtos: TaskDto[] = taskFixtures.map((row) => ({ ...row, auto_blocked: false }))

it('원본 삭제 여부를 읽고 회의 ID를 유지한다. 빠진 옛 응답은 지우지 않은 회의다', () => {
  expect(toTask({ ...taskDtos[0], meeting_deleted: true })).toMatchObject({
    meetingId: 'mt_09',
    meetingDeleted: true,
  })
  expect(toTask(taskDtos[0]).meetingDeleted).toBe(false)
})

it('maps snake case, version and Notion sync status while retaining date strings', () => {
  expect(toTask(taskDtos[0])).toEqual({
    id: 'tk_01',
    workspaceId: 'ws_01',
    meetingId: 'mt_09',
    meetingDeleted: false,
    title: '로그인 API 연동',
    assigneeMemberId: 'mb_01',
    status: 'in_progress',
    blocker: null,
    dueDate: '2026-09-20',
    startDate: '2026-09-15',
    notionPageId: 'notion_tk_01',
    version: 1,
    notionSyncStatus: 'synced',
    autoBlocked: false,
    createdAt: '2026-09-15T04:00:00Z',
    updatedAt: '2026-09-17T04:00:00Z',
  })
})

it('falls back null and omitted start dates to creation date and preserves other null values', () => {
  expect(toTask(taskDtos[1])).toMatchObject({
    startDate: '2026-09-10',
    notionPageId: null,
    notionSyncStatus: null,
  })
  // 계약 §4.7-6 반영 뒤 start_date 는 항상 온다. 서버가 빠뜨려도 폴백이 도는지만 지킨다
  const dto = { ...structuredClone(taskDtos[6]), start_date: undefined } as unknown as TaskDto
  expect(toTask(dto)).toMatchObject({
    startDate: '2026-09-08',
    assigneeMemberId: null,
    blocker: null,
    meetingId: null,
  })
})

it('maps task history flags and keeps unknown history values instead of reading them as known ones', () => {
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
    expect(
      toTaskHistory({
        ...taskHistoryFixtures[0],
        changed_field: 'future_field',
        change_source: 'future_source',
      }),
    ).toMatchObject({ field: { unknown: 'future_field' }, source: { unknown: 'future_source' } })
    expect(warning).toHaveBeenCalledTimes(2)
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

it('keeps scope history as its own field with only the new sentence (#205)', () => {
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
  try {
    expect(
      toTaskHistory({
        ...taskHistoryFixtures[0],
        changed_field: 'scope',
        old_value: null,
        new_value: '소셜 로그인은 이번 범위에서 빼기로 했어요.',
      }),
    ).toMatchObject({
      field: 'scope',
      oldValue: null,
      newValue: '소셜 로그인은 이번 범위에서 빼기로 했어요.',
    })
    expect(warning).not.toHaveBeenCalled()
  } finally {
    warning.mockRestore()
  }
})

describe('Notion 반영 상태', () => {
  it.each([
    ['pending', 'pending', false],
    ['synced', 'synced', true],
    ['failed', 'failed', false],
    [null, null, false],
  ] as const)('notion_sync_status %s 는 %s 로 읽고 반영 완료=%s', (raw, status, synced) => {
    const task = toTask({ ...taskDtos[0], notion_sync_status: raw })
    expect(task.notionSyncStatus).toBe(status)
    expect(isNotionSynced(task)).toBe(synced)
  })

  // 예전 매퍼는 notion_page_id 가 있으면 반영됨으로 봤다. 서버 상태가 synced 가 아니면 완료가 아니다
  it.each(['pending', 'failed', null])(
    '페이지 ID 가 있어도 상태가 %s 면 반영 완료가 아니다',
    (raw) => {
      const task = toTask({
        ...taskDtos[0],
        notion_page_id: 'notion_tk_01',
        notion_sync_status: raw,
      })
      expect(task.notionPageId).toBe('notion_tk_01')
      expect(isNotionSynced(task)).toBe(false)
    },
  )

  it('페이지 ID 가 없어도 서버가 synced 라고 하면 그 상태를 따른다', () => {
    const task = toTask({ ...taskDtos[1], notion_page_id: null, notion_sync_status: 'synced' })
    expect(isNotionSynced(task)).toBe(true)
  })

  it('모르는 상태 문자열은 synced 로 올리지 않고 null 로 둔다', () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      for (const raw of ['done', 'SYNCED', 'synced ', '']) {
        const task = toTask({ ...taskDtos[0], notion_sync_status: raw })
        expect(task.notionSyncStatus).toBeNull()
        expect(isNotionSynced(task)).toBe(false)
      }
    } finally {
      warning.mockRestore()
    }
  })
})

it('버전과 자동 막힘을 그대로 읽는다', () => {
  expect(
    toTask({ ...taskDtos[2], status: 'blocked', version: 7, auto_blocked: true }),
  ).toMatchObject({ version: 7, autoBlocked: true })
})

describe('태스크 기록 (#344)', () => {
  const reply: TimelineItemDto = {
    kind: 'reply',
    at: '2026-09-17T01:00:00Z',
    message_id: 'mg_31',
    member_name: '이재환',
    channel: 'discord',
    body: 'DB 스키마 정리는 끝냈어요.',
    changes: [
      {
        change_id: 'rc_02',
        field: 'status',
        new_value: 'done',
        evidence_status: 'certain',
        summary: 'DB 스키마 정리를 끝냈대요',
        evidence_quote: 'DB 스키마 정리는 끝냈어요',
        result: 'applied',
        undoable: true,
      },
    ],
  }
  const historyRow = (historyId: string): TimelineItemDto => ({
    kind: 'history',
    at: '2026-09-16T06:00:00Z',
    history_id: historyId,
    changed_field: 'due_date',
    old_value: '2026-09-13',
    new_value: '2026-09-20',
    change_source: 'meeting',
  })

  it('답장은 그 답장이 바꾼 줄과 한 칸이다', () => {
    expect(toTaskTimeline([reply], [], 'tk_03')).toEqual([
      {
        kind: 'reply',
        id: 'mg_31',
        at: '2026-09-17T01:00:00Z',
        memberName: '이재환',
        channel: 'discord',
        body: 'DB 스키마 정리는 끝냈어요.',
        changes: [
          {
            id: 'rc_02',
            field: 'status',
            newValue: 'done',
            evidenceStatus: 'certain',
            summary: 'DB 스키마 정리를 끝냈대요',
            evidenceQuote: 'DB 스키마 정리는 끝냈어요',
            result: 'applied',
            undoable: true,
          },
        ],
      },
    ])
  })

  it('이력 칸은 /history 의 같은 이력으로 변경자·되돌림을 채운다', () => {
    const full = toTaskHistory({
      ...taskHistoryFixtures[0],
      changed_by: 'mb_01',
      is_auto: false,
      is_rolled_back: true,
      rolled_back_at: '2026-09-17T00:00:00Z',
    })
    expect(toTaskTimeline([historyRow(full.id)], [full], 'tk_01')).toEqual([
      { kind: 'history', entry: full },
    ])
  })

  it('/history 에 없는 이력 칸은 타임라인 칸만으로 만들고 변경자는 모른다', () => {
    expect(toTaskTimeline([historyRow('hs_99')], [], 'tk_01')).toEqual([
      {
        kind: 'history',
        entry: {
          id: 'hs_99',
          taskId: 'tk_01',
          field: 'due_date',
          oldValue: '2026-09-13',
          newValue: '2026-09-20',
          source: 'meeting',
          changedBy: null,
          isAuto: false,
          isRolledBack: false,
          rolledBackAt: null,
          createdAt: '2026-09-16T06:00:00Z',
        },
      },
    ])
  })

  it('모르는 줄·결과·채널은 다른 아는 값으로 바꾸지 않는다', () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const future = {
        ...reply,
        channel: 'slack',
        changes: [
          {
            ...reply.changes[0],
            field: 'priority',
            result: 'escalated',
            evidence_status: 'guessed',
          },
        ],
      } satisfies TimelineItemDto
      const [item] = toTaskTimeline([future], [], 'tk_03')
      expect(item).toMatchObject({ kind: 'reply', channel: null })
      expect(item.kind === 'reply' && item.changes[0]).toMatchObject({
        field: { unknown: 'priority' },
        result: { unknown: 'escalated' },
        evidenceStatus: null,
      })
      expect(warning).toHaveBeenCalledTimes(4)
    } finally {
      warning.mockRestore()
    }
  })

  it.each([
    ['종류', { field: 'priority' }],
    ['결과', { result: 'escalated' }],
    ['종류와 결과', { field: 'priority', result: 'escalated' }],
  ])('%s를 모르는 줄은 서버가 되돌릴 수 있다고 해도 되돌릴 수 없는 줄이다 (#348)', (_, patch) => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const future = { ...reply, changes: [{ ...reply.changes[0], ...patch, undoable: true }] }
      const [item] = toTaskTimeline([future], [], 'tk_03')
      expect(item.kind === 'reply' && item.changes[0].undoable).toBe(false)
    } finally {
      warning.mockRestore()
    }
  })
})
