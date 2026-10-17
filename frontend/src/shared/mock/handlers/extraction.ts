import { http } from 'msw'
import type { ApprovalDto } from '@/shared/types/api/approval'
import type { ExtractionDto, ExtractionItemDto } from '@/shared/types/api/extraction'
import { requireAuth, requirePm } from '../auth-guard'
import { db } from '../db'
import { fail, ok } from '../envelope'
import { MOCK_NOW } from '../fixtures/constants'
import { nextId } from '../utils'

/**
 * 백엔드 get_extraction 처럼 항목의 `approval_status` 는 저장값이 아니라 지금 승인 상태로 채운다 — 승인·반려 뒤에도
 * 저장된 항목은 그대로라 저장값은 낡는다. 예전 저장본(M6 이전 sessionStorage)에 없는 `reverted_at` 은 null 로 내린다
 */
function withLiveStatus(extraction: ExtractionDto): ExtractionDto {
  return {
    ...extraction,
    items: extraction.items.map((item) => ({
      ...item,
      reverted_at: item.reverted_at ?? null,
      approval_status:
        item.approval_id === null
          ? null
          : (db.approvals.find(({ approval_id }) => approval_id === item.approval_id)?.status ??
            null),
    })),
  }
}

function notRevertible(
  item: ExtractionItemDto,
  reason: string,
  details: Record<string, unknown> = {},
) {
  return fail(
    'AUTO_TASK_NOT_REVERTIBLE',
    '자동으로 만든 태스크를 되돌릴 수 없습니다. 태스크를 직접 수정해 주세요.',
    409,
    { item_id: item.item_id, reason, ...details },
  )
}

export const extractionHandlers = [
  http.get('/api/v1/extractions/:extractionId', ({ params }) => {
    const extraction = db.extractions.find(
      ({ extraction_id }) => extraction_id === params.extractionId,
    )
    return extraction
      ? ok(withLiveStatus(extraction))
      : fail('EXTRACTION_NOT_FOUND', '추출 결과가 없습니다.', 404)
  }),
  /*
   * 백엔드 revert_auto_item 과 같은 순서다. 인증 → 추출 존재(404) → 그 회의 공간의 PM(403) → 항목 존재(404) →
   * 이미 되돌림 → auto 생성 항목인지 → 태스크가 남아 있는지 → 만든 뒤 바뀌지 않았는지(version 1) → 그 태스크를 대상으로
   * 처리 대기 중인 승인이 없는지. 거절은 모두 409 AUTO_TASK_NOT_REVERTIBLE 이고 아무것도 바꾸지 않는다.
   * 통과하면 태스크를 지우고(MSW 는 행을 뺀다 — 서버는 지움 표시라 조회에서 빠진다) 같은 내용의 생성 승인을 만든다.
   * Notion 페이지 보관은 서버 워커의 일이라 흉내내지 않는다. 백엔드의 `action == create` 판정은 MSW 항목에 action 이 없어
   * gate·task_id 로만 본다
   */
  http.post('/api/v1/extractions/:extractionId/items/:itemId/revert', ({ params }) => {
    const unauthenticated = requireAuth()
    if (unauthenticated) return unauthenticated
    const extraction = db.extractions.find(
      ({ extraction_id }) => extraction_id === params.extractionId,
    )
    if (!extraction)
      return fail('EXTRACTION_NOT_FOUND', '추출 결과가 없습니다.', 404, {
        extraction_id: params.extractionId,
      })
    const meeting = db.meetings.find(({ meeting_id }) => meeting_id === extraction.meeting_id)
    const pm = meeting
      ? requirePm(meeting.workspace_id)
      : fail('MEETING_NOT_FOUND', '회의가 없습니다.', 404)
    if (pm instanceof Response) return pm
    const item = extraction.items.find(({ item_id }) => item_id === params.itemId)
    if (!item)
      return fail('EXTRACTION_ITEM_NOT_FOUND', '추출 항목이 없습니다.', 404, {
        item_id: params.itemId,
      })
    if ((item.reverted_at ?? null) !== null) return notRevertible(item, 'already_reverted')
    if (item.gate !== 'auto' || item.task_id === null)
      return notRevertible(item, 'not_auto_created')
    const task = db.tasks.find(({ task_id }) => task_id === item.task_id)
    if (!task) return notRevertible(item, 'task_missing', { task_id: item.task_id })
    if (task.version !== 1)
      return notRevertible(item, 'task_changed', {
        task_id: task.task_id,
        task_version: task.version,
      })
    const pending = db.approvals.find(
      (approval) => approval.related_task_id === task.task_id && approval.status === 'pending',
    )
    if (pending)
      return notRevertible(item, 'pending_approval', {
        task_id: task.task_id,
        approval_id: pending.approval_id,
      })

    db.tasks = db.tasks.filter(({ task_id }) => task_id !== task.task_id)
    // 처음부터 review 였을 때의 생성 승인과 같은 모양이다. 승인하면 승인 handler 가 이 항목에 새 태스크를 잇는다
    const approval: ApprovalDto = {
      approval_id: nextId(
        'ap',
        db.approvals.map(({ approval_id }) => approval_id),
        90,
      ),
      workspace_id: task.workspace_id,
      type: 'task_create',
      payload: {
        task_title: item.task.title,
        assignee_member_id: item.assignee.member_id,
        assignee_raw: item.assignee.raw,
        due_date: item.due_date.value,
        due_raw: item.due_date.raw,
        evidence_quote: item.evidence.quote,
        evidence_speaker: item.evidence.speaker,
        evidence_at_ms: item.evidence.at_ms,
        extraction_item_id: item.item_id,
        meeting_id: extraction.meeting_id,
        gate: 'review',
        // 표시용. auto 로 만들었다가 되돌린 요청임을 알린다
        reverted_task_id: task.task_id,
      },
      related_task_id: null,
      requested_by: null,
      status: 'pending',
      resolved_by: null,
      created_at: MOCK_NOW,
      resolved_at: null,
    }
    db.approvals.push(approval)
    item.task_id = null
    item.approval_id = approval.approval_id
    item.approval_status = 'pending'
    item.reverted_at = MOCK_NOW
    return ok({
      item_id: item.item_id,
      reverted_task_id: task.task_id,
      approval_id: approval.approval_id,
      reverted_at: item.reverted_at,
    })
  }),
]
