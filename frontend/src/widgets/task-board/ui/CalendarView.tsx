import { memo, useMemo } from 'react'
import type { TaskCreateApproval } from '@/entities/approval'
import type { Task } from '@/entities/task'
import { paths } from '@/shared/config/routes'
import { GuardedLink } from '@/shared/lib/unsaved-changes'
import {
  addMonths,
  assigneeLabel,
  calendarGrid,
  monthOf,
  monthTitle,
  taskTone,
} from '../lib/taskViews'
import type { TaskTone } from '../lib/taskViews'
import { LegendItem, RangeHeader } from './viewParts'

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'] as const
const DAYS_PER_WEEK = WEEKDAYS.length

/* 링크를 담은 읽기 전용 표다 — 칸 사이 이동은 Tab 이 링크를 따라간다(방향키 이동이 필요한 grid 가 아니다).
   요일 머리·주마다 `row` 로 묶되, 보이는 배치는 바깥 7열 격자를 subgrid 로 그대로 잇는다 */
const WEEK_ROW = 'col-span-full grid grid-cols-subgrid'

/** 칩 색 — 진행 중은 회색, 마감 임박(주의·위험)은 강조색, 완료는 취소선 */
const CHIP: Record<TaskTone, { box: string; title: string; sub: string }> = {
  done: {
    box: 'bg-surface-sunken',
    title: 'text-dim line-through',
    sub: 'text-dim',
  },
  danger: { box: 'bg-accent', title: 'text-surface', sub: 'text-surface' },
  warn: { box: 'bg-accent', title: 'text-surface', sub: 'text-surface' },
  active: { box: 'bg-surface-selected', title: 'text-ink', sub: 'text-sub' },
  todo: { box: 'bg-surface-selected', title: 'text-ink', sub: 'text-sub' },
}

/* 칸 폭은 7등분이다. 줄바꿈할 곳이 없는 긴 제목·이름도 칸 안에서 접어 잘리지 않게 한다 */
const CHIP_BASE = 'flex flex-col gap-1 rounded-6 px-8 py-6 wrap-anywhere'

interface CalendarMeeting {
  id: string
  title: string
  date: string
}

/** 한 날짜에 놓이는 것들 */
interface DayItems {
  tasks: Task[]
  approvals: TaskCreateApproval[]
  meetings: CalendarMeeting[]
}

export interface CalendarViewProps {
  workspaceId: string
  tasks: readonly Task[]
  /** 확인 필요 생성 승인. PM 이 아니면 비어 있다 */
  approvals: readonly TaskCreateApproval[]
  /** 확인 필요를 받지 못했다. 빈 달은 불러온 태스크 범위로만 말하고, 확인 필요가 빠진 개수는 보이지 않는다 */
  approvalsMissing: boolean
  /** 회의. `YYYY-MM-DD`(서울) 에 점선 칩으로 놓는다 */
  meetings: readonly CalendarMeeting[]
  names: ReadonlyMap<string, string>
  today: string
  month: string
  onMonthChange: (month: string) => void
}

