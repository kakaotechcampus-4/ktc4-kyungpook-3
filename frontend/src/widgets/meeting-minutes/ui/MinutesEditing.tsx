import { useEffect, useId, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent, ReactNode, RefObject } from 'react'
import type { TranscriptLine } from '@/entities/minutes'
import {
  LINE_EDIT_HINT,
  TITLE_EDIT_HINT,
  lineInputFailure,
  normalizeTitle,
  titleInputFailure,
  useLineEdit,
  useTitleEdit,
} from '@/features/minutes-edit'
import { useUnsavedChanges } from '@/shared/lib/unsaved-changes'
import { Button } from '@/shared/ui/button'
import { Icon } from '@/shared/ui/icon'
import { LockedButton } from '@/shared/ui/locked-button'
import { MinutesTitle } from './MinutesTitle'

/* 회의록 제목·발화 고치기 (#551, 계약 §4.4.3). 팀원 누구나 고친다. 원문은 남고 고친 것에는 「고침」이 붙는다 */

const EDITED_CHIP =
  'inline-flex h-20 shrink-0 items-center gap-3 rounded-6 bg-control px-7 text-meta leading-none font-semibold text-sub hover:bg-line-strong aria-expanded:bg-ink aria-expanded:text-surface'
const ICON_BUTTON =
  'inline-flex size-32 shrink-0 items-center justify-center rounded-9 text-dim hover:bg-control hover:text-ink'
/* 16px 아래면 iOS Safari 가 입력할 때 화면을 확대한다 — 휴대폰 폭에서는 16px 이다 */
const TITLE_INPUT =
  'h-[34px] min-w-[0px] flex-1 rounded-9 border border-input-border bg-surface px-10 text-[18px] font-semibold text-ink focus-visible:-outline-offset-1'
const LINE_INPUT =
  'w-full resize-y rounded-9 border border-input-border bg-surface px-12 py-8 text-[14px] leading-[1.7] text-ink focus-visible:-outline-offset-1 max-md:text-[16px]'
const NOTE = 'text-caption text-dim'
const FAILURE = 'text-[12px] text-accent'
const ORIGINAL_BOX = 'flex flex-col items-start gap-6 rounded-9 bg-surface-sunken px-12 py-10'
/* 긴 줄(띄어쓰기 없는 주소·영문)도 폭 안에서 접는다 */
const LINE_TEXT = 'text-[14px] leading-[1.7] whitespace-pre-wrap text-ink wrap-anywhere'
const LINE_BUTTON = `-mx-6 block w-[calc(100%+12px)] rounded-6 px-6 text-left hover:bg-surface-sunken aria-disabled:text-dim aria-disabled:hover:bg-transparent ${LINE_TEXT}`

/** 닫힌 뒤 고치기를 연 단추로 포커스를 돌린다. 다른 줄을 열어 닫힌 때는 돌리지 않는다 */
function useReturnFocus(open: boolean, target: RefObject<HTMLElement | null>) {
  const pending = useRef(false)
  useEffect(() => {
    if (open || !pending.current) return
    pending.current = false
    target.current?.focus()
  })
  return () => {
    pending.current = true
  }
}

function EditedToggle({
  expanded,
  controls,
  label,
  onToggle,
}: {
  expanded: boolean
  controls: string
  label: string
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      className={EDITED_CHIP}
      aria-expanded={expanded}
      aria-controls={controls}
      aria-label={label}
      onClick={onToggle}
    >
      고침
    </button>
  )
}

/** 고치는 칸 아래의 안내와 실패 문구. 서버 실패는 저장을 누른 뒤 생겨 바로 읽힌다 */
function EditNotes({
  hintId,
  hint,
  messageId,
  local,
  server,
}: {
  hintId: string
  hint: string
  messageId: string
  local: string | null
  server: string | null
}) {
  return (
    <>
      <p id={hintId} className={NOTE}>
        {hint}
      </p>
      {local !== null ? (
        <p id={messageId} className={FAILURE}>
          {local}
        </p>
      ) : server !== null ? (
        <p id={messageId} role="alert" className={FAILURE}>
          {server}
        </p>
      ) : null}
    </>
  )
}

