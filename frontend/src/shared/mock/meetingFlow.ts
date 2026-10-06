import type { ApprovalDto } from '@/shared/types/api/approval'
import type { ExtractionDto, ExtractionItemDto } from '@/shared/types/api/extraction'
import type { MeetingDto } from '@/shared/types/api/meeting'
import type { MinutesDto } from '@/shared/types/api/minutes'
import { db } from './db'
import type { MeetingFlowMode, MockDb } from './db'
import { MOCK_NOW } from './fixtures/constants'
import { createTask } from './task-state'
import { nextId } from './utils'

/*
 * 업로드된 회의의 정리 흐름. 처리 중 회의를 한 단계씩 진행시키거나 완료·실패로 끝낸다.
 * 완료는 회의록 본문·추출 결과·태스크·대기 승인을 한 번에 만든다. 서로 같은 ID 로 이어진다:
 *
 *   meeting.extraction_id ─ extraction.meeting_id ─ item.task_id   ─ task.meeting_id
 *                                                  └ item.approval_id ─ approval.payload.{meeting_id, extraction_item_id}
 *
 * 시각은 MOCK_NOW, ID 는 nextId 로 정한다 — Date.now()·Math.random() 을 쓰지 않는다 (msw-guide 「지킬 규칙」).
 * 함수는 모두 `state` 를 받는다. handler 는 `db` 를, 시나리오는 아직 `db` 에 넣지 않은 상태를 넘긴다.
 * 근거: docs/impl-decision/2026-10-02-msw-meeting-flow.md
 */

/** 정리 단계. 서버의 `progress` 세 값과 같은 순서다 */
export const MEETING_STAGES = ['audio_merged', 'transcribed', 'extracted'] as const
export type MeetingStage = (typeof MEETING_STAGES)[number]

/** 생성 ID 의 시작 번호. 픽스처(ex_01·it_06·ap_03)와 겹치지 않는다. 태스크는 task-state 와 같은 90 이다 */
const GENERATED_ID_MINIMUM = 90

/** 정리 결과의 길이. 실 STT 가 없으니 고정값이다 */
const GENERATED_DURATION_MS = 30 * 60_000

export interface CompletedMeeting {
  meeting: MeetingDto
  minutes: MinutesDto
  extraction: ExtractionDto
  /** 확실한 항목이 바로 만든 태스크 (gate `auto`) */
  taskIds: string[]
  /** 확인 필요 항목이 만든 대기 승인 (gate `review`·`hold`) */
  approvalIds: string[]
}

export interface FailMeetingOptions {
  /** 정리 중 Notion 연결이 끊겨 실패했다. 그 공간의 Notion 연동을 `revoked` 로 바꾼다 (D-099, D-100) */
  notionRevoked?: boolean
}

function processingMeeting(state: MockDb, meetingId: string): MeetingDto {
  const meeting = state.meetings.find(({ meeting_id }) => meeting_id === meetingId)
  if (!meeting) throw new Error(`mock meeting ${meetingId} is missing`)
  if (meeting.status !== 'processing')
    throw new Error(`mock meeting ${meetingId} is ${meeting.status}, not processing`)
  return meeting
}

function progressOf(meeting: MeetingDto) {
  return meeting.progress ?? { audio_merged: false, transcribed: false, extracted: false }
}

/** 다음에 끝낼 단계. 세 단계가 다 끝났으면 null — 다음 진행은 완료다 */
export function nextStage(meeting: MeetingDto): MeetingStage | null {
  const progress = progressOf(meeting)
  return MEETING_STAGES.find((stage) => !progress[stage]) ?? null
}

/** 처리 중 회의를 한 단계 진행한다. 세 단계가 이미 끝났으면 완료한다. 진행한 뒤의 회의를 돌려준다 */
export function advanceMeeting(meetingId: string, state: MockDb = db): MeetingDto {
  const meeting = processingMeeting(state, meetingId)
  const stage = nextStage(meeting)
  if (stage === null) return completeMeeting(meetingId, state).meeting
  meeting.progress = { ...progressOf(meeting), [stage]: true }
  return meeting
}

/** 참석자. 업로드가 받은 ID 를 쓰고, 없으면(봇 회의·픽스처 회의) 그 공간 팀원을 목록의 참석자 수만큼 쓴다 */
function attendeesOf(state: MockDb, meeting: MeetingDto) {
  const members = state.members.filter(({ workspace_id }) => workspace_id === meeting.workspace_id)
  const stored = state.meetingFlow.attendees[meeting.meeting_id]
  if (stored !== undefined)
    return stored.flatMap((id) => members.filter(({ member_id }) => member_id === id))
  const summary = state.meetingSummaries.find(({ meeting_id }) => meeting_id === meeting.meeting_id)
  return members.slice(0, summary?.attendee_count ?? members.length)
}

