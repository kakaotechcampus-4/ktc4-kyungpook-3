import { memo, useMemo } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { TaskCreateApproval } from '@/entities/approval'
import type { Member } from '@/entities/member'
import type { Task } from '@/entities/task'
import { paths } from '@/shared/config/routes'
import { addDays } from '@/shared/lib/date'
import { GuardedLink } from '@/shared/lib/unsaved-changes'
import { Icon } from '@/shared/ui/icon'
import {
  GANTT_DAYS,
  assigneeLabel,
  daysBetween,
  ganttDays,
  ganttTitle,
  weekOfMonth,
  shortDate,
  taskTone,
} from '../lib/taskViews'
import type { TaskTone } from '../lib/taskViews'
import { Avatar, HorizontalScroll, LegendItem, RangeHeader } from './viewParts'

const LABEL_WIDTH = 252
/* 날짜 칸은 시안 셸 폭(본문 1264px)에서의 칸 폭 48px 아래로 줄이지 않는다. 1024px 에서 균등 분할(32px)은 막대 라벨 잘림을
   3건으로 늘렸다(1440px·1920px 1건, tasks-default 실측). 그보다 좁은 영역에서는 표 영역 안에서 가로로 민다 (D-124) */
const DAY_MIN_WIDTH = 48
const TABLE_MIN_WIDTH = LABEL_WIDTH + GANTT_DAYS * DAY_MIN_WIDTH + 2
const GRID: CSSProperties = {
  gridTemplateColumns: `repeat(${GANTT_DAYS}, minmax(${DAY_MIN_WIDTH}px, 1fr))`,
}
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
  /** 이니셜 원에 쓰는 이름. 모르면 null */
  name: string | null
  label: string
  note: string
  tasks: Task[]
  approvals: TaskCreateApproval[]
}

export interface GanttViewProps {
  workspaceId: string
  members: readonly Member[]
  /** 팀원 ID → 이름 */
  names: ReadonlyMap<string, string>
  tasks: readonly Task[]
  /** 확인 필요 생성 승인. PM 이 아니면 비어 있다 */
  approvals: readonly TaskCreateApproval[]
  /** 확인 필요를 받지 못했다. 빈 3주는 불러온 태스크 범위로만 말하고, 확인 필요가 빠진 개수는 보이지 않는다 */
  approvalsMissing: boolean
  today: string
  from: string
  onFromChange: (from: string) => void
}

