import { useQuery } from '@tanstack/react-query'
import { useId, useLayoutEffect, useRef, useState } from 'react'
import { messageThreadQueryOptions } from '@/entities/message'
import type { MessageThread } from '@/entities/message'
import { ApiError } from '@/shared/api/errors'
import { paths } from '@/shared/config/routes'
import { now as clockNow, todayInSeoul } from '@/shared/lib/date'
import { GuardedLink } from '@/shared/lib/unsaved-changes'
import { EmptyState } from '@/shared/ui/empty-state'
import { Icon } from '@/shared/ui/icon'
import { QueryErrorState } from '@/shared/ui/query-error-state'
import { buildConversation } from '../model/conversation'
import type { BubbleItem } from '../model/conversation'
import { VIEWER_POLICY } from '../model/viewer'
import type { MessageViewer } from '../model/viewer'
import { ThreadSkeleton } from './MessageSkeletons'
import { ReplyForm } from './ReplyForm'

/* MessagesThread 캔버스 실측 — 머리 76(좌우 28, 아래 선), 대화 칸 눌린 면(위 24 · 좌우 28 · 아래 18, 간격 16),
   봇 말풍선 먹 면 최대 438 · 상대 말풍선 흰 면 선 최대 410, 둘 다 라운드 15 에 꼬리 쪽만 4,
   아직 나가지 않은 말풍선은 흰 면 점선(`border-dashed` 한 이름이 모양과 색을 낸다). 본문은 줄바꿈을 그대로 보인다(`whitespace-pre-line`).
   아래 안내 바(위 선 · 위 14 · 좌우 28 · 아래 20, 안쪽 카드 라운드 14).
   대화 칸은 relative 다 — 말풍선의 sr-only 보낸 쪽 글자가 칸 밖으로 새어 페이지를 늘리지 않게 한다.
   말풍선·안내 바의 글자는 띄어 쓰지 않은 긴 글자(주소, 전역 `keep-all` 의 긴 한글)도 줄을 바꾼다(`wrap-anywhere`) —
   최대 폭을 넘어 대화 칸이 가로로 스크롤되지 않게 한다. 머리의 이름·부제는 높이가 정해진 한 줄이라 말줄임 그대로다 */
const HEAD =
  'flex h-header shrink-0 items-center justify-between gap-16 border-b border-divider px-28'
const AVATAR =
  'inline-flex shrink-0 items-center justify-center rounded-999 bg-divider font-semibold text-ink'
/* 강조색 면 흰 글자 — 지금 봐야 하는 위험 배지 (디자인 시스템 강조색) */
const WAITING_BADGE =
  'inline-flex h-22 shrink-0 items-center rounded-6 bg-accent px-9 text-meta leading-none font-semibold text-surface'
const BODY =
  'relative flex min-h-[0px] flex-1 flex-col gap-16 overflow-y-auto bg-surface-sunken px-28 pt-24 pb-18'
const DAY_RULE = 'h-1 flex-1 bg-line'
const BUBBLE = 'px-15 py-12 text-body leading-[1.75] wrap-anywhere whitespace-pre-line'
const BOT_BUBBLE = `${BUBBLE} max-w-[438px] rounded-[15px_15px_4px_15px] bg-ink text-surface`
const UPCOMING_BUBBLE = `${BUBBLE} max-w-[438px] rounded-[15px_15px_4px_15px] border border-dashed bg-surface text-sub`
const COUNTERPART_BUBBLE = `${BUBBLE} max-w-[410px] rounded-[15px_15px_15px_4px] border border-line bg-surface text-ink`
const TIME = 'mono text-[10.5px] text-dim'
/* DM 못 보냄 — 웹 대화에는 들어갔지만 Discord 로는 가지 않았다. 강조색 글자로 시각 줄보다 앞에 둔다 */
const DM_FAILED = 'text-meta font-semibold text-accent'
const DRAFTING = 'text-meta text-sub'
const WAITING_NOTE =
  'inline-flex items-center gap-7 self-center rounded-999 bg-divider px-13 py-7 text-meta text-sub'
const FOOT = 'shrink-0 border-t border-divider px-28 pt-14 pb-20'
const FOOT_CARD =
  'flex items-center gap-12 rounded-[14px] border border-line bg-surface px-14 py-12 text-dim'
const FOOT_LINK =
  'inline-flex h-32 shrink-0 items-center gap-3 px-4 text-caption font-semibold text-ink hover:text-sub'

/**
 * 팀원 한 명과의 대화 — MessagesThread 시안. 목록과 따로 받는다 — 목록 오류가 대화를 막지 않는다 (계획 C-6 5단계).
 * PM 에게는 아직 나가지 않은 보낼 메시지(묶음)가 나갈 시각 자리에 점선 말풍선으로 섞인다. 승인·고치기·보내지 않음은 그 말풍선의
 * `확인하기` 가 여는 보내기 전 확인에서만 한다
 */
