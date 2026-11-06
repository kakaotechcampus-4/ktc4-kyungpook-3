import { useId, useState } from 'react'
import type { FormEvent } from 'react'
import type { TaskRef } from '@/entities/message'
import { ActionFailure, attributeNotice, useMessageAction } from '@/features/message-action'
import { Button } from '@/shared/ui/button'

const FORM = 'flex max-w-[410px] flex-col gap-8'
const LEGEND = 'text-caption font-semibold text-ink'
const HINT = 'text-caption leading-[1.6] text-dim'
const OPTION = 'flex items-center gap-8 text-caption text-ink'

/**
 * PM 이 답장의 태스크를 고른다. 라디오를 옮기는 것만으로는 보내지 않고, 정하기만 보낸다.
 * 아직 고르지 않았으면 정하기는 잠긴다. 성공하면 대화를 다시 받아 고르기가 사라진다
 */
export function AttributionPicker({
  workspaceId,
  messageId,
  candidates,
}: {
  workspaceId: string
  messageId: string
  candidates: readonly TaskRef[]
}) {
  const hintId = useId()
  const actions = useMessageAction(workspaceId)
  // undefined 는 아직 고르지 않음, null 은 해당 없음이다
  const [choice, setChoice] = useState<TaskRef | null | undefined>(undefined)
  const saving = actions.pending?.target === messageId && actions.pending.kind === 'attribute'

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (choice === undefined) return
    actions.run(
      { kind: 'attribute', messageId, taskId: choice === null ? null : choice.id },
      { notice: attributeNotice(choice) },
    )
  }

  return (
    <form onSubmit={submit} className={FORM}>
      <fieldset className="flex flex-col gap-6" aria-describedby={hintId} disabled={saving}>
        <legend className={LEGEND}>어느 태스크에 대한 답장인가요?</legend>
        <p id={hintId} className={HINT}>
          AI가 어느 태스크에 대한 답장인지 정하지 못했어요.
        </p>
        {candidates.map((task) => (
          <label key={task.id} className={OPTION}>
            <input
              type="radio"
              name={`attribution-${messageId}`}
              value={task.id}
              checked={choice?.id === task.id}
              onChange={() => setChoice(task)}
            />
            {task.title}
          </label>
        ))}
        <label className={OPTION}>
          <input
            type="radio"
            name={`attribution-${messageId}`}
            value=""
            checked={choice === null}
            onChange={() => setChoice(null)}
          />
          해당 없음
        </label>
      </fieldset>
      <div>
        <Button
          type="submit"
          disabled={choice === undefined || saving}
          aria-busy={saving || undefined}
        >
          정하기
        </Button>
      </div>
      <ActionFailure target={messageId} actions={actions} kinds={['attribute']} />
    </form>
  )
}
