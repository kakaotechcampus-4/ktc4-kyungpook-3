import { OVERRIDE_FORM_MESSAGES, overridesSchema, toTaskCreateFields } from './overridesSchema'
import type { OverrideFormValues } from './overridesSchema'

const MEMBERS = ['mb_01', 'mb_02']
const VALID: OverrideFormValues = {
  taskTitle: '알림 문구 검토',
  assigneeMemberId: 'mb_02',
  dueDate: '2026-10-15',
}

function errors(values: Partial<OverrideFormValues>): Record<string, string> {
  const result = overridesSchema(MEMBERS).safeParse({ ...VALID, ...values })
  if (result.success) return {}
  return Object.fromEntries(
    result.error.issues.map(({ path, message }) => [String(path[0]), message]),
  )
}

describe('생성 승인 보완 스키마 (계획 §4-2)', () => {
  it('통과하면 제목의 앞뒤 공백을 지운 값을 돌려준다', () => {
    const parsed = overridesSchema(MEMBERS).parse({ ...VALID, taskTitle: '  제목  ' })
    expect(parsed).toEqual({ ...VALID, taskTitle: '제목' })
  })

  it.each([
    ['', OVERRIDE_FORM_MESSAGES.titleRequired],
    ['   ', OVERRIDE_FORM_MESSAGES.titleRequired],
    ['가'.repeat(301), OVERRIDE_FORM_MESSAGES.titleTooLong],
    ['😀'.repeat(301), OVERRIDE_FORM_MESSAGES.titleTooLong],
  ])('제목 %j 는 제목 칸의 오류다', (taskTitle, message) => {
    expect(errors({ taskTitle })).toEqual({ taskTitle: message })
  })

  it.each([['가'], ['가'.repeat(300)], ['😀'.repeat(300)], [` ${'가'.repeat(300)} `]])(
    '제목 길이 경계 %#: trim 뒤 코드 포인트 1~300자는 받는다',
    (taskTitle) => {
      expect(errors({ taskTitle })).toEqual({})
    },
  )

  it.each([[''], ['mb_99']])('담당자 %j 는 현재 공간 팀원이 아니라 담당자 칸의 오류다', (id) => {
    expect(errors({ assigneeMemberId: id })).toEqual({
      assigneeMemberId: OVERRIDE_FORM_MESSAGES.assignee,
    })
  })

  it.each([
    ['', OVERRIDE_FORM_MESSAGES.dueRequired],
    ['0000-01-01', OVERRIDE_FORM_MESSAGES.dueInvalid],
    ['2026-02-30', OVERRIDE_FORM_MESSAGES.dueInvalid],
    ['2026-9-1', OVERRIDE_FORM_MESSAGES.dueInvalid],
    ['10000-01-01', OVERRIDE_FORM_MESSAGES.dueInvalid],
    ['2026-10-15T00:00:00Z', OVERRIDE_FORM_MESSAGES.dueInvalid],
  ])('마감 %j 는 마감 칸의 오류다', (dueDate, message) => {
    expect(errors({ dueDate })).toEqual({ dueDate: message })
  })

  it.each([['0001-01-01'], ['9999-12-31'], ['2028-02-29']])('마감 %s 는 받는다', (dueDate) => {
    expect(errors({ dueDate })).toEqual({})
  })

  it('세 칸이 모두 틀리면 세 칸 모두 오류다', () => {
    expect(Object.keys(errors({ taskTitle: '', assigneeMemberId: '', dueDate: '' }))).toEqual([
      'taskTitle',
      'assigneeMemberId',
      'dueDate',
    ])
  })

  it('고르지 않은 담당자·마감은 null 로 넘긴다', () => {
    expect(toTaskCreateFields({ taskTitle: 't', assigneeMemberId: '', dueDate: '' })).toEqual({
      taskTitle: 't',
      assigneeMemberId: null,
      dueDate: null,
    })
  })
})
