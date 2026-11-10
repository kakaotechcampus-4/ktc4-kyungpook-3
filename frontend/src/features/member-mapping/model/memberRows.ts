import { memberNameKey } from '@/entities/member'
import type { DiscordUser, Member } from '@/entities/member'

/** 한 팀원 줄. 서버 목록 순서 그대로 */
export interface MemberRow {
  member: Member
  account:
    | { kind: 'none' }
    | { kind: 'linked'; user: DiscordUser }
    /** 연결된 계정이 서버 목록에 없다(떠난 사람) */
    | { kind: 'gone'; discordUserId: string }
}

/** 계정 고르기 목록의 한 항목. 봇은 뺀다 */
export interface AccountOption {
  user: DiscordUser
  status: { kind: 'free' } | { kind: 'mine' } | { kind: 'taken'; holder: Member }
}

/** 한 줄에서 계정을 골랐을 때 할 일 */
export type PickPlan =
  /** 이미 이 팀원에 연결 */
  | { kind: 'none' }
  | { kind: 'link' }
  /** 확인을 받은 뒤 unlink(from) → link */
  | { kind: 'move'; from: Member }

/** 쓰기 하나. 실행기는 이 표 하나로 요청을 고른다 */
export type RowWrite =
  | { kind: 'rename'; memberId: string; displayName: string }
  | { kind: 'link'; memberId: string; discordUserId: string }
  | { kind: 'move'; fromId: string; memberId: string; discordUserId: string }
  | { kind: 'unlink'; memberId: string }
  | { kind: 'create'; displayName: string; discordUserId: string | null }

export type MemberNameCheck =
  | { kind: 'empty' }
  /** 고치려는 팀원의 지금 이름과 같다. 보낼 것이 없다 */
  | { kind: 'same' }
  | { kind: 'duplicate'; member: Member }
  | { kind: 'ok'; displayName: string }

export const DUPLICATE_NAME = '이미 같은 이름의 팀원이 있어요.'

export const EMPTY_NAME = '이름을 입력해 주세요.'

/**
 * Discord 사용자 목록이 없으면(Discord 미연결) 계정을 알 수 없다. 그때는 계정 칸을 그리지 않으므로 모두 `none` 이다
 */
export function buildMemberRows(
  members: readonly Member[],
  discordUsers: readonly DiscordUser[] | null,
): MemberRow[] {
  const users = new Map((discordUsers ?? []).map((user) => [user.discordUserId, user]))
  return members.map((member) => {
    if (member.discordUserId === null || discordUsers === null)
      return { member, account: { kind: 'none' } }
    const user = users.get(member.discordUserId)
    return {
      member,
      account: user
        ? { kind: 'linked', user }
        : { kind: 'gone', discordUserId: member.discordUserId },
    }
  })
}

function holderOf(members: readonly Member[], discordUserId: string): Member | undefined {
  return members.find((member) => member.discordUserId === discordUserId)
}

export function accountOptions(
  discordUsers: readonly DiscordUser[],
  members: readonly Member[],
  memberId: string,
): AccountOption[] {
  return discordUsers
    .filter(({ isBot }) => !isBot)
    .map((user) => {
      const holder = holderOf(members, user.discordUserId)
      return {
        user,
        status:
          holder === undefined
            ? { kind: 'free' }
            : holder.id === memberId
              ? { kind: 'mine' }
              : { kind: 'taken', holder },
      }
    })
}

/** 봇을 뺀, 어느 팀원에도 연결되지 않은 계정 */
export function unlinkedAccounts(
  discordUsers: readonly DiscordUser[],
  members: readonly Member[],
): DiscordUser[] {
  return discordUsers.filter(
    ({ isBot, discordUserId }) => !isBot && holderOf(members, discordUserId) === undefined,
  )
}

export function planPick(
  memberId: string,
  discordUserId: string,
  members: readonly Member[],
): PickPlan {
  const holder = holderOf(members, discordUserId)
  if (holder === undefined) return { kind: 'link' }
  return holder.id === memberId ? { kind: 'none' } : { kind: 'move', from: holder }
}

/**
 * 이름을 지금 팀원과 견준다(#613). 역할·Discord 연결과 상관없이 모든 팀원과 비교한다 — 같은 이름이 둘이면
 * 화자 지정·담당자에서 둘을 구분할 수 없다. `exceptMemberId` 는 고치는 팀원 자신이라 비교에서 뺀다
 */
export function checkMemberName(
  text: string,
  members: readonly Member[],
  exceptMemberId?: string,
): MemberNameCheck {
  const displayName = text.trim()
  const key = memberNameKey(displayName)
  if (key === '') return { kind: 'empty' }
  const self = members.find(({ id }) => id === exceptMemberId)
  if (self !== undefined && memberNameKey(self.displayName) === key) return { kind: 'same' }
  const member = members.find(
    (other) => other.id !== exceptMemberId && memberNameKey(other.displayName) === key,
  )
  return member ? { kind: 'duplicate', member } : { kind: 'ok', displayName }
}

/** 연결 안 된 계정으로 만들 팀원의 이름. Discord 표시 이름이 비었거나 공백뿐이면 사용자명이다 */
export function accountMemberName(user: DiscordUser): string {
  return user.displayName?.trim() || user.username
}

/**
 * 보내기 전 판단. 이름을 쓰는 쓰기만 본다 — 보낼 쓰기는 앞뒤 공백을 지운 이름으로 바꿔 돌려준다.
 * 빈 이름은 거절한다. 보낼 것이 없는 `skip` 은 자기 이름 그대로인 고치기뿐이다 — 칸을 닫아도 잃는 글자가 없다
 */
export type WriteCheck =
  { kind: 'send'; write: RowWrite } | { kind: 'skip' } | { kind: 'reject'; message: string }

export function checkWrite(write: RowWrite, members: readonly Member[]): WriteCheck {
  if (write.kind !== 'create' && write.kind !== 'rename') return { kind: 'send', write }
  const checked = checkMemberName(
    write.displayName,
    members,
    write.kind === 'rename' ? write.memberId : undefined,
  )
  switch (checked.kind) {
    case 'empty':
      return { kind: 'reject', message: EMPTY_NAME }
    case 'same':
      return { kind: 'skip' }
    case 'duplicate':
      return {
        kind: 'reject',
        message:
          write.kind === 'create' && write.discordUserId !== null
            ? `같은 이름의 팀원 ${checked.member.displayName} 님이 있어요. 그 줄에서 이 계정을 골라 주세요.`
            : DUPLICATE_NAME,
      }
    case 'ok':
      return { kind: 'send', write: { ...write, displayName: checked.displayName } }
  }
}

/**
 * 쓰기의 실패 문구를 둘 자리. 팀원 줄, 연결 안 된 계정 항목, 이름으로 추가하는 칸 셋이다.
 * 옮기기는 새 팀원 줄이다 — 앞 팀원 연결을 풀고 새 팀원에 잇다 실패하면 이을 쪽에서 다시 시도한다
 */
export function writeTarget(write: RowWrite): string {
  switch (write.kind) {
    case 'create':
      return write.discordUserId === null ? 'new' : `account:${write.discordUserId}`
    default:
      return `member:${write.memberId}`
  }
}
