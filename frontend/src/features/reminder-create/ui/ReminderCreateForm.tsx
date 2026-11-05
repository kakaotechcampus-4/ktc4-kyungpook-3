import { useQuery } from '@tanstack/react-query'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { memberListQueryOptions } from '@/entities/member'
import type { Member } from '@/entities/member'
import { MESSAGE_BODY_MAX_LENGTH } from '@/entities/message'
import type { CreatedReminder } from '@/entities/message'
import { SendTimingPicker, useDeadlineSend } from '@/entities/message-settings'
import { taskListQueryOptions } from '@/entities/task'
import type { Task } from '@/entities/task'
import { paths } from '@/shared/config/routes'
import { monthDayOf } from '@/shared/lib/date'
import { GuardedLink, useUnsavedChanges } from '@/shared/lib/unsaved-changes'
import { Button } from '@/shared/ui/button'
import { Label } from '@/shared/ui/label'
import { LockedButton } from '@/shared/ui/locked-button'
import { QueryErrorState } from '@/shared/ui/query-error-state'
import { CREATE_FAILURE_TITLE } from '../lib/createMessages'
import { useCreateReminder } from '../model/useCreateReminder'

/* 시안이 없다 — 승인 보완 폼의 select, 문구 고쳐 쓰기의 칸, 보내기 전 확인의 보낼 시각 카드를 그대로 쓴다 */
const SELECT =
  'h-[42px] w-full rounded-9 border border-input-border bg-surface px-13 text-body text-ink disabled:bg-surface-sunken disabled:text-faint'
const TEXTAREA =
  'min-h-[80px] w-full resize-y rounded-9 border border-input-border bg-surface px-12 py-10 text-[14px] leading-[1.8] text-ink focus-visible:-outline-offset-1'
const LINK = 'font-semibold text-ink underline underline-offset-4 hover:text-sub'

/** 누구의 어느 태스크를 재촉하는가. task 는 그 태스크의 담당자에게, choose 는 PM 이 팀원과 태스크를 고른다 */
export type ReminderCreateTarget = { kind: 'task'; task: Task } | { kind: 'choose' }

export interface ReminderCreateFormProps {
  workspaceId: string
  target: ReminderCreateTarget
  /** 서버가 만든 뒤에 부른다. 같은 사람·같은 시각의 메시지가 있었으면 그 묶음에 합쳐져 있다 */
  onCreated: (created: CreatedReminder) => void
  onCancel: () => void
}

const byName = (left: Member, right: Member) =>
  left.displayName.localeCompare(right.displayName, 'ko')

/** 마감 이른 순, 마감 없는 것은 뒤 */
const byDue = (left: Task, right: Task) =>
  left.dueDate === right.dueDate
    ? 0
    : left.dueDate === null
      ? 1
      : right.dueDate === null
        ? -1
        : left.dueDate.localeCompare(right.dueDate)

/** 그 팀원이 맡은 끝나지 않은 태스크 */
function openTasksOf(tasks: readonly Task[], memberId: string): Task[] {
  return tasks
    .filter(({ assigneeMemberId, status }) => assigneeMemberId === memberId && status !== 'done')
    .sort(byDue)
}

/**
 * 재촉 만들기 — 받는 사람·태스크, 보낼 시각, 메모 (계약 §5.7 `POST …/messages/reminders`).
 * 서버는 그 팀원·시각의 보낼 메시지에 넣는다 — 같은 시각의 메시지가 있으면 합쳐지고 승인이 풀린다. 승인해야 나간다.
 * 보낼 시각은 처음에 마감 기준(공간의 재촉 규칙)으로 골라 둔다. 마감이 없거나 그 시각이 지났으면 직접 골라야 한다.
 * Discord 가 연결되지 않은 팀원도 막지 않는다 — 서버가 받고, 보낼 때 DM 이 실패로 남으므로 미리 알린다
 */
