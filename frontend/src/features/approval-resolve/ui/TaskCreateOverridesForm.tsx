import { useId, useMemo } from 'react'
import type { TaskCreateFields } from '@/entities/approval'
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
  onConfirm: (fields: TaskCreateFields) => void
  onCancel: () => void
  /** 승인·반려 요청 중이면 잠근다 */
  disabled?: boolean
}

/**
 * 생성 승인의 제목·담당자·마감 보완 (계획 §4-1, §4-2). 개발 MSW 에서 PM 이 `보완하기` 를 눌렀을 때만 열린다.
 * 값은 서버로 바로 가지 않는다 — `보완 완료` 로 확정하면 승인 한 번에 함께 실린다.
 * 바꾼 값이 있는 동안 떠나려 하면 기존 이탈 확인을 묻는다
 */
export function TaskCreateOverridesForm({
  initial,
  members,
  onConfirm,
  onCancel,
  disabled = false,
}: TaskCreateOverridesFormProps) {
  const memberIds = useMemo(() => members.map(({ id }) => id), [members])
  const schema = useMemo(() => overridesSchema(memberIds), [memberIds])
  const { form, submit } = useAppForm(schema, toOverrideFormValues(initial))
  const { errors, isDirty } = form.formState
  useUnsavedChanges(isDirty)
  const assigneeId = useId()
  const assigneeErrorId = `${assigneeId}-error`

  // 서버로 보내지 않는다 — 확정한 값을 화면 상태로 넘길 뿐이다
  const confirm = submit((values) => {
    onConfirm(toTaskCreateFields(values))
    return Promise.resolve()
  })

  return (
    <form className={ROOT} noValidate onSubmit={(event) => void confirm(event)}>
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
              <option value="">담당자 고르기</option>
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
            type="date"
            min="0001-01-01"
            max="9999-12-31"
            error={errors.dueDate?.message}
            {...form.register('dueDate')}
          />
        </div>
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
