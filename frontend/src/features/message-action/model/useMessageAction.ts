import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useCallback, useState, useSyncExternalStore } from 'react'
import { messageKeys, requestMessageAction } from '@/entities/message'
import type { MessageAction, MessageActionOutcome } from '@/entities/message'
import {
  ApiError,
  CLIENT_ERROR_CODES,
  createClientError,
  isInvalidResponse,
} from '@/shared/api/errors'
import { captureSessionScope } from '@/shared/api/sessionScope'
import type { SessionScope } from '@/shared/api/sessionScope'
import { showWriteUnconfirmed, toast } from '@/shared/ui/toast'
import { ACTION_FAILURE_TITLE, KNOWN_FAILURES, mergeNotice } from '../lib/actionMessages'
import type { KnownFailure } from '../lib/actionMessages'

type ActionKind = MessageAction['kind']

interface ActionVariables {
  action: MessageAction
  /** 행동을 누른 세션. 끝났으면 보내지 않고, 보낸 요청은 취소하며, 화면·캐시에 아무것도 남기지 않는다 */
  session: SessionScope
}

/** 행동의 대상 — 보낼 메시지(묶음), 대화, 또는 태스크를 고를 답장 */
export function actionTarget(action: MessageAction): string {
  if (action.kind === 'reply') return action.threadId
  if (action.kind === 'attribute') return action.messageId
  return action.bundleId
}

/** 마지막 행동의 실패. 다시 시도하면 같은 요청을 다시 보낸다 */
export interface MessageActionFailure {
  action: MessageAction
  title: string
  error: unknown
  /** 화면이 따로 다루는 거절(KNOWN_FAILURES). null 이면 다시 시도할 수 있는 실패다 */
  known: KnownFailure | null
}

export interface RunOptions {
  /** 성공 알림. 없으면 알리지 않는다. 결과에 따라 다르면 함수로 준다. 합쳐졌으면 대신 합쳤다고 알린다 */
  notice?: string | ((outcome: MessageActionOutcome) => string)
  /** 서버가 성공하고 메시지 캐시를 다시 받은 뒤에 부른다 */
  onSuccess?: (outcome: MessageActionOutcome) => void
}

export interface MessageActionControl {
  /** 행동 하나를 보낸다. 진행 중인 행동이 있으면 아무것도 하지 않는다 — 중복 제출을 막는다 */
  run: (action: MessageAction, options?: RunOptions) => void
  /** 진행 중인 행동. 없으면 null */
  pending: { target: string; kind: ActionKind } | null
  failure: MessageActionFailure | null
  /**
   * 그 묶음의 승인이 예정 시각이 지나 거절됐는가.
   * 그 묶음의 시각 저장이 성공하기 전에는 다른 쓰기가 풀지 못한다
   */
  isTimePassed: (bundleId: string) => boolean
  /** 실패한 행동을 같은 내용으로 다시 보낸다 */
  retry: () => void
  /** 실패를 지우고 메시지 목록·대화를 서버에서 새로 받는다 */
  refresh: () => void
}

/** 지난 시각으로 거절된 승인. 메시지 캐시 무효화에 같이 지워지지 않게 메시지 key 밖에 둔다 */
function timePassedKey(workspaceId: string) {
  return ['message-send-time-passed', workspaceId] as const
}

const EMPTY_LOCKS: ReadonlySet<string> = new Set()

function useTimePassedLocks(workspaceId: string): ReadonlySet<string> {
  const queryClient = useQueryClient()
  const key = timePassedKey(workspaceId)
  return useSyncExternalStore(
    (onStoreChange) => queryClient.getQueryCache().subscribe(onStoreChange),
    () => queryClient.getQueryData<ReadonlySet<string>>(key) ?? EMPTY_LOCKS,
  )
}

function rememberTimePassed(
  queryClient: ReturnType<typeof useQueryClient>,
  workspaceId: string,
  bundleId: string,
) {
  const key = timePassedKey(workspaceId)
  const current = queryClient.getQueryData<ReadonlySet<string>>(key) ?? EMPTY_LOCKS
  if (current.has(bundleId)) return
  const next = new Set(current)
  next.add(bundleId)
  queryClient.setQueryData(key, next)
}

function forgetTimePassed(
  queryClient: ReturnType<typeof useQueryClient>,
  workspaceId: string,
  bundleId: string,
) {
  const key = timePassedKey(workspaceId)
  const current = queryClient.getQueryData<ReadonlySet<string>>(key)
  if (current === undefined || !current.has(bundleId)) return
  const next = new Set(current)
  next.delete(bundleId)
  queryClient.setQueryData(key, next)
}

const mutationKeyOf = (workspaceId: string) => ['message-review-action', workspaceId] as const

