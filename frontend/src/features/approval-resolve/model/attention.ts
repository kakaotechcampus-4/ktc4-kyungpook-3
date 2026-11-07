import type { ApprovalMissing, TaskCreateFields, TaskCreateIssue } from '@/entities/approval'

/**
 * 칸마다 PM 이 봐야 하는 까닭. `missing` 은 AI 가 정하지 못해 아직 비어 있는 값(승인은 된다),
 * `invalid` 는 지금 값으로는 승인할 수 없는 값이다. 둘 다 레드 R2 로 보인다
 */
export type FieldAttention = 'missing' | 'invalid' | null

const STILL_EMPTY: Record<ApprovalMissing, (fields: TaskCreateFields) => boolean> = {
  assignee: (fields) => fields.assigneeMemberId === null,
  due: (fields) => fields.dueDate === null,
}

/**
 * 빠진 값 표시의 한 곳. 승인의 `missing` 중 PM 이 아직 채우지 않은 것과 지금 값의 검사 결과로 정한다 —
 * 라벨·경계, 근거의 원문 강조, 제목 아래 안내, 「확인이 필요한 이유」 가 모두 이 값을 읽는다
 */
export function fieldAttention(
  missing: readonly ApprovalMissing[],
  fields: TaskCreateFields,
  issues: readonly TaskCreateIssue[],
): Record<TaskCreateIssue, FieldAttention> {
  const of = (field: TaskCreateIssue): FieldAttention => {
    if (issues.includes(field)) return 'invalid'
    if (field === 'title') return null
    return missing.includes(field) && STILL_EMPTY[field](fields) ? 'missing' : null
  }
  return { title: of('title'), assignee: of('assignee'), due: of('due') }
}

/** 아직 비어 있는 빠진 값. 화면 순서(담당자 → 마감)다 */
export function openGaps(attention: Record<TaskCreateIssue, FieldAttention>): ApprovalMissing[] {
  return (['assignee', 'due'] as const).filter((field) => attention[field] === 'missing')
}
