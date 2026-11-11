import { queryOptions } from '@tanstack/react-query'
import { request } from '@/shared/api/client'
import { parseResponse } from '@/shared/api/parseResponse'
import { workspaceKey } from '@/shared/api/queryKeys'
import { memberAliasListSchema, memberAliasSchema } from '@/shared/types/api/member'
import { toMemberAlias } from '../model/mapper'
import type { MemberAlias } from '../model/types'

/** 공간의 별칭 전부, 최근에 만든 것부터. 팀원별 조회가 없어 팀원으로 묶는 것은 부르는 쪽이다. 팀원이면 누구나 읽는다 */
export function memberAliasesQueryOptions(workspaceId: string) {
  return queryOptions({
    queryKey: workspaceKey(workspaceId, 'member-aliases'),
    queryFn: async ({ signal }) => {
      const { items } = parseResponse(
        memberAliasListSchema,
        await request<unknown>('/members/aliases', {
          params: { workspace_id: workspaceId },
          signal,
        }),
        'member',
      )
      return items.map(toMemberAlias)
    },
  })
}

/*
 * 별칭 추가·삭제는 PM 만 한다(그 밖은 403). 고치는 API 는 없다 — 잘못 배운 별칭은 지우고 다시 넣는다.
 * 같은 팀원에게 같은 글자가 이미 있으면 서버는 새로 만들지 않고 그 행을 201 로 돌려준다.
 */

/** 본문은 `alias_text` 만 보낸다. 서버가 출처를 `manual`·확인됨으로 채운다 */
export async function createMemberAlias(
  memberId: string,
  aliasText: string,
  signal?: AbortSignal,
): Promise<MemberAlias> {
  return toMemberAlias(
    parseResponse(
      memberAliasSchema,
      await request<unknown>(`/members/${encodeURIComponent(memberId)}/aliases`, {
        method: 'POST',
        body: { alias_text: aliasText },
        signal,
      }),
      'member',
    ),
  )
}

/** 이미 지워졌으면 404 `MEMBER_ALIAS_NOT_FOUND` 다 */
export async function deleteMemberAlias(aliasId: string, signal?: AbortSignal): Promise<void> {
  await request<void>(`/members/aliases/${encodeURIComponent(aliasId)}`, {
    method: 'DELETE',
    signal,
  })
}
