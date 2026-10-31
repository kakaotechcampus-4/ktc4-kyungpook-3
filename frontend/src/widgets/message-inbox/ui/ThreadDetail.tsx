import { useQuery } from '@tanstack/react-query'
import { useLayoutEffect, useRef } from 'react'
import { messageThreadQueryOptions } from '@/entities/message'
import type { Message, MessageThread, PendingMessageReview } from '@/entities/message'
import {
  ReviewActionFailure,
  dismissNotice,
  sendNotice,
  useMessageReviewAction,
} from '@/features/message-review'
import type { MessageReviewActionControl } from '@/features/message-review'
import { ApiError } from '@/shared/api/errors'
import { paths } from '@/shared/config/routes'
import { todayInSeoul } from '@/shared/lib/date'
import { GuardedLink } from '@/shared/lib/unsaved-changes'
import { Button } from '@/shared/ui/button'
import { EmptyState } from '@/shared/ui/empty-state'
import { Icon } from '@/shared/ui/icon'
import { QueryErrorState } from '@/shared/ui/query-error-state'
import {
  avatarText,
  awaitingDays,
  clockTime,
  dayLabel,
  groupByDay,
  shortDateTime,
} from '../lib/format'
import { ThreadSkeleton } from './MessageSkeletons'

/* MessagesThread 캔버스 실측 — 머리 76(좌우 28, 아래 선), 대화 칸 눌린 면(위 24 · 좌우 28 · 아래 18, 간격 16),
   봇 말풍선 먹 면 최대 438 · 상대 말풍선 흰 면 선 최대 410, 둘 다 라운드 15 에 꼬리 쪽만 4,
   아직 나가지 않은 말풍선은 흰 면 점선(`border-dashed` 한 이름이 모양과 색을 낸다). 아래 안내 바(위 선 · 위 14 · 좌우 28 · 아래 20, 안쪽 카드 라운드 14).
   대화 칸은 relative 다 — 말풍선의 sr-only 보낸 쪽 글자가 칸 밖으로 새어 페이지를 늘리지 않게 한다 */
const HEAD =
  'flex h-header shrink-0 items-center justify-between gap-16 border-b border-divider px-28'
const AVATAR =
  'inline-flex shrink-0 items-center justify-center rounded-999 bg-divider font-semibold text-ink'
const CHANNEL_AVATAR =
  'inline-flex shrink-0 items-center justify-center rounded-999 border border-line bg-surface text-dim'
/* 강조색 면 흰 글자 — 지금 봐야 하는 위험 배지 (디자인 시스템 강조색) */
const WAITING_BADGE =
  'inline-flex h-22 shrink-0 items-center rounded-6 bg-accent px-9 text-meta leading-none font-semibold text-surface'
const DISCORD_LINK = 'inline-flex shrink-0 items-center gap-5 text-[12px] text-dim hover:text-sub'
const BODY =
  'relative flex min-h-[0px] flex-1 flex-col gap-16 overflow-y-auto bg-surface-sunken px-28 pt-24 pb-18'
const DAY_RULE = 'h-1 flex-1 bg-line'
const BUBBLE = 'px-15 py-12 text-body leading-[1.75] whitespace-pre-line'
const BOT_BUBBLE = `${BUBBLE} max-w-[438px] rounded-[15px_15px_4px_15px] bg-ink text-surface`
const UPCOMING_BUBBLE = `${BUBBLE} max-w-[438px] rounded-[15px_15px_4px_15px] border border-dashed bg-surface text-sub`
const COUNTERPART_BUBBLE = `${BUBBLE} max-w-[410px] rounded-[15px_15px_15px_4px] border border-line bg-surface text-ink`
const TIME = 'mono text-[10.5px] text-dim'
const WAITING_NOTE =
  'inline-flex items-center gap-7 self-center rounded-999 bg-divider px-13 py-7 text-meta text-sub'
