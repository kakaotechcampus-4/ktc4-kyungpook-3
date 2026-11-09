import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { memberListQueryOptions, updateMember } from '@/entities/member'
import type { Member } from '@/entities/member'
import { captureSession } from '@/entities/user'
import { errorMessage } from '@/shared/api/errorMessages'
import { Button } from '@/shared/ui/button'
import { Modal } from '@/shared/ui/modal'
import { toast } from '@/shared/ui/toast'

interface MemberRoleControlProps {
  workspaceId: string
  member: Member
}

export function MemberRoleControl({ workspaceId, member }: MemberRoleControlProps) {
  const [open, setOpen] = useState(false)
  const queryClient = useQueryClient()
  const mutation = useMutation<Member, Error, () => boolean>({
    mutationFn: () => updateMember(member.id, { role: 'pm' }),
    retry: false,
    onSuccess: (updated, isCurrentSession) => {
      if (!isCurrentSession()) return
      setOpen(false)
      toast.show({ title: `${member.displayName}에게 PM 권한을 부여했어요` })
      queryClient.setQueryData(memberListQueryOptions(workspaceId).queryKey, (members) =>
        members?.map((current) => (current.id === updated.id ? updated : current)),
      )
    },
    onSettled: (_, __, isCurrentSession) => {
      if (isCurrentSession())
        void queryClient.invalidateQueries({
          queryKey: memberListQueryOptions(workspaceId).queryKey,
        })
    },
  })

  if (member.role !== 'member' || !member.hasLoginAccount) return null

  return (
    <div className="mt-6">
      <Button
        size="sm"
        variant="ghost"
        onClick={() => {
          mutation.reset()
          setOpen(true)
        }}
      >
        PM 권한 부여
      </Button>
      <Modal
        open={open}
        onOpenChange={(next) => {
          if (!mutation.isPending) setOpen(next)
        }}
        title={`${member.displayName}에게 PM 권한을 부여할까요?`}
        description="이 팀원도 팀 설정과 업무 승인, 팀원 초대를 관리할 수 있어요. 내 PM 권한은 유지돼요."
        actions={
          <>
            <Button variant="ghost" disabled={mutation.isPending} onClick={() => setOpen(false)}>
              닫기
            </Button>
            <Button
              variant="primary"
              loading={mutation.isPending}
              onClick={() => {
                if (!mutation.isPending) mutation.mutate(captureSession())
              }}
            >
              PM 권한 부여
            </Button>
          </>
        }
      >
        {mutation.error ? (
          <p role="alert" className="text-caption text-accent">
            {errorMessage(mutation.error)}
          </p>
        ) : null}
      </Modal>
    </div>
  )
}
