import { queryOptions } from '@tanstack/react-query'
import { request } from '@/shared/api/client'
import { ApiError, createWorkspaceMismatchError, isWorkspaceMismatch } from '@/shared/api/errors'
import { STALE_TIME } from '@/shared/api/queryClient'
import { workspaceKey } from '@/shared/api/queryKeys'
import type { ListDto } from '@/shared/types/api/envelope'
import type { MeetingDto, MeetingSummaryDto } from '@/shared/types/api/meeting'
import { toMeeting, toMeetingSummary } from '../model/mapper'
import type { Meeting, MeetingSummary } from '../model/types'

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
 * 회의록 목록. 서버가 `started_at` 내림차순으로 준다. 실패 중 수동 업로드의 화자 지정 만료만 남긴다 (#256).
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
 * 경로에 워크스페이스가 없다(봇 경로, 계약 §2.3). key 에는 요청한 화면의 워크스페이스를 넣고, 응답의 공간이 그와 다르면
 * 성공 데이터로 돌려주지 않고 `WORKSPACE_MISMATCH`(`isWorkspaceMismatch`)로 던진다 — 캐시의 회의는 언제나 key 의 공간 것이다.
 * 받아 둔 정상 상세는 그 실패로 덮이지 않는다(TanStack Query 는 실패에 data 를 지우지 않는다)
 */
export function meetingDetailQueryOptions(workspaceId: string, meetingId: string) {
  return queryOptions({
    queryKey: workspaceKey(workspaceId, 'meetings', 'detail', meetingId),
    queryFn: async ({ signal }) => {
      const dto = await request<MeetingDto>(`/meetings/${encodeURIComponent(meetingId)}`, {
        signal,
      })
      if (dto.workspace_id !== workspaceId)
        throw createWorkspaceMismatchError(workspaceId, dto.workspace_id)
      return toMeeting(dto)
    },
  })
}

/** 접근 권한을 잃었거나(403) 회의가 없다(404). 다시 물어도 같다 — 일시적 실패가 아니다 */
export function isAccessLost(error: unknown): boolean {
  return error instanceof ApiError && error.kind === 'http' && [403, 404].includes(error.status)
}

/** 회의가 지워졌다(404) */
export function isMeetingGone(error: unknown): boolean {
  return error instanceof ApiError && error.kind === 'http' && error.status === 404
}

export function isMeetingUnavailable(error: unknown): boolean {
  return isAccessLost(error) || isWorkspaceMismatch(error)
}

/**
 * 화면이 그려도 되는 상세. 볼 수 없는 회의라는 답(403·404, 다른 공간)을 받았으면 받아 둔 정상 상세가 있어도 그리지 않는다 —
 * TanStack Query 는 다시 받기가 실패해도 이전 data 를 남긴다. 그 회의를 다루는 화면·후속 조회를 끈다 (#349, #405).
 * 처리 추적기는 이것을 쓰지 않는다(trackerOutcome)
 */
export function viewableMeeting({
  data,
  error,
}: {
  data: Meeting | undefined
  error: unknown
}): Meeting | null {
  return data === undefined || isMeetingUnavailable(error) ? null : data
}