const FOOT = 'shrink-0 border-t border-divider px-28 pt-14 pb-20'
const FOOT_CARD =
  'flex items-center gap-12 rounded-[14px] border border-line bg-surface px-14 py-12 text-dim'
const FOOT_LINK =
  'inline-flex h-32 shrink-0 items-center gap-3 px-4 text-caption font-semibold text-ink hover:text-sub'

/**
 * 사람별 대화(채널 포함) — MessagesThread 시안. 목록과 따로 받는다 — 목록 오류가 대화를 막지 않는다 (계획 C-6 5단계).
 * 아직 나가지 않은 메시지(승인 대기·예약)는 오늘 아래 점선 말풍선이고, 승인 대기는 그 자리에서 `승인`·`반려` 한다 —
 * 서버가 성공한 뒤에만 대화가 바뀐다 (D-137)
 */
export function ThreadDetail({
  workspaceId,
  threadId,
  botName,
}: {
  workspaceId: string
  threadId: string
  botName: string
}) {
  const thread = useQuery(messageThreadQueryOptions(workspaceId, threadId))
  if (thread.data !== undefined)
    return <ThreadView workspaceId={workspaceId} botName={botName} thread={thread.data} />
  if (thread.error === null) return <ThreadSkeleton />
  // 없는 대화는 다시 받아도 없다 — 다시 시도 대신 찾을 수 없다고 알린다
  if (thread.error instanceof ApiError && thread.error.status === 404) return <ThreadUnavailable />
  return (
    <div className="px-28 pt-28">
      <QueryErrorState
        error={thread.error}
        onRetry={() => void thread.refetch()}
        title="대화를 불러오지 못했어요"
      />
    </div>
  )
}

/** 없는 대화이거나 주소가 틀렸다. 목록은 그대로 있어 다른 항목을 고를 수 있다 */
export function ThreadUnavailable() {
  return (
    <div className="flex flex-1 items-center justify-center px-36 pt-48 pb-96">
      <EmptyState
        titleAs="h2"
        title="대화를 찾을 수 없어요"
        description="주소를 확인하거나 왼쪽 목록에서 다시 골라 주세요."
      />
    </div>
  )
}

