import { asrSuspectLine } from './asrSuspect'

describe('전사 오인식 의심 문구 (#643)', () => {
  it('후보가 하나면 그 말일 수 있다고 한다', () => {
    expect(asrSuspectLine({ kind: 'misheard', word: '애포', candidates: ['배포'] })).toBe(
      "'애포'는 '배포'일 수 있어요",
    )
  })

  it('후보가 여럿이면 그중 하나일 수 있다고 한다', () => {
    expect(asrSuspectLine({ kind: 'misheard', word: '애포', candidates: ['배포', '애플'] })).toBe(
      "'애포'는 '배포', '애플' 중 하나일 수 있어요",
    )
  })

  it('후보가 없으면 다시 확인하라고 한다', () => {
    expect(asrSuspectLine({ kind: 'misheard', word: '폴런', candidates: [] })).toBe(
      "'폴런'을 다시 확인해 주세요",
    )
    expect(asrSuspectLine({ kind: 'misheard', word: '애포', candidates: [] })).toBe(
      "'애포'를 다시 확인해 주세요",
    )
  })

  it('조사는 들린 말의 받침을 따르고, 한글로 끝나지 않으면 둘 다 적는다', () => {
    expect(asrSuspectLine({ kind: 'misheard', word: '폴런', candidates: ['풀런'] })).toBe(
      "'폴런'은 '풀런'일 수 있어요",
    )
    expect(asrSuspectLine({ kind: 'misheard', word: 'API', candidates: ['에이피아이'] })).toBe(
      "'API'은(는) '에이피아이'일 수 있어요",
    )
  })

  it('확인하지 못했으면 그렇게 알린다', () => {
    expect(asrSuspectLine({ kind: 'check_failed' })).toBe('전사 확인을 하지 못했어요')
  })
})
