import type { DiscordUser, Member } from '@/entities/member'
import type { OnboardingStepStatus, Workspace } from '@/entities/workspace'
import { onboardingExitPath } from '../lib/exitPath'
import { buildMappingRows, findMappingIssues, planRow } from './memberMapping'
import type { MappingOperation, MappingRow } from './memberMapping'
import { planOnboardingUpdates } from './progress'
import {
  clearReturnWorkspace,
  readReturnWorkspace,
  rememberReturnWorkspace,
} from '@/shared/lib/return-workspace'

function workspace(
  statuses: [
    OnboardingStepStatus,
    OnboardingStepStatus,
    OnboardingStepStatus,
    OnboardingStepStatus,
  ],
  overrides: Partial<Workspace> = {},
): Workspace {
  const steps = (
    ['create_workspace', 'connect_discord', 'connect_notion', 'connect_members'] as const
  ).map((step, index) => ({ step, status: statuses[index] }))
  return {
    id: 'ws_09',
    name: '새 팀',
    role: 'pm',
    createdAt: '2026-09-28T00:00:00Z',
    onboarding: {
      completed: statuses.every((status) => status !== 'pending'),
      currentStep: steps.find(({ status }) => status === 'pending')?.step ?? null,
      steps,
    },
    ...overrides,
  }
}

const member = (id: string, displayName: string, discordUserId: string | null): Member => ({
  id,
  workspaceId: 'ws_09',
  displayName,
  discordUserId,
  notionName: null,
  role: 'member',
  createdAt: '2026-09-28T00:00:00Z',
})

const discordUser = (discordUserId: string, username: string, isBot = false): DiscordUser => ({
  discordUserId,
  username,
  displayName: null,
  avatarUrl: null,
  isBot,
})

// D-073 개정(2026-09-29, 사용자 결정): Discord 를 건너뛰어도 팀원 연결을 함께 건너뛰지 않는다.
// 예전 기대(팀원 건너뜀을 덧붙임)를 "팀원 단계는 그대로 pending" 으로 바꿨다
describe('planOnboardingUpdates (D-073 개정)', () => {
  it('Discord 를 건너뛰면 Discord 만 저장한다 — 팀원 연결은 pending 으로 남는다', () => {
    expect(
      planOnboardingUpdates(workspace(['completed', 'pending', 'pending', 'pending']), {
        step: 'connect_discord',
        action: 'skip',
      }),
    ).toEqual([{ step: 'connect_discord', action: 'skip' }])
  })

  it('이미 저장된 단계는 빼고 남은 것만 보낸다 — 재시도는 보낼 것이 없다', () => {
    expect(
      planOnboardingUpdates(workspace(['completed', 'skipped', 'pending', 'pending']), {
        step: 'connect_discord',
        action: 'skip',
      }),
    ).toEqual([])
  })

  it('Discord 가 건너뜀이어도 다음 저장이 팀원 건너뜀을 채우지 않는다', () => {
    expect(
      planOnboardingUpdates(workspace(['completed', 'skipped', 'pending', 'pending']), {
        step: 'connect_notion',
        action: 'complete',
      }),
    ).toEqual([{ step: 'connect_notion', action: 'complete' }])
  })

  it('Discord 를 연결했으면 팀원 연결은 그대로 남는다', () => {
    expect(
      planOnboardingUpdates(workspace(['completed', 'completed', 'pending', 'pending']), {
        step: 'connect_notion',
        action: 'skip',
      }),
    ).toEqual([{ step: 'connect_notion', action: 'skip' }])
  })

  it('건너뛴 Discord 를 둘러보기에서 다시 연결해도 완료 저장은 걸러진다 — 단계 상태는 바꾸지 않는다', () => {
    expect(
      planOnboardingUpdates(workspace(['completed', 'skipped', 'pending', 'pending']), {
        step: 'connect_discord',
        action: 'complete',
      }),
    ).toEqual([])
  })
})

