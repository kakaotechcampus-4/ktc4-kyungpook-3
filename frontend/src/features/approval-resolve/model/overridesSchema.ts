import { z } from 'zod'
import { TASK_TITLE_MAX_LENGTH, validateTaskCreateFields } from '@/entities/approval'
import type { TaskCreateFields, TaskCreateIssue } from '@/entities/approval'

/* 생성 승인 보완 안내 (계획 §4-2). 캔버스에 오류 문구가 없어 D-149 에 맞춰 이 기능에서 정한다 */
export const OVERRIDE_FORM_MESSAGES = {
  titleRequired: '제목을 입력해 주세요.',
  titleTooLong: `제목은 ${TASK_TITLE_MAX_LENGTH}자 이하로 입력해 주세요.`,
  assignee: '이 워크스페이스의 팀원 중에서 담당자를 골라 주세요.',
  dueRequired: '마감 날짜를 입력해 주세요.',
  dueInvalid: '마감은 YYYY-MM-DD 형식의 있는 날짜여야 해요.',
} as const

/** 폼 값. 고르지 않은 담당자·마감은 빈 문자열이다 */
export interface OverrideFormValues {
  taskTitle: string
  assigneeMemberId: string
  dueDate: string
}

export const OVERRIDE_FIELD: Record<TaskCreateIssue, keyof OverrideFormValues> = {
  title: 'taskTitle',
  assignee: 'assigneeMemberId',
  due: 'dueDate',
}

export function toTaskCreateFields(values: OverrideFormValues): TaskCreateFields {
  return {
    taskTitle: values.taskTitle,
    assigneeMemberId: values.assigneeMemberId === '' ? null : values.assigneeMemberId,
    dueDate: values.dueDate === '' ? null : values.dueDate,
  }
}

export function toOverrideFormValues(fields: TaskCreateFields): OverrideFormValues {
  return {
    taskTitle: fields.taskTitle,
    assigneeMemberId: fields.assigneeMemberId ?? '',
    dueDate: fields.dueDate ?? '',
  }
}

function issueMessage(issue: TaskCreateIssue, values: OverrideFormValues): string {
  if (issue === 'title')
    return values.taskTitle.trim() === ''
      ? OVERRIDE_FORM_MESSAGES.titleRequired
      : OVERRIDE_FORM_MESSAGES.titleTooLong
  if (issue === 'assignee') return OVERRIDE_FORM_MESSAGES.assignee
  return values.dueDate === ''
    ? OVERRIDE_FORM_MESSAGES.dueRequired
    : OVERRIDE_FORM_MESSAGES.dueInvalid
}

/**
 * 보완 폼 스키마. 판정은 승인 본문과 같은 `validateTaskCreateFields` 하나다 — 제목은 trim 후 코드 포인트 1~300자,
 * 담당자는 지금 공간의 팀원, 마감은 달력에 있는 `YYYY-MM-DD`(0001~9999년). 걸린 칸마다 그 칸의 오류다.
 * 제목은 앞뒤 공백을 지운 값으로 넘긴다
 */
export function overridesSchema(memberIds: readonly string[]) {
  return z
    .object({ taskTitle: z.string(), assigneeMemberId: z.string(), dueDate: z.string() })
    .superRefine((values, ctx) => {
      for (const issue of validateTaskCreateFields(toTaskCreateFields(values), memberIds))
        ctx.addIssue({
          code: 'custom',
          path: [OVERRIDE_FIELD[issue]],
          message: issueMessage(issue, values),
        })
    })
    .transform((values) => ({ ...values, taskTitle: values.taskTitle.trim() }))
}
