import { toApproval } from '@/entities/approval'
import { toExtraction } from '@/entities/extraction'
import type { ExtractionItem } from '@/entities/extraction'
import { latestMinutesId, toMeetingSummary } from '@/entities/meeting'
import type { MeetingStatus } from '@/entities/meeting'
import { toTask } from '@/entities/task'
import type { Task } from '@/entities/task'
import { approvalFixtures } from '@/shared/mock/fixtures/approval'
import { MOCK_TODAY } from '@/shared/mock/fixtures/constants'
import { extractionFixtures } from '@/shared/mock/fixtures/extraction'
import { meetingSummaryFixtures } from '@/shared/mock/fixtures/meeting'
import { taskFixtures } from '@/shared/mock/fixtures/task'
import {
  LIST_LIMIT,
  RECENT_MORE_LINE_PX,
  RECENT_ROWS,
  approvalReason,
  dateWithWeekday,
  dueSoonTasks,
  durationLabel,
  fitRecentRows,
  hasPendingSync,
  latestDoneMeeting,
  monthDayLabel,
  objectParticle,
  recentAutoItems,
  recentEmptyReason,
  recentSyncState,
  revertOutcome,
  taskCounts,
  waitingApprovals,
} from './dashboard'

/*
 * M7 대시보드 조립의 순수 판정 (AC-01 · AC-03 판정부). 화면 통합은 app/dashboard.test.tsx 가 본다.
 * 픽스처: ws_01 의 태스크 10건, 대기 승인 3건, 최신 완료 회의 mt_09(auto 항목 it_01~it_03), 서울 오늘 2026-09-18.
 */

const tasks = taskFixtures.map(toTask)
const base = tasks[0]

function task(id: string, patch: Partial<Task> = {}): Task {
  return { ...base, id, title: id, ...patch }
}

describe('요약 집계 (AC-01)', () => {
  const today = '2026-09-18'

  it.each([
    ['어제', '2026-09-17', 'todo', { overdue: 1, dueSoon: 0 }],
    ['오늘', '2026-09-18', 'in_progress', { overdue: 0, dueSoon: 1 }],
    ['오늘+6일(마지막 날)', '2026-09-24', 'blocked', { overdue: 0, dueSoon: 1 }],
    ['오늘+7일', '2026-09-25', 'todo', { overdue: 0, dueSoon: 0 }],
    ['마감 없음', null, 'todo', { overdue: 0, dueSoon: 0 }],
    ['완료(어제 마감)', '2026-09-17', 'done', { overdue: 0, dueSoon: 0 }],
    ['완료(오늘 마감)', '2026-09-18', 'done', { overdue: 0, dueSoon: 0 }],
  ] as const)('%s', (_, dueDate, status, expected) => {
    expect(taskCounts([task('tk_x', { dueDate, status })], today)).toMatchObject(expected)
  })

  it.each([
    ['월 경계', '2026-09-28', ['2026-09-27', '2026-10-04', '2026-10-05']],
    ['연 경계', '2026-12-29', ['2026-12-28', '2027-01-04', '2027-01-05']],
    ['윤년 2월', '2028-02-25', ['2028-02-24', '2028-03-02', '2028-03-03']],
  ] as const)('%s 에서도 어제·+6일·+7일이 갈린다', (_, today, [yesterday, last, after]) => {
    const list = [
      task('a', { dueDate: yesterday, status: 'todo' }),
      task('b', { dueDate: last, status: 'todo' }),
      task('c', { dueDate: after, status: 'todo' }),
    ]
    expect(taskCounts(list, today)).toMatchObject({ overdue: 1, dueSoon: 1 })
    expect(dueSoonTasks(list, today).map(({ id }) => id)).toEqual(['a', 'b'])
  })

  it('기한 지남과 7일 이내는 겹치지 않고, 마감 임박 목록 길이와 둘의 합이 같다', () => {
    const counts = taskCounts(tasks, MOCK_TODAY)
    expect(counts).toEqual({ overdue: 2, dueSoon: 4, blocked: 1 })
    const due = dueSoonTasks(tasks, MOCK_TODAY)
    expect(due).toHaveLength(counts.overdue + counts.dueSoon)
    expect(new Set(due.map(({ id }) => id)).size).toBe(due.length)
  })

  // 태스크 목록 `due=overdue,soon` 과 같은 대상인지는 app/dashboard.test.tsx 의 `전체 보기` 이동이 본다 (widget 끼리는 서로 부르지 않는다)
  it('화면에는 5개만 보여도 마감 임박 대상은 전체다', () => {
    expect(dueSoonTasks(tasks, MOCK_TODAY).length).toBeGreaterThan(LIST_LIMIT)
  })

  it('막힌 일은 blocked 상태 수다', () => {
    expect(
      taskCounts(
        [task('a', { status: 'blocked', dueDate: null }), task('b', { status: 'todo' })],
        MOCK_TODAY,
      ).blocked,
    ).toBe(1)
  })
})

