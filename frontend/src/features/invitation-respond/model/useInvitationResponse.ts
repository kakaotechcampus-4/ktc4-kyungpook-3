import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useRef, useState } from 'react'
import {
  acceptInvitation,
  declineInvitation,
  myInvitationsQueryOptions,
} from '@/entities/invitation'
import type { MyInvitation } from '@/entities/invitation'
import { captureSession } from '@/entities/user'
import { fetchFreshWorkspaces } from '@/entities/workspace'
import type { Workspace } from '@/entities/workspace'
import { errorMessage } from '@/shared/api/errorMessages'
import { ApiError, ERROR_CODES } from '@/shared/api/errors'
import { toast } from '@/shared/ui/toast'
import { ACCEPT_CLOSED_MESSAGE } from './messages'

/** 초대가 닫혔다는 거절. 이미 그 공간 팀원일 수도 있어 새 목록을 보고 정한다 */
const CLOSED_CODES: ReadonlySet<string> = new Set([
  ERROR_CODES.INVITATION_NOT_FOUND,
  ERROR_CODES.INVITATION_NOT_PENDING,
  ERROR_CODES.MEMBER_ALREADY_LINKED,
  ERROR_CODES.ALREADY_WORKSPACE_MEMBER,
])

const isClosed = (error: unknown) => error instanceof ApiError && CLOSED_CODES.has(error.code)

export interface InvitationResponseControl {
  accept: (invitation: MyInvitation) => void
  /** 사용자가 확인한 뒤 부른다. 성공하면 그 줄이 목록에서 빠진다 */
  decline: (invitation: MyInvitation) => void
  /** 요청 중인 초대. 한 번에 하나라 그동안 모든 줄의 버튼을 막는다 */
  pendingId: string | null
}

/**
 * 받은 초대의 수락·거절.
 * 수락은 「지금 그 공간에 들어갈 수 있는가」로 끝을 정한다 — 수락 뒤 공간 목록을 새로 받고(가드가 목록 캐시만 본다)
 * 그 공간이 있으면 `onAccepted` 로 들어간다. 닫힌 초대라는 거절도 목록에 공간이 있으면 들어간다(두 번 누름·다른 탭·이미 팀원).
 * 목록에 없을 때만 수락할 수 없다고 알린다. 요청 중 세션이 바뀌었으면 늦은 응답은 아무것도 하지 않는다.
 */
export function useInvitationResponse(
  onAccepted: (workspace: Workspace) => void,
): InvitationResponseControl {
  const queryClient = useQueryClient()
  const [pendingId, setPendingId] = useState<string | null>(null)
  const inFlight = useRef(false)

  const refreshMine = useCallback(
    () => void queryClient.invalidateQueries({ queryKey: myInvitationsQueryOptions().queryKey }),
    [queryClient],
  )

  const run = useCallback(
    async (invitation: MyInvitation, work: (isCurrent: () => boolean) => Promise<void>) => {
      if (inFlight.current) return
      inFlight.current = true
      setPendingId(invitation.id)
      try {
        await work(captureSession())
      } finally {
        inFlight.current = false
        setPendingId(null)
      }
    },
    [],
  )

  const accept = useCallback(
    (invitation: MyInvitation) =>
      void run(invitation, async (isCurrent) => {
        try {
          await acceptInvitation(invitation.id)
        } catch (error) {
          if (!isClosed(error)) {
            if (isCurrent()) {
              toast.show({ title: errorMessage(error) })
              refreshMine()
            }
            return
          }
        }
        let workspaces: Workspace[]
        try {
          workspaces = await fetchFreshWorkspaces(queryClient)
        } catch (error) {
          if (isCurrent()) {
            toast.show({ title: errorMessage(error) })
            refreshMine()
          }
          return
        }
        if (!isCurrent()) return
        refreshMine()
        const workspace = workspaces.find(({ id }) => id === invitation.workspaceId)
        if (workspace) onAccepted(workspace)
        else toast.show({ title: ACCEPT_CLOSED_MESSAGE })
      }),
    [run, queryClient, refreshMine, onAccepted],
  )

  const decline = useCallback(
    (invitation: MyInvitation) =>
      void run(invitation, async (isCurrent) => {
        try {
          await declineInvitation(invitation.id)
          if (isCurrent())
            queryClient.setQueryData(myInvitationsQueryOptions().queryKey, (current) =>
              current?.filter(({ id }) => id !== invitation.id),
            )
        } catch (error) {
          if (isCurrent()) toast.show({ title: errorMessage(error) })
        }
        if (isCurrent()) refreshMine()
      }),
    [run, queryClient, refreshMine],
  )

  return { accept, decline, pendingId }
}
