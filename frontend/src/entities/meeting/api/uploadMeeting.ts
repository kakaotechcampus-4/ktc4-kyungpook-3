import { request } from '@/shared/api/client'
import type { UploadProgressListener } from '@/shared/api/client'
import type { MeetingUploadDto } from '@/shared/types/api/meeting'
import { toMeetingUploadResult } from '../model/mapper'
import type { MeetingUploadResult, UploadMeetingInput } from '../model/types'

export interface UploadMeetingOptions {
  /** 전송 진행. 전체 크기를 모르면 `total` 이 null 이다 */
  onProgress?: UploadProgressListener
  signal?: AbortSignal
}

/**
 * multipart 본문을 만든다. 필드 이름은 계약 §4.4 그대로다.
 * `attendee_member_ids` 는 같은 이름의 필드를 참석자 수만큼 반복한다 (impl-decision 2026-09-18).
 * 파일은 마지막에 둔다 — 서버가 작은 필드를 먼저 읽는다.
 */
export function toUploadForm(input: UploadMeetingInput): FormData {
  const form = new FormData()
  form.append('title', input.title)
  form.append('started_at', input.startedAt)
  for (const memberId of input.attendeeMemberIds) form.append('attendee_member_ids', memberId)
  form.append('file', input.file, input.file.name)
  return form
}

/**
 * 음성 파일 업로드. 202 와 함께 `processing` 회의를 돌려준다 — 정리는 그 뒤에 서버에서 이어진다.
 * 다시 보내지 않는다. 409 `MEETING_PROCESSING_IN_PROGRESS` 는 `details.meeting_id` 로 처리 중 회의를 알린다.
 * 실 API 는 PM 여부를 아직 확인하지 않는다 — 막는 것은 화면의 PM 가드다 (계약 §4.0-②-17).
 */
export async function uploadMeeting(
  workspaceId: string,
  input: UploadMeetingInput,
  options: UploadMeetingOptions = {},
): Promise<MeetingUploadResult> {
  return toMeetingUploadResult(
    await request<MeetingUploadDto>(
      `/workspaces/${encodeURIComponent(workspaceId)}/meetings/upload`,
      {
        method: 'POST',
        body: toUploadForm(input),
        signal: options.signal,
        onUploadProgress: options.onProgress,
      },
    ),
  )
}
