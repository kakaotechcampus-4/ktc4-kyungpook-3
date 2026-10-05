import { Fragment } from 'react'
import { Outlet } from 'react-router'
import { useRouteId } from '@/shared/lib/url'
import { AppHeader } from '@/widgets/app-shell'

/**
 * 워크스페이스 안 화면의 앱 셸 — Main 캔버스의 헤더(마크 · 5개 탭 · 워크스페이스 메뉴 · 계정 메뉴) 아래에 화면을 그린다.
 * 다른 마일스톤의 임시 화면도 이 셸 안에 있다. 헤더는 부팅 조회(세션·목록)만 쓰고 업무 API 를 부르지 않는다.
 */
export function WorkspaceLayout() {
  const workspaceId = useRouteId('workspaceId')
  if (workspaceId === null) return null

  return (
    <div className="flex min-h-dvh flex-col bg-surface">
      <AppHeader workspaceId={workspaceId} />
      {/* 공간이 바뀌면 화면을 새로 마운트한다. 이전 공간의 화면 상태가 새 공간으로 넘어가지 않는다 */}
      <Fragment key={workspaceId}>
        <Outlet />
      </Fragment>
    </div>
  )
}
