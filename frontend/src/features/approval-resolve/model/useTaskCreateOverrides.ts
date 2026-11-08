import { useEffect, useMemo, useRef, useState } from 'react'
import { useWatch } from 'react-hook-form'
import type { UseFormReturn } from 'react-hook-form'
import {
  aliasToLearn,
  approvalChange,
  taskCreateValues,
  validateTaskCreateFields,
} from '@/entities/approval'
import type {
  ApprovalChange,
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
  /** 지금 폼이 맞춰진 카드. 승인·반려는 PM 이 화면에서 본 이 카드의 `payloadVersion` 을 싣는다 (#547) */
  seen: TaskCreateApproval
  /** 폼을 연 뒤 카드가 바뀌었으면 처음 본 카드와 지금 카드의 차이. 바뀐 적 없으면 null */
  change: { before: TaskCreateApproval; diff: ApprovalChange } | null
}

/**
 * 생성 승인의 늘 열린 입력 칸 (#471). 고친 값은 이 폼 하나가 쥐고, 승인할 때 `edits` 를 그대로 보낸다.
 * 검사는 승인 본문과 같은 `overridesSchema`(= `validateTaskCreateFields`)다.
 * 같은 승인의 새 카드(`payloadVersion` 이 다름)를 받으면 고치지 않은 칸만 새 값으로 바꾸고 PM 이 고친 칸은 둔다 (#512)
 */
export function useTaskCreateOverrides(
  approval: TaskCreateApproval,
  memberIds: readonly string[],
): TaskCreateOverrides {
  const schema = useMemo(() => overridesSchema(memberIds), [memberIds])
  const [seen, setSeen] = useState(approval)
  const [firstSeen, setFirstSeen] = useState<TaskCreateApproval | null>(null)
  if (approval.payloadVersion !== seen.payloadVersion) {
    setFirstSeen(firstSeen ?? seen)
    setSeen(approval)
  }
  const { form } = useAppForm(schema, toOverrideFormValues(taskCreateValues(seen)))
  const applied = useRef(seen)
  useEffect(() => {
    if (applied.current === seen) return
    applied.current = seen
    // 기본값을 새 카드로 옮겨, 뒤에 PM 이 고치는 칸도 새 제안과 비교한다
    form.reset(toOverrideFormValues(taskCreateValues(seen)), {
      keepDirtyValues: true,
      keepDirty: true,
    })
  }, [form, seen])
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
    seen,
    change:
      firstSeen === null ? null : { before: firstSeen, diff: approvalChange(firstSeen, seen) },
  }
}
