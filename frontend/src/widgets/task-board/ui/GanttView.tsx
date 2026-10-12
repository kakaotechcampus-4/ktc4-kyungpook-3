import type { CSSProperties, ReactNode } from 'react'
import type { TaskCreateApproval } from '@/entities/approval'
import type { Member } from '@/entities/member'
import type { Task } from '@/entities/task'
import { paths } from '@/shared/config/routes'
import { GuardedLink } from '@/shared/lib/unsaved-changes'
import { Icon } from '@/shared/ui/icon'
import { addDays } from '../lib/taskBoard'
import {
  GANTT_DAYS,
  daysBetween,
  ganttDays,
  ganttTitle,
  weekOfMonth,
  shortDate,
  taskTone,
} from '../lib/taskViews'
import type { TaskTone } from '../lib/taskViews'
import { Avatar, LegendItem, RangeHeader } from './viewParts'

const LABEL_WIDTH = 252
const GRID: CSSProperties = { gridTemplateColumns: `repeat(${GANTT_DAYS}, minmax(0, 1fr))` }
const BAR_BASE =
  'flex h-26 items-center justify-between gap-8 overflow-hidden rounded-7 px-9 text-[10.5px] whitespace-nowrap'

const BAR: Record<TaskTone, string> = {
  active: 'bg-ink text-surface',
  warn: 'bg-ink text-surface',
  danger: 'bg-accent text-surface',
  todo: 'border border-line-strong bg-surface text-sub',
  done: 'bg-surface-sunken text-dim',
}

interface Group {
  key: string
  name: string | null
  note: string
  tasks: Task[]
  approvals: TaskCreateApproval[]
}

export interface GanttViewProps {
  workspaceId: string
  members: readonly Member[]
  tasks: readonly Task[]
  /** 확인 필요 생성 승인. PM 이 아니면 비어 있다 */
  approvals: readonly TaskCreateApproval[]
  today: string
  from: string
  onFromChange: (from: string) => void
}

/** 팀원별로 묶는다. 담당자가 없는 일은 `미지정` 이 모은다. 일정이 없는 일은 아래 목록으로 간다 */
function groupRows(
  members: readonly Member[],
  tasks: readonly Task[],
  approvals: readonly TaskCreateApproval[],
): { groups: Group[]; unscheduledTasks: Task[]; unscheduledApprovals: TaskCreateApproval[] } {
  const scheduledTasks = tasks.filter((task) => task.dueDate !== null)
  const scheduledApprovals = approvals.filter((approval) => approval.dueDate !== null)
  const groups: Group[] = members.map((member) => ({
    key: member.id,
    name: member.displayName,
    note: member.role === 'pm' ? 'PM' : '팀원',
    tasks: scheduledTasks.filter((task) => task.assigneeMemberId === member.id),
    approvals: scheduledApprovals.filter((approval) => approval.assigneeMemberId === member.id),
  }))
  const known = new Set(members.map(({ id }) => id))
  const orphanTasks = scheduledTasks.filter(
    (task) => task.assigneeMemberId === null || !known.has(task.assigneeMemberId),
  )
  const orphanApprovals = scheduledApprovals.filter(
    (approval) => approval.assigneeMemberId === null || !known.has(approval.assigneeMemberId),
  )
  groups.push({
    key: 'unassigned',
    name: null,
    note: '승인하면 담당자가 붙습니다',
    tasks: orphanTasks,
    approvals: orphanApprovals,
  })
  return {
    groups: groups.filter(({ tasks: t, approvals: a }) => t.length + a.length > 0),
    unscheduledTasks: tasks.filter((task) => task.dueDate === null),
    unscheduledApprovals: approvals.filter((approval) => approval.dueDate === null),
  }
}

