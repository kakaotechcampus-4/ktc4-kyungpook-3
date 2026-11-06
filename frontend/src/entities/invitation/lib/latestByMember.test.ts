import type { Invitation } from '../model/types'
import { latestByMember } from './latestByMember'

function invitation(id: string, memberId: string, createdAt: string): Invitation {
  return {
    id,
    memberId,
    email: `${id}@example.com`,
    status: 'canceled',
    acceptedUser: null,
    createdAt,
  }
}

describe('latestByMember', () => {
  it('목록 순서와 상관없이 팀원마다 가장 늦게 만든 초대를 고른다', () => {
    const latest = latestByMember([
      invitation('iv_a', 'mb_03', '2026-11-01T09:00:00Z'),
      invitation('iv_b', 'mb_02', '2026-11-01T08:00:00Z'),
      invitation('iv_c', 'mb_03', '2026-11-02T09:00:00Z'),
      invitation('iv_d', 'mb_03', '2026-10-30T09:00:00Z'),
    ])

    expect([...latest.keys()].sort()).toEqual(['mb_02', 'mb_03'])
    expect(latest.get('mb_03')?.id).toBe('iv_c')
    expect(latest.get('mb_02')?.id).toBe('iv_b')
  })

  it('소수 초가 빠진 시각과 붙은 시각을 시각으로 비교한다', () => {
    const latest = latestByMember([
      invitation('iv_whole', 'mb_03', '2026-11-01T09:00:03Z'),
      invitation('iv_fraction', 'mb_03', '2026-11-01T09:00:03.500Z'),
    ])

    expect(latest.get('mb_03')?.id).toBe('iv_fraction')
  })

  it('시각이 같으면 목록에서 먼저 온 초대를 둔다', () => {
    const latest = latestByMember([
      invitation('iv_first', 'mb_03', '2026-11-01T09:00:00Z'),
      invitation('iv_second', 'mb_03', '2026-11-01T09:00:00Z'),
    ])

    expect(latest.get('mb_03')?.id).toBe('iv_first')
  })

  it('초대가 없으면 빈 결과다', () => {
    expect(latestByMember([]).size).toBe(0)
  })
})
