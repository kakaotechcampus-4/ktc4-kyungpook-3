import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useLayoutEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router'
import { z } from 'zod'
import { request } from '@/shared/api/client'
import { ApiError, CLIENT_ERROR_CODES, createClientError } from '@/shared/api/errors'
import { workspaceKey } from '@/shared/api/queryKeys'
import { captureSessionScope } from '@/shared/api/sessionScope'
import type { SessionScope } from '@/shared/api/sessionScope'
import { paths } from '@/shared/config/routes'
import { useGuardedNavigate } from '@/shared/lib/unsaved-changes'
import { Button } from '@/shared/ui/button'
import { Modal } from '@/shared/ui/modal'
import { toast } from '@/shared/ui/toast'

const receiptSchema = z.object({
  meeting_id: z.string().min(1),
  deleted_at: z.string().datetime({ offset: true }),
  cleanup_status: z.enum(['pending', 'complete']),
  deleted_meeting_ids: z.array(z.string().min(1)).min(1),
})

interface Attempt {
  session: SessionScope
  isCurrent: () => boolean
}

export function MeetingDelete({
  workspaceId,
  meetingId,
  onDeleted,
}: {
  workspaceId: string
  meetingId: string
  onDeleted: (meetingId: string) => void
}) {
  const client = useQueryClient()
  const navigate = useGuardedNavigate()
  const location = useLocation()
  const [open, setOpen] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const scope = useRef<object | null>(null)
  useLayoutEffect(() => {
    scope.current = {}
    return () => {
      scope.current = null
    }
  }, [workspaceId, meetingId, location.key])
  const mutationKey = ['meeting-delete', workspaceId, meetingId]
  const deletion = useMutation({
    mutationKey,
    retry: false,
    mutationFn: async ({ session, isCurrent }: Attempt) => {
      if (!session.isCurrent() || !isCurrent())
        throw createClientError(CLIENT_ERROR_CODES.REQUEST_CANCELED)
      const wire = await request<unknown>(`/meetings/${encodeURIComponent(meetingId)}`, {
        method: 'DELETE',
        signal: session.signal,
      })
      const parsed = receiptSchema.safeParse(wire)
      if (
        !parsed.success ||
        parsed.data.meeting_id !== meetingId ||
        !parsed.data.deleted_meeting_ids.includes(meetingId)
      )
        throw createClientError(CLIENT_ERROR_CODES.INVALID_RESPONSE)
      return parsed.data
    },
    onSuccess: async (receipt, attempt) => {
      if (!attempt.session.isCurrent()) return
      await client.cancelQueries({ queryKey: workspaceKey(workspaceId) })
      if (!attempt.session.isCurrent()) return
      // Resetting the current detail can unmount this control. Check the route before that reset.
      const isCurrent = attempt.isCurrent()
      const rawQueryKeys = [
        ...receipt.deleted_meeting_ids.map((deletedId) =>
          workspaceKey(workspaceId, 'meetings', 'detail', deletedId),
        ),
        ...['minutes', 'extractions', 'approvals', 'dashboard'].map((part) =>
          workspaceKey(workspaceId, part),
        ),
      ]
      const refreshes = rawQueryKeys.map((queryKey) => {
        client.removeQueries({ queryKey, type: 'inactive' })
        // Active observers must be notified: removal alone leaves their old raw data visible.
        return client.resetQueries({ queryKey, type: 'active' })
      })
      // Lists carry title/source quotes too. Remove the deleted row before the next response.
      client.setQueryData(
        workspaceKey(workspaceId, 'meetings', 'list'),
        (meetings: { id: string }[] | undefined) =>
          meetings?.filter(({ id }) => !receipt.deleted_meeting_ids.includes(id)),
      )
      void Promise.allSettled([
        ...refreshes,
        client.invalidateQueries({ queryKey: workspaceKey(workspaceId) }),
      ])
      if (!isCurrent) return
      onDeleted(meetingId)
      toast.show({
        title:
          receipt.cleanup_status === 'pending'
            ? '회의를 삭제했어요. 남은 파일을 정리하고 있어요.'
            : '회의를 삭제했어요.',
      })
      navigate(paths.meetings(workspaceId), { replace: true })
    },
    onError: (error, attempt) => {
      if (!attempt.session.isCurrent() || !attempt.isCurrent()) return
      setFailure(
        error instanceof ApiError && error.code === 'MEETING_DELETE_BLOCKED'
          ? '정리 중인 회의는 삭제할 수 없어요'
          : '회의를 삭제하지 못했어요',
      )
    },
  })
  function confirm() {
    if (client.isMutating({ mutationKey }) > 0) return
    setFailure(null)
    const started = scope.current
    deletion.mutate({
      session: captureSessionScope(),
      isCurrent: () => started !== null && scope.current === started,
    })
  }
  return (
    <>
      <Button
        variant="text"
        size="sm"
        onClick={() => {
          setFailure(null)
          setOpen(true)
        }}
      >
        회의 삭제
      </Button>
      <Modal
        open={open}
        onOpenChange={(next) => {
          if (!deletion.isPending) setOpen(next)
        }}
        title="회의를 삭제할까요?"
        description={
          <>
            원문·회의록·근거와 녹음 파일을 삭제해요. 생성된 태스크는 남아요. 되돌릴 수 없어요.
            <span className="mt-8 block">정리가 끝났거나 실패한 회의만 삭제할 수 있어요.</span>
            {failure === null ? null : (
              <span role="alert" className="mt-8 block text-danger">
                {failure}
              </span>
            )}
          </>
        }
        actions={
          <>
            <Button variant="ghost" disabled={deletion.isPending} onClick={() => setOpen(false)}>
              취소
            </Button>
            <Button variant="primary" loading={deletion.isPending} onClick={confirm}>
              삭제하기
            </Button>
          </>
        }
      />
    </>
  )
}
