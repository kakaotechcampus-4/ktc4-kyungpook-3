import type { TaskHistoryEntry } from '@/entities/task'
import { historyLine } from './history'

const names = new Map([['mb_01', '김서연']])

function entry(overrides: Partial<TaskHistoryEntry>): TaskHistoryEntry {
  return {
    id: 'hs_01',
    taskId: 'tk_01',
    field: 'status',
    oldValue: 'todo',
    newValue: 'in_progress',
    source: 'manual',
    changedBy: 'mb_01',
    isAuto: false,
    isRolledBack: false,
    rolledBackAt: null,
    createdAt: '2026-09-16T06:00:00Z',
    ...overrides,
  }
}

describe('변경 이력 한 줄', () => {
  it('범위 변경은 이전 값 없이 결정 문장만 보인다 (#205)', () => {
    const line = historyLine(
      entry({
        field: 'scope',
        oldValue: null,
        newValue: '소셜 로그인은 이번 범위에서 빼기로 했어요.',
        source: 'meeting',
      }),
      names,
    )
    expect(line.change).toBe('범위 변경: 소셜 로그인은 이번 범위에서 빼기로 했어요.')
    expect(line.meta).toBe('김서연 · 회의 · 2026-09-16 15:00')
  })

  it.each([null, ''])('범위 문장이 없으면(%j) 없음이다', (newValue) => {
    expect(historyLine(entry({ field: 'scope', oldValue: null, newValue }), names).change).toBe(
      '범위 변경: 없음',
    )
  })

  it('다른 필드는 그대로 이전 → 이후다', () => {
    expect(historyLine(entry({}), names).change).toBe('상태: 할 일 → 진행 중')
    expect(
      historyLine(entry({ field: 'due_date', oldValue: null, newValue: '2026-09-20' }), names)
        .change,
    ).toBe('마감: 없음 → 2026-09-20')
  })
})
