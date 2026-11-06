import { memberFixtures } from '@/shared/mock/fixtures/member'
import { toMember } from '../model/mapper'
import { speakerName } from './speakerName'

const members = memberFixtures.map(toMember)

describe('speakerName', () => {
  it('Discord uid 로 연결한 팀원 이름을 찾는다', () => {
    expect(speakerName(members, { speaker: '1123', speakerMemberId: null })).toBe('김서연')
  })

  it('팀원 ID 가 있으면 uid 보다 먼저 쓴다 — 업로드 회의는 uid 없이 ID 만 온다 (#256)', () => {
    expect(speakerName(members, { speaker: null, speakerMemberId: 'mb_02' })).toBe('박민수')
    expect(speakerName(members, { speaker: '1123', speakerMemberId: 'mb_02' })).toBe('박민수')
  })

  it('팀원 ID 가 목록에 없으면 uid 로 찾는다', () => {
    expect(speakerName(members, { speaker: '1123', speakerMemberId: 'mb_99' })).toBe('김서연')
  })

  it('연결한 팀원이 없거나 팀원 목록이 아직 없으면 ID·uid 를 이름으로 쓰지 않는다', () => {
    expect(speakerName(members, { speaker: '9999', speakerMemberId: null })).toBeNull()
    expect(speakerName(members, { speaker: null, speakerMemberId: 'mb_99' })).toBeNull()
    expect(speakerName(undefined, { speaker: '1123', speakerMemberId: 'mb_01' })).toBeNull()
    expect(speakerName(members, { speaker: null, speakerMemberId: null })).toBeNull()
  })
})
