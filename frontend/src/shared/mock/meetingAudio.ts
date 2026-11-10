import type { MeetingDto } from '@/shared/types/api/meeting'
import { db } from './db'
import type { MockDb } from './db'

/*
 * 회의 녹음 보관 (계약 §2.3.1, backend services/meeting_audio.py, #676).
 * 실 서버는 녹음 기록과 지금 시각으로 들을 수 있는지 정한다. 모의 handler 는 시계를 읽지 않으므로,
 * done 회의는 회의록의 `audio` 가 보관 기간 안인지를 말한다. 회의록에서 audio 를 null 로 바꾸면 그 회의는 기간이 지난 것이다
 */

/** 들을 수 없는 이유. backend meeting_audio.REASON_* */
export type MockAudioUnavailable = 'expired' | 'no_recording'

/**
 * 모의 녹음 길이(초). 들을 수 있는 픽스처 회의(mt_09)의 근거·전사 시각(8분까지)과 화자 샘플이 모두 안에 든다.
 * 실제 회의 길이만큼 만들면 수십 MB 라 줄였다. 더 뒤로 옮기면 브라우저가 녹음 끝으로 자른다
 */
export const MOCK_RECORDING_SECONDS = 600

/** 실 서버가 302 로 보내는 S3 임시 주소 자리. 같은 출처라 모의 worker 가 받는다 */
export function mockS3AudioUrl(meetingId: string): string {
  return `/__mock/s3/meetings/${encodeURIComponent(meetingId)}/audio.wav?X-Amz-Expires=3600`
}

/** 들을 수 있으면 null. backend meeting_audio._row_and_reason 과 같은 순서로 본다 */
export function audioUnavailableReason(
  meeting: MeetingDto,
  state: MockDb = db,
): MockAudioUnavailable | null {
  const meetingId = meeting.meeting_id
  if (meeting.status === 'failed') return 'no_recording'
  const source = state.meetingSummaries.find(({ meeting_id }) => meeting_id === meetingId)?.source
  if (source === 'chat') return 'no_recording'
  if (state.meetingFlow.speakers[meetingId]?.audio === false) return 'no_recording'
  // 처리 중 회의는 보관 기간이 지나도 듣는다
  if (meeting.status !== 'done') return null
  const minutes = state.minutes.find(({ meeting_id }) => meeting_id === meetingId)
  if (minutes === undefined) return 'no_recording'
  return minutes.audio === null ? 'expired' : null
}
