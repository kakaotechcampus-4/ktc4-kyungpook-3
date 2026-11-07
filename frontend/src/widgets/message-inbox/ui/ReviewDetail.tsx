import { useId, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import type { Bundle, MessageAction } from '@/entities/message'
import { SendTimingPicker } from '@/entities/message-settings'
import {
  ActionFailure,
  NOTE_SAVED_NOTICE,
  TIME_PASSED_MESSAGE,
  TIME_PASSED_TITLE,
  approveNotice,
  cancelNotice,
  removeTaskNotice,
  useMessageAction,
} from '@/features/message-action'
import { paths } from '@/shared/config/routes'
import { Icon } from '@/shared/ui/icon'
import { LockedButton } from '@/shared/ui/locked-button'
import { earliestDue, shortDateTime, taskTitle } from '../lib/format'
import { NO_DRAFT, liveDraft, lockReason } from '../model/reviewDraft'
import type { ReviewDraft } from '../model/reviewDraft'
import { ReviewMessageCard } from './ReviewMessageCard'
import { ReviewTasks } from './ReviewTasks'

/* Messages 캔버스 실측 — 가운데 604 열(위 44 · 좌우 36 · 아래 56, 간격 24), 제목 28px,
   근거 블록(눌린 면 · 위아래 18 · 좌우 20 · 라운드 12 · 간격 10), 행동 줄 위 구분선.
   열은 내용 높이를 따르고(`self-start`) 넘치면 PAGE 가 스크롤한다 — 칸 높이로 늘어나면(stretch) 세로 flex 가 자식을 줄이고,
   overflow-hidden 인 미리보기 카드는 최소 높이가 0 이라 본문이 잘린다.
   이름·태스크·본문은 띄어 쓰지 않은 긴 글자(주소, 전역 `keep-all` 의 긴 한글)도 칸 안에서 줄을 바꾼다(`wrap-anywhere`) */
const PAGE =
  'flex flex-1 justify-center overflow-y-auto px-36 pt-44 pb-56 max-md:px-20 max-md:pt-24 max-md:pb-32'
const COLUMN = 'flex w-full max-w-[604px] flex-col gap-24 self-start'
const TITLE = 'text-[28px] leading-[1.25] font-bold tracking-h1 text-ink max-md:text-[24px]'

export interface ReviewDetailProps {
  workspaceId: string
  botName: string
  bundle: Bundle
  /** 스크롤 끝에 둘 여백(px). `보내지 않음`·`이대로 발송` 을 정리 중 토스트 위로 꺼낼 수 있게 한다. 토스트가 없으면 0 */
  toastClearance: number
  /** 승인하거나 보내지 않거나 마지막 태스크를 빼거나 다른 묶음과 합쳐져 이 항목이 바뀐다 — 누른 버튼도 사라지므로 포커스를 맡길 자리로 옮긴다 */
  onSettled: () => void
}

/**
 * 보내기 전 확인 — 보낼 메시지(묶음) 한 통의 미리보기, 묶은 태스크, 보낼 시각, `보내지 않음`·`이대로 발송` (Messages 시안, 계약 §5.7).
 * `이대로 발송` 은 화면에 보이는 문구의 판(draft_version)으로 승인한다 — 그 사이 문구가 바뀌었으면 서버가 거절하고 다시 불러온다.
 * 모든 행동은 서버가 성공한 뒤에 화면을 바꾼다 — 요청 중에는 행동이 모두 잠기고, 실패하면 그 자리에 알린다 (D-137, 계획 C-5).
 * 문구·시각·메모를 고치거나 태스크를 뺄지 정하는 중에도 발송이 잠긴다 — 화면에 보이는 것과 다르게 나가지 않게 한다.
 * 열린 것은 한 번에 하나다(ReviewDraft).
 * 잠금은 `aria-disabled` 라 누른 버튼에서 포커스가 빠지지 않는다. 시각 저장만으로 잠긴 동안은 버튼 모양을 그대로 둔다
 */
export function ReviewDetail({
  workspaceId,
  botName,
  bundle,
  toastClearance,
  onSettled,
}: ReviewDetailProps) {
  const headingId = useId()
  const lockHintId = useId()
  const tasksHeadingRef = useRef<HTMLHeadingElement>(null)
  const navigate = useNavigate()
  const actions = useMessageAction(workspaceId)
  const [openDraft, setDraft] = useState<ReviewDraft>(NO_DRAFT)
  const draft = liveDraft(
    openDraft,
    bundle.tasks.map(({ reminderId }) => reminderId),
  )
  // 문구 칸·시각 칸은 닫힐 때 자기 것만 닫는다 — 다른 것이 열린 동안 늦게 온 닫기가 그것을 지우지 않게 한다
  const toggle = (kind: 'body' | 'time') => (open: boolean) =>
    setDraft((current) => (open ? { kind } : current.kind === kind ? NO_DRAFT : current))
  const busy = actions.pending !== null
  const timePassed = actions.isTimePassed(bundle.id)
  const lockHint = lockReason(draft, false)
  const approveLockHint = lockReason(draft, timePassed)
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
    <div
      className={PAGE}
      style={toastClearance > 56 ? { paddingBottom: toastClearance } : undefined}
    >
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
          editing={draft.kind === 'body'}
          onEditingChange={toggle('body')}
          locked={busy || (draft.kind !== 'none' && draft.kind !== 'body')}
          keepLockedLook={quietLock}
          saving={pendingKind === 'edit'}
          onSave={(body, onSaved) =>
            actions.run({ kind: 'edit', bundleId: bundle.id, body }, { onSuccess: onSaved })
          }
          failure={failureOf('edit')}
        />

        <ReviewTasks
          bundle={bundle}
          draft={draft}
          onDraftChange={setDraft}
          busy={busy}
          removing={pendingKind === 'removeTask'}
          savingNote={pendingKind === 'editNote'}
          headingRef={tasksHeadingRef}
          onRemove={(task) =>
            actions.run(
              { kind: 'removeTask', bundleId: bundle.id, reminderId: task.reminderId },
              {
                notice: (outcome) =>
                  removeTaskNotice(taskTitle(task), bundle.recipientName, outcome),
                onSuccess: (outcome) => {
                  setDraft(NO_DRAFT)
                  // 마지막 태스크를 빼 묶음이 닫혔다 — 보내지 않음처럼 이 항목을 떠난다
                  if (outcome.kind === 'closed') leave()
                  // 뺀 행이 버튼째 사라진다 — 남은 태스크 목록의 제목에 포커스를 둔다
                  else tasksHeadingRef.current?.focus()
                },
              },
            )
          }
          onSaveNote={(task, note, onSaved) =>
            actions.run(
              { kind: 'editNote', bundleId: bundle.id, reminderId: task.reminderId, note },
              { notice: NOTE_SAVED_NOTICE, onSuccess: onSaved },
            )
          }
          failure={failureOf('removeTask', 'editNote')}
        />

        <SendTimingPicker
          workspaceId={workspaceId}
          dueDate={earliestDue(bundle.tasks)}
          scheduledAt={bundle.scheduledAt}
          locked={busy || (draft.kind !== 'none' && draft.kind !== 'time')}
          saving={pendingKind === 'schedule'}
          customOpen={draft.kind === 'time'}
          onCustomOpenChange={toggle('time')}
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
