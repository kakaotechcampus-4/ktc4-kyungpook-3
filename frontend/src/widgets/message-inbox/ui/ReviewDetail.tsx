import { useId, useState } from 'react'
import { useNavigate } from 'react-router'
import type { Bundle, MessageAction } from '@/entities/message'
import { SendTimingPicker } from '@/entities/message-settings'
import {
  ActionFailure,
  TIME_PASSED_LOCK,
  TIME_PASSED_MESSAGE,
  TIME_PASSED_TITLE,
  approveNotice,
  cancelNotice,
  useMessageAction,
} from '@/features/message-action'
import { paths } from '@/shared/config/routes'
import { Icon } from '@/shared/ui/icon'
import { LockedButton } from '@/shared/ui/locked-button'
import { earliestDue, shortDateTime, taskDueLabel, taskTitle } from '../lib/format'
import { ReviewMessageCard } from './ReviewMessageCard'

/* Messages 캔버스 실측 — 가운데 604 열(위 44 · 좌우 36 · 아래 56, 간격 24), 제목 28px,
   근거 블록(눌린 면 · 위아래 18 · 좌우 20 · 라운드 12 · 간격 10), 행동 줄 위 구분선.
   열은 내용 높이를 따르고(`self-start`) 넘치면 PAGE 가 스크롤한다 — 칸 높이로 늘어나면(stretch) 세로 flex 가 자식을 줄이고,
   overflow-hidden 인 미리보기 카드는 최소 높이가 0 이라 본문이 잘린다.
   이름·태스크·본문은 띄어 쓰지 않은 긴 글자(주소, 전역 `keep-all` 의 긴 한글)도 칸 안에서 줄을 바꾼다(`wrap-anywhere`) */
const PAGE = 'flex flex-1 justify-center overflow-y-auto px-36 pt-44 pb-56'
const COLUMN = 'flex w-full max-w-[604px] flex-col gap-24 self-start'
const TITLE = 'text-[28px] leading-[1.25] font-bold tracking-h1 text-ink'
const TASKS = 'flex flex-col gap-10 rounded-12 bg-surface-sunken px-20 py-18'

export interface ReviewDetailProps {
  workspaceId: string
  botName: string
  bundle: Bundle
  /** 승인하거나 보내지 않거나 다른 묶음과 합쳐져 이 항목이 바뀐다 — 누른 버튼도 사라지므로 포커스를 맡길 자리로 옮긴다 */
  onSettled: () => void
}

/** 행동이 잠긴 이유. 잠긴 버튼의 설명(`aria-describedby`)으로도 읽힌다 */
function lockReason(editing: boolean, choosingTime: boolean, timePassed: boolean): string | null {
  if (editing) return '고친 문구를 저장하거나 취소한 뒤에 보낼 수 있어요.'
  if (choosingTime) return '정한 시각을 저장하거나 취소한 뒤에 보낼 수 있어요.'
  if (timePassed) return TIME_PASSED_LOCK
  return null
}

/**
 * 보내기 전 확인 — 보낼 메시지(묶음) 한 통의 미리보기, 묶은 태스크, 보낼 시각, `보내지 않음`·`이대로 발송` (Messages 시안, 계약 §5.7).
 * `이대로 발송` 은 화면에 보이는 문구의 판(draft_version)으로 승인한다 — 그 사이 문구가 바뀌었으면 서버가 거절하고 다시 불러온다.
 * 모든 행동은 서버가 성공한 뒤에 화면을 바꾼다 — 요청 중에는 행동이 모두 잠기고, 실패하면 그 자리에 알린다 (D-137, 계획 C-5).
 * 문구를 고치거나 시각을 직접 정하는 중에도 발송이 잠긴다 — 화면에 보이는 문구·시각과 다르게 나가지 않게 한다.
 * 잠금은 `aria-disabled` 라 누른 버튼에서 포커스가 빠지지 않는다. 시각 저장만으로 잠긴 동안은 버튼 모양을 그대로 둔다
 */
