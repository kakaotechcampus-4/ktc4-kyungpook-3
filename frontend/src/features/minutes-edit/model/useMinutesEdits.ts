import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { meetingDetailQueryOptions } from '@/entities/meeting'
import { editMeetingTitle, editTranscriptLine, minutesQueryOptions } from '@/entities/minutes'
import type { LineEdit, Minutes, TitleEdit } from '@/entities/minutes'
import { CLIENT_ERROR_CODES, createClientError, isInvalidResponse } from '@/shared/api/errors'
import { workspaceKey } from '@/shared/api/queryKeys'
import { captureSessionScope } from '@/shared/api/sessionScope'
import type { SessionScope } from '@/shared/api/sessionScope'
import { showWriteUnconfirmed, toast } from '@/shared/ui/toast'
import {
  editFailure,
  isDeletedMeeting,
  isMissingLine,
  lineReverted,
  titleReverted,
} from '../lib/editMessages'

/** 고친 것 하나의 결과. 실패 문구는 그 칸(제목이나 그 줄) 아래에 남긴다 */
export interface EditActions<Target> {
  /** `null` 은 되돌리기다. 끝나기 전 같은 회의의 같은 종류 고치기는 받지 않는다. 저장되면 `onSaved` 를 부른다 */
  save: (target: Target, onSaved?: () => void) => void
  /** 지금 저장 중인 대상. 없으면 null 이다 */
  saving: Target | null
  failure: { target: Target; message: string } | null
  clearFailure: () => void
}

interface Variables<Target> {
  target: Target
  session: SessionScope
}

type TitleTarget = { title: string | null }
type LineTarget = { seq: number; text: string | null }

function useEdit<Target, Result>({
  workspaceId,
  meetingId,
  kind,
  send,
  apply,
  refresh,
  reverts,
  reverted,
}: {
  workspaceId: string
  meetingId: string
  kind: 'title' | 'line'
  send: (target: Target, signal: AbortSignal) => Promise<Result>
  /** 응답을 캐시에 넣는다 (계약 §4.4.3) */
  apply: (queryClient: QueryClient, result: Result) => Promise<void>
  /** 결과를 모를 때 다시 받을 캐시 */
  refresh: (queryClient: QueryClient) => Promise<unknown>
  reverts: (target: Target) => boolean
  reverted: string
}): EditActions<Target> {
  const queryClient = useQueryClient()
  const [failure, setFailure] = useState<EditActions<Target>['failure']>(null)
  const mutationKey = ['minutes-edit', workspaceId, meetingId, kind] as const
  const reload = () => void refresh(queryClient)

  const mutation = useMutation<Result, Error, Variables<Target>>({
    mutationKey,
    retry: false,
    mutationFn: async ({ target, session }) => {
      // 앞선 일을 기다리는 사이 세션이 끝났을 수 있다. 그대로 보내면 다음에 로그인한 계정의 쿠키로 저장된다
      if (!session.isCurrent()) throw createClientError(CLIENT_ERROR_CODES.REQUEST_CANCELED)
      return send(target, session.signal)
    },
    onSuccess: async (result, { target, session }) => {
      if (!session.isCurrent()) return
      await apply(queryClient, result)
      if (session.isCurrent() && reverts(target)) toast.show({ title: reverted })
    },
    onError: (error, { target, session }) => {
      if (!session.isCurrent()) return
      // 응답을 읽지 못했다. 저장됐을 수 있어 실패로 보이지 않고 고치던 글은 그대로 둔다 (D-184)
      if (isInvalidResponse(error)) {
        reload()
        showWriteUnconfirmed(reload)
        return
      }
      if (isDeletedMeeting(error)) {
        // 회의록 자리가 「삭제된 회의」 안내로 바뀌어 고치던 칸이 사라진다. 이유는 알림으로 남긴다
        void queryClient.invalidateQueries({
          queryKey: meetingDetailQueryOptions(workspaceId, meetingId).queryKey,
        })
        reload()
      } else if (isMissingLine(error)) reload()
      const message = editFailure(error, kind)
      if (message === null) return
      if (isDeletedMeeting(error)) toast.show({ title: message })
      else setFailure({ target, message })
    },
  })

  return {
    save: (target, onSaved) => {
      if (queryClient.isMutating({ mutationKey }) > 0) return
      setFailure(null)
      const session = captureSessionScope()
      mutation.mutate(
        { target, session },
        {
          onSuccess: () => {
            if (session.isCurrent()) onSaved?.()
          },
        },
      )
    },
    saving: mutation.isPending ? (mutation.variables?.target ?? null) : null,
    failure,
    clearFailure: () => setFailure(null),
  }
}

