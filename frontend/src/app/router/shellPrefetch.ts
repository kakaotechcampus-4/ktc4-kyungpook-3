import { useQueryClient } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useEffectEvent } from 'react'
import { prefetchMeetings } from '@/pages/meetings/prefetch'
import { preloadScreenCode } from '@/shared/lib/screen-code'
import { SHELL_TABS } from '@/widgets/app-shell'
import type { ShellTabKey } from '@/widgets/app-shell'
import { prefetchDashboard } from '@/widgets/dashboard/prefetch'
import { prefetchMessageInbox } from '@/widgets/message-inbox/prefetch'
import { prefetchProjectMap } from '@/widgets/project-map/prefetch'
import { prefetchTaskBoard } from '@/widgets/task-board/prefetch'
import { prefetchTeamOverview } from '@/widgets/team/prefetch'

/** 미리 받을 화면을 고르는 데 쓰는 셸의 상태. 역할에 따라 화면이 묻는 조회가 다르다 */
export interface ShellPrefetchContext {
  workspaceId: string
  isPm: boolean
  /** 768px 미만. 휴대폰 메시지는 목록만 보여 처음 열 대화가 없다 */
  compact: boolean
}

/** 탭마다 첫 화면 조회를 미리 받는 함수. 각 화면의 조회 옆(그 화면의 `prefetch` 입구)에 있다 */
const prefetchData: Record<
  ShellTabKey,
  (queryClient: QueryClient, context: ShellPrefetchContext) => Promise<void>
> = {
  dashboard: prefetchDashboard,
  meetings: prefetchMeetings,
  tasks: prefetchTaskBoard,
  messages: prefetchMessageInbox,
  projectMap: prefetchProjectMap,
  members: prefetchTeamOverview,
}

/**
 * 셸 탭 하나의 화면 코드와 첫 화면 데이터를 미리 받는다 (#536). 코드는 탭이 여는 경로의 지연 로드 화면을 경로 표로 찾아 받는다.
 * 데이터는 화면과 같은 query options 라 받은 값이 화면의 캐시가 된다.
 * 신선한 값은 다시 받지 않고, 실패는 조용히 넘긴다 — 화면이 뜨면 같은 Query 가 다시 묻고 그 오류를 그린다
 */
export function prefetchShellTab(
  queryClient: QueryClient,
  tab: ShellTabKey,
  context: ShellPrefetchContext,
): Promise<void> {
  const target = SHELL_TABS.find(({ key }) => key === tab)
  if (target !== undefined) preloadScreenCode(target.to(context.workspaceId))
  return prefetchData[tab](queryClient, context)
}

/** 데이터 절약 모드(`navigator.connection.saveData`). 지원하지 않는 브라우저는 꺼진 것으로 본다 */
function saveDataOn(): boolean {
  const { connection } = navigator as Navigator & { connection?: { saveData?: boolean } }
  return connection?.saveData === true
}

/** `requestIdleCallback` 이 없는 브라우저(Safari)에서 한가할 때를 대신하는 짧은 기다림 */
export const IDLE_FALLBACK_MS = 300
/** 한가해지지 않아도 이만큼 지나면 받는다 */
const IDLE_TIMEOUT_MS = 2000

/**
 * 셸의 미리 받기 (#536). 두 갈래다.
 * 1. 탭에 다가간 순간(가리키기·포커스·터치) 그 탭 하나를 받는다 — 돌려주는 함수를 헤더 탭과 아래 탭 막대에 건다.
 * 2. 셸이 뜬 뒤 브라우저가 한가할 때 모든 셸 탭을 한 번 받는다. 데이터 절약 모드면 이 갈래만 건너뛴다.
 * 공간·역할이 바뀌면 그 공간 기준으로 다시 한 번 받는다. 화면 폭이 바뀌는 것만으로는 다시 받지 않는다.
 */
export function useShellPrefetch(context: ShellPrefetchContext): (tab: ShellTabKey) => void {
  const queryClient = useQueryClient()
  const { workspaceId, isPm, compact } = context

  const prefetchTab = useCallback(
    (tab: ShellTabKey) => void prefetchShellTab(queryClient, tab, { workspaceId, isPm, compact }),
    [queryClient, workspaceId, isPm, compact],
  )

  const prefetchAll = useEffectEvent(() => {
    for (const { key } of SHELL_TABS) prefetchTab(key)
  })
  useEffect(() => {
    if (saveDataOn()) return
    if (typeof window.requestIdleCallback === 'function') {
      const handle = window.requestIdleCallback(() => prefetchAll(), { timeout: IDLE_TIMEOUT_MS })
      return () => window.cancelIdleCallback(handle)
    }
    const timer = window.setTimeout(() => prefetchAll(), IDLE_FALLBACK_MS)
    return () => window.clearTimeout(timer)
  }, [workspaceId, isPm])

  return prefetchTab
}