/** 캘린더 (TasksCalendar 시안). 마감일 기준이고 날짜가 없는 일은 아래 칸에 모은다 */
export function CalendarView({
  workspaceId,
  tasks,
  approvals,
  approvalsMissing,
  meetings,
  names,
  today,
  month,
  onMonthChange,
}: CalendarViewProps) {
  const weeks = useMemo(() => {
    const grid = calendarGrid(month)
    return Array.from({ length: grid.length / DAYS_PER_WEEK }, (_, week) =>
      grid.slice(week * DAYS_PER_WEEK, (week + 1) * DAYS_PER_WEEK),
    )
  }, [month])
  // 날짜 칸(4~6주)이 저마다 배열 전체를 거르지 않게 마감일로 한 번만 묶는다
  const byDate = useMemo(() => {
    const index = new Map<string, DayItems>()
    const at = (date: string) => {
      let day = index.get(date)
      if (day === undefined) {
        day = { tasks: [], approvals: [], meetings: [] }
        index.set(date, day)
      }
      return day
    }
    for (const task of tasks) if (task.dueDate !== null) at(task.dueDate).tasks.push(task)
    for (const approval of approvals)
      if (approval.dueDate !== null) at(approval.dueDate).approvals.push(approval)
    for (const meeting of meetings) at(meeting.date).meetings.push(meeting)
    return index
  }, [tasks, approvals, meetings])
  const undated = [
    ...approvals.filter((approval) => approval.dueDate === null),
    ...tasks.filter((task) => task.dueDate === null),
  ]
  const dueInMonth = (item: { dueDate: string | null }) =>
    item.dueDate !== null && monthOf(item.dueDate) === month
  const emptyMonth = !tasks.some(dueInMonth) && !approvals.some(dueInMonth)
  return (
    <>
      <RangeHeader
        title={monthTitle(month)}
        prevLabel="이전 달"
        nextLabel="다음 달"
        onPrev={() => onMonthChange(addMonths(month, -1))}
        onNext={() => onMonthChange(addMonths(month, 1))}
        legend={
          <>
            <LegendItem swatch="bg-ink">확인 필요</LegendItem>
            <LegendItem swatch="bg-accent">마감 임박</LegendItem>
            <LegendItem swatch="bg-surface-selected">진행 중</LegendItem>
            <LegendItem swatch="border-2 border-dashed bg-surface">회의</LegendItem>
          </>
        }
      />
      {emptyMonth ? (
        <p className="text-caption text-dim">
          {approvalsMissing
            ? '불러온 태스크에는 이 달에 마감인 일이 없어요.'
            : '이 달에는 마감인 일이 없어요.'}
        </p>
      ) : null}
      <div
        role="table"
        aria-label={monthTitle(month)}
        className="grid grid-cols-7 gap-1 overflow-hidden rounded-16 border border-line bg-line"
      >
        <div role="row" className={WEEK_ROW}>
          {WEEKDAYS.map((day, index) => (
            <div
              key={day}
              role="columnheader"
              className={`bg-surface-sunken px-10 py-9 text-meta font-semibold ${
                isWeekend(index) ? 'text-dim' : 'text-sub'
              }`}
            >
              {day}
            </div>
          ))}
        </div>
        {weeks.map((week) => (
          <div key={week[0].date} role="row" className={WEEK_ROW}>
            {week.map(({ date, inMonth }) => {
              const {
                tasks: dayTasks = [],
                approvals: dayApprovals = [],
                meetings: dayMeetings = [],
              } = byDate.get(date) ?? {}
              return (
                <div
                  key={date}
                  role="cell"
                  aria-label={date}
                  className={`flex min-h-[116px] flex-col gap-5 bg-surface ${inMonth ? 'p-9' : 'px-20 py-18'}`}
                >
                  <DayNumber date={date} today={date === today} inMonth={inMonth} />
                  {inMonth ? (
                    <>
                      {dayApprovals.map((approval) => (
                        <GuardedLink
                          key={approval.id}
                          to={`${paths.tasks(workspaceId)}?tab=needs_review`}
                          className={`${CHIP_BASE} bg-ink`}
                        >
                          <span className="text-[11.5px] leading-[1.4] font-bold text-surface">
                            {approval.title}
                          </span>
                          <span className="text-[10.5px] text-surface tabular-nums">
                            {assigneeLabel(approval.assigneeMemberId, names, '담당자 미정')}
                          </span>
                        </GuardedLink>
                      ))}
                      {dayTasks.map((task) => (
                        <TaskChip
                          key={task.id}
                          workspaceId={workspaceId}
                          task={task}
                          names={names}
                          today={today}
                        />
                      ))}
                      {dayMeetings.map((meeting) => (
                        <GuardedLink
                          key={meeting.id}
                          to={paths.meetings(workspaceId, meeting.id)}
                          className="flex items-center gap-6 rounded-6 border border-dashed px-8 py-6 text-[11.5px] leading-[1.4] wrap-anywhere text-sub"
                        >
                          {meeting.title}
                        </GuardedLink>
                      ))}
                    </>
                  ) : null}
                </div>
              )
            })}
          </div>
        ))}
      </div>
      <section
        aria-label="마감일 없음"
        className="flex flex-wrap items-center gap-16 rounded-16 border border-line bg-surface px-18 py-16"
      >
        <div className="flex flex-col gap-2">
          <h2 className="text-control font-semibold text-ink">마감일 없음</h2>
          {approvalsMissing ? null : (
            <span className="text-meta text-dim tabular-nums">{undated.length}</span>
          )}
        </div>
        <ul className="flex flex-wrap items-center gap-10">
          {undated.map((item) =>
            'kind' in item ? (
              <li key={item.id}>
                <GuardedLink
                  to={`${paths.tasks(workspaceId)}?tab=needs_review`}
                  className="flex flex-col gap-1 rounded-7 bg-ink px-11 py-7 wrap-anywhere"
                >
                  <span className="text-[12px] leading-[1.4] font-bold text-surface">
                    {item.title}
                  </span>
                  <span className="text-[10.5px] text-surface">
                    {item.assigneeMemberId === null
                      ? '담당자 · 마감 모두 미정'
                      : `${assigneeLabel(item.assigneeMemberId, names)} · 날짜를 정해 주세요`}
                  </span>
                </GuardedLink>
              </li>
            ) : (
              <UndatedTask key={item.id} workspaceId={workspaceId} task={item} names={names} />
            ),
          )}
        </ul>
        <span className="flex-1" />
        {approvals.length > 0 ? (
          <span className="text-caption text-dim">여기 있는 일은 Notion에 올라가지 않았습니다</span>
        ) : null}
      </section>
    </>
  )
}