function EditButtons({ saving, onCancel }: { saving: boolean; onCancel: () => void }) {
  return (
    <>
      <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={onCancel}>
        취소
      </Button>
      <LockedButton
        type="submit"
        variant="primary"
        size="sm"
        locked={saving}
        aria-busy={saving || undefined}
        // 제출은 form 의 onSubmit 이 맡는다 — 잠긴 동안의 누름은 LockedButton 이 버린다
        onClick={() => {}}
      >
        저장
      </LockedButton>
    </>
  )
}

/** 고치기를 닫는 Esc. 다른 Esc 처리(대화상자 등)로 번지지 않게 여기서 멈춘다 */
function closeOnEscape(event: KeyboardEvent, close: () => void) {
  if (event.key !== 'Escape') return
  event.preventDefault()
  event.stopPropagation()
  close()
}

/**
 * 회의록 머리의 제목 줄. 고치기 단추로 같은 자리에서 고치고, 고친 제목에는 「고침」이 붙어 처음 제목과 되돌리기를 펼친다.
 * 고치는 동안은 저장하지 않은 글로 이동을 묻는다 (D-138)
 */
export function EditableTitle({
  workspaceId,
  meetingId,
  title,
  titleEdited,
  titleOriginal,
}: {
  workspaceId: string
  meetingId: string
  /** 보이는 제목. 비었으면 제목 없는 회의다 */
  title: string
  titleEdited: boolean
  titleOriginal: string | null
}) {
  const edit = useTitleEdit(workspaceId, meetingId)
  const [editing, setEditing] = useState(false)
  const [showOriginal, setShowOriginal] = useState(false)
  const editButton = useRef<HTMLButtonElement>(null)
  const returnFocus = useReturnFocus(editing, editButton)
  const originalId = useId()
  const failure = edit.failure?.message ?? null

  const close = () => {
    returnFocus()
    edit.clearFailure()
    setEditing(false)
  }

  if (editing)
    return (
      <TitleForm
        title={title}
        saving={edit.saving !== null}
        failure={failure}
        onCancel={close}
        onSave={(next) => edit.save({ title: next }, close)}
      />
    )
  return (
    <div className="flex flex-col gap-6">
      <div className="flex h-lh min-w-[0px] items-center gap-6 text-[26px] leading-[1.3]">
        <div className="min-w-[0px]">
          <MinutesTitle title={title === '' ? '제목 없는 회의' : title} />
        </div>
        {titleEdited ? (
          <EditedToggle
            expanded={showOriginal}
            controls={originalId}
            label="고친 제목 — 처음 제목 보기"
            onToggle={() => setShowOriginal((open) => !open)}
          />
        ) : null}
        <button
          ref={editButton}
          type="button"
          aria-label="제목 고치기"
          className={ICON_BUTTON}
          onClick={() => {
            edit.clearFailure()
            setEditing(true)
          }}
        >
          <Icon name="edit" size={15} />
        </button>
      </div>
      {failure !== null && !(titleEdited && showOriginal) ? (
        <p role="alert" className={FAILURE}>
          {failure}
        </p>
      ) : null}
      {titleEdited && showOriginal ? (
        <div id={originalId} className={ORIGINAL_BOX}>
          <p className="text-caption text-sub wrap-anywhere">
            처음 제목: {titleOriginal ?? '제목 없음'}
          </p>
          <LockedButton
            variant="outline"
            size="sm"
            locked={edit.saving !== null}
            aria-busy={edit.saving !== null || undefined}
            onClick={() =>
              edit.save({ title: null }, () => {
                setShowOriginal(false)
                editButton.current?.focus()
              })
            }
          >
            처음 제목으로 되돌리기
          </LockedButton>
          {failure === null ? null : (
            <p role="alert" className={FAILURE}>
              {failure}
            </p>
          )}
        </div>
      ) : null}
    </div>
  )
}

