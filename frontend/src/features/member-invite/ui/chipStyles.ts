import type { InviteChipTone } from '../model/inviteView'

/* 팀 화면 배지와 같은 모양이다(widgets/team teamStyles 의 BADGE). 기능은 위젯을 가져올 수 없어 값을 옮겨 적는다 */
export const CHIP =
  'inline-flex h-22 shrink-0 items-center rounded-6 px-9 text-meta leading-none font-semibold'

/** 색만이 아니라 글자로도 상태를 구분한다 (D-128). 거절은 위험 배지와 같은 면이다 */
export const CHIP_TONE: Record<InviteChipTone, string> = {
  waiting: 'border border-line text-sub',
  linked: 'bg-control text-sub',
  signal: 'bg-accent-badge text-accent',
  closed: 'text-dim',
}
