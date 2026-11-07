import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useLayoutEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { messageInboxQueryOptions, messageThreadQueryOptions } from '@/entities/message'
import type { Bundle, MessageInbox as Inbox, MessageThreadSummary } from '@/entities/message'
import { paths } from '@/shared/config/routes'
import {
  useCompactScreen,
  useHideShellChrome,
  useVisibleViewport,
} from '@/shared/lib/compact-screen'
import { useLoadingIndicator } from '@/shared/lib/loading-indicator'
import { GuardedLink } from '@/shared/lib/unsaved-changes'
import { Reveal } from '@/shared/ui/deferred-skeleton'
import { EmptyState } from '@/shared/ui/empty-state'
import { Icon } from '@/shared/ui/icon'
import { QueryErrorState } from '@/shared/ui/query-error-state'
import { PinnedToastHost } from '@/shared/ui/toast'
import { avatarText, bundleDateLabel, bundleSummary, shortDate } from '../lib/format'
import { threadHeading } from '../model/conversation'
import { inboxPane, nextPaneMemory, selectDetail } from '../model/selection'
import type { DetailSelection, InboxPane, PaneMemory } from '../model/selection'
import { SELF_SECTION_TITLE, threadPolicy } from '../model/viewer'
import type { MessageViewer, ThreadPolicy } from '../model/viewer'
import { ComposeDetail } from './ComposeDetail'
import { DetailBar } from './DetailBar'
import { GROUP_LABEL } from './listStyles'
import { InboxListSkeleton, ReviewSkeleton, ThreadSkeleton } from './MessageSkeletons'
import { ReviewDetail } from './ReviewDetail'
import { ThreadDetail, ThreadUnavailable } from './ThreadDetail'

/* Messages 캔버스 실측 — 왼쪽 목록 308(위 18 · 좌우 12 · 아래 24, 영역 사이 18) · 오른쪽 선, 목록 제목 17px.
   화면 높이를 헤더 아래로 묶고 목록과 상세가 각자 세로로 스크롤한다 (D-124, 계획 C-6 6단계).
   스크롤 칸은 relative 다 — 안의 sr-only 글자(absolute)가 칸 밖 문서 높이를 늘려 페이지가 스크롤되지 않게 한다.
   768 미만(H-4·H-5)은 목록과 상세 중 하나만 화면 전체로 그린다. 목록은 휴대폰 헤더(56 + 위 안전 영역)와 아래 탭 막대 사이,
   상세는 셸 헤더·탭 막대를 걷은 화면 전체다. 셸의 아래 여백(탭 막대)과 더해 바깥 페이지가 스크롤하지 않는다 */
const SCREEN: Record<InboxPane, string> = {
  both: 'flex h-[calc(100dvh-var(--spacing-header))] items-stretch',
  list: 'flex h-[calc(100dvh-(56px+env(safe-area-inset-top)+var(--bottom-tab-bar)))] items-stretch',
  detail: 'flex h-dvh items-stretch',
}
const ASIDE: Record<InboxPane, string> = {
  both: 'relative flex w-aside shrink-0 flex-col gap-18 overflow-y-auto border-r border-divider px-12 pt-18 pb-24',
  list: 'relative flex w-full flex-col gap-18 overflow-y-auto pt-8 pr-[max(12px,env(safe-area-inset-right))] pb-24 pl-[max(12px,env(safe-area-inset-left))]',
  detail: '',
}
const ASIDE_TITLE: Record<InboxPane, string> = {
  both: 'px-8 text-[17px] leading-[1.55] font-bold tracking-h2 text-ink',
  list: 'px-8 text-[24px] leading-[1.4] font-bold tracking-h2 text-ink',
  detail: '',
}
const DETAIL = 'relative flex min-w-[0px] flex-1 flex-col'
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
  'shrink-0 rounded-9 px-10 py-4 text-caption font-semibold text-sub hover:bg-surface-sunken hover:text-ink aria-[current=page]:bg-surface-selected aria-[current=page]:text-ink max-md:inline-flex max-md:min-h-44 max-md:items-center max-md:px-14 max-md:text-body'
const BACK = 'grid size-44 place-items-center rounded-12 text-ink hover:bg-surface-sunken'
/* 휴대폰 목록의 정리 중 토스트 — 셸 독과 같은 자리(오른쪽 24, 아래 탭 막대 위 24). 독 대신 이 자리를 잡아 셸의 아래 여백이 생기지 않는다 */
const LIST_TOAST = 'fixed right-24 bottom-[calc(24px+var(--bottom-tab-bar))] z-10'

