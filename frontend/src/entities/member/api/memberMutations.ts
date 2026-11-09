import { request } from '@/shared/api/client'
import { createInvalidResponseError } from '@/shared/api/parseResponse'
import type { MemberCreateDto, MemberDto, MemberUpdateDto } from '@/shared/types/api/member'
import { toMember } from '../model/mapper'
import type { CreateMemberInput, Member, UpdateMemberInput } from '../model/types'

/*
 * 일괄 API 가 없다. 팀원 연결 화면은 행마다 이 둘을 순서대로 부른다.
 * 같은 공간에 이미 연결된 Discord 사용자는 409 `DISCORD_USER_ALREADY_MAPPED` 다.
 */

export async function createMember(
  input: CreateMemberInput,
  signal?: AbortSignal,
): Promise<Member> {
  const body: MemberCreateDto = { workspace_id: input.workspaceId, display_name: input.displayName }
  if (input.discordUserId !== undefined) body.discord_user_id = input.discordUserId
  if (input.notionName !== undefined) body.notion_name = input.notionName
  if (input.role !== undefined) body.role = input.role
  const dto = await request<MemberDto>('/members', { method: 'POST', body, signal })
  try {
    return toMember(dto)
  } catch {
    // 2xx 라 서버는 이미 만들었을 수 있다. 일반 실패로 보이면 호출자가 같은 이름을 다시 만든다
    throw createInvalidResponseError('member', '')
  }
}

/** 넣지 않은 필드는 본문에 싣지 않는다 — 백엔드는 보낸 키만 바꾼다 */
export async function updateMember(
  memberId: string,
  input: UpdateMemberInput,
  signal?: AbortSignal,
): Promise<Member> {
  const body: MemberUpdateDto = {}
  if (input.displayName !== undefined) body.display_name = input.displayName
  if (input.discordUserId !== undefined) body.discord_user_id = input.discordUserId
  if (input.notionName !== undefined) body.notion_name = input.notionName
  if (input.role !== undefined) body.role = input.role
  return toMember(
    await request<MemberDto>(`/members/${encodeURIComponent(memberId)}`, {
      method: 'PATCH',
      body,
      signal,
    }),
  )
}
