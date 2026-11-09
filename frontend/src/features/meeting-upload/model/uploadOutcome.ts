import { errorMessage } from '@/shared/api/errorMessages'
import { ApiError, ERROR_CODES, isCanceledError, isInvalidResponse } from '@/shared/api/errors'
import { AUDIO_REJECTION_MESSAGE } from './audioFile'

/**
 * 업로드가 실패했을 때 화면이 할 일 (U3-8, U3-10).
 * - `processing`: 다른 정리가 먼저 시작됐다(409) — 그 처리 화면으로
 * - `file`: 파일 칸 오류(413·형식) / `form`: 폼 상단 오류(400 등)
 * - `lost`: 응답을 받지 못했거나 읽지 못했다(#348) — 서버가 받았는지 모른다. 목록을 다시 봐서 판단한다
 * - `session`: 401 — 앱의 세션 만료 처리가 로그인으로 보낸다. 화면은 아무것도 하지 않는다
 * - `ignored`: 취소
 */
export type UploadFailure =
  | { kind: 'processing'; meetingId: string }
  | { kind: 'file'; message: string }
  | { kind: 'form'; message: string }
  | { kind: 'lost' }
  | { kind: 'session' }
  | { kind: 'ignored' }

/** 응답을 잃었고 다시 받은 목록에 이 업로드도 정리 중 회의도 없을 때. 서버가 받지 않았다 */
export const UPLOAD_LOST_MESSAGE =
  '올린 결과를 확인하지 못했어요. 네트워크 연결을 확인한 뒤 다시 올려 주세요.'

/**
 * 응답을 잃었는데 받아졌는지도 정하지 못했을 때(목록을 받지 못했거나 같은 업로드로 보이는 회의가 여럿). 다시 올리면 회의가
 * 둘 생길 수 있어 재업로드를 권하지 않고 목록에서 확인하게 한다 (#348 리뷰)
 */
export const UPLOAD_UNCONFIRMED_MESSAGE =
  '올린 결과를 확인하지 못했어요. 다시 올리기 전에 회의록 목록에서 이 회의가 올라갔는지 확인해 주세요.'

export function classifyUploadError(error: unknown): UploadFailure {
  if (isCanceledError(error)) return { kind: 'ignored' }
  if (!(error instanceof ApiError)) return { kind: 'form', message: errorMessage(error) }
  if (error.kind === 'network' || isInvalidResponse(error)) return { kind: 'lost' }
  if (error.kind === 'http' && error.status === 401) return { kind: 'session' }
  switch (error.code) {
    case ERROR_CODES.MEETING_PROCESSING_IN_PROGRESS: {
      const meetingId = error.details?.meeting_id
      return typeof meetingId === 'string' && meetingId !== ''
        ? { kind: 'processing', meetingId }
        : { kind: 'form', message: errorMessage(error) }
    }
    // 서버 한도는 아직 없다(계약 §4.4). 생기면 화면 한도와 같은 문구로 알린다
    case ERROR_CODES.AUDIO_TOO_LARGE:
      return { kind: 'file', message: AUDIO_REJECTION_MESSAGE.too_large }
    case ERROR_CODES.AUDIO_FORMAT_UNSUPPORTED:
      return { kind: 'file', message: AUDIO_REJECTION_MESSAGE.format }
    default:
      return { kind: 'form', message: errorMessage(error) }
  }
}