/** 일·토(줄의 첫·끝 칸) — 요일 머리를 흐리게 쓴다 (시안) */
function isWeekend(column: number): boolean {
  return column === 0 || column === DAYS_PER_WEEK - 1
}

/** 날짜 칸의 숫자. 오늘은 먹 원, 다른 달은 점선 색이다 */
function DayNumber({ date, today, inMonth }: { date: string; today: boolean; inMonth: boolean }) {
  const tone = inMonth ? 'text-sub' : 'text-dashed'
  return (
    <span
      className={
        today
          ? 'inline-flex h-22 min-w-[22px] items-center justify-center self-start rounded-999 bg-ink px-6 text-[12px] leading-none text-surface tabular-nums'
          : `text-[12px] tabular-nums ${tone}`
      }
    >
      {Number(date.slice(8, 10))}
    </span>
  )
}

/** `마감일 없음` 칸의 태스크 하나. 마감 없는 태스크는 데이터와 함께 늘어나 칩처럼 memo 다 (AC-A-04) */
const UndatedTask = memo(function UndatedTask({
  workspaceId,
  task,
  names,
}: {
  workspaceId: string
  task: Task
  names: ReadonlyMap<string, string>
}) {
  return (
    <li>
      <GuardedLink
        to={paths.tasks(workspaceId, task.id)}
        className="flex flex-col gap-1 rounded-7 border-2 border-dashed px-11 py-7 wrap-anywhere"
      >
        <span className="text-[12px] leading-[1.4] text-sub">{task.title}</span>
        <span className="text-[10.5px] text-dim">
          {assigneeLabel(task.assigneeMemberId, names)} · 마감 없음
        </span>
      </GuardedLink>
    </li>
  )
})

/** 칩 하나. 상태가 바뀐 태스크만 다시 그린다 (AC-A-04) */
const TaskChip = memo(function TaskChip({
  workspaceId,
  task,
  names,
  today,
}: {
  workspaceId: string
  task: Task
  names: ReadonlyMap<string, string>
  today: string
}) {
  const tone = taskTone(task, today)
  const style = CHIP[tone]
  const meta = [
    assigneeLabel(task.assigneeMemberId, names),
    task.progress === null ? null : `${task.progress}%`,
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <GuardedLink to={paths.tasks(workspaceId, task.id)} className={`${CHIP_BASE} ${style.box}`}>
      <span className={`text-[11.5px] leading-[1.4] ${style.title}`}>{task.title}</span>
      <span className={`text-[10.5px] tabular-nums ${style.sub}`}>{meta}</span>
    </GuardedLink>
  )
})
