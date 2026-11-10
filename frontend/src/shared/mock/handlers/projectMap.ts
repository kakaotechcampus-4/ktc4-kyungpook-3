import { http } from 'msw'
import type { MeetingRefDto, ProjectMapDto, TopicDetailDto } from '@/shared/types/api/projectMap'
import { requireMember } from '../auth-guard'
import { db } from '../db'
import { fail, ok } from '../envelope'
import type { MockDecision, MockTopic } from '../fixtures/projectMap'
import { readJson } from '../utils'
import { PYTHON_STRIP, hasUnstorable } from '../validation'

/*
 * 백엔드 services/project_map.py 의 build_graph · topic_detail 과 services/summary.py 의 주제·결정 고치기(#605)와 같은 규칙이다.
 * 회의는 지워지면 db.meetings 에서 빠지므로 남은 회의만 살아 있는 회의다. 권한은 워크스페이스 멤버다 (401 → 403)
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
      if (topic.detached_task_ids.includes(item.task_id)) continue
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

function workspaceTopic(workspaceId: string, topicId: string): MockTopic | undefined {
  return db.projectMap.topics.find(
    ({ topic_id, workspace_id }) => topic_id === topicId && workspace_id === workspaceId,
  )
}

/**
 * BE `_relink`. 이 결정을 뒤집었다고 적은, 지우지 않은 더 늦은 결정 중 가장 이른 회의의 것이다(같으면 회의 ID, 적힌 순서).
 * 하나를 지우면 남은 것이 이어받고, 되살리면 다시 뒤집는다. 유효하지 않음은 뒤집기를 그대로 둔다
 */
function replacedBy(old: MockDecision, meetings: Map<string, MeetingRefDto>): string | null {
  const startedAt = ({ meeting_id }: MockDecision) => at(meetings.get(meeting_id)!.started_at)
  const claims = db.projectMap.decisions.filter(
    (decision) =>
      decision.state !== 'removed' &&
      meetings.has(decision.meeting_id) &&
      decision.replaces.includes(old.decision_id) &&
      startedAt(decision) > startedAt(old),
  )
  // sort 는 안정 정렬이라 같은 회의 안에서는 적힌 순서가 남는다
  claims.sort((a, b) => startedAt(a) - startedAt(b) || a.meeting_id.localeCompare(b.meeting_id))
  return claims[0]?.decision_id ?? null
}

