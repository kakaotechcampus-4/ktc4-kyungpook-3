import { useSearchParams } from 'react-router'
import { PROJECT_MAP_PARAMS } from '@/shared/config/routes'
import { useCompactScreen } from '@/shared/lib/compact-screen'
import { useRouteId } from '@/shared/lib/url'
import { ProjectMapView } from '@/widgets/project-map'
import type { MapViewKind } from '@/widgets/project-map'

function parseView(value: string | null): MapViewKind | null {
  return value === 'graph' || value === 'list' ? value : null
}

/**
 * `/workspaces/:workspaceId/project-map` — 프로젝트 맵 (#551). 라우트 조립만 한다. 팀원 모두 본다.
 * 보기(그래프·목록)는 주소의 `view` 가 쥔다 — 뒤로 가기·새로고침에도 남는다. 고르기 전에는 휴대폰은 목록, 넓은 화면은 그래프다.
 * 탭을 바꿀 때는 기록을 쌓지 않는다
 */
export function ProjectMapPage() {
  const workspaceId = useRouteId('workspaceId')
  const compact = useCompactScreen()
  const [searchParams, setSearchParams] = useSearchParams()
  if (workspaceId === null) return null

  const view = parseView(searchParams.get(PROJECT_MAP_PARAMS.view)) ?? (compact ? 'list' : 'graph')
  return (
    <ProjectMapView
      key={workspaceId}
      workspaceId={workspaceId}
      view={view}
      compact={compact}
      onViewChange={(next) =>
        setSearchParams(
          (current) => {
            const params = new URLSearchParams(current)
            params.set(PROJECT_MAP_PARAMS.view, next)
            return params
          },
          { replace: true },
        )
      }
    />
  )
}
