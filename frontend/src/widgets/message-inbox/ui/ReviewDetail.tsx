import { useId, useState } from 'react'
import { useNavigate } from 'react-router'
import type { MessageAction, MessageReview } from '@/entities/message'
import {
  ActionFailure,
  TIME_PASSED_LOCK,
  dismissNotice,
  sendNotice,
  useMessageAction,
} from '@/features/message-action'
import { paths } from '@/shared/config/routes'
import { Icon } from '@/shared/ui/icon'
import { shortDateTime } from '../lib/format'
import { LockedButton } from './LockedButton'
import { ReviewMessageCard } from './ReviewMessageCard'
import { SendTimingPicker } from './SendTimingPicker'

/* Messages 캔버스 실측 — 가운데 604 열(위 44 · 좌우 36 · 아래 56, 간격 24), 제목 28px,
   근거 블록(눌린 면 · 위아래 18 · 좌우 20 · 라운드 12 · 간격 10), 행동 줄 위 구분선.
   열은 내용 높이를 따르고(`self-start`) 넘치면 PAGE 가 스크롤한다 — 칸 높이로 늘어나면(stretch) 세로 flex 가 자식을 줄이고,
   overflow-hidden 인 미리보기 카드는 최소 높이가 0 이라 본문이 잘린다.
   이름·사유·본문은 띄어 쓰지 않은 긴 글자(주소, 전역 `keep-all` 의 긴 한글)도 칸 안에서 줄을 바꾼다(`wrap-anywhere`) */
const PAGE = 'flex flex-1 justify-center overflow-y-auto px-36 pt-44 pb-56'
const COLUMN = 'flex w-full max-w-[604px] flex-col gap-24 self-start'
const TITLE = 'text-[28px] leading-[1.25] font-bold tracking-h1 text-ink'
const REASON = 'flex flex-col items-start gap-10 rounded-12 bg-surface-sunken px-20 py-18'
const REASON_LINK =
  'inline-flex items-center gap-5 text-caption text-dim underline underline-offset-3 hover:text-sub'

