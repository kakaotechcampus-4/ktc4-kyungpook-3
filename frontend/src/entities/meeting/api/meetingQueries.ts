import { queryOptions } from '@tanstack/react-query'
import { request } from '@/shared/api/client'
import { STALE_TIME } from '@/shared/api/queryClient'
import { workspaceKey } from '@/shared/api/queryKeys'
import type { ListDto } from '@/shared/types/api/envelope'
import type { MeetingDto, MeetingSummaryDto } from '@/shared/types/api/meeting'
import { toMeeting, toMeetingSummary } from '../model/mapper'
import type { MeetingSummary } from '../model/types'

/** 회의 캐시 전체의 접두어. 정리가 끝나면 이 key 로 목록·상세를 함께 무효화한다 */
export function meetingKeys(workspaceId: string) {
  return workspaceKey(workspaceId, 'meetings')
}

/**
 * 회의록 목록을 한 번 받는다. 목록 Query 의 `queryFn` 이다. 「지금 서버의 목록」이 꼭 필요한 판정(업로드 응답 유실 복구)도
 * 이것을 직접 부르지 않고 `meetingListQueryOptions` 의 공유 Query 를 `fetchFresh` 로 묻는다 — 직접 요청이 공유 조회와 같은
 * 캐시에 쓰면 도착 순서에 따라 오래된 답이 새 답을 덮었다 (U4 r5 개정, docs/impl-decision/2026-10-03-processing-tracker.md)
 */
export async function fetchMeetingList(
  workspaceId: string,
  signal?: AbortSignal,
): Promise<MeetingSummary[]> {
  const { items } = await request<ListDto<MeetingSummaryDto>>(
    `/workspaces/${encodeURIComponent(workspaceId)}/meetings`,
    { signal },
  )
  return items.map(toMeetingSummary)
}

/**
 * 회의록 목록. 서버가 `started_at` 내림차순으로 주고 실패 회의를 뺀다 (계약 §4.4, D-093, D-106).
 * 처리 중 회의도 함께 온다 — 처리 추적이 여기서 처리 중 회의를 발견한다. 기본 최신 시간(30초)이다.
 */
export function meetingListQueryOptions(workspaceId: string) {
  return queryOptions({
    queryKey: workspaceKey(workspaceId, 'meetings', 'list'),
    queryFn: ({ signal }) => fetchMeetingList(workspaceId, signal),
    staleTime: STALE_TIME.default,
  })
}

/**
 * 회의 상세. 처리 상태와 `progress` 를 읽는다 — 처리 추적의 polling 대상이다.
 * 경로에 워크스페이스가 없다(봇 경로, 계약 §2.3). 응답의 `workspaceId` 가 URL 과 같은지는 호출자가 확인한다.
 * key 에는 요청한 화면의 워크스페이스를 넣어 공간이 바뀌면 캐시가 섞이지 않게 한다.
 */
export function meetingDetailQueryOptions(workspaceId: string, meetingId: string) {
  return queryOptions({
    queryKey: workspaceKey(workspaceId, 'meetings', 'detail', meetingId),
    queryFn: async ({ signal }) =>
      toMeeting(
        await request<MeetingDto>(`/meetings/${encodeURIComponent(meetingId)}`, { signal }),
      ),
  })
}
