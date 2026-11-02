import type { DiscordUser, Member } from '@/entities/member'
import { linkDiscordUsers } from '@/entities/member'
import { isDueSoon, isOverdue } from '@/entities/task'
import type { Task } from '@/entities/task'
import { addDays, seoulDateOf, soonUntil } from '@/shared/lib/date'

/**
 * 팀원 한 명의 상태 배지 (Team 캔버스). 맡은 일 하나라도
 * - 막혔거나 기한이 지났으면 `위험`
 * - 오늘부터 7일 안에 마감하면 `주의` (D-046 의 7일)
 * - 그 밖에는 `정상`
 */
export type MemberRisk = 'danger' | 'warn' | 'normal'

export function memberRisk(tasks: readonly Task[], today: string): MemberRisk {
  const until = soonUntil(today)
  let risk: MemberRisk = 'normal'
  for (const task of tasks) {
    if (task.status === 'blocked' || isOverdue(task, today)) return 'danger'
    if (isDueSoon(task, today, until)) risk = 'warn'
  }
  return risk
}

/** 마감이 빠른 순, 마감이 없으면 뒤로. 같으면 제목 순이다 */
function byDue(a: Task, b: Task): number {
  if (a.dueDate !== b.dueDate) {
    if (a.dueDate === null) return 1
    if (b.dueDate === null) return -1
    return a.dueDate < b.dueDate ? -1 : 1
  }
  return a.title.localeCompare(b.title, 'ko')
}

/** 팀원별 맡은 일. 끝나지 않은 일을 마감 순으로 먼저, 끝난 일은 그 뒤에 둔다 */
export function tasksByMember(tasks: readonly Task[]): Map<string, Task[]> {
  const grouped = new Map<string, Task[]>()
  for (const task of tasks) {
    if (task.assigneeMemberId === null) continue
    const list = grouped.get(task.assigneeMemberId)
    if (list === undefined) grouped.set(task.assigneeMemberId, [task])
    else list.push(task)
  }
  for (const list of grouped.values())
    list.sort((a, b) => Number(a.status === 'done') - Number(b.status === 'done') || byDue(a, b))
  return grouped
}

/** 먼저 챙길 일 하나의 까닭. 기한 지남 → 막힘 → 곧 마감 순으로 고른다 */
export type AttentionKind = 'overdue' | 'blocked' | 'soon'

export interface Attention {
  kind: AttentionKind
  member: Member
  task: Task
  /** 마지막 소식(태스크가 바뀐 날). 오늘 바뀌었으면 null 이다 — 소식이 없다고 하지 않는다 */
  quietSince: string | null
}

const ATTENTION_ORDER: readonly AttentionKind[] = ['overdue', 'blocked', 'soon']

function attentionKind(task: Task, today: string, until: string): AttentionKind | null {
  if (isOverdue(task, today)) return 'overdue'
  if (task.status === 'blocked') return 'blocked'
  if (isDueSoon(task, today, until)) return 'soon'
  return null
}

/** `먼저 챙길 것` 카드에 올릴 일 하나. 팀원에게 맡긴 일만 본다. 챙길 일이 없으면 null 이다 */
export function firstAttention(
  members: readonly Member[],
  tasks: readonly Task[],
  today: string,
): Attention | null {
  const byId = new Map(members.map((member) => [member.id, member]))
  const until = soonUntil(today)
  let best: { kind: AttentionKind; member: Member; task: Task } | null = null
  for (const task of tasks) {
    const member = task.assigneeMemberId === null ? undefined : byId.get(task.assigneeMemberId)
    const kind = member === undefined ? null : attentionKind(task, today, until)
    if (member === undefined || kind === null) continue
    const rank = ATTENTION_ORDER.indexOf(kind)
    const bestRank = best === null ? Infinity : ATTENTION_ORDER.indexOf(best.kind)
    if (rank < bestRank || (rank === bestRank && best !== null && byDue(task, best.task) < 0))
      best = { kind, member, task }
  }
  if (best === null) return null
  const updated = seoulDateOf(best.task.updatedAt)
  return { ...best, quietSince: updated !== null && updated < today ? updated : null }
}

/** 아바타 글자. 세 글자 한글 이름은 성을 뺀 두 글자, 그 밖에는 앞 두 글자다 (design-system — 이름 1~2자) */
export function avatarText(name: string): string {
  const trimmed = name.trim()
  return /^[가-힣]{3}$/.test(trimmed) ? trimmed.slice(1) : trimmed.slice(0, 2)
}

/** 오늘부터 7일. Team 캔버스의 `앞으로 7일` 칸이다 */
export function nextSevenDays(today: string): string[] {
  return Array.from({ length: 7 }, (_, offset) => addDays(today, offset))
}

/** 그날 마감인 끝나지 않은 일 */
export function openTasksDueOn(tasks: readonly Task[], date: string): Task[] {
  return tasks.filter((task) => task.status !== 'done' && task.dueDate === date)
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'] as const

/** `YYYY-MM-DD` 의 요일 한 글자. 날짜 전용 값이라 UTC 로 읽어 실행 환경 시간대에 밀리지 않는다 */
export function weekdayOf(date: string): string {
  return WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()]
}

export function isWeekend(date: string): boolean {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay()
  return day === 0 || day === 6
}

/**
 * `연결되지 않은 계정` 영역의 Discord 사용자 — 팀원과 잇지 않은 사람이다 (D-076). 봇은 뺀다.
 * 서버를 떠난 팀원(D-031)은 여기 없다 — 팀원 목록에서 비활성으로 보인다
 */
export function unlinkedDiscordUsers(
  discordUsers: DiscordUser[],
  members: Member[],
): DiscordUser[] {
  return linkDiscordUsers(discordUsers, members).flatMap((link) =>
    link.kind === 'unlinked' && link.discordUser !== null ? [link.discordUser] : [],
  )
}

/** Discord 서버를 떠난 팀원 id (D-031). 연결한 Discord 사용자가 서버 목록에 없다 */
export function inactiveMemberIds(discordUsers: DiscordUser[], members: Member[]): Set<string> {
  return new Set(
    linkDiscordUsers(discordUsers, members).flatMap((link) =>
      link.kind === 'inactive' && link.member !== null ? [link.member.id] : [],
    ),
  )
}
