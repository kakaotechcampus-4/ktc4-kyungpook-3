import { useCallback } from 'react'
import { useLocation, useSearchParams } from 'react-router'
import { useMemberWorkspace } from '@/entities/workspace'
import { useCompactScreen } from '@/shared/lib/compact-screen'
import { todayInSeoul } from '@/shared/lib/date'
import { useGuardedNavigate } from '@/shared/lib/unsaved-changes'
import { useRouteId } from '@/shared/lib/url'
import {
  TaskBoard,
  boardSearch,
  readBoardQuery,
  readViewQuery,
  viewSearch,
} from '@/widgets/task-board'
import type { BoardQuery, ViewQuery } from '@/widgets/task-board'

/**
 * `/workspaces/:workspaceId/tasks` — 태스크 목록 (M6 §3). 라우트 조립만 한다.
 * 탭·날짜 조건(`tab`, `due`)과 보기·담당자·기간·정렬·휴대폰 보드의 칸(`view`, `assignee`, `month`, `from`, `period`, `sort`,
 * `column`)은 URL 이 정한다. 여기서 한 번 검증하고(D-132) 바꿀 때는 새 기록으로 쓴다 — 새로고침·뒤로가기가 그 조건을 그대로 되살린다.
 * 위젯이 사용자의 선택이 아닌 변경(폭이 바뀌어 포커스를 따라 고른 칸)이라고 알리면 지금 기록을 고친다.
 * 역할은 소속 목록의 role 이다. 소속은 RequireTeamMember 가 이미 확인했다.
 */
export function TasksPage() {
  const workspaceId = useRouteId('workspaceId')
  const workspace = useMemberWorkspace(workspaceId)
  const [searchParams] = useSearchParams()
  const { pathname } = useLocation()
  const navigate = useGuardedNavigate()
  const isPm = workspace?.role === 'pm'
  const compact = useCompactScreen()

  const onQueryChange = useCallback(
    (next: BoardQuery) => navigate({ pathname, search: boardSearch(searchParams, next) }),
    [navigate, pathname, searchParams],
  )
  const onViewChange = useCallback(
    (next: ViewQuery, options?: { replace?: boolean }) =>
      navigate({ pathname, search: viewSearch(searchParams, next) }, options),
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
      view={readViewQuery(searchParams)}
      onViewChange={onViewChange}
      compact={compact}
    />
  )
}
