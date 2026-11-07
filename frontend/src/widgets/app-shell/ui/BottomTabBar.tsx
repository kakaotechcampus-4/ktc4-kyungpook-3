import { GuardedLink } from '@/shared/lib/unsaved-changes'
import { Icon } from '@/shared/ui/icon'
import { SHELL_TABS } from '../model/shellTabs'

/* PwaDashboard 의 아래 탭 막대: 위 선 · 다섯 칸 · 위 8px · 아래·좌우는 안전 영역만큼, 없으면 8px.
   높이는 global.css 의 `--bottom-tab-bar` 하나다 — 셸 본문 아래 여백과 토스트 독이 같은 값으로 비켜 선다 */
const BAR =
  'fixed inset-x-[0px] bottom-[0px] z-50 grid h-(--bottom-tab-bar) grid-cols-5 border-t border-divider bg-surface pt-8 pr-[max(8px,env(safe-area-inset-right))] pb-[max(8px,env(safe-area-inset-bottom))] pl-[max(8px,env(safe-area-inset-left))]'

/* 아이콘 24 · 글자 11 · 간격 3. 지금 탭은 먹 · 굵게 · 선 1.9, 나머지는 흐림 · 선 1.7 */
const TAB =
  'flex flex-col items-center justify-center gap-3 text-[11px] leading-none text-dim aria-[current=page]:font-bold aria-[current=page]:text-ink aria-[current=page]:[&_svg]:stroke-[1.9]'

/** 768px 미만의 주요 화면 이동 (D-180). 헤더 탭과 같은 다섯 곳으로 가고, 지금 화면은 `aria-current` 로 표시한다 */
export function BottomTabBar({ workspaceId }: { workspaceId: string }) {
  return (
    <nav aria-label="주요 화면" data-bottom-tab-bar="" className={BAR}>
      {SHELL_TABS.map(({ barLabel, icon, to }) => (
        <GuardedLink key={barLabel} to={to(workspaceId)} className={TAB}>
          <Icon name={icon} size={24} />
          {barLabel}
        </GuardedLink>
      ))}
    </nav>
  )
}
