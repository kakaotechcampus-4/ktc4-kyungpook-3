import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import { messageKeys, requestMessageAction } from '@/entities/message'
import type { MessageAction } from '@/entities/message'
import { captureSession } from '@/entities/user'
import { ApiError } from '@/shared/api/errors'
import { toast } from '@/shared/ui/toast'
import { ACTION_FAILURE_TITLE } from '../lib/actionMessages'

type ActionKind = MessageAction['kind']

interface ActionVariables {
  action: MessageAction
  isCurrentSession: () => boolean
}

/** 행동의 대상 — 보내기 전 확인 항목, 대화, 또는 답장 */
export function actionTarget(action: MessageAction): string {
  switch (action.kind) {
    case 'send':
    case 'dismiss':
    case 'edit':
    case 'schedule':
      return action.reviewId
    case 'reply':
      return action.threadId
    case 'attribute':
      return action.messageId
  }
}

/** 마지막 행동의 실패. 다시 시도하면 같은 요청을 다시 보낸다 */
export interface MessageActionFailure {
  action: MessageAction
  title: string
  error: unknown
  /**
   * gone: 404 → 목록 새로 받기
   * time_passed: 409 MESSAGE_SCHEDULE_PASSED → 예정 시각이 지났어요, 다시 시도 없음
   * error: 다시 시도
   */
  cause: 'gone' | 'time_passed' | 'error'
}

export interface RunOptions {
  /** 성공 알림. 없으면 알리지 않는다 */
  notice?: string
  /** 서버가 성공하고 메시지 캐시를 다시 받은 뒤에 부른다 */
  onSuccess?: () => void
}

export interface MessageActionControl {
  /** 행동 하나를 보낸다. 진행 중인 행동이 있으면 아무것도 하지 않는다 — 중복 제출을 막는다 */
  run: (action: MessageAction, options?: RunOptions) => void
  /** 진행 중인 행동. 없으면 null */
  pending: { target: string; kind: ActionKind } | null
  failure: MessageActionFailure | null
  /** 실패한 행동을 같은 내용으로 다시 보낸다 */
  retry: () => void
  /** 실패를 지우고 메시지 목록·대화를 서버에서 새로 받는다 */
  refresh: () => void
}

const mutationKeyOf = (workspaceId: string) => ['message-review-action', workspaceId] as const

function causeOf(error: unknown): MessageActionFailure['cause'] {
  if (!(error instanceof ApiError)) return 'error'
  if (error.status === 404) return 'gone'
  if (error.status === 409 && error.code === 'MESSAGE_SCHEDULE_PASSED') return 'time_passed'
  return 'error'
}

/**
 * 메시지 쓰기 — 발송·보내지 않음·고쳐 쓰기·발송 시점·답장·답장 판정 (M8, 결정 4 의 UI 범위는 디자인 캔버스 기준 MSW 목).
 * - 서버 성공 뒤에만 반영한다. 낙관적 업데이트는 없다 — 메시지 캐시를 무효화해 서버 상태로 다시 그린다 (D-137, 계획 C-5)
 * - 다시 받기까지 끝나야 mutation 이 끝난다. 그래서 성공 뒤 이동이 처리 전 목록을 잠깐 보이지 않는다
 * - 실패하면 화면은 그대로이고 실패를 남긴다. 자동 재시도는 없고 `retry` 로 다시 보낸다. `run` 은 이전 실패를 지운다
 * - 요청 중 세션이 끝났으면 늦은 응답은 캐시에도 결과에도 남기지 않는다
 * - 한 공간에서는 한 번에 하나의 쓰기만 나간다
 */
export function useMessageAction(workspaceId: string): MessageActionControl {
  const queryClient = useQueryClient()
  const mutationKey = mutationKeyOf(workspaceId)
  const [failure, setFailure] = useState<MessageActionFailure | null>(null)
  const [lastRun, setLastRun] = useState<{ action: MessageAction; options: RunOptions } | null>(
    null,
  )

  const syncMessages = useCallback(
    () => queryClient.invalidateQueries({ queryKey: messageKeys(workspaceId) }),
    [queryClient, workspaceId],
  )

  const { mutate, isPending, variables } = useMutation<void, Error, ActionVariables>({
    mutationKey,
    retry: false,
    mutationFn: ({ action }) => requestMessageAction(workspaceId, action),
    onSuccess: (_result, { isCurrentSession }) => (isCurrentSession() ? syncMessages() : undefined),
    onError: (error, { action, isCurrentSession }) => {
      if (!isCurrentSession()) return
      // 이미 처리됐거나 사라진 항목이면 다시 보내도 같다. 목록은 사람이 알림을 읽은 뒤 새로 받는다 —
      // 바로 받으면 항목과 함께 알림 자리도 사라진다
      setFailure({
        action,
        title: ACTION_FAILURE_TITLE[action.kind],
        error,
        cause: causeOf(error),
      })
    },
  })

  const run = useCallback(
    (action: MessageAction, options: RunOptions = {}) => {
      // 같은 틱의 두 번째 누름도 막는다 — 렌더 전의 isPending 은 아직 false 다
      if (queryClient.isMutating({ mutationKey: mutationKeyOf(workspaceId) }) > 0) return
      setFailure(null)
      setLastRun({ action, options })
      const isCurrentSession = captureSession()
      mutate(
        { action, isCurrentSession },
        {
          onSuccess: () => {
            if (!isCurrentSession()) return
            if (options.notice !== undefined)
              toast.show({ key: 'message-review-action', title: options.notice })
            options.onSuccess?.()
          },
        },
      )
    },
    [queryClient, mutate, workspaceId],
  )

  const retry = useCallback(() => {
    if (lastRun !== null) run(lastRun.action, lastRun.options)
  }, [lastRun, run])

  const refresh = useCallback(() => {
    setFailure(null)
    void syncMessages()
  }, [syncMessages])

  return {
    run,
    pending:
      isPending && variables !== undefined
        ? { target: actionTarget(variables.action), kind: variables.action.kind }
        : null,
    failure,
    retry,
    refresh,
  }
}
