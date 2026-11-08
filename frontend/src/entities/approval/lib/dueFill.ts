import { resolveDueExpression } from '@/shared/lib/date'
import type { TaskCreateApproval } from '../model/types'

/**
 * 「M/D(요일)로 채우기」에 넣을 날짜. AI 가 날짜를 정하지 못하고(`dueDate` 가 null) 한 말만 남긴 승인에서,
 * 그 말이 회의 날짜 기준으로 확실히 하나의 날짜일 때만 돌려준다. 회의 날짜를 모르면 오늘로 대신하지 않는다
 */
export function dueFillSuggestion(
  approval: Pick<TaskCreateApproval, 'dueDate' | 'dueRaw'>,
  meetingDate: string | null,
): string | null {
  if (approval.dueDate !== null || !approval.dueRaw || meetingDate === null) return null
  return resolveDueExpression(approval.dueRaw, meetingDate)
}
