import { useMutation, useMutationState, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useMemo } from 'react'
import { messageSettingsQueryOptions, updateMessageSettings } from '@/entities/message-settings'
import type { MessageSettings, MessageSettingsChange } from '@/entities/message-settings'
import { captureSession } from '@/entities/user'
import { failureNotice } from '@/shared/api/errorMessages'
import { toast } from '@/shared/ui/toast'

export const MESSAGE_SETTINGS_FAILED_TITLE = '알림 설정을 저장하지 못했어요'

const mutationKey = (workspaceId: string) => ['message-settings', workspaceId] as const

interface ChangeVariables {
  change: MessageSettingsChange
  /** 요청을 시작한 세션이 아직 이어지는지. 끝났으면 화면·캐시·알림에 아무것도 남기지 않는다 */
  isCurrentSession: () => boolean
}

export interface MessageSettingsState {
  /** 서버 값 위에 진행 중인 변경을 겹친 값. 처음 받기 전에는 undefined 다 */
  settings: MessageSettings | undefined
  /** 처음 받기에 실패했다. 받은 값이 있으면 그 값을 계속 보인다 */
  error: unknown
  retry: () => void
  /** 바꾼 칸만 보낸다. 응답 전에도 화면에는 바뀐 값이 보인다 */
  change: (change: MessageSettingsChange) => void
}

/**
 * 메시지·알림 설정 읽기와 PM 의 변경 (#340).
 *
 * 변경은 한 공간에서 한 번에 하나씩 순서대로 나간다(mutation scope). 응답이 전체 설정이라 순서가 섞이면 늦게 온
 * 이전 응답이 새 값을 덮는다. 순서대로라 마지막 응답이 가장 새 값이고, 그 응답을 캐시에 그대로 쓴다.
 * 낙관적 반영은 캐시가 아니라 진행 중 변경의 변수로 겹친다 — 실패하면 그 변경의 겹침만 사라져 값이 돌아오고 알림을 띄운다.
 */
export function useMessageSettings(workspaceId: string): MessageSettingsState {
  const queryClient = useQueryClient()
  const query = useQuery(messageSettingsQueryOptions(workspaceId))
  const pending = useMutationState({
    filters: { mutationKey: mutationKey(workspaceId), status: 'pending' },
    select: (mutation) => mutation.state.variables as ChangeVariables | undefined,
  })

  const { mutate } = useMutation({
    mutationKey: mutationKey(workspaceId),
    scope: { id: `message-settings:${workspaceId}` },
    mutationFn: ({ change }: ChangeVariables) => updateMessageSettings(workspaceId, change),
    onSuccess: (settings, { isCurrentSession }) => {
      if (!isCurrentSession()) return
      queryClient.setQueryData(messageSettingsQueryOptions(workspaceId).queryKey, settings)
    },
    onError: (error, { isCurrentSession }) => {
      if (!isCurrentSession()) return
      const notice = failureNotice(error)
      if (notice !== null)
        toast.show({
          key: `message-settings-${workspaceId}`,
          title: MESSAGE_SETTINGS_FAILED_TITLE,
          description: notice,
        })
    },
  })

  const settings = useMemo(
    () =>
      query.data &&
      pending.reduce<MessageSettings>(
        (current, variables) =>
          variables !== undefined && variables.isCurrentSession()
            ? { ...current, ...variables.change }
            : current,
        query.data,
      ),
    [query.data, pending],
  )

  const change = useCallback(
    (next: MessageSettingsChange) => mutate({ change: next, isCurrentSession: captureSession() }),
    [mutate],
  )

  const { refetch } = query
  const retry = useCallback(() => void refetch(), [refetch])

  return { settings, error: query.data === undefined ? query.error : null, retry, change }
}
