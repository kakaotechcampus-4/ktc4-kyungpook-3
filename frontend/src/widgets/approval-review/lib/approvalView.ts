import type { Approval, ApprovalMissing } from '@/entities/approval'
import type { Task } from '@/entities/task'
import { TASK_STATUSES, TASK_STATUS_LABEL } from '@/entities/task'
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

/** 대기 중인 승인은 질문으로 묻는다(보내기 전 확인 「이 메시지, 보낼까요?」와 같은 꼴). 처리된 승인은 종류 이름이다 */
export function approvalHeading(approval: Approval): string {
  if (approval.status === 'pending' && approval.kind === 'task_create')
    return '이 태스크, 승인할까요?'
  if (approval.status === 'pending' && approval.kind === 'task_update')
    return '이 변경, 승인할까요?'
  return approvalKindLabel(approval)
}

/* 빠진 값 이름과 그 조사. 빠진 값은 담당자·마감 둘뿐이라 조사를 표로 둔다 */
const GAP_SUBJECT: Record<ApprovalMissing, string> = { assignee: '담당자가', due: '마감이' }
const GAP_OBJECT: Record<ApprovalMissing, string> = { assignee: '담당자를', due: '마감을' }
const GAP_DECIDED: Record<ApprovalMissing, string> = { assignee: '담당자를', due: '날짜를' }

/** 마지막 한글 글자에 받침이 있는가. 받침 ㄹ 은 `ㄹ` 로 따로 돌려준다. 한글이 없으면 null */
function finalConsonant(text: string): 'none' | 'ㄹ' | 'other' | null {
  const last = [...text].reverse().find((char) => char >= '가' && char <= '힣')
  if (last === undefined) return null
  const index = (last.charCodeAt(0) - 0xac00) % 28
  return index === 0 ? 'none' : index === 8 ? 'ㄹ' : 'other'
}

/** 제목 아래 안내. 빠진 값이 없으면 null */
export function gapSummary(gaps: readonly ApprovalMissing[]): string | null {
  if (gaps.length === 0) return null
  const subject = gaps.length === 1 ? GAP_SUBJECT[gaps[0]] : '담당자와 마감이'
  return `${subject} 아직 정해지지 않았어요.`
}

/** 「확인이 필요한 이유」 한 줄. 회의에서 한 말이 있으면 그 말을 인용한다 */
export function gapReason(gap: ApprovalMissing, raw: string | null): string {
  if (raw === null || raw.trim() === '') return `회의에서 ${GAP_OBJECT[gap]} 말하지 않았어요`
  const quoted = finalConsonant(raw) === 'none' ? '라고' : '이라고'
  return `회의에서는 「${raw}」${quoted}만 해서 ${GAP_DECIDED[gap]} 정하지 못했어요`
}

/** `9/21(월)로 채우기`. 요일 글자의 받침으로 로·으로를 고른다 */
export function fillLabel(monthDayWeekday: string): string {
  const consonant = finalConsonant(monthDayWeekday)
  return `${monthDayWeekday}${consonant === 'other' ? '으로' : '로'} 채우기`
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
