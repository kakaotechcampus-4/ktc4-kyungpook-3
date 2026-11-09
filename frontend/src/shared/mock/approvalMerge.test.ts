import type { ApprovalDto } from '@/shared/types/api/approval'
import type { MockExtractionItem } from './aliasLearning'
import { mergeIntoApproval } from './approvalMerge'

/* 기대값은 backend services/pending_merge.py 의 merge_into_pending 분기에서 나온다 */

function card(payload: Record<string, unknown>): ApprovalDto {
  return {
    approval_id: 'ap_x',
    workspace_id: 'ws_01',
    type: 'task_create',
    payload: {
      task_title: '배포 문서 보완',
      extraction_item_id: 'it_first',
      meeting_id: 'mt_09',
      due_date: '2026-09-25',
      due_raw: '25일',
      ...payload,
    },
    related_task_id: null,
    requested_by: null,
    status: 'pending',
    resolved_by: null,
    created_at: '2026-09-15T06:00:00Z',
    resolved_at: null,
    alias_candidate: false,
    alias_text: null,
  }
}

function item(overrides: {
  memberId?: string | null
  raw?: string | null
  due?: string | null
  gate?: string
}): MockExtractionItem {
  return {
    item_id: 'it_new',
    task: { title: '배포 문서', confidence: 0.9 },
    assignee: {
      raw: overrides.raw ?? null,
      member_id: overrides.memberId ?? null,
      display_name: null,
      confidence: 0.9,
      needs_check: false,
    },
    due_date: { value: overrides.due ?? null, raw: overrides.due ?? null, confidence: 0.9 },
    confidence: 0.9,
    gate: overrides.gate ?? 'review',
    evidence: { quote: '말', speaker: '1123', speaker_member_id: 'mb_01', at_ms: 1000 },
    reverted_at: null,
    task_id: null,
    approval_id: null,
    approval_status: null,
    alias_candidate: false,
    alias_text: null,
  }
}

const AT = '2026-09-17T03:00:00Z'
const noExtra = { status: null, docText: null }

it('담당자 항목이 찾아 둔 담당자를 비우면 담당자를 지우고 카드를 hold 로 올리며 그 항목이 담당 항목이 된다', () => {
  const approval = card({ assignee_member_id: 'mb_02', assignee_raw: '박민수', gate: 'review' })
  mergeIntoApproval(approval, 'mt_07', item({}), { category: 'assignee', ...noExtra }, AT)
  expect(approval.payload).toMatchObject({
    assignee_member_id: null,
    assignee_raw: null,
    gate: 'hold',
    assignee_item_id: 'it_new',
  })
})

it('못 찾은 원문만 있는 hold 카드에 담당자 표현이 없는 항목이 오면 담당자를 그대로 둔다', () => {
  const approval = card({ assignee_member_id: null, assignee_raw: '지훈', gate: 'hold' })
  mergeIntoApproval(approval, 'mt_07', item({}), { category: 'assignee', ...noExtra }, AT)
  expect(approval.payload).toMatchObject({
    assignee_member_id: null,
    assignee_raw: '지훈',
    gate: 'hold',
  })
  expect(approval.payload).not.toHaveProperty('assignee_item_id')
})

it('담당자 항목이 아니면 담당자가 있어도 카드 담당자를 바꾸지 않는다', () => {
  const approval = card({ assignee_member_id: 'mb_02', assignee_raw: '박민수', gate: 'review' })
  mergeIntoApproval(
    approval,
    'mt_07',
    item({ memberId: 'mb_03', raw: '재환', gate: 'hold' }),
    { category: 'schedule', ...noExtra },
    AT,
  )
  expect(approval.payload).toMatchObject({
    assignee_member_id: 'mb_02',
    assignee_raw: '박민수',
    gate: 'review',
  })
  expect(approval.payload).not.toHaveProperty('assignee_item_id')
})

it('담당자 항목이 새 담당자를 말하면 그 담당자·원문·항목 gate 로 바꾼다', () => {
  const approval = card({ assignee_member_id: null, assignee_raw: '지훈', gate: 'review' })
  mergeIntoApproval(
    approval,
    'mt_07',
    item({ memberId: 'mb_03', raw: '재환', gate: 'review' }),
    { category: 'assignee', ...noExtra },
    AT,
  )
  expect(approval.payload).toMatchObject({
    assignee_member_id: 'mb_03',
    assignee_raw: '재환',
    gate: 'review',
    assignee_item_id: 'it_new',
  })
})

it('마감은 새 값이 있을 때만, 상태는 값이 있을 때만 덮고 문서 글은 / 로 잇는다. 합친 항목에 그 문서 글을 남긴다', () => {
  const approval = card({ doc_text: '첫 설명' })
  mergeIntoApproval(
    approval,
    'mt_07',
    item({}),
    { category: 'schedule', status: 'in_progress', docText: '둘째 설명' },
    AT,
  )
  expect(approval.payload).toMatchObject({
    due_date: '2026-09-25',
    due_raw: '25일',
    status: 'in_progress',
    doc_text: '첫 설명 / 둘째 설명',
  })
  expect(approval.payload.merged_items).toEqual([
    {
      extraction_item_id: 'it_new',
      meeting_id: 'mt_07',
      evidence_quote: '말',
      evidence_speaker: '1123',
      evidence_speaker_member_id: 'mb_01',
      evidence_at_ms: 1000,
      doc_text: '둘째 설명',
      merged_at: AT,
    },
  ])

  mergeIntoApproval(
    approval,
    'mt_08',
    item({ due: '2026-09-30' }),
    { category: null, ...noExtra },
    AT,
  )
  expect(approval.payload).toMatchObject({
    due_date: '2026-09-30',
    doc_text: '첫 설명 / 둘째 설명',
  })
})
