import type { TaskHistoryEntry } from '@/entities/task'
import { TASK_STATUSES, TASK_STATUS_LABEL } from '@/features/task-status'
import { formatSeoulDateTime } from '@/shared/lib/date'
import { parseEnumParam } from '@/shared/lib/url'

const FIELD_LABEL: Record<TaskHistoryEntry['field'], string> = {
  assignee: '담당자',
  start_date: '시작일',
  due_date: '마감',
  status: '상태',
  title: '제목',
  progress: '진행률',
  blocker: '막힌 사유',
}

const SOURCE_LABEL: Record<TaskHistoryEntry['source'], string> = {
  meeting: '회의',
  chat: '대화',
  checkin: '체크인',
  notion: 'Notion',
  reminder_reply: '리마인더 답장',
  manual: '직접 변경',
}

/** 담당자 이름. 없으면 `담당자 없음`, 이름을 모르면 `알 수 없는 담당자` */
export function assigneeLabel(memberId: string | null, names: ReadonlyMap<string, string>): string {
  if (memberId === null) return '담당자 없음'
  return names.get(memberId) ?? '알 수 없는 담당자'
}

function valueLabel(
  field: TaskHistoryEntry['field'],
  value: string | null,
  names: ReadonlyMap<string, string>,
): string {
  if (field === 'assignee') return assigneeLabel(value, names)
  if (value === null || value === '') return '없음'
  if (field === 'status') {
    const status = parseEnumParam(value, TASK_STATUSES)
    return status === null ? value : TASK_STATUS_LABEL[status]
  }
  if (field === 'progress') return `${value}%`
  return value
}

export interface HistoryLine {
  id: string
  /** `상태: 할 일 → 진행 중` */
  change: string
  /** `김서연 · 직접 변경 · 2026-09-16 15:00` */
  meta: string
  rolledBack: boolean
}

/** 변경 이력 한 줄. 서버가 준 순서(최신순)를 바꾸지 않는다 */
export function historyLine(
  entry: TaskHistoryEntry,
  names: ReadonlyMap<string, string>,
): HistoryLine {
  const who =
    entry.changedBy === null
      ? entry.isAuto
        ? '자동'
        : '알 수 없음'
      : (names.get(entry.changedBy) ?? '알 수 없는 팀원')
  return {
    id: entry.id,
    change: `${FIELD_LABEL[entry.field]}: ${valueLabel(entry.field, entry.oldValue, names)} → ${valueLabel(entry.field, entry.newValue, names)}`,
    meta: [who, SOURCE_LABEL[entry.source], formatSeoulDateTime(entry.createdAt)]
      .filter(Boolean)
      .join(' · '),
    rolledBack: entry.isRolledBack,
  }
}
