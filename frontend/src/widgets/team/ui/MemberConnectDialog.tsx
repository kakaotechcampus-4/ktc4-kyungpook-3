import { useId, useState } from 'react'
import type { FormEvent } from 'react'
import type { DiscordUser, Member } from '@/entities/member'
import { pmsOf } from '@/entities/member'
import { MemberAddForm, NOT_IN_DISCORD_SERVER, useMemberAdding } from '@/features/member-add'
import {
  MemberMappingFields,
  buildMappingRows,
  useMemberMappingForm,
} from '@/features/member-mapping'
import type { MemberMappingForm } from '@/features/member-mapping'
import { paths } from '@/shared/config/routes'
import { GuardedLink } from '@/shared/lib/unsaved-changes'
import { useLoadingIndicator } from '@/shared/lib/loading-indicator'
import { Button } from '@/shared/ui/button'
import { Modal } from '@/shared/ui/modal'
import { QueryErrorState } from '@/shared/ui/query-error-state'
import { DeferredSkeleton, Reveal } from '@/shared/ui/deferred-skeleton'
import { Skeleton } from '@/shared/ui/skeleton'
import { LINK_BUTTON } from './teamStyles'

/* 온보딩 팀원 연결 카드와 같은 문구다 (SetupMembers 캔버스) */
const DESCRIPTION = '디스코드 계정과 이름을 이어 두면 마감 하루 전에 DM이 나갑니다.'
const PM_UNCHECKED = 'PM 줄을 체크하지 않으면 Discord 알림을 받을 수 없어요.'
const WIDTH = 560
/* 줄이 많으면 창 안에서 넘긴다 — 화면 위아래 여백(24px)만큼 남긴다 */
const SCROLL = 'max-h-[calc(100vh-48px)] overflow-y-auto'

/** 팀원 연결 창이 쓸 자료. Discord 미연결이면 불러올 사용자가 없다 (D-173 과 같은 안내) */
export type MappingSource =
  | { status: 'loading' }
  | { status: 'error'; error: unknown; retry: () => void }
  | { status: 'not_connected' }
  | { status: 'ready'; discordUsers: DiscordUser[]; members: Member[] }

/** 만든 PM 의 Discord 계정이 없고, 줄이 하나 이상이며, 지금 어느 줄도 PM 체크가 없을 때 안내한다. 저장은 그대로 된다 (D-177).
 *  온보딩은 PM 체크를 요구하므로 MemberMappingFields 가 아니라 이 창에만 둔다 */
function pmLeftUnchecked({ pms, initialRows, rows }: MemberMappingForm): boolean {
  return (
    pms[0]?.discordUserId === null &&
    initialRows.length > 0 &&
    rows.every(({ pmMemberId }) => pmMemberId === null)
  )
}

interface MappingFormProps {
  workspaceId: string
  discordUsers: DiscordUser[]
  members: Member[]
  onCancel: () => void
  onSaved: () => void
  /** 저장을 시작하고 끝낼 때 알린다. 창은 저장하는 동안 Esc·바깥 클릭으로 닫히지 않는다 — 닫히면 실패를 보일 곳이 없다 */
  onSavingChange: (saving: boolean) => void
}

/**
 * 창 안의 입력. 저장 규칙은 온보딩과 같은 `useMemberMappingForm` 이다 — 일부만 적어도 저장한다 (D-029), 1:1 (D-027).
 * 온보딩 `확인 완료` 와 달리 PM 체크를 요구하지 않는다 — 아무도 잇지 않고 나갈 수 있다 (D-075).
 * 줄은 창을 연 때의 팀원으로 한 번 만든다 — 저장하며 팀원 캐시가 바뀌어도 입력 중인 줄이 다시 짜이지 않는다
 */
