import type { ApprovalDto } from '@/shared/types/api/approval'
import type { MockExtractionItem } from './aliasLearning'
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
 * 대기 중인 생성 카드에 다른 회의의 항목 하나를 합친다. 규칙은 backend services/pending_merge.py 의
 * `merge_into_pending` 을 줄인 것이다. 제목·대표 근거·meeting_id·extraction_item_id 는 그대로 두고, 마감은 새 값이
 * 있을 때만, 담당자는 항목이 담당자를 말했을 때만 덮는다. 담당자를 바꾼 항목은 `assignee_item_id` 가 된다
 */
export function mergeIntoApproval(
  approval: ApprovalDto,
  meetingId: string,
  item: MockExtractionItem,
  mergedAt: string,
): void {
  const payload = { ...approval.payload }
  if (item.due_date.value !== null) {
    payload.due_date = item.due_date.value
    payload.due_raw = item.due_date.raw
  }
  if (item.assignee.member_id !== null || item.assignee.raw) {
    payload.assignee_member_id = item.assignee.member_id
    payload.assignee_raw = item.assignee.raw
    payload.gate = item.gate
    payload.assignee_item_id = item.item_id
  }
  payload.merged_items = [
    ...(Array.isArray(payload.merged_items) ? (payload.merged_items as unknown[]) : []),
    {
      extraction_item_id: item.item_id,
      meeting_id: meetingId,
      evidence_quote: item.evidence.quote,
      evidence_speaker: item.evidence.speaker,
      evidence_speaker_member_id: item.evidence.speaker_member_id,
      evidence_at_ms: item.evidence.at_ms,
      doc_text: null,
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
    for (const item of extraction.items as MockExtractionItem[])
      if (item.merge_into === approval.approval_id)
        mergeIntoApproval(approval, extraction.meeting_id, item, mergedAt)
}
