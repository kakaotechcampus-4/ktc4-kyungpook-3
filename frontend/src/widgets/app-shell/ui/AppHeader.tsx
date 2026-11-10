import { NotificationBell } from '@/features/notifications'
import { QuickGuideButton } from '@/features/quick-guide'
import { paths } from '@/shared/config/routes'
import { useCompactScreen } from '@/shared/lib/compact-screen'
import { GuardedLink } from '@/shared/lib/unsaved-changes'
import { BrandMark } from '@/shared/ui/brand-mark'
import { Icon } from '@/shared/ui/icon'
import { Skeleton } from '@/shared/ui/skeleton'
import { SHELL_TABS, tabIntentHandlers } from '../model/shellTabs'
import type { ShellTabKey } from '../model/shellTabs'
import { UserMenu } from './UserMenu'
import { WorkspaceMenu } from './WorkspaceMenu'

/* design-system.md §7-11 · Main 캔버스: 76px 헤더 · 좌측 마크 + 탭(캔버스 5개, #551 의 프로젝트 맵까지 6개) · 우측 워크스페이스 메뉴 + 아바타.
   좌우 40px 은 가로로 눕힌 휴대폰의 안전 영역보다 좁아지지 않는다 */
const HEADER =
  'flex h-header shrink-0 items-center justify-between gap-24 border-b border-divider bg-surface pr-[max(40px,env(safe-area-inset-right))] pl-[max(40px,env(safe-area-inset-left))]'

/* 768px 미만(PwaDashboard): 탭은 아래 탭 막대로 내려가고 위에는 공간·안내·알림·계정만 남는다. 아래 선 없음, 좌우 20px.
   설치한 앱은 상태 표시줄 아래까지 그리므로 그만큼 위를 비운다 */
const COMPACT_HEADER =
  'flex h-[calc(56px+env(safe-area-inset-top))] shrink-0 items-center justify-between gap-12 bg-surface pt-[env(safe-area-inset-top)] pr-[max(20px,env(safe-area-inset-right))] pl-[max(20px,env(safe-area-inset-left))]'

const ACTIONS = 'flex items-center gap-24'

/* 알림 종(NotificationBell)과 같은 36px 아이콘 단추. 열린 동안 선택 면이다 */
const HELP =
  'inline-flex size-36 items-center justify-center rounded-9 text-ink hover:bg-surface-selected aria-expanded:bg-surface-selected'

/* 공간 메뉴는 왼쪽 끝, 안내 · 알림 · 아바타는 오른쪽이다. 공간 이름이 길면 공간 메뉴가 줄어든다 */
const COMPACT_ACTIONS = 'flex min-w-0 flex-1 items-center gap-8 [&>:first-child]:mr-auto'

/* 활성 탭: 선택 면 · 먹 · 600. 하단 바 없음 (§7-11) */
const TAB =
  'inline-flex h-36 items-center rounded-9 px-12 text-control leading-none font-semibold text-sub hover:text-ink aria-[current=page]:bg-surface-selected aria-[current=page]:text-ink'

export interface AppHeaderProps {
  workspaceId: string
  /** 탭에 다가간 순간(가리키기·포커스·터치). 셸이 그 화면의 코드와 첫 데이터를 미리 받는다 (#536) */
  onTabIntent?: (tab: ShellTabKey) => void
}

/**
 * 앱 셸의 헤더. 탭은 지금 공간의 화면으로만 간다. 모든 이동은 관문(GuardedLink)을 탄다.
 * 정리 중 신호는 헤더가 아니라 오른쪽 아래 진행 토스트가 갖는다 (#424)
 *
 * 768px 을 넘나들어도(회전·창 크기) 안내·알림·공간·계정 메뉴는 같은 부모 안에서 key 로 자리만 바꾼다 —
 * 다시 마운트되지 않아 열린 메뉴와 그 안의 포커스, 버튼의 포커스가 그대로 남는다.
 */
export function AppHeader({ workspaceId, onTabIntent }: AppHeaderProps) {
  const compact = useCompactScreen()

  const help = (
    <QuickGuideButton key="help" aria-label="도움말" className={HELP}>
      <Icon name="help" size={20} />
    </QuickGuideButton>
  )
  const bell = <NotificationBell key={`bell-${workspaceId}`} workspaceId={workspaceId} />
  const workspace = <WorkspaceMenu key="workspace" workspaceId={workspaceId} />
  const account = <UserMenu key="account" workspaceId={workspaceId} />

  return (
    <header className={compact ? COMPACT_HEADER : HEADER}>
      {compact ? null : (
        <div className="flex items-center gap-30">
          <GuardedLink
            to={paths.dashboard(workspaceId)}
            aria-label="Manager's Manager 대시보드"
            className="inline-flex"
          >
            <BrandMark />
          </GuardedLink>
          <nav aria-label="주요 화면" className="flex items-center gap-2">
            {SHELL_TABS.map(({ key, label, to }) => (
              <GuardedLink
                key={key}
                to={to(workspaceId)}
                className={TAB}
                {...tabIntentHandlers(onTabIntent && (() => onTabIntent(key)))}
              >
                {label}
              </GuardedLink>
            ))}
          </nav>
        </div>
      )}
      <div key="actions" className={compact ? COMPACT_ACTIONS : ACTIONS}>
        {compact ? [workspace, help, bell, account] : [help, bell, workspace, account]}
      </div>
    </header>
  )
}

/* 탭 글자 폭 — `대시보드` · `회의록` · `태스크` · `메시지` · `프로젝트 맵` · `팀` (13px 600 실측 근삿값) */
const TAB_SKELETON_WIDTHS = [52, 39, 39, 39, 68, 13]

/**
 * 헤더 자리의 뼈대 — 가드가 세션·소속을 기다리는 동안 앱 셸 틀(WorkspaceLayout)과 함께 그린다.
 * 진짜 헤더와 같은 상자라 헤더가 그려질 때 아래 화면이 내려가지 않는다 (UX1-M01).
 * 마크 · 탭 여섯 · 워크스페이스 메뉴 · 아바타 자리를 같은 크기로 둔다. 장식이라 통째로 aria-hidden 이고 header 랜드마크가 아니다 —
 * 기다리는 표시(aria-busy)는 아래 화면 뼈대가 진다.
 */
export function AppHeaderSkeleton() {
  const compact = useCompactScreen()
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
