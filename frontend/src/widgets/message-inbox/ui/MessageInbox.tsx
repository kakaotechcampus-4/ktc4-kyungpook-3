import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useNavigate } from 'react-router'
import { messageInboxQueryOptions, messageThreadQueryOptions } from '@/entities/message'
import type { Bundle, MessageInbox as Inbox, MessageThreadSummary } from '@/entities/message'
import { paths } from '@/shared/config/routes'
import { GuardedLink } from '@/shared/lib/unsaved-changes'
import { EmptyState } from '@/shared/ui/empty-state'
import { QueryErrorState } from '@/shared/ui/query-error-state'
import { PinnedToastHost } from '@/shared/ui/toast'
import { avatarText, bundleDateLabel, bundleSummary, shortDate } from '../lib/format'
import { selectDetail } from '../model/selection'
import { SELF_SECTION_TITLE, threadPolicy } from '../model/viewer'
import type { MessageViewer, ThreadPolicy } from '../model/viewer'
import { ComposeDetail } from './ComposeDetail'
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
const DETAIL = 'relative flex min-w-[0px] flex-1 flex-col'
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
/* DM 못 보냄. 대화 머리의 답장 대기 배지와 같은 연한 레드 면 */
const DM_FAILED_CHIP =
  'inline-flex h-22 shrink-0 items-center rounded-6 bg-accent-badge px-9 text-meta leading-none font-semibold text-accent'
const AVATAR =
  'inline-flex shrink-0 items-center justify-center rounded-999 bg-divider font-semibold text-ink'
const DATE = 'mono text-[11px] text-dim'
const EMPTY_DETAIL = 'flex flex-1 items-center justify-center px-36 pt-48 pb-96 text-body text-dim'
/* EmptyMessages 캔버스 — 가운데 정렬(위 48 · 좌우 48 · 아래 96), 주 액션 먹 면 40 */
const EMPTY_PAGE = 'flex flex-1 items-center justify-center px-48 pt-48 pb-96'
const EMPTY_ACTION =
  'inline-flex h-40 items-center justify-center rounded-9 bg-ink px-20 text-body font-semibold text-surface hover:bg-dim active:bg-sub'
/* 빈 화면의 두 번째 행동 — 아웃라인 버튼 모양(design-system §7-12) */
const EMPTY_SECOND_ACTION =
  'inline-flex h-40 items-center justify-center rounded-9 border border-line bg-surface px-20 text-body font-semibold text-ink hover:bg-control'
const COMPOSE_LINK =
  'shrink-0 rounded-9 px-10 py-4 text-caption font-semibold text-sub hover:bg-surface-sunken hover:text-ink aria-[current=page]:bg-surface-selected aria-[current=page]:text-ink'

export interface MessageInboxProps {
  workspaceId: string
  /** 메시지를 보내는 봇의 이름. 공간 이름을 쓴다 (Messages 시안의 `캡스톤 5조 봇`) */
  botName: string
  /** 이 공간에서 화면을 보는 사람. 역할과 팀원 행이 대화마다 그리는 규칙을 고른다 */
  viewer: MessageViewer
  /** URL 이 가리키는 대화. 없으면 null */
  threadId: string | null
  /**
   * 검색 파라미터가 가리키는 보낼 메시지(묶음). 목록에 없는 ID 는 선택 없음이다.
   * `undefined` 는 파라미터가 없다는 뜻이라 아직 승인하지 않은 첫 묶음이 골라지고, `null` 은 파라미터가 있지만 ID 모양이 아니라 선택 없음이다
   */
  bundleId: string | null | undefined
  /** 없는 하위 경로이거나 대화 ID 모양이 틀리다 */
  invalidPath?: boolean
  /** 검색 파라미터가 재촉 만들기를 연다. 만들 수 없는 사람(팀원)이면 무시한다 */
  composing?: boolean
}

/**
 * 메시지 화면 (M8, Messages·MessagesThread·EmptyMessages 시안, 계약 §5.7) — 왼쪽 목록(PM 의 자기 대화 · 보내기 전 확인 · 대화), 오른쪽 상세의 2단이다.
 * 고른 항목은 URL 이 정한다. 그래서 새로고침·뒤로가기에서 그대로다. 아무것도 고르지 않고 들어오면
 * 아직 승인하지 않은 첫 보낼 메시지가 골라진다. 팀원에게는 보내기 전 확인이 없다
 */
