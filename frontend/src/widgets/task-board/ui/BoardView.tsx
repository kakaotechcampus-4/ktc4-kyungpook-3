import { memo } from 'react'
import type { Task, TaskStatus } from '@/entities/task'
import { TaskQuickAdd } from '@/features/task-create'
import { paths } from '@/shared/config/routes'
import { GuardedLink } from '@/shared/lib/unsaved-changes'
import { doneColumnNote, sortDoneColumn, sortTasks } from '../lib/taskSort'
import type { TaskSort } from '../lib/taskSort'
import { assigneeLabel, assigneeOf, monthOf, shortDate, taskTone } from '../lib/taskViews'
import type { BoardPeriod, TaskTone } from '../lib/taskViews'
import { Avatar } from './viewParts'

type Column = 'todo' | 'active' | 'done'

/** 칸마다 담는 상태와, `직접 추가` 로 만든 태스크의 상태 */
const COLUMNS: readonly {
  key: Column
  title: string
  statuses: readonly TaskStatus[]
  createAs: TaskStatus
}[] = [
  { key: 'todo', title: '시작 전', statuses: ['todo'], createAs: 'todo' },
  {
    key: 'active',
    title: '진행 중',
    statuses: ['in_progress', 'blocked'],
    createAs: 'in_progress',
  },
  { key: 'done', title: '완료', statuses: ['done'], createAs: 'done' },
]

/* 칸 머리 표식 — 8px·둥글기 2px 네모. 시작 전은 1.5px 실선 `#BDBDBD` 테두리, 완료는 `#E8E8E8` 면이다 (TasksBoard).
   `border-dashed` 는 점선 모양까지 함께 주므로 시작 전은 색만 점선 토큰에서 가져온다. 2px 둥글기는 토큰에 없어 값으로 적는다 */
const MARK: Record<Column, string> = {
  todo: 'rounded-[2px] border-[1.5px] border-(--color-dashed) bg-transparent',
  active: 'rounded-[2px] bg-ink',
  done: 'rounded-[2px] bg-line',
}

const CARD_BASE = 'flex flex-col gap-12 rounded-12 border px-13 py-12'

export interface BoardViewProps {
  workspaceId: string
  tasks: readonly Task[]
  names: ReadonlyMap<string, string>
  today: string
  period: BoardPeriod
  /** 칸 안의 순서. 완료 칸은 정렬마다 따로 정한 순서다 */
  sort: TaskSort
  /** 확인 필요 승인 수. PM 이 아니면 0 이다 */
  pendingApprovals: number
  /** 칸마다 `직접 추가` 를 둔다. 태스크 생성은 서버에서 PM 전용이다 */
  canCreate: boolean
  /** 담당자 조건. 걸러 보는 중이면 직접 추가한 태스크의 담당자로 넣는다 */
  assignee: string | null
}

/** 보드 (TasksBoard 시안). 승인이 끝난 태스크만 상태 세 칸으로 나뉜다 */
export function BoardView({
  workspaceId,
  tasks,
  names,
  today,
  period,
  sort,
  pendingApprovals,
  canCreate,
  assignee,
}: BoardViewProps) {
  const scoped =
    period === 'month'
      ? tasks.filter((task) => task.dueDate === null || monthOf(task.dueDate) === monthOf(today))
      : tasks
  return (
    <>
      <div className="grid grid-cols-3 items-start gap-18">
        {COLUMNS.map(({ key, title, statuses, createAs }) => {
          const inColumn = scoped.filter((task) => statuses.includes(task.status))
          const sorted = key === 'done' ? sortDoneColumn(inColumn, sort) : sortTasks(inColumn, sort)
          return (
            <section key={key} aria-label={title} className="flex flex-col gap-10">
              <ColumnHead
                column={key}
                title={title}
                count={sorted.length}
                note={columnNote(key, sorted, today, sort)}
              />
              <ul className="flex flex-col gap-10">
                {sorted.map((task) => (
                  <li key={task.id}>
                    <TaskCard
                      workspaceId={workspaceId}
                      task={task}
                      names={names}
                      today={today}
                      emphasized={key === 'active'}
                    />
                  </li>
                ))}
              </ul>
              {canCreate ? (
                <TaskQuickAdd
                  workspaceId={workspaceId}
                  status={createAs}
                  columnLabel={title}
                  assigneeMemberId={assignee}
                />
              ) : null}
            </section>
          )
        })}
      </div>
      {pendingApprovals > 0 ? (
        <p className="text-caption text-dim">
          확인이 필요한 일 <span className="text-ink tabular-nums">{pendingApprovals}</span>건은
          리스트 뷰에서 승인하면 이 보드로 넘어옵니다.
        </p>
      ) : null}
    </>
  )
}