/**
 * 팀원별로 묶는다. 담당자가 없는 일은 `미지정` 이, 팀원 목록에서 찾지 못한 담당자의 일(팀원 조회 실패 포함)은
 * `알 수 없는 담당자` 가 모은다 — 받지 못한 담당자를 미지정으로 그리지 않는다. 일정이 없는 일은 아래 목록으로 간다
 */
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
    label: member.displayName,
    note: member.role === 'pm' ? 'PM' : '팀원',
    tasks: scheduledTasks.filter((task) => task.assigneeMemberId === member.id),
    approvals: scheduledApprovals.filter((approval) => approval.assigneeMemberId === member.id),
  }))
  const known = new Set(members.map(({ id }) => id))
  const unknown = ({ assigneeMemberId }: { assigneeMemberId: string | null }) =>
    assigneeMemberId !== null && !known.has(assigneeMemberId)
  groups.push(
    {
      key: 'unknown',
      name: null,
      label: '알 수 없는 담당자',
      note: '팀원 정보를 찾지 못했어요',
      tasks: scheduledTasks.filter(unknown),
      approvals: scheduledApprovals.filter(unknown),
    },
    {
      key: 'unassigned',
      name: null,
      label: '미지정',
      note: '승인하면 담당자가 붙습니다',
      tasks: scheduledTasks.filter((task) => task.assigneeMemberId === null),
      approvals: scheduledApprovals.filter((approval) => approval.assigneeMemberId === null),
    },
  )
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
  names,
  tasks,
  approvals,
  approvalsMissing,
  today,
  from,
  onFromChange,
}: GanttViewProps) {
  const days = ganttDays(from)
  const todayIndex = days.indexOf(today)
  const { groups, unscheduledTasks, unscheduledApprovals } = useMemo(
    () => groupRows(members, tasks, approvals),
    [members, tasks, approvals],
  )
  const weekends = days.flatMap((date, index) => {
    const day = new Date(`${date}T00:00:00Z`).getUTCDay()
    return day === 0 || day === 6 ? [index] : []
  })
  const unscheduledCount = unscheduledTasks.length + unscheduledApprovals.length
  const emptyWindow = groups.every(
    (group) =>
      group.tasks.every((task) => taskBarRange(task, from) === null) &&
      group.approvals.every((approval) => approvalChipRange(approval, from) === null),
  )
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
      {emptyWindow ? (
        <p className="text-caption text-dim">
          {approvalsMissing
            ? '불러온 태스크에는 이 3주에 일정이 있는 일이 없어요.'
            : '이 3주에는 일정이 있는 일이 없어요.'}
        </p>
      ) : null}
      <HorizontalScroll label="일정 표">
        <div
          role="table"
          aria-label="일정"
          className="relative overflow-hidden rounded-16 border border-line bg-surface"
          style={{ minWidth: TABLE_MIN_WIDTH }}
        >
          {/* 주말 음영·오늘 선. `inset-0`·`top-0` 은 쓰지 않는다 — tokens.css 가 동적 간격 스케일을 꺼서 `*-0` 유틸이
              생성되지 않아, 이 층이 높이 0 으로 접혀 보이지 않았다 (Modal 과 같은 까닭, m4 결정 2026-09-29-modal-inset-zero) */}
          <div aria-hidden="true" className="absolute inset-[0px] z-0 flex">
            <div style={{ flex: `0 0 ${LABEL_WIDTH}px` }} />
            <div className="relative grid flex-1" style={GRID}>
              {weekends.map((index) => (
                <span key={index} className="bg-surface-sunken" style={{ gridColumn: index + 1 }} />
              ))}
              {todayIndex === -1 ? null : (
                <span
                  data-gantt-today=""
                  className="absolute top-[0px] bottom-[0px] w-px bg-ink"
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
                counted={!approvalsMissing}
                from={from}
                today={today}
              />
            ))}
          </div>
        </div>
      </HorizontalScroll>
      <section aria-label="일정이 없는 일" className="flex flex-col gap-4">
        <h2 className="py-8 text-body font-semibold text-ink">
          일정이 없는 일
          {approvalsMissing ? null : (
            <span className="font-normal text-dim tabular-nums"> {unscheduledCount}</span>
          )}
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
              memberId={approval.assigneeMemberId}
              names={names}
              to={`${paths.tasks(workspaceId)}?tab=needs_review`}
            />
          ))}
          {unscheduledTasks.map((task) => (
            <UnscheduledRow
              key={task.id}
              title={task.title}
              note="마감일이 정해지지 않았어요"
              memberId={task.assigneeMemberId}
              names={names}
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
  counted,
  from,
  today,
}: {
  workspaceId: string
  group: Group
  /** 건수를 보인다. 확인 필요를 받지 못했으면 건수가 전부가 아니라 숨긴다 */
  counted: boolean
  from: string
  today: string
}) {
  return (
    <>
      <div className="flex items-stretch border-t border-line">
        <div
          className="flex min-w-[0px] items-center gap-9 border-r border-line bg-surface-sunken px-14 py-8"
          style={{ flex: `0 0 ${LABEL_WIDTH}px` }}
        >
          <Avatar name={group.name} />
          <span className="min-w-[0px] truncate text-caption font-semibold text-ink">
            {group.label}
          </span>
          {/* 시안대로 한 줄이다. 시안 값(252px 칸·간격 9)으로는 `승인하면 담당자가 붙습니다` 가 0.4px 모자라 줄이 바뀐다
              (Chromium·NanumSquare 실측) — 자간을 1% 줄여 넣고, 건수가 길어 더 모자라면 말줄임한다 */}
          <span className="min-w-[0px] flex-1 truncate text-[11px] tracking-[-0.01em] text-dim">
            {group.note}
          </span>
          {counted ? (
            <span className="shrink-0 text-[11px] text-dim tabular-nums">
              {group.tasks.length + group.approvals.length}건
            </span>
          ) : null}
        </div>
        <div className="flex-1" />
      </div>
      {group.approvals.map((approval) => (
        <ApprovalRow key={approval.id} approval={approval} from={from} />
      ))}
      {group.tasks.map((task) => (
        <TaskRow key={task.id} workspaceId={workspaceId} task={task} from={from} today={today} />
      ))}
    </>
  )
}

/* 줄 하나씩 memo 다. 묶음(`Group`)은 렌더마다 새로 만들어지지만 줄은 같은 태스크·승인 객체를 받아, 상태가 바뀐 줄만 다시 그린다 (AC-A-04) */

const TaskRow = memo(function TaskRow({
  workspaceId,
  task,
  from,
  today,
}: {
  workspaceId: string
  task: Task
  from: string
  today: string
}) {
  return (
    <Row title={task.title} to={paths.tasks(workspaceId, task.id)} done={task.status === 'done'}>
      <TaskBar task={task} from={from} today={today} />
    </Row>
  )
})

const ApprovalRow = memo(function ApprovalRow({
  approval,
  from,
}: {
  approval: TaskCreateApproval
  from: string
}) {
  return (
    <Row title={approval.title}>
      <ApprovalChip approval={approval} from={from} />
    </Row>
  )
})

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
        className="flex min-h-44 min-w-[0px] items-center gap-8 border-r border-line px-14"
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

/** 태스크 막대가 차지하는 칸. 창 밖이거나 마감이 없으면 null */
function taskBarRange(task: Task, from: string): [number, number] | null {
  if (task.dueDate === null) return null
  const start = task.startDate <= task.dueDate ? task.startDate : task.dueDate
  // 완료는 막대가 아니라 마감 앞 며칠을 옅게 깔아 `MM/DD 완료` 라벨이 보이게 한다
  return clampRange(from, task.status === 'done' ? addDays(task.dueDate, -3) : start, task.dueDate)
}

/** 생성 승인 칩이 차지하는 칸. 마감 하루를 앞으로 넓혀 그린다 */
function approvalChipRange(approval: TaskCreateApproval, from: string): [number, number] | null {
  if (approval.dueDate === null) return null
  const range = clampRange(from, approval.dueDate, approval.dueDate)
  if (range === null) return null
  const start = Math.max(range[0] - 1, 1)
  return [start, Math.min(start + 3, GANTT_DAYS + 1)]
}

function TaskBar({ task, from, today }: { task: Task; from: string; today: string }) {
  const range = taskBarRange(task, from)
  if (task.dueDate === null || range === null) return null
  const tone = taskTone(task, today)
  const start = task.startDate <= task.dueDate ? task.startDate : task.dueDate
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
  const range = approvalChipRange(approval, from)
  if (approval.dueDate === null || range === null) return null
  return (
    <span
      className="mx-3 flex h-26 items-center justify-center rounded-7 border-2 border-dashed bg-surface px-9 text-[10.5px] whitespace-nowrap text-dim tabular-nums"
      style={{ gridColumn: `${range[0]} / ${range[1]}` }}
    >
      마감 {shortDate(approval.dueDate)}
    </span>
  )
}

const UnscheduledRow = memo(function UnscheduledRow({
  title,
  note,
  memberId,
  names,
  to,
}: {
  title: string
  note: string
  memberId: string | null
  names: ReadonlyMap<string, string>
  to: string
}) {
  return (
    <li className="flex items-center gap-14 border-b border-line py-14 last:border-b-0">
      <span className="inline-flex h-[22px] shrink-0 items-center rounded-6 border-2 border-dashed px-8 text-meta leading-none font-semibold text-dim">
        일정 없음
      </span>
      <span className="min-w-[0px] text-[14px] font-semibold wrap-anywhere text-ink">{title}</span>
      <span className="flex-1 text-right text-caption text-dim">{note}</span>
      <span className="inline-flex items-center gap-7 text-caption text-dim">
        <Avatar name={memberId === null ? null : (names.get(memberId) ?? null)} />
        {assigneeLabel(memberId, names, '미지정')}
      </span>
      <GuardedLink
        to={to}
        className="inline-flex h-32 shrink-0 items-center gap-3 px-4 text-caption font-semibold text-ink"
      >
        날짜 넣기
        <Icon name="chevron-right" size={13} />
      </GuardedLink>
    </li>
  )
})
