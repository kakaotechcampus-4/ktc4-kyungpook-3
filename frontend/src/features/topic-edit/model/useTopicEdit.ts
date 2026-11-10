import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import {
  projectMapQueryOptions,
  refreshTopicEdits,
  sendTopicEdit,
  writeTopicEdit,
} from '@/entities/project-map'
import type { TopicDetail, TopicEdit } from '@/entities/project-map'
import { failureNotice } from '@/shared/api/errorMessages'
import {
  ApiError,
  CLIENT_ERROR_CODES,
  ERROR_CODES,
  createClientError,
  isInvalidResponse,
} from '@/shared/api/errors'
import { captureSessionScope } from '@/shared/api/sessionScope'
import type { SessionScope } from '@/shared/api/sessionScope'
import { showWriteUnconfirmed } from '@/shared/ui/toast'

export interface TopicEditFailure {
  /** 실패한 고치기. 그 고치기를 연 폼·확인 창이 문구를 보인다 */
  edit: TopicEdit
  message: string
  /** 409 `TOPIC_NAME_TAKEN` 이 알려 준, 그 이름을 쓰는 주제. 합치기를 권한다 */
  takenTopicId: string | null
}

export interface TopicEditor {
  /**
   * 고친다. 다른 고치기가 저장 중이면 아무것도 하지 않는다.
   * `onDone` 은 같은 세션이고 패널이 아직 이 주제를 보일 때만 부른다
   */
  run: (edit: TopicEdit, onDone?: (topic: TopicDetail) => void) => void
  pending: boolean
  failure: TopicEditFailure | null
  clearFailure: () => void
}

interface Variables {
  edit: TopicEdit
  session: SessionScope
  /** 누른 패널이 아직 같은 주제를 보이는가 */
  isCurrent: () => boolean
}

/* 맵이 낡았다. 대상이 사라졌거나, 맵을 받은 뒤 같은 이름의 주제가 생겼다. 맵을 다시 받아 화면이 따라오게 한다 */
const STALE_MAP = new Set<string>([
  ERROR_CODES.TOPIC_NAME_TAKEN,
  ERROR_CODES.TOPIC_NOT_FOUND,
  ERROR_CODES.DECISION_NOT_FOUND,
  ERROR_CODES.TASK_NOT_FOUND,
])

function takenTopicOf(error: unknown): string | null {
  if (!(error instanceof ApiError) || error.code !== ERROR_CODES.TOPIC_NAME_TAKEN) return null
  const topicId = error.details?.topic_id
  return typeof topicId === 'string' ? topicId : null
}

/**
 * 주제 패널의 고치기 (#551 묶음 B, 계약 §4.4.3). 한 공간에서 한 번에 하나만 보낸다 — 응답마다 주제 전체가 오므로
 * 겹치면 늦게 온 옛 응답이 캐시를 덮을 수 있다.
 * - 성공하면 응답을 캐시에 쓰고 맵·회의록을 다시 받게 한다 (`writeTopicEdit`)
 * - 응답을 읽지 못하면 실패라 하지 않고 확인 알림만 띄운다
 * - 끝난 세션의 요청은 보내지 않고, 응답이 와도 캐시·화면에 아무것도 남기지 않는다
 */
export function useTopicEdit(workspaceId: string, topicId: string): TopicEditor {
  const queryClient = useQueryClient()
  const [failure, setFailure] = useState<TopicEditFailure | null>(null)
  const scope = useRef<object | null>(null)
  useLayoutEffect(() => {
    scope.current = {}
    return () => {
      scope.current = null
    }
  }, [workspaceId, topicId])

  const { mutate, isPending } = useMutation<TopicDetail, Error, Variables>({
    mutationKey: ['topic-edit', workspaceId],
    retry: false,
    mutationFn: ({ edit, session }) => {
      if (!session.isCurrent()) throw createClientError(CLIENT_ERROR_CODES.REQUEST_CANCELED)
      return sendTopicEdit(workspaceId, topicId, edit, { signal: session.signal })
    },
    onSuccess: (topic, { edit, session }) => {
      if (!session.isCurrent()) return
      writeTopicEdit(queryClient, workspaceId, topicId, edit, topic)
    },
    onError: (error, { edit, session, isCurrent }) => {
      if (!session.isCurrent()) return
      if (isInvalidResponse(error)) {
        showWriteUnconfirmed(() => refreshTopicEdits(queryClient, workspaceId))
        return
      }
      const message = failureNotice(error)
      if (message === null) return
      if (error instanceof ApiError && STALE_MAP.has(error.code))
        void queryClient.invalidateQueries({
          queryKey: projectMapQueryOptions(workspaceId).queryKey,
        })
      if (isCurrent()) setFailure({ edit, message, takenTopicId: takenTopicOf(error) })
    },
  })

  const run = useCallback(
    (edit: TopicEdit, onDone?: (topic: TopicDetail) => void) => {
      // 같은 틱의 두 번째 누름도 막는다 — 렌더 전의 isPending 은 아직 false 다
      if (queryClient.isMutating({ mutationKey: ['topic-edit', workspaceId] }) > 0) return
      setFailure(null)
      const session = captureSessionScope()
      const started = scope.current
      const isCurrent = () => started !== null && scope.current === started
      mutate(
        { edit, session, isCurrent },
        {
          onSuccess: (topic) => {
            if (session.isCurrent() && isCurrent()) onDone?.(topic)
          },
        },
      )
    },
    [queryClient, mutate, workspaceId],
  )

  const clearFailure = useCallback(() => setFailure(null), [])

  return { run, pending: isPending, failure, clearFailure }
}
