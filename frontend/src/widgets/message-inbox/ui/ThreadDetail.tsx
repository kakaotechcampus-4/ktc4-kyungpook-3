import { useQuery } from '@tanstack/react-query'
import { useLayoutEffect, useRef } from 'react'
import { messageThreadQueryOptions } from '@/entities/message'
import type { Message, MessageThread } from '@/entities/message'
import { ApiError } from '@/shared/api/errors'
import { todayInSeoul } from '@/shared/lib/date'
import { EmptyState } from '@/shared/ui/empty-state'
import { QueryErrorState } from '@/shared/ui/query-error-state'
import { avatarText, clockTime, dayLabel, groupByDay } from '../lib/format'
import { ThreadSkeleton } from './MessageSkeletons'

/* MessagesThread 캔버스 실측 — 머리 76(좌우 28, 아래 선), 대화 칸 눌린 면(위 24 · 좌우 28 · 아래 18, 간격 16),
   봇 말풍선 먹 면 최대 438 · 상대 말풍선 흰 면 선 최대 410, 둘 다 라운드 15 에 꼬리 쪽만 4.
   대화 칸은 relative 다 — 말풍선의 sr-only 보낸 쪽 글자가 칸 밖으로 새어 페이지를 늘리지 않게 한다 */
const HEAD =
  'flex h-header shrink-0 items-center justify-between gap-16 border-b border-divider px-28'
const AVATAR =
  'inline-flex shrink-0 items-center justify-center rounded-999 bg-divider font-semibold text-ink'
const CHANNEL_AVATAR =
  'inline-flex shrink-0 items-center justify-center rounded-999 border border-line bg-surface text-dim'
/* 며칠째인지는 정해지지 않아(계획 C-3) 시안의 강조색 `답장 3일째 없음` 대신 회색 상태 배지다 */
const WAITING_BADGE =
  'inline-flex h-22 shrink-0 items-center gap-5 rounded-6 bg-control px-9 text-meta leading-none font-semibold text-sub'
const BODY =
  'relative flex min-h-[0px] flex-1 flex-col gap-16 overflow-y-auto bg-surface-sunken px-28 pt-24 pb-18'
const DAY_RULE = 'h-1 flex-1 bg-line'
const BUBBLE = 'px-15 py-12 text-body leading-[1.75] whitespace-pre-line'
const BOT_BUBBLE = `${BUBBLE} max-w-[438px] rounded-[15px_15px_4px_15px] bg-ink text-surface`
const COUNTERPART_BUBBLE = `${BUBBLE} max-w-[410px] rounded-[15px_15px_15px_4px] border border-line bg-surface text-ink`
const TIME = 'mono text-[10.5px] text-dim'
const WAITING_NOTE =
  'inline-flex items-center self-center rounded-999 bg-divider px-13 py-7 text-meta text-sub'

/**
 * 사람별 대화(채널 포함). 목록과 따로 받는다 — 목록 오류가 대화를 막지 않는다 (계획 C-6 5단계).
 * 자동 발송·승인자·예정 같은 상태 문구와 `Discord에서 열기` 는 정해지지 않아 두지 않는다 (계획 C-6 4단계)
 */
export function ThreadDetail({ workspaceId, threadId }: { workspaceId: string; threadId: string }) {
  const thread = useQuery(messageThreadQueryOptions(workspaceId, threadId))
  if (thread.data !== undefined) return <ThreadView thread={thread.data} />
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

function ThreadView({ thread }: { thread: MessageThread }) {
  const bodyRef = useRef<HTMLElement>(null)
  // 대화를 열면 가장 최근 메시지부터 보인다. 대화가 바뀌면 화면이 새로 마운트된다 (MessageInbox 의 key)
  useLayoutEffect(() => {
    const body = bodyRef.current
    if (body !== null) body.scrollTop = body.scrollHeight
  }, [])
  const today = todayInSeoul()

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
            <p className="text-meta leading-[1.4] text-dim">
              {thread.kind === 'channel' ? 'Discord 채널' : 'Discord 개인 메시지'}
            </p>
          </div>
        </div>
        {thread.awaitingReply ? (
          <span className={WAITING_BADGE}>
            <span
              aria-hidden="true"
              className="size-7 rounded-999 border-[1.5px] border-input-border"
            />
            답장 기다리는 중
          </span>
        ) : null}
      </div>
      {/* 스크롤 칸이라 키보드로도 내릴 수 있게 Tab 자리를 준다 — 안에 누를 것이 없다 (WCAG 2.1.1) */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
      <section ref={bodyRef} aria-label="대화 내용" tabIndex={0} className={BODY}>
        {thread.messages.length === 0 ? (
          <p className="self-center pt-24 text-body text-dim">아직 주고받은 메시지가 없어요.</p>
        ) : (
          groupByDay(thread.messages).map((day) => (
            <div key={day.date ?? ''}>
              {day.date === null ? null : (
                <h3 className="flex items-center gap-12 py-4">
                  <span aria-hidden="true" className={DAY_RULE} />
                  <span className="mono text-[11px] font-normal text-dim">
                    {dayLabel(day.date, today)}
                  </span>
                  <span aria-hidden="true" className={DAY_RULE} />
                </h3>
              )}
              <ol className="flex flex-col gap-16 pt-16">
                {day.messages.map((message) => (
                  <li key={message.id}>
                    <Bubble message={message} counterpart={thread.name} kind={thread.kind} />
                  </li>
                ))}
              </ol>
            </div>
          ))
        )}
        {thread.awaitingReply ? (
          <p className={WAITING_NOTE}>여기서부터 답장을 기다리고 있어요</p>
        ) : null}
      </section>
    </div>
  )
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
        <span className={TIME}>{clockTime(message.sentAt)}</span>
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
