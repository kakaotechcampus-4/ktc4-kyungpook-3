import { useSyncExternalStore } from 'react'
import { paths } from '@/shared/config/routes'
import type { IconName } from '@/shared/ui/icon'

/**
 * 셸의 다섯 탭. 768px 이상은 헤더의 글자 탭(`label`), 아래는 아래 탭 막대의 아이콘 탭(`barLabel`)이다 (D-180).
 * 탭 뒤의 개수 배지는 집계 API 가 없어 두지 않는다. 메시지의 읽지 않은 수는 #480 이 생기면 두 곳에 같이 붙인다
 */
export const SHELL_TABS: readonly {
  label: string
  barLabel: string
  icon: IconName
  to: (workspaceId: string) => string
}[] = [
  { label: '대시보드', barLabel: '홈', icon: 'home', to: paths.dashboard },
  { label: '회의록', barLabel: '회의록', icon: 'minutes', to: (id) => paths.meetings(id) },
  { label: '태스크', barLabel: '태스크', icon: 'tasks', to: (id) => paths.tasks(id) },
  { label: '메시지', barLabel: '메시지', icon: 'message', to: paths.messages },
  { label: '팀', barLabel: '팀', icon: 'team', to: paths.members },
]

/* Tailwind `md`(768px) 아래와 같은 경계다 */
const COMPACT_QUERY = '(max-width: 767.98px)'

function subscribe(onChange: () => void): () => void {
  const query = window.matchMedia(COMPACT_QUERY)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

/**
 * 폭 768px 미만이면 휴대폰 셸(줄인 헤더 + 아래 탭 막대)이다. CSS 로 둘 다 그리고 숨기지 않는 것은
 * 같은 이름의 탭 링크가 두 벌 생기지 않게 하려는 것이다
 */
export function useCompactShell(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(COMPACT_QUERY).matches,
    () => false,
  )
}