function sourceOf(state: MockDb, meetingId: string): string {
  return (
    state.meetingSummaries.find(({ meeting_id }) => meeting_id === meetingId)?.source ??
    'manual_upload'
  )
}

const TRANSCRIPT_LINES = [
  '오늘 논의할 내용부터 정리할게요.',
  '지난주 작업은 대부분 마무리했어요.',
  '남은 일은 담당자를 정해서 나눠요.',
  '일정은 다음 회의 전에 다시 확인해요.',
]

interface ItemSeed {
  title: string
  gate: 'auto' | 'review' | 'hold'
  confidence: number
  assigneeIndex: number | null
  assigneeRaw: string
  dueDate: string | null
  dueRaw: string | null
}

/** 정리 결과의 할 일. 확실한 것 하나, 확인 필요 둘(검토·보류) — 회의록의 두 영역을 모두 채운다 */
const ITEM_SEEDS: ItemSeed[] = [
  {
    title: '회의 내용 공유',
    gate: 'auto',
    confidence: 0.9,
    assigneeIndex: 0,
    assigneeRaw: '',
    dueDate: '2026-09-25',
    dueRaw: '다음 주 금요일',
  },
  {
    title: '후속 일정 확인',
    gate: 'review',
    confidence: 0.6,
    assigneeIndex: 1,
    assigneeRaw: '',
    dueDate: null,
    dueRaw: '다음 회의 전',
  },
  {
    title: '참고 자료 검토',
    gate: 'hold',
    confidence: 0.3,
    assigneeIndex: null,
    assigneeRaw: '누군가',
    dueDate: null,
    dueRaw: null,
  },
]

/**
 * 처리 중 회의를 완료한다. 회의록 본문·추출 결과·태스크·대기 승인을 만들고 회의를 `done` 으로 바꾼다.
 * 확실한 항목은 태스크가 되고 Notion 에도 반영된 것으로 둔다(D-101). 확인 필요 항목은 승인으로만 남는다.
 */
export function completeMeeting(meetingId: string, state: MockDb = db): CompletedMeeting {
  const meeting = processingMeeting(state, meetingId)
  const attendees = attendeesOf(state, meeting)
  const speaker = (index: number) => attendees[index % Math.max(attendees.length, 1)]

  const minutes: MinutesDto = {
    meeting_id: meeting.meeting_id,
    title: meeting.title,
    started_at: meeting.started_at,
    duration_ms: GENERATED_DURATION_MS,
    source: sourceOf(state, meeting.meeting_id),
    attendees: attendees.map(({ member_id, display_name }) => ({ member_id, display_name })),
    summary: {
      overview: `${meeting.title ?? '회의'}에서 진행 상황과 다음 할 일을 정리했다.`,
      key_points: ['지난주 작업을 공유했다.', '남은 일의 담당자를 정했다.'],
      decisions: ['확실한 항목은 바로 반영하고 나머지는 PM이 확인한다.'],
    },
    transcript: TRANSCRIPT_LINES.map((text, index) => {
      const member = speaker(index)
      return {
        at_ms: index * 60_000,
        speaker_member_id: member?.member_id ?? null,
        speaker_display_name: member?.display_name ?? null,
        speaker_fallback: member?.display_name ?? '참석자',
        text,
      }
    }),
    // minutes handler 가 요청한 사람의 역할로 다시 채운다
    permissions: { can_review: false, can_undo: false },
  }

  const extractionId = nextId(
    'ex',
    state.extractions.map(({ extraction_id }) => extraction_id),
    GENERATED_ID_MINIMUM,
  )
  const itemIds = state.extractions.flatMap(({ items }) => items.map(({ item_id }) => item_id))
  const taskIds: string[] = []
  const approvalIds: string[] = []
  const items: ExtractionItemDto[] = ITEM_SEEDS.map((seed, index) => {
    const itemId = nextId('it', itemIds, GENERATED_ID_MINIMUM)
    itemIds.push(itemId)
    const member = seed.assigneeIndex === null ? undefined : speaker(seed.assigneeIndex)
    const assigneeRaw = member?.display_name ?? seed.assigneeRaw
    const item: ExtractionItemDto = {
      item_id: itemId,
      task: { title: seed.title, confidence: 0.95 },
      assignee: {
        raw: assigneeRaw,
        member_id: member?.member_id ?? null,
        display_name: member?.display_name ?? null,
        confidence: member ? 0.95 : seed.confidence,
        needs_check: member === undefined,
      },
      due_date: {
        value: seed.dueDate,
        raw: seed.dueRaw,
        confidence: seed.dueDate === null ? seed.confidence : 0.95,
      },
      confidence: seed.confidence,
      gate: seed.gate,
      evidence: {
        quote: TRANSCRIPT_LINES[index % TRANSCRIPT_LINES.length],
        speaker: speaker(index)?.display_name ?? null,
        at_ms: index * 60_000,
      },
      task_id: null,
      approval_id: null,
    }
    if (seed.gate === 'auto') {
      const task = createTask(
        {
          workspace_id: meeting.workspace_id,
          meeting_id: meeting.meeting_id,
          title: seed.title,
          assignee_member_id: item.assignee.member_id,
          due_date: seed.dueDate,
        },
        null,
        'meeting',
        state,
      )
      task.notion_page_id = `notion_${task.task_id}`
      item.task_id = task.task_id
      taskIds.push(task.task_id)
    } else {
      const approval: ApprovalDto = {
        approval_id: nextId(
          'ap',
          state.approvals.map(({ approval_id }) => approval_id),
          GENERATED_ID_MINIMUM,
        ),
        workspace_id: meeting.workspace_id,
        type: 'task_create',
        payload: {
          task_title: seed.title,
          assignee_member_id: item.assignee.member_id,
          assignee_raw: item.assignee.raw,
          due_date: seed.dueDate,
          due_raw: seed.dueRaw,
          evidence_quote: item.evidence.quote,
          evidence_speaker: item.evidence.speaker,
          evidence_at_ms: item.evidence.at_ms,
          extraction_item_id: itemId,
          meeting_id: meeting.meeting_id,
          gate: seed.gate,
        },
        related_task_id: null,
        requested_by: null,
        status: 'pending',
        resolved_by: null,
        created_at: MOCK_NOW,
        resolved_at: null,
      }
      state.approvals.push(approval)
      item.approval_id = approval.approval_id
      approvalIds.push(approval.approval_id)
    }
    return item
  })
  const extraction: ExtractionDto = {
    extraction_id: extractionId,
    meeting_id: meeting.meeting_id,
    items,
  }

  state.minutes = state.minutes.filter(({ meeting_id }) => meeting_id !== meeting.meeting_id)
  state.minutes.push(minutes)
  state.extractions.push(extraction)
  meeting.status = 'done'
  meeting.ended_at = MOCK_NOW
  meeting.extraction_id = extractionId
  meeting.failed_stage = null
  meeting.progress = { audio_merged: true, transcribed: true, extracted: true }
  const summary = state.meetingSummaries.find(({ meeting_id }) => meeting_id === meeting.meeting_id)
  if (summary) {
    summary.status = 'done'
    summary.duration_ms = GENERATED_DURATION_MS
    summary.attendee_count = attendees.length
    summary.processed_at = MOCK_NOW
  }
  return { meeting, minutes, extraction, taskIds, approvalIds }
}