function knownFailureOf(error: unknown): KnownFailure | null {
  if (!(error instanceof ApiError) || !Object.hasOwn(KNOWN_FAILURES, error.code)) return null
  return KNOWN_FAILURES[error.code]
}

/**
 * 메시지 쓰기 — 승인·보내지 않음·문구·보낼 시각·답장·태스크 빼기·메모·답장의 태스크 고르기 (계약 §5.7).
 * - 서버 성공 뒤에만 반영한다. 낙관적 업데이트는 없다 — 메시지 캐시를 무효화해 서버 상태로 다시 그린다 (D-137, 계획 C-5)
 * - 다시 받기까지 끝나야 mutation 이 끝난다. 그래서 성공 뒤 이동이 처리 전 목록을 잠깐 보이지 않는다
 * - 실패하면 화면은 그대로이고 실패를 남긴다. 자동 재시도는 없고 `retry` 로 다시 보낸다. `run` 은 이전 실패를 지운다
 * - 응답을 읽지 못했으면 반영됐을 수 있어 실패로 남기지 않고 토스트와 `새로고침`(메시지 목록·대화 다시 받기)으로 알린다 (#348)
 * - 화면이 따로 다루는 거절은 KNOWN_FAILURES 표대로 알리고 다시 받거나 승인을 잠근다
 * - 요청 중이나 보내기 전에 세션이 끝났으면 보내지 않고, 늦은 응답은 캐시에도 결과에도 남기지 않는다
 * - 한 공간에서는 한 번에 하나의 쓰기만 나간다
 */
export function useMessageAction(workspaceId: string): MessageActionControl {
  const queryClient = useQueryClient()
  const timePassedLocks = useTimePassedLocks(workspaceId)
  const mutationKey = mutationKeyOf(workspaceId)
  const [failure, setFailure] = useState<MessageActionFailure | null>(null)
  const [lastRun, setLastRun] = useState<{ action: MessageAction; options: RunOptions } | null>(
    null,
  )

  const syncMessages = useCallback(
    () => queryClient.invalidateQueries({ queryKey: messageKeys(workspaceId) }),
    [queryClient, workspaceId],
  )

  const { mutate, isPending, variables } = useMutation<
    MessageActionOutcome,
    Error,
    ActionVariables
  >({
    mutationKey,
    retry: false,
    mutationFn: ({ action, session }) => {
      // 오프라인으로 기다리는 사이 세션이 끝났을 수 있다. 그대로 보내면 다음에 로그인한 계정의 쿠키로 나간다
      if (!session.isCurrent()) throw createClientError(CLIENT_ERROR_CODES.REQUEST_CANCELED)
      return requestMessageAction(workspaceId, action, session.signal)
    },
    onSuccess: (_result, { session }) => (session.isCurrent() ? syncMessages() : undefined),
    onError: (error, { action, session }) => {
      if (!session.isCurrent()) return
      if (isInvalidResponse(error)) {
        showWriteUnconfirmed(() => void syncMessages())
        return
      }
      const known = knownFailureOf(error)
      // 서버가 지난 시각으로 거절한 승인만 잠근다. 시계는 보지 않고, 그 묶음의 시각 저장이 성공해야 풀린다
      if (known?.then === 'lockApproval' && action.kind === 'approve')
        rememberTimePassed(queryClient, workspaceId, action.bundleId)
      if (known?.then === 'refetch') void syncMessages()
      // 다시 받으면 사라질 항목이다. 그 자리에 알리면 항목과 함께 알림도 사라진다
      if (known?.place === 'toast')
        toast.show({ key: 'message-review-action', title: known.message })
      setFailure({
        action,
        title: ACTION_FAILURE_TITLE[action.kind],
        error,
        known,
      })
    },
  })

  const run = useCallback(
    (action: MessageAction, options: RunOptions = {}) => {
      // 같은 틱의 두 번째 누름도 막는다 — 렌더 전의 isPending 은 아직 false 다
      if (queryClient.isMutating({ mutationKey: mutationKeyOf(workspaceId) }) > 0) return
      setFailure(null)
      setLastRun({ action, options })
      const session = captureSessionScope()
      mutate(
        { action, session },
        {
          onSuccess: (outcome) => {
            if (!session.isCurrent()) return
            if (action.kind === 'schedule')
              forgetTimePassed(queryClient, workspaceId, action.bundleId)
            const notice =
              outcome.kind === 'merged'
                ? mergeNotice(outcome.into)
                : typeof options.notice === 'function'
                  ? options.notice(outcome)
                  : options.notice
            if (notice !== undefined) toast.show({ key: 'message-review-action', title: notice })
            options.onSuccess?.(outcome)
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
    isTimePassed: (bundleId) => timePassedLocks.has(bundleId),
    retry,
    refresh,
  }
}
