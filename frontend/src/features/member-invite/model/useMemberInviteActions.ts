import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import {
  cancelInvitation,
  createInvitation,
  latestInvitationsQueryOptions,
  revokeInvitation,
} from '@/entities/invitation'
import type { Invitee } from '@/entities/invitation'
import { errorMessage, failureNotice } from '@/shared/api/errorMessages'
import { CLIENT_ERROR_CODES, createClientError } from '@/shared/api/errors'
import { captureSessionScope } from '@/shared/api/sessionScope'
import type { SessionScope } from '@/shared/api/sessionScope'
import { toast } from '@/shared/ui/toast'

interface Tracked {
  session: SessionScope
}

export interface MemberInviteActions {
  /** 성공하면 알림을 띄우고 `onSuccess` 를 부른다. 실패 문구는 `inviteError` 로 남는다 — 창 안에 보인다 */
  invite: (invitee: Invitee, onSuccess: () => void) => void
  inviteError: string | null
  inviting: boolean
  /** 창을 새로 열 때 지난 초대 요청의 상태를 비운다 */
  resetInvite: () => void
  /** 새로 입력할 때 지난 실패 문구만 지운다. 보내는 중인 요청은 그대로다 */
  clearInviteError: () => void
  cancel: (invitationId: string) => void
  revoke: (invitationId: string, onSettled: () => void) => void
  /** 취소·연결 끊기 중이다 */
  closing: boolean
}

/**
 * 팀원 한 명의 초대 만들기·취소·연결 끊기. 행마다 따로라 한 행의 요청이 다른 행을 막지 않는다.
 * 끝나면(성공·실패) 초대 목록을 다시 받는다 — 다시 초대·연결 끊기는 다른 초대도 닫고, 실패는 화면이 낡았다는 뜻일 수 있다.
 * 요청 중 세션이 바뀌었으면 늦은 응답으로 알림을 띄우지 않는다.
 */
export function useMemberInviteActions(
  workspaceId: string,
  member: { id: string; displayName: string },
): MemberInviteActions {
  const queryClient = useQueryClient()
  const refresh = () =>
    void queryClient.invalidateQueries({
      queryKey: latestInvitationsQueryOptions(workspaceId).queryKey,
    })

  const create = useMutation<void, Error, Tracked & { invitee: Invitee; onSuccess: () => void }>({
    retry: false,
    mutationFn: ({ invitee, session }) => {
      if (!session.isCurrent()) throw createClientError(CLIENT_ERROR_CODES.REQUEST_CANCELED)
      return createInvitation(
        workspaceId,
        { memberId: member.id, userId: invitee.userId },
        session.signal,
      )
    },
    onSuccess: (_, { invitee, onSuccess, session }) => {
      if (!session.isCurrent()) return
      toast.show({
        title: '초대를 만들었어요',
        description: `알림은 가지 않아요. ${member.displayName}에게 ${invitee.username} 계정으로 로그인해 받은 초대를 수락하라고 알려 주세요.`,
      })
      onSuccess()
    },
    // 끝난 세션의 쓰기는 보내지 않았다. 다음 세션의 목록을 다시 받지 않는다
    onSettled: (_data, _error, { session }) => {
      if (session.isCurrent()) refresh()
    },
  })

  // reset() 은 보내는 중인 요청도 끝난 것처럼 보이게 해 중복 전송을 연다 — 입력 중에는 문구만 숨긴다
  const [hiddenError, setHiddenError] = useState<Error | null>(null)

  const close = useMutation<
    void,
    Error,
    Tracked & { kind: 'cancel' | 'revoke'; invitationId: string }
  >({
    retry: false,
    mutationFn: ({ kind, invitationId, session }) => {
      if (!session.isCurrent()) throw createClientError(CLIENT_ERROR_CODES.REQUEST_CANCELED)
      return (kind === 'cancel' ? cancelInvitation : revokeInvitation)(invitationId, session.signal)
    },
    onSuccess: (_, { kind, session }) => {
      if (!session.isCurrent()) return
      toast.show({ title: kind === 'cancel' ? '초대를 취소했어요' : '계정 연결을 끊었어요' })
    },
    onError: (error, { session }) => {
      if (!session.isCurrent()) return
      toast.show({ title: errorMessage(error) })
    },
    // 끝난 세션의 쓰기는 보내지 않았다. 다음 세션의 목록을 다시 받지 않는다
    onSettled: (_data, _error, { session }) => {
      if (session.isCurrent()) refresh()
    },
  })

  return {
    invite: (invitee, onSuccess) => {
      if (create.isPending) return
      create.mutate({ invitee, onSuccess, session: captureSessionScope() })
    },
    inviteError: create.error && create.error !== hiddenError ? failureNotice(create.error) : null,
    inviting: create.isPending,
    resetInvite: create.reset,
    clearInviteError: () => setHiddenError(create.error),
    cancel: (invitationId) => {
      if (close.isPending) return
      close.mutate({ kind: 'cancel', invitationId, session: captureSessionScope() })
    },
    revoke: (invitationId, onSettled) => {
      if (close.isPending) return
      close.mutate({ kind: 'revoke', invitationId, session: captureSessionScope() }, { onSettled })
    },
    closing: close.isPending,
  }
}
