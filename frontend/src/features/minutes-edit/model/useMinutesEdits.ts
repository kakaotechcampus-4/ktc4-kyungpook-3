import { useMutation, useMutationState, useQueryClient } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import { meetingDetailQueryOptions } from '@/entities/meeting'
import { editMeetingTitle, editTranscriptLine, minutesQueryOptions } from '@/entities/minutes'
import type { LineEdit, Minutes, TitleEdit } from '@/entities/minutes'
import { CLIENT_ERROR_CODES, createClientError, isInvalidResponse } from '@/shared/api/errors'
import { workspaceKey } from '@/shared/api/queryKeys'
import { captureSessionScope } from '@/shared/api/sessionScope'
import type { SessionScope } from '@/shared/api/sessionScope'
import { showWriteUnconfirmed, toast } from '@/shared/ui/toast'
import {
  DELETED_MEETING,
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
  /** 지금 저장 중인 대상. 없으면 null 이다. 이 훅이 아니라 mutation 캐시에서 읽어, 화면이 다시 그려져도(탭 왕복) 남는다 */
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
  const mutationKey = ['minutes-edit', workspaceId, meetingId, kind] as const
  const reload = () => void refresh(queryClient)

  // 잠금과 실패 문구는 이 훅이 아니라 mutation 캐시에서 읽는다. 탭을 떠나 화면이 다시 마운트돼도 그 요청의 상태가 남는다
  const attempts = useMutationState({
    filters: { mutationKey },
    select: ({ state }) => ({
      status: state.status,
      submittedAt: state.submittedAt,
      variables: state.variables as Variables<Target> | undefined,
      error: state.error,
    }),
  })
  const pending = attempts.find(({ status }) => status === 'pending')?.variables
  const latest = attempts.reduce<(typeof attempts)[number] | undefined>(
    (newest, attempt) =>
      newest === undefined || attempt.submittedAt >= newest.submittedAt ? attempt : newest,
    undefined,
  )
  const failure = latest === undefined ? null : inlineFailure(latest, kind)
  /** 끝난 시도(실패·성공)를 mutation 캐시에서 뺀다. 그 줄을 다시 열거나 새로 저장할 때 부른다. 그래서 key 마다 끝난 시도는 많아야 하나다 */
  const clearFailure = () => {
    const cache = queryClient.getMutationCache()
    for (const settled of cache.findAll({ mutationKey }))
      if (settled.state.status !== 'pending') cache.remove(settled)
  }
  const mutation = useMutation<Result, Error, Variables<Target>>({
    mutationKey,
    retry: false,
    // 실패 문구를 이 요청의 결과에서 읽는다. 기본 5분 수거를 끄고, 지우기는 clearFailure 가 맡는다.
    // 세션이 끝나도 남을 수 있지만 다른 세션의 실패는 보이지 않고(inlineFailure), 앱을 버릴 때 queryClient.clear 가 비운다
    gcTime: Infinity,
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
    onError: (error, { session }) => {
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
      // 그 밖의 실패 문구는 이 요청의 결과에서 읽어 그 칸 아래에 보인다(inlineFailure)
      if (isDeletedMeeting(error)) toast.show({ title: DELETED_MEETING })
    },
  })

  return {
    save: (target, onSaved) => {
      if (queryClient.isMutating({ mutationKey }) > 0) return
      clearFailure()
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
    saving: pending?.target ?? null,
    failure,
    clearFailure,
  }
}

/**
 * 칸 아래에 남길 실패 문구. 가장 최근 시도가 실패했을 때만이다. 세션이 바뀐 요청, 취소, 응답을 못 읽은 것(토스트),
 * 삭제된 회의(토스트)는 칸 아래에 남기지 않는다
 */
function inlineFailure<Target>(
  attempt: { status: string; variables?: Variables<Target>; error: unknown },
  kind: 'title' | 'line',
): EditActions<Target>['failure'] {
  const { status, variables, error } = attempt
  if (status !== 'error' || variables === undefined || !variables.session.isCurrent()) return null
  if (isInvalidResponse(error) || isDeletedMeeting(error)) return null
  const message = editFailure(error, kind)
  return message === null ? null : { target: variables.target, message }
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
      // 다시 받기는 기다리지 않는다. 회의록은 위에서 이미 바뀌었고, 느린 재조회가 알림·포커스를 붙잡지 않는다
      void refreshTitleReaders(queryClient)
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