function MappingForm({
  workspaceId,
  discordUsers,
  members,
  onCancel,
  onSaved,
  onSavingChange,
}: MappingFormProps) {
  const [initialRows] = useState(() => buildMappingRows(discordUsers, members))
  const [pms] = useState(() => pmsOf(members))
  const mapping = useMemberMappingForm(workspaceId, initialRows, pms)
  const { adding, isAdding } = useMemberAdding(workspaceId)
  const hintShown = pmLeftUnchecked(mapping)
  const formId = useId()
  const hintId = useId()
  const {
    submit,
    save,
    filled,
    form: {
      formState: { isSubmitting },
    },
  } = mapping
  const onSubmit = (event: FormEvent<HTMLFormElement>) =>
    submit(async (values) => {
      if (isAdding()) return
      onSavingChange(true)
      const saved = await save(values).finally(() => onSavingChange(false))
      if (saved) onSaved()
    })(event)

  return (
    <>
      <form id={formId} noValidate onSubmit={(event) => void onSubmit(event)}>
        <MemberMappingFields mapping={mapping} tone="product" />
      </form>
      {hintShown ? (
        <p id={hintId} className="pt-6 text-caption text-dim">
          {PM_UNCHECKED}
        </p>
      ) : null}
      <p className="pt-14 pb-10 text-body text-dim">{NOT_IN_DISCORD_SERVER}</p>
      <MemberAddForm workspaceId={workspaceId} tone="product" disabled={isSubmitting} />
      <div className="flex justify-end gap-8 pt-6">
        <Button variant="ghost" disabled={isSubmitting} onClick={onCancel}>
          나중에 하기
        </Button>
        <Button
          type="submit"
          form={formId}
          variant="primary"
          loading={isSubmitting}
          disabled={filled === 0 || adding}
          aria-describedby={hintShown ? hintId : undefined}
        >
          저장
        </Button>
      </div>
    </>
  )
}

export interface MemberConnectDialogProps {
  workspaceId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  source: MappingSource
}

/**
 * 온보딩 뒤의 팀원 연결 (D-074, D-075). 팀 화면의 `팀원 관리`·`연결` 과 설정의 Discord 연결 성공이 이 창을 연다.
 * 창을 열 때마다 지금 팀원·Discord 사용자로 줄을 새로 만든다. 저장한 뒤에만 닫힌다 — 화면은 서버가 돌려준 팀원으로 바뀐다 (D-137).
 * 저장하는 동안에는 닫히지 않는다 — 실패하면 창 안의 줄에 오류를 둔다. 닫으면 적다 만 입력은 버린다
 */
export function MemberConnectDialog({
  workspaceId,
  open,
  onOpenChange,
  source,
}: MemberConnectDialogProps) {
  const [saving, setSaving] = useState(false)
  const indicator = useLoadingIndicator(source.status === 'loading')
  const close = () => onOpenChange(false)
  const requestOpenChange = (next: boolean) => {
    if (!next && saving) return
    onOpenChange(next)
  }
  const closeOnly = (
    <div className="flex justify-end pt-6">
      <Button variant="ghost" onClick={close}>
        닫기
      </Button>
    </div>
  )
  return (
    <Modal
      open={open}
      onOpenChange={requestOpenChange}
      title="팀원 연결"
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
            <>
              <QueryErrorState error={source.error} onRetry={source.retry} />
              {closeOnly}
            </>
          ) : source.status === 'not_connected' ? (
            <>
              <MemberAddForm workspaceId={workspaceId} tone="product" />
              <p className="pt-14 text-body text-dim">
                Discord를 연결하지 않아 팀원을 불러올 수 없어요. 설정에서 Discord를 연결하면 이 창이
                다시 열려요.
              </p>
              <GuardedLink to={paths.settings(workspaceId)} className={LINK_BUTTON}>
                설정에서 Discord 연결하기
              </GuardedLink>
              {closeOnly}
            </>
          ) : (
            <MappingForm
              workspaceId={workspaceId}
              discordUsers={source.discordUsers}
              members={source.members}
              onCancel={close}
              onSaved={close}
              onSavingChange={setSaving}
            />
          )}
        </Reveal>
      )}
    </Modal>
  )
}
