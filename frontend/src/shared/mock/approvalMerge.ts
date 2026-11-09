import type { ApprovalDto } from '@/shared/types/api/approval'
import type { MergeFacts, MockExtractionItem } from './aliasLearning'
import type { MockDb } from './db'

/**
 * 백엔드 `_payload_version` 은 저장된 payload JSON 의 sha256 앞 16자다. 모의는 같은 성질, 곧 내용이 바뀌면 값이
 * 바뀌고 task_create 만 값이 있다는 것만 흉내 낸다. 화면은 같은지만 비교한다 (#547)
 */
export function payloadVersionOf(approval: ApprovalDto): string | null {
  if (approval.type !== 'task_create') return null
  const text = JSON.stringify(approval.payload)
  let a = 0x811c9dc5
  let b = 0x01000193
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index)
    a = Math.imul(a ^ code, 0x01000193) >>> 0
    b = Math.imul(b ^ code, 0x811c9dc5) >>> 0
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0')
}

/**
 * 대기 중인 생성 카드에 다른 회의의 항목 하나를 합친다. backend services/pending_merge.py 의 `merge_into_pending`
 * 과 같은 규칙이다. 바꾸면 그쪽과 맞춘다. 제목·대표 근거·meeting_id·extraction_item_id·category 는 그대로 둔다
 */
export function mergeIntoApproval(
  approval: ApprovalDto,
  meetingId: string,
  item: MockExtractionItem,
  { category, status, docText }: MergeFacts,
  mergedAt: string,
): void {
  const payload = { ...approval.payload }
  // 마감 지우기는 표현할 수 없어 새 값이 있을 때만 덮는다
  if (item.due_date.value !== null) {
    payload.due_date = item.due_date.value
    payload.due_raw = item.due_date.raw
  }
  if (status) payload.status = status

  const memberId = item.assignee.member_id
  const raw = item.assignee.raw
  if (category === 'assignee') {
    // 담당자를 못 찾아 원문만 있는 hold 카드에 담당자 표현이 없는 항목이 오면, 원문이 지워지며 hold 만 풀리지 않게 둔다
    const keepsUnresolved =
      payload.gate === 'hold' &&
      (payload.assignee_member_id ?? null) === null &&
      Boolean(payload.assignee_raw) &&
      memberId === null &&
      !raw
    if (!keepsUnresolved) {
      // 찾아 둔 담당자를 지우는 항목이면 카드를 hold 로 올려 담당자가 사라진 것을 드러낸다
      const clearsAssignee = (payload.assignee_member_id ?? null) !== null && memberId === null
      payload.assignee_member_id = memberId
      payload.assignee_raw = raw
      payload.gate = clearsAssignee ? 'hold' : item.gate
      payload.assignee_item_id = item.item_id
    }
  }

  if ((docText ?? '').trim()) {
    const old = typeof payload.doc_text === 'string' ? payload.doc_text : ''
    payload.doc_text = old ? `${old} / ${docText}` : docText
  }

  payload.merged_items = [
    ...(payload.merged_items ?? []),
    {
      extraction_item_id: item.item_id,
      meeting_id: meetingId,
      evidence_quote: item.evidence.quote,
      evidence_speaker: item.evidence.speaker,
      evidence_speaker_member_id: item.evidence.speaker_member_id,
      evidence_at_ms: item.evidence.at_ms,
      doc_text: docText,
      merged_at: mergedAt,
    },
  ]
  approval.payload = payload
  item.approval_id = approval.approval_id
  delete item.merge_into
}

/**
 * 「본 뒤 합쳐짐」 시나리오. `merge_into` 로 이 카드를 가리키는 항목을 처리 요청이 비교하기 직전에 합친다.
 * 실제로는 PM 이 카드를 연 사이에 끝난 다른 회의의 정리가 합친다
 */
export function mergePendingItems(state: MockDb, approval: ApprovalDto, mergedAt: string): void {
  for (const extraction of state.extractions)
    for (const item of extraction.items)
      if (item.merge_into?.approval_id === approval.approval_id)
        mergeIntoApproval(approval, extraction.meeting_id, item, item.merge_into, mergedAt)
}
