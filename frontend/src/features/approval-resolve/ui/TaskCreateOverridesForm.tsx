import { useEffect, useId, useMemo, useRef } from 'react'
import type { TaskCreateFields, TaskCreateEdits } from '@/entities/approval'
import type { Member } from '@/entities/member'
import { useAppForm } from '@/shared/lib/form'
import { useUnsavedChanges } from '@/shared/lib/unsaved-changes'
import { Button } from '@/shared/ui/button'
import { ErrorText } from '@/shared/ui/error-text'
import { Label } from '@/shared/ui/label'
import { TextField } from '@/shared/ui/text-field'
import { overridesSchema, toOverrideFormValues, toTaskCreateFields } from '../model/overridesSchema'

const ROOT = 'flex flex-col gap-18 rounded-16 border border-line bg-surface p-22'
const ROW = 'grid grid-cols-[minmax(0px,1fr)_200px] gap-14'
const SELECT =
  'h-[42px] w-full rounded-9 border bg-surface px-13 text-body text-ink disabled:bg-surface-sunken disabled:text-faint'
const FOOTER = 'flex justify-end gap-10'

export interface TaskCreateOverridesFormProps {
  /** 폼을 열 때의 값. 앞서 보완한 값이 있으면 그 값이다 */
  initial: TaskCreateFields
  /** 지금 공간의 팀원. 담당자는 이 안에서만 고른다 */
  members: readonly Member[]
  /** 검사를 통과한 값. 제목은 앞뒤 공백을 지웠다 */
  onConfirm: (fields: TaskCreateEdits) => void
  onInputChange?: () => void
  onCancel: () => void
  /** 승인·반려 요청 중이면 잠근다 */
  disabled?: boolean
  /** 열릴 때 화면 순서로 첫 빈 칸에 포커스를 둔다. 빈 칸이 없으면 첫 칸이다 (D-176 `채워 넣기`) */
  autoFocusFirstEmpty?: boolean
}

function firstEmptyControl(form: HTMLFormElement): HTMLElement | null {
  const controls = Array.from(form.elements).filter(
    (element): element is HTMLInputElement | HTMLSelectElement =>
      (element instanceof HTMLInputElement || element instanceof HTMLSelectElement) &&
      !element.matches(':disabled'),
  )
  return controls.find((control) => control.value.trim() === '') ?? controls[0] ?? null
}

export function TaskCreateOverridesForm({
  initial,
  members,
  onConfirm,
  onInputChange,
  onCancel,
  disabled = false,
  autoFocusFirstEmpty = false,
}: TaskCreateOverridesFormProps) {
  const memberIds = useMemo(() => members.map(({ id }) => id), [members])
  const schema = useMemo(() => overridesSchema(memberIds), [memberIds])
  const { form, submit } = useAppForm(schema, toOverrideFormValues(initial))
  const { errors, isDirty, dirtyFields } = form.formState
  useUnsavedChanges(isDirty)
  const assigneeId = useId()
  const assigneeErrorId = `${assigneeId}-error`
  const formRef = useRef<HTMLFormElement>(null)
  const focused = useRef(false)

  // register 의 ref 가 값을 먼저 채운다 — 효과가 돌 때 칸의 값은 지금 값이다
  useEffect(() => {
    if (!autoFocusFirstEmpty || focused.current || formRef.current === null) return
    focused.current = true
    firstEmptyControl(formRef.current)?.focus()
  }, [autoFocusFirstEmpty])

  // 서버로 보내지 않는다 — 확정한 값을 화면 상태로 넘길 뿐이다
  const confirm = submit((values) => {
    const fields = toTaskCreateFields(values)
    const touched = dirtyFields
    onConfirm({
      ...(touched.taskTitle ? { taskTitle: fields.taskTitle } : {}),
      ...(touched.assigneeMemberId ? { assigneeMemberId: fields.assigneeMemberId } : {}),
      ...(touched.dueDate ? { dueDate: fields.dueDate } : {}),
    })
    return Promise.resolve()
  })

  return (
    <form
      ref={formRef}
      className={ROOT}
      onChangeCapture={onInputChange}
      noValidate
      onSubmit={(event) => void confirm(event)}
    >
      <fieldset className="flex flex-col gap-18" disabled={disabled}>
        <legend className="mb-4 text-[17px] leading-[1.55] font-bold tracking-h2 text-ink">
          확정할 값 보완
        </legend>
        <TextField label="제목" error={errors.taskTitle?.message} {...form.register('taskTitle')} />
        <div className={ROW}>
          <div className="flex flex-col">
            <Label htmlFor={assigneeId} className="mb-6">
              담당자
            </Label>
            <select
              id={assigneeId}
              className={`${SELECT} ${errors.assigneeMemberId ? 'border-accent' : 'border-input-border'}`}
              aria-invalid={errors.assigneeMemberId ? true : undefined}
              aria-describedby={errors.assigneeMemberId ? assigneeErrorId : undefined}
              {...form.register('assigneeMemberId')}
            >
              <option value="">미정</option>
              {members.map(({ id, displayName }) => (
                <option key={id} value={id}>
                  {displayName}
                </option>
              ))}
            </select>
            {errors.assigneeMemberId?.message ? (
              <ErrorText id={assigneeErrorId} className="mt-6">
                {errors.assigneeMemberId.message}
              </ErrorText>
            ) : null}
          </div>
          <TextField
            label="마감"
            type="text"
            placeholder="YYYY-MM-DD 또는 미정이면 비워 두세요"
            error={errors.dueDate?.message}
            {...form.register('dueDate')}
          />
        </div>
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            onInputChange?.()
            form.setValue('dueDate', '', { shouldDirty: true, shouldValidate: true })
          }}
        >
          마감 미정
        </Button>
      </fieldset>
      <div className={FOOTER}>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={disabled}>
          취소
        </Button>
        <Button type="submit" variant="default" disabled={disabled}>
          보완 완료
        </Button>
      </div>
    </form>
  )
}
