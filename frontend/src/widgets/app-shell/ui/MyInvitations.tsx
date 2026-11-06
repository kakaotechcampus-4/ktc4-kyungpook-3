import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { myInvitationsQueryOptions } from '@/entities/invitation'
import type { MyInvitation } from '@/entities/invitation'
import { captureAccountIntro } from '@/entities/user'
import { workspaceListQueryOptions } from '@/entities/workspace'
import { useInvitationResponse } from '@/features/invitation-respond'
import { useEnterWorkspace } from '@/features/workspace-switch'
import { Button } from '@/shared/ui/button'
import { Modal } from '@/shared/ui/modal'
import { QueryErrorState } from '@/shared/ui/query-error-state'

const HEADING = 'text-[13px] font-semibold text-sub'
const ROW = 'flex items-center gap-12 rounded-10 border border-line bg-surface px-14 py-11'
const NAME = 'text-body font-semibold text-ink'
const META = 'text-[12px] text-dim'

/**
 * 내 가입 이메일로 온 초대. 수락하면 그 공간에 들어간다 — 공간에 들어가는 길은 useEnterWorkspace 하나다.
 * 거절은 되돌릴 수 없어 먼저 묻는다. 초대도 소속 공간도 없으면 PM 에게 초대를 요청하라고 알린다.
 * 소속 공간이 있고 초대가 없으면 아무것도 그리지 않는다. 불러오는 동안도 그리지 않는다.
 * 온보딩 화면(`onboarding`)에서 수락해 들어가면 첫 소속이라, 대시보드에서 매스 인트로를 보게 적는다 (#430).
 */
export function MyInvitations({ onboarding = false }: { onboarding?: boolean }) {
  const invitations = useQuery(myInvitationsQueryOptions())
  const workspaces = useQuery(workspaceListQueryOptions())
  const queryClient = useQueryClient()
  const enter = useEnterWorkspace()
  const respond = useInvitationResponse((workspace) => {
    if (onboarding) captureAccountIntro(queryClient)?.markPending()
    enter(workspace, null)
  })
  const [declining, setDeclining] = useState<MyInvitation | null>(null)

  if (invitations.data === undefined) {
    return invitations.isError ? (
      <QueryErrorState error={invitations.error} onRetry={() => void invitations.refetch()} />
    ) : null
  }
  if (invitations.data.length === 0) {
    return workspaces.data?.length === 0 ? (
      <p className="text-body text-sub">PM에게 가입한 이메일로 초대를 요청하세요.</p>
    ) : null
  }

  return (
    <section aria-labelledby="my-invitations-heading" className="flex flex-col gap-8">
      <h3 id="my-invitations-heading" className={HEADING}>
        받은 초대
      </h3>
      <ul className="flex flex-col gap-6">
        {invitations.data.map((invitation) => (
          <li key={invitation.id} className={ROW}>
            <div className="min-w-[0px] flex-1">
              <div className={NAME}>{invitation.workspaceName}</div>
              <div className={META}>
                팀원 이름 {invitation.memberDisplayName}
                {invitation.invitedByName === null
                  ? null
                  : ` · 초대한 사람 ${invitation.invitedByName}`}
              </div>
            </div>
            <Button
              size="sm"
              variant="ghost"
              disabled={respond.pendingId !== null}
              onClick={() => setDeclining(invitation)}
            >
              거절
            </Button>
            <Button
              size="sm"
              disabled={respond.pendingId !== null}
              loading={respond.pendingId === invitation.id}
              onClick={() => respond.accept(invitation)}
            >
              수락
            </Button>
          </li>
        ))}
      </ul>
      <Modal
        open={declining !== null}
        onOpenChange={(open) => {
          if (!open) setDeclining(null)
        }}
        title={`${declining?.workspaceName ?? ''} 초대를 거절할까요?`}
        description="거절하면 이 초대로는 들어갈 수 없어요. 다시 들어가려면 PM에게 새 초대를 요청해 주세요."
        actions={
          <>
            <Button variant="ghost" onClick={() => setDeclining(null)}>
              닫기
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                if (declining) respond.decline(declining)
                setDeclining(null)
              }}
            >
              거절
            </Button>
          </>
        }
      />
    </section>
  )
}
