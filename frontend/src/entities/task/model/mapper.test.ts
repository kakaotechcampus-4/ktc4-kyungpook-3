import { ApiError } from '@/shared/api/errors'
import type { TaskDto } from '@/shared/types/api/task'
import { taskFixtures, taskHistoryFixtures } from '@/shared/mock/fixtures/task'
import { isNotionSynced, toTask, toTaskHistory } from './mapper'

const taskDtos: TaskDto[] = taskFixtures.map((row) => ({ ...row, auto_blocked: false }))

it('maps snake case, version and Notion sync status while retaining date strings', () => {
  expect(toTask(taskDtos[0])).toEqual({
    id: 'tk_01',
    workspaceId: 'ws_01',
    meetingId: 'mt_09',
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
    expect(toTask({ ...taskDtos[0], status: 'future' }).status).toBe('todo')
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

describe('버전', () => {
  it('서버 정수 버전을 그대로 읽는다', () => {
    expect(toTask({ ...taskDtos[0], version: 7 }).version).toBe(7)
  })

  it.each([
    ['소수', 1.5],
    ['NaN', Number.NaN],
    ['무한대', Number.POSITIVE_INFINITY],
    ['문자열', '3'],
    ['null', null],
    ['없음', undefined],
  ])('version 이 %s 이면 매핑하지 않고 잘못된 응답으로 던진다', (_label, version) => {
    const dto = { ...taskDtos[0], version } as unknown as TaskDto
    expect(() => toTask(dto)).toThrow(ApiError)
    expect(() => toTask(dto)).toThrow(
      expect.objectContaining({ code: 'INVALID_RESPONSE', kind: 'invalid_response' }) as Error,
    )
  })
})

describe('자동 막힘', () => {
  it.each([
    [true, true],
    [false, false],
  ])('auto_blocked %s 를 그대로 읽는다', (raw, autoBlocked) => {
    expect(toTask({ ...taskDtos[2], status: 'blocked', auto_blocked: raw }).autoBlocked).toBe(
      autoBlocked,
    )
  })

  it.each([
    ['문자열', 'true'],
    ['숫자', 1],
    ['null', null],
    ['없음', undefined],
  ])('auto_blocked 가 %s 이면 던지지 않고 풀 수 없는 것(false)으로 읽는다', (_label, raw) => {
    const dto = { ...taskDtos[2], status: 'blocked', auto_blocked: raw } as unknown as TaskDto
    expect(toTask(dto).autoBlocked).toBe(false)
  })
})