export function ThreadDetail({
  workspaceId,
  threadId,
  botName,
  viewer,
}: {
  workspaceId: string
  threadId: string
  botName: string
  viewer: MessageViewer
}) {
  const thread = useQuery(messageThreadQueryOptions(workspaceId, threadId))
  if (thread.data !== undefined)
    return (
      <ThreadView
        workspaceId={workspaceId}
        botName={botName}
        thread={thread.data}
        viewer={viewer}
      />
    )
  if (thread.error === null) return <ThreadSkeleton />
  // 없는 대화와 볼 수 없는 남의 대화는 다시 받아도 같다 — 다시 시도 대신 찾을 수 없다고 알린다
  if (
    thread.error instanceof ApiError &&
    (thread.error.status === 404 || thread.error.status === 403)
  )
    return <ThreadUnavailable />
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
  viewer,
}: {
  workspaceId: string
  botName: string
  thread: MessageThread
  viewer: MessageViewer
}) {
  const bodyRef = useRef<HTMLElement>(null)
  // 자기 답장을 보내기 직전의 메시지 수. 그 답장이 그려진 뒤에만 그 줄로 내리고, 다른 갱신에는 자리를 움직이지 않는다
  const replyAnchor = useRef<number | null>(null)
  const [replyTick, setReplyTick] = useState(0)
  const [now] = useState(clockNow)
  // 대화를 열면 가장 최근 메시지부터 보인다. 대화가 바뀌면 화면이 새로 마운트된다 (MessageInbox 의 key)
  useLayoutEffect(() => {
    const body = bodyRef.current
    if (body !== null) body.scrollTop = body.scrollHeight
  }, [])
  useLayoutEffect(() => {
    const anchor = replyAnchor.current
    const body = bodyRef.current
    if (anchor === null || body === null || thread.messages.length <= anchor) return
    body.scrollTop = body.scrollHeight
    replyAnchor.current = null
  }, [replyTick, thread])
  const today = todayInSeoul()
  const policy = VIEWER_POLICY[viewer]
  const view = buildConversation(thread, { policy, botName, today, now })
  const waitingDays = view.waitingDays

  return (
    <div className="flex min-h-[0px] flex-1 flex-col">
      <div className={HEAD}>
        <div className="flex min-w-[0px] items-center gap-11">
          <span aria-hidden="true" className={`${AVATAR} size-34 text-[12px]`}>
            {view.avatar}
          </span>
          <div className="flex min-w-[0px] flex-col gap-2">
            <h2 className="truncate text-[15px] leading-[1.4] font-semibold tracking-h3 text-ink">
              {view.title}
            </h2>
            <p className="truncate text-meta leading-[1.4] text-dim">{view.subtitle}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-12">
          {waitingDays === null ? null : (
            <span className={WAITING_BADGE}>답장 {waitingDays}일째 없음</span>
          )}
        </div>
      </div>
      {/* 스크롤 칸이라 키보드로도 내릴 수 있게 Tab 자리를 준다 (WCAG 2.1.1) */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
      <section ref={bodyRef} aria-label="대화 내용" tabIndex={0} className={BODY}>
        {view.days.length === 0 ? (
          <p className="self-center pt-24 text-body text-dim">아직 주고받은 메시지가 없어요.</p>
        ) : null}
        {view.days.map((day) => (
          <div key={day.date ?? ''}>
            {day.date === null ? null : <DayDivider label={day.label} />}
            <ol className="flex flex-col gap-16 pt-16">
              {day.items.map((item) =>
                item.kind === 'waiting' ? (
                  <li key={item.id} className="flex justify-center">
                    <p className={WAITING_NOTE}>
                      <Icon name="clock" size={13} />
                      여기서부터 답장이 없습니다 — 오늘로 {item.days}일째예요
                    </p>
                  </li>
                ) : (
                  <li key={item.id}>
                    <Bubble workspaceId={workspaceId} item={item} />
                  </li>
                ),
              )}
            </ol>
          </div>
        ))}
      </section>
      {policy.foot === 'reply' ? (
        <div className={FOOT}>
          <ReplyForm
            workspaceId={workspaceId}
            threadId={thread.id}
            botName={botName}
            onSent={() => {
              replyAnchor.current = thread.messages.length
              setReplyTick((tick) => tick + 1)
            }}
          />
        </div>
      ) : (
        <ThreadNotice botName={botName} />
      )}
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

const BUBBLE_CLASS = {
  own: BOT_BUBBLE,
  other: COUNTERPART_BUBBLE,
  upcoming: UPCOMING_BUBBLE,
} as const

/** 보낸 쪽은 자리와 면으로, 화면 읽기에는 숨긴 글자로 구분한다 — 색에만 기대지 않는다 (D-128) */
function Bubble({ workspaceId, item }: { workspaceId: string; item: BubbleItem }) {
  const timeId = useId()
  const column = (
    <div
      className={
        item.side === 'own' ? 'flex flex-col items-end gap-8' : 'flex flex-col items-start gap-5'
      }
    >
      <p className={BUBBLE_CLASS[item.look]}>
        <span className="sr-only">{item.speaker}: </span>
        {item.body}
      </p>
      {item.dmFailure === null ? null : <p className={DM_FAILED}>{item.dmFailure}</p>}
      {item.drafting ? <p className={DRAFTING}>문구 다듬는 중</p> : null}
      <span id={timeId} className={TIME}>
        {item.timeLine}
      </span>
      {item.bundleId === null ? null : (
        <GuardedLink
          to={paths.messageReview(workspaceId, item.bundleId)}
          aria-describedby={timeId}
          className={FOOT_LINK}
        >
          확인하기
        </GuardedLink>
      )}
    </div>
  )
  if (item.side === 'own' || item.avatar === null) return column
  return (
    <div className="flex items-end gap-8">
      <span aria-hidden="true" className={`${AVATAR} size-28 text-[10px]`}>
        {item.avatar}
      </span>
      {column}
    </div>
  )
}

/** 메시지는 봇만 보낸다. 승인·고쳐 쓰기·보내지 않음은 보내기 전 확인에서 한다 */
function ThreadNotice({ botName }: { botName: string }) {
  return (
    <div className={FOOT}>
      <div className={FOOT_CARD}>
        <Icon name="info" size={16} />
        <p className="flex-1 text-caption leading-[1.6] wrap-anywhere text-sub">
          메시지는 항상 <strong className="font-semibold text-ink">{botName} 봇</strong>이 보냅니다.
          승인·고쳐 쓰기·보내지 않음은 보내기 전 확인에서 해요.
        </p>
      </div>
    </div>
  )
}
