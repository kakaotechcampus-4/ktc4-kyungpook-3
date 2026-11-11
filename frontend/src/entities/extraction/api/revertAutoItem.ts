import { request } from '@/shared/api/client'
import { ApiError, ERROR_CODES } from '@/shared/api/errors'
import { parseResponse } from '@/shared/api/parseResponse'
import {
  autoTaskNotRevertibleDetailsSchema,
  extractionItemRevertSchema,
} from '@/shared/types/api/extraction'
import type { AutoItemRevert, AutoItemRevertReason, AutoItemRevertRejection } from '../model/types'

/**
 * auto 로 만든 태스크 되돌리기 (`POST /extractions/{extraction_id}/items/{item_id}/revert`, PM 전용).
 * 서버가 태스크를 지우고(Notion 페이지 보관은 워커가 비동기로) 같은 내용의 생성 승인을 새로 만든다.
 * 본문이 없다. 거절(409)은 `toAutoItemRevertRejection` 으로 사유를 읽는다. 자동으로 다시 보내지 않는다
 */
export async function revertAutoItem(
  extractionId: string,
  itemId: string,
  signal?: AbortSignal,
): Promise<AutoItemRevert> {
  const dto = parseResponse(
    extractionItemRevertSchema,
    await request<unknown>(
      `/extractions/${encodeURIComponent(extractionId)}/items/${encodeURIComponent(itemId)}/revert`,
      { method: 'POST', signal },
    ),
    'extraction',
  )
  return {
    itemId: dto.item_id,
    revertedTaskId: dto.reverted_task_id,
    approvalId: dto.approval_id,
    revertedAt: dto.reverted_at,
  }
}

const REASONS = [
  'already_reverted',
  'not_auto_created',
  'task_missing',
  'task_changed',
  'pending_approval',
] as const satisfies readonly AutoItemRevertReason[]

/** 409 AUTO_TASK_NOT_REVERTIBLE 이면 사유를, 다른 실패(403·404·네트워크 등)면 null 을 돌려준다 */
export function toAutoItemRevertRejection(error: unknown): AutoItemRevertRejection | null {
  if (
    !(error instanceof ApiError) ||
    error.kind !== 'http' ||
    error.status !== 409 ||
    error.code !== ERROR_CODES.AUTO_TASK_NOT_REVERTIBLE
  )
    return null
  const parsed = autoTaskNotRevertibleDetailsSchema.safeParse(error.details)
  const details = parsed.success ? parsed.data : { reason: '' }
  return {
    reason: (REASONS as readonly string[]).includes(details.reason)
      ? (details.reason as AutoItemRevertReason)
      : 'unknown',
    taskId: details.task_id ?? null,
    approvalId: details.approval_id ?? null,
  }
}
