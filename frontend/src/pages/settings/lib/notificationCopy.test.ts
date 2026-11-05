import { existingSuggestionNote, pmWebOnlyNotice } from './notificationCopy'

const pm = (name: string, discordLinked: boolean) => ({ memberId: name, name, discordLinked })

describe('웹으로만 안내', () => {
  it('Discord 가 연결되지 않은 PM 이 없으면 안내하지 않는다', () => {
    expect(pmWebOnlyNotice([pm('김서연', true), pm('박민수', true)])).toBeNull()
    expect(pmWebOnlyNotice([])).toBeNull()
  })

  it('모든 PM 이 연결되지 않았으면 이름 없이 안내한다', () => {
    expect(pmWebOnlyNotice([pm('김서연', false)])).toBe('Discord가 연결되지 않아 웹으로만 알려요')
    expect(pmWebOnlyNotice([pm('김서연', false), pm('박민수', false)])).toBe(
      'Discord가 연결되지 않아 웹으로만 알려요',
    )
  })

  it('일부만 연결되지 않았으면 그 PM 들의 이름을 붙인다', () => {
    expect(pmWebOnlyNotice([pm('김서연', true), pm('박민수', false)])).toBe(
      '박민수님은 Discord가 연결되지 않아 웹으로만 알려요',
    )
    expect(pmWebOnlyNotice([pm('김서연', false), pm('박민수', true), pm('정하늘', false)])).toBe(
      '김서연님, 정하늘님은 Discord가 연결되지 않아 웹으로만 알려요',
    )
  })
})

describe('이미 만든 재촉 제안 안내', () => {
  const DEFAULT =
    '설정을 바꿔도 이미 만든 재촉 제안은 그대로예요. 새 설정은 다음 제안부터 적용돼요.'

  it('자동 승인인 채 재촉 제안을 끈 경우만 예외 문구다', () => {
    expect(existingSuggestionNote({ reminderAutoApprove: true, dueReminder: false })).toBe(
      '재촉 제안을 꺼서 이미 만든 제안도 자동으로 나가지 않아요. PM이 넣은 재촉과 묶인 제안은 빠져요.',
    )
    expect(existingSuggestionNote({ reminderAutoApprove: true, dueReminder: true })).toBe(DEFAULT)
    expect(existingSuggestionNote({ reminderAutoApprove: false, dueReminder: false })).toBe(DEFAULT)
    expect(existingSuggestionNote({ reminderAutoApprove: false, dueReminder: true })).toBe(DEFAULT)
  })
})
