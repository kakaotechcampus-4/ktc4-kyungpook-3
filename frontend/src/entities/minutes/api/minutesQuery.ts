import { queryOptions } from '@tanstack/react-query'
import { request } from '@/shared/api/client'
import { parseResponse } from '@/shared/api/parseResponse'
import { workspaceKey } from '@/shared/api/queryKeys'
import { minutesSchema } from '@/shared/types/api/minutes'
import { toMinutes } from '../model/mapper'

/**
 * 회의록 본문. 정리가 끝난(`done`) 회의만 부른다. 팀원 누구나 제목과 발화를 고칠 수 있어(#551, §4.4.3) 끝난 회의록도
 * 바뀐다 — 다른 조회처럼 30초 뒤 오래된 것으로 본다 (D-192, D-136 의 「완료 회의록 상세 long」을 바꿨다).
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
  })
}