describe('팀원 매핑 규칙', () => {
  const users = [
    discordUser('1123', 'seoyeon_01'),
    discordUser('1124', 'minsu'),
    discordUser('1199', 'manager_bot', true),
  ]

  it('봇은 빼고 기존 매핑을 채운다. 서버를 떠난 사용자는 이 화면에 없다', () => {
    const rows = buildMappingRows(users, [
      member('mb_01', '김서연', '1123'),
      member('mb_09', '떠난 사람', '9999'),
    ])
    expect(rows).toEqual([
      { discordUserId: '1123', username: 'seoyeon_01', name: '김서연' },
      { discordUserId: '1124', username: 'minsu', name: '' },
    ])
  })

  it('같은 이름을 두 줄에 쓰면 두 줄 모두 막는다. 빈 줄은 보지 않는다', () => {
    const rows: MappingRow[] = [
      { discordUserId: '1123', username: 'a', name: '김서연' },
      { discordUserId: '1124', username: 'b', name: ' 김서연 ' },
      { discordUserId: '1125', username: 'c', name: '' },
      { discordUserId: '1126', username: 'd', name: '' },
    ]
    expect([...findMappingIssues(rows, [])]).toEqual([
      [0, 'duplicated'],
      [1, 'duplicated'],
    ])
  })

  it('화면에 없는 Discord 사용자와 연결된 팀원 이름은 막는다 (1:1)', () => {
    const rows: MappingRow[] = [{ discordUserId: '1124', username: 'b', name: '떠난 사람' }]
    expect([...findMappingIssues(rows, [member('mb_09', '떠난 사람', '9999')])]).toEqual([
      [0, 'taken'],
    ])
  })

  it('대소문자가 다르면 다른 이름이다', () => {
    const rows: MappingRow[] = [
      { discordUserId: '1', username: 'a', name: 'Alex' },
      { discordUserId: '2', username: 'b', name: 'alex' },
    ]
    expect(findMappingIssues(rows, []).size).toBe(0)
  })

  it('기존 매핑 → PATCH(이름), 같은 이름의 미연결 팀원 → PATCH(연결), 없으면 POST', () => {
    const members = [member('mb_01', '김서연', '1123'), member('mb_90', '최진호', null)]
    expect(planRow({ discordUserId: '1123', username: 'a', name: '김서연' }, members)).toBeNull()
    expect(planRow({ discordUserId: '1123', username: 'a', name: '서연' }, members)).toEqual({
      kind: 'rename',
      memberId: 'mb_01',
      displayName: '서연',
    })
    expect(planRow({ discordUserId: '1124', username: 'b', name: '최진호' }, members)).toEqual({
      kind: 'link',
      memberId: 'mb_90',
      discordUserId: '1124',
    })
    expect(planRow({ discordUserId: '1125', username: 'c', name: '박민수' }, members)).toEqual({
      kind: 'create',
      displayName: '박민수',
      discordUserId: '1125',
    })
    expect(planRow({ discordUserId: '1125', username: 'c', name: '  ' }, members)).toBeNull()
  })
})

