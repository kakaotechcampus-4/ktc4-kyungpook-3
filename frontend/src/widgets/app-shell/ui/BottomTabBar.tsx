import { GuardedLink } from '@/shared/lib/unsaved-changes'
import { Icon } from '@/shared/ui/icon'
import { SHELL_TABS, tabIntentHandlers } from '../model/shellTabs'
import type { ShellTabKey } from '../model/shellTabs'

/* PwaDashboard 의 아래 탭 막대: 위 선 · 다섯 칸 · 위 8px · 아래·좌우는 안전 영역만큼, 없으면 8px.
   높이는 global.css 의 `--bottom-tab-bar` 하나다 — 셸 본문 아래 여백과 토스트 독이 같은 값으로 비켜 선다 */
const BAR =
  'fixed inset-x-[0px] bottom-[0px] z-50 grid h-(--bottom-tab-bar) grid-cols-5 border-t border-divider bg-surface pt-8 pr-[max(8px,env(safe-area-inset-right))] pb-[max(8px,env(safe-area-inset-bottom))] pl-[max(8px,env(safe-area-inset-left))]'

/* 아이콘 24 · 글자 11 · 간격 3. 지금 탭은 먹 · 굵게 · 선 1.9, 나머지는 흐림 · 선 1.7 */
const TAB =
  'flex flex-col items-center justify-center gap-3 text-[11px] leading-none text-dim aria-[current=page]:font-bold aria-[current=page]:text-ink aria-[current=page]:[&_svg]:stroke-[1.9]'

const BAR_TABS = SHELL_TABS.filter(({ compact }) => compact === 'bar')

/**
 * 768px 미만의 주요 화면 이동 (D-180). 헤더 탭 중 막대 자리(`compact: 'bar'`)인 다섯 곳으로 가고, 지금 화면은 `aria-current` 로 표시한다.
 * 프로젝트 맵은 계정 메뉴에 있다 (#551).
 * 탭을 누르기 시작하면(터치·포커스) `onTabIntent` 로 알린다 — 셸이 그 화면을 미리 받는다 (#536)
 */
export function BottomTabBar({
  workspaceId,
  onTabIntent,
}: {
  workspaceId: string
  onTabIntent?: (tab: ShellTabKey) => void
}) {
  return (
    <nav aria-label="주요 화면" data-bottom-tab-bar="" className={BAR}>
      {BAR_TABS.map(({ key, barLabel, icon, to }) => (
        <GuardedLink
          key={key}
          to={to(workspaceId)}
          className={TAB}
          {...tabIntentHandlers(onTabIntent && (() => onTabIntent(key)))}
        >
          <Icon name={icon} size={24} />
          {barLabel}
        </GuardedLink>
      ))}
    </nav>
  )
}
