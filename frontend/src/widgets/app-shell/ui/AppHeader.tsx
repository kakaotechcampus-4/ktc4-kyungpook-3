import { Fragment } from 'react'
import { paths } from '@/shared/config/routes'
import { GuardedLink } from '@/shared/lib/unsaved-changes'
import { BrandMark } from '@/shared/ui/brand-mark'
import { Skeleton } from '@/shared/ui/skeleton'
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

/* `정리 중` 링크 — 탭과 같은 단에 먹 점 하나. 회전하지 않는다(공통 UI 는 스피너를 쓰지 않는다) */
const PROCESSING_DOT = 'size-6 shrink-0 rounded-999 bg-ink'

export interface AppHeaderProps {
  workspaceId: string
  /**
   * 이 공간에서 정리 중인 회의의 처리 화면 경로. 있을 때만 회의록 탭 옆에 `정리 중` 링크를 그린다 (U4-9).
   * 무엇이 정리 중인지는 앱 계층이 처리 추적에서 읽어 넘긴다 — 헤더는 추적기를 모른다 (G4)
   */
  processingHref?: string | null
}

/** 앱 셸의 헤더. 탭은 지금 공간의 화면으로만 간다. 모든 이동은 관문(GuardedLink)을 탄다 */
export function AppHeader({ workspaceId, processingHref = null }: AppHeaderProps) {
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
            <Fragment key={label}>
              <GuardedLink to={to(workspaceId)} className={TAB}>
                {label}
              </GuardedLink>
              {label === '회의록' && processingHref !== null ? (
                <GuardedLink to={processingHref} className={`${TAB} gap-7`}>
                  <span aria-hidden="true" className={PROCESSING_DOT} />
                  정리 중
                </GuardedLink>
              ) : null}
            </Fragment>
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

/* 탭 글자 폭 — `대시보드` · `회의록` · `태스크` · `메시지` · `팀` (13px 600 실측 근삿값) */
const TAB_SKELETON_WIDTHS = [52, 39, 39, 39, 13]

/**
 * 헤더 자리의 뼈대 — 가드가 세션·소속을 기다리는 동안 앱 셸 틀(WorkspaceLayout)과 함께 그린다.
 * 진짜 헤더와 같은 `HEADER` 상자(76px · 아래 선)라 헤더가 그려질 때 아래 화면이 내려가지 않는다 (UX1-M01).
 * 마크 · 탭 다섯 · 워크스페이스 메뉴 · 아바타 자리를 같은 크기로 둔다. 장식이라 통째로 aria-hidden 이고 header 랜드마크가 아니다 —
 * 기다리는 표시(aria-busy)는 아래 화면 뼈대가 진다.
 */
export function AppHeaderSkeleton() {
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