function TitleForm({
  title,
  saving,
  failure,
  onCancel,
  onSave,
}: {
  title: string
  saving: boolean
  failure: string | null
  onCancel: () => void
  onSave: (title: string) => void
}) {
  const [draft, setDraft] = useState(title)
  const [local, setLocal] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const hintId = useId()
  const messageId = useId()
  useUnsavedChanges(normalizeTitle(draft) !== title)
  useEffect(() => {
    input.current?.focus()
    input.current?.select()
  }, [])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (saving) return
    const next = normalizeTitle(draft)
    if (next === title) return onCancel()
    const invalid = titleInputFailure(next)
    setLocal(invalid)
    if (invalid === null) onSave(next)
  }
  const message = local ?? failure

  return (
    <form className="flex flex-col gap-6" onSubmit={submit}>
      <div className="flex min-h-[34px] items-center gap-6">
        <input
          ref={input}
          aria-label="회의 제목"
          className={TITLE_INPUT}
          value={draft}
          readOnly={saving}
          aria-invalid={local !== null || undefined}
          aria-describedby={message === null ? hintId : `${hintId} ${messageId}`}
          onChange={(event) => {
            setDraft(event.target.value)
            setLocal(null)
          }}
          onKeyDown={(event) => closeOnEscape(event, onCancel)}
        />
        <EditButtons saving={saving} onCancel={onCancel} />
      </div>
      <EditNotes
        hintId={hintId}
        hint={TITLE_EDIT_HINT}
        messageId={messageId}
        local={local}
        server={failure}
      />
    </form>
  )
}

export type LineEditActions = ReturnType<typeof useLineEdit>

/**
 * 전사문 한 줄. 줄 번호(`seq`)를 아는 줄은 글을 눌러 같은 자리에서 고친다. 고친 줄에는 「고침」이 붙어 원문과 되돌리기를 펼친다.
 * 줄 번호를 모르는 줄은 글만 보인다(D-192). 어느 줄을 고치는지와 그 초안은 전사문 탭이 한 곳에서 쥔다(`useLineSession`)
 */
export function EditableLine({
  line,
  edit,
  draft,
  hintId,
  onOpen,
  onDraft,
  onClose,
  onRevert,
  time,
  speaker,
}: {
  line: TranscriptLine
  edit: LineEditActions
  /** 이 줄을 고치는 중이면 그 초안, 아니면 null */
  draft: string | null
  /** 「누르면 고친다」 안내. 줄 단추가 함께 읽는다 */
  hintId: string
  onOpen: () => void
  onDraft: (draft: string) => void
  /** 그 고치기가 아직 열려 있었으면 닫고 true. 다른 줄을 연 뒤 늦게 끝난 저장은 아무것도 닫지 않는다 */
  onClose: () => boolean
  /** 원문으로 되돌린다. 끝나면 `done` 을 부르고, 그때 열린 고치기가 없으면 `idle` 이 true 다 */
  onRevert: (done: (idle: boolean) => void) => void
  time: ReactNode
  speaker: ReactNode
}) {
  const [showOriginal, setShowOriginal] = useState(false)
  const lineButton = useRef<HTMLButtonElement>(null)
  const editing = draft !== null
  const returnFocus = useReturnFocus(editing, lineButton)
  const originalId = useId()
  const savingId = useId()
  const { seq } = line
  const mine = seq !== null && edit.failure?.target.seq === seq
  const failure = mine ? edit.failure!.message : null
  const saving = seq !== null && edit.saving?.seq === seq

  if (seq === null)
    return (
      <>
        {time}
        <div className="flex min-w-[0px] flex-1 flex-col gap-2">
          {speaker}
          <p className={LINE_TEXT}>{line.text}</p>
        </div>
      </>
    )

  const close = () => {
    if (mine) edit.clearFailure()
    if (onClose()) returnFocus()
  }

  return (
    <>
      {time}
      <div className="flex min-w-[0px] flex-1 flex-col gap-2">
        <div className="flex min-w-[0px] items-center gap-6">
          {speaker}
          {line.edited && line.originalText !== null ? (
            <EditedToggle
              expanded={showOriginal}
              controls={originalId}
              label="고친 발화 — 원문 보기"
              onToggle={() => setShowOriginal((open) => !open)}
            />
          ) : line.edited ? (
            <span className="text-meta font-semibold text-dim">고침</span>
          ) : null}
        </div>
        {editing ? (
          <LineForm
            text={line.text}
            draft={draft}
            saving={saving}
            failure={failure}
            onDraft={onDraft}
            onCancel={close}
            onSave={(text) => edit.save({ seq, text }, close)}
          />
        ) : (
          <button
            ref={lineButton}
            type="button"
            className={LINE_BUTTON}
            aria-describedby={saving ? savingId : hintId}
            // 이 줄의 저장·되돌리기 응답 전에는 다시 열지 않는다. 열면 초안이 요청 전 문장이라 응답을 다시 덮는다
            aria-disabled={saving || undefined}
            aria-busy={saving || undefined}
            onClick={() => {
              if (saving) return
              if (mine) edit.clearFailure()
              onOpen()
            }}
          >
            {line.text}
          </button>
        )}
        {failure !== null &&
        !editing &&
        !(line.edited && line.originalText !== null && showOriginal) ? (
          <p role="alert" className={FAILURE}>
            {failure}
          </p>
        ) : null}
        {saving ? (
          <span id={savingId} hidden>
            이 발화를 저장하고 있어요.
          </span>
        ) : null}
        {line.edited && line.originalText !== null && showOriginal ? (
          <div id={originalId} className={`mt-4 ${ORIGINAL_BOX}`}>
            <p className="text-meta font-semibold text-dim">원문</p>
            <p className={`${LINE_TEXT} text-sub`}>{line.originalText}</p>
            <LockedButton
              variant="outline"
              size="sm"
              locked={saving}
              aria-busy={saving || undefined}
              onClick={() =>
                onRevert((idle) => {
                  setShowOriginal(false)
                  if (idle) lineButton.current?.focus()
                })
              }
            >
              원래 문장으로 되돌리기
            </LockedButton>
            {failure === null || editing ? null : (
              <p role="alert" className={FAILURE}>
                {failure}
              </p>
            )}
          </div>
        ) : null}
      </div>
    </>
  )
}

