import { useQuery } from '@tanstack/react-query'
import { useId } from 'react'
import type { ReactNode } from 'react'
import { topicQueryOptions } from '@/entities/project-map'
import type {
  MapSelection,
  MeetingRef,
  ProjectMap,
  TaskNode,
  TopicDecision,
  TopicNode,
} from '@/entities/project-map'
import { TASK_STATUS_LABEL, TaskStatusMark } from '@/entities/task'
import { errorMessage } from '@/shared/api/errorMessages'
import { ApiError, ERROR_CODES } from '@/shared/api/errors'
import { paths } from '@/shared/config/routes'
import { seoulDateOf } from '@/shared/lib/date'
import { queryView } from '@/shared/lib/query-view'
import { GuardedLink } from '@/shared/lib/unsaved-changes'
import { QueryErrorState } from '@/shared/ui/query-error-state'
import { Skeleton } from '@/shared/ui/skeleton'
import { BADGE, NOTE, ROW_META, SECTION_TITLE } from './frame'

const BODY = 'flex flex-col gap-24'
const DESCRIPTION = 'text-body text-sub'
const LIST = 'flex flex-col gap-10'
const LINK = 'text-body font-semibold text-ink underline-offset-4 hover:underline'
const FIELDS = 'grid grid-cols-[56px_minmax(0px,1fr)] gap-x-12 gap-y-10 text-body'
const FIELD_NAME = 'text-dim'
const FIELD_VALUE = 'min-w-[0px] text-ink wrap-anywhere'
const TASK_BUTTON = 'flex w-full items-center gap-8 text-left text-body text-ink hover:text-sub'

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = useId()
  return (
    <section aria-labelledby={id} className="flex flex-col gap-10">
      <h3 id={id} className={SECTION_TITLE}>
        {title}
      </h3>
      {children}
    </section>
  )
}

function MeetingLinks({
  workspaceId,
  meetings,
}: {
  workspaceId: string
  meetings: readonly MeetingRef[]
}) {
  if (meetings.length === 0) return <p className={NOTE}>나온 회의가 없어요.</p>
  return (
    <ul className={LIST}>
      {meetings.map(({ meetingId, title, startedAt }) => (
        <li key={meetingId} className="flex items-baseline justify-between gap-12">
          <GuardedLink to={paths.meetings(workspaceId, meetingId)} className={LINK}>
            {title ?? '제목 없는 회의'}
          </GuardedLink>
          <span className={ROW_META}>{seoulDateOf(startedAt)}</span>
        </li>
      ))}
    </ul>
  )
}

function Decision({ workspaceId, decision }: { workspaceId: string; decision: TopicDecision }) {
  const reversed = decision.replacedBy !== null
  return (
    <li className="flex flex-col gap-4">
      <p className={reversed ? 'text-body text-dim' : 'text-body text-ink'}>
        {decision.text}
        {reversed ? (
          <>
            {' '}
            <span className={BADGE}>뒤집힘</span>
          </>
        ) : null}
      </p>
      {reversed ? <p className={NOTE}>다른 결정으로 바뀌었어요.</p> : null}
      {decision.reason === null ? null : <p className={NOTE}>이유: {decision.reason}</p>}
      <p className={NOTE}>
        <GuardedLink
          to={paths.meetings(workspaceId, decision.meetingId)}
          className="underline-offset-4 hover:underline"
        >
          {decision.meetingTitle ?? '제목 없는 회의'}
        </GuardedLink>{' '}
        · {seoulDateOf(decision.decidedAt)}
      </p>
    </li>
  )
}

function TopicBody({
  workspaceId,
  topic,
  map,
  onSelect,
}: {
  workspaceId: string
  topic: TopicNode
  map: ProjectMap
  onSelect: (selection: MapSelection) => void
}) {
  const query = useQuery(topicQueryOptions(workspaceId, topic.id))
  const view = queryView(query)
  if (view === 'loading')
    return (
      <div role="status" aria-label="주제를 불러오는 중" className="flex flex-col gap-10">
        <Skeleton variant="text" lines={3} />
      </div>
    )
  if (view === 'error') {
    if (query.error instanceof ApiError && query.error.code === ERROR_CODES.TOPIC_NOT_FOUND)
      return <p className={NOTE}>{errorMessage(query.error)}</p>
    return <QueryErrorState error={query.error} onRetry={() => void query.refetch()} />
  }
  const detail = query.data!
  return (
    <div className={BODY}>
      {detail.description === '' ? null : <p className={DESCRIPTION}>{detail.description}</p>}
      <Section title="결정">
        {detail.decisions.length === 0 ? (
          <p className={NOTE}>아직 결정이 없어요.</p>
        ) : (
          <ul className="flex flex-col gap-14">
            {detail.decisions.map((decision) => (
              <Decision key={decision.decisionId} workspaceId={workspaceId} decision={decision} />
            ))}
          </ul>
        )}
      </Section>
      <Section title="태스크">
        {detail.tasks.length === 0 ? (
          <p className={NOTE}>이어진 태스크가 없어요.</p>
        ) : (
          <ul className={LIST}>
            {detail.tasks.map((task) => (
              <li key={task.taskId}>
                {/* 맵을 받은 뒤 생긴 태스크는 패널을 열 데이터가 없어 글로만 둔다 */}
                {map.nodeById.has(task.taskId) ? (
                  <button
                    type="button"
                    className={TASK_BUTTON}
                    onClick={() => onSelect({ kind: 'task', id: task.taskId })}
                  >
                    <TaskStatusMark status={task.status} />
                    <span className="min-w-[0px] flex-1">{task.title}</span>
                    <span className={ROW_META}>{TASK_STATUS_LABEL[task.status]}</span>
                  </button>
                ) : (
                  <span className="flex items-center gap-8 text-body text-ink">
                    <TaskStatusMark status={task.status} />
                    <span className="min-w-[0px] flex-1">{task.title}</span>
                    <span className={ROW_META}>{TASK_STATUS_LABEL[task.status]}</span>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="나온 회의">
        <MeetingLinks workspaceId={workspaceId} meetings={detail.meetings} />
      </Section>
    </div>
  )
}

function TaskBody({
  workspaceId,
  task,
  map,
}: {
  workspaceId: string
  task: TaskNode
  map: ProjectMap
}) {
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
  /** 맵에 있는 노드만 온다 */
  node: TopicNode | TaskNode
  onSelect: (selection: MapSelection) => void
}

/** 옆 패널의 본문. 주제는 그 주제의 결정·태스크·회의를 받아 보이고, 태스크는 맵에 이미 있는 값만 보인다 */
export function SelectionPanel({ workspaceId, map, node, onSelect }: SelectionPanelProps) {
  return node.kind === 'topic' ? (
    <TopicBody key={node.id} workspaceId={workspaceId} topic={node} map={map} onSelect={onSelect} />
  ) : (
    <TaskBody workspaceId={workspaceId} task={node} map={map} />
  )
}
