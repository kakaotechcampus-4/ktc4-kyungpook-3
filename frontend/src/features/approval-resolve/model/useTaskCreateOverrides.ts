import { useMemo, useState } from 'react'
import { useWatch } from 'react-hook-form'
import type { UseFormReturn } from 'react-hook-form'
import { aliasToLearn, taskCreateValues, validateTaskCreateFields } from '@/entities/approval'
import type {
  TaskCreateApproval,
  TaskCreateEdits,
  TaskCreateFields,
  TaskCreateIssue,
} from '@/entities/approval'
import { useAppForm } from '@/shared/lib/form'
import { fieldAttention } from './attention'
import type { FieldAttention } from './attention'
import { overridesSchema, toOverrideFormValues, toTaskCreateFields } from './overridesSchema'
import type { OverrideFormValues } from './overridesSchema'

export interface TaskCreateOverrides {
  form: UseFormReturn<OverrideFormValues>
  /** 지금 칸의 값. 비운 담당자·마감은 null(미정)이다 */
  fields: TaskCreateFields
  /** PM 이 바꾼 칸만. 승인 본문의 `task_overrides` 가 된다 — 원래 값으로 되돌린 칸은 빠진다 */
  edits: TaskCreateEdits
  dirty: boolean
  attention: Record<TaskCreateIssue, FieldAttention>
  /** 지금 담당자에게 별칭으로 등록할 글자. null 이면 묻지 않는다 (#523) */
  aliasText: string | null
  /** 별칭 등록 체크. 처음엔 켜져 있고, 미정을 골라 숨겨도 PM 이 고른 값을 기억한다 */
  saveAlias: boolean
  setSaveAlias: (saveAlias: boolean) => void
}

/**
 * 생성 승인의 늘 열린 입력 칸 (#471). 고친 값은 이 폼 하나가 쥐고, 승인할 때 `edits` 를 그대로 보낸다.
 * 검사는 승인 본문과 같은 `overridesSchema`(= `validateTaskCreateFields`)다
 */
export function useTaskCreateOverrides(
  approval: TaskCreateApproval,
  memberIds: readonly string[],
): TaskCreateOverrides {
  const schema = useMemo(() => overridesSchema(memberIds), [memberIds])
  const { form } = useAppForm(schema, toOverrideFormValues(taskCreateValues(approval)))
  const fields = toTaskCreateFields(useWatch({ control: form.control }) as OverrideFormValues)
  const { dirtyFields, isDirty } = form.formState
  const edits: TaskCreateEdits = {
    ...(dirtyFields.taskTitle ? { taskTitle: fields.taskTitle } : {}),
    ...(dirtyFields.assigneeMemberId ? { assigneeMemberId: fields.assigneeMemberId } : {}),
    ...(dirtyFields.dueDate ? { dueDate: fields.dueDate } : {}),
  }
  const issues = validateTaskCreateFields(fields, memberIds)
  const [saveAlias, setSaveAlias] = useState(true)
  return {
    form,
    fields,
    edits,
    dirty: isDirty,
    attention: fieldAttention(approval.missing, fields, issues),
    aliasText: aliasToLearn(approval, fields),
    saveAlias,
    setSaveAlias,
  }
}
