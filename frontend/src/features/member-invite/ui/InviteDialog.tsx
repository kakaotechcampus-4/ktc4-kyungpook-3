import { useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import type { Invitee } from '@/entities/invitation'
import { USERNAME_HINT, USERNAME_MESSAGES } from '@/entities/user'
import { errorMessage } from '@/shared/api/errorMessages'
import { Button } from '@/shared/ui/button'
import { Modal } from '@/shared/ui/modal'
import { TextField } from '@/shared/ui/text-field'
import { useInviteeSearch } from '../model/useInviteeSearch'
import type { InviteeSearch } from '../model/useInviteeSearch'

const NOT_FOUND = '가입한 사용자의 아이디를 정확히 입력해 주세요.'
const FOUND =
  'flex min-w-[0px] items-baseline gap-8 rounded-10 border border-line bg-surface px-12 py-10 text-body break-all'

function problemOf(search: InviteeSearch): string | undefined {
  switch (search.status) {
    case 'none':
      return NOT_FOUND
    case 'invalid':
      return USERNAME_MESSAGES.invalid
    case 'failed':
      return errorMessage(search.error)
    default:
      return undefined
  }
}

export interface InviteDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string
  displayName: string
  /** 기다리는 초대를 받은 사람. 다시 초대하면 그 초대가 취소된다 */
  pendingInvitee: Invitee | null
  /** 보내는 중. 입력란과 버튼을 막는다 */
  pending: boolean
  /** 서버가 거절한 이유 */
  serverError: string | null
  onSubmit: (invitee: Invitee) => void
  /** 입력이 바뀌었다. 지난 서버 오류를 지운다 */
  onEdit: () => void
}

/**
 * 아이디로 가입자를 찾아 이름과 아이디를 확인한 뒤 초대한다. 알림은 가지 않는다 — PM 이 직접 알려야 한다는 것을 먼저 말한다.
 * 닫는 버튼은 `닫기` 다 — `취소` 는 초대 취소와 헷갈린다
 */
export function InviteDialog({ open, onOpenChange, displayName, ...form }: InviteDialogProps) {
  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!form.pending) onOpenChange(next)
      }}
      title={`${displayName} 초대`}
      description="팀원이 가입한 아이디로 찾아 초대해요. 알림은 가지 않으니 초대한 뒤 Discord 등으로 알려 주세요."
      width={420}
    >
      <InviteForm {...form} onClose={() => onOpenChange(false)} />
    </Modal>
  )
}

/** 창이 열려 있는 동안만 있다. 닫으면 입력과 찾은 결과가 함께 사라지고 찾던 요청은 끊긴다 */
function InviteForm({
  workspaceId,
  pendingInvitee,
  pending,
  serverError,
  onSubmit,
  onEdit,
  onClose,
}: Omit<InviteDialogProps, 'open' | 'onOpenChange' | 'displayName'> & { onClose: () => void }) {
  const [input, setInput] = useState('')
  const { search, run } = useInviteeSearch(workspaceId, input)
  const searching = search.status === 'searching'
  const found = search.status === 'found' ? search.invitee : null

  const proceed = () => {
    if (pending || searching) return
    if (found === null) run()
    else onSubmit(found)
  }

  return (
    <form
      noValidate
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        proceed()
      }}
      className="flex flex-col gap-12"
    >
      {pendingInvitee === null ? null : (
        <p className="text-[12px] text-dim">
          기다리는 초대({pendingInvitee.name} · {pendingInvitee.username})는 취소되고 새 초대가
          만들어져요.
        </p>
      )}
      <TextField
        label="아이디"
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        description={USERNAME_HINT}
        value={input}
        disabled={pending}
        onChange={(event) => {
          setInput(event.target.value)
          onEdit()
        }}
        // 찾기 전에는 초대하기가 꺼져 있어 Enter 가 폼을 보내지 않는다. 찾기로 잇는다
        onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
          if (event.key !== 'Enter' || event.nativeEvent.isComposing || found !== null) return
          event.preventDefault()
          proceed()
        }}
        error={problemOf(search) ?? serverError ?? undefined}
        endAdornment={
          <Button
            type="button"
            size="sm"
            className="shrink-0"
            loading={searching}
            disabled={pending || found !== null}
            onClick={run}
          >
            찾기
          </Button>
        }
      />
      <div role="status" className={found === null ? 'sr-only' : FOUND}>
        {found === null ? null : (
          <>
            <span className="sr-only">찾은 사람 </span>
            <span className="font-semibold text-ink">{found.name}</span>
            <span className="text-dim">{found.username}</span>
          </>
        )}
      </div>
      <div className="flex justify-end gap-8 pt-6">
        <Button type="button" variant="ghost" disabled={pending} onClick={onClose}>
          닫기
        </Button>
        <Button type="submit" variant="primary" disabled={found === null} loading={pending}>
          초대하기
        </Button>
      </div>
    </form>
  )
}
