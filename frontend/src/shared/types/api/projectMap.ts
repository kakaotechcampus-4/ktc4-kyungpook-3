import { z } from 'zod'
import { taskStatusSchema } from './task'

/*
 * 프로젝트 맵 응답 스키마 (backend app/schemas/project_map.py, 계약 §4.4.2). 타입은 이 스키마에서 만든다 (#348)
 */

export const meetingRefSchema = z.object({
  meeting_id: z.string(),
  title: z.string().nullable(),
  started_at: z.string(),
})
export type MeetingRefDto = z.infer<typeof meetingRefSchema>

const topicNodeSchema = z.object({
  id: z.string(),
  kind: z.literal('topic'),
  label: z.string(),
  appeared_at: z.string(),
})

const taskNodeSchema = z.object({
  id: z.string(),
  kind: z.literal('task'),
  label: z.string(),
  status: taskStatusSchema,
  due_date: z.string().nullable(),
  assignee_name: z.string().nullable(),
  blocker: z.string().nullable(),
  meeting_ids: z.array(z.string()),
  appeared_at: z.string(),
})

/** 무엇을 그릴지 정하는 판별 값이라 모르는 `kind` 면 응답 전체가 `INVALID_RESPONSE` 다 (D-184) */
export const mapNodeSchema = z.discriminatedUnion('kind', [topicNodeSchema, taskNodeSchema])
export type MapNodeDto = z.infer<typeof mapNodeSchema>

export const projectMapSchema = z.object({
  meetings: z.array(meetingRefSchema),
  nodes: z.array(mapNodeSchema),
  edges: z.array(z.object({ source: z.string(), target: z.string() })),
})
export type ProjectMapDto = z.infer<typeof projectMapSchema>

/**
 * 결정의 상태가 어떤 고치기를 보일지 정하는 판별 값이라 모르는 값이면 `INVALID_RESPONSE` 다 (D-184).
 * #605 전 BE 는 키가 없어 유효로 읽는다. 지운 결정(`removed`)은 응답에 나오지 않는다 (계약 §4.4.3)
 */
export const decisionStateSchema = z.enum(['valid', 'invalid'])
export type DecisionStateDto = z.infer<typeof decisionStateSchema>

/** 고침 표시는 보기만 하므로 모양이 틀리면 그 표시만 뺀다 */
const editedSchema = z.boolean().catch(false)

export const topicDetailSchema = z.object({
  topic_id: z.string(),
  name: z.string(),
  description: z.string(),
  edited: editedSchema,
  decisions: z.array(
    z.object({
      decision_id: z.string(),
      text: z.string(),
      reason: z.string().nullable(),
      meeting_id: z.string(),
      meeting_title: z.string().nullable(),
      decided_at: z.string(),
      replaced_by: z.string().nullable(),
      state: decisionStateSchema.default('valid'),
      edited: editedSchema,
    }),
  ),
  tasks: z.array(
    z.object({
      task_id: z.string(),
      title: z.string(),
      status: taskStatusSchema,
      due_date: z.string().nullable(),
      assignee_name: z.string().nullable(),
    }),
  ),
  meetings: z.array(meetingRefSchema),
})
export type TopicDetailDto = z.infer<typeof topicDetailSchema>