function ThreadView({
  workspaceId,
  botName,
  thread,
}: {
  workspaceId: string
  botName: string
  thread: MessageThread
}) {
  const bodyRef = useRef<HTMLElement>(null)
  // 대화를 열면 가장 최근 메시지부터 보인다. 대화가 바뀌면 화면이 새로 마운트된다 (MessageInbox 의 key)
  useLayoutEffect(() => {
    const body = bodyRef.current
    if (body !== null) body.scrollTop = body.scrollHeight
  }, [])
  const actions = useMessageReviewAction(workspaceId)
  const today = todayInSeoul()
  const days = groupByDay(thread.messages.filter(({ status }) => status === 'sent'))
  const scheduled = thread.messages.filter(({ status }) => status === 'scheduled')
  const hasUpcoming = scheduled.length > 0 || thread.pendingReviews.length > 0
  const waitingDays =
    thread.awaitingReplySince === null ? null : awaitingDays(thread.awaitingReplySince, today)
  const channelOrDm = thread.kind === 'channel' ? 'Discord 채널' : 'Discord 개인 메시지'

  return (
    <div className="flex min-h-[0px] flex-1 flex-col">
      <div className={HEAD}>
        <div className="flex min-w-[0px] items-center gap-11">
          <span
            aria-hidden="true"
            className={
              thread.kind === 'channel'
                ? `${CHANNEL_AVATAR} size-34 text-[12px]`
                : `${AVATAR} size-34 text-[12px]`
            }
          >
            {avatarText(thread.name, thread.kind)}
          </span>
          <div className="flex min-w-[0px] flex-col gap-2">
            <h2 className="truncate text-[15px] leading-[1.4] font-semibold tracking-h3 text-ink">
              {thread.name}
            </h2>
            <p className="truncate text-meta leading-[1.4] text-dim">
              {[thread.teamRole, channelOrDm, `${botName} 봇으로 보냄`]
                .filter((part) => part !== null)
                .join(' · ')}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-12">
          {waitingDays === null ? null : (
            <span className={WAITING_BADGE}>답장 {waitingDays}일째 없음</span>
          )}
          {thread.discordUrl === null ? null : (
            <a href={thread.discordUrl} target="_blank" rel="noreferrer" className={DISCORD_LINK}>
              Discord에서 열기
              <Icon name="link-out" size={12} />
              <span className="sr-only">(새 창)</span>
            </a>
          )}
        </div>
      </div>
      {/* 스크롤 칸이라 키보드로도 내릴 수 있게 Tab 자리를 준다 (WCAG 2.1.1) */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
      <section ref={bodyRef} aria-label="대화 내용" tabIndex={0} className={BODY}>
        {thread.messages.length === 0 && !hasUpcoming ? (
          <p className="self-center pt-24 text-body text-dim">아직 주고받은 메시지가 없어요.</p>
        ) : null}
        {days.map((day) => (
          <div key={day.date ?? ''}>
            {day.date === null ? null : <DayDivider label={dayLabel(day.date, today)} />}
            <ol className="flex flex-col gap-16 pt-16">
              {day.messages.map((message) => (
                <li key={message.id}>
                  <Bubble message={message} counterpart={thread.name} kind={thread.kind} />
                </li>
              ))}
            </ol>
          </div>
        ))}
        {waitingDays === null ? null : (
          <p className={WAITING_NOTE}>
            <Icon name="clock" size={13} />
            여기서부터 답장이 없습니다 — 오늘로 {waitingDays}일째예요
          </p>
        )}
        {hasUpcoming ? (
          <div>
            {days.at(-1)?.date === today ? null : <DayDivider label={dayLabel(today, today)} />}
            <ol aria-label="아직 나가지 않은 메시지" className="flex flex-col gap-16 pt-16">
              {scheduled.map((message) => (
                <li key={message.id}>
                  <ScheduledBubble message={message} />
                </li>
              ))}
              {thread.pendingReviews.map((review) => (
                <li key={review.id}>
                  <PendingBubble
                    review={review}
                    recipientName={thread.name}
                    actions={actions}
                    onSettled={() => bodyRef.current?.focus()}
                  />
                </li>
              ))}
            </ol>
          </div>
        ) : null}
      </section>
      <ThreadFoot
        workspaceId={workspaceId}
        botName={botName}
        pendingReviews={thread.pendingReviews}
      />
    </div>
  )
}

function DayDivider({ label }: { label: string }) {
  return (
    <h3 className="flex items-center gap-12 py-4">
      <span aria-hidden="true" className={DAY_RULE} />
      <span className="mono text-[11px] font-normal text-dim">{label}</span>
      <span aria-hidden="true" className={DAY_RULE} />
    </h3>
  )
}

/** 봇 메시지 아래 줄 — `09:02 · 자동 발송`, `18:00 · 최진호 승인` (MessagesThread 시안) */
function botTimeLine(message: Message): string {
  const time = clockTime(message.sentAt)
  if (message.delivery === 'auto') return `${time} · 자동 발송`
  return message.approvedBy === null ? time : `${time} · ${message.approvedBy} 승인`
}

/** 보낸 쪽은 자리(오른쪽 봇 · 왼쪽 상대)와 면(먹 · 흰 선)으로, 화면 읽기에는 숨긴 글자로 구분한다 — 색에만 기대지 않는다 (D-128) */
function Bubble({
  message,
  counterpart,
  kind,
}: {
  message: Message
  counterpart: string
  kind: MessageThread['kind']
}) {
  if (message.sender === 'bot')
    return (
      <div className="flex flex-col items-end gap-5">
        <p className={BOT_BUBBLE}>
          <span className="sr-only">봇: </span>
          {message.body}
        </p>
        <span className={TIME}>{botTimeLine(message)}</span>
      </div>
    )
  return (
    <div className="flex items-end gap-8">
      <span aria-hidden="true" className={`${AVATAR} size-28 text-[10px]`}>
        {avatarText(counterpart, kind)}
      </span>
      <div className="flex flex-col items-start gap-5">
        <p className={COUNTERPART_BUBBLE}>
          <span className="sr-only">{counterpart}: </span>
          {message.body}
        </p>
        <span className={TIME}>{clockTime(message.sentAt)}</span>
      </div>
    </div>
  )
}

/** 승인을 받아 정한 시각을 기다리는 메시지. 점선은 아직 나가지 않았다는 뜻이다 */
function ScheduledBubble({ message }: { message: Message }) {
  const approved = message.approvedBy === null ? '' : ` · ${message.approvedBy} 승인`
  return (
    <div className="flex flex-col items-end gap-5">
      <p className={UPCOMING_BUBBLE}>
        <span className="sr-only">봇(예약): </span>
        {message.body}
      </p>
      <span className={TIME}>
        {shortDateTime(message.sentAt)} 발송 예정{approved}
      </span>
    </div>
  )
}

/** 승인을 기다리는 보내기 전 확인 항목 — `승인` 하면 정한 시각에 나가고 `반려` 하면 보내지 않는다 */
function PendingBubble({
  review,
  recipientName,
  actions,
  onSettled,
}: {
  review: PendingMessageReview
  recipientName: string
  actions: MessageReviewActionControl
  onSettled: () => void
}) {
  const busy = actions.pending !== null
  const pendingKind = actions.pending?.reviewId === review.id ? actions.pending.kind : null
  return (
    <div className="flex flex-col items-end gap-8">
      <p className={UPCOMING_BUBBLE}>
        <span className="sr-only">봇(승인 대기): </span>
        {review.body}
      </p>
      <span className={TIME}>
        {review.scheduledAt === null
          ? '승인하면 바로 발송'
          : `${shortDateTime(review.scheduledAt)} 발송 예정`}
      </span>
      <div className="flex items-center gap-9">
        <Button
          variant="ghost"
          loading={pendingKind === 'dismiss'}
          disabled={busy}
          onClick={() =>
            actions.run(
              review.id,
              { kind: 'dismiss' },
              { notice: dismissNotice(recipientName), onSuccess: onSettled },
            )
          }
        >
          반려
        </Button>
        <Button
          variant="primary"
          loading={pendingKind === 'send'}
          disabled={busy}
          onClick={() =>
            actions.run(
              review.id,
              { kind: 'send' },
              { notice: sendNotice(recipientName, review.scheduledAt), onSuccess: onSettled },
            )
          }
        >
          승인
        </Button>
      </div>
      <ReviewActionFailure reviewId={review.id} actions={actions} />
    </div>
  )
}

/** 메시지는 봇만 보낸다 — 입력 칸 대신 승인 대기 항목으로 안내한다 (MessagesThread 시안의 아래 안내 바) */
function ThreadFoot({
  workspaceId,
  botName,
  pendingReviews,
}: {
  workspaceId: string
  botName: string
  pendingReviews: readonly PendingMessageReview[]
}) {
  const first = pendingReviews.at(0)
  return (
    <div className={FOOT}>
      <div className={FOOT_CARD}>
        <Icon name="info" size={16} />
        <p className="flex-1 text-caption leading-[1.6] text-sub">
          메시지는 항상 <strong className="font-semibold text-ink">{botName} 봇</strong>이 보냅니다.{' '}
          {first === undefined ? (
            '지금 승인을 기다리는 메시지는 없어요.'
          ) : (
            <>
              직접 입력하는 대신 승인 대기 중인{' '}
              <strong className="font-semibold text-ink">{pendingReviews.length}건</strong>을 확인해
              주세요.
            </>
          )}
        </p>
        {first === undefined ? null : (
          <GuardedLink to={paths.messageReview(workspaceId, first.id)} className={FOOT_LINK}>
            확인하기
            <Icon name="chevron-right" size={13} />
          </GuardedLink>
        )}
      </div>
    </div>
  )
}
