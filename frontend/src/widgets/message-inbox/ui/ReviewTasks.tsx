import { useEffect, useId, useRef, useState } from 'react'
import type { ReactNode, Ref } from 'react'
import { MESSAGE_BODY_MAX_LENGTH } from '@/entities/message'
import type { Bundle, BundleTask } from '@/entities/message'
import { paths } from '@/shared/config/routes'
import { GuardedLink, useUnsavedChanges } from '@/shared/lib/unsaved-changes'
import { Button } from '@/shared/ui/button'
import { LockedButton } from '@/shared/ui/locked-button'
import { taskDueLabel, taskTitle } from '../lib/format'
import { NO_DRAFT, normalizeNote } from '../model/reviewDraft'
import type { ReviewDraft } from '../model/reviewDraft'

/* Messages 캔버스 실측 — 근거 블록(눌린 면 · 위아래 18 · 좌우 20 · 라운드 12 · 간격 10).
   행 버튼·메모 칸·빼기 확인은 시안에 없다 — 문구 고쳐 쓰기의 칸·버튼 모양을 그대로 쓴다 */
const TASKS = 'flex flex-col gap-10 rounded-12 bg-surface-sunken px-20 py-18'
/* 왜 보내려 하나요 블록의 이유 문장과 근거 링크. 앱 안 이동이라 바깥 링크 아이콘은 뺀다 */
const REASON = 'text-body leading-[1.75] wrap-anywhere text-ink'
const EVIDENCE_LINK = 'text-caption text-dim underline underline-offset-3 hover:text-sub'
const TEXTAREA =
  'min-h-[80px] w-full resize-y rounded-9 border border-input-border bg-surface px-12 py-10 text-[14px] leading-[1.8] text-ink focus-visible:-outline-offset-1'

export interface ReviewTasksProps {
  workspaceId: string
  bundle: Bundle
  draft: ReviewDraft
  onDraftChange: (draft: ReviewDraft) => void
  /** 행동이 진행 중이다. 열린 것이 없어도 행 버튼이 잠긴다 */
  busy: boolean
  removing: boolean
  savingNote: boolean
  onRemove: (task: BundleTask) => void
  /** 메모를 서버에 보낸다. null 이면 메모를 지운다. 성공하면 `onSaved` 를 부른다 */
  onSaveNote: (task: BundleTask, note: string | null, onSaved: () => void) => void
  /** 빼기·메모 실패 알림 자리 */
  failure: ReactNode
  /** 태스크를 빼 행이 사라지면 포커스를 받는다 */
  headingRef: Ref<HTMLHeadingElement>
}

/**
 * 묶은 태스크 — 행마다 재촉 이유와 근거 링크, `메모 고치기`·`빼기`. 메모 칸과 빼기 확인은 그 행 안에 열린다.
 * 메모를 바꾸거나 태스크를 빼면 서버가 문구를 규칙으로 다시 만들고 승인을 푼다 — 그래서 열기 전에 알린다.
 * 닫으면 연 버튼으로 포커스를 돌린다. 연 동안 버튼은 잠기고(`aria-disabled`) 펼침 상태를 알린다(`aria-expanded`)
 */
export function ReviewTasks({
  workspaceId,
  bundle,
  draft,
  onDraftChange,
  busy,
  removing,
  savingNote,
  onRemove,
  onSaveNote,
  failure,
  headingRef,
}: ReviewTasksProps) {
  const headingId = useId()
  const last = bundle.tasks.length === 1
  return (
    <section aria-labelledby={headingId} className={TASKS}>
      <h3
        id={headingId}
        ref={headingRef}
        tabIndex={-1}
        className="mono text-[11px] leading-[1.6] font-normal text-dim"
      >
        묶은 태스크 {bundle.tasks.length}
      </h3>
      <ul className="flex flex-col gap-10">
        {bundle.tasks.map((task) => (
          <TaskRow
            key={task.reminderId}
            task={task}
            evidence={evidenceLink(workspaceId, bundle.threadId, task)}
            recipientName={bundle.recipientName}
            last={last}
            approved={bundle.stage === 'approved'}
            draft={draft}
            onDraftChange={onDraftChange}
            busy={busy}
            removing={removing}
            savingNote={savingNote}
            onRemove={() => onRemove(task)}
            onSaveNote={(note, onSaved) => onSaveNote(task, note, onSaved)}
          />
        ))}
      </ul>
      {failure}
    </section>
  )
}

