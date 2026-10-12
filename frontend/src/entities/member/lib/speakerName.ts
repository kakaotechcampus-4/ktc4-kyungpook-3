import type { Member } from '../model/types'

/**
 * 근거 화자(`evidence_speaker`)는 별칭이 아니라 발화 트랙의 Discord uid 다 (backend schemas/meeting.py).
 * 같은 Discord 계정을 연결한 팀원 이름을 돌려준다. 못 찾으면 null — uid 를 이름처럼 보여 주지 않는다
 */
export function speakerName(
  members: readonly Member[] | undefined,
  discordUserId: string | null,
): string | null {
  if (discordUserId === null || members === undefined) return null
  return members.find((member) => member.discordUserId === discordUserId)?.displayName ?? null
}