describe('매핑 옮기기 (U3-r1 #5)', () => {
  it('비운 줄에 연결돼 있던 팀원 이름을 다른 줄에 적으면 새로 만들지 않고 연결을 옮긴다', () => {
    const members = [member('mb_91', '이지훈', '1125')]
    const rows: MappingRow[] = [
      { discordUserId: '1124', username: 'minsu', name: '이지훈' },
      { discordUserId: '1125', username: 'jihun_dev', name: '' },
    ]
    expect(planRow(rows[0], members, rows)).toEqual({
      kind: 'link',
      memberId: 'mb_91',
      discordUserId: '1124',
    })
    expect(findMappingIssues(rows, members).size).toBe(0)
  })

  // 이미 연결된 줄로 옮기면 이름을 바꾸지 않는다 — 바꾸면 같은 이름의 팀원이 둘 생긴다 (F-r1 #5)
  it('이미 연결된 줄로 옮기면 그 줄의 연결을 먼저 풀고, 옮겨 오는 팀원을 잇는다', () => {
    const rows: MappingRow[] = [
      { discordUserId: '1123', username: 'seoyeon_01', name: '' },
      { discordUserId: '1124', username: 'minsu', name: '김서연' },
    ]
    const before = [member('mb_01', '김서연', '1123'), member('mb_02', '박민수', '1124')]
    expect(planRow(rows[1], before, rows)).toEqual({ kind: 'unlink', memberId: 'mb_02' })

    const unlinked = [member('mb_01', '김서연', '1123'), member('mb_02', '박민수', null)]
    expect(planRow(rows[1], unlinked, rows)).toEqual({
      kind: 'link',
      memberId: 'mb_01',
      discordUserId: '1124',
    })

    const moved = [member('mb_01', '김서연', '1124'), member('mb_02', '박민수', null)]
    expect(planRow(rows[1], moved, rows)).toBeNull()
  })

  it('연결된 줄에 연결 안 된 팀원의 이름을 적어도 연결을 옮긴다 — 이름을 바꾸지 않는다', () => {
    const rows: MappingRow[] = [{ discordUserId: '1124', username: 'minsu', name: '최진호' }]
    const members = [member('mb_02', '박민수', '1124'), member('mb_90', '최진호', null)]
    expect(planRow(rows[0], members, rows)).toEqual({ kind: 'unlink', memberId: 'mb_02' })
  })

  it('그 줄이 이름을 그대로 두면 옮기기가 아니다 — 두 줄에 같은 이름이라 막는다', () => {
    const members = [member('mb_91', '이지훈', '1125')]
    const rows: MappingRow[] = [
      { discordUserId: '1124', username: 'minsu', name: '이지훈' },
      { discordUserId: '1125', username: 'jihun_dev', name: '이지훈' },
    ]
    expect([...findMappingIssues(rows, members)]).toEqual([
      [0, 'duplicated'],
      [1, 'duplicated'],
    ])
  })
})

