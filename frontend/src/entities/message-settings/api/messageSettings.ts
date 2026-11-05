import { queryOptions } from '@tanstack/react-query'
import { request } from '@/shared/api/client'
import { workspaceKey } from '@/shared/api/queryKeys'
import type { MessageSettingsDto } from '@/shared/types/api/messageSettings'
import { toMessageSettings, toMessageSettingsPatch } from '../model/mapper'
import type { MessageSettings, MessageSettingsChange } from '../model/types'

const path = (workspaceId: string) =>
  `/workspaces/${encodeURIComponent(workspaceId)}/message-settings`

export async function fetchMessageSettings(
  workspaceId: string,
  signal?: AbortSignal,
): Promise<MessageSettings> {
  return toMessageSettings(await request<MessageSettingsDto>(path(workspaceId), { signal }))
}

/** 보낸 칸만 바꾸고 전체 설정을 돌려준다. PM 만 할 수 있다(그 밖은 403) */
export async function updateMessageSettings(
  workspaceId: string,
  change: MessageSettingsChange,
): Promise<MessageSettings> {
  return toMessageSettings(
    await request<MessageSettingsDto>(path(workspaceId), {
      method: 'PATCH',
      body: toMessageSettingsPatch(change),
    }),
  )
}

/**
 * 메시지·알림 설정 (계약 §5.7). 팀원도 읽는다.
 * key 를 `messages` 아래에 두지 않는다 — 메시지 행동이 그 접두어를 무효화하는데 설정은 바뀌지 않는다
 */
export function messageSettingsQueryOptions(workspaceId: string) {
  return queryOptions({
    queryKey: workspaceKey(workspaceId, 'message-settings'),
    queryFn: ({ signal }) => fetchMessageSettings(workspaceId, signal),
  })
}