export function ReminderCreateForm({
  workspaceId,
  target,
  onCreated,
  onCancel,
}: ReminderCreateFormProps) {
  const memberFieldId = useId()
  const taskFieldId = useId()
  const noteFieldId = useId()
  const noteHintId = useId()
  const lockHintId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  // 연 버튼이나 링크는 폼이 열리며 사라지거나 멀어진다 — 폼 안으로 포커스를 옮긴다
  useEffect(() => {
    rootRef.current?.focus()
  }, [])
  const members = useQuery(memberListQueryOptions(workspaceId))
  const tasks = useQuery({
    ...taskListQueryOptions(workspaceId),
    enabled: target.kind === 'choose',
  })
  const creating = useCreateReminder(workspaceId)
  const [chosenMemberId, setChosenMemberId] = useState('')
  const [chosenTaskId, setChosenTaskId] = useState('')
  const [picked, setPicked] = useState<string | null>(null)
  const [customOpen, setCustomOpen] = useState(false)
  const [note, setNote] = useState('')
  useUnsavedChanges(note.trim() !== '')

  const memberId = target.kind === 'task' ? target.task.assigneeMemberId : chosenMemberId || null
  const member = members.data?.find(({ id }) => id === memberId)
  const choices = useMemo(
    () => (memberId === null ? [] : openTasksOf(tasks.data ?? [], memberId)),
    [tasks.data, memberId],
  )
  const task = target.kind === 'task' ? target.task : choices.find(({ id }) => id === chosenTaskId)
  const { deadline } = useDeadlineSend(workspaceId, task?.dueDate ?? null)
  // 고르지 않았으면 마감 기준 시각이다. 고를 수 없으면 비워 두고 직접 고르게 한다
  const scheduledAt = picked ?? (deadline?.status === 'open' ? deadline.at : null)
  const recipientName = member?.displayName ?? '담당자'

  const lockHint =
    memberId === null
      ? target.kind === 'task'
        ? '담당자가 없어 재촉을 만들 수 없어요.'
        : '받을 팀원을 골라 주세요.'
      : task === undefined
        ? '재촉할 태스크를 골라 주세요.'
        : customOpen
          ? '정한 시각을 저장하거나 취소한 뒤에 만들 수 있어요.'
          : scheduledAt === null
            ? '보낼 시각을 골라 주세요.'
            : null

  // 받는 사람이나 태스크가 바뀌면 마감도 바뀐다 — 고른 시각을 버리고 새 마감 기준으로 다시 시작한다
  const resetTime = () => {
    setPicked(null)
    setCustomOpen(false)
  }
  // 입력을 바꾸면 이전 실패는 지금 입력의 것이 아니다. 남겨 두면 다시 시도가 화면과 다른 내용을 보내는 것처럼 읽힌다
  const { clearFailure } = creating

  const submit = () => {
    if (lockHint !== null || memberId === null || task === undefined || scheduledAt === null) return
    const trimmed = note.trim()
    creating.create(
      { memberId, taskId: task.id, scheduledAt, note: trimmed === '' ? null : trimmed },
      onCreated,
    )
  }

  const failure = creating.failure
  const locked = creating.pending

  return (
    <div
      ref={rootRef}
      role="group"
      aria-label="재촉 만들기"
      tabIndex={-1}
      className="flex flex-col gap-18"
    >
      {members.data === undefined && members.error !== null ? (
        <QueryErrorState
          error={members.error}
          title="팀원 목록을 불러오지 못했어요"
          onRetry={() => void members.refetch()}
        />
      ) : null}
      {target.kind === 'task' ? (
        <p className="text-body text-sub">
          받는 사람 <strong className="font-semibold text-ink">{recipientName}</strong>
        </p>
      ) : (
        <>
          <div className="flex flex-col gap-6">
            <Label htmlFor={memberFieldId}>받는 사람</Label>
            <select
              id={memberFieldId}
              className={SELECT}
              value={chosenMemberId}
              disabled={locked || members.data === undefined}
              onChange={(event) => {
                setChosenMemberId(event.target.value)
                setChosenTaskId('')
                resetTime()
                clearFailure()
              }}
            >
              <option value="">팀원 고르기</option>
              {[...(members.data ?? [])].sort(byName).map(({ id, displayName }) => (
                <option key={id} value={id}>
                  {displayName}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-6">
            <Label htmlFor={taskFieldId}>태스크</Label>
            <select
              id={taskFieldId}
              className={SELECT}
              value={chosenTaskId}
              disabled={locked || memberId === null || choices.length === 0}
              onChange={(event) => {
                setChosenTaskId(event.target.value)
                resetTime()
                clearFailure()
              }}
            >
              <option value="">태스크 고르기</option>
              {choices.map(({ id, title, dueDate }) => (
                <option key={id} value={id}>
                  {`${title} · ${dueDate === null ? '마감 없음' : `${monthDayOf(dueDate)} 마감`}`}
                </option>
              ))}
            </select>
            {memberId !== null && tasks.data !== undefined && choices.length === 0 ? (
              <p className="text-caption text-dim">
                {recipientName}님이 맡은 진행 중인 태스크가 없어요.
              </p>
            ) : null}
            {tasks.error !== null ? (
              <QueryErrorState
                error={tasks.error}
                title="태스크 목록을 불러오지 못했어요"
                onRetry={() => void tasks.refetch()}
              />
            ) : null}
          </div>
        </>
      )}

      {member !== undefined && member.discordUserId === null ? (
        <p className="text-caption text-sub">
          {member.displayName}님은 Discord가 연결되지 않아 지금은 DM이 나가지 않아요. 보낼 시각 전에{' '}
          <GuardedLink to={paths.membersConnect(workspaceId)} className={LINK}>
            팀 화면
          </GuardedLink>
          에서 연결해 주세요.
        </p>
      ) : null}

      {task === undefined ? null : (
        <SendTimingPicker
          workspaceId={workspaceId}
          dueDate={task.dueDate}
          scheduledAt={scheduledAt}
          locked={locked}
          saving={false}
          customOpen={customOpen}
          onCustomOpenChange={setCustomOpen}
          onPick={(at, onSaved) => {
            setPicked(at)
            clearFailure()
            onSaved()
          }}
          failure={null}
        />
      )}

      <div className="flex flex-col gap-6">
        <Label htmlFor={noteFieldId}>메모 (선택)</Label>
        <textarea
          id={noteFieldId}
          className={TEXTAREA}
          value={note}
          maxLength={MESSAGE_BODY_MAX_LENGTH}
          disabled={locked}
          aria-describedby={noteHintId}
          onChange={(event) => {
            setNote(event.target.value)
            clearFailure()
          }}
        />
        <p id={noteHintId} className="text-caption text-dim">
          메모를 쓰면 이 태스크 줄 대신 메모가 나가요.
        </p>
      </div>

      <div className="flex flex-col gap-10">
        <div className="flex items-center justify-end gap-8">
          <Button variant="ghost" disabled={locked} onClick={onCancel}>
            취소
          </Button>
          <LockedButton
            variant="primary"
            aria-busy={locked || undefined}
            aria-describedby={lockHint === null ? undefined : lockHintId}
            locked={locked || lockHint !== null}
            onClick={submit}
          >
            재촉 만들기
          </LockedButton>
        </div>
        {lockHint === null ? null : (
          <p id={lockHintId} className="text-caption text-dim">
            {lockHint}
          </p>
        )}
        {failure === null ? null : failure.known === null ? (
          <QueryErrorState error={failure.error} title={CREATE_FAILURE_TITLE} onRetry={submit} />
        ) : (
          <div role="alert" className="flex flex-col items-start gap-6">
            <p className="text-body font-semibold text-ink">{CREATE_FAILURE_TITLE}</p>
            <p className="text-caption text-dim">{failure.known}</p>
          </div>
        )}
      </div>
    </div>
  )
}
