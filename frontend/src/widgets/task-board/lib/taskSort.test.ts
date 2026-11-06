import { toApproval } from '@/entities/approval'
import type { Approval } from '@/entities/approval'
import { toTask } from '@/entities/task'
import type { Task } from '@/entities/task'
import { approvalFixtures } from '@/shared/mock/fixtures/approval'
import { taskFixtures } from '@/shared/mock/fixtures/task'
import { toTaskResponse } from '@/shared/mock/task-state'
import {
  TASK_SORTS,
  doneColumnNote,
  sortApprovals,
  sortDoneColumn,
  sortLabel,
  sortTasks,
} from './taskSort'

/* 리스트·보드 정렬 (D-175). 화면에서 고르는 흐름은 app/tasks.test.tsx · app/taskViews.test.tsx 가 본다 */

const base = toTask(toTaskResponse(taskFixtures[0]))
const baseApproval = toApproval(approvalFixtures[0])

function task(id: string, patch: Partial<Task> = {}): Task {
  return { ...base, id, title: id, ...patch }
}

function approval(id: string, createdAt: string): Approval {
  return { ...baseApproval, id, createdAt }
}

const ids = (list: readonly { id: string }[]) => list.map(({ id }) => id)

describe('정렬 선택지', () => {
  it('메뉴 순서는 마감 빠른 순·최근 생성순·최근 변경순이다', () => {
    expect(TASK_SORTS.map(sortLabel)).toEqual(['마감 빠른 순', '최근 생성순', '최근 변경순'])
  })
})

describe('태스크', () => {
  it('마감 빠른 순은 마감 오름차순, 마감 없는 항목은 마지막, 같은 마감은 생성 시각 내림차순이다', () => {
    const sorted = sortTasks(
      [
        task('none_old', { dueDate: null, createdAt: '2026-09-01T00:00:00Z' }),
        task('d20_old', { dueDate: '2026-09-20', createdAt: '2026-09-01T00:00:00Z' }),
        task('none_new', { dueDate: null, createdAt: '2026-09-10T00:00:00Z' }),
        task('d19', { dueDate: '2026-09-19', createdAt: '2026-09-01T00:00:00Z' }),
        task('d20_new', { dueDate: '2026-09-20', createdAt: '2026-09-05T00:00:00Z' }),
      ],
      'due',
    )
    expect(sorted.map(({ id }) => id)).toEqual([
      'd19',
      'd20_new',
      'd20_old',
      'none_new',
      'none_old',
    ])
  })

  it('최근 생성순은 마감과 무관하게 생성 시각 내림차순이다', () => {
    const sorted = sortTasks(
      [
        task('old_soon', { dueDate: '2026-09-18', createdAt: '2026-09-01T00:00:00Z' }),
        task('new_none', { dueDate: null, createdAt: '2026-09-12T00:00:00Z' }),
        task('mid_late', { dueDate: '2026-10-30', createdAt: '2026-09-05T00:00:00Z' }),
      ],
      'created',
    )
    expect(ids(sorted)).toEqual(['new_none', 'mid_late', 'old_soon'])
  })

  it('최근 변경순은 변경 시각 내림차순이고, 같으면 생성 시각 내림차순, 그것도 같으면 받은 순서다', () => {
    const sorted = sortTasks(
      [
        task('same_a', { updatedAt: '2026-09-10T00:00:00Z', createdAt: '2026-09-01T00:00:00Z' }),
        task('old', { updatedAt: '2026-09-02T00:00:00Z', createdAt: '2026-09-02T00:00:00Z' }),
        task('same_b', { updatedAt: '2026-09-10T00:00:00Z', createdAt: '2026-09-01T00:00:00Z' }),
        task('same_new', { updatedAt: '2026-09-10T00:00:00Z', createdAt: '2026-09-08T00:00:00Z' }),
        task('latest', { updatedAt: '2026-09-17T00:00:00Z', createdAt: '2026-09-01T00:00:00Z' }),
      ],
      'updated',
    )
    expect(ids(sorted)).toEqual(['latest', 'same_new', 'same_a', 'same_b', 'old'])
  })

  it('받은 배열을 바꾸지 않는다', () => {
    const list = [
      task('a', { createdAt: '2026-09-01T00:00:00Z' }),
      task('b', { createdAt: '2026-09-02T00:00:00Z' }),
    ]
    for (const sort of TASK_SORTS) {
      expect(sortTasks(list, sort)).not.toBe(list)
      expect(sortDoneColumn(list, sort)).not.toBe(list)
    }
    expect(ids(list)).toEqual(['a', 'b'])
  })
})

describe('확인 필요 승인', () => {
  const approvals = [
    approval('mid', '2026-09-15T06:01:00Z'),
    approval('new', '2026-09-17T02:00:00Z'),
    approval('old', '2026-09-15T06:00:00Z'),
  ]

  it('마감 빠른 순은 지금처럼 대기 시작이 오래된 순이다', () => {
    expect(ids(sortApprovals(approvals, 'due'))).toEqual(['old', 'mid', 'new'])
  })

  it.each(['created', 'updated'] as const)('%s 는 생성 시각 내림차순이다', (sort) => {
    expect(ids(sortApprovals(approvals, sort))).toEqual(['new', 'mid', 'old'])
  })
})

describe('보드 완료 칸', () => {
  const done = [
    task('early_new', { updatedAt: '2026-09-10T00:00:00Z', createdAt: '2026-09-09T00:00:00Z' }),
    task('late_old', { updatedAt: '2026-09-16T00:00:00Z', createdAt: '2026-09-01T00:00:00Z' }),
    task('tie_old', { updatedAt: '2026-09-10T00:00:00Z', createdAt: '2026-09-02T00:00:00Z' }),
  ]

  it('마감 빠른 순이면 지금처럼 최근 완료순이다 — 같은 변경 시각은 받은 순서', () => {
    expect(ids(sortDoneColumn(done, 'due'))).toEqual(['late_old', 'early_new', 'tie_old'])
    expect(doneColumnNote('due')).toBe('최근 완료순')
  })

  it('최근 생성순이면 생성 시각 내림차순이다', () => {
    expect(ids(sortDoneColumn(done, 'created'))).toEqual(['early_new', 'tie_old', 'late_old'])
    expect(doneColumnNote('created')).toBe('최근 생성순')
  })

  it('최근 변경순이면 변경 시각 내림차순, 같으면 생성 시각 내림차순이다', () => {
    const tied = [done[2], done[0], done[1]]
    expect(ids(sortDoneColumn(tied, 'updated'))).toEqual(['late_old', 'early_new', 'tie_old'])
    expect(doneColumnNote('updated')).toBe('최근 변경순')
  })
})
