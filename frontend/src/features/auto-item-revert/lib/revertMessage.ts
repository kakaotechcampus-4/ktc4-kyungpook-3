import type { AutoItemRevertReason } from '@/entities/extraction'

/**
 * 되돌리기 거절(409 AUTO_TASK_NOT_REVERTIBLE) 사유별 안내 (계획 §4). 서버 `message` 는 쓰지 않는다.
 * 모르는 사유는 서버 공통 문구와 같은 뜻으로 둔다 — 태스크를 직접 고치는 길을 안내한다
 */
const REJECTION_MESSAGES: Record<AutoItemRevertReason, string> = {
  task_changed: '만든 뒤에 태스크가 바뀌어 되돌릴 수 없어요. 태스크에서 직접 고쳐 주세요.',
  pending_approval: '이 태스크에 처리를 기다리는 확인 요청이 있어 되돌릴 수 없어요.',
  already_reverted: '이미 되돌린 항목이에요.',
  not_auto_created: '자동으로 만든 태스크가 아니라 되돌릴 수 없어요.',
  task_missing: '태스크가 이미 지워져 되돌릴 수 없어요.',
  unknown: '자동으로 만든 태스크를 되돌릴 수 없어요. 태스크를 직접 고쳐 주세요.',
}

export function revertRejectionMessage(reason: AutoItemRevertReason): string {
  return REJECTION_MESSAGES[reason]
}

/** 되돌린 뒤의 결과 알림 (D-037) */
export const REVERT_SUCCESS = {
  title: '자동 반영을 되돌렸어요',
  description: '태스크를 지우고 확인 필요에 다시 올렸어요.',
} as const
