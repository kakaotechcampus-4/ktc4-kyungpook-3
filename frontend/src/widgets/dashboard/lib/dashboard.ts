import type { Approval } from '@/entities/approval'
import { asrSuspectLine, isScopeChange, sortByWaiting } from '@/entities/approval'
import type { ExtractionItem } from '@/entities/extraction'
import type { IntegrationStatus } from '@/entities/integration'
import type { MeetingSummary } from '@/entities/meeting'
import type { Task } from '@/entities/task'
import { isDueSoon, isOverdue } from '@/entities/task'
import { soonUntil } from '@/shared/lib/date'

export { dateWithWeekday } from './weekday'

/*
 * 대시보드 조립의 순수 판정 (M7 계획 §1~§3). 태스크·승인·회의·추출 네 엔티티를 잇는 자리라 widget 에 있다.
 * 집계는 화면에 보이는 행이 아니라 받은 전체 데이터로 한다 (D-052). 날짜는 서울 날짜 문자열로만 비교한다 (D-144).
 */

/** 확인 필요·마감 임박 목록의 최대 행 수 (D-045, D-051) */
export const LIST_LIMIT = 5
/** 최근 반영의 보이는 행 수 범위 (D-176). 몇 개인지는 화면이 첫 화면 높이로 잰다 */
export const RECENT_ROWS = { min: 3, max: 8 } as const
/** `외 N건 · 회의록에서 보기` 줄의 높이 (D-176) */
export const RECENT_MORE_LINE_PX = 32

export interface DashboardCounts {
  overdue: number
  dueSoon: number
  blocked: number
}

/**
 * 태스크 요약 셋 (D-053, D-054, D-056). 완료·마감 없는 태스크는 마감 집계에 들지 않고,
 * 기한 지남과 7일 이내는 겹치지 않는다(`isOverdue` 는 오늘 전, `isDueSoon` 은 오늘부터). 막힌 일은 `blocked` 상태 수다
 */
export function taskCounts(tasks: readonly Task[], today: string): DashboardCounts {
  const until = soonUntil(today)
  let overdue = 0
  let dueSoon = 0
  let blocked = 0
  for (const task of tasks) {
    if (isOverdue(task, today)) overdue += 1
    else if (isDueSoon(task, today, until)) dueSoon += 1
    if (task.status === 'blocked') blocked += 1
  }
  return { overdue, dueSoon, blocked }
}

/** 대기 중인 승인을 대기 시작 오래된 순으로 (D-050). 개수는 이 길이, 목록은 앞에서 5개다 */
export function waitingApprovals(approvals: readonly Approval[]): Approval[] {
  return sortByWaiting(approvals.filter(({ status }) => status === 'pending'))
}

/**
 * 마감 임박 — 기한 지남과 오늘부터 6일 뒤까지의 미완료 태스크 (D-043, D-044). 태스크 목록의 `due=overdue,soon` 과 같은 대상이다.
 * 마감 오름차순이라 기한 지남이 먼저 온다. 같은 마감은 생성 시각 내림차순(목록과 같다)
 */
export function dueSoonTasks(tasks: readonly Task[], today: string): Task[] {
  const until = soonUntil(today)
  return tasks
    .filter((task) => isOverdue(task, today) || isDueSoon(task, today, until))
    .sort((a, b) => {
      const byDue = (a.dueDate ?? '').localeCompare(b.dueDate ?? '')
      return byDue !== 0 ? byDue : Date.parse(b.createdAt) - Date.parse(a.createdAt)
    })
}

/**
 * 가장 최근에 열린 정리 끝난 회의 — 시작 시각 기준 (D-063, D-065). 없으면 null.
 * `excluded` 의 회의는 고르지 않는다 — 상세가 404(지워짐)였던 회의다 (#405)
 */
export function latestDoneMeeting(
  meetings: readonly MeetingSummary[],
  excluded?: ReadonlySet<string>,
): MeetingSummary | null {
  let latest: MeetingSummary | null = null
  let latestAt = Number.NEGATIVE_INFINITY
  for (const meeting of meetings) {
    if (meeting.status !== 'done' || excluded?.has(meeting.id)) continue
    const parsed = Date.parse(meeting.startedAt)
    const at = Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed
    if (latest === null || at > latestAt) {
      latest = meeting
      latestAt = at
    }
  }
  return latest
}

