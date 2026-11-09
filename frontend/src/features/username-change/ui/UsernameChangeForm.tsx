import { useState } from 'react'
import {
  UsernameField,
  normalizeUsername,
  usernameRejection,
  useUsernameCheck,
} from '@/entities/user'
import { errorMessage } from '@/shared/api/errorMessages'
import { isCanceledError, isInvalidResponse } from '@/shared/api/errors'
import { captureSessionScope } from '@/shared/api/sessionScope'
import { useUnsavedChanges } from '@/shared/lib/unsaved-changes'
import { Button } from '@/shared/ui/button'
import { FormErrorPanel } from '@/shared/ui/form-error-panel'
import { toast } from '@/shared/ui/toast'
import { useUsernameChange } from '../model/useUsernameChange'

/** 폼 위에 보이는 실패. 취소·응답을 읽지 못한 쓰기(토스트)·아이디 거절(칸 오류)은 싣지 않는다 */
function saveFailure(error: unknown): string | null {
  if (
    error === null ||
    isCanceledError(error) ||
    isInvalidResponse(error) ||
    usernameRejection(error) !== null
  )
    return null
  return errorMessage(error)
}

export interface UsernameChangeFormProps {
  /** 지금 내 아이디. 같은 값은 확인하지 않는다 */
  current: string
}

/**
 * 설정의 아이디 바꾸기 (#627). 중복 확인이 지금 입력과 맞아야 `저장` 이 켜진다.
 * 확인 뒤 남이 가져가 409 가 오거나 규칙 밖이라 400 이 오면 아이디 칸 오류다. 바꾼 채 나가려 하면 이탈 확인이 묻는다
 */
export function UsernameChangeForm({ current }: UsernameChangeFormProps) {
  const [input, setInput] = useState(current)
  const control = useUsernameCheck(input, current)
  const change = useUsernameChange()
  useUnsavedChanges(normalizeUsername(input) !== current)

  const save = () => {
    if (control.check.status !== 'available' || change.isPending) return
    const { username } = control.check
    const session = captureSessionScope()
    change.mutate(
      { username, session },
      {
        onSuccess: (user) => {
          if (!session.isCurrent()) return
          setInput(user.username)
          toast.show({ title: '아이디를 바꿨어요.' })
        },
        onError: (error) => {
          const rejected = usernameRejection(error)
          if (session.isCurrent() && rejected !== null) control.reject(username, rejected)
        },
      },
    )
  }

  return (
    <form
      noValidate
      className="flex max-w-[420px] flex-col gap-12"
      onSubmit={(event) => {
        event.preventDefault()
        save()
      }}
    >
      <FormErrorPanel message={saveFailure(change.error)} />
      <UsernameField
        control={control}
        value={input}
        disabled={change.isPending}
        onChange={(event) => {
          setInput(event.target.value)
          change.reset()
        }}
      />
      <div>
        <Button type="submit" loading={change.isPending} disabled={!control.confirmed}>
          저장
        </Button>
      </div>
    </form>
  )
}
