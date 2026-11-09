import { useId } from 'react'
import type { MapSelection, ProjectMap, TaskNode } from '@/entities/project-map'
import { TASK_STATUS_LABEL, TaskStatusMark } from '@/entities/task'
import { monthDayOf } from '@/shared/lib/date'
import { NOTE, ROW_META, SECTION_TITLE } from './frame'

const SECTIONS = 'flex flex-col gap-28'
const SECTION = 'flex flex-col gap-8'
const TOPIC_BUTTON =
  'rounded-6 text-left hover:text-sub aria-[current=true]:underline aria-[current=true]:underline-offset-4'
const ROW =
  'flex w-full items-center gap-12 border-b border-line py-12 text-left hover:bg-surface-sunken aria-[current=true]:bg-surface-selected'
const STATUS = 'inline-flex w-[64px] shrink-0 items-center gap-6 text-caption text-sub'
const ROW_TITLE = 'min-w-[0px] flex-1 text-[14px] font-semibold text-ink max-md:wrap-anywhere'

interface ListProps {
  map: ProjectMap
  selection: MapSelection
  onSelect: (selection: MapSelection) => void
}

function TaskRows({
  tasks,
  selection,
  onSelect,
}: {
  tasks: readonly TaskNode[]
  selection: MapSelection
  onSelect: (selection: MapSelection) => void
}) {
  return (
    <ul className="flex flex-col">
      {tasks.map((task) => (
        <li key={task.id}>
          <button
            type="button"
            className={ROW}
            aria-current={selection?.kind === 'task' && selection.id === task.id}
            onClick={() => onSelect({ kind: 'task', id: task.id })}
          >
            <span className={STATUS}>
              <TaskStatusMark status={task.status} />
              {TASK_STATUS_LABEL[task.status]}
            </span>
            <span className={ROW_TITLE}>{task.label}</span>
            <span className={ROW_META}>{task.assigneeName ?? '담당 없음'}</span>
            <span className={ROW_META}>
              {task.dueDate === null ? '마감 없음' : `마감 ${monthDayOf(task.dueDate)}`}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}

/**
 * 목록 보기. 그래프와 같은 내용을 주제별로 적는다 — 키보드·스크린리더와 휴대폰의 길이다.
 * 주제 이름과 태스크 줄이 모두 단추이고 누르면 그래프와 같은 패널이 열린다
 */
export function MapListView({ map, selection, onSelect }: ListProps) {
  const prefix = useId()
  return (
    <div className={SECTIONS}>
      {map.topicGroups.map(({ topic, tasks }) => (
        <section key={topic.id} aria-labelledby={`${prefix}-${topic.id}`} className={SECTION}>
          <h2 id={`${prefix}-${topic.id}`} className={SECTION_TITLE}>
            <button
              type="button"
              className={TOPIC_BUTTON}
              aria-current={selection?.kind === 'topic' && selection.id === topic.id}
              onClick={() => onSelect({ kind: 'topic', id: topic.id })}
            >
              {topic.label}
            </button>
          </h2>
          {tasks.length === 0 ? (
            <p className={NOTE}>이어진 태스크가 없어요.</p>
          ) : (
            <TaskRows tasks={tasks} selection={selection} onSelect={onSelect} />
          )}
        </section>
      ))}
      {map.looseTasks.length === 0 ? null : (
        <section aria-labelledby={`${prefix}-loose`} className={SECTION}>
          <h2 id={`${prefix}-loose`} className={SECTION_TITLE}>
            주제 없는 태스크
          </h2>
          <TaskRows tasks={map.looseTasks} selection={selection} onSelect={onSelect} />
        </section>
      )}
    </div>
  )
}