function topicDetail(workspaceId: string, topicId: string): TopicDetailDto | null {
  const topic = workspaceTopic(workspaceId, topicId)
  if (topic === undefined) return null
  const meetings = liveMeetings(workspaceId)
  const linked = new Set(
    topic.items
      .filter(
        ({ task_id, meeting_id }) =>
          meetings.has(meeting_id) && !topic.detached_task_ids.includes(task_id),
      )
      .map(({ task_id }) => task_id),
  )
  return {
    topic_id: topic.topic_id,
    name: topic.name,
    description: topic.description,
    edited: topic.edited,
    decisions: db.projectMap.decisions
      .filter(
        (decision): decision is MockDecision & { state: 'valid' | 'invalid' } =>
          decision.topic_id === topicId &&
          meetings.has(decision.meeting_id) &&
          decision.state !== 'removed',
      )
      .map((decision) => {
        const meeting = meetings.get(decision.meeting_id)!
        return {
          decision_id: decision.decision_id,
          text: decision.text,
          reason: decision.reason,
          meeting_id: meeting.meeting_id,
          meeting_title: meeting.title,
          decided_at: meeting.started_at,
          replaced_by: replacedBy(decision, meetings),
          state: decision.state,
          edited: decision.edited,
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

/** BE normalize_topic_name. 표기만 다른 이름을 같은 키로 모은다 */
export function normalizeTopicName(name: string): string {
  return [...name.normalize('NFKC').toLowerCase()]
    .filter((char) => /[\p{L}\p{M}\p{N}]/u.test(char))
    .slice(0, 100)
    .join('')
}

/** Python `len()` 처럼 코드 포인트로 센다 */
const lengthOf = (text: string) => [...text].length

/** 없거나 null 이면 보내지 않은 칸이다 (pydantic `str | None = None`) */
function optionalString(value: unknown): value is string | null | undefined {
  return value === undefined || value === null || typeof value === 'string'
}

const invalid = (message: string) => fail('INVALID_REQUEST', message, 400)
const UNSTORABLE = 'NUL 이나 짝 없는 서로게이트 글자는 저장할 수 없습니다.'
const topicNotFound = (topicId: string) =>
  fail('TOPIC_NOT_FOUND', '주제를 찾을 수 없습니다.', 404, { topic_id: topicId })

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
  http.patch('/api/v1/workspaces/:workspaceId/topics/:topicId', async ({ params, request }) => {
    const workspaceId = String(params.workspaceId)
    const topicId = String(params.topicId)
    const denied = requireMember(workspaceId)
    if (denied) return denied
    const body = await readJson(request)
    if (body === null || !optionalString(body.name) || !optionalString(body.description))
      return invalid('주제 변경 값이 올바르지 않습니다.')
    const name = body.name?.replace(PYTHON_STRIP, '') ?? null
    const description = body.description ?? null
    if (name === null && description === null)
      return invalid('name 이나 description 이 있어야 합니다.')
    if (name !== null && (lengthOf(name) < 1 || lengthOf(name) > 100))
      return invalid('주제 이름은 1자 이상 100자 이하입니다.')
    if (description !== null && lengthOf(description) > 1000)
      return invalid('주제 설명은 1000자 이하입니다.')
    if (hasUnstorable(name, description)) return invalid(UNSTORABLE)
    const topic = workspaceTopic(workspaceId, topicId)
    if (topic === undefined) return topicNotFound(topicId)
    if (name !== null) {
      const key = normalizeTopicName(name)
      if (key === '') return invalid('주제 이름에 글자가 없습니다.')
      const taken = db.projectMap.topics.find(
        (other) =>
          other.workspace_id === workspaceId &&
          other !== topic &&
          normalizeTopicName(other.name) === key,
      )
      // 자기 이름과 같은 키(표기만 바꾸기)는 다른 주제를 보지 않는다
      if (key !== normalizeTopicName(topic.name) && taken !== undefined)
        return fail('TOPIC_NAME_TAKEN', '같은 이름의 주제가 있습니다.', 409, {
          topic_id: taken.topic_id,
        })
      topic.name = name
    }
    if (description !== null) topic.description = description
    topic.edited = true
    return ok(topicDetail(workspaceId, topicId))
  }),
  http.post(
    '/api/v1/workspaces/:workspaceId/topics/:topicId/merge',
    async ({ params, request }) => {
      const workspaceId = String(params.workspaceId)
      const topicId = String(params.topicId)
      const denied = requireMember(workspaceId)
      if (denied) return denied
      const intoId = (await readJson(request))?.into_topic_id
      if (typeof intoId !== 'string' || lengthOf(intoId) < 1 || lengthOf(intoId) > 36)
        return invalid('합칠 주제가 올바르지 않습니다.')
      if (hasUnstorable(intoId)) return invalid(UNSTORABLE)
      if (intoId === topicId) return invalid('같은 주제로는 합칠 수 없습니다.')
      const topic = workspaceTopic(workspaceId, topicId)
      if (topic === undefined) return topicNotFound(topicId)
      const into = workspaceTopic(workspaceId, intoId)
      if (into === undefined) return topicNotFound(intoId)
      // into 에 이미 보이던 태스크는 topic 에서 뗐어도 into 에 그대로 보인다
      const shown = new Set(topicDetail(workspaceId, intoId)!.tasks.map(({ task_id }) => task_id))
      const pair = ({ task_id, meeting_id }: MockTopic['items'][number]) =>
        `${task_id}|${meeting_id}`
      const pairs = new Set(into.items.map(pair))
      into.meeting_ids = [...new Set([...into.meeting_ids, ...topic.meeting_ids])]
      into.items.push(...topic.items.filter((item) => !pairs.has(pair(item))))
      into.detached_task_ids = [
        ...new Set([
          ...into.detached_task_ids,
          ...topic.detached_task_ids.filter((taskId) => !shown.has(taskId)),
        ]),
      ]
      for (const decision of db.projectMap.decisions)
        if (decision.topic_id === topicId) decision.topic_id = intoId
      db.projectMap.topics = db.projectMap.topics.filter((other) => other !== topic)
      into.edited = true
      return ok(topicDetail(workspaceId, intoId))
    },
  ),
  http.delete('/api/v1/workspaces/:workspaceId/topics/:topicId/tasks/:taskId', ({ params }) => {
    const workspaceId = String(params.workspaceId)
    const topicId = String(params.topicId)
    const taskId = String(params.taskId)
    const denied = requireMember(workspaceId)
    if (denied) return denied
    const topic = workspaceTopic(workspaceId, topicId)
    if (topic === undefined) return topicNotFound(topicId)
    if (
      !db.tasks.some(
        ({ task_id, workspace_id }) => task_id === taskId && workspace_id === workspaceId,
      )
    )
      return fail('TASK_NOT_FOUND', '태스크가 없습니다.', 404, { task_id: taskId })
    if (!topic.detached_task_ids.includes(taskId)) topic.detached_task_ids.push(taskId)
    topic.edited = true
    return ok(topicDetail(workspaceId, topicId))
  }),
  http.patch(
    '/api/v1/workspaces/:workspaceId/decisions/:decisionId',
    async ({ params, request }) => {
      const workspaceId = String(params.workspaceId)
      const decisionId = String(params.decisionId)
      const denied = requireMember(workspaceId)
      if (denied) return denied
      const body = await readJson(request)
      if (body === null || !optionalString(body.text))
        return invalid('결정 변경 값이 올바르지 않습니다.')
      const text = body.text?.replace(PYTHON_STRIP, '') ?? null
      const state = body.state ?? null
      if (state !== null && state !== 'valid' && state !== 'invalid' && state !== 'removed')
        return invalid('결정 상태가 올바르지 않습니다.')
      if (text === null && state === null) return invalid('text 나 state 가 있어야 합니다.')
      if (text !== null && (lengthOf(text) < 1 || lengthOf(text) > 1000))
        return invalid('결정 문장은 1자 이상 1000자 이하입니다.')
      if (hasUnstorable(text)) return invalid(UNSTORABLE)
      // 지운 결정도 찾는다 — valid 로 되살릴 수 있다. 삭제된 회의의 결정은 없는 결정이다
      const decision = db.projectMap.decisions.find(
        ({ decision_id, topic_id, meeting_id }) =>
          decision_id === decisionId &&
          workspaceTopic(workspaceId, topic_id) !== undefined &&
          db.meetings.some((meeting) => meeting.meeting_id === meeting_id),
      )
      if (decision === undefined)
        return fail('DECISION_NOT_FOUND', '결정을 찾을 수 없습니다.', 404, {
          decision_id: decisionId,
        })
      if (text !== null) decision.text = text
      if (state !== null) decision.state = state
      decision.edited = true
      return ok(topicDetail(workspaceId, decision.topic_id))
    },
  ),
]
