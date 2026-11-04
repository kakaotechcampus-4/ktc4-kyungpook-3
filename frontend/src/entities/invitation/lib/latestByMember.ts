import type { Invitation } from '../model/types'

/**
 * 팀원마다 가장 최근 초대 하나. 서버 순서(최신 먼저)에 기대지 않고 시각으로 고른다.
 * 문자열로 비교하지 않는다 — 서버는 0 마이크로초를 빼고 보내 `…:03Z` 가 `…:03.5Z` 보다 뒤로 정렬된다.
 * 시각이 같으면 목록에서 먼저 온 것을 둔다.
 */
export function latestByMember(
  invitations: readonly Invitation[],
): ReadonlyMap<string, Invitation> {
  const latest = new Map<string, Invitation>()
  for (const invitation of invitations) {
    const current = latest.get(invitation.memberId)
    if (!current || Date.parse(invitation.createdAt) > Date.parse(current.createdAt)) {
      latest.set(invitation.memberId, invitation)
    }
  }
  return latest
}
