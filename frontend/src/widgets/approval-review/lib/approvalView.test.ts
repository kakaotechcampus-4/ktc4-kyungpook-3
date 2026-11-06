import { fillLabel, gapReason, gapSummary } from './approvalView'

describe('승인 확인 문구 (E-6)', () => {
  it.each([
    [[], null],
    [['assignee'], '담당자가 아직 정해지지 않았어요.'],
    [['due'], '마감이 아직 정해지지 않았어요.'],
    [['assignee', 'due'], '담당자와 마감이 아직 정해지지 않았어요.'],
  ] as const)('제목 아래 안내 %j → %s', (gaps, expected) => {
    expect(gapSummary(gaps)).toBe(expected)
  })

  it.each([
    ['due', '다음 주 월요일', '회의에서는 「다음 주 월요일」이라고만 해서 날짜를 정하지 못했어요'],
    ['due', '모레', '회의에서는 「모레」라고만 해서 날짜를 정하지 못했어요'],
    ['assignee', '민수', '회의에서는 「민수」라고만 해서 담당자를 정하지 못했어요'],
    ['due', null, '회의에서 마감을 말하지 않았어요'],
    ['assignee', '  ', '회의에서 담당자를 말하지 않았어요'],
  ] as const)('까닭 %s · %j', (gap, raw, expected) => {
    expect(gapReason(gap, raw)).toBe(expected)
  })

  it.each([
    ['9/21(월)', '9/21(월)로 채우기'],
    ['9/24(목)', '9/24(목)으로 채우기'],
    ['9/25(금)', '9/25(금)으로 채우기'],
    ['9/22(화)', '9/22(화)로 채우기'],
  ])('채우기 버튼 %s → %s', (date, expected) => {
    expect(fillLabel(date)).toBe(expected)
  })
})
