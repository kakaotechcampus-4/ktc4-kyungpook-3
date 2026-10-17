import { toApproval } from '@/entities/approval'
import { toExtraction } from '@/entities/extraction'
import type { ExtractionItem } from '@/entities/extraction'
import { toMeetingSummary } from '@/entities/meeting'
import { toTask } from '@/entities/task'
import type { Task } from '@/entities/task'
import { approvalFixtures } from '@/shared/mock/fixtures/approval'
import { MOCK_TODAY } from '@/shared/mock/fixtures/constants'
import { extractionFixtures } from '@/shared/mock/fixtures/extraction'
import { meetingSummaryFixtures } from '@/shared/mock/fixtures/meeting'
import { taskFixtures } from '@/shared/mock/fixtures/task'
import {
  LIST_LIMIT,
  RECENT_LIMIT,
  approvalReason,
  dateWithWeekday,
  dueSoonTasks,
  durationLabel,
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
})

describe('최근 반영 (AC-03 판정부)', () => {
  const extraction = toExtraction(extractionFixtures[1])
  const byId = new Map(tasks.map((each) => [each.id, each]))

  it('최신 완료 회의는 시작 시각이 가장 늦은 정리 끝난 회의다 — 정리 중 회의는 아니다', () => {
    const meetings = meetingSummaryFixtures.map(toMeetingSummary)
    expect(latestDoneMeeting(meetings)?.id).toBe('mt_09')
    expect(latestDoneMeeting(meetings.filter(({ status }) => status !== 'done'))).toBeNull()
  })

  it('gate=auto 항목만 응답 순서대로 최대 3개다', () => {
    const many: ExtractionItem[] = [
      ...extraction.items,
      { ...extraction.items[0], id: 'it_90' },
      { ...extraction.items[1], id: 'it_91' },
    ]
    expect(recentAutoItems(many).map(({ id }) => id)).toEqual(['it_01', 'it_02', 'it_03'])
    expect(RECENT_LIMIT).toBe(3)
    expect(recentAutoItems(extraction.items.filter(({ gate }) => gate !== 'auto'))).toEqual([])
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
