import type { TaskHistoryEntry } from '../model/types'
import { isAutoBlocked } from './autoBlock'

function entry(
  field: TaskHistoryEntry['field'],
  source: TaskHistoryEntry['source'],
  createdAt: string,
  newValue: string | null = 'blocked',
): TaskHistoryEntry {
  return {
    id: `${field}-${source}-${createdAt}`,
    taskId: 'tk_06',
    field,
    oldValue: null,
    newValue,
    source,
    changedBy: null,
    isAuto: source !== 'manual',
    isRolledBack: false,
    rolledBackAt: null,
    createdAt,
  }
}

const blocked = { status: 'blocked' } as const

it('막힌 태스크의 마지막 상태 변경이 스케줄러면 자동 막힘이다', () => {
  expect(
    isAutoBlocked(blocked, [
      entry('blocker', 'manual', '2026-09-18T00:00:00Z', '사람이 적은 사유'),
      entry('status', 'scheduler', '2026-09-17T00:00:00Z'),
      entry('status', 'manual', '2026-09-16T00:00:00Z', 'in_progress'),
    ]),
  ).toBe(true)
})

it('스케줄러 뒤에 사람이 상태를 바꿨거나, 막히지 않았거나, 상태 이력이 없으면 아니다', () => {
  const history = [
    entry('status', 'manual', '2026-09-18T00:00:00Z'),
    entry('status', 'scheduler', '2026-09-17T00:00:00Z'),
  ]
  expect(isAutoBlocked(blocked, history)).toBe(false)
  expect(isAutoBlocked(blocked, [...history].reverse())).toBe(false)
  expect(
    isAutoBlocked({ status: 'in_progress' }, [
      entry('status', 'scheduler', '2026-09-17T00:00:00Z'),
    ]),
  ).toBe(false)
  expect(isAutoBlocked(blocked, [entry('blocker', 'scheduler', '2026-09-17T00:00:00Z')])).toBe(
    false,
  )
})

it('사유 문구가 스케줄러 문구여도 상태 변경이 사람이면 아니다', () => {
  expect(
    isAutoBlocked(blocked, [
      entry('blocker', 'scheduler', '2026-09-17T00:00:00Z', '리마인드에 72시간 동안 응답이 없어요'),
      entry('status', 'manual', '2026-09-17T00:00:00Z'),
    ]),
  ).toBe(false)
})
