import { useState } from 'react'
import type { TaskStatus } from '@/entities/task'
import type { TaskUpdateEdits } from '@/entities/approval'
import { isDateOnly } from '@/shared/lib/date'
import { useUnsavedChanges } from '@/shared/lib/unsaved-changes'
import { Button } from '@/shared/ui/button'
import { TextField } from '@/shared/ui/text-field'

interface Props {
  initial: { status: TaskStatus | null; dueDate: string | null }
  disabled: boolean
  onInputChange: () => void
  onConfirm: (edits: TaskUpdateEdits) => void
  onCancel: () => void
}

export function TaskUpdateOverridesForm({
  initial,
  disabled,
  onInputChange,
  onConfirm,
  onCancel,
}: Props) {
  const [status, setStatus] = useState<TaskStatus | ''>(initial.status ?? '')
  const [dueDate, setDueDate] = useState(initial.dueDate ?? '')
  const [touched, setTouched] = useState({ status: false, dueDate: false })
  const [submitted, setSubmitted] = useState(false)
  const invalid = dueDate !== '' && !isDateOnly(dueDate)
  useUnsavedChanges(touched.status || touched.dueDate)
  return (
    <form
      className="flex flex-col gap-18 rounded-16 border border-line bg-surface p-22"
      onChangeCapture={onInputChange}
      onSubmit={(event) => {
        event.preventDefault()
        setSubmitted(true)
        if (invalid) return
        onConfirm({
          ...(touched.status && status !== '' ? { status } : {}),
          ...(touched.dueDate ? { dueDate: dueDate === '' ? null : dueDate } : {}),
        })
      }}
    >
      <fieldset disabled={disabled} className="flex flex-col gap-18">
        <legend>확정할 값 보완</legend>
        <label className="flex flex-col gap-6">
          상태
          <select
            className="h-[42px] w-full rounded-9 border border-input-border bg-surface px-13 text-body text-ink disabled:bg-surface-sunken disabled:text-faint"
            aria-label="상태"
            value={status}
            onChange={(event) => {
              const value = event.target.value
              if (value === '') {
                setStatus('')
                setTouched((previous) => ({ ...previous, status: false }))
                return
              }
              if (
                value === 'todo' ||
                value === 'in_progress' ||
                value === 'blocked' ||
                value === 'done'
              ) {
                setStatus(value)
                setTouched((previous) => ({ ...previous, status: true }))
              }
            }}
          >
            {initial.status === null ? <option value="">원래 제안 유지</option> : null}
            <option value="todo">할 일</option>
            <option value="in_progress">진행 중</option>
            <option value="blocked">막힘</option>
            <option value="done">완료</option>
          </select>
        </label>
        <TextField
          label="마감"
          placeholder="원래 제안 유지 · YYYY-MM-DD 입력"
          value={dueDate}
          error={submitted && invalid ? '마감은 YYYY-MM-DD 형식의 있는 날짜여야 해요.' : undefined}
          onChange={(event) => {
            setDueDate(event.target.value)
            setTouched((previous) => ({ ...previous, dueDate: true }))
          }}
        />
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            onInputChange()
            setDueDate('')
            setTouched((previous) => ({ ...previous, dueDate: true }))
          }}
        >
          마감 미정
        </Button>
        <p>
          바꾸지 않은 항목은 원래 제안을 유지해요. 마감을 미정으로 바꾸려면 마감 미정을 누르세요.
        </p>
      </fieldset>
      <div className="flex justify-end gap-10">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={disabled}>
          취소
        </Button>
        <Button type="submit" disabled={disabled}>
          보완 완료
        </Button>
      </div>
    </form>
  )
}
