import type { QueryClient } from '@tanstack/react-query'
import { pendingApprovalListQueryOptions } from '@/entities/approval'
import { extractionQueryOptions } from '@/entities/extraction'
import { meetingDetailQueryOptions } from '@/entities/meeting'
import { minutesQueryOptions } from '@/entities/minutes'

/**
 * 목록에서 회의를 고르기 직전(가리키기·포커스)에 그 회의록이 그릴 조회를 미리 받는다 — 고른 뒤 바로 그려 스켈레톤이 뜨지 않게.
 * 화면과 같은 query options 를 그대로 쓴다. 캐시에 쓰는 길은 그 공유 Query 하나다(직접 요청·`setQueryData` 없음, U4 r5).
 * 화면의 규칙을 그대로 따른다.
 * - 상세의 `workspaceId` 가 URL 공간과 같고 정리가 끝난 회의일 때만 회의록 본문·추출을 받는다 (U5-4)
 * - 승인 목록은 PM 이고 서버가 그 회의록에 확인 권한(`canReview`)을 줬을 때만 받는다. 일반 팀원은 받지 않는다 (U5-6)
 * 이미 받은 값은 다시 받지 않는다(`ensureQueryData` — 오래됐으면 그 값을 쓰고 뒤에서 새로 받는다).
 * 실패는 삼킨다. 미리 받기는 덤이라 화면이 고른 뒤 같은 Query 로 다시 묻고 그 오류를 그린다.
 */
export async function prefetchMinutes(
  queryClient: QueryClient,
  { workspaceId, meetingId, isPm }: { workspaceId: string; meetingId: string; isPm: boolean },
): Promise<void> {
  try {
    const meeting = await queryClient.ensureQueryData({
      ...meetingDetailQueryOptions(workspaceId, meetingId),
      revalidateIfStale: true,
    })
    if (meeting.workspaceId !== workspaceId || meeting.status !== 'done') return
    const extraction =
      meeting.extractionId === null
        ? null
        : queryClient.prefetchQuery(extractionQueryOptions(workspaceId, meeting.extractionId))
    const minutes = await queryClient.ensureQueryData({
      ...minutesQueryOptions(workspaceId, meeting.id),
      revalidateIfStale: true,
    })
    if (isPm && minutes.canReview)
      await queryClient.prefetchQuery(pendingApprovalListQueryOptions(workspaceId))
    await extraction
  } catch {
    // 미리 받기의 실패는 화면에 알리지 않는다 — 고른 뒤 화면의 조회가 다시 묻는다
  }
}
