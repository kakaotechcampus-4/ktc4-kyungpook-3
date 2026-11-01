import { useQuery } from '@tanstack/react-query'
import { useRef } from 'react'
import { messageInboxQueryOptions } from '@/entities/message'
import type { MessageInbox as Inbox, MessageReview, MessageThreadSummary } from '@/entities/message'
import { paths } from '@/shared/config/routes'
import { todayInSeoul } from '@/shared/lib/date'
import { GuardedLink } from '@/shared/lib/unsaved-changes'
import { EmptyState } from '@/shared/ui/empty-state'
import { QueryErrorState } from '@/shared/ui/query-error-state'
import { avatarText, reviewDateLabel, shortDate } from '../lib/format'
import { InboxListSkeleton, ReviewSkeleton } from './MessageSkeletons'
import { ReviewDetail } from './ReviewDetail'
import { ThreadDetail, ThreadUnavailable } from './ThreadDetail'

/* Messages 캔버스 실측 — 왼쪽 목록 308(위 18 · 좌우 12 · 아래 24, 영역 사이 18) · 오른쪽 선, 목록 제목 17px.
   화면 높이를 헤더 아래로 묶고 목록과 상세가 각자 세로로 스크롤한다 (D-124, 계획 C-6 6단계).
   스크롤 칸은 relative 다 — 안의 sr-only 글자(absolute)가 칸 밖 문서 높이를 늘려 페이지가 스크롤되지 않게 한다 */
const SCREEN = 'flex h-[calc(100dvh-var(--spacing-header))] items-stretch'
const ASIDE =
  'relative flex w-aside shrink-0 flex-col gap-18 overflow-y-auto border-r border-divider px-12 pt-18 pb-24'
const ASIDE_TITLE = 'px-8 text-[17px] leading-[1.55] font-bold tracking-h2 text-ink'
const DETAIL = 'flex min-w-[0px] flex-1 flex-col'
const GROUP_LABEL = 'mono text-[10.5px] leading-[1.75] font-normal tracking-[0.1em] text-dim'
const GROUP_NOTE = 'px-8 text-caption text-dim'
const REVIEW_ROW =
  'group flex w-full flex-col items-start gap-7 rounded-10 px-14 py-13 text-left hover:bg-surface-sunken aria-[current=page]:bg-surface-selected'
/* 이름·요약은 띄어 쓰지 않은 긴 글자(전역 `keep-all` 의 긴 한글)도 행 안에서 줄을 바꾼다(`wrap-anywhere`) — 목록이 가로로 넘치지 않는다.
   말줄임은 시안대로 대화 행의 한 줄 미리보기(최대 176)만 한다 */
const REVIEW_NAME =
  'flex-1 text-body wrap-anywhere text-sub group-aria-[current=page]:font-semibold group-aria-[current=page]:text-ink'
const REVIEW_SUMMARY =
  'text-caption leading-[1.55] wrap-anywhere text-dim group-aria-[current=page]:text-sub'
const THREAD_ROW =
  'group flex w-full items-center gap-10 rounded-10 px-12 py-9 text-left hover:bg-surface-sunken aria-[current=page]:bg-surface-selected'
const AVATAR =
  'inline-flex shrink-0 items-center justify-center rounded-999 bg-divider font-semibold text-ink'
/* 채널은 사람이 아니라 흰 바탕 선 원이다 (시안 `#회의록 요약`) */
const CHANNEL_AVATAR =
  'inline-flex shrink-0 items-center justify-center rounded-999 border border-line bg-surface text-dim'
const DATE = 'mono text-[11px] text-dim'
const EMPTY_DETAIL = 'flex flex-1 items-center justify-center px-36 pt-48 pb-96 text-body text-dim'
/* EmptyMessages 캔버스 — 가운데 정렬(위 48 · 좌우 48 · 아래 96), 주 액션 먹 면 40 */
const EMPTY_PAGE = 'flex flex-1 items-center justify-center px-48 pt-48 pb-96'
const EMPTY_ACTION =
  'inline-flex h-40 items-center justify-center rounded-9 bg-ink px-20 text-body font-semibold text-surface hover:bg-dim active:bg-sub'

export interface MessageInboxProps {
  workspaceId: string
  /** 메시지를 보내는 봇의 이름. 공간 이름을 쓴다 (Messages 시안의 `캡스톤 5조 봇`) */
  botName: string
  /** URL 이 가리키는 대화. 없으면 null */
  threadId: string | null
  /**
   * 검색 파라미터가 가리키는 보내기 전 확인 항목. 목록에 없는 ID 는 선택 없음이다.
   * `undefined` 는 파라미터가 없다는 뜻이라 첫 항목이 골라지고, `null` 은 파라미터가 있지만 ID 모양이 아니라 선택 없음이다
   */
  reviewId: string | null | undefined
  /** 없는 하위 경로이거나 대화 ID 모양이 틀리다 */
  invalidPath?: boolean
}

