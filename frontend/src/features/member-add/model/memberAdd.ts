import { memberNameKey } from '@/entities/member'
import type { Member } from '@/entities/member'

export type NewMemberName =
  { kind: 'empty' } | { kind: 'duplicate'; member: Member } | { kind: 'ok'; displayName: string }

/**
 * 새 팀원 이름을 지금 팀원과 견준다. 역할·Discord 연결과 상관없이 모든 팀원과 비교한다 —
 * 같은 이름이 둘이면 Discord 를 연결한 뒤 매칭 폼(`reusableMember`)이 어느 쪽에 붙을지 정해지지 않고,
 * 화자 지정·담당자에서도 둘을 구분할 수 없다
 */
export function checkNewMemberName(text: string, members: readonly Member[]): NewMemberName {
  const displayName = text.trim()
  const key = memberNameKey(displayName)
  if (key === '') return { kind: 'empty' }
  const member = members.find((other) => memberNameKey(other.displayName) === key)
  return member ? { kind: 'duplicate', member } : { kind: 'ok', displayName }
}
