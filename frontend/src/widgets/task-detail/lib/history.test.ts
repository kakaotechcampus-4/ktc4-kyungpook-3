import type { ReplyChangeLine, TaskHistoryEntry, TaskTimelineItem } from '@/entities/task'
import { historyLine, replyGroup } from './history'

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

describe('답장 한 칸 (#344)', () => {
  const replyNames = new Map([
    ['mb_01', '김서연'],
    ['mb_04', '정민지'],
  ])

  function line(overrides: Partial<ReplyChangeLine>): ReplyChangeLine {
    return {
      id: 'rc_02',
      field: 'status',
      newValue: 'done',
      evidenceStatus: 'certain',
      summary: null,
      evidenceQuote: null,
      result: 'applied',
      undoable: false,
      ...overrides,
    }
  }

  function reply(
    overrides: Partial<Extract<TaskTimelineItem, { kind: 'reply' }>>,
  ): Extract<TaskTimelineItem, { kind: 'reply' }> {
    return {
      kind: 'reply',
      id: 'mg_31',
      at: '2026-09-17T01:00:00Z',
      memberName: '이재환',
      channel: 'discord',
      body: '끝냈어요',
      changes: [],
      ...overrides,
    }
  }

  const changeText = (overrides: Partial<ReplyChangeLine>) =>
    replyGroup(reply({ changes: [line(overrides)] }), replyNames).changes[0].change

  it('누가 어디로 언제 답했는지 한 줄로 보인다', () => {
    expect(replyGroup(reply({}), replyNames).meta).toBe('이재환 답장 · Discord · 2026-09-17 10:00')
    expect(replyGroup(reply({ channel: 'web' }), replyNames).meta).toBe(
      '이재환 답장 · 웹 · 2026-09-17 10:00',
    )
    expect(replyGroup(reply({ channel: null }), replyNames).meta).toBe(
      '이재환 답장 · 2026-09-17 10:00',
    )
  })

  it.each([
    [{ field: 'status', newValue: 'done' }, '상태: 완료'],
    [{ field: 'due_date', newValue: '2026-09-26' }, '마감: 2026-09-26'],
    [{ field: 'assignee', newValue: 'mb_04' }, '담당자: 정민지'],
    [{ field: 'assignee', newValue: '민지' }, '담당자: 민지'],
    [{ field: 'scope', newValue: '소셜 로그인은 빼요' }, '범위 변경: 소셜 로그인은 빼요'],
    [{ field: 'due_clear', newValue: null }, '마감을 없애자는 내용이에요'],
    [{ field: 'failed', newValue: null }, '무엇을 바꿀지 정하지 못했어요'],
    [{ field: 'none', newValue: null }, '바꿀 내용이 없었어요'],
    [{ field: 'unknown', newValue: null }, '어느 태스크인지 정하지 못했어요'],
  ] as const)('%j 는 「%s」다', (overrides, expected) => {
    expect(changeText(overrides)).toBe(expected)
  })

  it.each([
    ['applied', '자동 반영'],
    ['undone', '되돌림'],
    ['pending', '승인 대기'],
    ['approved', '승인함'],
    ['rejected', '반려함'],
    ['noted', '반영하지 않음'],
    ['recorded', '기록함'],
  ] as const)('결과 %s 는 「%s」 태그다', (result, tag) => {
    expect(replyGroup(reply({ changes: [line({ result })] }), replyNames).changes[0].result).toBe(
      tag,
    )
  })

  it('AI 해석과 되돌릴 수 있는지를 줄마다 넘긴다', () => {
    const group = replyGroup(
      reply({
        changes: [
          line({ id: 'rc_02', summary: '끝냈대요', undoable: true }),
          line({ id: 'rc_03', field: 'due_date', newValue: '2026-09-26', result: 'pending' }),
        ],
      }),
      replyNames,
    )
    expect(group.changes.map(({ id, summary, undoable }) => [id, summary, undoable])).toEqual([
      ['rc_02', '끝냈대요', true],
      ['rc_03', null, false],
    ])
  })
})
