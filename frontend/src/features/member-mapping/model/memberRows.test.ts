import type { DiscordUser, Member } from '@/entities/member'
import {
  accountOptions,
  buildMemberRows,
  checkMemberName,
  checkWrite,
  planPick,
  unlinkedAccounts,
} from './memberRows'

function member(id: string, displayName: string, discordUserId: string | null = null): Member {
  return {
    id,
    workspaceId: 'ws_01',
    displayName,
    discordUserId,
    notionName: null,
    role: 'member',
    hasLoginAccount: false,
    createdAt: '2026-09-01T00:00:00Z',
  }
}

function user(discordUserId: string, username: string, isBot = false): DiscordUser {
  return { discordUserId, username, displayName: null, avatarUrl: null, isBot }
}

const SEOYEON = user('1123', 'seoyeon_01')
const MINSU = user('1124', 'minsu')
const JIHUN = user('1125', 'jihun_dev')
const BOT = user('1199', 'manager_bot', true)
const USERS = [SEOYEON, MINSU, JIHUN, BOT]

const KIM = member('mb_01', '김서연', '1123')
const PARK = member('mb_02', '박민수', '1124')
const LEE = member('mb_03', '이재환')
const JUNG = member('mb_04', '정하늘', '1126')
const MEMBERS = [KIM, PARK, LEE, JUNG]

describe('buildMemberRows', () => {
  it('팀원 한 명이 한 줄이고, 서버 목록 순서 그대로 연결 안 됨·연결됨·서버를 떠남을 가른다', () => {
    expect(buildMemberRows(MEMBERS, USERS)).toEqual([
      { member: KIM, account: { kind: 'linked', user: SEOYEON } },
      { member: PARK, account: { kind: 'linked', user: MINSU } },
      { member: LEE, account: { kind: 'none' } },
      { member: JUNG, account: { kind: 'gone', discordUserId: '1126' } },
    ])
  })

  it('Discord 사용자 목록이 없으면 계정을 모르니 모두 연결 안 됨이다', () => {
    expect(buildMemberRows(MEMBERS, null).map(({ account }) => account.kind)).toEqual([
      'none',
      'none',
      'none',
      'none',
    ])
  })
})

describe('accountOptions', () => {
  it('봇을 빼고 계정마다 이 팀원 기준의 상태를 붙인다', () => {
    expect(accountOptions(USERS, MEMBERS, 'mb_02')).toEqual([
      { user: SEOYEON, status: { kind: 'taken', holder: KIM } },
      { user: MINSU, status: { kind: 'mine' } },
      { user: JIHUN, status: { kind: 'free' } },
    ])
  })
})

describe('unlinkedAccounts', () => {
  it('봇이 아니고 어느 팀원에도 연결되지 않은 계정만 남긴다', () => {
    expect(unlinkedAccounts(USERS, MEMBERS)).toEqual([JIHUN])
    expect(unlinkedAccounts(USERS, [...MEMBERS, member('mb_05', '최지훈', '1125')])).toEqual([])
  })
})

describe('planPick', () => {
  it('이미 이 팀원에 연결된 계정은 할 일이 없다', () => {
    expect(planPick('mb_02', '1124', MEMBERS)).toEqual({ kind: 'none' })
  })

  it('아무에게도 연결되지 않은 계정은 잇는다', () => {
    expect(planPick('mb_03', '1125', MEMBERS)).toEqual({ kind: 'link' })
  })

  it('다른 팀원에 연결된 계정은 그 팀원에서 옮긴다', () => {
    expect(planPick('mb_03', '1124', MEMBERS)).toEqual({ kind: 'move', from: PARK })
  })
})

describe('checkMemberName', () => {
  it('비었거나 공백뿐이면 empty', () => {
    expect(checkMemberName('   ', MEMBERS)).toEqual({ kind: 'empty' })
  })

  it('다른 팀원과 앞뒤 공백만 다르면 duplicate', () => {
    expect(checkMemberName(' 박민수 ', MEMBERS)).toEqual({ kind: 'duplicate', member: PARK })
  })

  it('고치는 팀원 자신의 이름이면 same 이다 — 자기 자신과는 겹치지 않는다', () => {
    expect(checkMemberName('박민수 ', MEMBERS, 'mb_02')).toEqual({ kind: 'same' })
  })

  it('고치는 팀원이 다른 팀원 이름을 쓰면 duplicate', () => {
    expect(checkMemberName('김서연', MEMBERS, 'mb_02')).toEqual({ kind: 'duplicate', member: KIM })
  })

  it('대소문자가 다르면 다른 이름이고, 앞뒤 공백을 지운 이름으로 ok', () => {
    const alex = [...MEMBERS, member('mb_05', 'Alex')]
    expect(checkMemberName(' alex ', alex)).toEqual({ kind: 'ok', displayName: 'alex' })
  })
})

describe('checkWrite', () => {
  it('보낼 이름은 앞뒤 공백을 지운다', () => {
    expect(
      checkWrite({ kind: 'create', displayName: '  최지훈 ', discordUserId: null }, MEMBERS),
    ).toEqual({
      kind: 'send',
      write: { kind: 'create', displayName: '최지훈', discordUserId: null },
    })
  })

  it('같은 이름의 추가는 이름 칸과 계정 항목에 다른 문구로 거절한다', () => {
    expect(
      checkWrite({ kind: 'create', displayName: '박민수', discordUserId: null }, MEMBERS),
    ).toEqual({ kind: 'reject', message: '이미 같은 이름의 팀원이 있어요.' })
    expect(
      checkWrite({ kind: 'create', displayName: '박민수', discordUserId: '1125' }, MEMBERS),
    ).toEqual({
      kind: 'reject',
      message: '같은 이름의 팀원 박민수 님이 있어요. 그 줄에서 이 계정을 골라 주세요.',
    })
  })

  it('자기 이름 그대로의 고치기는 보내지 않는다', () => {
    expect(
      checkWrite({ kind: 'rename', memberId: 'mb_02', displayName: '박민수' }, MEMBERS),
    ).toEqual({ kind: 'skip' })
  })
})