/** 휴대폰 목록 화면에서 연 상세라는 표식. 있으면 뒤로 가기가 브라우저 뒤로 가기와 같다 — 기록 한 칸 뒤가 그 목록이다.
    넓은 화면의 두 단에서 고른 항목에는 붙이지 않는다 — 그 한 칸 뒤는 목록이 아니라 이전 상세다 */
const FROM_LIST = { messagesList: true } as const

function openedFromList(state: unknown): boolean {
  return typeof state === 'object' && state !== null && 'messagesList' in state
}

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
  const location = useLocation()
  const canCompose = composing && viewer.role === 'pm'
  const selection = selectDetail({
    inbox: inbox.data,
    threadId,
    bundleId,
    invalidPath,
    composing: canCompose,
  })
  // 목록과, 목록을 받아야 고를 수 있는 상세의 로딩 자리 (#508). 상세는 목록을 받은 뒤 고른 항목이 제 조회를 한다
  const listIndicator = useLoadingIndicator(inbox.data === undefined && inbox.error === null)
  const detailIndicator = useLoadingIndicator(selection.kind === 'loading' && inbox.error === null)
  const pane = inboxPane({
    compact: useCompactScreen(),
    threadId,
    bundleId,
    invalidPath,
    composing: canCompose,
  })
  // 볼 것이 없다 — EmptyMessages 캔버스 한 장. 팀원은 받은 대화가 없을 때, PM 은 보낼 메시지와 대화가 모두 없을 때.
  // 재촉을 만드는 중이면 가로채지 않는다 — 빈 화면에서 `새 재촉 만들기` 로 온 곳이다
  const nothing =
    threadId === null &&
    !invalidPath &&
    selection.kind !== 'compose' &&
    inbox.data !== undefined &&
    !listIndicator.pending &&
    inbox.data.threads.length === 0 &&
    (inbox.data.viewer === 'member' || inbox.data.bundles.length === 0)
  useHideShellChrome(pane === 'detail' && !nothing)
  // 휴대폰 목록은 폭만 줄여 왔을 때만 상세를 숨겨 들고 있다. 이동으로 왔으면 그리지 않는다 (PaneMemory)
  const [memory, setMemory] = useState<PaneMemory>(() => ({
    pane,
    locationKey: location.key,
    keep: false,
    epoch: 0,
  }))
  const nextMemory = nextPaneMemory(memory, pane, location.key)
  if (nextMemory !== memory) setMemory(nextMemory)
  const detailMounted = pane !== 'list' || nextMemory.keep
  const epoch = nextMemory.epoch
  // 가상 키보드가 보이는 영역을 줄이면(iOS) 상세를 그 영역에 맞춘다 — 머리와 답장 줄이 키보드 위에 함께 남는다
  const visible = useVisibleViewport(pane === 'detail')
  // 목록 → 상세는 상세 머리 제목으로, 상세 → 목록은 누른 행(없으면 목록 제목)으로 포커스를 옮긴다
  const asideRef = useRef<HTMLElement>(null)
  const listTitleRef = useRef<HTMLHeadingElement>(null)
  const barTitleRef = useRef<HTMLElement | null>(null)
  const href = location.pathname + location.search
  const shown = useRef({ pane, href })
  useLayoutEffect(() => {
    const before = shown.current
    shown.current = { pane, href }
    if (before.pane === 'list' && pane === 'detail') barTitleRef.current?.focus()
    else if (before.pane === 'detail' && pane === 'list') {
      const rows = asideRef.current?.querySelectorAll('a') ?? []
      const row = Array.from(rows).find((link) => link.getAttribute('href') === before.href)
      ;(row ?? listTitleRef.current)?.focus()
    }
  }, [pane, href])
  // 휴대폰 목록에서는 아무것도 고르지 않았다 — 넓은 화면이 대신 고른 첫 항목을 표시하지 않는다
  const highlighted = pane === 'list' ? null : selection
  // 정리 중 토스트(#424)는 이 화면에서 대화 영역 오른쪽 아래에 앉는다 (#474). 대화 아래 고정 줄(답장·안내)이 있으면 그 위 16,
  // 없으면 영역 아래 24 다. 상세의 스크롤 칸은 끝에 여백을 둬 마지막 내용이 토스트 위 16 까지 올라오게 한다.
  // 휴대폰 목록은 셸 독과 같은 자리에 두고, 목록 끝을 토스트 높이 + 24 + 16 만큼 비워 마지막 행까지 꺼낸다 (#478)
  const [floor, setFloor] = useState<HTMLElement | null>(null)
  const [floorHeight, setFloorHeight] = useState(0)
  const [toastHeight, setToastHeight] = useState(0)
  useLayoutEffect(() => {
    if (floor === null || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => setFloorHeight(floor.getBoundingClientRect().height))
    observer.observe(floor)
    return () => observer.disconnect()
  }, [floor])
  const toastOffset = floor === null ? 24 : 16
  const toastBottom = (floor === null ? 0 : floorHeight) + toastOffset
  const toastClearance = pane !== 'list' && toastHeight > 0 ? toastHeight + toastOffset + 16 : 0
  const listClearance = pane === 'list' && toastHeight > 0 ? toastHeight + 24 + 16 : 0

  // `알림 규칙 보기` 화면은 아직 없어 가장 가까운 팀 설정으로 보낸다 (결과 문서 C 의 차이표)
  if (nothing)
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
  // 목록을 받아야 고를 수 있는 상세 — 묶음을 가리키거나 PM 의 기본 선택(보낼 메시지)이면 검토 모양, 팀원의 기본 선택은 대화 모양이다
  if (detailIndicator.pending)
    detail =
      bundleId === null && viewer.role !== 'pm' ? (
        <ThreadSkeleton indicator={detailIndicator} />
      ) : (
        <ReviewSkeleton indicator={detailIndicator} />
      )
  else if (selection.kind === 'invalid') detail = <ThreadUnavailable />
  else if (selection.kind === 'thread')
    // 대화가 바뀌면 상세를 새로 마운트한다 — 이전 대화의 스크롤 자리를 들고 있지 않는다
    detail = (
      <ThreadDetail
        key={`${selection.threadId}:${epoch}`}
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
        key={`${selection.bundle.id}:${epoch}`}
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
        key={`compose:${epoch}`}
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
  else if (selection.kind === 'loading') detail = null
  else detail = <p className={EMPTY_DETAIL}>왼쪽 목록에서 확인할 메시지나 대화를 골라 주세요.</p>
  if (!detailIndicator.pending) detail = <Reveal indicator={detailIndicator}>{detail}</Reveal>

  // 목록에서 열었으면 기록 한 칸 뒤가 그 목록이다 — 브라우저 뒤로 가기와 같게 기록을 되돌린다.
  // 주소로 바로 들어왔으면 목록으로 바꿔 끼운다. 쓰던 답장이 있으면 어느 쪽이든 이탈 확인이 먼저 묻는다
  const fromList = openedFromList(location.state)
  const heading = detailHeading(selection, inbox.data, viewer, botName)

  return (
    <main
      className={SCREEN[pane]}
      style={
        visible === null
          ? undefined
          : { position: 'fixed', insetInline: 0, top: visible.top, height: visible.height }
      }
    >
      <aside
        ref={asideRef}
        aria-label="메시지 목록"
        hidden={pane === 'detail'}
        className={ASIDE[pane]}
        style={listClearance > 24 ? { paddingBottom: listClearance } : undefined}
      >
        <div className="flex items-center justify-between gap-8 pr-4">
          <h1
            ref={listTitleRef}
            tabIndex={pane === 'list' ? -1 : undefined}
            className={ASIDE_TITLE[pane]}
          >
            메시지
          </h1>
          {viewer.role === 'pm' ? (
            <GuardedLink
              to={paths.messageCompose(workspaceId)}
              state={pane === 'list' ? FROM_LIST : undefined}
              end
              aria-current={highlighted?.kind === 'compose' ? 'page' : 'false'}
              className={COMPOSE_LINK}
            >
              새 재촉
            </GuardedLink>
          ) : null}
        </div>
        {listIndicator.pending ? (
          <InboxListSkeleton indicator={listIndicator} pm={viewer.role === 'pm'} />
        ) : inbox.data !== undefined ? (
          <Reveal indicator={listIndicator}>
            <InboxList
              workspaceId={workspaceId}
              botName={botName}
              inbox={inbox.data}
              viewer={viewer}
              threadId={highlighted?.kind === 'thread' ? highlighted.threadId : null}
              bundleId={highlighted?.kind === 'bundle' ? highlighted.bundle.id : null}
              openState={pane === 'list' ? FROM_LIST : undefined}
            />
          </Reveal>
        ) : (
          // 목록 오류는 목록 칸에만 알린다. 고른 대화는 따로 받아 그대로 보인다
          <Reveal indicator={listIndicator}>
            <div className="px-8">
              <QueryErrorState
                error={inbox.error}
                onRetry={() => void inbox.refetch()}
                title="메시지 목록을 불러오지 못했어요"
              />
            </div>
          </Reveal>
        )}
      </aside>
      {/* 처리한 항목이 버튼째 사라지면 포커스를 이 칸이 받는다 — 다음 Tab 이 새로 골라진 항목으로 간다.
          휴대폰 목록에서도 상세를 내리지 않고 숨긴다 — 768 을 넘나들어도 쓰던 답장·문구가 남는다 */}
      <section
        ref={detailRef}
        aria-label="메시지 내용"
        tabIndex={-1}
        hidden={pane === 'list'}
        className={DETAIL}
      >
        {pane === 'detail' ? (
          <DetailBar
            back={
              <GuardedLink
                to={paths.messages(workspaceId)}
                replace
                aria-current="false"
                aria-label="메시지 목록으로"
                className={BACK}
                onClick={(event) => {
                  if (!fromList) return
                  event.preventDefault()
                  void navigate(-1)
                }}
              >
                <Icon name="chevron-left" size={22} />
              </GuardedLink>
            }
            title={heading.title}
            subtitle={heading.subtitle}
            titleAs={selection.kind === 'thread' ? 'h2' : 'p'}
            titleRef={(element) => {
              barTitleRef.current = element
            }}
          />
        ) : null}
        {detailMounted ? detail : null}
        {/* 상세 칸이 바뀌어도 자리는 그대로다 — 토스트가 다시 마운트되지 않아 접힘이 유지된다 */}
        {pane === 'list' ? null : (
          <PinnedToastHost
            className="absolute right-24 z-10"
            style={{ bottom: toastBottom }}
            onHeightChange={setToastHeight}
          />
        )}
      </section>
      {pane === 'list' ? (
        <PinnedToastHost className={LIST_TOAST} onHeightChange={setToastHeight} />
      ) : null}
    </main>
  )
}