/** 간트 (TasksGantt 시안). 3주 창에 시작일 → 마감일 막대를 팀원별로 그린다 */
export function GanttView({
  workspaceId,
  members,
  tasks,
  approvals,
  today,
  from,
  onFromChange,
}: GanttViewProps) {
  const days = ganttDays(from)
  const todayIndex = days.indexOf(today)
  const { groups, unscheduledTasks, unscheduledApprovals } = groupRows(members, tasks, approvals)
  const names = new Map(members.map(({ id, displayName }) => [id, displayName]))
  const weekends = days.flatMap((date, index) => {
    const day = new Date(`${date}T00:00:00Z`).getUTCDay()
    return day === 0 || day === 6 ? [index] : []
  })
  const unscheduledCount = unscheduledTasks.length + unscheduledApprovals.length
  return (
    <>
      <RangeHeader
        title={ganttTitle(from)}
        prevLabel="이전 3주"
        nextLabel="다음 3주"
        onPrev={() => onFromChange(addDays(from, -GANTT_DAYS))}
        onNext={() => onFromChange(addDays(from, GANTT_DAYS))}
        legend={
          <>
            <LegendItem swatch="bg-ink">진행 중</LegendItem>
            <LegendItem swatch="border border-line-strong bg-surface">시작 전</LegendItem>
            <LegendItem swatch="bg-surface-sunken">완료</LegendItem>
            <LegendItem swatch="border-2 border-dashed bg-surface">확인 필요</LegendItem>
          </>
        }
      />
      <div
        role="table"
        aria-label="일정"
        className="relative overflow-hidden rounded-16 border border-line bg-surface"
      >
        <div aria-hidden="true" className="absolute inset-0 z-0 flex">
          <div style={{ flex: `0 0 ${LABEL_WIDTH}px` }} />
          <div className="relative grid flex-1" style={GRID}>
            {weekends.map((index) => (
              <span key={index} className="bg-surface-sunken" style={{ gridColumn: index + 1 }} />
            ))}
            {todayIndex === -1 ? null : (
              <span
                className="absolute top-0 bottom-0 w-px bg-ink"
                style={{ left: `${((todayIndex + 0.5) / GANTT_DAYS) * 100}%` }}
              />
            )}
          </div>
        </div>
        <div className="relative z-1">
          <div className="flex items-stretch">
            <div
              className="flex items-center border-r border-line bg-surface-sunken px-14"
              style={{ flex: `0 0 ${LABEL_WIDTH}px` }}
            >
              <span className="text-[10.5px] tracking-[0.08em] text-dim">담당자 · 태스크</span>
            </div>
            <div className="grid flex-1" style={GRID}>
              {[0, 7, 14].map((offset) => (
                <span
                  key={offset}
                  role="columnheader"
                  className={`px-10 py-8 text-meta font-semibold text-sub ${offset > 0 ? 'border-l border-line' : ''}`}
                  style={{ gridColumn: `${offset + 1} / ${offset + 8}` }}
                >
                  {weekLabel(days[offset])}
                </span>
              ))}
            </div>
          </div>
          <div className="flex items-stretch border-t border-divider">
            <div
              className="border-r border-line bg-surface-sunken"
              style={{ flex: `0 0 ${LABEL_WIDTH}px` }}
            />
            <div className="grid min-h-30 flex-1" style={GRID}>
              {days.map((date) => (
                <span key={date} className="flex items-center justify-center">
                  <span
                    className={
                      date === today
                        ? 'inline-flex h-20 min-w-[20px] items-center justify-center rounded-999 bg-ink px-5 text-[11px] leading-none font-semibold text-surface tabular-nums'
                        : 'text-[11px] text-sub tabular-nums'
                    }
                  >
                    {Number(date.slice(8, 10))}
                  </span>
                </span>
              ))}
            </div>
          </div>
          {groups.map((group) => (
            <GroupRows
              key={group.key}
              workspaceId={workspaceId}
              group={group}
              from={from}
              today={today}
            />
          ))}
        </div>
      </div>
      <section aria-label="일정이 없는 일" className="flex flex-col gap-4">
        <h2 className="py-8 text-body font-semibold text-ink">
          일정이 없는 일{' '}
          <span className="font-normal text-dim tabular-nums">{unscheduledCount}</span>
        </h2>
        <ul>
          {unscheduledApprovals.map((approval) => (
            <UnscheduledRow
              key={approval.id}
              title={approval.title}
              note={
                approval.dueRaw === null
                  ? '마감이 언급되지 않았어요'
                  : `마감이 "${approval.dueRaw}"으로만 언급됨`
              }
              assignee={
                approval.assigneeMemberId === null
                  ? null
                  : (names.get(approval.assigneeMemberId) ?? null)
              }
              to={`${paths.tasks(workspaceId)}?tab=needs_review`}
            />
          ))}
          {unscheduledTasks.map((task) => (
            <UnscheduledRow
              key={task.id}
              title={task.title}
              note="마감일이 정해지지 않았어요"
              assignee={
                task.assigneeMemberId === null ? null : (names.get(task.assigneeMemberId) ?? null)
              }
              to={paths.tasks(workspaceId, task.id)}
            />
          ))}
        </ul>
      </section>
    </>
  )
}

/** `9월 2주` — 그 주 월요일이 든 달의 몇째 주 */
function weekLabel(monday: string): string {
  return `${Number(monday.slice(5, 7))}월 ${weekOfMonth(monday)}주`
}

function GroupRows({
  workspaceId,
  group,
  from,
  today,
}: {
  workspaceId: string
  group: Group
  from: string
  today: string
}) {
  return (
    <>
      <div className="flex items-stretch border-t border-line">
        <div
          className="flex items-center gap-9 border-r border-line bg-surface-sunken px-14 py-8"
          style={{ flex: `0 0 ${LABEL_WIDTH}px` }}
        >
          <Avatar name={group.name} />
          <span className="text-caption font-semibold text-ink">{group.name ?? '미지정'}</span>
          <span className="min-w-[0px] flex-1 text-[11px] text-dim">{group.note}</span>
          <span className="text-[11px] text-dim tabular-nums">
            {group.tasks.length + group.approvals.length}건
          </span>
        </div>
        <div className="flex-1" />
      </div>
      {group.approvals.map((approval) => (
        <Row key={approval.id} title={approval.title}>
          <ApprovalChip approval={approval} from={from} />
        </Row>
      ))}
      {group.tasks.map((task) => (
        <Row
          key={task.id}
          title={task.title}
          to={paths.tasks(workspaceId, task.id)}
          done={task.status === 'done'}
        >
          <TaskBar task={task} from={from} today={today} />
        </Row>
      ))}
    </>
  )
}

