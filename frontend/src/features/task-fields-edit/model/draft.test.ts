import { taskFieldChanges, toTaskFieldsPatch } from './draft'

const ORIGINAL = { assigneeMemberId: 'mb_01', dueDate: '2026-09-20' }

describe('담당자·마감 고친 값', () => {
  it('바뀐 것이 없으면 변경도 본문도 비었다', () => {
    const changes = taskFieldChanges(ORIGINAL, { ...ORIGINAL })
    expect(changes).toEqual([])
    expect(toTaskFieldsPatch(changes)).toEqual({})
  })

  it('담당자만 바꾸면 담당자만 보낸다', () => {
    const changes = taskFieldChanges(ORIGINAL, { ...ORIGINAL, assigneeMemberId: 'mb_02' })
    expect(changes).toEqual([{ field: 'assignee', from: 'mb_01', to: 'mb_02' }])
    expect(toTaskFieldsPatch(changes)).toEqual({ assigneeMemberId: 'mb_02' })
  })

  it('마감을 비우면 null 로 보낸다', () => {
    const changes = taskFieldChanges(ORIGINAL, { ...ORIGINAL, dueDate: null })
    expect(changes).toEqual([{ field: 'dueDate', from: '2026-09-20', to: null }])
    expect(toTaskFieldsPatch(changes)).toEqual({ dueDate: null })
  })

  it('둘 다 바꾸면 담당자, 마감 순서다', () => {
    const changes = taskFieldChanges(
      { assigneeMemberId: null, dueDate: null },
      { assigneeMemberId: 'mb_03', dueDate: '2026-09-26' },
    )
    expect(changes).toEqual([
      { field: 'assignee', from: null, to: 'mb_03' },
      { field: 'dueDate', from: null, to: '2026-09-26' },
    ])
    expect(toTaskFieldsPatch(changes)).toEqual({ assigneeMemberId: 'mb_03', dueDate: '2026-09-26' })
  })
})
