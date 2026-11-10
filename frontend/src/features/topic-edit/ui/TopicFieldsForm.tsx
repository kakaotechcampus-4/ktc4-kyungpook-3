import { useEffect, useId, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { useUnsavedChanges } from '@/shared/lib/unsaved-changes'
import { Button } from '@/shared/ui/button'
import { Label } from '@/shared/ui/label'
import { TextField } from '@/shared/ui/text-field'
import { ACTIONS, FIELD, FORM, TEXTAREA } from './styles'

/** 바뀐 칸만 담는다 */
export interface TopicFieldsChange {
  name?: string
  description?: string
}

export interface TopicFieldsFormProps {
  name: string
  description: string
  pending: boolean
  /** 서버가 거절한 이유. 저장 단추 위에 둔다 */
  alert?: ReactNode
  onSave: (change: TopicFieldsChange) => void
  onCancel: () => void
}

/**
 * 주제 이름·설명 고치기. 길이는 칸이 막고(이름 100자, 설명 1000자) 빈 이름만 여기서 막는다.
 * 바뀐 칸만 보내고, 바뀐 것이 없으면 보내지 않고 닫는다
 */
export function TopicFieldsForm({
  name,
  description,
  pending,
  alert,
  onSave,
  onCancel,
}: TopicFieldsFormProps) {
  const [draftName, setDraftName] = useState(name)
  const [draftDescription, setDraftDescription] = useState(description)
  const [nameError, setNameError] = useState<string | null>(null)
  const nameField = useRef<HTMLInputElement>(null)
  const descriptionId = useId()
  useUnsavedChanges(draftName !== name || draftDescription !== description)
  // 연 단추가 폼으로 바뀌므로 포커스를 첫 칸으로 옮긴다
  useEffect(() => nameField.current?.focus(), [])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const nextName = draftName.trim()
    const nextDescription = draftDescription.trim()
    if (nextName === '') {
      setNameError('이름을 써 주세요.')
      nameField.current?.focus()
      return
    }
    const change: TopicFieldsChange = {
      ...(nextName === name.trim() ? {} : { name: nextName }),
      ...(nextDescription === description.trim() ? {} : { description: nextDescription }),
    }
    if (Object.keys(change).length === 0) onCancel()
    else onSave(change)
  }

  return (
    <form aria-label="주제 고치기" className={FORM} onSubmit={submit} noValidate>
      <TextField
        ref={nameField}
        label="이름"
        value={draftName}
        maxLength={100}
        error={nameError ?? undefined}
        onChange={(event) => {
          setDraftName(event.target.value)
          setNameError(null)
        }}
      />
      <div className={FIELD}>
        <Label htmlFor={descriptionId}>설명</Label>
        <textarea
          id={descriptionId}
          className={TEXTAREA}
          value={draftDescription}
          maxLength={1000}
          onChange={(event) => setDraftDescription(event.target.value)}
        />
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
