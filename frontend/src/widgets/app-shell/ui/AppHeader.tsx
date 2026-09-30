import { paths } from '@/shared/config/routes'
import { GuardedLink } from '@/shared/lib/unsaved-changes'
import { BrandMark } from '@/shared/ui/brand-mark'
import { UserMenu } from './UserMenu'
import { WorkspaceMenu } from './WorkspaceMenu'

/* design-system.md §7-11 · Main 캔버스: 76px 헤더 · 좌측 마크 + 탭 5개 · 우측 워크스페이스 메뉴 + 아바타.
   탭 뒤의 개수 배지(`태스크 3`)는 집계 API 가 필요해 두지 않는다 (M4 는 집계를 요청하지 않는다) */
const TABS = [
  { label: '대시보드', to: paths.dashboard },
  { label: '회의록', to: (workspaceId: string) => paths.meetings(workspaceId) },
  { label: '태스크', to: (workspaceId: string) => paths.tasks(workspaceId) },
  { label: '메시지', to: paths.messages },
  { label: '팀', to: paths.members },
] as const

const HEADER =
  'flex h-header shrink-0 items-center justify-between gap-24 border-b border-divider bg-surface px-40'

/* 활성 탭: 선택 면 · 먹 · 600. 하단 바 없음 (§7-11) */
const TAB =
  'inline-flex h-36 items-center rounded-9 px-12 text-control leading-none font-semibold text-sub hover:text-ink aria-[current=page]:bg-surface-selected aria-[current=page]:text-ink'

export interface AppHeaderProps {
  workspaceId: string
}

/** 앱 셸의 헤더. 탭은 지금 공간의 화면으로만 간다. 모든 이동은 관문(GuardedLink)을 탄다 */
export function AppHeader({ workspaceId }: AppHeaderProps) {
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
          {TABS.map(({ label, to }) => (
            <GuardedLink key={label} to={to(workspaceId)} className={TAB}>
              {label}
            </GuardedLink>
          ))}
        </nav>
      </div>
      <div className="flex items-center gap-24">
        <WorkspaceMenu workspaceId={workspaceId} />
        <UserMenu />
      </div>
    </header>
  )
}
