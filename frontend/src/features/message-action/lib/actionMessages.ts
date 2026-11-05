import type { Bundle, MessageAction, MessageActionOutcome } from '@/entities/message'
import { formatSeoulDateTime } from '@/shared/lib/date'

/* 메시지 쓰기 행동의 문구. 해요체로 원인과 다음 행동을 함께 쓴다 (D-149) */

export const ACTION_FAILURE_TITLE: Record<MessageAction['kind'], string> = {
  approve: '발송을 승인하지 못했어요',
  cancel: '보내지 않음으로 처리하지 못했어요',
  edit: '고친 문구를 저장하지 못했어요',
  schedule: '보낼 시각을 바꾸지 못했어요',
  reply: '답장을 보내지 못했어요',
  removeTask: '태스크를 빼지 못했어요',
  editNote: '메모를 저장하지 못했어요',
}

export const TIME_PASSED_TITLE = '예정 시각이 지났어요'
export const TIME_PASSED_MESSAGE = '보내려던 시각이 이미 지났어요. 언제 보낼지 다시 골라 주세요.'
export const TIME_PASSED_LOCK = '보낼 시각을 다시 고른 뒤에 승인할 수 있어요.'

/**
 * 서버가 거절한 이유 중 화면이 따로 다루는 것. 다시 보내도 같은 결과라 모두 `다시 시도` 가 없다.
 * - message: 알릴 문구
 * - then: 알린 뒤 할 일. refetch 는 메시지 캐시를 다시 받고, lockApproval 은 시각을 다시 고를 때까지 승인을 잠근다
 * - place: inline 은 행동 자리의 role=alert, toast 는 사라질 항목 대신 화면 전체 알림이다
 */
export interface KnownFailure {
  cause: 'changed' | 'time_passed' | 'gone'
  message: string
  then: 'refetch' | 'lockApproval'
  place: 'inline' | 'toast'
}

const GONE: KnownFailure = {
  cause: 'gone',
  message: '이미 처리된 메시지예요. 목록을 다시 불러올게요.',
  then: 'refetch',
  place: 'toast',
}

/** 오류 코드 → (문구, 후속 동작). 계약 §5.7 */
export const KNOWN_FAILURES: Readonly<Record<string, KnownFailure>> = {
  BUNDLE_CHANGED: {
    cause: 'changed',
    message: '보낼 메시지가 바뀌었어요. 다시 확인해 주세요.',
    then: 'refetch',
    place: 'inline',
  },
  REMINDER_SCHEDULED_AT_PASSED: {
    cause: 'time_passed',
    message: TIME_PASSED_TITLE,
    then: 'lockApproval',
    place: 'inline',
  },
  REMINDER_NOT_EDITABLE: GONE,
  REMINDER_BUNDLE_NOT_FOUND: GONE,
  REMINDER_NOT_FOUND: GONE,
}

/** 승인 성공 알림 */
export function approveNotice(recipientName: string, scheduledAt: string): string {
  return `${formatSeoulDateTime(scheduledAt).slice(5).replace('-', '/')}에 ${recipientName}님에게 보낼게요`
}

export function cancelNotice(recipientName: string): string {
  return `${recipientName}님에게 보낼 메시지를 보내지 않기로 했어요`
}

/** 묶은 태스크 하나를 뺀 알림. 마지막 하나를 빼 묶음이 닫히면(closed) 보내지 않기로 한 것과 같다 */
export function removeTaskNotice(
  taskTitle: string,
  recipientName: string,
  outcome: MessageActionOutcome,
): string {
  return outcome.kind === 'closed'
    ? `마지막 태스크를 빼서 ${recipientName}님에게 보낼 메시지를 보내지 않기로 했어요.`
    : `'${taskTitle}'을 뺐어요. 문구를 다시 만들었으니 확인하고 승인해 주세요.`
}

export const NOTE_SAVED_NOTICE = '메모를 고쳤어요. 문구를 다시 만들었으니 확인하고 승인해 주세요.'

/** 합친 묶음의 단계로 고른다. 서버는 합치면 승인을 풀므로 지금은 늘 승인 전이다 */
const MERGE_NOTICE: Record<Bundle['stage'], string> = {
  awaitingApproval:
    '같은 시각의 메시지와 합쳤어요. 내용이 바뀌어 승인이 풀렸으니 다시 확인하고 승인해 주세요.',
  approved: '같은 시각의 메시지와 합쳤어요.',
}

/** 보낼 시각을 옮겨 같은 시각의 묶음과 합쳐졌을 때의 알림 */
export function mergeNotice(into: Bundle): string {
  return MERGE_NOTICE[into.stage]
}
