import { useEffect, useId, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { useUnsavedChanges } from '@/shared/lib/unsaved-changes'
import { Button } from '@/shared/ui/button'
import { ErrorText } from '@/shared/ui/error-text'
import { Label } from '@/shared/ui/label'
import { ACTIONS, FIELD, FORM, TEXTAREA } from './styles'

export interface DecisionTextFormProps {
  text: string
  pending: boolean
  alert?: ReactNode
  onSave: (text: string) => void
  onCancel: () => void
}

/** 결정 문장 고치기. 1000자는 칸이 막고 빈 문장만 여기서 막는다. 같은 문장이면 보내지 않고 닫는다 */
export function DecisionTextForm({
  text,
  pending,
  alert,
  onSave,
  onCancel,
}: DecisionTextFormProps) {
  const [draft, setDraft] = useState(text)
  const [error, setError] = useState<string | null>(null)
  const field = useRef<HTMLTextAreaElement>(null)
  const id = useId()
  useUnsavedChanges(draft !== text)
  // 연 단추가 폼으로 바뀌므로 포커스를 첫 칸으로 옮긴다
  useEffect(() => field.current?.focus(), [])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const next = draft.trim()
    if (next === '') {
      setError('문장을 써 주세요.')
      field.current?.focus()
      return
    }
    if (next === text.trim()) onCancel()
    else onSave(next)
  }

  return (
    <form aria-label="결정 고치기" className={FORM} onSubmit={submit} noValidate>
      <div className={FIELD}>
        <Label htmlFor={id}>결정 문장</Label>
        <textarea
          ref={field}
          id={id}
          className={TEXTAREA}
          value={draft}
          maxLength={1000}
          aria-invalid={error === null ? undefined : true}
          aria-describedby={error === null ? undefined : `${id}-error`}
          onChange={(event) => {
            setDraft(event.target.value)
            setError(null)
          }}
        />
        {error === null ? null : <ErrorText id={`${id}-error`}>{error}</ErrorText>}
      </div>
      {alert}
      <div className={ACTIONS}>
        <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={onCancel}>
          취소
        </Button>
        <Button type="submit" variant="primary" size="sm" loading={pending}>
          저장
        </Button>
      </div>
    </form>
  )
}
