import { memberNameKey } from './memberName'

describe('memberNameKey', () => {
  it('앞뒤 공백만 다른 이름은 같은 열쇠다', () => {
    expect(memberNameKey('  김서연 ')).toBe(memberNameKey('김서연'))
  })

  it('대소문자와 가운데 공백은 그대로 둔다', () => {
    expect(memberNameKey('Alex')).not.toBe(memberNameKey('alex'))
    expect(memberNameKey('김 서연')).not.toBe(memberNameKey('김서연'))
  })

  it('공백만 있으면 빈 열쇠다', () => {
    expect(memberNameKey('   ')).toBe('')
  })
})
