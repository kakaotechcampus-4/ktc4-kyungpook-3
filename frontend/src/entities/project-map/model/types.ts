import type { TaskStatus } from '@/shared/types/common'

export interface MeetingRef {
  meetingId: string
  /** 제목 없는 회의는 null 이다 */
  title: string | null
  startedAt: string
}

export interface TopicNode {
  kind: 'topic'
  id: string
  label: string
  appearedAt: string
}

export interface TaskNode {
  kind: 'task'
  id: string
  label: string
  status: TaskStatus
  /** `YYYY-MM-DD` */
  dueDate: string | null
  assigneeName: string | null
  blocker: string | null
  /** 나온 회의. 시간순이다 */
  meetingIds: readonly string[]
  appearedAt: string
}

export type MapNode = TopicNode | TaskNode

export interface MapEdge {
  source: string
  target: string
}

export interface TopicGroup {
  topic: TopicNode
  /** 주제와 선으로 이어진 태스크 */
  tasks: readonly TaskNode[]
}

/**
 * 맵 하나. 그래프·목록·패널이 모두 이 모양만 읽는다.
 * `nodes` 는 나온 시각, 같으면 ID 순이다 — 타임라인 재생이 이 순서로 하나씩 보인다
 */
export interface ProjectMap {
  nodes: readonly MapNode[]
  nodeById: ReadonlyMap<string, MapNode>
  /** 양 끝이 모두 `nodes` 에 있는 선만 둔다 */
  edges: readonly MapEdge[]
  meetingById: ReadonlyMap<string, MeetingRef>
  topicGroups: readonly TopicGroup[]
  /** 어느 주제와도 이어지지 않은 태스크 */
  looseTasks: readonly TaskNode[]
  /** 태스크끼리 이은 선(비슷한 태스크). 태스크 ID → 이어진 태스크, `nodes` 순서다. 이어진 것이 없으면 키가 없다 */
  relatedTasks: ReadonlyMap<string, readonly TaskNode[]>
}

/** 패널에 연 노드 */
export type MapSelection = { kind: 'topic'; id: string } | { kind: 'task'; id: string } | null

export interface TopicDecision {
  decisionId: string
  text: string
  reason: string | null
  meetingId: string
  meetingTitle: string | null
  decidedAt: string
  /** 이 결정을 뒤집은 결정. null 이면 유효하다 */
  replacedBy: string | null
}

export interface TopicTask {
  taskId: string
  title: string
  status: TaskStatus
  dueDate: string | null
  assigneeName: string | null
}

export interface TopicDetail {
  topicId: string
  name: string
  description: string
  decisions: readonly TopicDecision[]
  tasks: readonly TopicTask[]
  meetings: readonly MeetingRef[]
}
