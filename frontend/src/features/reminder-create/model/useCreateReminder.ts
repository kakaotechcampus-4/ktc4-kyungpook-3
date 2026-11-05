import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import { createReminder, messageKeys } from '@/entities/message'
import type { CreatedReminder, ReminderCreateInput } from '@/entities/message'
import { CLIENT_ERROR_CODES, createClientError } from '@/shared/api/errors'
import { captureSessionScope } from '@/shared/api/sessionScope'
import type { SessionScope } from '@/shared/api/sessionScope'
import { knownCreateFailure } from '../lib/createMessages'

export interface CreateReminderFailure {
  error: unknown
  /** 다시 보내도 같은 거절의 문구. null 이면 다시 시도할 수 있는 실패다 */
  known: string | null
}

export interface CreateReminderControl {
  /** 재촉을 만든다. 진행 중인 만들기가 있으면 아무것도 하지 않는다 — 중복 제출을 막는다 */
  create: (input: ReminderCreateInput, onCreated: (created: CreatedReminder) => void) => void
  pending: boolean
  failure: CreateReminderFailure | null
  /** 입력이 바뀌면 이전 실패는 지금 입력의 것이 아니다 */
  clearFailure: () => void
}

const mutationKeyOf = (workspaceId: string) => ['reminder-create', workspaceId] as const

interface Variables {
  input: ReminderCreateInput
  /** 만들기를 누른 세션. 끝났으면 보내지 않고, 보낸 요청은 취소하며, 화면·캐시에 아무것도 남기지 않는다 */
  session: SessionScope
}

/**
 * 재촉 만들기 (계약 §5.7 `POST …/messages/reminders`). 메시지 쓰기(useMessageAction)와 같은 규칙이다.
 * - 서버 성공 뒤에만 반영한다. 메시지 캐시를 다시 받은 뒤에 끝난다 — 만든 묶음으로 옮겨 가도 목록에 이미 있다
 * - 실패하면 남기고 자동 재시도는 없다. 다시 시도는 부른 쪽이 지금 입력으로 다시 `create` 한다
 * - 요청 중이나 보내기 전에 세션이 끝났으면 보내지 않고, 늦은 응답은 캐시에도 결과에도 남기지 않는다
 */
export function useCreateReminder(workspaceId: string): CreateReminderControl {
  const queryClient = useQueryClient()
  const [failure, setFailure] = useState<CreateReminderFailure | null>(null)

  const { mutate, isPending } = useMutation<CreatedReminder, Error, Variables>({
    mutationKey: mutationKeyOf(workspaceId),
    retry: false,
    mutationFn: ({ input, session }) => {
      // 오프라인으로 기다리는 사이 세션이 끝났을 수 있다. 그대로 보내면 다음에 로그인한 계정의 쿠키로 만든다
      if (!session.isCurrent()) throw createClientError(CLIENT_ERROR_CODES.REQUEST_CANCELED)
      return createReminder(workspaceId, input, session.signal)
    },
    onSuccess: async (_created, { session }) => {
      if (!session.isCurrent()) return
      const queryKey = messageKeys(workspaceId)
      // 만들기 전에 출발한 조회는 만든 묶음을 모른다. 받은 값이 없는 첫 조회는 무효화만으로 끊기지 않아
      // 먼저 거두고 새로 받는다 — 그래야 옮겨 간 묶음이 목록에 있다
      await queryClient.cancelQueries({ queryKey })
      await queryClient.invalidateQueries({ queryKey })
    },
    onError: (error, { session }) => {
      if (!session.isCurrent()) return
      setFailure({ error, known: knownCreateFailure(error) })
    },
  })

  const create = useCallback(
    (input: ReminderCreateInput, onCreated: (created: CreatedReminder) => void) => {
      // 같은 틱의 두 번째 누름도 막는다 — 렌더 전의 isPending 은 아직 false 다
      if (queryClient.isMutating({ mutationKey: mutationKeyOf(workspaceId) }) > 0) return
      setFailure(null)
      const session = captureSessionScope()
      mutate(
        { input, session },
        {
          onSuccess: (created) => {
            if (session.isCurrent()) onCreated(created)
          },
        },
      )
    },
    [queryClient, mutate, workspaceId],
  )

  const clearFailure = useCallback(() => setFailure(null), [])

  return { create, pending: isPending, failure, clearFailure }
}
