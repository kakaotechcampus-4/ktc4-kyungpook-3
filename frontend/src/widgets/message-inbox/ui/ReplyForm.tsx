import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import { MESSAGE_BODY_MAX_LENGTH } from '@/entities/message'
import { actionTarget, useMessageAction } from '@/features/message-action'
import { failureNotice } from '@/shared/api/errorMessages'
import { useUnsavedChanges } from '@/shared/lib/unsaved-changes'
import { Icon } from '@/shared/ui/icon'

const FIELD_MAX_HEIGHT = 92
const COUNTER_FROM = 1800

const FORM = 'flex flex-col gap-8'
const ROW = 'flex items-start gap-8'
const FIELD = [
  // 위아래 여백 9 — 시안의 10 이면 한 줄이 23.2 + 20 + 테두리 2 = 45px 라 44px 버튼보다 1px 커진다
  'block min-h-44 max-h-[92px] min-w-[0px] flex-1 resize-none rounded-12 border border-input-border bg-surface px-14 py-9',
  // 768 미만은 글자 16px(H-5) — iOS 가 16px 보다 작은 입력 칸에 들어갈 때 화면을 확대하지 않는다. 줄 높이 1.5 로 한 줄이 44px 그대로다
  'text-[14.5px] leading-[1.6] text-ink placeholder:text-dim max-md:text-[16px] max-md:leading-[1.5]',
  'focus:outline-2 focus:-outline-offset-1 focus:outline-ink disabled:bg-surface-sunken disabled:text-sub',
  '[&::-webkit-scrollbar]:w-10 [&::-webkit-scrollbar-button]:hidden [&::-webkit-scrollbar-track]:my-6 [&::-webkit-scrollbar-track]:bg-transparent',
  '[&::-webkit-scrollbar-thumb]:rounded-999 [&::-webkit-scrollbar-thumb]:border-3 [&::-webkit-scrollbar-thumb]:border-solid [&::-webkit-scrollbar-thumb]:border-surface [&::-webkit-scrollbar-thumb]:bg-line-strong',
  // scrollbar-width 를 주면 Chrome 이 ::-webkit-scrollbar 꾸밈을 버린다. 그래서 그 선택자를 모르는 브라우저(Firefox)에만 준다
  'supports-[not_selector(::-webkit-scrollbar)]:[scrollbar-width:thin] supports-[not_selector(::-webkit-scrollbar)]:[scrollbar-color:var(--color-line-strong)_transparent]',
].join(' ')
const SEND = 'grid size-44 shrink-0 place-items-center rounded-12 text-surface'
const SEND_FACE = {
  ready: 'bg-ink focus-visible:outline-surface focus-visible:-outline-offset-3',
  sending: 'bg-ink opacity-45',
  blank: 'cursor-default bg-inactive',
} as const
const FAILURE = 'flex flex-wrap items-center gap-x-8 text-[12.5px] text-accent *:leading-[1.6]'
const RESEND = 'font-bold text-ink underline'
const UNDER = 'flex justify-between gap-12 text-[12px] text-dim *:leading-[1.6]'

/**
 * 대화 주인의 웹 답장 — 팀원, 그리고 팀원 행이 그 대화의 주인인 PM. 채팅 입력처럼 한 줄 칸과 보내기 버튼이 나란하다.
 * Enter 로 보내고 Shift+Enter 로 줄을 바꾼다. 칸은 세 줄까지 자라고 그 뒤로는 칸 안에서 스크롤한다.
 * 빈 글은 보내기 버튼이 꺼져 있어 보낼 수 없다. 성공하면 칸을 비우고, 실패하면 쓰던 글을 두고 칸 위에 알린다
 */