/**
 * 메시지 화면 (M8, Messages·MessagesThread·EmptyMessages 시안) — 왼쪽 목록(보내기 전 확인 · 대화), 오른쪽 상세의 2단이다.
 * 고른 항목은 URL 이 정한다. 그래서 새로고침·뒤로가기에서 그대로다. 아무것도 고르지 않고 들어오면 Messages 시안처럼
 * 첫 보내기 전 확인 항목이 골라진다. 결정 4 의 UI 범위는 디자인 캔버스 기준이고 행동은 MSW 목이다
 */
export function MessageInbox({
  workspaceId,
  botName,
  threadId,
  reviewId,
  invalidPath = false,
}: MessageInboxProps) {
  const inbox = useQuery(messageInboxQueryOptions(workspaceId))
  const detailRef = useRef<HTMLElement>(null)
  const reviews = inbox.data?.reviews ?? []
  const review =
    threadId !== null || invalidPath
      ? null
      : reviewId === undefined
        ? (reviews.at(0) ?? null)
        : (reviews.find(({ id }) => id === reviewId) ?? null)

  // 검토 항목도 대화도 없다 — EmptyMessages 캔버스 한 장.
  // `알림 규칙 보기` 화면은 아직 없어 가장 가까운 팀 설정으로 보낸다 (결과 문서 C 의 차이표)
  if (
    threadId === null &&
    !invalidPath &&
    inbox.data !== undefined &&
    inbox.data.reviews.length === 0 &&
    inbox.data.threads.length === 0
  )
    return (
      <main className={EMPTY_PAGE}>
        <EmptyState
          title="보낼 메시지가 없어요"
          description="마감이 다가오거나 진행이 멈추면, 담당자에게 보낼 DM을 여기에 준비해 둘게요. 보내기 전에 항상 물어봅니다."
          action={
            <GuardedLink to={paths.settings(workspaceId)} className={EMPTY_ACTION}>
              알림 규칙 보기
            </GuardedLink>
          }
        />
      </main>
    )

  let detail
  if (invalidPath) detail = <ThreadUnavailable />
  else if (threadId !== null)
    // 대화가 바뀌면 상세를 새로 마운트한다 — 이전 대화의 스크롤 자리를 들고 있지 않는다
    detail = (
      <ThreadDetail
        key={threadId}
        workspaceId={workspaceId}
        threadId={threadId}
        botName={botName}
      />
    )
  else if (review !== null)
    // 항목이 바뀌면 고쳐 쓰던 문구·직접 정하던 시각을 들고 가지 않는다
    detail = (
      <ReviewDetail
        key={review.id}
        workspaceId={workspaceId}
        botName={botName}
        review={review}
        onSettled={() => detailRef.current?.focus()}
      />
    )
  else if (inbox.data === undefined && inbox.error === null) detail = <ReviewSkeleton />
  else if (inbox.data !== undefined)
    detail = <p className={EMPTY_DETAIL}>왼쪽 목록에서 확인할 메시지나 대화를 골라 주세요.</p>
  else detail = null

  return (
    <main className={SCREEN}>
      <aside aria-label="메시지 목록" className={ASIDE}>
        <h1 className={ASIDE_TITLE}>메시지</h1>
        {inbox.data !== undefined ? (
          <InboxList
            workspaceId={workspaceId}
            inbox={inbox.data}
            threadId={threadId}
            reviewId={review?.id ?? null}
          />
        ) : inbox.error !== null ? (
          // 목록 오류는 목록 칸에만 알린다. 고른 대화는 따로 받아 그대로 보인다
          <div className="px-8">
            <QueryErrorState
              error={inbox.error}
              onRetry={() => void inbox.refetch()}
              title="메시지 목록을 불러오지 못했어요"
            />
          </div>
        ) : (
          <InboxListSkeleton />
        )}
      </aside>
      {/* 처리한 항목이 버튼째 사라지면 포커스를 이 칸이 받는다 — 다음 Tab 이 새로 골라진 항목으로 간다 */}
      <section ref={detailRef} aria-label="메시지 내용" tabIndex={-1} className={DETAIL}>
        {detail}
      </section>
    </main>
  )
}