/**
 * 처리 중 회의를 실패로 끝낸다. 회의록·추출·태스크·승인을 만들지 않는다 — 실패 결과를 남기지 않는다 (D-091, D-099).
 * 실패 회의는 목록 handler 가 뺀다 (D-093).
 */
export function failMeeting(
  meetingId: string,
  options: FailMeetingOptions = {},
  state: MockDb = db,
): MeetingDto {
  const meeting = processingMeeting(state, meetingId)
  meeting.status = 'failed'
  // 실 API 의 failed_stage 는 자유 문자열이다(계약 §4.7-3). 봇이 보내는 `STT` 같은 꼴로 둔다.
  // 화면은 이 값으로 갈리지 않는다 — 끊김은 연동 상태를 다시 조회해 판단한다 (D-100)
  meeting.failed_stage = options.notionRevoked ? 'NOTION' : 'STT'
  meeting.ended_at = MOCK_NOW
  meeting.extraction_id = null
  const summary = state.meetingSummaries.find(({ meeting_id }) => meeting_id === meetingId)
  if (summary) summary.status = 'failed'
  if (options.notionRevoked) {
    const integrations = state.integrations[meeting.workspace_id]
    if (integrations) integrations.notion = { ...integrations.notion, status: 'revoked' }
  }
  return meeting
}

/** 상세 조회 한 번에 처리 중 회의를 흐름 방식대로 진행한다. 처리 중이 아니거나 `manual` 이면 그대로다 */
export function tickMeeting(meetingId: string, state: MockDb = db): void {
  const meeting = state.meetings.find(({ meeting_id }) => meeting_id === meetingId)
  if (meeting?.status !== 'processing') return
  const mode: MeetingFlowMode = state.meetingFlow.mode
  switch (mode) {
    case 'manual':
      return
    case 'staged':
      advanceMeeting(meetingId, state)
      return
    case 'instant':
      completeMeeting(meetingId, state)
      return
    case 'fail':
      failMeeting(meetingId, {}, state)
      return
    case 'fail-notion-revoked':
      failMeeting(meetingId, { notionRevoked: true }, state)
      return
  }
}

export function setMeetingFlowMode(mode: MeetingFlowMode, state: MockDb = db): void {
  state.meetingFlow.mode = mode
}
