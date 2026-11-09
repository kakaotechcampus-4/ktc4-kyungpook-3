import { queryOptions } from '@tanstack/react-query'
import { request } from '@/shared/api/client'
import { parseResponse } from '@/shared/api/parseResponse'
import { STALE_TIME } from '@/shared/api/queryClient'
import { workspaceKey } from '@/shared/api/queryKeys'
import { minutesSchema } from '@/shared/types/api/minutes'
import { toMinutes } from '../model/mapper'

/**
 * 회의록 본문. 정리가 끝난(`done`) 회의만 부른다 — 끝난 회의록은 바뀌지 않아 5분 동안 최신으로 본다 (D-136).
 * 회의 상세의 `workspaceId` 가 URL 과 같은지 확인한 뒤에 시작한다. 그 확인은 화면 몫이다.
 */
export function minutesQueryOptions(workspaceId: string, meetingId: string) {
  return queryOptions({
    queryKey: workspaceKey(workspaceId, 'minutes', meetingId),
    queryFn: async ({ signal }) =>
      toMinutes(
        parseResponse(
          minutesSchema,
          await request<unknown>(`/meetings/${encodeURIComponent(meetingId)}/minutes`, { signal }),
          'minutes',
        ),
      ),
    staleTime: STALE_TIME.long,
  })
}
