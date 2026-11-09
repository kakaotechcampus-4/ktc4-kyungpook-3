import type { MeetingRefDto, ProjectMapDto, TopicDetailDto } from '@/shared/types/api/projectMap'
import type {
  MapEdge,
  MapNode,
  MeetingRef,
  ProjectMap,
  TaskNode,
  TopicDetail,
  TopicNode,
} from './types'

function toMeetingRef(dto: MeetingRefDto): MeetingRef {
  return { meetingId: dto.meeting_id, title: dto.title, startedAt: dto.started_at }
}

function toNode(dto: ProjectMapDto['nodes'][number]): MapNode {
  if (dto.kind === 'topic')
    return { kind: 'topic', id: dto.id, label: dto.label, appearedAt: dto.appeared_at }
  return {
    kind: 'task',
    id: dto.id,
    label: dto.label,
    status: dto.status,
    dueDate: dto.due_date,
    assigneeName: dto.assignee_name,
    blocker: dto.blocker,
    meetingIds: [...dto.meeting_ids],
    appearedAt: dto.appeared_at,
  }
}

/* 시각 문자열은 오프셋이 섞일 수 있어 순간으로 비교한다 */
function byAppearance(a: MapNode, b: MapNode): number {
  const at = Date.parse(a.appearedAt) - Date.parse(b.appearedAt)
  if (at !== 0) return at
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

export function toProjectMap(dto: ProjectMapDto): ProjectMap {
  const nodes = dto.nodes.map(toNode).sort(byAppearance)
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const edges: MapEdge[] = dto.edges
    .filter(({ source, target }) => nodeById.has(source) && nodeById.has(target))
    .map(({ source, target }) => ({ source, target }))

  const topicTasks = new Map<string, Set<string>>()
  const linkedTasks = new Set<string>()
  for (const { source, target } of edges) {
    const ends = [nodeById.get(source), nodeById.get(target)]
    const topic = ends.find((node) => node?.kind === 'topic')
    const task = ends.find((node) => node?.kind === 'task')
    if (topic === undefined || task === undefined) continue
    const tasks = topicTasks.get(topic.id) ?? new Set<string>()
    tasks.add(task.id)
    topicTasks.set(topic.id, tasks)
    linkedTasks.add(task.id)
  }

  const taskNodes = nodes.filter((node): node is TaskNode => node.kind === 'task')
  return {
    nodes,
    nodeById,
    edges,
    meetingById: new Map(
      dto.meetings.map((meeting) => [meeting.meeting_id, toMeetingRef(meeting)]),
    ),
    topicGroups: nodes
      .filter((node): node is TopicNode => node.kind === 'topic')
      .map((topic) => {
        const linked = topicTasks.get(topic.id)
        return { topic, tasks: taskNodes.filter((task) => linked?.has(task.id) === true) }
      }),
    looseTasks: taskNodes.filter((task) => !linkedTasks.has(task.id)),
  }
}

export function toTopicDetail(dto: TopicDetailDto): TopicDetail {
  return {
    topicId: dto.topic_id,
    name: dto.name,
    description: dto.description,
    decisions: dto.decisions.map((decision) => ({
      decisionId: decision.decision_id,
      text: decision.text,
      reason: decision.reason,
      meetingId: decision.meeting_id,
      meetingTitle: decision.meeting_title,
      decidedAt: decision.decided_at,
      replacedBy: decision.replaced_by,
    })),
    tasks: dto.tasks.map((task) => ({
      taskId: task.task_id,
      title: task.title,
      status: task.status,
      dueDate: task.due_date,
      assigneeName: task.assignee_name,
    })),
    meetings: dto.meetings.map(toMeetingRef),
  }
}
