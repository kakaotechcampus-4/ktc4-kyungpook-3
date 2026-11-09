import { http } from 'msw'
import type { MeetingRefDto, ProjectMapDto, TopicDetailDto } from '@/shared/types/api/projectMap'
import { requireMember } from '../auth-guard'
import { db } from '../db'
import { fail, ok } from '../envelope'

/*
 * 백엔드 services/project_map.py 의 build_graph · topic_detail 과 같은 규칙이다. 회의는 지워지면 db.meetings 에서 빠지므로
 * 남은 회의만 살아 있는 회의다. 권한은 워크스페이스 멤버다 (401 → 403)
 */

const at = (timestamp: string) => Date.parse(timestamp)

function liveMeetings(workspaceId: string): Map<string, MeetingRefDto> {
  return new Map(
    db.meetings
      .filter(({ workspace_id }) => workspace_id === workspaceId)
      .sort((a, b) => at(a.started_at) - at(b.started_at))
      .map(({ meeting_id, title, started_at }) => [meeting_id, { meeting_id, title, started_at }]),
  )
}

function assigneeName(workspaceId: string, memberId: string | null): string | null {
  if (memberId === null) return null
  return (
    db.members.find(
      ({ member_id, workspace_id }) => member_id === memberId && workspace_id === workspaceId,
    )?.display_name ?? null
  )
}

function earliest(timestamps: string[]): string {
  return timestamps.reduce((first, next) => (at(next) < at(first) ? next : first))
}

function buildGraph(workspaceId: string): ProjectMapDto {
  const meetings = liveMeetings(workspaceId)
  const topics = db.projectMap.topics.filter(({ workspace_id }) => workspace_id === workspaceId)
  const tasks = db.tasks.filter(({ workspace_id }) => workspace_id === workspaceId)
  const taskIds = new Set(tasks.map(({ task_id }) => task_id))

  const taskMeetings = new Map(
    tasks.map(({ task_id, meeting_id }) => [
      task_id,
      new Set(meeting_id !== null && meetings.has(meeting_id) ? [meeting_id] : []),
    ]),
  )
  const pairs = new Set<string>()
  const edges: ProjectMapDto['edges'] = []
  const addEdge = (source: string, target: string) => {
    const key = `${source}|${target}`
    if (pairs.has(key)) return
    pairs.add(key)
    edges.push({ source, target })
  }
  for (const topic of topics)
    for (const item of topic.items) {
      if (!taskIds.has(item.task_id) || !meetings.has(item.meeting_id)) continue
      taskMeetings.get(item.task_id)?.add(item.meeting_id)
      addEdge(topic.topic_id, item.task_id)
    }
  for (const { source, target } of db.projectMap.taskLinks)
    if (taskIds.has(source) && taskIds.has(target)) addEdge(source, target)

  const topicMeetings = (topic: (typeof topics)[number]) =>
    topic.meeting_ids.filter((id) => meetings.has(id))
  const shown = new Set([
    ...[...taskMeetings.values()].flatMap((ids) => [...ids]),
    ...topics.flatMap(topicMeetings),
  ])
  const nodes: ProjectMapDto['nodes'] = [
    ...topics.map((topic) => ({
      id: topic.topic_id,
      kind: 'topic' as const,
      label: topic.name,
      appeared_at:
        topicMeetings(topic).length === 0
          ? topic.created_at
          : earliest(topicMeetings(topic).map((id) => meetings.get(id)!.started_at)),
    })),
    ...tasks.map((task) => {
      const meetingIds = [...meetings.keys()].filter((id) =>
        taskMeetings.get(task.task_id)?.has(id),
      )
      return {
        id: task.task_id,
        kind: 'task' as const,
        label: task.title,
        status: task.status,
        due_date: task.due_date,
        assignee_name: assigneeName(workspaceId, task.assignee_member_id),
        blocker: task.blocker,
        meeting_ids: meetingIds,
        appeared_at: earliest([
          task.created_at,
          ...meetingIds.map((id) => meetings.get(id)!.started_at),
        ]),
      }
    }),
  ]
  return {
    meetings: [...meetings.values()].filter(({ meeting_id }) => shown.has(meeting_id)),
    nodes,
    edges,
  }
}

function topicDetail(workspaceId: string, topicId: string): TopicDetailDto | null {
  const topic = db.projectMap.topics.find(
    ({ topic_id, workspace_id }) => topic_id === topicId && workspace_id === workspaceId,
  )
  if (topic === undefined) return null
  const meetings = liveMeetings(workspaceId)
  const linked = new Set(
    topic.items.filter(({ meeting_id }) => meetings.has(meeting_id)).map(({ task_id }) => task_id),
  )
  return {
    topic_id: topic.topic_id,
    name: topic.name,
    description: topic.description,
    decisions: db.projectMap.decisions
      .filter(({ topic_id, meeting_id }) => topic_id === topicId && meetings.has(meeting_id))
      .map((decision) => {
        const meeting = meetings.get(decision.meeting_id)!
        return {
          decision_id: decision.decision_id,
          text: decision.text,
          reason: decision.reason,
          meeting_id: meeting.meeting_id,
          meeting_title: meeting.title,
          decided_at: meeting.started_at,
          replaced_by: decision.replaced_by,
        }
      })
      .sort((a, b) => at(a.decided_at) - at(b.decided_at)),
    tasks: db.tasks
      .filter(({ task_id, workspace_id }) => workspace_id === workspaceId && linked.has(task_id))
      .sort((a, b) => at(a.created_at) - at(b.created_at))
      .map((task) => ({
        task_id: task.task_id,
        title: task.title,
        status: task.status,
        due_date: task.due_date,
        assignee_name: assigneeName(workspaceId, task.assignee_member_id),
      })),
    meetings: [...meetings.values()].filter(({ meeting_id }) =>
      topic.meeting_ids.includes(meeting_id),
    ),
  }
}

export const projectMapHandlers = [
  http.get('/api/v1/workspaces/:workspaceId/project-map', ({ params }) => {
    const workspaceId = String(params.workspaceId)
    const denied = requireMember(workspaceId)
    if (denied) return denied
    return ok(buildGraph(workspaceId))
  }),
  http.get('/api/v1/workspaces/:workspaceId/topics/:topicId', ({ params }) => {
    const workspaceId = String(params.workspaceId)
    const denied = requireMember(workspaceId)
    if (denied) return denied
    const detail = topicDetail(workspaceId, String(params.topicId))
    if (detail === null) return fail('TOPIC_NOT_FOUND', '주제를 찾을 수 없습니다.', 404)
    return ok(detail)
  }),
]
