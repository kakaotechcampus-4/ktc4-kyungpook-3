import { errorMessage } from '@/shared/api/errorMessages'
import { ApiError, ERROR_CODES, isCanceledError } from '@/shared/api/errors'

/* 회의 채팅 채널 저장의 문구. 해요체로 원인과 PM 이 할 일을 함께 쓴다 (D-149). 근거는 backend chat_channel.py 와 #428 설계 */

export const CHAT_CHANNEL_SAVED = '회의 채팅 채널을 저장했어요.'
export const CHAT_CHANNEL_CLEARED = '회의 채팅 채널 수집을 껐어요.'
export const OFF_NOTICE_NOT_SENT = '채널에 끔 안내를 남기지 못했어요.'

/** 봇이 하지 못한 일(`details.need`)마다 Discord 에서 고칠 곳이 다르다 */
const NOT_ACCESSIBLE: Readonly<Record<string, string>> = {
  read: '봇이 이 채널을 읽을 수 없어요. Discord 채널 설정의 권한에 봇을 추가해 주세요.',
  send: '봇이 이 채널에 메시지를 보낼 수 없어요. Discord 채널 권한에서 봇에게 메시지 보내기 권한을 주세요.',
}

const KNOWN: Readonly<Record<string, string>> = {
  [ERROR_CODES.DISCORD_CHANNEL_NOT_FOUND]:
    '연결된 Discord 서버에서 이 텍스트 채널을 찾을 수 없어요. 채널 목록을 다시 불러왔으니 다시 골라 주세요.',
  [ERROR_CODES.DISCORD_API_FAILED]: 'Discord에 요청하지 못했어요. 잠시 후 다시 시도해 주세요.',
  [ERROR_CODES.INTEGRATION_NOT_CONNECTED]:
    'Discord 연결이 끊겼어요. Discord를 다시 연결한 뒤 골라 주세요.',
}

/** 저장 실패 문구. 취소는 실패가 아니라 null 이다 */
export function chatChannelFailure(error: unknown): string | null {
  if (isCanceledError(error)) return null
  if (!(error instanceof ApiError)) return errorMessage(error)
  if (error.code === ERROR_CODES.DISCORD_CHANNEL_NOT_ACCESSIBLE) {
    const need = error.details?.need
    return typeof need === 'string' && Object.hasOwn(NOT_ACCESSIBLE, need)
      ? NOT_ACCESSIBLE[need]
      : errorMessage(error)
  }
  return Object.hasOwn(KNOWN, error.code) ? KNOWN[error.code] : errorMessage(error)
}
