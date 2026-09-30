import { paths } from '@/shared/config/routes'
import { GuardedLink } from '@/shared/lib/unsaved-changes'
import { BrandMark } from '@/shared/ui/brand-mark'
import { UserMenu, WorkspaceChoiceList } from '@/widgets/app-shell'

const TOP = 'flex h-header shrink-0 items-center justify-between border-b border-divider px-40'

const COLUMN = 'mx-auto flex w-full max-w-[480px] flex-col gap-24 px-24 pt-64 pb-72'

/**
 * 워크스페이스 선택 (D-010). 공간이 여럿인 사용자의 로그인 뒤 첫 화면이다. 전용 캔버스가 없어 Main 의 팀 메뉴를
 * 한 화면으로 펼쳤다 — 같은 줄 모양, 같은 진입 정책. 미완료 공간은 `설정 미완료` 이고 누르면 온보딩을 이어 간다.
 */
export function WorkspaceSelectPage() {
  return (
    <div className="flex min-h-dvh flex-col bg-surface text-ink">
      <header className={TOP}>
        <GuardedLink
          to={paths.workspaceSelect()}
          aria-label="Manager's Manager"
          className="inline-flex"
        >
          <BrandMark />
        </GuardedLink>
        <UserMenu />
      </header>
      <main className={COLUMN}>
        <div className="flex flex-col gap-6">
          <h1 className="text-[24px] leading-[1.35] font-bold tracking-h3 text-ink">
            워크스페이스 선택
          </h1>
          <p className="text-body text-sub">들어갈 워크스페이스를 골라 주세요.</p>
        </div>
        <WorkspaceChoiceList />
      </main>
    </div>
  )
}
