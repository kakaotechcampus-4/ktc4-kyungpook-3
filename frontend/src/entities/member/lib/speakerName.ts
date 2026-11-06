import type { ExtractionEvidence } from '@/shared/types/common'
import type { Member } from '../model/types'

/**
 * 근거 화자의 팀원 이름. 서버처럼 팀원 ID 를 먼저 보고, 없거나 목록에 없으면 발화 트랙의 Discord uid 로 같은 계정을 연결한
 * 팀원을 찾는다 (backend schemas/meeting.py). 업로드 회의는 uid 가 없고 팀원 ID 만 온다 (#256).
 * 못 찾으면 null — ID·uid 를 이름처럼 보여 주지 않는다
 */
export function speakerName(
  members: readonly Member[] | undefined,
  { speaker, speakerMemberId }: Pick<ExtractionEvidence, 'speaker' | 'speakerMemberId'>,
): string | null {
  if (members === undefined) return null
  const found =
    (speakerMemberId === null ? undefined : members.find(({ id }) => id === speakerMemberId)) ??
    (speaker === null ? undefined : members.find(({ discordUserId }) => discordUserId === speaker))
  return found?.displayName ?? null
}