/** 카드 테두리·면. 완료는 눌린 면이고, 진행 중 칸과 마감 임박(위험·주의)은 강조 테두리다 — 시작 전 칸의 마감 임박은
    시안에 예가 없어 지금 봐야 하는 카드로 강조한다 */
function cardSurface(tone: TaskTone, emphasized: boolean): string {
  if (tone === 'done') return 'border-divider bg-surface-sunken'
  return emphasized || tone === 'danger' || tone === 'warn'
    ? 'border-line-strong bg-surface'
    : 'border-line bg-surface'
}

function columnNote(column: Column, tasks: readonly Task[], today: string, sort: TaskSort): string {
  if (column === 'todo') {
    // 칸 순서는 정렬마다 달라 첫 마감이 가장 이르다고 볼 수 없다
    const due = tasks.reduce<string | null>(
      (earliest, { dueDate }) =>
        dueDate !== null && (earliest === null || dueDate < earliest) ? dueDate : earliest,
      null,
    )
    return due === null ? '마감일 없음' : `가장 이른 마감 ${shortDate(due)}`
  }
  if (column === 'done') return doneColumnNote(sort)
  const danger = tasks.filter((task) => taskTone(task, today) === 'danger').length
  const warn = tasks.filter((task) => taskTone(task, today) === 'warn').length
  return `위험 ${danger} · 주의 ${warn}`
}

function ColumnHead({
  column,
  title,
  count,
  note,
}: {
  column: Column
  title: string
  count: number
  note: string
}) {
  return (
    <div className="flex flex-col gap-4 border-b border-line px-2 pb-12">
      <div className="flex items-center gap-8">
        <span aria-hidden="true" className={`h-8 w-8 shrink-0 ${MARK[column]}`} />
        <h2
          className={`flex-1 text-body font-semibold ${column === 'done' ? 'text-dim' : 'text-ink'}`}
        >
          {title}
        </h2>
        <span
          className={`inline-flex h-[19px] min-w-[19px] items-center justify-center rounded-6 px-6 text-[11px] leading-none font-semibold tabular-nums ${
            column === 'active' ? 'bg-ink text-surface' : 'bg-divider text-sub'
          }`}
        >
          {count}
        </span>
      </div>
      <p className="pl-16 text-meta leading-[1.5] text-dim">{note}</p>
    </div>
  )
}

/** 카드 한 장. 상태가 바뀐 태스크만 다시 그린다 — 나머지 카드는 같은 태스크 객체·이름 표를 받는다 (AC-A-04) */
const TaskCard = memo(function TaskCard({
  workspaceId,
  task,
  names,
  today,
  emphasized,
}: {
  workspaceId: string
  task: Task
  names: ReadonlyMap<string, string>
  today: string
  /** 진행 중 칸의 카드다. 시안은 이 칸의 카드를 모두 강조 테두리(`#C9C9C9`)로 그린다 */
  emphasized: boolean
}) {
  const tone = taskTone(task, today)
  const done = tone === 'done'
  return (
    <article className={`${CARD_BASE} ${cardSurface(tone, emphasized)}`}>
      <div className="flex items-start justify-between gap-8">
        <GuardedLink
          to={paths.tasks(workspaceId, task.id)}
          className={`min-w-[0px] text-[13px] leading-[1.45] wrap-anywhere ${
            done ? 'font-normal text-dim line-through' : 'font-semibold text-ink'
          }`}
        >
          {task.title}
        </GuardedLink>
        {tone === 'danger' ? (
          <span className="inline-flex h-20 shrink-0 items-center rounded-6 bg-accent px-7 text-[10.5px] leading-none font-bold text-surface">
            위험
          </span>
        ) : tone === 'warn' ? (
          <span className="inline-flex h-20 shrink-0 items-center gap-3 rounded-6 bg-ink px-7 text-[10.5px] leading-none font-semibold text-surface">
            <span aria-hidden="true" className="mr-3 h-5 w-5 rounded-999 bg-current" />
            주의
          </span>
        ) : null}
      </div>
      <div className="flex items-center justify-between gap-8">
        <span
          className={`inline-flex min-w-[0px] items-center gap-6 text-meta ${done ? 'text-dim' : 'text-sub'}`}
        >
          <Avatar name={assigneeOf(task, names)} size={21} muted={done} />
          <span className="truncate">{assigneeLabel(task.assigneeMemberId, names)}</span>
        </span>
        <span className="shrink-0 text-meta text-dim tabular-nums">
          {task.dueDate === null ? '마감 없음' : shortDate(task.dueDate)}
        </span>
      </div>
    </article>
  )
})
