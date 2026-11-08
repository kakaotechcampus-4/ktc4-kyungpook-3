import type { QueryClient } from '@tanstack/react-query'
import { pendingApprovalListQueryOptions } from '@/entities/approval'
import { extractionQueryOptions } from '@/entities/extraction'
import { meetingDetailQueryOptions } from '@/entities/meeting'
import { minutesQueryOptions } from '@/entities/minutes'
import { captureSessionScope } from '@/shared/api/sessionScope'
import type { SessionScope } from '@/shared/api/sessionScope'

/**
 * 목록에서 회의를 고르기 직전(가리키기·포커스)에 그 회의록이 그릴 조회를 미리 받는다 — 고른 뒤 바로 그려 스켈레톤이 뜨지 않게.
 * 셸의 회의록 탭 미리 받기도 기본 회의에 이것을 쓴다 (#536).
 * 화면과 같은 query options 를 그대로 쓴다. 캐시에 쓰는 길은 그 공유 Query 하나다(직접 요청·`setQueryData` 없음, U4 r5).
 * 화면의 규칙을 그대로 따른다.
 * - 상세를 받았고 정리가 끝난 회의일 때만 회의록 본문·추출을 받는다 (U5-4)
 * - 승인 목록은 PM 이고 서버가 그 회의록에 확인 권한(`canReview`)을 줬을 때만 받는다. 일반 팀원은 받지 않는다 (U5-6)
 * 다음 조회를 정하는 상세·회의록은 `fetchQuery` 로 받는다 — 신선한 값은 그대로 쓰고, 오래됐으면 새 값을 기다려 그 값으로 정한다.
 * 그 사이 세션이 끝났으면(`session`, 부른 쪽이 잡은 범위) 다음 조회를 시작하지 않는다 — 세션을 끝내는 코드는 진행 중인 조회만 거둔다.
 * 실패는 삼킨다. 미리 받기는 덤이라 화면이 고른 뒤 같은 Query 로 다시 묻고 그 오류를 그린다.
 */
export async function prefetchMinutes(
  queryClient: QueryClient,
  {
    workspaceId,
    meetingId,
    isPm,
    session = captureSessionScope(),
  }: { workspaceId: string; meetingId: string; isPm: boolean; session?: SessionScope },
): Promise<void> {
  try {
    const meeting = await queryClient.fetchQuery(meetingDetailQueryOptions(workspaceId, meetingId))
    if (!session.isCurrent() || meeting.status !== 'done') return
    const extraction =
      meeting.extractionId === null
        ? null
        : queryClient.prefetchQuery(extractionQueryOptions(workspaceId, meeting.extractionId))
    const minutes = await queryClient.fetchQuery(minutesQueryOptions(workspaceId, meeting.id))
    if (!session.isCurrent()) return
    if (isPm && minutes.canReview)
      await queryClient.prefetchQuery(pendingApprovalListQueryOptions(workspaceId))
    await extraction
  } catch {
    // 미리 받기의 실패는 화면에 알리지 않는다 — 고른 뒤 화면의 조회가 다시 묻는다
  }
}