function InboxList({
  workspaceId,
  inbox,
  threadId,
  reviewId,
}: {
  workspaceId: string
  inbox: Inbox
  threadId: string | null
  reviewId: string | null
}) {
  const awaiting = inbox.threads.filter(
    ({ awaitingReplySince }) => awaitingReplySince !== null,
  ).length
  const today = todayInSeoul()
  return (
    <>
      <section aria-labelledby="messages-reviews" className="flex flex-col gap-6">
        <h2 id="messages-reviews" className={`${GROUP_LABEL} px-8`}>
          보내기 전 확인 {inbox.reviews.length}
        </h2>
        {inbox.reviews.length === 0 ? (
          <p className={GROUP_NOTE}>지금 확인할 메시지가 없어요.</p>
        ) : (
          <ul className="flex flex-col gap-6">
            {inbox.reviews.map((review) => (
              <li key={review.id}>
                <ReviewRow
                  workspaceId={workspaceId}
                  review={review}
                  dateLabel={reviewDateLabel(review, today)}
                  selected={review.id === reviewId}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="messages-threads" className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-8 px-8">
          <h2 id="messages-threads" className={GROUP_LABEL}>
            대화
          </h2>
          {awaiting === 0 ? null : (
            <span className="text-[10.5px] text-dim">답장 기다리는 중 {awaiting}</span>
          )}
        </div>
        {inbox.threads.length === 0 ? (
          <p className={GROUP_NOTE}>아직 주고받은 대화가 없어요.</p>
        ) : (
          <ul className="flex flex-col gap-4">
            {inbox.threads.map((thread) => (
              <li key={thread.id}>
                <ThreadRow
                  workspaceId={workspaceId}
                  thread={thread}
                  selected={thread.id === threadId}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  )
}

/*
 * 행은 GuardedLink(NavLink)다. NavLink 는 주소가 맞으면 스스로 aria-current 를 단다 — 검토 항목은 모두 `/messages` 라
 * 검색 파라미터를 보지 않는 NavLink 에는 전부 맞는다. 그래서 `end` 로 대화 경로에서는 꺼 두고, 고른 행만 `page` 로 준다
 */
function ReviewRow({
  workspaceId,
  review,
  dateLabel,
  selected,
}: {
  workspaceId: string
  review: MessageReview
  /** `09/24 마감` 또는 `3일 전` */
  dateLabel: string
  selected: boolean
}) {
  return (
    <GuardedLink
      to={paths.messageReview(workspaceId, review.id)}
      end
      aria-current={selected ? 'page' : 'false'}
      className={REVIEW_ROW}
    >
      <span className="flex w-full items-center gap-9">
        <span aria-hidden="true" className={`${AVATAR} size-24 text-[10px]`}>
          {avatarText(review.recipientName, 'direct')}
        </span>
        <span className={REVIEW_NAME}>{review.recipientName}</span>
        <span className={DATE}>{dateLabel}</span>
      </span>
      <span className={REVIEW_SUMMARY}>{review.summary}</span>
    </GuardedLink>
  )
}

function ThreadRow({
  workspaceId,
  thread,
  selected,
}: {
  workspaceId: string
  thread: MessageThreadSummary
  selected: boolean
}) {
  const last = thread.lastMessage
  return (
    <GuardedLink
      to={paths.messageThread(workspaceId, thread.id)}
      aria-current={selected ? 'page' : 'false'}
      className={THREAD_ROW}
    >
      <span
        aria-hidden="true"
        className={
          thread.kind === 'channel'
            ? `${CHANNEL_AVATAR} size-30 text-[11px]`
            : `${AVATAR} size-30 text-[11px] group-aria-[current=page]:bg-ink group-aria-[current=page]:text-surface`
        }
      >
        {avatarText(thread.name, thread.kind)}
      </span>
      <span className="flex min-w-[0px] flex-1 flex-col gap-1">
        <span className="text-control leading-[1.75] font-semibold wrap-anywhere text-ink">
          {thread.name}
        </span>
        {last === null ? null : (
          <span className="truncate text-meta leading-[1.5] text-dim">
            {last.sender === 'bot' ? `나: ${last.body}` : last.body}
          </span>
        )}
      </span>
      <span className="flex shrink-0 flex-col items-end gap-4">
        {last === null ? null : <span className={DATE}>{shortDate(last.sentAt)}</span>}
        {thread.awaitingReplySince !== null ? (
          <>
            <span
              aria-hidden="true"
              className="size-7 rounded-999 border-[1.5px] border-input-border"
            />
            <span className="sr-only">답장 기다리는 중</span>
          </>
        ) : null}
      </span>
    </GuardedLink>
  )
}