export function MessageInbox({
  workspaceId,
  botName,
  viewer,
  threadId,
  bundleId,
  invalidPath = false,
  composing = false,
}: MessageInboxProps) {
  const inbox = useQuery(messageInboxQueryOptions(workspaceId))
  const detailRef = useRef<HTMLElement>(null)
  const navigate = useNavigate()
  const selection = selectDetail({
    inbox: inbox.data,
    threadId,
    bundleId,
    invalidPath,
    composing: composing && viewer.role === 'pm',
  })
  const selectedThreadId = selection.kind === 'thread' ? selection.threadId : null
  // 정리 중 토스트(#424)는 이 화면에서 대화 영역 오른쪽 아래에 앉는다 (#474). 대화 아래 고정 줄(답장·안내)이 있으면 그 위 16,
  // 없으면 영역 아래 24 다. 상세의 스크롤 칸은 끝에 여백을 둬 마지막 내용이 토스트 위 16 까지 올라오게 한다
  const [floor, setFloor] = useState<HTMLElement | null>(null)
  const [floorHeight, setFloorHeight] = useState(0)
  const [toastHeight, setToastHeight] = useState(0)
  useLayoutEffect(() => {
    if (floor === null || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => setFloorHeight(floor.getBoundingClientRect().height))
    observer.observe(floor)
    return () => observer.disconnect()
  }, [floor])
  // 768 미만은 대화 영역이 좁아 토스트가 목록을 덮는다 — 그때는 뷰포트 오른쪽 아래 독에 그대로 둔다 (#474, 좁은 배치는 #478)
  const wide = useSyncExternalStore(subscribeWide, isWide, () => false)
  const toastOffset = floor === null ? 24 : 16
  const toastBottom = (floor === null ? 0 : floorHeight) + toastOffset
  const toastClearance = wide && toastHeight > 0 ? toastHeight + toastOffset + 16 : 0

  // 볼 것이 없다 — EmptyMessages 캔버스 한 장. 팀원은 받은 대화가 없을 때, PM 은 보낼 메시지와 대화가 모두 없을 때.
  // `알림 규칙 보기` 화면은 아직 없어 가장 가까운 팀 설정으로 보낸다 (결과 문서 C 의 차이표).
  // 재촉을 만드는 중이면 가로채지 않는다 — 빈 화면에서 `새 재촉 만들기` 로 온 곳이다
  if (
    threadId === null &&
    !invalidPath &&
    selection.kind !== 'compose' &&
    inbox.data !== undefined &&
    inbox.data.threads.length === 0 &&
    (inbox.data.viewer === 'member' || inbox.data.bundles.length === 0)
  )
    return (
      <main className={EMPTY_PAGE}>
        {inbox.data.viewer === 'pm' ? (
          <EmptyState
            title="보낼 메시지가 없어요"
            description="마감이 다가오면 담당자에게 보낼 DM을 여기에 준비해 둘게요. 승인해야 나가요."
            action={
              <div className="flex flex-wrap items-center justify-center gap-10">
                <GuardedLink to={paths.settings(workspaceId)} className={EMPTY_ACTION}>
                  알림 규칙 보기
                </GuardedLink>
                <GuardedLink to={paths.messageCompose(workspaceId)} className={EMPTY_SECOND_ACTION}>
                  새 재촉 만들기
                </GuardedLink>
              </div>
            }
          />
        ) : (
          <EmptyState
            title="받은 메시지가 없어요"
            description={`${botName} 봇이 메시지를 보내면 여기에서 보고 답장할 수 있어요.`}
          />
        )}
      </main>
    )

  let detail
  if (selection.kind === 'invalid') detail = <ThreadUnavailable />
  else if (selection.kind === 'thread')
    // 대화가 바뀌면 상세를 새로 마운트한다 — 이전 대화의 스크롤 자리를 들고 있지 않는다
    detail = (
      <ThreadDetail
        key={selection.threadId}
        workspaceId={workspaceId}
        threadId={selection.threadId}
        botName={botName}
        viewer={viewer}
        floorRef={setFloor}
        toastClearance={toastClearance}
      />
    )
  else if (selection.kind === 'bundle')
    // 묶음이 바뀌면 고쳐 쓰던 문구·직접 정하던 시각을 들고 가지 않는다
    detail = (
      <ReviewDetail
        key={selection.bundle.id}
        workspaceId={workspaceId}
        botName={botName}
        bundle={selection.bundle}
        toastClearance={toastClearance}
        onSettled={() => detailRef.current?.focus()}
      />
    )
  else if (selection.kind === 'compose')
    detail = (
      <ComposeDetail
        workspaceId={workspaceId}
        toastClearance={toastClearance}
        onCreated={(bundleId) => {
          // 만든 묶음을 고른다. 뒤로 가기로 만들기 칸에 돌아가지 않게 주소를 바꿔 끼운다
          detailRef.current?.focus()
          void navigate(paths.messageReview(workspaceId, bundleId), { replace: true })
        }}
        onCancel={() => void navigate(paths.messages(workspaceId), { replace: true })}
      />
    )
  else if (selection.kind === 'loading') detail = inbox.error === null ? <ReviewSkeleton /> : null
  else detail = <p className={EMPTY_DETAIL}>왼쪽 목록에서 확인할 메시지나 대화를 골라 주세요.</p>

  return (
    <main className={SCREEN}>
      <aside aria-label="메시지 목록" className={ASIDE}>
        <div className="flex items-center justify-between gap-8 pr-4">
          <h1 className={ASIDE_TITLE}>메시지</h1>
          {viewer.role === 'pm' ? (
            <GuardedLink
              to={paths.messageCompose(workspaceId)}
              end
              aria-current={selection.kind === 'compose' ? 'page' : 'false'}
              className={COMPOSE_LINK}
            >
              새 재촉
            </GuardedLink>
          ) : null}
        </div>
        {inbox.data !== undefined ? (
          <InboxList
            workspaceId={workspaceId}
            botName={botName}
            inbox={inbox.data}
            viewer={viewer}
            threadId={selectedThreadId}
            bundleId={selection.kind === 'bundle' ? selection.bundle.id : null}
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
        {/* 상세 칸이 바뀌어도 자리는 그대로다 — 토스트가 다시 마운트되지 않아 접힘이 유지된다 */}
        {wide ? (
          <PinnedToastHost
            className="absolute right-24 z-10"
            style={{ bottom: toastBottom }}
            onHeightChange={setToastHeight}
          />
        ) : null}
      </section>
    </main>
  )
}

const WIDE = '(min-width: 768px)'

function subscribeWide(onStoreChange: () => void): () => void {
  if (typeof window.matchMedia !== 'function') return () => {}
  const query = window.matchMedia(WIDE)
  query.addEventListener('change', onStoreChange)
  return () => query.removeEventListener('change', onStoreChange)
}

function isWide(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(WIDE).matches
}

function InboxList({
  workspaceId,
  botName,
  inbox,
  viewer,
  threadId,
  bundleId,
}: {
  workspaceId: string
  botName: string
  inbox: Inbox
  viewer: MessageViewer
  threadId: string | null
  bundleId: string | null
}) {
  const rows = inbox.threads.map((thread) => ({
    thread,
    policy: threadPolicy(viewer, thread.memberId),
  }))
  const selfRows = rows.filter(({ policy }) => policy.section === 'self')
  const threadRows = rows.filter(({ policy }) => policy.section === 'threads')
  const awaiting = threadRows.filter(
    ({ thread, policy }) => policy.awaiting && thread.awaitingReplySince !== null,
  ).length
  const threadList = (list: typeof rows) => (
    <ul className="flex flex-col gap-4">
      {list.map(({ thread, policy }) => (
        <li key={thread.id}>
          <ThreadRow
            workspaceId={workspaceId}
            botName={botName}
            thread={thread}
            policy={policy}
            selected={thread.id === threadId}
          />
        </li>
      ))}
    </ul>
  )
  return (
    <>
      {selfRows.length === 0 ? null : (
        <section aria-labelledby="messages-self" className="flex flex-col gap-4">
          <h2 id="messages-self" className={`${GROUP_LABEL} px-8`}>
            {SELF_SECTION_TITLE}
          </h2>
          {threadList(selfRows)}
        </section>
      )}
      {inbox.viewer === 'pm' ? (
        <section aria-labelledby="messages-reviews" className="flex flex-col gap-6">
          <h2 id="messages-reviews" className={`${GROUP_LABEL} px-8`}>
            보내기 전 확인 {inbox.bundles.length}
          </h2>
          {inbox.bundles.length === 0 ? (
            <p className={GROUP_NOTE}>지금 확인할 메시지가 없어요.</p>
          ) : (
            <ul className="flex flex-col gap-6">
              {inbox.bundles.map((bundle) => (
                <li key={bundle.id}>
                  <BundleRow
                    workspaceId={workspaceId}
                    bundle={bundle}
                    selected={bundle.id === bundleId}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
      <section aria-labelledby="messages-threads" className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-8 px-8">
          <h2 id="messages-threads" className={GROUP_LABEL}>
            대화
          </h2>
          {awaiting === 0 ? null : (
            <span className="text-[10.5px] text-dim">답장 기다리는 중 {awaiting}</span>
          )}
        </div>
        {threadRows.length === 0 ? (
          <p className={GROUP_NOTE}>아직 주고받은 대화가 없어요.</p>
        ) : (
          threadList(threadRows)
        )}
      </section>
    </>
  )
}

/*
 * 행은 GuardedLink(NavLink)다. NavLink 는 주소가 맞으면 스스로 aria-current 를 단다 — 묶음 행은 모두 `/messages` 라
 * 검색 파라미터를 보지 않는 NavLink 에는 전부 맞는다. 그래서 `end` 로 대화 경로에서는 꺼 두고, 고른 행만 `page` 로 준다
 */
function BundleRow({
  workspaceId,
  bundle,
  selected,
}: {
  workspaceId: string
  bundle: Bundle
  selected: boolean
}) {
  return (
    <GuardedLink
      to={paths.messageReview(workspaceId, bundle.id)}
      end
      aria-current={selected ? 'page' : 'false'}
      className={REVIEW_ROW}
    >
      <span className="flex w-full items-center gap-9">
        <span aria-hidden="true" className={`${AVATAR} size-24 text-[10px]`}>
          {avatarText(bundle.recipientName)}
        </span>
        <span className={REVIEW_NAME}>{bundle.recipientName}</span>
        <span className={DATE}>{bundleDateLabel(bundle)}</span>
      </span>
      <span className={REVIEW_SUMMARY}>{bundleSummary(bundle)}</span>
    </GuardedLink>
  )
}

function ThreadRow({
  workspaceId,
  botName,
  thread,
  policy,
  selected,
}: {
  workspaceId: string
  botName: string
  thread: MessageThreadSummary
  policy: ThreadPolicy
  selected: boolean
}) {
  const title = policy.ownSender === 'member' ? `${botName} 봇` : thread.name
  const queryClient = useQueryClient()
  const last = thread.lastMessage
  /* 고르기 직전(가리키기·포커스)에 그 대화를 미리 받는다 — 고른 뒤 스켈레톤 없이 바로 그린다 (회의록 목록의 prefetchMinutes 와 같은 방식).
     ThreadDetail 과 같은 Query 라 staleTime(앱 기본) 안에는 다시 받지 않는다. 실패는 prefetchQuery 가 삼킨다 — 고르면 ThreadDetail 이
     같은 Query 로 다시 묻고 그 오류를 그린다. 열린 대화는 ThreadDetail 이 이미 받고 있어 건너뛴다.
     보낼 메시지는 목록 응답에 상세가 다 있어 미리 받을 것이 없다 */
  const prefetch = selected
    ? undefined
    : () => void queryClient.prefetchQuery(messageThreadQueryOptions(workspaceId, thread.id))
  return (
    <GuardedLink
      to={paths.messageThread(workspaceId, thread.id)}
      aria-current={selected ? 'page' : 'false'}
      className={THREAD_ROW}
      onPointerEnter={prefetch}
      onFocus={prefetch}
    >
      <span
        aria-hidden="true"
        className={`${AVATAR} size-30 text-[11px] group-aria-[current=page]:bg-ink group-aria-[current=page]:text-surface`}
      >
        {avatarText(title)}
      </span>
      <span className="flex min-w-[0px] flex-1 flex-col gap-1">
        <span className="flex flex-wrap items-center gap-6">
          <span className="text-control leading-[1.75] font-semibold wrap-anywhere text-ink">
            {title}
          </span>
          {thread.dmFailed ? <span className={DM_FAILED_CHIP}>DM 못 보냄</span> : null}
        </span>
        {last === null ? null : (
          <span className="truncate text-meta leading-[1.5] text-dim">
            {last.sender === policy.ownSender ? `나: ${last.body}` : last.body}
          </span>
        )}
      </span>
      <span className="flex shrink-0 flex-col items-end gap-4">
        {last === null ? null : <span className={DATE}>{shortDate(last.createdAt)}</span>}
        {policy.awaiting && thread.awaitingReplySince !== null ? (
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
