import type {
  ReplyChangeField,
  ReplyChangeLine,
  ReplyChangeResult,
  TaskHistoryEntry,
  TaskTimelineItem,
} from '@/entities/task'
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
  scope: '범위 변경',
}

/** 이전 값이 없는 결정이라 `이전 → 이후` 대신 새 값만 보인다 (#205) */
const STATEMENT_FIELDS: ReadonlySet<TaskHistoryEntry['field']> = new Set(['scope'])

const SOURCE_LABEL: Record<TaskHistoryEntry['source'], string> = {
  meeting: '회의',
  chat: '대화',
  checkin: '체크인',
  notion: 'Notion',
  reminder_reply: '리마인더 답장',
  manual: '직접 변경',
  scheduler: '스케줄러',
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
  /** `상태: 할 일 → 진행 중`, 범위 변경은 `범위 변경: 소셜 로그인은 빼기로 했어요.` */
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
  const after = valueLabel(entry.field, entry.newValue, names)
  return {
    id: entry.id,
    change: STATEMENT_FIELDS.has(entry.field)
      ? `${FIELD_LABEL[entry.field]}: ${after}`
      : `${FIELD_LABEL[entry.field]}: ${valueLabel(entry.field, entry.oldValue, names)} → ${after}`,
    meta: [who, SOURCE_LABEL[entry.source], formatSeoulDateTime(entry.createdAt)]
      .filter(Boolean)
      .join(' · '),
    rolledBack: entry.isRolledBack,
  }
}

export const REPLY_BODY_HIDDEN = '답장 내용은 PM과 답장한 팀원만 볼 수 있어요.'

const CHANNEL_LABEL: Record<'discord' | 'web', string> = { discord: 'Discord', web: '웹' }

type ChangeText = (value: string | null, names: ReadonlyMap<string, string>) => string

const labeled =
  (field: 'status' | 'due_date' | 'scope'): ChangeText =>
  (value, names) =>
    `${FIELD_LABEL[field]}: ${valueLabel(field, value, names)}`

/** 답장이 바꾸려 한 값. 담당자는 팀원에서 못 찾은 이름(답장에 적힌 그대로)일 수 있어 그대로 보인다 */
const CHANGE_TEXT: Record<ReplyChangeField, ChangeText> = {
  status: labeled('status'),
  due_date: labeled('due_date'),
  scope: labeled('scope'),
  assignee: (value, names) =>
    `${FIELD_LABEL.assignee}: ${value === null ? '없음' : (names.get(value) ?? value)}`,
  due_clear: () => '마감을 없애자는 내용이에요',
  failed: () => '무엇을 바꿀지 정하지 못했어요',
  none: () => '바꿀 내용이 없었어요',
  unknown: () => '어느 태스크인지 정하지 못했어요',
}

const RESULT_LABEL: Record<ReplyChangeResult, string> = {
  applied: '자동 반영',
  undone: '되돌림',
  pending: '승인 대기',
  approved: '승인함',
  rejected: '반려함',
  noted: '반영하지 않음',
  recorded: '기록함',
}

export interface ReplyChangeView {
  id: string
  /** `상태: 완료`, 값이 없는 줄은 `바꿀 내용이 없었어요` 같은 문장 */
  change: string
  result: string
  summary: string | null
  undoable: boolean
}

export interface ReplyGroup {
  id: string
  /** `이재환 답장 · Discord · 2026-09-17 10:00` */
  meta: string
  /** 볼 수 없는 사람에게는 null 이다 */
  body: string | null
  changes: ReplyChangeView[]
}

function replyChange(line: ReplyChangeLine, names: ReadonlyMap<string, string>): ReplyChangeView {
  return {
    id: line.id,
    change: CHANGE_TEXT[line.field](line.newValue, names),
    result: RESULT_LABEL[line.result],
    summary: line.summary,
    undoable: line.undoable,
  }
}

/** 답장 한 통과 그 답장이 바꾼 값들 */
export function replyGroup(
  item: Extract<TaskTimelineItem, { kind: 'reply' }>,
  names: ReadonlyMap<string, string>,
): ReplyGroup {
  return {
    id: item.id,
    meta: [
      `${item.memberName} 답장`,
      item.channel === null ? null : CHANNEL_LABEL[item.channel],
      formatSeoulDateTime(item.at),
    ]
      .filter(Boolean)
      .join(' · '),
    body: item.body,
    changes: item.changes.map((line) => replyChange(line, names)),
  }
}
