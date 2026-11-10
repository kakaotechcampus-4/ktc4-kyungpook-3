import { parseEnvelope } from '@/shared/api/envelope'
import { ERROR_CODES } from '@/shared/api/errors'
import { meetingAudioUrl } from './speakers'

/** 들을 수 없는 이유 (계약 §2.3.1). 모르는 이유는 null 이다 */
export type AudioUnavailableReason = 'expired' | 'no_recording'

/**
 * 재생이 실패한 뒤 녹음 경로에 다시 물은 결과.
 * - `unavailable`: 404 `AUDIO_NOT_AVAILABLE`. 다시 불러도 들을 수 없다
 * - `reachable`: 302(S3 임시 주소) 또는 2xx. 녹음은 있으니 끝난 임시 주소를 새로 받으면 된다
 * - `failed`: 그 밖(권한·삭제·로그인·네트워크·5xx)
 */
export type AudioProbe =
  | { kind: 'unavailable'; reason: AudioUnavailableReason | null }
  | { kind: 'reachable' }
  | { kind: 'failed' }

function isReason(value: unknown): value is AudioUnavailableReason {
  return value === 'expired' || value === 'no_recording'
}

/** 응답 머리와 본문으로 판정한다. 같은 출처의 302 를 따라가지 않으면 브라우저는 `opaqueredirect`(status 0)를 준다 */
export function toAudioProbe(
  response: { type: string; status: number },
  body: string | null,
): AudioProbe {
  const { type, status } = response
  if (type === 'opaqueredirect' || (status >= 200 && status < 400)) return { kind: 'reachable' }
  if (status !== 404) return { kind: 'failed' }
  const error = parseEnvelope(body)?.error
  if (error?.code !== ERROR_CODES.AUDIO_NOT_AVAILABLE) return { kind: 'failed' }
  const reason = error.details?.reason
  return { kind: 'unavailable', reason: isReason(reason) ? reason : null }
}

/**
 * 녹음 경로에 한 번 묻는다. 302 를 따라가지 않아 S3 에는 요청하지 않는다 — 버킷 CORS 가 필요 없다.
 * 실패를 던지지 않고 `failed` 로 돌려준다
 */
export async function probeMeetingAudio(
  meetingId: string,
  signal?: AbortSignal,
): Promise<AudioProbe> {
  try {
    const response = await fetch(new URL(meetingAudioUrl(meetingId), window.location.origin), {
      credentials: 'include',
      redirect: 'manual',
      signal,
    })
    if (response.status !== 404) {
      // local 저장소면 200 으로 녹음 전체가 온다. 받지 않는다
      void response.body?.cancel().catch(() => {})
      return toAudioProbe(response, null)
    }
    return toAudioProbe(response, await response.text())
  } catch {
    return { kind: 'failed' }
  }
}