function LineForm({
  text,
  draft,
  saving,
  failure,
  onDraft,
  onCancel,
  onSave,
}: {
  text: string
  draft: string
  saving: boolean
  failure: string | null
  onDraft: (draft: string) => void
  onCancel: () => void
  onSave: (text: string) => void
}) {
  const [local, setLocal] = useState<string | null>(null)
  const field = useRef<HTMLTextAreaElement>(null)
  const hintId = useId()
  const messageId = useId()
  useEffect(() => {
    const element = field.current
    if (element === null) return
    element.focus()
    element.setSelectionRange(element.value.length, element.value.length)
  }, [])

  const submit = (event?: FormEvent) => {
    event?.preventDefault()
    if (saving) return
    if (draft === text) return onCancel()
    const invalid = lineInputFailure(draft)
    setLocal(invalid)
    if (invalid === null) onSave(draft)
  }
  const message = local ?? failure

  return (
    <form className="flex flex-col gap-6 pt-2" onSubmit={submit}>
      <textarea
        ref={field}
        aria-label="발화 고치기"
        className={LINE_INPUT}
        rows={Math.min(8, Math.max(2, Math.ceil([...draft].length / 48)))}
        value={draft}
        readOnly={saving}
        aria-invalid={local !== null || undefined}
        aria-describedby={message === null ? hintId : `${hintId} ${messageId}`}
        onChange={(event) => {
          onDraft(event.target.value)
          setLocal(null)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault()
            submit()
            return
          }
          // 저장 중에는 닫지 않는다. 닫으면 바뀐 글 표시가 사라져, 응답 전에 같은 줄을 요청 전 문장으로 다시 열 수 있다
          if (!saving) closeOnEscape(event, onCancel)
        }}
      />
      <EditNotes
        hintId={hintId}
        hint={LINE_EDIT_HINT}
        messageId={messageId}
        local={local}
        server={failure}
      />
      <div className="flex items-center justify-end gap-6">
        <EditButtons saving={saving} onCancel={onCancel} />
      </div>
    </form>
  )
}
