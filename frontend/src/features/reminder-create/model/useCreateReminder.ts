import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import { createReminder, messageKeys } from '@/entities/message'
import type { CreatedReminder, ReminderCreateInput } from '@/entities/message'
import { captureSession } from '@/entities/user'
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
  /** 실패한 만들기를 같은 내용으로 다시 보낸다 */
  retry: () => void
}

const mutationKeyOf = (workspaceId: string) => ['reminder-create', workspaceId] as const

interface Variables {
  input: ReminderCreateInput
  isCurrentSession: () => boolean
}

/**
 * 재촉 만들기 (계약 §5.7 `POST …/messages/reminders`). 메시지 쓰기(useMessageAction)와 같은 규칙이다.
 * - 서버 성공 뒤에만 반영한다. 메시지 캐시를 무효화해 다시 받은 뒤에 끝난다 — 만든 묶음으로 옮겨 가도 목록에 이미 있다
 * - 실패하면 남기고 자동 재시도는 없다. `create` 는 이전 실패를 지운다
 * - 요청 중 세션이 끝났으면 늦은 응답은 캐시에도 결과에도 남기지 않는다
 */
export function useCreateReminder(workspaceId: string): CreateReminderControl {
  const queryClient = useQueryClient()
  const [failure, setFailure] = useState<CreateReminderFailure | null>(null)
  const [lastRun, setLastRun] = useState<{
    input: ReminderCreateInput
    onCreated: (created: CreatedReminder) => void
  } | null>(null)

  const { mutate, isPending } = useMutation<CreatedReminder, Error, Variables>({
    mutationKey: mutationKeyOf(workspaceId),
    retry: false,
    mutationFn: ({ input }) => createReminder(workspaceId, input),
    onSuccess: (_created, { isCurrentSession }) =>
      isCurrentSession()
        ? queryClient.invalidateQueries({ queryKey: messageKeys(workspaceId) })
        : undefined,
    onError: (error, { isCurrentSession }) => {
      if (!isCurrentSession()) return
      setFailure({ error, known: knownCreateFailure(error) })
    },
  })

  const create = useCallback(
    (input: ReminderCreateInput, onCreated: (created: CreatedReminder) => void) => {
      // 같은 틱의 두 번째 누름도 막는다 — 렌더 전의 isPending 은 아직 false 다
      if (queryClient.isMutating({ mutationKey: mutationKeyOf(workspaceId) }) > 0) return
      setFailure(null)
      setLastRun({ input, onCreated })
      const isCurrentSession = captureSession()
      mutate(
        { input, isCurrentSession },
        {
          onSuccess: (created) => {
            if (isCurrentSession()) onCreated(created)
          },
        },
      )
    },
    [queryClient, mutate, workspaceId],
  )

  const retry = useCallback(() => {
    if (lastRun !== null) create(lastRun.input, lastRun.onCreated)
  }, [lastRun, create])

  return { create, pending: isPending, failure, retry }
}