export function ReplyForm({
  workspaceId,
  threadId,
  botName,
  onSent,
}: {
  workspaceId: string
  threadId: string
  botName: string
  /** 서버가 답장을 받은 뒤. 그 대화를 최근 메시지로 내리는 데 쓴다 */
  onSent?: () => void
}) {
  const noteId = useId()
  const formRef = useRef<HTMLFormElement>(null)
  const fieldRef = useRef<HTMLTextAreaElement>(null)
  const actions = useMessageAction(workspaceId)
  const [draft, setDraft] = useState('')
  const unsaved = useUnsavedChanges(draft !== '')
  const saving = actions.pending?.target === threadId && actions.pending.kind === 'reply'
  const body = draft.trim()
  const canSend = body !== '' && !saving
  const face = saving ? 'sending' : canSend ? 'ready' : 'blank'
  const failure =
    actions.failure?.action.kind === 'reply' && actionTarget(actions.failure.action) === threadId
      ? actions.failure
      : null
  const failureText = failure === null ? null : failureNotice(failure.error)

  useLayoutEffect(() => {
    const field = fieldRef.current
    if (field === null) return
    field.style.height = 'auto'
    // scrollHeight 는 테두리를 빼고 잰다. 위아래 1px 테두리를 더한다
    const height = field.scrollHeight + 2
    field.style.height = `${Math.min(height, FIELD_MAX_HEIGHT)}px`
    field.style.overflowY = height > FIELD_MAX_HEIGHT ? 'auto' : 'hidden'
  }, [draft])

  // 보내는 동안 칸이 잠겨 포커스를 잃는다. 풀리면 이어 쓰도록 칸으로 돌려준다 — 그 사이 다른 곳으로 옮겼으면 두고
  const wasSaving = useRef(false)
  useEffect(() => {
    const active = document.activeElement
    if (
      wasSaving.current &&
      !saving &&
      (active === null || active === document.body || formRef.current?.contains(active))
    )
      fieldRef.current?.focus()
    wasSaving.current = saving
  }, [saving])

  const send = () => {
    if (!canSend) return
    actions.run(
      { kind: 'reply', threadId, body },
      {
        onSuccess: () => {
          unsaved.release()
          setDraft('')
          onSent?.()
        },
      },
    )
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    send()
  }

  const sendOnEnter = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // 한글 조합을 끝내는 Enter 는 isComposing 없이 keyCode 229 로만 오는 브라우저가 있다
    if (
      event.key !== 'Enter' ||
      event.shiftKey ||
      event.nativeEvent.isComposing ||
      event.keyCode === 229
    )
      return
    event.preventDefault()
    event.currentTarget.form?.requestSubmit()
  }

  return (
    <form ref={formRef} aria-label="답장" onSubmit={submit} className={FORM}>
      {failure !== null && failureText !== null ? (
        <div role="alert" className={FAILURE}>
          <p>
            {failure.title}. {failureText}
          </p>
          <button type="button" className={RESEND} onClick={send}>
            다시 보내기
          </button>
        </div>
      ) : null}
      <div className={ROW}>
        <textarea
          ref={fieldRef}
          rows={1}
          aria-label="답장"
          aria-describedby={noteId}
          className={FIELD}
          value={draft}
          maxLength={MESSAGE_BODY_MAX_LENGTH}
          placeholder={`${botName} 봇에게 답장`}
          disabled={saving}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={sendOnEnter}
        />
        <button
          type="submit"
          aria-label="답장 보내기"
          aria-busy={saving || undefined}
          disabled={!canSend}
          className={`${SEND} ${SEND_FACE[face]}`}
        >
          <Icon name="send" size={18} className="-translate-x-1 translate-y-1" />
        </button>
      </div>
      <div className={UNDER}>
        <p id={noteId}>
          웹 답장은 Discord로 보내지 않고 이 대화에만 남아요. 봇 DM 창에 쓴 글은 모두 PM 대화에
          보여요.
        </p>
        {draft.length > COUNTER_FROM ? (
          <span
            className={`shrink-0 ${draft.length >= MESSAGE_BODY_MAX_LENGTH ? 'font-bold text-accent' : ''}`}
          >
            {`${draft.length.toLocaleString('ko-KR')} / ${MESSAGE_BODY_MAX_LENGTH.toLocaleString('ko-KR')}`}
          </span>
        ) : (
          <span className="shrink-0 max-md:hidden">Enter 보내기 · Shift+Enter 줄 바꿈</span>
        )}
      </div>
    </form>
  )
}
