import { useId, useState } from 'react'
import type { FormEvent } from 'react'
import type { DiscordUser, Member } from '@/entities/member'
import {
  MemberMappingFields,
  buildMappingRows,
  useMemberMappingForm,
} from '@/features/member-mapping'
import { paths } from '@/shared/config/routes'
import { GuardedLink } from '@/shared/lib/unsaved-changes'
import { Button } from '@/shared/ui/button'
import { Modal } from '@/shared/ui/modal'
import { QueryErrorState } from '@/shared/ui/query-error-state'
import { Skeleton } from '@/shared/ui/skeleton'
import { LINK_BUTTON } from './teamStyles'

/* 온보딩 팀원 연결 카드와 같은 문구다 (SetupMembers 캔버스) */
const DESCRIPTION = '디스코드 계정과 이름을 이어 두면 마감 하루 전에 DM이 나갑니다.'
const WIDTH = 560
/* 줄이 많으면 창 안에서 넘긴다 — 화면 위아래 여백(24px)만큼 남긴다 */
const SCROLL = 'max-h-[calc(100vh-48px)] overflow-y-auto'

/** 팀원 연결 창이 쓸 자료. Discord 미연결이면 불러올 사용자가 없다 (D-173 과 같은 안내) */
export type MappingSource =
  | { status: 'loading' }
  | { status: 'error'; error: unknown; retry: () => void }
  | { status: 'not_connected' }
  | { status: 'ready'; discordUsers: DiscordUser[]; members: Member[] }

interface MappingFormProps {
  workspaceId: string
  discordUsers: DiscordUser[]
  members: Member[]
  onCancel: () => void
  onSaved: () => void
}

/** PM 팀원. 먼저 만들어진 순서다 — 첫째가 워크스페이스를 만든 PM 이고 체크박스가 그 PM 을 가리킨다 (#228) */
function pmsOf(members: Member[]): Member[] {
  return members
    .filter(({ role }) => role === 'pm')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

/**
 * 창 안의 입력. 저장 규칙은 온보딩과 같은 `useMemberMappingForm` 이다 — 일부만 적어도 저장한다 (D-029), 1:1 (D-027).
 * 온보딩 `확인 완료` 와 달리 PM 체크를 요구하지 않는다 — 아무도 잇지 않고 나갈 수 있다 (D-075).
 * 줄은 창을 연 때의 팀원으로 한 번 만든다 — 저장하며 팀원 캐시가 바뀌어도 입력 중인 줄이 다시 짜이지 않는다
 */
function MappingForm({ workspaceId, discordUsers, members, onCancel, onSaved }: MappingFormProps) {
  const [initialRows] = useState(() => buildMappingRows(discordUsers, members))
  const [pms] = useState(() => pmsOf(members))
  const mapping = useMemberMappingForm(workspaceId, initialRows, pms)
  const formId = useId()
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
      if (await save(values)) onSaved()
    })(event)

  return (
    <>
      <form id={formId} noValidate onSubmit={(event) => void onSubmit(event)}>
        <MemberMappingFields mapping={mapping} tone="product" />
      </form>
      <div className="flex justify-end gap-8 pt-6">
        <Button variant="ghost" disabled={isSubmitting} onClick={onCancel}>
          나중에 하기
        </Button>
        <Button
          type="submit"
          form={formId}
          variant="primary"
          loading={isSubmitting}
          disabled={filled === 0}
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
 * 닫으면 적다 만 입력은 버린다
 */
export function MemberConnectDialog({
  workspaceId,
  open,
  onOpenChange,
  source,
}: MemberConnectDialogProps) {
  const close = () => onOpenChange(false)
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
      onOpenChange={onOpenChange}
      title="팀원 연결"
      description={DESCRIPTION}
      width={WIDTH}
      className={SCROLL}
    >
      {source.status === 'loading' ? (
        <div aria-busy="true">
          <Skeleton lines={3} />
        </div>
      ) : source.status === 'error' ? (
        <>
          <QueryErrorState error={source.error} onRetry={source.retry} />
          {closeOnly}
        </>
      ) : source.status === 'not_connected' ? (
        <>
          <p className="text-body text-dim">
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
        />
      )}
    </Modal>
  )
}
