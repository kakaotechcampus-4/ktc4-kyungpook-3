import type { Workspace } from '@/entities/workspace'
import { findCreatedWorkspace } from './createdWorkspace'

const workspace = (id: string, name: string, role: Workspace['role'] = 'pm'): Workspace => ({
  id,
  name,
  role,
  memberId: 'mb_01',
  createdAt: '2026-11-10T00:00:00Z',
  onboarding: { completed: false, currentStep: 'create_workspace', steps: [] },
})

describe('만들기 응답을 읽지 못한 뒤 방금 만든 공간 찾기 (#634 리뷰)', () => {
  const before = new Set(['ws_01'])

  it('보내기 전에 없던 같은 이름의 PM 공간이 하나면 그 공간이다', () => {
    expect(
      findCreatedWorkspace(
        [workspace('ws_01', '새 팀'), workspace('ws_09', '새 팀')],
        '새 팀',
        before,
      )?.id,
    ).toBe('ws_09')
  })

  it.each([
    ['보내기 전 목록을 몰랐다', [workspace('ws_09', '새 팀')], null],
    ['새 공간이 없다', [workspace('ws_01', '새 팀')], before],
    [
      '같은 이름의 새 공간이 둘이다',
      [workspace('ws_08', '새 팀'), workspace('ws_09', '새 팀')],
      before,
    ],
    ['이름이 다르다', [workspace('ws_09', '다른 팀')], before],
    ['내가 PM 이 아니다', [workspace('ws_09', '새 팀', 'member')], before],
  ])('%s 면 짐작하지 않는다', (_, latest, knownBefore) => {
    expect(findCreatedWorkspace(latest, '새 팀', knownBefore)).toBeNull()
  })
})
