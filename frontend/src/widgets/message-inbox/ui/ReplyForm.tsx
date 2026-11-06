import { useId, useState } from 'react'
import type { FormEvent } from 'react'
import { MESSAGE_BODY_MAX_LENGTH } from '@/entities/message'
import { ActionFailure, useMessageAction } from '@/features/message-action'
import { useUnsavedChanges } from '@/shared/lib/unsaved-changes'
import { Button } from '@/shared/ui/button'
import { ErrorText } from '@/shared/ui/error-text'

const FORM = 'flex flex-col gap-10'
const FIELD =
  'min-h-[88px] w-full resize-y rounded-9 border border-input-border bg-surface px-12 py-10 text-[14px] leading-[1.8] text-ink focus-visible:-outline-offset-1'
const NOTE = 'text-caption leading-[1.6] text-dim'

/**
 * 대화 주인의 웹 답장 — 팀원, 그리고 팀원 행이 그 대화의 주인인 PM. 성공하면 칸을 비우고, 실패하면 쓰던 글을 둔다.
 * 빈 글은 서버로 보내지 않는다.
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
  const fieldId = useId()
  const blankId = useId()
  const actions = useMessageAction(workspaceId)
  const [draft, setDraft] = useState('')
  const [blank, setBlank] = useState(false)
  const unsaved = useUnsavedChanges(draft !== '')
  const saving = actions.pending?.target === threadId && actions.pending.kind === 'reply'

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const body = draft.trim()
    if (body.length === 0) {
      setBlank(true)
      return
    }
    actions.run(
      { kind: 'reply', threadId, body },
      {
        onSuccess: () => {
          unsaved.release()
          setDraft('')
          setBlank(false)
          onSent?.()
        },
      },
    )
  }

  return (
    <form aria-label="답장" onSubmit={submit} className={FORM}>
      <label htmlFor={fieldId} className="text-caption text-sub">
        답장
      </label>
      <textarea
        id={fieldId}
        className={FIELD}
        value={draft}
        maxLength={MESSAGE_BODY_MAX_LENGTH}
        placeholder={`${botName} 봇에게 답장`}
        disabled={saving}
        aria-invalid={blank || undefined}
        aria-describedby={blank ? blankId : undefined}
        onChange={(event) => {
          setDraft(event.target.value)
          if (event.target.value.trim() !== '') setBlank(false)
        }}
      />
      <p className={NOTE}>
        웹 답장은 Discord로 보내지 않고 이 대화에만 남아요. 봇 DM 창에 쓴 글은 모두 PM 대화에
        보여요.
      </p>
      {blank ? <ErrorText id={blankId}>답장을 입력해 주세요.</ErrorText> : null}
      <div>
        <Button type="submit" aria-busy={saving || undefined} disabled={saving}>
          답장 보내기
        </Button>
      </div>
      <ActionFailure target={threadId} actions={actions} kinds={['reply']} />
    </form>
  )
}