describe('정렬 (AC-02 판정부)', () => {
  it('마감 임박은 기한 지남이 먼저, 그다음 가까운 마감 순이다', () => {
    expect(dueSoonTasks(tasks, MOCK_TODAY).map(({ id }) => id)).toEqual([
      'tk_07',
      'tk_02',
      'tk_06',
      'tk_01',
      'tk_03',
      'tk_04',
    ])
  })

  it('확인 필요는 대기 시작 오래된 순이고 대기 중인 것만이다', () => {
    const approvals = approvalFixtures.map(toApproval)
    const resolved = { ...approvals[0], status: 'approved' as const }
    expect(waitingApprovals([approvals[2], resolved, approvals[1]]).map(({ id }) => id)).toEqual([
      'ap_02',
      'ap_03',
    ])
    expect(waitingApprovals(approvals).map(({ id }) => id)).toEqual(['ap_01', 'ap_02', 'ap_03'])
  })

  it('확인 필요 사유 문구', () => {
    const [hold, review] = approvalFixtures.map(toApproval)
    expect(approvalReason(hold)).toBe('정보가 부족해 태스크 초안을 만들지 않았어요')
    expect(approvalReason(review)).toBe('마감을 정해야 해요')
  })

  it('범위 변경 승인은 바꿀 값이 있어도 범위 변경을 확인하라고 한다 (#205)', () => {
    const update = (payload: Record<string, unknown>) =>
      toApproval({ ...approvalFixtures[0], type: 'task_update', payload })
    expect(approvalReason(update({ category: 'scope' }))).toBe('범위 변경을 확인해야 해요')
    expect(approvalReason(update({ category: 'scope', due_date: '2026-09-30' }))).toBe(
      '범위 변경을 확인해야 해요',
    )
    expect(approvalReason(update({ category: 'schedule', due_date: '2026-09-30' }))).toBe(
      '변경 제안을 확인해야 해요',
    )
  })
})