/* #228. 생성자 PM 은 로그인 계정 이름으로 먼저 만들어진다. 이름이 달라도 PM 을 골라 그 PM 에 잇는다 */
describe('PM 을 골라 잇기 (#228)', () => {
  const pm = (id: string, displayName: string, discordUserId: string | null): Member => ({
    ...member(id, displayName, discordUserId),
    role: 'pm',
  })

  function apply(list: Member[], operation: MappingOperation): Member[] {
    switch (operation.kind) {
      case 'create':
        return [
          ...list,
          member(`mb_new${list.length}`, operation.displayName, operation.discordUserId),
        ]
      case 'rename':
        return list.map((item) =>
          item.id === operation.memberId ? { ...item, displayName: operation.displayName } : item,
        )
      case 'link':
        return list.map((item) =>
          item.id === operation.memberId
            ? { ...item, discordUserId: operation.discordUserId }
            : item,
        )
      case 'unlink':
        return list.map((item) =>
          item.id === operation.memberId ? { ...item, discordUserId: null } : item,
        )
    }
  }

  /** 줄을 위에서부터 저장한다. 요청은 서버가 받아들인다고 보고 팀원 목록에 반영한다 — saveMemberMappings 의 걸음과 같다 */
  function save(rows: readonly MappingRow[], members: readonly Member[]) {
    let list = [...members]
    const sent: MappingOperation[] = []
    for (const row of rows) {
      for (let step = 0; step < 3; step += 1) {
        const operation = planRow(row, list, rows)
        if (operation === null) break
        sent.push(operation)
        list = apply(list, operation)
      }
      // 한 줄은 상한(3걸음) 안에서 끝난다
      expect(planRow(row, list, rows)).toBeNull()
    }
    return { sent, members: list }
  }

  it.each(['길동', '홍 길동'])(
    'PM 이름과 다른 "%s" 를 적어도 PM 을 고르면 새로 만들지 않고 그 PM 에 Discord 사용자만 잇는다',
    (name) => {
      const members = [pm('mb_90', '홍길동', null)]
      const rows: MappingRow[] = [
        { discordUserId: '1123', username: 'gildong', name, pmMemberId: 'mb_90' },
      ]
      expect(findMappingIssues(rows, members).size).toBe(0)
      const result = save(rows, members)
      expect(result.sent).toEqual([{ kind: 'link', memberId: 'mb_90', discordUserId: '1123' }])
      // 멤버 id·이름·role 은 그대로이고 한 명뿐이다
      expect(result.members).toEqual([pm('mb_90', '홍길동', '1123')])
    },
  )

  it('PM 을 고르지 않은 줄은 지금처럼 이름으로 저장한다', () => {
    const members = [pm('mb_90', '홍길동', null)]
    const rows: MappingRow[] = [
      { discordUserId: '1123', username: 'gildong', name: '길동', pmMemberId: 'mb_90' },
      { discordUserId: '1124', username: 'minsu', name: '박민수', pmMemberId: null },
      { discordUserId: '1125', username: 'jihun_dev', name: '' },
    ]
    expect(save(rows, members).sent).toEqual([
      { kind: 'link', memberId: 'mb_90', discordUserId: '1123' },
      { kind: 'create', displayName: '박민수', discordUserId: '1124' },
    ])
  })

  it('같은 PM 을 두 줄에서 고르면 두 줄 모두 막는다', () => {
    const members = [pm('mb_90', '홍길동', null)]
    const rows: MappingRow[] = [
      { discordUserId: '1123', username: 'a', name: '', pmMemberId: 'mb_90' },
      { discordUserId: '1124', username: 'b', name: '길동', pmMemberId: 'mb_90' },
      { discordUserId: '1125', username: 'c', name: '박민수' },
    ]
    expect([...findMappingIssues(rows, members)]).toEqual([
      [0, 'pmDuplicated'],
      [1, 'pmDuplicated'],
    ])
  })

  it('다른 줄에서 고른 PM 의 이름을 적으면 막는다 — 이름으로 PM 을 가져가지 않는다', () => {
    const members = [pm('mb_90', '홍길동', null)]
    const rows: MappingRow[] = [
      { discordUserId: '1123', username: 'a', name: '길동', pmMemberId: 'mb_90' },
      { discordUserId: '1124', username: 'b', name: ' 홍길동 ' },
    ]
    expect([...findMappingIssues(rows, members)]).toEqual([[1, 'pmClaimed']])
    expect(planRow(rows[1], members, rows)).not.toMatchObject({ memberId: 'mb_90' })
  })

  it('PM 을 고른 줄은 이름을 보지 않는다 — 다른 줄과 이름이 같아도 막지 않는다', () => {
    const members = [pm('mb_90', '홍길동', null)]
    const rows: MappingRow[] = [
      { discordUserId: '1123', username: 'a', name: '박민수', pmMemberId: 'mb_90' },
      { discordUserId: '1124', username: 'b', name: '박민수' },
    ]
    expect(findMappingIssues(rows, members).size).toBe(0)
  })

  it('PM 을 고른 줄의 Discord 사용자가 다른 팀원에 연결돼 있으면 그 연결을 먼저 풀고 PM 을 잇는다', () => {
    const members = [pm('mb_90', '홍길동', null), member('mb_02', '박민수', '1123')]
    const rows: MappingRow[] = [
      { discordUserId: '1123', username: 'gildong', name: '박민수', pmMemberId: 'mb_90' },
    ]
    const result = save(rows, members)
    expect(result.sent).toEqual([
      { kind: 'unlink', memberId: 'mb_02' },
      { kind: 'link', memberId: 'mb_90', discordUserId: '1123' },
    ])
    expect(result.members).toEqual([pm('mb_90', '홍길동', '1123'), member('mb_02', '박민수', null)])
  })

  it('PM 을 고른 줄에서 밀려나는 팀원의 이름을 위 줄에 적으면, 줄 순서와 상관없이 그 팀원을 옮긴다 — 같은 이름이 둘 생기지 않는다', () => {
    const members = [
      pm('mb_90', '홍길동', null),
      member('mb_01', '김서연', '1123'),
      member('mb_02', '박민수', '1124'),
    ]
    const rows: MappingRow[] = [
      { discordUserId: '1124', username: 'minsu', name: '김서연' },
      { discordUserId: '1123', username: 'seoyeon_01', name: '', pmMemberId: 'mb_90' },
    ]
    expect(findMappingIssues(rows, members).size).toBe(0)
    const result = save(rows, members)
    expect(result.sent).toEqual([
      { kind: 'unlink', memberId: 'mb_02' },
      { kind: 'link', memberId: 'mb_01', discordUserId: '1124' },
      { kind: 'link', memberId: 'mb_90', discordUserId: '1123' },
    ])
    expect(result.members.filter(({ displayName }) => displayName === '김서연')).toHaveLength(1)
  })

  it('PM 을 다른 줄로 옮기고 원래 줄에 새 이름을 적으면, 원래 줄은 PM 을 놓고 새 팀원을 잇는다', () => {
    const members = [pm('mb_90', '홍길동', '1123')]
    const rows: MappingRow[] = [
      { discordUserId: '1123', username: 'a', name: '박민수', pmMemberId: null },
      { discordUserId: '1124', username: 'b', name: '', pmMemberId: 'mb_90' },
    ]
    expect(findMappingIssues(rows, members).size).toBe(0)
    const result = save(rows, members)
    expect(result.sent).toEqual([
      { kind: 'unlink', memberId: 'mb_90' },
      { kind: 'create', displayName: '박민수', discordUserId: '1123' },
      { kind: 'link', memberId: 'mb_90', discordUserId: '1124' },
    ])
    // PM 이름은 바뀌지 않았다
    expect(result.members.find(({ id }) => id === 'mb_90')).toEqual(pm('mb_90', '홍길동', '1124'))
  })

  it('연결을 푼 뒤 잇기가 실패해도 다시 계획하면 남은 잇기만 보낸다. 다 저장한 뒤에는 보낼 것이 없다', () => {
    const rows: MappingRow[] = [
      { discordUserId: '1123', username: 'gildong', name: '', pmMemberId: 'mb_90' },
    ]
    const unlinked = [pm('mb_90', '홍길동', null), member('mb_02', '박민수', null)]
    expect(planRow(rows[0], unlinked, rows)).toEqual({
      kind: 'link',
      memberId: 'mb_90',
      discordUserId: '1123',
    })
    const linked = [pm('mb_90', '홍길동', '1123'), member('mb_02', '박민수', null)]
    expect(planRow(rows[0], linked, rows)).toBeNull()
  })

  it('다시 들어오면 PM 이 연결된 줄은 그 PM 을 골라 두고, 그대로 저장하면 보낼 것이 없다', () => {
    const members = [pm('mb_90', '홍길동', '1123'), member('mb_01', '김서연', '1124')]
    const rows = buildMappingRows(
      [discordUser('1123', 'gildong'), discordUser('1124', 'seoyeon_01')],
      members,
    )
    expect(rows).toEqual([
      { discordUserId: '1123', username: 'gildong', name: '홍길동', pmMemberId: 'mb_90' },
      { discordUserId: '1124', username: 'seoyeon_01', name: '김서연' },
    ])
    expect(findMappingIssues(rows, members).size).toBe(0)
    expect(save(rows, members).sent).toEqual([])
  })
})

