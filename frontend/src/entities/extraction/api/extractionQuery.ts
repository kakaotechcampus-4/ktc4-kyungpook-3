import { queryOptions } from '@tanstack/react-query'
import { request } from '@/shared/api/client'
import { STALE_TIME } from '@/shared/api/queryClient'
import { workspaceKey } from '@/shared/api/queryKeys'
import type { ExtractionDto } from '@/shared/types/api/extraction'
import { toExtraction } from '../model/mapper'

/**
 * 추출 결과. 회의 상세의 `extractionId` 로 부른다 — `done` 일 때만 채워진다 (계약 §2.3).
 * 승인되면 항목의 `task_id` 가 바뀌므로 기본 최신 시간(30초)을 쓴다.
 * 경로에 워크스페이스가 없지만 key 에는 넣는다. 공간마다 캐시가 따로다.
 */
export function extractionQueryOptions(workspaceId: string, extractionId: string) {
  return queryOptions({
    queryKey: workspaceKey(workspaceId, 'extractions', extractionId),
    queryFn: async ({ signal }) =>
      toExtraction(
        await request<ExtractionDto>(`/extractions/${encodeURIComponent(extractionId)}`, {
          signal,
        }),
      ),
    staleTime: STALE_TIME.default,
  })
}