/** 답장이면 그 메시지를 보이며 대화를, 태스크 변경이면 태스크 상세를 연다 */
function evidenceLink(
  workspaceId: string,
  threadId: string,
  task: BundleTask,
): { to: string; label: string } | null {
  const { evidence } = task
  if (evidence === null) return null
  if (evidence.kind === 'reply')
    return {
      to: paths.messageThread(workspaceId, threadId, evidence.messageId),
      label: '답장 보기',
    }
  return task.taskId === null
    ? null
    : { to: paths.tasks(workspaceId, task.taskId), label: '변경 보기' }
}

function TaskRow({
  task,
  evidence,
  recipientName,
  last,
  approved,
  draft,
  onDraftChange,
  busy,
  removing,
  savingNote,
  onRemove,
  onSaveNote,
}: {
  task: BundleTask
  evidence: { to: string; label: string } | null
  recipientName: string
  last: boolean
  approved: boolean
  draft: ReviewDraft
  onDraftChange: (draft: ReviewDraft) => void
  busy: boolean
  removing: boolean
  savingNote: boolean
  onRemove: () => void
  onSaveNote: (note: string | null, onSaved: () => void) => void
}) {
  const noteButtonRef = useRef<HTMLButtonElement>(null)
  const removeButtonRef = useRef<HTMLButtonElement>(null)
  const title = taskTitle(task)
  const mine = 'reminderId' in draft && draft.reminderId === task.reminderId
  const editing = mine && draft.kind === 'note'
  const confirming = mine && draft.kind === 'remove'
  const locked = busy || draft.kind !== 'none'
  const close = (button: HTMLButtonElement | null) => {
    onDraftChange(NO_DRAFT)
    button?.focus()
  }

  return (
    <li className="flex flex-col gap-8">
      <div className="flex items-start justify-between gap-12">
        <div className="flex min-w-[0px] flex-col gap-2">
          <span className="flex flex-wrap items-baseline gap-x-8">
            <span className="text-body font-semibold wrap-anywhere text-ink">{title}</span>
            <span className="mono text-meta text-dim">{taskDueLabel(task)}</span>
          </span>
          {task.note === null ? null : (
            <span className="text-caption leading-[1.6] wrap-anywhere whitespace-pre-line text-sub">
              메모: {task.note}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-4">
          <LockedButton
            ref={noteButtonRef}
            variant="ghost"
            size="sm"
            aria-label={`'${title}' 메모 고치기`}
            aria-expanded={editing}
            locked={locked}
            onClick={() => onDraftChange({ kind: 'note', reminderId: task.reminderId })}
          >
            메모 고치기
          </LockedButton>
          <LockedButton
            ref={removeButtonRef}
            variant="ghost"
            size="sm"
            aria-label={`'${title}' 빼기`}
            aria-expanded={confirming}
            locked={locked}
            onClick={() => onDraftChange({ kind: 'remove', reminderId: task.reminderId })}
          >
            빼기
          </LockedButton>
        </div>
      </div>
      {task.reason === null ? null : (
        <div className="flex flex-col items-start gap-4">
          <p className={REASON}>{task.reason}</p>
          {evidence === null ? null : (
            <GuardedLink
              to={evidence.to}
              aria-label={`'${title}' ${evidence.label}`}
              className={EVIDENCE_LINK}
            >
              {evidence.label}
            </GuardedLink>
          )}
        </div>
      )}
      {editing ? (
        <NoteEditor
          title={title}
          initialNote={task.note}
          saving={savingNote}
          onCancel={() => close(noteButtonRef.current)}
          onSave={(note) => onSaveNote(note, () => close(noteButtonRef.current))}
        />
      ) : null}
      {confirming ? (
        <RemoveConfirm
          message={
            last
              ? `마지막 태스크예요. 빼면 ${recipientName}님에게 이 메시지를 보내지 않아요.`
              : `빼면 남은 태스크로 문구를 다시 만들어요.${approved ? ' 승인이 풀려 다시 승인해야 해요.' : ''}`
          }
          confirmLabel={last ? '빼고 보내지 않기' : '빼기'}
          removing={removing}
          busy={busy}
          onCancel={() => close(removeButtonRef.current)}
          onConfirm={onRemove}
        />
      ) : null}
    </li>
  )
}

function NoteEditor({
  title,
  initialNote,
  saving,
  onCancel,
  onSave,
}: {
  title: string
  initialNote: string | null
  saving: boolean
  onCancel: () => void
  onSave: (note: string | null) => void
}) {
  const fieldId = useId()
  const hintId = useId()
  const fieldRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    fieldRef.current?.focus()
  }, [])
  const [value, setValue] = useState(initialNote ?? '')
  // 서버는 같은 메모를 받으면 아무것도 하지 않는다 — 바뀐 것이 없으면 저장할 것도 없다
  const unchanged = normalizeNote(value) === initialNote
  useUnsavedChanges(!unchanged)

  return (
    <div className="flex flex-col gap-8">
      <label htmlFor={fieldId} className="text-caption text-sub">
        &apos;{title}&apos; 메모
      </label>
      <textarea
        ref={fieldRef}
        id={fieldId}
        className={TEXTAREA}
        value={value}
        maxLength={MESSAGE_BODY_MAX_LENGTH}
        disabled={saving}
        aria-describedby={hintId}
        onChange={(event) => setValue(event.target.value)}
      />
      <p id={hintId} className="text-caption text-dim">
        메모를 바꾸면 문구를 다시 만들고 승인이 풀려요. 비우고 저장하면 메모를 지워요.
      </p>
      <div className="flex items-center justify-between gap-12">
        <span className="mono text-meta text-dim">
          {value.length}/{MESSAGE_BODY_MAX_LENGTH}
        </span>
        <div className="flex items-center gap-8">
          <Button variant="ghost" disabled={saving} onClick={onCancel}>
            취소
          </Button>
          <LockedButton
            aria-busy={saving || undefined}
            locked={saving || unchanged}
            onClick={() => onSave(normalizeNote(value))}
          >
            저장
          </LockedButton>
        </div>
      </div>
    </div>
  )
}

function RemoveConfirm({
  message,
  confirmLabel,
  removing,
  busy,
  onCancel,
  onConfirm,
}: {
  message: string
  confirmLabel: string
  removing: boolean
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const messageId = useId()
  const groupRef = useRef<HTMLDivElement>(null)
  // 확인을 열면 그 경고를 먼저 읽게 한다. 뺄 버튼에 바로 두지 않는다
  useEffect(() => {
    groupRef.current?.focus()
  }, [])
  return (
    <div
      ref={groupRef}
      role="group"
      aria-labelledby={messageId}
      tabIndex={-1}
      className="flex flex-col items-start gap-8 rounded-9 border border-line bg-surface px-14 py-12"
    >
      <p id={messageId} className="text-caption text-ink">
        {message}
      </p>
      <div className="flex items-center gap-8">
        <Button variant="ghost" disabled={removing} onClick={onCancel}>
          취소
        </Button>
        <LockedButton aria-busy={removing || undefined} locked={busy} onClick={onConfirm}>
          {confirmLabel}
        </LockedButton>
      </div>
    </div>
  )
}