describe('온보딩 나가기 목적지 (D-069)', () => {
  afterEach(() => clearReturnWorkspace())

  const done = workspace(['completed', 'completed', 'completed', 'completed'], { id: 'ws_01' })
  const pending = workspace(['completed', 'pending', 'pending', 'pending'], { id: 'ws_03' })

  it('새 공간 만들기를 시작한 기존 공간이 있으면 그 대시보드다', () => {
    rememberReturnWorkspace('ws_01')
    expect(readReturnWorkspace()).toBe('ws_01')
    expect(onboardingExitPath([done, pending], readReturnWorkspace())).toBe(
      '/workspaces/ws_01/dashboard',
    )
  })

  it('최초 가입자·사라진 공간·미완료 공간은 워크스페이스 선택 화면이다', () => {
    expect(onboardingExitPath([pending], null)).toBe('/workspaces')
    expect(onboardingExitPath([pending], 'ws_77')).toBe('/workspaces')
    expect(onboardingExitPath([pending], 'ws_03')).toBe('/workspaces')
  })

  it('기억은 sessionStorage 에만 있고 지우면 사라진다', () => {
    rememberReturnWorkspace('ws_01')
    expect(sessionStorage.getItem('onboarding-return-workspace')).toBe('ws_01')
    clearReturnWorkspace()
    expect(readReturnWorkspace()).toBeNull()
  })
})
