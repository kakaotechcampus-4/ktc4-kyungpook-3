import { meetingFailure } from '@/entities/meeting'

/** 완료 토스트 (D-095) */
export const PROCESSING_DONE_TITLE = '회의 정리가 끝났어요'
export const PROCESSING_DONE_ACTION = '회의록 보기'

/** 실패 토스트의 제목 (D-092). 사유와 상관없이 같고, 사유별 안내는 설명이 갖는다 */
export const PROCESSING_FAILED_TITLE = meetingFailure(null).title

export const SPEAKERS_NEEDED_TITLE = '화자 지정이 필요해요'
export const SPEAKERS_NEEDED_ACTION = '화자 지정하기'
