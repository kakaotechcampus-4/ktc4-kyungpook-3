import type { QueryClient } from '@tanstack/react-query'
import { pendingApprovalListQueryOptions } from '@/entities/approval'
import { extractionQueryOptions } from '@/entities/extraction'
import { integrationsQueryOptions } from '@/entities/integration'
import { meetingDetailQueryOptions, meetingListQueryOptions } from '@/entities/meeting'
import { memberListQueryOptions } from '@/entities/member'
import { taskListQueryOptions } from '@/entities/task'
import { captureSessionScope } from '@/shared/api/sessionScope'
import { latestDoneMeeting } from './lib/dashboard'

/**
 * 대시보드의 첫 화면 조회를 미리 받는다 (#536). 셸이 탭에 다가간 순간·한가할 때 부른다.
 * 이 파일은 화면 코드와 따로 부를 수 있는 입구다 — 셸이 정적으로 가져와도 대시보드 화면이 첫 번들에 끼지 않는다.
 *
 * 화면(useDashboardData)과 같은 query options 를 그대로 쓴다. 규칙도 같다.
 * - 태스크·대기 승인(PM 만)·팀원·연동·회의 목록은 함께 받는다
 * - 최근 반영은 회의 목록 → 최신 완료 회의 상세 → 추출 순서로만 알 수 있어 그 순서로 받는다
 * 이미 받은 값은 다시 받지 않는다. 다음 조회를 정하는 회의 목록·상세는 `fetchQuery` 로 받는다 — 오래된 캐시면 새 값을 기다려
 * 화면이 고를 회의·추출을 고른다. 시작할 때 잡은 세션이 그 사이 끝났으면 다음 조회를 시작하지 않는다.
 * 실패는 삼킨다 — 화면이 뜨면 같은 Query 가 다시 묻고 그 오류를 그린다.
 */
export async function prefetchDashboard(
  queryClient: QueryClient,
  { workspaceId, isPm }: { workspaceId: string; isPm: boolean },
): Promise<void> {
  const session = captureSessionScope()
  const lists = Promise.all([
    queryClient.prefetchQuery(taskListQueryOptions(workspaceId)),
    isPm ? queryClient.prefetchQuery(pendingApprovalListQueryOptions(workspaceId)) : null,
    queryClient.prefetchQuery(memberListQueryOptions(workspaceId)),
    queryClient.prefetchQuery(integrationsQueryOptions(workspaceId)),
  ])
  try {
    const meetings = await queryClient.fetchQuery(meetingListQueryOptions(workspaceId))
    const latest = latestDoneMeeting(meetings)
    if (session.isCurrent() && latest !== null) {
      const meeting = await queryClient.fetchQuery(
        meetingDetailQueryOptions(workspaceId, latest.id),
      )
      if (session.isCurrent() && meeting.extractionId !== null)
        await queryClient.prefetchQuery(extractionQueryOptions(workspaceId, meeting.extractionId))
    }
  } catch {
    // 미리 받기의 실패는 알리지 않는다 — 화면의 조회가 다시 묻는다
  }
  await lists
}
