import { useState } from 'react'
import type { FormEvent } from 'react'
import { z } from 'zod'
import { Button } from '@/shared/ui/button'
import { Modal } from '@/shared/ui/modal'
import { TextField } from '@/shared/ui/text-field'

const emailSchema = z.email()

export interface InviteDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  displayName: string
  /** 기다리는 초대의 이메일. 다시 초대하면 그 초대가 취소된다 */
  pendingEmail: string | null
  pending: boolean
  /** 서버가 거절한 이유 */
  serverError: string | null
  onSubmit: (email: string) => void
  /** 입력이 바뀌었다. 지난 서버 오류를 지운다 */
  onEdit: () => void
}

/**
 * 가입 이메일을 받아 초대를 만든다. 메일은 보내지 않는다 — PM 이 직접 알려야 한다는 것을 먼저 말한다.
 * 형식이 틀리면 요청을 보내지 않는다. 닫는 버튼은 `닫기` 다 — `취소` 는 초대 취소와 헷갈린다
 */
export function InviteDialog({
  open,
  onOpenChange,
  displayName,
  pendingEmail,
  pending,
  serverError,
  onSubmit,
  onEdit,
}: InviteDialogProps) {
  const [email, setEmail] = useState('')
  const [formatError, setFormatError] = useState(false)

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const value = email.trim()
    if (!emailSchema.safeParse(value).success) {
      setFormatError(true)
      return
    }
    onSubmit(value)
  }

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (pending) return
        if (!next) {
          setEmail('')
          setFormatError(false)
        }
        onOpenChange(next)
      }}
      title={`${displayName} 초대`}
      description="팀원이 가입하거나 로그인할 이메일을 적어 주세요. 메일은 보내지 않으니 초대한 뒤 Discord 등으로 알려 주세요."
      width={420}
    >
      <form noValidate onSubmit={submit} className="flex flex-col gap-12">
        {pendingEmail === null ? null : (
          <p className="text-[12px] text-dim">
            기다리는 초대({pendingEmail})는 취소되고 새 초대가 만들어져요.
          </p>
        )}
        <TextField
          label="가입 이메일"
          type="email"
          autoComplete="off"
          placeholder="name@example.com"
          value={email}
          onChange={(event) => {
            setEmail(event.target.value)
            setFormatError(false)
            onEdit()
          }}
          error={formatError ? '이메일 형식을 확인해 주세요.' : (serverError ?? undefined)}
        />
        <div className="flex justify-end gap-8 pt-6">
          <Button
            type="button"
            variant="ghost"
            disabled={pending}
            onClick={() => {
              setEmail('')
              setFormatError(false)
              onOpenChange(false)
            }}
          >
            닫기
          </Button>
          <Button type="submit" variant="primary" loading={pending}>
            초대하기
          </Button>
        </div>
      </form>
    </Modal>
  )
}