/** 휴대폰 상세 머리의 제목. 대화는 목록 행과 같은 이름이고, 목록이 아직 없으면 `대화` 다 */
function detailHeading(
  selection: DetailSelection,
  inbox: Inbox | undefined,
  viewer: MessageViewer,
  botName: string,
): { title: string; subtitle: string | null } {
  if (selection.kind === 'thread') {
    const summary = inbox?.threads.find(({ id }) => id === selection.threadId)
    if (summary === undefined) return { title: '대화', subtitle: null }
    return threadHeading(summary.name, threadPolicy(viewer, summary.memberId), botName)
  }
  if (selection.kind === 'bundle')
    return { title: selection.bundle.recipientName, subtitle: '보내기 전 확인' }
  if (selection.kind === 'compose') return { title: '새 재촉', subtitle: null }
  return { title: '메시지', subtitle: null }
}

function InboxList({
  workspaceId,
  botName,
  inbox,
  viewer,
  threadId,
  bundleId,
  openState,
}: {
  workspaceId: string
  botName: string
  inbox: Inbox
  viewer: MessageViewer
  threadId: string | null
  bundleId: string | null
  /** 행을 누를 때 기록 항목에 남길 표식. 휴대폰 목록 화면에서만 있다 */
  openState: typeof FROM_LIST | undefined
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
            openState={openState}
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
                    openState={openState}
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
  openState,
}: {
  workspaceId: string
  bundle: Bundle
  selected: boolean
  openState: typeof FROM_LIST | undefined
}) {
  return (
    <GuardedLink
      to={paths.messageReview(workspaceId, bundle.id)}
      state={openState}
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
  openState,
}: {
  workspaceId: string
  botName: string
  thread: MessageThreadSummary
  policy: ThreadPolicy
  selected: boolean
  openState: typeof FROM_LIST | undefined
}) {
  const { title } = threadHeading(thread.name, policy, botName)
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
      state={openState}
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
