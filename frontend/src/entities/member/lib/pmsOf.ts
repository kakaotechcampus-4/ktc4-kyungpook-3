import type { Member } from '../model/types'

/** PM 팀원. 먼저 만들어진 순서다 — 첫째가 워크스페이스를 만든 PM 이고 체크박스가 그 PM 을 가리킨다 (#228) */
export function pmsOf(members: readonly Member[]): Member[] {
  return members
    .filter(({ role }) => role === 'pm')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}
