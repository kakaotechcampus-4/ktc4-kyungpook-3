import type { MessageAction } from '@/entities/message'
import { formatSeoulDateTime } from '@/shared/lib/date'

/* 메시지 쓰기 행동의 문구. 해요체로 원인과 다음 행동을 함께 쓴다 (D-149) */

export const ACTION_FAILURE_TITLE: Record<MessageAction['kind'], string> = {
  send: '메시지를 보내지 못했어요',
  dismiss: '보내지 않음으로 처리하지 못했어요',
  edit: '고친 문구를 저장하지 못했어요',
  schedule: '발송 시점을 바꾸지 못했어요',
  reply: '답장을 보내지 못했어요',
  attribute: '태스크를 정하지 못했어요',
}

export const REVIEW_GONE_MESSAGE =
  '이미 처리했거나 사라진 메시지예요. 목록을 새로 받아 다시 확인해 주세요.'

/** 발송(승인) 성공 알림. 정해 둔 시각이 있으면 예약이다 */
export function sendNotice(recipientName: string, scheduledAt: string | null): string {
  if (scheduledAt === null) return `${recipientName}님에게 메시지를 보냈어요`
  return `${formatSeoulDateTime(scheduledAt).slice(5).replace('-', '/')}에 ${recipientName}님에게 보낼게요`
}

export function dismissNotice(recipientName: string): string {
  return `${recipientName}님에게 보낼 메시지를 보내지 않기로 했어요`
}
