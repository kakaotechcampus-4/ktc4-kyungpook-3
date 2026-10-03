import type { QueryClient } from '@tanstack/react-query'
import {
  createMember,
  linkDiscordUsers,
  memberListQueryOptions,
  updateMember,
} from '@/entities/member'
import type { DiscordUser, Member } from '@/entities/member'
import { ApiError } from '@/shared/api/errors'

/** 화면의 한 줄. Discord 사용자 옆에 PM 이 실제 팀원 이름을 적는다 (D-026) */
export interface MappingRow {
  discordUserId: string
  username: string
  /** 이미 연결된 팀원 이름으로 채워 둔다. 비어 있으면 저장하지 않는다 */
  name: string
}

/** 줄을 만든다. 봇은 뺀다. 서버를 떠난 사용자(inactive)는 이 화면에서 고치지 않는다 (D-031) */
export function buildMappingRows(discordUsers: DiscordUser[], members: Member[]): MappingRow[] {
  return linkDiscordUsers(discordUsers, members).flatMap((link) =>
    link.discordUser === null
      ? []
      : [
          {
            discordUserId: link.discordUser.discordUserId,
            username: link.discordUser.username,
            name: link.member?.displayName ?? '',
          },
        ],
  )
}

export type MappingIssue = 'duplicated' | 'taken'

/**
 * 1:1 제약 (D-027). 빈 줄은 보지 않는다 — 일부만 적어도 저장할 수 있다 (D-029).
 * - duplicated: 두 줄에 같은 이름을 적었다
 * - taken: 이 화면에 없는 Discord 사용자(서버를 떠난 사람)와 이미 연결된 팀원 이름이다
 * 이름은 앞뒤 공백을 지우고 대소문자를 그대로 비교한다. 결과는 줄 번호 → 사유다.
 */
