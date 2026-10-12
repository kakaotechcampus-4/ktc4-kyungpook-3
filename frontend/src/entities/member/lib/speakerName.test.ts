import { memberFixtures } from '@/shared/mock/fixtures/member'
import { toMember } from '../model/mapper'
import { speakerName } from './speakerName'

const members = memberFixtures.map(toMember)

describe('speakerName', () => {
  it('Discord uid 로 연결한 팀원 이름을 찾는다', () => {
    expect(speakerName(members, '1123')).toBe('김서연')
  })

  it('연결한 팀원이 없거나 팀원 목록이 아직 없으면 uid 를 이름으로 쓰지 않는다', () => {
    expect(speakerName(members, '9999')).toBeNull()
    expect(speakerName(undefined, '1123')).toBeNull()
    expect(speakerName(members, null)).toBeNull()
  })
})
