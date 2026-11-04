import { meetingFailure } from '@/entities/meeting'

/** 완료 토스트 (D-095) */
export const PROCESSING_DONE_TITLE = '회의 정리가 끝났어요'
export const PROCESSING_DONE_ACTION = '회의록 보기'

/** 일반 실패 토스트 (D-092) */
export const PROCESSING_FAILED_TITLE = meetingFailure(null).description

/** 업로드 회의가 화자 지정을 기다린다 (#256). PM 에게만 띄운다 */
export const SPEAKERS_NEEDED_TITLE = '화자 지정이 필요해요'
export const SPEAKERS_NEEDED_ACTION = '화자 지정하기'

/** 같은 회의의 알림은 하나로 합친다 — 같은 key 는 토스트 자리에 하나만 있다 */
export function processingToastKey(
  kind: 'done' | 'failed' | 'speakers',
  workspaceId: string,
  meetingId: string,
): string {
  return `meeting-${kind}:${workspaceId}/${meetingId}`
}
