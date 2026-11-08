import { paths } from '@/shared/config/routes'
import type { IconName } from '@/shared/ui/icon'

/** 셸 탭의 이름. 셸이 탭에 다가간 순간(가리키기·포커스·터치) 그 탭을 미리 받을 때 쓴다 (#536) */
export type ShellTabKey = 'dashboard' | 'meetings' | 'tasks' | 'messages' | 'members'

/**
 * 셸의 다섯 탭. 768px 이상은 헤더의 글자 탭(`label`), 아래는 아래 탭 막대의 아이콘 탭(`barLabel`)이다 (D-180).
 * 탭 뒤의 개수 배지는 집계 API 가 없어 두지 않는다. 메시지의 읽지 않은 수는 #480 이 생기면 두 곳에 같이 붙인다
 */
export const SHELL_TABS: readonly {
  key: ShellTabKey
  label: string
  barLabel: string
  icon: IconName
  to: (workspaceId: string) => string
}[] = [
  { key: 'dashboard', label: '대시보드', barLabel: '홈', icon: 'home', to: paths.dashboard },
  {
    key: 'meetings',
    label: '회의록',
    barLabel: '회의록',
    icon: 'minutes',
    to: (id) => paths.meetings(id),
  },
  { key: 'tasks', label: '태스크', barLabel: '태스크', icon: 'tasks', to: (id) => paths.tasks(id) },
  { key: 'messages', label: '메시지', barLabel: '메시지', icon: 'message', to: paths.messages },
  { key: 'members', label: '팀', barLabel: '팀', icon: 'team', to: paths.members },
]

/**
 * 탭에 다가간 순간 알리는 이벤트 묶음 — 마우스 올리기·키보드 포커스·터치 시작. 누르기 전에 그 화면을 미리 받을 틈이다 (#536).
 * 받을 쪽이 없으면 아무것도 붙이지 않는다
 */
export function tabIntentHandlers(onIntent: (() => void) | undefined) {
  if (onIntent === undefined) return {}
  return { onPointerEnter: onIntent, onFocus: onIntent, onTouchStart: onIntent }
}
