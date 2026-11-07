import { useEffect, useId, useRef } from 'react'
import { Controller } from 'react-hook-form'
import { ASSIGNEE_NONE_OPTION, assigneeOptions } from '@/entities/member'
import type { Member } from '@/entities/member'
import { DateField } from '@/shared/ui/date-field'
import { ErrorText } from '@/shared/ui/error-text'
import { Label } from '@/shared/ui/label'
import { Select } from '@/shared/ui/select'
import { TextField } from '@/shared/ui/text-field'
import { OVERRIDE_FORM_MESSAGES } from '../model/overridesSchema'
import type { TaskCreateOverrides } from '../model/useTaskCreateOverrides'

const OVERRIDE_FIELDS_ROW =
  'grid grid-cols-1 items-start gap-12 sm:grid-cols-[minmax(0px,1.6fr)_minmax(0px,1fr)_minmax(0px,1fr)]'

export interface TaskCreateOverrideFieldsProps {
  overrides: TaskCreateOverrides
  /** 지금 공간의 팀원. 받기 전에는 담당자를 고를 수 없다 */
  members: readonly Member[] | undefined
  /** 값이 바뀌면 부른다 — 앞서 받은 충돌 확인을 지운다 */
  onInputChange: () => void
  /** 승인·반려 요청 중이면 잠근다 */
  disabled: boolean
  /** 대시보드 `채워 넣기` 로 왔다 (D-176). 팀원 목록이 오면 화면 순서로 첫 빈 칸에, 없으면 첫 칸에 포커스를 둔다 */
  autoFocusFirstEmpty: boolean
}

/** 빠진 값은 라벨에 「· 미정」을 붙인다 — 색만으로 알리지 않는다 */
function labelOf(name: string, missing: boolean): string {
  return missing ? `${name} · 미정` : name
}

/**
 * 태스크명·담당자·마감을 한 줄에서 바로 고친다 (E-6). 세 칸 모두 44px 다.
 * 빠졌거나 승인할 수 없는 값의 칸은 레드 R2 — 라벨·경계 accent, 플레이스홀더 accent-solid, 포커스 accent-point
 */
export function TaskCreateOverrideFields({
  overrides,
  members,
  onInputChange,
  disabled,
  autoFocusFirstEmpty,
}: TaskCreateOverrideFieldsProps) {
  const { form, attention } = overrides
  const { errors } = form.formState
  const titleId = useId()
  const assigneeId = useId()
  const assigneeErrorId = `${assigneeId}-error`
  const dueId = useId()
  const loaded = members !== undefined
  const focused = useRef(false)

  useEffect(() => {
    if (!autoFocusFirstEmpty || !loaded || focused.current) return
    focused.current = true
    const { taskTitle, assigneeMemberId, dueDate } = form.getValues()
    const first =
      taskTitle.trim() === ''
        ? titleId
        : assigneeMemberId === ''
          ? assigneeId
          : dueDate === ''
            ? dueId
            : titleId
    document.getElementById(first)?.focus()
  }, [autoFocusFirstEmpty, loaded, form, titleId, assigneeId, dueId])

  const title = form.register('taskTitle')
  const assigneeMissing = attention.assignee === 'missing'
  // 팀원 목록을 받기 전에는 어떤 담당자든 목록에 없으므로 오류로 보이지 않는다. 미정(null)은 invalid 가 되지 않는다
  const assigneeInvalid = loaded && attention.assignee === 'invalid'
  const dueMissing = attention.due === 'missing'

  return (
    <div className={OVERRIDE_FIELDS_ROW}>
      <TextField
        {...title}
        id={titleId}
        size="lg"
        label="태스크명"
        labelTone={attention.title === null ? 'normal' : 'required-blocking'}
        error={errors.taskTitle?.message}
        disabled={disabled}
        onChange={(event) => {
          onInputChange()
          void title.onChange(event)
        }}
      />
      <Controller
        control={form.control}
        name="assigneeMemberId"
        render={({ field }) => (
          <div className="flex flex-col">
            <Label htmlFor={assigneeId} blocking={attention.assignee !== null} className="mb-6">
              {labelOf('담당자', assigneeMissing)}
            </Label>
            <Select
              ref={field.ref}
              id={assigneeId}
              name={field.name}
              value={field.value === '' ? null : field.value}
              onValueChange={(value) => {
                onInputChange()
                field.onChange(value ?? '')
              }}
              options={assigneeOptions(members, field.value === '' ? null : field.value)}
              noneOption={ASSIGNEE_NONE_OPTION}
              label="담당자"
              placeholder={assigneeMissing ? '담당자 고르기' : undefined}
              tone={attention.assignee === null ? 'normal' : 'blocking'}
              disabled={disabled || !loaded}
              onBlur={field.onBlur}
              aria-invalid={assigneeInvalid}
              aria-describedby={assigneeInvalid ? assigneeErrorId : undefined}
            />
            {assigneeInvalid ? (
              <ErrorText id={assigneeErrorId} className="mt-6">
                {OVERRIDE_FORM_MESSAGES.assignee}
              </ErrorText>
            ) : null}
          </div>
        )}
      />
      <Controller
        control={form.control}
        name="dueDate"
        render={({ field }) => (
          <DateField
            ref={field.ref}
            name={field.name}
            id={dueId}
            size="lg"
            label={labelOf('마감', dueMissing)}
            labelTone={attention.due === null ? 'normal' : 'required-blocking'}
            placeholder="YYYY-MM-DD 또는 미정"
            calendarLabel="마감 달력 열기"
            error={errors.dueDate?.message}
            disabled={disabled}
            value={field.value}
            onBlur={field.onBlur}
            onChange={(value) => {
              onInputChange()
              field.onChange(value)
            }}
          />
        )}
      />
    </div>
  )
}
