import { useQuery } from '@tanstack/react-query'
import { useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { ASSIGNEE_NONE_OPTION, assigneeOptions, memberListQueryOptions } from '@/entities/member'
import type { Task, TaskStatus } from '@/entities/task'
import { TaskAutoBlockNotice } from '@/features/task-auto-block'
import { taskFieldChanges, useTaskFieldsSave } from '@/features/task-fields-edit'
import type { TaskFieldChange, TaskFields } from '@/features/task-fields-edit'
import { TaskNotionSyncStatus } from '@/features/task-notion-sync'
import { isDateOnly, monthDayOf } from '@/shared/lib/date'
import { useUnsavedChanges } from '@/shared/lib/unsaved-changes'
import { Button } from '@/shared/ui/button'
import { DateField } from '@/shared/ui/date-field'
import { ErrorText } from '@/shared/ui/error-text'
import { Icon } from '@/shared/ui/icon'
import { Select } from '@/shared/ui/select'
import { assigneeLabel } from '../lib/history'

const PANEL = 'flex flex-col gap-12 rounded-16 bg-surface-sunken px-20 py-18'
const PANEL_TITLE = 'text-caption font-normal text-dim'
/* 세 칸 한 줄. 좁으면 칸이 아래로 쌓인다 — 390px 에서도 가로로 넘치지 않는다 */
const CELLS = 'grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] items-start gap-16'
const CELL = 'flex min-w-[0px] flex-col gap-6'
const TERM = 'text-[13px] text-sub'
const VALUE =
  'flex min-h-44 min-w-[0px] items-center justify-between gap-8 text-[15px] font-bold text-ink tabular-nums'
const PLAIN_VALUE = 'flex min-h-44 items-center text-[15px] text-ink'
const EDIT_BUTTON =
  'inline-flex h-44 w-44 shrink-0 items-center justify-center rounded-9 text-ink hover:bg-control disabled:text-line-strong'
const BLOCKER = 'flex flex-col gap-6 border-t border-divider pt-12'
const SAVE_ROW =
  'flex flex-wrap items-center justify-between gap-x-16 gap-y-8 border-t border-divider pt-12'

type EditableField = TaskFieldChange['field']

/**
 * 담당자·마감 고치기. 고친 칸의 값만 들고 있고, 고치지 않은 칸은 서버 값을 따른다 —
 * 보는 사이 다른 경로(답장 되돌리기 등)로 바뀐 값이 「바뀐 내용」으로 잘못 잡히지 않는다
 */
interface FieldsEdit {
  fields: Partial<TaskFields>
  /** 입력으로 열린 칸. 한 번에 하나다 */
  open: EditableField | null
}

const NO_EDIT: FieldsEdit = { fields: {}, open: null }

const DATE_HINT = '날짜는 2026-09-27 처럼 적어 주세요.'

/**
 * 태스크 정보 패널 (E-5). 담당자·마감·Notion 세 칸과, 막혔을 때만 막힌 사유.
 * PM 은 담당자·마감을 그 칸에서 고치고 아래 저장 줄에서 한 번에 저장한다. 저장 전에는 서버로 보내지 않는다
 */
export function TaskInfoPanel({
  workspaceId,
  task,
  status,
  names,
  isPm,
}: {
  workspaceId: string
  task: Task
  /** 진행 중인 상태 변경을 먼저 반영한 상태 */
  status: TaskStatus
  names: ReadonlyMap<string, string>
  isPm: boolean
}) {
  const titleId = useId()
  const assigneeId = useId()
  const dueId = useId()
  const [edit, setEdit] = useState<FieldsEdit>(NO_EDIT)
  const saving = useTaskFieldsSave(workspaceId, task.id)
  const original: TaskFields = { assigneeMemberId: task.assigneeMemberId, dueDate: task.dueDate }
  const draft: TaskFields = { ...original, ...edit.fields }
  const changes = taskFieldChanges(original, draft)
  const dueInvalid = draft.dueDate !== null && !isDateOnly(draft.dueDate)
  useUnsavedChanges(changes.length > 0)

  // 칸을 열면 입력으로, 닫으면 그 칸의 연필로 포커스를 옮긴다 — 누른 버튼이 사라져도 포커스를 잃지 않는다
  const inputs = useRef<Partial<Record<EditableField, HTMLElement | null>>>({})
  const editButtons = useRef<Partial<Record<EditableField, HTMLButtonElement | null>>>({})
  const openCell = (field: EditableField) => {
    flushSync(() => setEdit((current) => ({ ...current, open: field })))
    inputs.current[field]?.focus()
  }
  const closeAll = () => {
    const field = edit.open ?? changes[0]?.field ?? 'assignee'
    flushSync(() => setEdit(NO_EDIT))
    editButtons.current[field]?.focus()
  }
  const setField = (fields: Partial<TaskFields>) => {
    saving.clearError()
    setEdit((current) => ({ ...current, fields: { ...current.fields, ...fields } }))
  }
  const cancel = () => {
    saving.clearError()
    closeAll()
  }
  const blocker = task.blocker?.trim() ?? ''

  const assigneeCell =
    isPm && edit.open === 'assignee' ? (
      <AssigneeInput
        selectId={assigneeId}
        workspaceId={workspaceId}
        value={draft.assigneeMemberId}
        names={names}
        disabled={saving.pending}
        inputRef={(node) => {
          inputs.current.assignee = node
        }}
        onChange={(assigneeMemberId) => setField({ assigneeMemberId })}
      />
    ) : (
      <ReadValue
        text={assigneeLabel(draft.assigneeMemberId, names)}
        editLabel={isPm ? '담당자 수정' : null}
        disabled={saving.pending}
        buttonRef={(node) => {
          editButtons.current.assignee = node
        }}
        onEdit={() => openCell('assignee')}
      />
    )

  const dueCell =
    isPm && edit.open === 'dueDate' ? (
      <DateField
        size="lg"
        id={dueId}
        ref={(node) => {
          inputs.current.dueDate = node
        }}
        placeholder="미정"
        calendarLabel="마감 달력 열기"
        value={draft.dueDate ?? ''}
        disabled={saving.pending}
        error={dueInvalid ? DATE_HINT : undefined}
        onChange={(text) => setField({ dueDate: text === '' ? null : text })}
      />
    ) : (
      <ReadValue
        text={draft.dueDate ?? '마감 없음'}
        editLabel={isPm ? '마감 수정' : null}
        disabled={saving.pending}
        buttonRef={(node) => {
          editButtons.current.dueDate = node
        }}
        onEdit={() => openCell('dueDate')}
      />
    )

  return (
    <section aria-labelledby={titleId} className={PANEL}>
      <h2 id={titleId} className={PANEL_TITLE}>
        태스크 정보
      </h2>
      <dl className={CELLS}>
        <Cell term="담당자" inputId={isPm && edit.open === 'assignee' ? assigneeId : null}>
          {assigneeCell}
        </Cell>
        <Cell term="마감" inputId={isPm && edit.open === 'dueDate' ? dueId : null}>
          {dueCell}
        </Cell>
        <Cell term="Notion" inputId={null}>
          <div className={PLAIN_VALUE}>
            <TaskNotionSyncStatus workspaceId={workspaceId} taskId={task.id} canRetry={isPm} />
          </div>
        </Cell>
      </dl>
      {status === 'blocked' ? (
        <dl>
          <div className={BLOCKER}>
            <dt className={TERM}>막힌 사유</dt>
            <dd className="flex flex-col items-start gap-8 text-[15px] text-ink">
              <span className="wrap-anywhere">
                {blocker === '' ? '적힌 사유가 없어요' : blocker}
              </span>
              <TaskAutoBlockNotice workspaceId={workspaceId} task={task} isPm={isPm} />
            </dd>
          </div>
        </dl>
      ) : null}
      {isPm && (edit.open !== null || changes.length > 0) ? (
        <div className={SAVE_ROW}>
          <div className="flex min-w-[0px] flex-col gap-4">
            <p className="text-[13px] text-sub tabular-nums">
              {changeSummary(changes, names, dueInvalid)}
            </p>
            {saving.errorMessage === null ? null : (
              <ErrorText role="alert">{saving.errorMessage}</ErrorText>
            )}
          </div>
          <div className="flex gap-6">
            <Button variant="ghost" size="xl" disabled={saving.pending} onClick={cancel}>
              취소
            </Button>
            <Button
              variant="primary"
              size="xl"
              loading={saving.pending}
              disabled={changes.length === 0 || dueInvalid}
              onClick={() => saving.save(changes, closeAll)}
            >
              저장
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  )
}

/** 이름이 위, 값이 아래인 한 칸. 고치는 중이면 이름이 입력의 라벨이 된다 */
function Cell({
  term,
  inputId,
  children,
}: {
  term: string
  /** 고치는 중인 입력의 id. 읽기만 하는 칸은 null */
  inputId: string | null
  children: ReactNode
}) {
  return (
    <div className={CELL}>
      <dt className={TERM}>
        {inputId !== null ? (
          <>
            <label htmlFor={inputId}>{term}</label>
            <span aria-hidden="true"> · 고치는 중</span>
          </>
        ) : (
          term
        )}
      </dt>
      <dd className="min-w-[0px]">{children}</dd>
    </div>
  )
}

function ReadValue({
  text,
  editLabel,
  disabled,
  buttonRef,
  onEdit,
}: {
  text: string
  /** 연필 버튼 이름. null 이면 고칠 수 없는 사람이다 */
  editLabel: string | null
  disabled: boolean
  buttonRef: (node: HTMLButtonElement | null) => void
  onEdit: () => void
}) {
  return (
    <div className={VALUE}>
      <span className="wrap-anywhere">{text}</span>
      {editLabel === null ? null : (
        <button
          ref={buttonRef}
          type="button"
          aria-label={editLabel}
          className={EDIT_BUTTON}
          disabled={disabled}
          onClick={onEdit}
        >
          <Icon name="edit" size={18} />
        </button>
      )}
    </div>
  )
}

/** 담당자 고르기 — 맨 위 「미정」, 지금 담당자가 팀원 목록에 없으면 「알 수 없는 담당자」 */
function AssigneeInput({
  selectId,
  workspaceId,
  value,
  names,
  disabled,
  inputRef,
  onChange,
}: {
  selectId: string
  workspaceId: string
  value: string | null
  names: ReadonlyMap<string, string>
  disabled: boolean
  inputRef: (node: HTMLButtonElement | null) => void
  onChange: (memberId: string | null) => void
}) {
  const members = useQuery(memberListQueryOptions(workspaceId))
  return (
    <Select
      id={selectId}
      ref={inputRef}
      label="담당자"
      value={value}
      onValueChange={onChange}
      options={assigneeOptions(members.data, value, names)}
      noneOption={ASSIGNEE_NONE_OPTION}
      disabled={disabled}
    />
  )
}

function fieldValueLabel(
  change: TaskFieldChange,
  value: string | null,
  names: ReadonlyMap<string, string>,
): string {
  if (value === null) return '미정'
  if (change.field === 'assignee') return names.get(value) ?? '알 수 없는 담당자'
  return isDateOnly(value) ? monthDayOf(value) : value
}

const FIELD_LABEL: Record<EditableField, string> = { assignee: '담당자', dueDate: '마감' }

/** `바뀐 내용 1개 · 마감 09/20 → 09/27` */
function changeSummary(
  changes: readonly TaskFieldChange[],
  names: ReadonlyMap<string, string>,
  dueInvalid: boolean,
): string {
  if (changes.length === 0) return '바뀐 내용 없음'
  const lines = changes.map(
    (change) =>
      `${FIELD_LABEL[change.field]} ${fieldValueLabel(change, change.from, names)} → ${
        change.field === 'dueDate' && dueInvalid
          ? '날짜 확인 필요'
          : fieldValueLabel(change, change.to, names)
      }`,
  )
  return [`바뀐 내용 ${changes.length}개`, ...lines].join(' · ')
}
