import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { latestInvitationsQueryOptions } from '@/entities/invitation'
import type { Member } from '@/entities/member'
import { COMMON_MESSAGES } from '@/shared/api/errorMessages'
import { Button } from '@/shared/ui/button'
import { memberInviteView } from '../model/inviteView'
import { useMemberInviteActions } from '../model/useMemberInviteActions'
import { CHIP, CHIP_TONE } from './chipStyles'
import { InviteDialog } from './InviteDialog'
import { RevokeConfirm } from './RevokeConfirm'

const ROW = 'mt-6 flex flex-wrap items-center gap-8'
const DETAIL = 'min-w-[0px] text-[12px] break-all text-dim'

export interface MemberInviteControlProps {
  workspaceId: string
  member: Member
}

/**
 * 팀원 한 줄의 초대 상태와 조작. **PM 에게만 붙인다** — 초대 목록은 PM 전용 API 다(그 밖은 403).
 * 목록은 행마다 같은 조회 하나를 나눠 쓴다. 불러오는 동안은 아무것도 그리지 않고, 실패하면 한 줄과 다시 시도다.
 */
export function MemberInviteControl({ workspaceId, member }: MemberInviteControlProps) {
  const invitations = useQuery({
    ...latestInvitationsQueryOptions(workspaceId),
    select: (latest) => latest.get(member.id) ?? null,
  })
  const actions = useMemberInviteActions(workspaceId, member.id)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [revokeOpen, setRevokeOpen] = useState(false)

  if (invitations.isError)
    return (
      <div className={ROW}>
        <span className="text-[12px] text-dim">초대 상태를 불러오지 못했어요.</span>
        <Button size="sm" variant="ghost" onClick={() => void invitations.refetch()}>
          {COMMON_MESSAGES.retry}
        </Button>
      </div>
    )
  if (invitations.data === undefined) return null

  const latest = invitations.data
  const view = memberInviteView(member.role, latest)
  if (view === null) return null
  const close = view.close

  return (
    <div className={ROW}>
      {view.chip === null ? null : (
        <span className={`${CHIP} ${CHIP_TONE[view.chip.tone]}`}>{view.chip.label}</span>
      )}
      {view.detail === null ? null : <span className={DETAIL}>{view.detail}</span>}
      {view.invite === null ? null : (
        <Button
          size="sm"
          onClick={() => {
            actions.resetInvite()
            setInviteOpen(true)
          }}
        >
          {view.invite}
        </Button>
      )}
      {close === null ? null : (
        <Button
          size="sm"
          variant="ghost"
          loading={close.kind === 'cancel' && actions.closing}
          disabled={actions.closing}
          onClick={() =>
            close.kind === 'cancel' ? actions.cancel(close.invitationId) : setRevokeOpen(true)
          }
        >
          {close.kind === 'cancel' ? '초대 취소' : '연결 끊기'}
        </Button>
      )}

      <InviteDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        workspaceId={workspaceId}
        displayName={member.displayName}
        pendingInvitee={latest?.status === 'pending' ? latest.invitedUser : null}
        pending={actions.inviting}
        serverError={actions.inviteError}
        onSubmit={(invitee, onUserGone) =>
          actions.invite(invitee, () => setInviteOpen(false), onUserGone)
        }
        onEdit={actions.clearInviteError}
      />
      {close?.kind === 'revoke' ? (
        <RevokeConfirm
          open={revokeOpen}
          displayName={member.displayName}
          account={latest?.acceptedUser ?? null}
          pending={actions.closing}
          onConfirm={() => actions.revoke(close.invitationId, () => setRevokeOpen(false))}
          onCancel={() => setRevokeOpen(false)}
        />
      ) : null}
    </div>
  )
}
