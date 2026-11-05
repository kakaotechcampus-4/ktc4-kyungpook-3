import { queryOptions } from '@tanstack/react-query'
import { request } from '@/shared/api/client'
import { workspaceKey } from '@/shared/api/queryKeys'
import { config } from '@/shared/config/env'
import type { SpeakerAssignDto, SpeakerViewDto } from '@/shared/types/api/meeting'
import { toSpeakerView } from '../model/mapper'

/**
 * 업로드 회의의 화자 라벨·후보·녹음 정보 (계약 §2.3.1). 그 공간의 PM 만 부른다 — 팀원은 403 이다.
 * 경로에 공간이 없어 key 에 화면의 공간을 넣는다. 회의 캐시 접두어 아래라 정리가 끝나면 함께 무효화된다
 */
export function speakerViewQueryOptions(workspaceId: string, meetingId: string) {
  return queryOptions({
    queryKey: workspaceKey(workspaceId, 'meetings', 'speakers', meetingId),
    queryFn: async ({ signal }) =>
      toSpeakerView(
        await request<SpeakerViewDto>(`/meetings/${encodeURIComponent(meetingId)}/speakers`, {
          signal,
        }),
      ),
  })
}

/** 라벨마다 팀원(외부 참석자는 null)을 낸다. 키는 조회한 라벨과 정확히 같아야 한다. 같은 지정을 다시 내도 200 이다 */
export async function assignSpeakers(
  meetingId: string,
  mapping: Record<string, string | null>,
): Promise<void> {
  await request<SpeakerAssignDto>(`/meetings/${encodeURIComponent(meetingId)}/speakers`, {
    method: 'PUT',
    body: { mapping },
  })
}

/** 원본 녹음. 쿠키 세션으로 인증하므로 `<audio src>` 에 그대로 쓴다 — 요청 클라이언트와 같은 API 루트다 */
export function meetingAudioUrl(meetingId: string): string {
  return `${config.apiBaseUrl}/meetings/${encodeURIComponent(meetingId)}/audio`
}
