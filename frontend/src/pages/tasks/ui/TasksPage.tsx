import { useCallback } from 'react'
import { useLocation, useSearchParams } from 'react-router'
import { useMemberWorkspace } from '@/entities/workspace'
import { todayInSeoul } from '@/shared/lib/date'
import { useGuardedNavigate } from '@/shared/lib/unsaved-changes'
import { useRouteId } from '@/shared/lib/url'
import { TaskBoard, boardSearch, readBoardQuery } from '@/widgets/task-board'
import type { BoardQuery } from '@/widgets/task-board'

/**
 * `/workspaces/:workspaceId/tasks` — 태스크 목록 (M6 §3). 라우트 조립만 한다.
 * 탭·날짜 조건은 URL(`tab`, `due`)이 정한다. 여기서 한 번 검증하고(D-132) 바꿀 때는 새 기록으로 쓴다 —
 * 새로고침·뒤로가기가 그 조건을 그대로 되살린다. 역할은 소속 목록의 role 이다. 소속은 RequireTeamMember 가 이미 확인했다.
 */
export function TasksPage() {
  const workspaceId = useRouteId('workspaceId')
  const workspace = useMemberWorkspace(workspaceId)
  const [searchParams] = useSearchParams()
  const { pathname } = useLocation()
  const navigate = useGuardedNavigate()
  const isPm = workspace?.role === 'pm'

  const onQueryChange = useCallback(
    (next: BoardQuery) => navigate({ pathname, search: boardSearch(searchParams, next) }),
    [navigate, pathname, searchParams],
  )

  if (workspaceId === null || workspace === null) return null
  return (
    <TaskBoard
      workspaceId={workspaceId}
      isPm={isPm}
      query={readBoardQuery(searchParams, isPm)}
      today={todayInSeoul()}
      onQueryChange={onQueryChange}
    />
  )
}