/**
 * 최신 완료 회의의 `gate=auto` 항목 전부, 응답 순서대로 (D-038). 되돌린 항목도 auto 로 남아 자리를 지킨다.
 * 몇 개를 보일지는 화면이 잰다(`fitRecentRows`, D-176) — 반영 대기 polling 은 보이지 않는 항목까지 본다
 */
export function recentAutoItems(items: readonly ExtractionItem[]): ExtractionItem[] {
  return items.filter(({ gate }) => gate === 'auto')
}

export interface RecentFitInput {
  /** 목록 위쪽(문서 기준)부터 첫 화면 아래까지 남은 높이 */
  available: number
  /** 앞에서부터 행의 높이. 아직 못 잰 행은 undefined — 바로 앞에서 잰 높이로 친다 */
  heights: readonly (number | undefined)[]
  /** auto 항목 전체 수 */
  total: number
  /** `외 N건` 줄 높이. 그 줄이 있을 때만 뺀다 */
  moreLine: number
}

/**
 * 최근 반영에 보일 행 수 (D-176).
 * - 잰 높이가 하나도 없으면(레이아웃 전) 3개(항목이 그보다 적으면 전부)
 * - 8개 이하이고 모두 들어가면 전부 — `외 N건` 줄이 없으니 그 높이도 빼지 않는다
 * - 아니면 `외 N건` 줄을 뺀 높이에 들어가는 만큼, 3~8 사이로 자른다. 항목보다 많이 세지 않는다
 */
export function fitRecentRows({ available, heights, total, moreLine }: RecentFitInput): number {
  const min = Math.min(total, RECENT_ROWS.min)
  const max = Math.min(total, RECENT_ROWS.max)
  const known = heights.find((height) => height !== undefined)
  if (known === undefined) return min
  let last = known
  const filled = Array.from({ length: max }, (_, index) => {
    last = heights[index] ?? last
    return last
  })
  const fits = (count: number, room: number) =>
    filled.slice(0, count).reduce((sum, height) => sum + height, 0) <= room
  if (total <= RECENT_ROWS.max && fits(total, available)) return total
  let count = min
  while (count < max && fits(count + 1, available - moreLine)) count += 1
  return count
}

/**
 * 최근 반영이 비어 있는 이유. 판정 순서가 곧 우선순위다 (D-040~D-042, 계획 §3).
 * - `no-meeting`: 정리 끝난 회의가 없다 → 회의 업로드
 * - `notion`: Notion 이 `connected` 가 아니다(연결 중·끊김 포함) → Notion 설정
 * - `no-auto`: 최근 회의에 자동 처리 항목이 없다 → 최근 회의록
 */
export type RecentEmptyReason = 'no-meeting' | 'notion' | 'no-auto'

export function recentEmptyReason(input: {
  latestMeeting: MeetingSummary | null
  notionStatus: IntegrationStatus
  /** 최신 회의의 auto 항목. 추출이 없는 회의면 빈 배열 */
  autoItems: readonly ExtractionItem[]
}): RecentEmptyReason | null {
  if (input.latestMeeting === null) return 'no-meeting'
  if (input.notionStatus !== 'connected') return 'notion'
  if (input.autoItems.length === 0) return 'no-auto'
  return null
}

/**
 * 되돌린 항목의 지금 결과 (E-03). `reverted_at` 은 이력이라 지워지지 않는다 — 지금 상태는 연결된 승인(`approval_status`)과
 * 지금 연결된 태스크(`task_id`)로 정한다.
 * - `null`: 되돌리지 않았다
 * - `waiting`: 되돌려 만든 확인 필요가 아직 처리되지 않았다(승인 상태를 모르는 경우 포함)
 * - `approved`: 승인돼 태스크가 다시 생겼다. 행은 그 새 태스크의 반영 상태를 보인다
 * - `rejected`: 반려돼 태스크 없이 끝났다
 */
export type RevertOutcome = 'waiting' | 'approved' | 'rejected'