function Row({
  title,
  to,
  done = false,
  children,
}: {
  title: string
  to?: string
  done?: boolean
  children: ReactNode
}) {
  const label = (
    <span
      className={`min-w-[0px] flex-1 truncate text-[13px] ${done ? 'font-normal text-dim line-through' : 'font-semibold text-ink'}`}
    >
      {title}
    </span>
  )
  return (
    <div role="row" className="flex items-stretch border-t border-divider">
      <div
        className="flex min-h-44 items-center gap-8 border-r border-line px-14"
        style={{ flex: `0 0 ${LABEL_WIDTH}px` }}
      >
        {to === undefined ? (
          label
        ) : (
          <GuardedLink to={to} className="flex min-w-[0px] flex-1">
            {label}
          </GuardedLink>
        )}
      </div>
      <div className="grid min-h-44 flex-1 items-center" style={GRID}>
        {children}
      </div>
    </div>
  )
}

function clampRange(from: string, start: string, end: string): [number, number] | null {
  const first = daysBetween(from, start)
  const last = daysBetween(from, end)
  if (last < 0 || first > GANTT_DAYS - 1) return null
  return [Math.max(first, 0) + 1, Math.min(last, GANTT_DAYS - 1) + 2]
}

function TaskBar({ task, from, today }: { task: Task; from: string; today: string }) {
  if (task.dueDate === null) return null
  const tone = taskTone(task, today)
  const start = task.startDate <= task.dueDate ? task.startDate : task.dueDate
  // 완료는 막대가 아니라 마감 앞 며칠을 옅게 깔아 `MM/DD 완료` 라벨이 보이게 한다
  const range = clampRange(from, tone === 'done' ? addDays(task.dueDate, -3) : start, task.dueDate)
  if (range === null) return null
  const label =
    tone === 'done'
      ? `${shortDate(task.dueDate)} 완료`
      : `${shortDate(start)} → ${shortDate(task.dueDate)}`
  return (
    <span
      className={`${BAR_BASE} ${BAR[tone]} mx-3`}
      style={{ gridColumn: `${range[0]} / ${range[1]}` }}
    >
      <span className="tabular-nums">{label}</span>
      {tone === 'danger' ? (
        <span className="inline-flex h-18 items-center rounded-6 bg-accent px-7 text-[10px] leading-none font-bold text-surface">
          위험
        </span>
      ) : tone === 'warn' ? (
        <span className="inline-flex items-center gap-3 text-[10px] font-semibold">
          <span aria-hidden="true" className="h-5 w-5 rounded-999 bg-current" />
          주의
        </span>
      ) : null}
    </span>
  )
}

function ApprovalChip({ approval, from }: { approval: TaskCreateApproval; from: string }) {
  if (approval.dueDate === null) return null
  const range = clampRange(from, approval.dueDate, approval.dueDate)
  if (range === null) return null
  // 막대 하나가 아니라 마감 하루 칸을 넓혀 그린다
  const start = Math.max(range[0] - 1, 1)
  return (
    <span
      className="mx-3 flex h-26 items-center justify-center rounded-7 border-2 border-dashed bg-surface px-9 text-[10.5px] whitespace-nowrap text-dim tabular-nums"
      style={{ gridColumn: `${start} / ${Math.min(start + 3, GANTT_DAYS + 1)}` }}
    >
      마감 {shortDate(approval.dueDate)}
    </span>
  )
}

function UnscheduledRow({
  title,
  note,
  assignee,
  to,
}: {
  title: string
  note: string
  assignee: string | null
  to: string
}) {
  return (
    <li className="flex items-center gap-14 border-b border-line py-14 last:border-b-0">
      <span className="inline-flex h-[22px] shrink-0 items-center rounded-6 border-2 border-dashed px-8 text-meta leading-none font-semibold text-dim">
        일정 없음
      </span>
      <span className="text-[14px] font-semibold text-ink">{title}</span>
      <span className="flex-1 text-right text-caption text-dim">{note}</span>
      <span className="inline-flex items-center gap-7 text-caption text-dim">
        <Avatar name={assignee} />
        {assignee ?? '미지정'}
      </span>
      <GuardedLink
        to={to}
        className="inline-flex items-center gap-3 text-control font-semibold text-ink"
      >
        날짜 넣기
        <Icon name="chevron-right" size={13} />
      </GuardedLink>
    </li>
  )
}
