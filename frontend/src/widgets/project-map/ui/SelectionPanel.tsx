import type { MapSelection, ProjectMap, TaskNode, TopicNode } from '@/entities/project-map'
import { TASK_STATUS_LABEL, TaskStatusMark } from '@/entities/task'
import { paths } from '@/shared/config/routes'
import { GuardedLink } from '@/shared/lib/unsaved-changes'
import { BODY, LINK, LIST, MeetingLinks, Section, TaskLine } from './panelParts'
import { TopicBody } from './TopicPanel'

const FIELDS = 'grid grid-cols-[56px_minmax(0px,1fr)] gap-x-12 gap-y-10 text-body'
const FIELD_NAME = 'text-dim'
const FIELD_VALUE = 'min-w-[0px] text-ink wrap-anywhere'

function TaskBody({
  workspaceId,
  task,
  map,
  onSelect,
}: {
  workspaceId: string
  task: TaskNode
  map: ProjectMap
  onSelect: (selection: MapSelection) => void
}) {
  const related = map.relatedTasks.get(task.id) ?? []
  const meetings = task.meetingIds.flatMap((id) => {
    const meeting = map.meetingById.get(id)
    return meeting === undefined ? [] : [meeting]
  })
  return (
    <div className={BODY}>
      <dl className={FIELDS}>
        <dt className={FIELD_NAME}>상태</dt>
        <dd className={`${FIELD_VALUE} inline-flex items-center gap-6`}>
          <TaskStatusMark status={task.status} />
          {TASK_STATUS_LABEL[task.status]}
        </dd>
        <dt className={FIELD_NAME}>담당</dt>
        <dd className={FIELD_VALUE}>{task.assigneeName ?? '담당 없음'}</dd>
        <dt className={FIELD_NAME}>마감</dt>
        <dd className={FIELD_VALUE}>{task.dueDate ?? '마감 없음'}</dd>
        {task.blocker === null ? null : (
          <>
            <dt className={FIELD_NAME}>막힘</dt>
            <dd className={FIELD_VALUE}>{task.blocker}</dd>
          </>
        )}
      </dl>
      {related.length === 0 ? null : (
        <Section title="이어진 태스크">
          <ul className={LIST}>
            {related.map((other) => (
              <li key={other.id}>
                <TaskLine
                  status={other.status}
                  title={other.label}
                  onOpen={() => onSelect({ kind: 'task', id: other.id })}
                />
              </li>
            ))}
          </ul>
        </Section>
      )}
      <Section title="나온 회의">
        <MeetingLinks workspaceId={workspaceId} meetings={meetings} />
      </Section>
      <GuardedLink to={paths.tasks(workspaceId, task.id)} className={LINK}>
        태스크 열기
      </GuardedLink>
    </div>
  )
}

export interface SelectionPanelProps {
  workspaceId: string
  map: ProjectMap
  /** 맵에 있는 노드다. 주제는 합친 직후처럼 맵에 아직 없을 수 있어 ID 만 본다 */
  node: Pick<TopicNode, 'kind' | 'id'> | TaskNode
  onSelect: (selection: MapSelection) => void
}

/**
 * 옆 패널의 본문. 주제는 그 주제의 결정·태스크·회의를 받아 보이고, 태스크는 맵에 이미 있는 값만 보인다.
 * 태스크의 이어진 태스크는 그래프의 태스크끼리 선이다 — 목록·키보드로도 그 선을 따라간다
 */
export function SelectionPanel({ workspaceId, map, node, onSelect }: SelectionPanelProps) {
  return node.kind === 'topic' ? (
    <TopicBody
      key={node.id}
      workspaceId={workspaceId}
      topicId={node.id}
      map={map}
      onSelect={onSelect}
    />
  ) : (
    <TaskBody workspaceId={workspaceId} task={node} map={map} onSelect={onSelect} />
  )
}
