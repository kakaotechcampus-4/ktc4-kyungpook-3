import type { QueryClient } from '@tanstack/react-query'
import { pendingApprovalListQueryOptions } from '@/entities/approval'
import { meetingListQueryOptions } from '@/entities/meeting'
import { memberListQueryOptions, recordMemberListQueryOptions } from '@/entities/member'
import { taskListQueryOptions } from '@/entities/task'

/**
 * 태스크 목록의 첫 화면 조회를 미리 받는다 (#536). 셸 탭이 여는 주소(`/tasks`, 조건 없음)의 기본 보기(리스트) 기준이다.
 * 이 파일은 화면 코드와 따로 부를 수 있는 입구다 — 셸이 정적으로 가져와도 태스크 화면이 첫 번들에 끼지 않는다.
 *
 * 화면(TaskBoard)과 같은 query options · 같은 규칙이다. 대기 승인은 PM 만, 회의 목록은 PM 이거나 캘린더 보기일 때만 받는다 —
 * 탭이 여는 기본 보기는 리스트라 PM 만 받는다. 이미 받은 값은 다시 받지 않고(`prefetchQuery`) 실패는 삼킨다.
 */
export async function prefetchTaskBoard(
  queryClient: QueryClient,
  { workspaceId, isPm }: { workspaceId: string; isPm: boolean },
): Promise<void> {
  await Promise.all([
    queryClient.prefetchQuery(taskListQueryOptions(workspaceId)),
    isPm ? queryClient.prefetchQuery(pendingApprovalListQueryOptions(workspaceId)) : null,
    queryClient.prefetchQuery(memberListQueryOptions(workspaceId)),
    queryClient.prefetchQuery(recordMemberListQueryOptions(workspaceId)),
    isPm ? queryClient.prefetchQuery(meetingListQueryOptions(workspaceId)) : null,
  ])
}
