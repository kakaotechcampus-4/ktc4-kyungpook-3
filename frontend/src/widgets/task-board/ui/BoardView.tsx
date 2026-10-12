import type { Task, TaskStatus } from '@/entities/task'
import { paths } from '@/shared/config/routes'
import { GuardedLink } from '@/shared/lib/unsaved-changes'
import { sortTasks } from '../lib/taskBoard'
import { assigneeOf, monthOf, shortDate, taskTone } from '../lib/taskViews'
import type { BoardPeriod } from '../lib/taskViews'
import { Avatar } from './viewParts'

type Column = 'todo' | 'active' | 'done'

const COLUMNS: readonly { key: Column; title: string; statuses: readonly TaskStatus[] }[] = [
  { key: 'todo', title: '시작 전', statuses: ['todo'] },
  { key: 'active', title: '진행 중', statuses: ['in_progress', 'blocked'] },
  { key: 'done', title: '완료', statuses: ['done'] },
]

const MARK: Record<Column, string> = {
  todo: 'rounded-4 border-[1.5px] border-dashed bg-transparent',
  active: 'rounded-4 bg-ink',
  done: 'rounded-4 bg-inactive',
}

const CARD_BASE = 'flex flex-col gap-12 rounded-12 border px-13 py-12'

export interface BoardViewProps {
  workspaceId: string
  tasks: readonly Task[]
  names: ReadonlyMap<string, string>
  today: string
  period: BoardPeriod
  /** 확인 필요 승인 수. PM 이 아니면 0 이다 */
  pendingApprovals: number
}

/** 보드 (TasksBoard 시안). 승인이 끝난 태스크만 상태 세 칸으로 나뉜다 */
export function BoardView({
  workspaceId,
  tasks,
  names,
  today,
  period,
  pendingApprovals,
}: BoardViewProps) {
  const scoped =
    period === 'month'
      ? tasks.filter((task) => task.dueDate === null || monthOf(task.dueDate) === monthOf(today))
      : tasks
  return (
    <>
      <div className="grid grid-cols-3 items-start gap-18">
        {COLUMNS.map(({ key, title, statuses }) => {
          const inColumn = scoped.filter((task) => statuses.includes(task.status))
          const sorted =
            key === 'done'
              ? [...inColumn].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
              : sortTasks(inColumn)
          return (
            <section key={key} aria-label={title} className="flex flex-col gap-10">
              <ColumnHead
                column={key}
                title={title}
                count={sorted.length}
                note={columnNote(key, sorted, today)}
              />
              <ul className="flex flex-col gap-10">
                {sorted.map((task) => (
                  <li key={task.id}>
                    <TaskCard workspaceId={workspaceId} task={task} names={names} today={today} />
                  </li>
                ))}
              </ul>
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

function columnNote(column: Column, tasks: readonly Task[], today: string): string {
  if (column === 'todo') {
    const due = tasks.find((task) => task.dueDate !== null)?.dueDate
    return due === undefined || due === null ? '마감일 없음' : `가장 이른 마감 ${shortDate(due)}`
  }
  if (column === 'done') return '최근 완료순'
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
        <span
          aria-hidden="true"
          className={`h-8 w-8 shrink-0 ${MARK[column]} ${column === 'todo' ? 'border-dashed' : ''}`}
        />
        <h2 className="flex-1 text-body font-semibold text-ink">{title}</h2>
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

function TaskCard({
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
  const done = tone === 'done'
  const assignee = assigneeOf(task, names)
  return (
    <article
      className={`${CARD_BASE} ${
        done
          ? 'border-divider bg-surface-sunken'
          : tone === 'danger' || tone === 'warn'
            ? 'border-line-strong bg-surface'
            : 'border-line bg-surface'
      }`}
    >
      <div className="flex items-start justify-between gap-8">
        <GuardedLink
          to={paths.tasks(workspaceId, task.id)}
          className={`min-w-[0px] text-[13px] leading-[1.45] ${
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
          <Avatar name={assignee} size={21} muted={done} />
          {assignee ?? '담당자 없음'}
        </span>
        <span className="text-meta text-dim tabular-nums">
          {task.dueDate === null ? '마감 없음' : shortDate(task.dueDate)}
        </span>
      </div>
    </article>
  )
}
