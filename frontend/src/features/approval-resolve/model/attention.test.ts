import type { TaskCreateFields } from '@/entities/approval'
import { fieldAttention, openGaps } from './attention'

const FILLED: TaskCreateFields = {
  taskTitle: '알림 문구 검토',
  assigneeMemberId: 'mb_02',
  dueDate: '2026-09-21',
}

describe('fieldAttention — 빠진 값 표시의 한 곳', () => {
  it.each([
    [
      'AI 가 정하지 못한 담당자·마감이 아직 비어 있으면 missing',
      ['assignee', 'due'],
      { assigneeMemberId: null, dueDate: null },
      [],
      { title: null, assignee: 'missing', due: 'missing' },
    ],
    [
      'PM 이 채운 빠진 값은 더는 표시하지 않는다',
      ['assignee', 'due'],
      {},
      [],
      { title: null, assignee: null, due: null },
    ],
    [
      '처음부터 있던 값을 PM 이 미정으로 비운 것은 빠진 값이 아니다',
      [],
      { assigneeMemberId: null, dueDate: null },
      [],
      { title: null, assignee: null, due: null },
    ],
    [
      '승인할 수 없는 값은 빠진 값보다 먼저 invalid',
      ['due'],
      { taskTitle: '  ', dueDate: '2026-13-01' },
      ['title', 'due'],
      { title: 'invalid', assignee: null, due: 'invalid' },
    ],
  ] as const)('%s', (_, missing, fields, issues, expected) => {
    expect(fieldAttention(missing, { ...FILLED, ...fields }, issues)).toEqual(expected)
  })

  it('openGaps 는 아직 빈 빠진 값만 화면 순서(담당자 → 마감)로 돌려준다', () => {
    expect(openGaps({ title: 'invalid', assignee: 'missing', due: 'missing' })).toEqual([
      'assignee',
      'due',
    ])
    expect(openGaps({ title: null, assignee: 'invalid', due: 'missing' })).toEqual(['due'])
  })
})
