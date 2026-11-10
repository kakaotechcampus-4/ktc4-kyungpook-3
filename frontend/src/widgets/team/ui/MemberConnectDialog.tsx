import type { DiscordUser, Member } from '@/entities/member'
import { pmsOf } from '@/entities/member'
import { MemberRows, isNameEditorEvent, useMemberRowsBusy } from '@/features/member-mapping'
import { MemberInviteControl } from '@/features/member-invite'
import { paths } from '@/shared/config/routes'
import { GuardedLink, guardLeave } from '@/shared/lib/unsaved-changes'
import { useLoadingIndicator } from '@/shared/lib/loading-indicator'
import { Button } from '@/shared/ui/button'
import { Modal } from '@/shared/ui/modal'
import { QueryErrorState } from '@/shared/ui/query-error-state'
import { DeferredSkeleton, Reveal } from '@/shared/ui/deferred-skeleton'
import { Skeleton } from '@/shared/ui/skeleton'
import { LINK_BUTTON } from './teamStyles'

/* 온보딩 팀원 연결 카드와 같은 문구다 (SetupMembers 캔버스) */
const DESCRIPTION = '디스코드 계정과 이름을 이어 두면 마감 하루 전에 DM이 나갑니다.'
const PM_UNLINKED = 'PM의 디스코드 계정을 고르지 않으면 Discord 알림을 받을 수 없어요.'
const WIDTH = 560
/* 줄이 많으면 창 안에서 넘긴다 — 화면 위아래 여백(24px)만큼 남긴다 */
const SCROLL = 'max-h-[calc(100vh-48px)] overflow-y-auto'

/** 팀원 관리 창이 쓸 자료. Discord 미연결이면 불러올 사용자가 없다 (D-173 과 같은 안내) */
export type MappingSource =
  | { status: 'loading' }
  | { status: 'error'; error: unknown; retry: () => void }
  | { status: 'not_connected' }
  | { status: 'ready'; discordUsers: DiscordUser[]; members: Member[] }

/** 만든 PM 이 Discord 에 연결되지 않았고 고를 계정이 하나 이상일 때 안내한다. 연결은 요구하지 않는다 (D-177) */
function pmLeftUnlinked(discordUsers: readonly DiscordUser[], members: readonly Member[]): boolean {
  return pmsOf(members)[0]?.discordUserId === null && discordUsers.some(({ isBot }) => !isBot)
}

export interface MemberConnectDialogProps {
  workspaceId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  source: MappingSource
}

/**
 * 팀원 관리 (D-074, D-075, #647). 팀 화면의 `팀원 관리`·`연결` 과 설정의 Discord 연결 성공이 이 창을 연다.
 * 팀원 한 명이 한 줄이고 줄마다 바로 저장한다 — 아래 버튼은 `닫기` 하나다. 줄 아래에 초대 상태와 조작을 둔다.
 * 쓰는 동안에는 닫히지 않는다 — 닫히면 실패를 보일 곳이 없다. 고친 이름을 저장하지 않았으면 닫기 전에 공통 이탈 확인을 거친다
 */
export function MemberConnectDialog({
  workspaceId,
  open,
  onOpenChange,
  source,
}: MemberConnectDialogProps) {
  const busy = useMemberRowsBusy(workspaceId)
  const indicator = useLoadingIndicator(source.status === 'loading')
  const requestOpenChange = (next: boolean) => {
    if (next) onOpenChange(true)
    else if (!busy) guardLeave(() => onOpenChange(false))
  }
  const invite = (member: Member) => (
    <MemberInviteControl workspaceId={workspaceId} member={member} />
  )

  return (
    <Modal
      open={open}
      onOpenChange={requestOpenChange}
      onEscapeKeyDown={(event) => {
        if (isNameEditorEvent(event)) event.preventDefault()
      }}
      title="팀원 관리"
      description={DESCRIPTION}
      width={WIDTH}
      className={SCROLL}
    >
      {source.status === 'loading' || indicator.pending ? (
        <DeferredSkeleton indicator={indicator}>
          <Skeleton lines={3} />
        </DeferredSkeleton>
      ) : (
        <Reveal indicator={indicator}>
          {source.status === 'error' ? (
            <QueryErrorState error={source.error} onRetry={source.retry} />
          ) : source.status === 'not_connected' ? (
            <>
              <MemberRows
                workspaceId={workspaceId}
                discordUsers={null}
                tone="product"
                rowExtra={invite}
              />
              <p className="pt-14 text-body text-dim">
                Discord를 연결하지 않아 디스코드 계정을 고를 수 없어요. 설정에서 Discord를 연결하면
                이 창이 다시 열려요.
              </p>
              <GuardedLink to={paths.settings(workspaceId)} className={LINK_BUTTON}>
                설정에서 Discord 연결하기
              </GuardedLink>
            </>
          ) : (
            <>
              {pmLeftUnlinked(source.discordUsers, source.members) ? (
                <p className="pt-6 text-caption text-dim">{PM_UNLINKED}</p>
              ) : null}
              <MemberRows
                workspaceId={workspaceId}
                discordUsers={source.discordUsers}
                tone="product"
                rowExtra={invite}
              />
            </>
          )}
        </Reveal>
      )}
      <div className="flex justify-end pt-6">
        <Button variant="ghost" disabled={busy} onClick={() => requestOpenChange(false)}>
          닫기
        </Button>
      </div>
    </Modal>
  )
}
