import { request } from '@/shared/api/client'
import { parseResponse } from '@/shared/api/parseResponse'
import { userSearchSchema } from '@/shared/types/api/invitation'
import { toInvitee } from '../model/mapper'
import type { Invitee } from '../model/types'

/**
 * 그 공간의 PM 만 부른다(그 밖은 403). `username` 은 정규화한 값이다. 아이디가 정확히 같은 가입자만 나오고,
 * 이미 그 공간 팀원이거나 규칙 밖 값이면 null 이다
 */
export async function searchInvitee(
  workspaceId: string,
  username: string,
  signal?: AbortSignal,
): Promise<Invitee | null> {
  const { items } = parseResponse(
    userSearchSchema,
    await request<unknown>('/users/search', {
      params: { q: username, workspace_id: workspaceId },
      signal,
    }),
    'invitation',
  )
  const [found] = items
  return found === undefined ? null : toInvitee(found)
}