/**
 * 회의 제목 고치기·되돌리기 (#551). 팀원 누구나 쓴다. 다른 회의록·목록·프로젝트 맵이 이 제목을 함께 보여 줘
 * 회의록은 응답으로 바로 바꾸고 회의(목록·상세)·회의록 전체·프로젝트 맵을 다시 받는다 (§4.4.3)
 */
export function useTitleEdit(workspaceId: string, meetingId: string): EditActions<TitleTarget> {
  const refreshTitleReaders = (queryClient: QueryClient) =>
    Promise.all(
      (['meetings', 'minutes', 'project-map'] as const).map((part) =>
        queryClient.invalidateQueries({ queryKey: workspaceKey(workspaceId, part) }),
      ),
    )
  return useEdit<TitleTarget, TitleEdit>({
    workspaceId,
    meetingId,
    kind: 'title',
    send: ({ title }, signal) => editMeetingTitle(meetingId, title, signal),
    apply: async (queryClient, edit) => {
      const minutesKey = minutesQueryOptions(workspaceId, meetingId).queryKey
      await queryClient.cancelQueries({ queryKey: minutesKey })
      queryClient.setQueryData<Minutes>(minutesKey, (minutes) =>
        minutes === undefined
          ? undefined
          : {
              ...minutes,
              title: edit.title,
              titleEdited: edit.titleEdited,
              titleOriginal: edit.titleOriginal,
            },
      )
      await refreshTitleReaders(queryClient)
    },
    refresh: refreshTitleReaders,
    reverts: ({ title }) => title === null,
    reverted: titleReverted,
  })
}

/**
 * 발화 한 줄 고치기·되돌리기 (#551). 팀원 누구나 쓴다. 이 회의록의 그 줄만 응답으로 바꾸고 다른 캐시는 그대로다 (§4.4.3).
 * 그 사이 다시 받던 회의록은 고치기 전 값일 수 있어 먼저 멈춘다
 */
export function useLineEdit(workspaceId: string, meetingId: string): EditActions<LineTarget> {
  return useEdit<LineTarget, LineEdit>({
    workspaceId,
    meetingId,
    kind: 'line',
    send: ({ seq, text }, signal) => editTranscriptLine(meetingId, seq, text, signal),
    apply: async (queryClient, edit) => {
      const minutesKey = minutesQueryOptions(workspaceId, meetingId).queryKey
      await queryClient.cancelQueries({ queryKey: minutesKey })
      queryClient.setQueryData<Minutes>(minutesKey, (minutes) =>
        minutes === undefined
          ? undefined
          : {
              ...minutes,
              transcript: minutes.transcript.map((line) =>
                line.seq === edit.seq
                  ? {
                      ...line,
                      text: edit.text,
                      edited: edit.edited,
                      originalText: edit.originalText,
                    }
                  : line,
              ),
            },
      )
    },
    refresh: (queryClient) =>
      queryClient.invalidateQueries({
        queryKey: minutesQueryOptions(workspaceId, meetingId).queryKey,
      }),
    reverts: ({ text }) => text === null,
    reverted: lineReverted,
  })
}