export interface ReviewDetailProps {
  workspaceId: string
  botName: string
  review: MessageReview
  /** 보내거나 보내지 않아 이 항목이 사라진다 — 누른 버튼도 사라지므로 포커스를 맡길 자리로 옮긴다 */
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
 * 보내기 전 확인 — 나갈 DM 미리보기, 왜 보내려 하는지, 언제 보낼지, `보내지 않음`·`이대로 발송` (Messages 시안).
 * 결정 4 의 UI 범위는 디자인 캔버스 기준이고 발송 정책은 MSW 목 동작이다. 모든 행동은 서버가 성공한 뒤에 화면을 바꾼다 —
 * 요청 중에는 행동이 모두 잠기고, 실패하면 그 자리에 다시 시도를 알린다 (D-137, 계획 C-5).
 * 문구를 고치거나 시각을 직접 정하는 중에도 발송이 잠긴다 — 화면에 보이는 문구·시점과 다르게 나가지 않게 한다.
 * 잠금은 `aria-disabled` 라 누른 버튼에서 포커스가 빠지지 않는다. 발송 시점 저장만으로 잠긴 동안은 버튼 모양을 그대로 둔다.
 * 보내거나 보내지 않으면 이 항목이 목록에서 빠지고 다음 항목이 골라진다
 */
export function ReviewDetail({ workspaceId, botName, review, onSettled }: ReviewDetailProps) {
  const headingId = useId()
  const reasonId = useId()
  const lockHintId = useId()
  const navigate = useNavigate()
  const actions = useMessageAction(workspaceId)
  const [editing, setEditing] = useState(false)
  const [choosingTime, setChoosingTime] = useState(false)
  const busy = actions.pending !== null
  const timePassed =
    actions.failure?.cause === 'time_passed' &&
    actions.failure.action.kind === 'send' &&
    actions.failure.action.reviewId === review.id
  const lockHint = lockReason(editing, choosingTime, false)
  const sendLockHint = lockReason(editing, choosingTime, timePassed)
  const decisionLocked = busy || lockHint !== null
  const sendLocked = busy || sendLockHint !== null
  // 발송 시점 저장만으로 잠긴 동안은 버튼 모양을 바꾸지 않는다 — 짧은 저장마다 버튼이 깜빡였다.
  // 잠금(aria-disabled, 누름을 버림)은 그대로이고, 누름이 왜 안 되는지는 저장 중인 시점 카드가 보여 준다
  const quietLock = actions.pending?.kind === 'schedule' && lockHint === null
  const pendingKind = actions.pending?.target === review.id ? actions.pending.kind : null
  const state = review.state
  const failureOf = (...kinds: MessageAction['kind'][]) => (
    <ActionFailure target={review.id} actions={actions} kinds={kinds} />
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
            {state.status === 'scheduled' ? '보낼 예정인 메시지예요' : '이 메시지, 보낼까요?'}
          </h2>
          <p className="text-[14px] wrap-anywhere text-sub">
            {state.status === 'scheduled' ? (
              <>
                <strong className="font-semibold text-ink">{review.recipientName}</strong>
                에게 {review.scheduledAt === null ? '' : shortDateTime(review.scheduledAt)}에
                Discord 개인 메시지로 나갑니다. {state.approvedBy}님이 승인했어요.
              </>
            ) : (
              <>
                <strong className="font-semibold text-ink">{review.recipientName}</strong>에게
                Discord 개인 메시지로 나갑니다. 보낸 뒤에는 되돌릴 수 없어요.
              </>
            )}
          </p>
          {state.status === 'scheduled' ? (
            <p className="text-caption text-dim">
              문구나 시각을 바꾸면 다시 승인해야 보낼 수 있어요.
            </p>
          ) : null}
        </div>

        <ReviewMessageCard
          review={review}
          botName={botName}
          editing={editing}
          onEditingChange={setEditing}
          locked={busy || choosingTime}
          keepLockedLook={quietLock}
          saving={pendingKind === 'edit'}
          onSave={(body, onSaved) =>
            actions.run({ kind: 'edit', reviewId: review.id, body }, { onSuccess: onSaved })
          }
          failure={failureOf('edit')}
        />

        <section aria-labelledby={reasonId} className={REASON}>
          <h3 id={reasonId} className="mono text-[11px] leading-[1.6] font-normal text-dim">
            왜 보내려 하나요
          </h3>
          <p className="text-body leading-[1.75] wrap-anywhere text-ink">{review.reason}</p>
          {review.reasonUrl === null ? null : (
            <a href={review.reasonUrl} target="_blank" rel="noreferrer" className={REASON_LINK}>
              마지막 메시지 보기
              <Icon name="link-out" size={12} />
              <span className="sr-only">(Discord, 새 창)</span>
            </a>
          )}
        </section>

        <SendTimingPicker
          review={review}
          locked={busy || editing}
          saving={pendingKind === 'schedule'}
          customOpen={choosingTime}
          onCustomOpenChange={setChoosingTime}
          onChange={(action, onSaved) => actions.run(action, { onSuccess: onSaved })}
          failure={failureOf('schedule')}
        />

        <div aria-hidden="true" className="h-1 bg-divider" />

        <div className="flex flex-col gap-12">
          <div className="flex items-center justify-between gap-20">
            <LockedButton
              variant="ghost"
              size="message-dismiss"
              aria-busy={pendingKind === 'dismiss' || undefined}
              aria-describedby={lockHint === null ? undefined : lockHintId}
              locked={decisionLocked}
              keepLook={quietLock}
              onClick={() =>
                actions.run(
                  { kind: 'dismiss', reviewId: review.id },
                  { notice: dismissNotice(review.recipientName), onSuccess: leave },
                )
              }
            >
              보내지 않음
            </LockedButton>
            {state.status === 'scheduled' ? null : (
              <LockedButton
                variant="primary"
                size="message-send"
                endIcon={<Icon name="send" size={16} />}
                aria-busy={pendingKind === 'send' || undefined}
                aria-describedby={sendLockHint === null ? undefined : lockHintId}
                locked={sendLocked}
                keepLook={quietLock}
                onClick={() =>
                  actions.run(
                    { kind: 'send', reviewId: review.id },
                    {
                      notice: sendNotice(review.recipientName, review.scheduledAt),
                      onSuccess: leave,
                    },
                  )
                }
              >
                이대로 발송
              </LockedButton>
            )}
          </div>
          {sendLockHint === null ? null : (
            <p id={lockHintId} className="text-caption text-dim">
              {sendLockHint}
            </p>
          )}
          {failureOf('send', 'dismiss')}
        </div>

        <p className="text-caption text-dim">
          보낸 메시지는 되돌릴 수 없습니다. 이 화면에는 다른 작업을 두지 않았어요.
        </p>
      </article>
    </div>
  )
}
