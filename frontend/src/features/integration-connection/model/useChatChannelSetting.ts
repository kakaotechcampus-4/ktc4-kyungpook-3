import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import {
  clearChatChannel,
  discordChannelsQueryOptions,
  integrationsQueryOptions,
  setChatChannel,
} from '@/entities/integration'
import type { ChatChannel } from '@/entities/integration'
import {
  ApiError,
  CLIENT_ERROR_CODES,
  ERROR_CODES,
  createClientError,
  isInvalidResponse,
} from '@/shared/api/errors'
import { captureSessionScope } from '@/shared/api/sessionScope'
import type { SessionScope } from '@/shared/api/sessionScope'
import { showWriteUnconfirmed, toast } from '@/shared/ui/toast'
import {
  CHAT_CHANNEL_CLEARED,
  CHAT_CHANNEL_SAVED,
  OFF_NOTICE_NOT_SENT,
  chatChannelFailure,
} from '../lib/chatChannelMessages'

/** 저장 결과. 켜거나 바꿨으면 그 채널이고, 껐으면 채널에 끔 안내를 남겼는지다 */
type ChatChannelSaved = { channel: ChatChannel } | { channel: null; offNoticeSent: boolean }

interface Variables {
  /** null 이면 수집을 끈다 */
  channelId: string | null
  /** 저장을 누른 세션. 끝났으면 보내지 않고, 보낸 요청은 취소하며, 화면·캐시·알림에 아무것도 남기지 않는다 */
  session: SessionScope
}

export interface ChatChannelSetting {
  /** 연결한 Discord 서버의 텍스트 채널. 연결돼 있을 때만 받는다. `error` 는 연결돼 있고 받은 목록이 없을 때만 있다 */
  channels: {
    data: ChatChannel[] | undefined
    loading: boolean
    error: unknown
    retry: () => void
  }
  /** 고른 채널(null 이면 끄기)을 저장한다. 진행 중인 저장이 있으면 아무것도 하지 않는다 — 중복 제출을 막는다 */
  save: (channelId: string | null, onSaved: () => void) => void
  saving: boolean
  /** 마지막 저장 실패의 문구 */
  failure: string | null
  /** 고른 값이 바뀌면 이전 실패는 지금 값의 것이 아니다 */
  clearFailure: () => void
}

const mutationKeyOf = (workspaceId: string) => ['chat-channel', workspaceId] as const

/**
 * 회의 채팅 채널 고르기 (#429). PM 만 쓴다. 저장한 값은 연동 조회의 `discord.chatChannel` 이다.
 * - 서버 성공 뒤에만 반영한다. 서버는 채널을 읽어 보고 켬 안내를 보낸 뒤에만 저장하므로 실패하면 바뀐 것이 없다
 * - 성공하면 이 공간의 연동 캐시에 저장 결과를 쓰고 다시 받는다. 화면이 공간마다 새로 그려지므로 캐시 쓰기는
 *   부른 쪽 콜백이 아니라 여기서 한다 — 다른 공간으로 옮긴 뒤 끝나도 저장한 공간의 캐시에 쓴다
 * - 세션이 끝났으면 보내지 않고, 늦은 응답은 캐시·알림·실패 문구에 남기지 않는다
 */
export function useChatChannelSetting(workspaceId: string, connected: boolean): ChatChannelSetting {
  const queryClient = useQueryClient()
  const [failure, setFailure] = useState<string | null>(null)
  const channels = useQuery({ ...discordChannelsQueryOptions(workspaceId), enabled: connected })

  const { mutate, isPending } = useMutation<ChatChannelSaved, Error, Variables>({
    mutationKey: mutationKeyOf(workspaceId),
    retry: false,
    mutationFn: async ({ channelId, session }) => {
      // 앞선 일을 기다리는 사이 세션이 끝났을 수 있다. 그대로 보내면 다음에 로그인한 계정의 쿠키로 저장된다
      if (!session.isCurrent()) throw createClientError(CLIENT_ERROR_CODES.REQUEST_CANCELED)
      if (channelId === null) {
        const { offNoticeSent } = await clearChatChannel(workspaceId, session.signal)
        return { channel: null, offNoticeSent }
      }
      return { channel: await setChatChannel(workspaceId, channelId, session.signal) }
    },
    onSuccess: async (saved, { session }) => {
      if (!session.isCurrent()) return
      const { queryKey } = integrationsQueryOptions(workspaceId)
      // 저장 전에 출발한 조회가 늦게 끝나 이전 채널로 덮지 않게 먼저 거둔다
      await queryClient.cancelQueries({ queryKey })
      if (!session.isCurrent()) return
      queryClient.setQueryData(
        queryKey,
        (current) =>
          current && { ...current, discord: { ...current.discord, chatChannel: saved.channel } },
      )
      if (saved.channel !== null) toast.show({ title: CHAT_CHANNEL_SAVED })
      else if (saved.offNoticeSent) toast.show({ title: CHAT_CHANNEL_CLEARED })
      else toast.show({ title: CHAT_CHANNEL_CLEARED, description: OFF_NOTICE_NOT_SENT })
      void queryClient.invalidateQueries({ queryKey })
    },
    onError: (error, { session }) => {
      if (!session.isCurrent()) return
      // 응답을 읽지 못했다. 저장됐을 수 있어 실패로 보이지 않는다 (D-184)
      if (isInvalidResponse(error)) {
        showWriteUnconfirmed(
          () =>
            void queryClient.invalidateQueries({
              queryKey: integrationsQueryOptions(workspaceId).queryKey,
            }),
        )
        return
      }
      // 목록이 낡았거나 연결이 끊겼다. 다시 고를 수 있게 그 조회를 새로 받는다
      if (error instanceof ApiError && error.code === ERROR_CODES.DISCORD_CHANNEL_NOT_FOUND)
        void queryClient.invalidateQueries({
          queryKey: discordChannelsQueryOptions(workspaceId).queryKey,
        })
      if (error instanceof ApiError && error.code === ERROR_CODES.INTEGRATION_NOT_CONNECTED)
        void queryClient.invalidateQueries({
          queryKey: integrationsQueryOptions(workspaceId).queryKey,
        })
      setFailure(chatChannelFailure(error))
    },
  })

  const save = useCallback(
    (channelId: string | null, onSaved: () => void) => {
      // 같은 틱의 두 번째 누름도 막는다 — 렌더 전의 isPending 은 아직 false 다
      if (queryClient.isMutating({ mutationKey: mutationKeyOf(workspaceId) }) > 0) return
      setFailure(null)
      const session = captureSessionScope()
      mutate(
        { channelId, session },
        {
          onSuccess: () => {
            if (session.isCurrent()) onSaved()
          },
        },
      )
    },
    [queryClient, mutate, workspaceId],
  )

  const clearFailure = useCallback(() => setFailure(null), [])
  const { refetch } = channels
  // 연결이 끊긴 뒤에는 서버가 409 로 거절한다. 남은 목록 오류도 보이지 않으므로 묻지 않는다
  const retry = useCallback(() => {
    if (connected) void refetch()
  }, [connected, refetch])

  return {
    channels: {
      data: channels.data,
      loading: connected && channels.isPending,
      error: connected && channels.data === undefined ? channels.error : null,
      retry,
    },
    save,
    saving: isPending,
    failure,
    clearFailure,
  }
}
