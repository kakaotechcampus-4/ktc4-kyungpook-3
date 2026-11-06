import { NotificationBell } from '@/features/notifications'
import { paths } from '@/shared/config/routes'
import { GuardedLink } from '@/shared/lib/unsaved-changes'
import { BrandMark } from '@/shared/ui/brand-mark'
import { Skeleton } from '@/shared/ui/skeleton'
import { SHELL_TABS, useCompactShell } from '../model/shellTabs'
import { UserMenu } from './UserMenu'
import { WorkspaceMenu } from './WorkspaceMenu'

/* design-system.md §7-11 · Main 캔버스: 76px 헤더 · 좌측 마크 + 탭 5개 · 우측 워크스페이스 메뉴 + 아바타 */
const HEADER =
  'flex h-header shrink-0 items-center justify-between gap-24 border-b border-divider bg-surface px-40'

/* 768px 미만(PwaDashboard): 탭은 아래 탭 막대로 내려가고 위에는 공간·알림·계정만 남는다. 아래 선 없음, 좌우 20px.
   설치한 앱은 상태 표시줄 아래까지 그리므로 그만큼 위를 비운다 */
const COMPACT_HEADER =
  'flex h-[calc(56px+env(safe-area-inset-top))] shrink-0 items-center justify-between gap-12 bg-surface px-20 pt-[env(safe-area-inset-top)]'

/* 활성 탭: 선택 면 · 먹 · 600. 하단 바 없음 (§7-11) */
const TAB =
  'inline-flex h-36 items-center rounded-9 px-12 text-control leading-none font-semibold text-sub hover:text-ink aria-[current=page]:bg-surface-selected aria-[current=page]:text-ink'

export interface AppHeaderProps {
  workspaceId: string
}

/**
 * 앱 셸의 헤더. 탭은 지금 공간의 화면으로만 간다. 모든 이동은 관문(GuardedLink)을 탄다.
 * 정리 중 신호는 헤더가 아니라 오른쪽 아래 진행 토스트가 갖는다 (#424)
 */
export function AppHeader({ workspaceId }: AppHeaderProps) {
  const compact = useCompactShell()
  if (compact) {
    return (
      <header className={COMPACT_HEADER}>
        <div className="min-w-0 flex-1">
          <WorkspaceMenu workspaceId={workspaceId} />
        </div>
        <div className="flex shrink-0 items-center gap-8">
          <NotificationBell key={workspaceId} workspaceId={workspaceId} />
          <UserMenu workspaceId={workspaceId} />
        </div>
      </header>
    )
  }
  return (
    <header className={HEADER}>
      <div className="flex items-center gap-30">
        <GuardedLink
          to={paths.dashboard(workspaceId)}
          aria-label="Manager's Manager 대시보드"
          className="inline-flex"
        >
          <BrandMark />
        </GuardedLink>
        <nav aria-label="주요 화면" className="flex items-center gap-2">
          {SHELL_TABS.map(({ label, to }) => (
            <GuardedLink key={label} to={to(workspaceId)} className={TAB}>
              {label}
            </GuardedLink>
          ))}
        </nav>
      </div>
      <div className="flex items-center gap-24">
        <NotificationBell key={workspaceId} workspaceId={workspaceId} />
        <WorkspaceMenu workspaceId={workspaceId} />
        <UserMenu workspaceId={workspaceId} />
      </div>
    </header>
  )
}

/* 탭 글자 폭 — `대시보드` · `회의록` · `태스크` · `메시지` · `팀` (13px 600 실측 근삿값) */
const TAB_SKELETON_WIDTHS = [52, 39, 39, 39, 13]

/**
 * 헤더 자리의 뼈대 — 가드가 세션·소속을 기다리는 동안 앱 셸 틀(WorkspaceLayout)과 함께 그린다.
 * 진짜 헤더와 같은 상자라 헤더가 그려질 때 아래 화면이 내려가지 않는다 (UX1-M01).
 * 마크 · 탭 다섯 · 워크스페이스 메뉴 · 아바타 자리를 같은 크기로 둔다. 장식이라 통째로 aria-hidden 이고 header 랜드마크가 아니다 —
 * 기다리는 표시(aria-busy)는 아래 화면 뼈대가 진다.
 */
export function AppHeaderSkeleton() {
  const compact = useCompactShell()
  if (compact) {
    return (
      <div aria-hidden="true" data-testid="app-header-skeleton" className={COMPACT_HEADER}>
        <Skeleton variant="block" width={140} height={36} className="rounded-9" />
        <Skeleton variant="circle" width={29} height={29} />
      </div>
    )
  }
  return (
    <div aria-hidden="true" data-testid="app-header-skeleton" className={HEADER}>
      <div className="flex items-center gap-30">
        <Skeleton variant="block" width={24} height={24} className="rounded-7" />
        <div className="flex items-center gap-2">
          {TAB_SKELETON_WIDTHS.map((width, index) => (
            <div key={index} className="inline-flex h-36 items-center px-12">
              <Skeleton width={width} />
            </div>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-24">
        <Skeleton variant="block" width={140} height={36} className="rounded-9" />
        <Skeleton variant="circle" width={29} height={29} />
      </div>
    </div>
  )
}
