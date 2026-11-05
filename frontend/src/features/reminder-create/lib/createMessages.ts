import type { CreatedReminder } from '@/entities/message'
import { ApiError } from '@/shared/api/errors'

/* 재촉 만들기의 문구. 해요체로 원인과 다음 행동을 함께 쓴다 (D-149) */

export const CREATE_FAILURE_TITLE = '재촉을 만들지 못했어요'

/** 서버가 거절한 이유 중 다시 보내도 같은 것. `다시 시도` 없이 이 문구로 알린다 (계약 §5.7) */
const KNOWN_CREATE_FAILURES: Readonly<Record<string, string>> = {
  REMINDER_SCHEDULED_AT_PASSED: '보낼 시각이 지났어요. 시각을 다시 골라 주세요.',
  TASK_NOT_FOUND: '태스크가 지워졌어요. 목록을 다시 확인해 주세요.',
  MEMBER_NOT_FOUND: '팀원을 찾을 수 없어요. 팀원 목록을 다시 확인해 주세요.',
}

export function knownCreateFailure(error: unknown): string | null {
  if (!(error instanceof ApiError) || !Object.hasOwn(KNOWN_CREATE_FAILURES, error.code)) return null
  return KNOWN_CREATE_FAILURES[error.code]
}

/**
 * 만든 뒤의 알림. 같은 사람·같은 시각의 메시지가 있었으면 서버가 거기에 넣고 승인을 풀었다.
 * 같은 태스크를 다시 만들면 서버가 기존 재촉을 돌려주므로 같은 문구로 충분하다
 */
export function createdNotice({ bundle }: CreatedReminder): string {
  return bundle.tasks.length > 1
    ? `같은 시각에 ${bundle.recipientName}님에게 보낼 메시지에 넣었어요. 승인이 풀렸으니 다시 확인하고 승인해 주세요.`
    : '재촉을 만들었어요. 메시지 화면에서 확인하고 승인해야 나가요.'
}
