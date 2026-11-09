import type { Member } from '../model/types'

/** 서버가 돌려준 팀원을 목록에 넣는다. 같은 id 가 있으면 바꾼다 */
export function upsertMember(members: readonly Member[] | undefined, member: Member): Member[] {
  const list = members ?? []
  return list.some(({ id }) => id === member.id)
    ? list.map((item) => (item.id === member.id ? member : item))
    : [...list, member]
}
