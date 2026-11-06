import type { ApprovalDto } from '@/shared/types/api/approval'
import type { MockDb } from '../db'
import type { MockNotification } from './notification'
import { reply } from './message'

/*
 * 시나리오 reply-judgment 의 판단 결과 (#344). ws_01 PM(mb_01) 이 본다.
 * - 박민수 th_02 의 답장 mg_05 는 어느 태스크인지 몰라 PM 이 고를 차례다(후보 tk_02·tk_05)
 * - 이재환 th_01 의 새 답장 mg_31 은 tk_03 을 완료로 자동 반영했고(되돌릴 수 있다), tk_03 마감 변경과
 *   tk_08 담당자 변경(담당자를 팀원에서 찾지 못함)을 승인 카드로 보냈다
 */

const JUDGED_AT = '2026-09-17T10:01:00+09:00'

export const REPLY_FROM_JAEHWAN = reply(
  'mg_31',
  'DB 스키마 정리는 끝냈어요. 랜딩 카피는 민지님이 이어서 맡기로 했고, 마감은 26일까지 미뤄도 될까요?',
  '2026-09-17T10:00:00+09:00',
)

function replyApproval(
  approvalId: string,
  taskId: string,
  taskTitle: string,
  payload: Record<string, unknown>,
): ApprovalDto {
  return {
    approval_id: approvalId,
    workspace_id: 'ws_01',
    type: 'task_update',
    payload: {
      ...payload,
      base_task_version: 1,
      base_title: taskTitle,
      task_title: taskTitle,
      due_raw: null,
      evidence_speaker: null,
      evidence_speaker_member_id: 'mb_03',
      evidence_at_ms: null,
      gate: 'review',
      change_source: 'reminder_reply',
      reply_message_id: REPLY_FROM_JAEHWAN.message_id,
    },
    related_task_id: taskId,
    requested_by: null,
    status: 'pending',
    resolved_by: null,
    created_at: JUDGED_AT,
    resolved_at: null,
  }
}

const replyNotifications: MockNotification[] = [
  {
    notification_id: 'nt_31',
    workspace_id: 'ws_01',
    member_id: 'mb_01',
    kind: 'reply_judged',
    text: "이재환 답장 'DB 스키마 정리는 끝냈어요. 랜딩 카피는…' → 1건 바꿨어요, 2건 확인이 필요해요",
    link: { type: 'thread', id: 'th_01' },
    read_at: null,
    created_at: JUDGED_AT,
  },
  {
    notification_id: 'nt_32',
    workspace_id: 'ws_01',
    member_id: 'mb_01',
    kind: 'reply_judged',
    text: "박민수 답장 '거의 다 됐어요. 내일 오전에 올릴게요' → 어느 태스크인지 골라 주세요",
    link: { type: 'thread', id: 'th_02' },
    read_at: null,
    created_at: '2026-09-09T14:21:00+09:00',
  },
]

/** 판단 결과를 상태에 넣는다. 자동 반영한 tk_03 의 상태와 그 이력도 함께 바꾼다 */
export function addReplyJudgments(state: MockDb): void {
  state.messageThreads
    .find(({ thread_id }) => thread_id === 'th_01')
    ?.messages.push(structuredClone(REPLY_FROM_JAEHWAN))

  const task = state.tasks.find(({ task_id }) => task_id === 'tk_03')
  if (task === undefined) throw new Error('mock task tk_03 is missing')
  task.status = 'done'
  task.version += 1
  task.updated_at = JUDGED_AT
  state.taskHistory.push({
    history_id: 'hs_31',
    task_id: 'tk_03',
    changed_field: 'status',
    old_value: 'blocked',
    new_value: 'done',
    change_source: 'reminder_reply',
    changed_by: null,
    is_auto: true,
    is_rolled_back: false,
    rolled_back_at: null,
    created_at: JUDGED_AT,
  })

  state.approvals.push(
    replyApproval('ap_31', 'tk_03', 'DB 스키마 정리', {
      due_date: '2026-09-26',
      base_values: { due_date: '2026-09-22' },
      doc_text: '마감을 26일로 미루자고 했어요',
      category: 'schedule',
      assignee_raw: null,
      assignee_needs_check: false,
      evidence_quote: '마감은 26일까지 미뤄도 될까요?',
    }),
    replyApproval('ap_32', 'tk_08', '랜딩 카피', {
      base_values: {},
      doc_text: '민지님이 이어서 맡기로 했대요',
      category: 'assignee',
      assignee_raw: '민지',
      assignee_needs_check: false,
      evidence_quote: '랜딩 카피는 민지님이 이어서 맡기로 했고',
    }),
  )

  state.replies = {
    judgments: [
      {
        message_id: 'mg_05',
        workspace_id: 'ws_01',
        thread_id: 'th_02',
        state: 'needs_pm',
        candidates: ['tk_02', 'tk_05'],
        picked_task_id: null,
      },
      {
        message_id: REPLY_FROM_JAEHWAN.message_id,
        workspace_id: 'ws_01',
        thread_id: 'th_01',
        state: 'done',
        candidates: ['tk_03', 'tk_08'],
        picked_task_id: null,
      },
    ],
    changes: [
      {
        change_id: 'rc_01',
        message_id: 'mg_05',
        task_id: null,
        field: 'unknown',
        new_value: null,
        evidence_status: null,
        summary: null,
        evidence_quote: null,
        outcome: 'unknown',
        approval_id: null,
      },
      {
        change_id: 'rc_02',
        message_id: REPLY_FROM_JAEHWAN.message_id,
        task_id: 'tk_03',
        field: 'status',
        new_value: 'done',
        evidence_status: 'certain',
        summary: 'DB 스키마 정리를 끝냈대요',
        evidence_quote: 'DB 스키마 정리는 끝냈어요',
        outcome: 'applied',
        approval_id: null,
      },
      {
        change_id: 'rc_03',
        message_id: REPLY_FROM_JAEHWAN.message_id,
        task_id: 'tk_03',
        field: 'due_date',
        new_value: '2026-09-26',
        evidence_status: 'inferred',
        summary: '마감을 26일로 미루자고 했어요',
        evidence_quote: '마감은 26일까지 미뤄도 될까요?',
        outcome: 'proposed',
        approval_id: 'ap_31',
      },
      {
        change_id: 'rc_04',
        message_id: REPLY_FROM_JAEHWAN.message_id,
        task_id: 'tk_08',
        field: 'assignee',
        new_value: '민지',
        evidence_status: 'certain',
        summary: '민지님이 이어서 맡기로 했대요',
        evidence_quote: '랜딩 카피는 민지님이 이어서 맡기로 했고',
        outcome: 'proposed',
        approval_id: 'ap_32',
      },
    ],
    historyLinks: { hs_31: 'rc_02' },
  }

  state.notifications.push(...structuredClone(replyNotifications))
}