export function ReviewDetail({ workspaceId, botName, bundle, onSettled }: ReviewDetailProps) {
  const headingId = useId()
  const tasksId = useId()
  const lockHintId = useId()
  const navigate = useNavigate()
  const actions = useMessageAction(workspaceId)
  const [editing, setEditing] = useState(false)
  const [choosingTime, setChoosingTime] = useState(false)
  const busy = actions.pending !== null
  const timePassed = actions.isTimePassed(bundle.id)
  const lockHint = lockReason(editing, choosingTime, false)
  const approveLockHint = lockReason(editing, choosingTime, timePassed)
  const decisionLocked = busy || lockHint !== null
  const approveLocked = busy || approveLockHint !== null
  // 시각 저장만으로 잠긴 동안은 버튼 모양을 바꾸지 않는다 — 짧은 저장마다 버튼이 깜빡였다.
  // 잠금(aria-disabled, 누름을 버림)은 그대로이고, 누름이 왜 안 되는지는 저장 중인 시각 카드가 보여 준다
  const quietLock = actions.pending?.kind === 'schedule' && lockHint === null
  const pendingKind = actions.pending?.target === bundle.id ? actions.pending.kind : null
  const awaiting = bundle.stage === 'awaitingApproval'
  const failureOf = (...kinds: MessageAction['kind'][]) => (
    <ActionFailure target={bundle.id} actions={actions} kinds={kinds} />
  )
  // 처리한 항목의 주소에 머물지 않는다 — 목록의 다음 항목이 기본으로 골라진다
  const leave = () => {
    onSettled()
    void navigate(paths.messages(workspaceId), { replace: true })
  }

  return (
    <div className={PAGE}>
      <article aria-labelledby={headingId} className={COLUMN}>
        <div className="flex flex-col gap-8">
          <h2 id={headingId} className={TITLE}>
            {awaiting ? '이 메시지, 보낼까요?' : '보낼 예정인 메시지예요'}
          </h2>
          <p className="text-[14px] wrap-anywhere text-sub">
            <strong className="font-semibold text-ink">{bundle.recipientName}</strong>
            에게 {shortDateTime(bundle.scheduledAt)}에 Discord 개인 메시지로 나갑니다.{' '}
            {awaiting ? '승인해야 나가요.' : '승인했어요.'}
          </p>
          {awaiting ? null : (
            <p className="text-caption text-dim">
              승인한 뒤에도 문구와 시각을 고칠 수 있어요. 같은 시각의 다른 메시지와 합쳐지면 다시
              승인해야 해요.
            </p>
          )}
        </div>

        <ReviewMessageCard
          bundle={bundle}
          botName={botName}
          editing={editing}
          onEditingChange={setEditing}
          locked={busy || choosingTime}
          keepLockedLook={quietLock}
          saving={pendingKind === 'edit'}
          onSave={(body, onSaved) =>
            actions.run({ kind: 'edit', bundleId: bundle.id, body }, { onSuccess: onSaved })
          }
          failure={failureOf('edit')}
        />

        <section aria-labelledby={tasksId} className={TASKS}>
          <h3 id={tasksId} className="mono text-[11px] leading-[1.6] font-normal text-dim">
            묶은 태스크 {bundle.tasks.length}
          </h3>
          <ul className="flex flex-col gap-10">
            {bundle.tasks.map((task) => (
              <li key={task.reminderId} className="flex flex-col gap-2">
                <span className="flex flex-wrap items-baseline gap-x-8">
                  <span className="text-body font-semibold wrap-anywhere text-ink">
                    {taskTitle(task)}
                  </span>
                  <span className="mono text-meta text-dim">{taskDueLabel(task)}</span>
                </span>
                {task.note === null ? null : (
                  <span className="text-caption leading-[1.6] wrap-anywhere whitespace-pre-line text-sub">
                    메모: {task.note}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>

        <SendTimingPicker
          workspaceId={workspaceId}
          dueDate={earliestDue(bundle.tasks)}
          scheduledAt={bundle.scheduledAt}
          locked={busy || editing}
          saving={pendingKind === 'schedule'}
          customOpen={choosingTime}
          onCustomOpenChange={setChoosingTime}
          onPick={(scheduledAt, onSaved) =>
            actions.run(
              { kind: 'schedule', bundleId: bundle.id, scheduledAt },
              {
                onSuccess: (outcome) => {
                  if (outcome.kind !== 'merged') {
                    onSaved()
                    return
                  }
                  // 이 묶음은 없어지고 상세가 합친 묶음으로 새로 마운트된다 — 이 상세 안이 아니라 상세 영역에 포커스를 둔다.
                  // 뒤로 가기로 없는 묶음에 돌아가지 않게 주소를 바꿔 끼운다
                  onSettled()
                  void navigate(paths.messageReview(workspaceId, outcome.into.id), {
                    replace: true,
                  })
                },
              },
            )
          }
          failure={failureOf('schedule')}
        />

        <div aria-hidden="true" className="h-1 bg-divider" />

        <div className="flex flex-col gap-12">
          <div className="flex items-center justify-between gap-20">
            <LockedButton
              variant="ghost"
              size="message-dismiss"
              aria-busy={pendingKind === 'cancel' || undefined}
              aria-describedby={lockHint === null ? undefined : lockHintId}
              locked={decisionLocked}
              keepLook={quietLock}
              onClick={() =>
                actions.run(
                  { kind: 'cancel', bundleId: bundle.id },
                  { notice: cancelNotice(bundle.recipientName), onSuccess: leave },
                )
              }
            >
              보내지 않음
            </LockedButton>
            {awaiting ? (
              <LockedButton
                variant="primary"
                size="message-send"
                endIcon={<Icon name="send" size={16} />}
                aria-busy={pendingKind === 'approve' || undefined}
                aria-describedby={approveLockHint === null ? undefined : lockHintId}
                locked={approveLocked}
                keepLook={quietLock}
                onClick={() =>
                  actions.run(
                    { kind: 'approve', bundleId: bundle.id, draftVersion: bundle.draftVersion },
                    {
                      notice: approveNotice(bundle.recipientName, bundle.scheduledAt),
                      onSuccess: leave,
                    },
                  )
                }
              >
                이대로 발송
              </LockedButton>
            ) : null}
          </div>
          {/* 지난 시각 알림을 잠금 이유보다 먼저 읽는다 */}
          {timePassed ? (
            <div role="alert" className="flex flex-col items-start gap-10">
              <p className="text-body font-semibold text-ink">{TIME_PASSED_TITLE}</p>
              <p className="text-caption text-dim">{TIME_PASSED_MESSAGE}</p>
            </div>
          ) : null}
          {approveLockHint === null ? null : (
            <p id={lockHintId} className="text-caption text-dim">
              {approveLockHint}
            </p>
          )}
          {failureOf('approve', 'cancel')}
        </div>

        <p className="text-caption text-dim">
          보낸 메시지는 되돌릴 수 없습니다. 이 화면에는 다른 작업을 두지 않았어요.
        </p>
      </article>
    </div>
  )
}