export function findMappingIssues(
  rows: readonly MappingRow[],
  members: readonly Member[],
): Map<number, MappingIssue> {
  const issues = new Map<number, MappingIssue>()
  const shown = new Set(rows.map(({ discordUserId }) => discordUserId))
  const counts = new Map<string, number>()
  for (const row of rows) {
    const name = row.name.trim()
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  rows.forEach((row, index) => {
    const name = row.name.trim()
    if (!name) return
    if ((counts.get(name) ?? 0) > 1) {
      issues.set(index, 'duplicated')
      return
    }
    const holder = members.find(
      (member) =>
        member.displayName === name &&
        member.discordUserId !== null &&
        member.discordUserId !== row.discordUserId &&
        !shown.has(member.discordUserId),
    )
    if (holder) issues.set(index, 'taken')
  })
  return issues
}

export type MappingOperation =
  | { kind: 'rename'; memberId: string; displayName: string }
  | { kind: 'link'; memberId: string; discordUserId: string }
  | { kind: 'unlink'; memberId: string }
  | { kind: 'create'; displayName: string; discordUserId: string }

/**
 * 이 줄의 이름을 가져갈 수 있는 기존 팀원. 새로 만들거나 이름을 바꾸면 같은 이름의 팀원이 둘 생기는 경우다.
 * - 같은 이름의 연결 안 된 팀원(생성자 PM 포함)
 * - 같은 이름의 팀원이 **이 화면에서 비운 줄**에 연결돼 있다 — 그 연결을 이 줄로 옮긴다
 */
function reusableMember(
  name: string,
  members: readonly Member[],
  rows: readonly MappingRow[],
  except?: Member,
): Member | undefined {
  const others = members.filter((member) => member !== except && member.displayName === name)
  return (
    others.find(({ discordUserId }) => discordUserId === null) ??
    others.find(({ discordUserId }) =>
      rows.some((other) => other.discordUserId === discordUserId && other.name.trim() === ''),
    )
  )
}

/**
 * 한 줄의 **다음 한 걸음**. 지금 팀원 목록 기준이다.
 * - 이미 연결된 팀원이 있으면 이름이 바뀐 경우에만 저장한다
 *   - 그 이름을 가져갈 기존 팀원이 있으면 지금 팀원의 연결을 먼저 푼다 — PATCH(Discord 사용자 null).
 *     다음 걸음이 그 팀원을 이 줄에 잇는다. 이름을 바꾸면 같은 이름의 팀원이 둘 생긴다 (F-r1 #5)
 *   - 없으면 PATCH(이름)
 * - 연결된 팀원이 없고 이름을 가져갈 기존 팀원이 있으면 그 팀원에 PATCH(Discord 사용자)
 * - 없으면 POST 로 새 팀원
 * 할 일이 없으면 null — 저장에 성공한 줄은 다시 계획해도 null 이라 재시도가 중복 생성하지 않는다.
 * `rows` 는 화면의 모든 줄이다. 옮기기를 알아보는 데 쓴다.
 */
export function planRow(
  row: MappingRow,
  members: readonly Member[],
  rows: readonly MappingRow[] = [],
): MappingOperation | null {
  const name = row.name.trim()
  if (!name) return null
  const linked = members.find(({ discordUserId }) => discordUserId === row.discordUserId)
  if (linked) {
    if (linked.displayName === name) return null
    return reusableMember(name, members, rows, linked)
      ? { kind: 'unlink', memberId: linked.id }
      : { kind: 'rename', memberId: linked.id, displayName: name }
  }
  const reusable = reusableMember(name, members, rows)
  if (reusable) return { kind: 'link', memberId: reusable.id, discordUserId: row.discordUserId }
  return { kind: 'create', displayName: name, discordUserId: row.discordUserId }
}

/** 한 줄은 많아야 두 걸음이다(연결 풀기 → 잇기). 계획이 돌지 않게 막는 상한이다 */
const MAX_STEPS_PER_ROW = 3

function sendOperation(workspaceId: string, operation: MappingOperation): Promise<Member> {
  switch (operation.kind) {
    case 'create':
      return createMember({
        workspaceId,
        displayName: operation.displayName,
        discordUserId: operation.discordUserId,
      })
    case 'rename':
      return updateMember(operation.memberId, { displayName: operation.displayName })
    case 'link':
      return updateMember(operation.memberId, { discordUserId: operation.discordUserId })
    case 'unlink':
      return updateMember(operation.memberId, { discordUserId: null })
  }
}

/** 저장 도중 한 줄이 실패했다. 앞 줄들은 이미 저장돼 팀원 캐시에 반영됐다 */
export class MappingSaveError extends Error {
  readonly rowIndex: number
  readonly cause: unknown

  constructor(rowIndex: number, cause: unknown) {
    super('member mapping failed')
    this.name = 'MappingSaveError'
    this.rowIndex = rowIndex
    this.cause = cause
  }
}

function upsertMember(members: readonly Member[] | undefined, member: Member): Member[] {
  const list = members ?? []
  return list.some(({ id }) => id === member.id)
    ? list.map((item) => (item.id === member.id ? member : item))
    : [...list, member]
}

/**
 * 요청은 나갔는데 서버가 반영했는지 모르는 실패. 응답을 받지 못했거나, 읽을 수 없었거나, 서버 오류다.
 * 4xx 는 서버가 거절한 것이라 반영된 게 없다.
 */
function mayHaveBeenApplied(error: unknown): boolean {
  if (!(error instanceof ApiError)) return true
  return error.kind === 'network' || error.kind === 'invalid_response' || error.status >= 500
}

/**
 * 줄을 위에서부터 **순서대로** 저장한다. 일괄 API 가 없다.
 * 요청 하나가 성공할 때마다 팀원 캐시에 그 결과를 넣고, 같은 줄의 다음 걸음과 다음 줄은 갱신된 캐시로 계획한다.
 * 실패하면 거기서 멈추고 `MappingSaveError` 로 던진다 — 다시 부르면 남은 걸음만 저장된다.
 * 서버가 반영했는지 모르는 실패(응답 유실)면 캐시를 믿을 수 없다. 팀원 목록을 서버에서 다시 읽어 두고,
 * 읽지 못했으면 다음 저장이 계획하기 전에 먼저 읽는다 — 이미 만든 팀원을 다시 POST 해 409 가 반복되지 않게 한다.
 * 돌려주는 값은 실제로 보낸 요청 수다.
 */
export async function saveMemberMappings(
  queryClient: QueryClient,
  workspaceId: string,
  rows: readonly MappingRow[],
): Promise<number> {
  const { queryKey } = memberListQueryOptions(workspaceId)
  if (queryClient.getQueryState(queryKey)?.isInvalidated) {
    await queryClient.fetchQuery({ ...memberListQueryOptions(workspaceId), staleTime: 0 })
  }
  let sent = 0
  for (const [index, row] of rows.entries()) {
    for (let step = 0; step < MAX_STEPS_PER_ROW; step += 1) {
      const operation = planRow(row, queryClient.getQueryData<Member[]>(queryKey) ?? [], rows)
      if (operation === null) break
      let saved: Member
      try {
        saved = await sendOperation(workspaceId, operation)
      } catch (error) {
        if (mayHaveBeenApplied(error)) await queryClient.invalidateQueries({ queryKey })
        throw new MappingSaveError(index, error)
      }
      sent += 1
      queryClient.setQueryData<Member[]>(queryKey, (members) => upsertMember(members, saved))
    }
  }
  return sent
}
