import type { Approval } from '@/entities/approval'
import type { Task } from '@/entities/task'
import { TASK_STATUSES, TASK_STATUS_LABEL } from '@/features/task-status'
import { parseEnumParam } from '@/shared/lib/url'

/** 승인 payload·충돌의 필드 이름. 서버 `_TASK_UPDATE_FIELDS` 와 같은 집합이다 */
const FIELD_LABEL: Record<string, string> = {
  title: '제목',
  assignee_member_id: '담당자',
  status: '상태',
  blocker: '막힌 사유',
  due_date: '마감',
}

export function fieldLabel(field: string): string {
  return FIELD_LABEL[field] ?? field
}

/** 담당자 이름. 없으면 `정하지 않았어요`, 이름을 모르면 `알 수 없는 담당자` */
export function memberLabel(memberId: string | null, names: ReadonlyMap<string, string>): string {
  if (memberId === null) return '정하지 않았어요'
  return names.get(memberId) ?? '알 수 없는 담당자'
}

/** 변경·충돌 표의 값. payload 에 저장된 모양(날짜는 ISO 문자열) 그대로 온다 */
export function fieldValueLabel(
  field: string,
  value: unknown,
  names: ReadonlyMap<string, string>,
): string {
  if (field === 'assignee_member_id')
    return memberLabel(typeof value === 'string' ? value : null, names)
  if (value === null || value === undefined || value === '') return '없음'
  if (field === 'status' && typeof value === 'string') {
    const status = parseEnumParam(value, TASK_STATUSES)
    return status === null ? value : TASK_STATUS_LABEL[status]
  }
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '알 수 없는 값'
}

/** 변경 승인 비교에서 그 필드의 지금 태스크 값. 서버 필드 이름을 도메인 필드로 옮긴다 */
export function currentFieldValue(task: Task, field: string): unknown {
  switch (field) {
    case 'title':
      return task.title
    case 'assignee_member_id':
      return task.assigneeMemberId
    case 'status':
      return task.status
    case 'blocker':
      return task.blocker
    case 'due_date':
      return task.dueDate
    default:
      return undefined
  }
}

export function approvalKindLabel(approval: Approval): string {
  if (approval.kind === 'task_create') return '새 태스크 확인'
  if (approval.kind === 'task_update') return '태스크 변경 확인'
  return '지원하지 않는 확인 요청'
}

export function approvalStatusLabel(approval: Approval): string {
  if (approval.status === 'approved') return '승인됨'
  if (approval.status === 'rejected') return '반려됨'
  return '확인 대기'
}
