/* 결정 문서의 문구 그대로다 */

/** 완료 토스트 (D-095) */
export const PROCESSING_DONE_TITLE = '회의 정리가 끝났어요'
export const PROCESSING_DONE_ACTION = '회의록 보기'

/** 일반 실패 토스트 (D-092) */
export const PROCESSING_FAILED_TITLE = '회의를 정리하지 못했어요. 파일을 다시 올려 주세요.'

/** 같은 회의의 알림은 하나로 합친다 — 같은 key 는 토스트 자리에 하나만 있다 */
export function processingToastKey(
  kind: 'done' | 'failed',
  workspaceId: string,
  meetingId: string,
): string {
  return `meeting-${kind}:${workspaceId}/${meetingId}`
}