export function revertOutcome(item: ExtractionItem): RevertOutcome | null {
  if (item.revertedAt === null) return null
  if (item.approvalStatus === 'approved' && item.appliedTaskId !== null) return 'approved'
  if (item.approvalStatus === 'rejected') return 'rejected'
  return 'waiting'
}

/**
 * 최근 반영 한 행의 상태. 되돌린 뒤 아직 태스크가 없으면(대기·반려) `되돌림` 이다. 그 밖에는 지금 연결된 태스크의
 * `notion_sync_status` 만 본다 — `synced` 만 반영 완료다 (계획 §3, 계약 §5.4). 되돌린 뒤 승인돼 다시 생긴 태스크도 같다 (E-03).
 * - `unknown`: 태스크 목록을 아직 모르거나 못 받았다. 또는 연결된 태스크가 목록에 없다
 * - `none`: 태스크에 반영 상태가 없다(미연동 때 만든 태스크)
 */
export type RecentSyncState = 'reverted' | 'pending' | 'failed' | 'synced' | 'none' | 'unknown'

export function recentSyncState(
  item: ExtractionItem,
  tasksById: ReadonlyMap<string, Task> | null,
): RecentSyncState {
  const outcome = revertOutcome(item)
  if (outcome === 'waiting' || outcome === 'rejected') return 'reverted'
  if (item.appliedTaskId === null || tasksById === null) return 'unknown'
  const task = tasksById.get(item.appliedTaskId)
  if (task === undefined) return 'unknown'
  return task.notionSyncStatus ?? 'none'
}

/**
 * 반영 대기 행이 하나라도 있으면 polling 한다. 모두 완료·실패(또는 되돌림)면 멈춘다.
 * 행 표시와 같은 `recentSyncState` 로 판정한다 — 되돌린 뒤 승인돼 다시 생긴 태스크가 반영 대기여도 돈다 (E-03)
 */
export function hasPendingSync(
  items: readonly ExtractionItem[],
  tasks: readonly Task[] | undefined,
): boolean {
  if (tasks === undefined) return false
  const tasksById = new Map(tasks.map((task) => [task.id, task]))
  return items.some((item) => recentSyncState(item, tasksById) === 'pending')
}

/** `2026-09-15` → `9월 15일` */
export function monthDayLabel(date: string): string {
  const [, month, day] = date.split('-').map(Number)
  return `${month}월 ${day}일`
}

/** `2026-09-15` → `09/15` */
export function shortDate(date: string): string {
  return `${date.slice(5, 7)}/${date.slice(8, 10)}`
}

/** 녹음 길이를 분으로. 1분이 안 되면 1분이다. 모르면 null */
export function durationLabel(durationMs: number | null): string | null {
  if (durationMs === null || !Number.isFinite(durationMs) || durationMs < 0) return null
  return `${Math.max(1, Math.round(durationMs / 60_000))}분`
}

/**
 * 확인 필요 행 아래 한 줄 — 왜 확인해야 하는지. 회의록·태스크 목록의 문구와 같다.
 * 빠진 값이 없을 때만 첫 전사 오인식 의심을 보인다 (#643)
 */
export function approvalReason(approval: Approval): string {
  if (approval.kind === 'task_update' && approval.assigneePick !== null)
    return '담당자를 골라야 하는 답장이에요'
  if (isScopeChange(approval)) return '범위 변경을 확인해야 해요'
  if (approval.kind === 'task_update') return '변경 제안을 확인해야 해요'
  if (approval.kind === 'unsupported') return '지원하지 않는 종류라 상세에서 확인해 주세요'
  if (approval.gate === 'hold') return '정보가 부족해 태스크 초안을 만들지 않았어요'
  const { missing } = approval
  if (missing.includes('assignee') && missing.includes('due')) return '담당자와 마감을 정해야 해요'
  if (missing.includes('assignee')) return '담당자를 정해야 해요'
  if (missing.includes('due')) return '마감을 정해야 해요'
  const [suspect] = approval.asrSuspects
  return suspect === undefined ? '내용을 확인해야 해요' : asrSuspectLine(suspect)
}

/** 확인 필요 행의 제목 */
export function approvalTitle(approval: Approval): string {
  if (approval.kind === 'unsupported') return approval.type
  return approval.title ?? '제목 없는 확인 요청'
}
