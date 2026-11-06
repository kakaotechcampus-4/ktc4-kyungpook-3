import { Fragment } from 'react'
import type { ReactNode } from 'react'
import { Outlet } from 'react-router'
import { ProcessingToast, useProcessingDiscovery } from '@/features/meeting-processing'
import { useRouteId } from '@/shared/lib/url'
import { usePinnedToastReserve } from '@/shared/ui/toast'
import { AppHeader, AppHeaderSkeleton } from '@/widgets/app-shell'

/** 앱 셸 틀 — 헤더 아래에 화면이 세로로 이어진다. 가드 대기 뼈대(WorkspaceShellSkeleton)도 같은 틀이다 */
const SHELL = 'flex min-h-dvh flex-col bg-surface'

/**
 * 워크스페이스 안 화면의 앱 셸 — Main 캔버스의 헤더(마크 · 5개 탭 · 워크스페이스 메뉴 · 계정 메뉴) 아래에 화면을 그린다.
 * 다른 마일스톤의 임시 화면도 이 셸 안에 있다.
 *
 * M5 부터 지금 공간의 회의 목록을 한 번 받아 정리 중 회의를 처리 추적에 등록한다 (U4-1, U4-2).
 * 그 추적 상태는 오른쪽 아래 진행 토스트가 지금 공간 것만 그린다 (#424, D-088).
 */
export function WorkspaceLayout() {
  const workspaceId = useRouteId('workspaceId')
  if (workspaceId === null) return null
  return <WorkspaceShell workspaceId={workspaceId} />
}

function WorkspaceShell({ workspaceId }: { workspaceId: string }) {
  useProcessingDiscovery(workspaceId)
  // 오른쪽 아래 진행 토스트가 있는 동안 본문 아래를 그 높이만큼 비운다 — 본문 끝의 버튼을 스크롤로 꺼낼 수 있다 (#424)
  const reserve = usePinnedToastReserve()

  return (
    <div className={SHELL} style={reserve > 0 ? { paddingBottom: reserve } : undefined}>
      <AppHeader workspaceId={workspaceId} />
      {/* 공간이 바뀌면 화면을 새로 마운트한다. 이전 공간의 화면 상태가 새 공간으로 넘어가지 않는다 */}
      <Fragment key={workspaceId}>
        <Outlet />
      </Fragment>
      <ProcessingToast workspaceId={workspaceId} />
    </div>
  )
}

/**
 * 가드(세션·소속)를 기다리는 동안의 앱 셸 — 진짜 셸과 같은 틀에 헤더 뼈대를 두고 그 아래에 화면 뼈대를 그린다.
 * 가드는 셸 바깥 칸이라 이 자리가 없으면 헤더 없이 화면 맨 위부터 뼈대가 앉고, 셸이 뜰 때 헤더 높이(76px)만큼 통째로 내려간다 (UX1-M01).
 */
export function WorkspaceShellSkeleton({ children }: { children: ReactNode }) {
  return (
    <div className={SHELL}>
      <AppHeaderSkeleton />
      {children}
    </div>
  )
}