describe('최근 반영 (AC-03 판정부)', () => {
  const extraction = toExtraction(extractionFixtures[1])
  const byId = new Map(tasks.map((each) => [each.id, each]))

  it('최신 완료 회의는 시작 시각이 가장 늦은 정리 끝난 회의다 — 정리 중 회의는 아니다', () => {
    const meetings = meetingSummaryFixtures.map(toMeetingSummary)
    expect(latestDoneMeeting(meetings)?.id).toBe('mt_09')
    expect(latestDoneMeeting(meetings.filter(({ status }) => status !== 'done'))).toBeNull()
  })

  it('지워진(404) 회의를 빼면 그다음 완료 회의를 고르고, 모두 빼면 null 이다 (#405)', () => {
    const meetings = meetingSummaryFixtures.map(toMeetingSummary)
    expect(latestDoneMeeting(meetings, new Set(['mt_09']))?.id).toBe('mt_08')
    expect(latestDoneMeeting(meetings, new Set(['mt_09', 'mt_08']))?.id).toBe('mt_07')
    expect(latestDoneMeeting(meetings, new Set(['mt_09', 'mt_08', 'mt_07']))).toBeNull()
  })

  describe('최신 완료 회의 선택 기준 (#350)', () => {
    const [summary] = meetingSummaryFixtures.map(toMeetingSummary)
    const meeting = (id: string, startedAt: string, status: MeetingStatus = 'done') => ({
      ...summary,
      id,
      startedAt,
      status,
    })

    it('빈 목록이면 null 이다', () => {
      expect(latestDoneMeeting([])).toBeNull()
    })

    it('서버 순서와 상관없이 시작 시각이 가장 늦은 완료 회의다 — 더 늦은 미완료 회의는 건너뛴다', () => {
      const meetings = [
        meeting('old', '2026-09-01T01:00:00Z'),
        meeting('processing', '2026-09-20T01:00:00Z', 'processing'),
        meeting('newest', '2026-09-15T01:00:00Z'),
        meeting('failed', '2026-09-19T01:00:00Z', 'failed'),
        meeting('middle', '2026-09-10T01:00:00Z'),
      ]
      expect(latestDoneMeeting(meetings)).toBe(meetings[2])
    })

    it('시각은 문자열이 아니라 시점으로 비교한다', () => {
      const meetings = [
        meeting('utc', '2026-09-15T00:30:00Z'),
        meeting('seoul', '2026-09-15T09:00:00+09:00'),
      ]
      expect(latestDoneMeeting(meetings)?.id).toBe('utc')
    })

    it('같은 시작 시각이면 받은 순서에서 앞의 회의다', () => {
      const meetings = [
        meeting('older', '2026-09-01T01:00:00Z'),
        meeting('first', '2026-09-15T01:00:00Z'),
        meeting('second', '2026-09-15T01:00:00Z'),
      ]
      expect(latestDoneMeeting(meetings)?.id).toBe('first')
      expect(latestDoneMeeting([meetings[2], meetings[1]])?.id).toBe('second')
    })

    it('시작 시각을 읽을 수 없는 완료 회의는 날짜가 있는 회의보다 뒤다', () => {
      const meetings = [
        meeting('missing', ''),
        meeting('broken', 'not-a-date'),
        meeting('dated', '2020-01-01T00:00:00Z'),
      ]
      expect(latestDoneMeeting(meetings)?.id).toBe('dated')
    })

    it('모든 완료 회의의 시작 시각을 읽을 수 없으면 받은 순서에서 앞의 완료 회의다', () => {
      const meetings = [
        meeting('processing', '2026-09-20T01:00:00Z', 'processing'),
        meeting('broken', 'not-a-date'),
        meeting('missing', ''),
      ]
      expect(latestDoneMeeting(meetings)?.id).toBe('broken')
    })

    it('회의록 기본 진입과 같은 회의를 고른다', () => {
      const statuses: MeetingStatus[] = ['created', 'recording', 'processing', 'done', 'failed']
      const times = [
        '2026-09-01T01:00:00Z',
        '2026-09-15T01:00:00Z',
        '2026-09-15T10:00:00+09:00',
        '',
      ]
      let seed = 350
      const next = (size: number) => {
        seed = (seed * 48_271) % 2_147_483_647
        return seed % size
      }
      for (let round = 0; round < 200; round += 1) {
        const meetings = Array.from({ length: next(8) }, (_, index) =>
          meeting(`mt_${index}`, times[next(times.length)], statuses[next(statuses.length)]),
        )
        expect(latestDoneMeeting(meetings)?.id ?? null).toBe(latestMinutesId(meetings))
      }
    })
  })

  it('gate=auto 항목만 응답 순서대로 전부다 — 몇 개를 보일지는 화면이 잰다 (D-176)', () => {
    const many: ExtractionItem[] = [
      ...extraction.items,
      { ...extraction.items[0], id: 'it_90' },
      { ...extraction.items[1], id: 'it_91' },
    ]
    expect(recentAutoItems(many).map(({ id }) => id)).toEqual([
      'it_01',
      'it_02',
      'it_03',
      'it_90',
      'it_91',
    ])
    expect(RECENT_ROWS).toEqual({ min: 3, max: 8 })
    expect(RECENT_MORE_LINE_PX).toBe(32)
    expect(recentAutoItems(extraction.items.filter(({ gate }) => gate !== 'auto'))).toEqual([])
  })

  describe('보일 행 수 (D-176)', () => {
    const rows = (count: number, height = 50) => Array.from({ length: count }, () => height)

    it.each([
      ['잰 높이가 없으면 3개', { available: 900, heights: [], total: 12 }, 3],
      [
        '잰 높이가 없고 항목이 2개면 2개',
        { available: 900, heights: [undefined, undefined], total: 2 },
        2,
      ],
      ['항목이 2개면 늘 2개다 — 채우지 않는다', { available: 900, heights: rows(2), total: 2 }, 2],
      [
        '5개가 모두 들어가면 5개 — 외 N건 줄이 없어 그 높이를 빼지 않는다',
        { available: 250, heights: rows(5), total: 5 },
        5,
      ],
      [
        '5개 중 4개만 들어가면 외 N건 줄을 뺀 높이로 다시 센다',
        { available: 230, heights: rows(5), total: 5 },
        3,
      ],
      ['외 N건 줄을 빼도 4개가 들어가면 4개', { available: 232, heights: rows(5), total: 5 }, 4],
      ['넉넉하면 8개까지다', { available: 2000, heights: rows(8), total: 12 }, 8],
      ['좁으면 3개 아래로 줄이지 않는다', { available: 40, heights: rows(8), total: 12 }, 3],
      ['남은 높이가 음수여도 3개다', { available: -100, heights: rows(8), total: 12 }, 3],
      [
        '못 잰 행은 바로 앞에서 잰 높이로 친다',
        { available: 332, heights: [50, 50, 50, undefined, 100, undefined], total: 12 },
        5,
      ],
      [
        '앞 행을 못 쟀으면 처음 잰 높이로 친다',
        { available: 282, heights: [undefined, 50, undefined], total: 12 },
        5,
      ],
    ] as const)('%s', (_, input, expected) => {
      expect(fitRecentRows({ ...input, moreLine: RECENT_MORE_LINE_PX })).toBe(expected)
    })

    it('8개가 넘으면 다 들어가도 외 N건 줄을 둔다', () => {
      expect(fitRecentRows({ available: 400, heights: rows(8), total: 9, moreLine: 32 })).toBe(7)
    })
  })

  it('상태는 태스크의 notion_sync_status 로 정하고, 되돌림이 가장 먼저다', () => {
    const [first, second] = extraction.items
    expect(recentSyncState(first, byId)).toBe('synced')
    expect(recentSyncState(second, byId)).toBe('none')
    expect(
      recentSyncState(
        second,
        new Map([['tk_02', { ...byId.get('tk_02')!, notionSyncStatus: 'pending' }]]),
      ),
    ).toBe('pending')
    expect(
      recentSyncState(
        second,
        new Map([['tk_02', { ...byId.get('tk_02')!, notionSyncStatus: 'failed' }]]),
      ),
    ).toBe('failed')
    expect(
      recentSyncState(
        { ...first, revertedAt: '2026-09-18T00:00:00Z', appliedTaskId: null, approvalId: 'ap_90' },
        byId,
      ),
    ).toBe('reverted')
    expect(recentSyncState(first, null)).toBe('unknown')
    expect(recentSyncState(first, new Map())).toBe('unknown')
  })

  describe('되돌린 뒤의 지금 상태 (E-03)', () => {
    const base = extraction.items[1]
    const reverted = (patch: Partial<ExtractionItem>): ExtractionItem => ({
      ...base,
      revertedAt: '2026-09-18T00:00:00Z',
      appliedTaskId: null,
      approvalId: 'ap_90',
      approvalStatus: 'pending',
      ...patch,
    })
    const newTask = (notionSyncStatus: Task['notionSyncStatus']) =>
      new Map([['tk_90', { ...byId.get('tk_02')!, id: 'tk_90', notionSyncStatus }]])

    it.each([
      ['되돌리지 않음', { revertedAt: null, appliedTaskId: 'tk_02', approvalStatus: null }, null],
      ['승인 대기', {}, 'waiting'],
      ['승인 상태 모름', { approvalStatus: null }, 'waiting'],
      [
        '승인돼 태스크가 다시 생김',
        { approvalStatus: 'approved', appliedTaskId: 'tk_90' },
        'approved',
      ],
      ['승인됐지만 태스크가 아직 없음', { approvalStatus: 'approved' }, 'waiting'],
      ['반려', { approvalStatus: 'rejected' }, 'rejected'],
    ] as const)('%s → %s', (_, patch, expected) => {
      expect(revertOutcome(reverted(patch))).toBe(expected)
    })

    it('대기·반려는 되돌림, 승인돼 다시 생긴 태스크는 그 태스크의 반영 상태다', () => {
      expect(recentSyncState(reverted({}), byId)).toBe('reverted')
      expect(recentSyncState(reverted({ approvalStatus: 'rejected' }), byId)).toBe('reverted')
      const approved = reverted({ approvalStatus: 'approved', appliedTaskId: 'tk_90' })
      for (const status of ['pending', 'synced', 'failed'] as const)
        expect(recentSyncState(approved, newTask(status))).toBe(status)
      expect(recentSyncState(approved, newTask(null))).toBe('none')
      expect(recentSyncState(approved, new Map())).toBe('unknown')
      expect(recentSyncState(approved, null)).toBe('unknown')
    })

    it('polling 은 행 판정과 같다 — 승인돼 다시 생긴 태스크가 반영 대기면 돌고, 대기·반려 행은 돌지 않는다', () => {
      const approved = reverted({ approvalStatus: 'approved', appliedTaskId: 'tk_90' })
      const pendingTask = {
        ...byId.get('tk_02')!,
        id: 'tk_90',
        notionSyncStatus: 'pending' as const,
      }
      expect(hasPendingSync([approved], [pendingTask])).toBe(true)
      expect(hasPendingSync([approved], [{ ...pendingTask, notionSyncStatus: 'synced' }])).toBe(
        false,
      )
      expect(hasPendingSync([reverted({})], [pendingTask])).toBe(false)
      expect(hasPendingSync([reverted({ approvalStatus: 'rejected' })], [pendingTask])).toBe(false)
    })
  })

  it('반영 대기 행이 있을 때만 polling 한다', () => {
    const items = recentAutoItems(extraction.items)
    expect(hasPendingSync(items, tasks)).toBe(false)
    const pending = tasks.map((each) =>
      each.id === 'tk_03' ? { ...each, notionSyncStatus: 'pending' as const } : each,
    )
    expect(hasPendingSync(items, pending)).toBe(true)
    // 되돌린 행은 태스크가 없다 — 남은 pending 태스크가 있어도 그 행 때문에 돌지 않는다
    const reverted = items.map((item) =>
      item.appliedTaskId === 'tk_03' ? { ...item, revertedAt: 'x', appliedTaskId: null } : item,
    )
    expect(hasPendingSync(reverted, pending)).toBe(false)
    // 최근 반영과 무관한 태스크의 pending 은 보지 않는다
    expect(
      hasPendingSync(
        items,
        tasks.map((each) =>
          each.id === 'tk_09' ? { ...each, notionSyncStatus: 'pending' as const } : each,
        ),
      ),
    ).toBe(false)
    expect(hasPendingSync(items, undefined)).toBe(false)
  })

  it('빈 상태는 회의 없음 → Notion 미연결 → 자동 처리 없음 순서로 판정한다', () => {
    const meeting = toMeetingSummary(meetingSummaryFixtures[1])
    const items = recentAutoItems(extraction.items)
    expect(
      recentEmptyReason({ latestMeeting: null, notionStatus: 'not_connected', autoItems: [] }),
    ).toBe('no-meeting')
    for (const status of ['not_connected', 'connecting', 'revoked'] as const)
      expect(
        recentEmptyReason({ latestMeeting: meeting, notionStatus: status, autoItems: items }),
      ).toBe('notion')
    expect(
      recentEmptyReason({ latestMeeting: meeting, notionStatus: 'connected', autoItems: [] }),
    ).toBe('no-auto')
    expect(
      recentEmptyReason({ latestMeeting: meeting, notionStatus: 'connected', autoItems: items }),
    ).toBeNull()
  })
})

describe('표시 문구', () => {
  it('날짜·요일·분량', () => {
    expect(dateWithWeekday('2026-09-18')).toBe('2026-09-18 금요일')
    expect(dateWithWeekday('2027-01-03')).toBe('2027-01-03 일요일')
    expect(monthDayLabel('2026-09-05')).toBe('9월 5일')
    expect(durationLabel(2_730_000)).toBe('46분')
    expect(durationLabel(10_000)).toBe('1분')
    expect(durationLabel(null)).toBeNull()
  })

  it('받침에 따라 을/를을 고른다', () => {
    expect(objectParticle('3주차 정기회의')).toBe('를')
    expect(objectParticle('기획 논의 녹음')).toBe('을')
    expect(objectParticle('Sprint 1')).toBe('을(를)')
  })
})
