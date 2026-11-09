import { Fragment } from 'react'
import type { ReactNode } from 'react'
import { Outlet } from 'react-router'
import { useMemberWorkspace } from '@/entities/workspace'
import { ProcessingToast, useProcessingDiscovery } from '@/features/meeting-processing'
import { useCompactScreen, useShellChromeHidden } from '@/shared/lib/compact-screen'
import { useRouteId } from '@/shared/lib/url'
import { usePinnedToastReserve } from '@/shared/ui/toast'
import { AppHeader, AppHeaderSkeleton, BottomTabBar } from '@/widgets/app-shell'
import { useShellPrefetch } from '../shellPrefetch'

/** 앱 셸 틀 — 헤더 아래에 화면이 세로로 이어진다. 가드 대기 뼈대(WorkspaceShellSkeleton)도 같은 틀이다 */
const SHELL = 'flex min-h-dvh flex-col bg-surface'

/**
 * 워크스페이스 안 화면의 앱 셸 — Main 캔버스의 헤더(마크 · 5개 탭 · 워크스페이스 메뉴 · 계정 메뉴) 아래에 화면을 그린다.
 * 768px 미만은 탭이 아래 탭 막대로 내려간다 (D-180). 다른 마일스톤의 임시 화면도 이 셸 안에 있다.
 *
 * M5 부터 지금 공간의 회의 목록을 한 번 받아 정리 중 회의를 처리 추적에 등록한다 (U4-1, U4-2).
 * 그 추적 상태는 오른쪽 아래 진행 토스트가 지금 공간 것만 그린다 (#424, D-088).
 *
 * 셸 탭의 화면 코드와 첫 화면 데이터를 미리 받는다 — 탭에 다가간 순간 그 탭을, 셸이 뜬 뒤 한가할 때 탭 모두를 (#536).
 * 처음 옮기는 탭도 빈 자리·뼈대 없이 바로 그려진다.
 */
export function WorkspaceLayout() {
  const workspaceId = useRouteId('workspaceId')
  if (workspaceId === null) return null
  return <WorkspaceShell workspaceId={workspaceId} />
}

function WorkspaceShell({ workspaceId }: { workspaceId: string }) {
  useProcessingDiscovery(workspaceId)
  // 오른쪽 아래 진행 토스트가 있는 동안 본문 아래를 그 높이만큼 비운다 — 본문 끝의 버튼을 스크롤로 꺼낼 수 있다 (#424).
  // 아래 탭 막대가 있으면 그 높이도 더한다. 막대가 없으면 `--bottom-tab-bar` 는 0 이다
  const reserve = usePinnedToastReserve()
  const compact = useCompactScreen()
  // 휴대폰의 메시지 상세처럼 화면 전체를 쓰는 화면은 헤더와 탭 막대를 걷는다(PwaThreadMember). 막대가 없으면 `--bottom-tab-bar` 도 0 이다
  const chromeHidden = useShellChromeHidden()
  // 역할은 소속 목록의 role 이다. 소속은 RequireTeamMember 가 이미 확인했다
  const isPm = useMemberWorkspace(workspaceId)?.role === 'pm'
  const prefetchTab = useShellPrefetch({ workspaceId, isPm, compact })

  return (
    <div className={SHELL} style={{ paddingBottom: `calc(${reserve}px + var(--bottom-tab-bar))` }}>
      {chromeHidden ? null : <AppHeader workspaceId={workspaceId} onTabIntent={prefetchTab} />}
      {/* 공간이 바뀌면 화면을 새로 마운트한다. 이전 공간의 화면 상태가 새 공간으로 넘어가지 않는다 */}
      <Fragment key={workspaceId}>
        <Outlet />
      </Fragment>
      <ProcessingToast workspaceId={workspaceId} />
      {compact && !chromeHidden ? (
        <BottomTabBar workspaceId={workspaceId} onTabIntent={prefetchTab} />
      ) : null}
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
