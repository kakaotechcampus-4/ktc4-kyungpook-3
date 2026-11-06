import { TIME_PASSED_LOCK } from '@/features/message-action'

/**
 * 보내기 전 확인에서 화면에만 있고 아직 서버에 보내지 않은 것. 한 번에 하나만 열린다 —
 * 문구·시각·메모를 고치거나 태스크를 뺄지 정하는 동안에는 다른 고치기와 발송이 잠긴다
 */
export type ReviewDraft =
  | { kind: 'none' }
  | { kind: 'body' }
  | { kind: 'time' }
  | { kind: 'note'; reminderId: string }
  | { kind: 'remove'; reminderId: string }

export const NO_DRAFT: ReviewDraft = { kind: 'none' }

/** 열린 것 때문에 발송·보내지 않음이 잠긴 이유. 잠긴 버튼의 설명(`aria-describedby`)으로도 읽힌다 */
const DRAFT_LOCK: Record<ReviewDraft['kind'], string | null> = {
  none: null,
  body: '고친 문구를 저장하거나 취소한 뒤에 보낼 수 있어요.',
  time: '정한 시각을 저장하거나 취소한 뒤에 보낼 수 있어요.',
  note: '고친 메모를 저장하거나 취소한 뒤에 보낼 수 있어요.',
  remove: '태스크를 뺄지 정한 뒤에 보낼 수 있어요.',
}

/** 승인은 지난 시각으로 거절된 뒤에도 잠긴다. 열린 것이 있으면 그 이유를 먼저 보인다 */
export function lockReason(draft: ReviewDraft, timePassed: boolean): string | null {
  return DRAFT_LOCK[draft.kind] ?? (timePassed ? TIME_PASSED_LOCK : null)
}

/** 다시 받은 묶음에 그 태스크가 없으면(다른 곳에서 빠졌다) 열린 것도 없다 */
export function liveDraft(draft: ReviewDraft, reminderIds: readonly string[]): ReviewDraft {
  if (draft.kind !== 'note' && draft.kind !== 'remove') return draft
  return reminderIds.includes(draft.reminderId) ? draft : NO_DRAFT
}

/** 메모 칸의 값을 서버가 저장할 값으로. 빈 글은 메모를 지운다 (백엔드 ReminderUpdateRequest) */
export function normalizeNote(value: string): string | null {
  const note = value.trim()
  return note === '' ? null : note
}
