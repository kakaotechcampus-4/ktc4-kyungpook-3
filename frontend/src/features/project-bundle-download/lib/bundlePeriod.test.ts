import { checkPeriod } from './bundlePeriod'

describe('checkPeriod', () => {
  it('둘 다 비우면 전체 기간이고 파라미터가 없다', () => {
    expect(checkPeriod({ from: '', to: '' })).toEqual({
      kind: 'ok',
      params: {},
      label: '전체 기간',
    })
  })

  it('한쪽만 적으면 그쪽 끝만 보낸다', () => {
    expect(checkPeriod({ from: '2026-09-01', to: '' })).toEqual({
      kind: 'ok',
      params: { from: '2026-09-01' },
      label: '2026-09-01부터',
    })
    expect(checkPeriod({ from: '', to: ' 2026-09-30 ' })).toEqual({
      kind: 'ok',
      params: { to: '2026-09-30' },
      label: '2026-09-30까지',
    })
  })

  it('같은 날은 하루 기간이다', () => {
    expect(checkPeriod({ from: '2026-09-15', to: '2026-09-15' })).toMatchObject({
      kind: 'ok',
      params: { from: '2026-09-15', to: '2026-09-15' },
    })
  })

  it('시작일이 늦으면 reversed 다', () => {
    expect(checkPeriod({ from: '2026-10-01', to: '2026-09-30' })).toEqual({ kind: 'reversed' })
  })

  it('달력에 없는 날이나 형식이 틀린 칸을 짚는다', () => {
    expect(checkPeriod({ from: '2026-02-30', to: '9월' })).toEqual({
      kind: 'invalid_date',
      fields: { from: true, to: true },
    })
  })
})
