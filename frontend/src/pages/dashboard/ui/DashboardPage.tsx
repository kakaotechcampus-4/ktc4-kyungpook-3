import { useMemberWorkspace } from '@/entities/workspace'
import { paths } from '@/shared/config/routes'
import { todayInSeoul } from '@/shared/lib/date'
import { useRouteId } from '@/shared/lib/url'
import { Dashboard } from '@/widgets/dashboard'
import { boardSearch } from '@/widgets/task-board'

const NO_PARAMS = new URLSearchParams()

/**
 * `/workspaces/:workspaceId/dashboard` — 대시보드 (M7). 라우트 조립만 한다. 온보딩이 끝나는 곳이다(D-013).
 * 태스크 목록으로 가는 두 주소는 목록의 URL 규칙(`boardSearch`)으로 만든다 — 대시보드가 목록 조건을 따로 적지 않는다.
 * 역할은 소속 목록의 role 이다. 공간이 바뀌면 key 로 화면 상태(열린 확인 모달·되돌리기 결과)를 새로 시작한다.
 */
export function DashboardPage() {
  const workspaceId = useRouteId('workspaceId')
  const workspace = useMemberWorkspace(workspaceId)
  if (workspaceId === null || workspace === null) return null

  const tasks = paths.tasks(workspaceId)
  return (
    <Dashboard
      key={workspaceId}
      workspaceId={workspaceId}
      isPm={workspace.role === 'pm'}
      today={todayInSeoul()}
      needsReviewHref={`${tasks}${boardSearch(NO_PARAMS, { tab: 'needs_review', due: [] })}`}
      dueSoonHref={`${tasks}${boardSearch(NO_PARAMS, { tab: 'in_progress', due: ['overdue', 'soon'] })}`}
    />
  )
}
