import type { DiscordUser, Member } from '@/entities/member'
import type { OnboardingStepStatus, Workspace } from '@/entities/workspace'
import { onboardingExitPath } from '../lib/exitPath'
import { buildMappingRows, findMappingIssues, planRow } from './memberMapping'
import type { MappingRow } from './memberMapping'
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

describe('planOnboardingUpdates (D-073)', () => {
  it('Discord 를 건너뛰면 팀원 연결도 건너뜀이다 — Discord 가 먼저다', () => {
    expect(
      planOnboardingUpdates(workspace(['completed', 'pending', 'pending', 'pending']), {
        step: 'connect_discord',
        action: 'skip',
      }),
    ).toEqual([
      { step: 'connect_discord', action: 'skip' },
      { step: 'connect_members', action: 'skip' },
    ])
  })

  it('이미 저장된 단계는 빼고 남은 것만 보낸다 — 재시도', () => {
    expect(
      planOnboardingUpdates(workspace(['completed', 'skipped', 'pending', 'pending']), {
        step: 'connect_discord',
        action: 'skip',
      }),
    ).toEqual([{ step: 'connect_members', action: 'skip' }])
  })

  it('Discord 만 건너뜀으로 남았으면 다음 저장이 팀원 건너뜀을 함께 채운다', () => {
    expect(
      planOnboardingUpdates(workspace(['completed', 'skipped', 'pending', 'pending']), {
        step: 'connect_notion',
        action: 'complete',
      }),
    ).toEqual([
      { step: 'connect_notion', action: 'complete' },
      { step: 'connect_members', action: 'skip' },
    ])
  })

  it('Discord 를 연결했으면 팀원 연결은 그대로 남는다', () => {
    expect(
      planOnboardingUpdates(workspace(['completed', 'completed', 'pending', 'pending']), {
        step: 'connect_notion',
        action: 'skip',
      }),
    ).toEqual([{ step: 'connect_notion', action: 'skip' }])
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
