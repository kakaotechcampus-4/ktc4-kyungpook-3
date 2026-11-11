import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import { messageKeys, openThread } from '@/entities/message'
import type { MessageThreadSummary } from '@/entities/message'
import { CLIENT_ERROR_CODES, createClientError, isInvalidResponse } from '@/shared/api/errors'
import { captureSessionScope } from '@/shared/api/sessionScope'
import type { SessionScope } from '@/shared/api/sessionScope'
import { showWriteUnconfirmed } from '@/shared/ui/toast'

export interface OpenThreadControl {
  /** 그 팀원과의 대화를 연다. 진행 중인 열기가 있으면 아무것도 하지 않는다 — 중복 요청을 막는다 */
  open: (memberId: string, onOpened: (thread: MessageThreadSummary) => void) => void
  pending: boolean
  /** 마지막 열기의 실패. 다시 누르면 지운다 */
  failure: unknown
}

const mutationKeyOf = (workspaceId: string) => ['message-thread-open', workspaceId] as const

interface Variables {
  memberId: string
  /** 누른 세션. 끝났으면 보내지 않고, 보낸 요청은 취소하며, 화면·캐시에 아무것도 남기지 않는다 */
  session: SessionScope
}

/**
 * 대화 열기 (계약 §5.7 `POST …/messages/threads`). 재촉 만들기(useCreateReminder)와 같은 규칙이다.
 * 서버가 있으면 그 대화를, 없으면 빈 대화를 돌려준다. 메시지 캐시를 다시 받은 뒤에 끝난다 — 옮겨 가면 목록에 그 대화가 있다.
 * 실패는 남기고 자동 재시도는 없다. 다시 누르면 다시 연다. 응답을 읽지 못했으면 대화가 생겼을 수 있어 실패로 남기지 않고
 * 토스트와 `새로고침`(메시지 목록 다시 받기)으로 알린다 (#348)
 */
export function useOpenThread(workspaceId: string): OpenThreadControl {
  const queryClient = useQueryClient()
  const [failure, setFailure] = useState<unknown>(null)

  const { mutate, isPending } = useMutation<MessageThreadSummary, Error, Variables>({
    mutationKey: mutationKeyOf(workspaceId),
    retry: false,
    mutationFn: ({ memberId, session }) => {
      if (!session.isCurrent()) throw createClientError(CLIENT_ERROR_CODES.REQUEST_CANCELED)
      return openThread(workspaceId, memberId, session.signal)
    },
    onSuccess: async (_thread, { session }) => {
      if (!session.isCurrent()) return
      const queryKey = messageKeys(workspaceId)
      // 열기 전에 출발한 목록 조회는 새 대화를 모른다. 거두고 새로 받는다
      await queryClient.cancelQueries({ queryKey })
      await queryClient.invalidateQueries({ queryKey })
    },
    onError: (error, { session }) => {
      if (!session.isCurrent()) return
      if (isInvalidResponse(error))
        showWriteUnconfirmed(
          () => void queryClient.invalidateQueries({ queryKey: messageKeys(workspaceId) }),
        )
      else setFailure(error)
    },
  })

  const open = useCallback(
    (memberId: string, onOpened: (thread: MessageThreadSummary) => void) => {
      // 같은 틱의 두 번째 누름도 막는다 — 렌더 전의 isPending 은 아직 false 다
      if (queryClient.isMutating({ mutationKey: mutationKeyOf(workspaceId) }) > 0) return
      setFailure(null)
      const session = captureSessionScope()
      mutate(
        { memberId, session },
        {
          onSuccess: (thread) => {
            if (session.isCurrent()) onOpened(thread)
          },
        },
      )
    },
    [queryClient, mutate, workspaceId],
  )

  return { open, pending: isPending, failure }
}
