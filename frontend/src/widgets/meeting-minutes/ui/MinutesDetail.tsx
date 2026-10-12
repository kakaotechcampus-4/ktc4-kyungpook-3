import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import type { ReactNode } from 'react'
import { pendingApprovalListQueryOptions } from '@/entities/approval'
import { extractionQueryOptions } from '@/entities/extraction'
import { meetingDetailQueryOptions } from '@/entities/meeting'
import type { Meeting, MeetingSummary } from '@/entities/meeting'
import { minutesQueryOptions } from '@/entities/minutes'
import type { Minutes } from '@/entities/minutes'
import { isAccessLost } from '@/features/meeting-processing'
import { ApiError, ERROR_CODES } from '@/shared/api/errors'
import { paths } from '@/shared/config/routes'
import { GuardedLink } from '@/shared/lib/unsaved-changes'
import { QueryErrorState } from '@/shared/ui/query-error-state'
import { MinutesDetailSkeleton } from '@/shared/ui/page-skeleton'
import { extractedTasks } from '../lib/extractedTasks'
import { detailMeta, SOURCE_LABEL } from '../lib/format'
import { MINUTES_DIM_DELAY_MS } from '../model/useShownMeeting'
import { SummaryPanel, TasksPanel, TranscriptPanel } from './MinutesBody'
import type { ReviewState, TasksState } from './MinutesBody'
import { ATTENDEE_ROW, AttendeeRow, CHIP } from './AttendeeRow'
import { MinutesTabs } from './MinutesTabs'
import { MinutesTitle } from './MinutesTitle'

/* Meetings 캔버스 실측 — 머리 위 44 · 좌우 36 · 아래 18, 제목 26px · 1.3, 메타 12.5px 흐림 */
const HEAD = 'flex flex-col gap-7 px-36 pt-44 pb-18'
/* 안내(정리 중 · 실패 등)의 제목. 뒤에 탭 줄이 없어 접혀도 밀릴 것이 없다 — 회의록 머리의 제목은 MinutesTitle(한 줄 · 말줄임) */
const TITLE = 'text-[26px] leading-[1.3] font-bold tracking-h1 text-ink'
/* 메타와 출처 칩 줄 — 칩 한 줄 높이(22)로 고정하고 접지 않는다. 뼈대의 같은 줄(MinutesSkeleton CHIP_ROW)과 같은 높이라
   폭이 좁아도 탭 줄이 제자리다. 메타가 넘치면 말줄임이고 칩은 줄지 않는다 (UX1-M04) */
const META_ROW = 'flex h-22 min-w-[0px] items-center gap-12'
const META = 'text-caption text-dim tabular-nums'
/* 고른 회의의 답을 기다리며 들고 있는 이전 본문. Skeleton 숨쉬기의 낮은 점(0.55)과 같은 흐림이다 — 기다리는 중이라는 같은 말.
   흐림은 MINUTES_DIM_DELAY_MS 뒤 한 번에 바뀐다(전환 길이 0, 지연만). 짧은 답에는 흐림이 보이지 않는다.
   움직임이 없어 줄이기 설정(global.css 는 transition-duration 만 줄인다)과 상관없이 같다 */
const HELD_BODY = 'flex flex-col opacity-55 transition-opacity duration-0'
const HELD_BODY_STYLE = { transitionDelay: `${MINUTES_DIM_DELAY_MS}ms` }
const NOTICE = 'flex flex-col items-start gap-10 px-36 pt-44 pb-56'
const NOTICE_TEXT = 'text-body text-sub'
const LINK =
  'inline-flex h-36 items-center justify-center rounded-9 bg-ink px-16 text-control font-semibold text-surface hover:bg-dim active:bg-sub'

type TabId = 'summary' | 'transcript' | 'tasks'

export interface MinutesDetailProps {
  workspaceId: string
  meetingId: string
  /** 소속 목록의 역할이 PM 이다 */
  isPm: boolean
  /**
   * 고른 회의(URL)의 목록 요약. 목록에 없으면 null. 본문을 기다리는 동안 머리(제목·메타·출처·참석자 수)를 이것으로 먼저 그린다 —
   * 주소·목록 선택 표시와 본문 머리가 같은 회의를 가리킨다 (UX1-M02)
   */
  selected?: MeetingSummary | null
  /** 고른 회의의 답을 기다리며 이 회의(이전 회의)의 본문을 들고 있다. 머리는 `selected` 로, 본문은 흐리게 · aria-busy · inert 로 묶는다 */
  holding?: boolean
  /**
   * 회의를 바꾸며 그린 본문 뼈대를 아직 둔다 — 답이 와도 MINUTES_SKELETON_MIN_MS 가 찰 때까지 뼈대다(useShownMeeting, UX1-N03).
   * 들고 있는 동안이면 이 회의(이전 회의)의 본문 대신 뼈대 위에서 기다린다 — 그동안 받은 이 회의 본문을 처음 보이지 않는다
   */
  keepSkeleton?: boolean
}

/**
 * 본문 머리 — 제목 · 메타와 출처 칩 · 참석자 줄. 회의록과 목록 요약이 같은 틀을 쓴다.
 * 세 줄 모두 높이가 고정이다(제목 한 줄 · 칩 한 줄 · 칩 한 줄) — 제목 길이 · 폭 · 참석자 수와 상관없이 탭 줄이 같은 자리다
 */
function Head({
  title,
  meta,
  source,
  children,
}: {
  title: string
  meta: string
  source: MeetingSummary['source']
  children: ReactNode
}) {
  return (
    <header className={HEAD}>
      <MinutesTitle title={title === '' ? '제목 없는 회의' : title} />
      <div className={META_ROW}>
        {meta === '' ? null : <span className={`min-w-[0px] truncate ${META}`}>{meta}</span>}
        <span className={CHIP}>{SOURCE_LABEL[source]}</span>
      </div>
      {children}
    </header>
  )
}

/** 참석자가 없는 회의의 참석자 줄. 글 한 줄이지만 칩 줄과 같은 높이(22)다 — 탭 줄이 같은 자리다 */
function NoAttendees() {
  return <p className={`${ATTENDEE_ROW} ${META}`}>참석자 정보가 없어요</p>
}

/**
 * 목록 요약으로 그린 머리 — 회의록이 오기 전에 아는 것만. 참석자는 이름 대신 수다. 참석자 줄은 회의록의 줄(이름 칩을 한 줄에
 * 넣고 남는 사람은 `+N`)과 같은 한 줄 높이라 회의록이 와도 탭 줄이 제자리다 (UX1-M03)
 */
function SummaryHead({ summary }: { summary: MeetingSummary }) {
  return (
    <Head
      title={summary.title}
      meta={detailMeta(summary.startedAt, summary.durationMs ?? 0)}
      source={summary.source}
    >
      {summary.attendeeCount === 0 ? (
        <NoAttendees />
      ) : (
        <p className={ATTENDEE_ROW}>
          <span className={CHIP}>참석자 {summary.attendeeCount}명</span>
        </p>
      )}
    </Head>
  )
}

function Notice({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className={NOTICE}>
      <h2 className={TITLE}>{title}</h2>
      {children}
    </div>
  )
}

/** 볼 수 없는 회의 — 없거나, 권한이 없거나, URL 의 공간과 다른 공간의 회의다 */
export function UnavailableMeeting() {
  return (
    <Notice title="이 회의를 볼 수 없어요">
      <p className={NOTICE_TEXT}>회의가 없거나 볼 수 있는 권한이 없어요.</p>
    </Notice>
  )
}

/**
 * 고른 회의 한 건 (U5-3, U5-4). 회의 상세의 `workspaceId` 가 URL 공간과 같을 때만 회의록 본문·추출을 부른다 —
 * 상세는 봇 경로라 경로에 공간이 없어(계약 §2.3) 다른 공간의 회의 ID 로도 답이 온다. 다르면 볼 수 없는 회의로 그린다.
 * 정리가 끝나지 않은 회의는 회의록이 없다. 정리 중이면 처리 화면으로 잇는다 (U5-2).
 */
export function MinutesDetail({
  workspaceId,
  meetingId,
  isPm,
  selected = null,
  holding = false,
  keepSkeleton = false,
}: MinutesDetailProps) {
  const detail = useQuery(meetingDetailQueryOptions(workspaceId, meetingId))
  const meeting =
    detail.data !== undefined && detail.data.workspaceId === workspaceId ? detail.data : null
  const held = holding ? selected : null
  // 기다리는 동안의 자리. 고른 회의의 요약을 알면 머리 뼈대 대신 그 요약이다 (UX1-M02)
  const loading = (
    <MinutesDetailSkeleton
      head={
        selected !== null && (held !== null || selected.id === meetingId) ? (
          <SummaryHead summary={selected} />
        ) : undefined
      }
    />
  )

  if (keepSkeleton) return loading
  // 들고 있을 수 있는 것은 이전 회의의 회의록 본문뿐이다. 이전 회의의 안내·오류를 고른 회의의 머리 아래 남기지 않는다
  if (held !== null && meeting?.status !== 'done') return loading
  if (detail.data !== undefined && meeting === null) return <UnavailableMeeting />
  if (meeting === null) {
    if (detail.error !== null && isAccessLost(detail.error)) return <UnavailableMeeting />
    if (detail.error !== null)
      return (
        <div className={NOTICE}>
          <QueryErrorState
            error={detail.error}
            onRetry={() => void detail.refetch()}
            title="회의를 불러오지 못했어요"
          />
        </div>
      )
    return loading
  }

  switch (meeting.status) {
    case 'done':
      return (
        <MinutesView
          workspaceId={workspaceId}
          meeting={meeting}
          isPm={isPm}
          held={held}
          loading={loading}
        />
      )
    case 'processing':
      return (
        <Notice title={meeting.title === '' ? '정리하고 있어요' : meeting.title}>
          <p className={NOTICE_TEXT}>
            회의를 정리하고 있어요. 끝나면 이 자리에서 회의록을 볼 수 있어요.
          </p>
          <GuardedLink to={paths.meetingProcessing(workspaceId, meeting.id)} className={LINK}>
            정리 상태 보기
          </GuardedLink>
        </Notice>
      )
    case 'failed':
      return (
        <Notice title="이 회의는 정리하지 못했어요">
          <p className={NOTICE_TEXT}>정리한 결과는 남기지 않아요.</p>
        </Notice>
      )
    default:
      return (
        <Notice title={meeting.title === '' ? '아직 회의 중이에요' : meeting.title}>
          <p className={NOTICE_TEXT}>회의가 끝나고 정리되면 회의록을 볼 수 있어요.</p>
        </Notice>
      )
  }
}

/** 추출 결과가 없는 것과 불러오지 못한 것을 가른다. 없음(404)은 빈 상태다 (U5-3) */
function isMissingExtraction(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.kind === 'http' &&
    (error.status === 404 || error.code === ERROR_CODES.EXTRACTION_NOT_FOUND)
  )
}

function MinutesView({
  workspaceId,
  meeting,
  isPm,
  held,
  loading,
}: {
  workspaceId: string
  meeting: Meeting
  isPm: boolean
  held: MeetingSummary | null
  loading: ReactNode
}) {
  const minutes = useQuery(minutesQueryOptions(workspaceId, meeting.id))

  if (minutes.data === undefined) {
    if (held !== null) return loading
    if (minutes.error !== null && isAccessLost(minutes.error)) return <UnavailableMeeting />
    if (minutes.error !== null)
      return (
        <div className={NOTICE}>
          <QueryErrorState
            error={minutes.error}
            onRetry={() => void minutes.refetch()}
            title="회의록을 불러오지 못했어요"
          />
        </div>
      )
    return loading
  }
  return (
    <MinutesContent
      workspaceId={workspaceId}
      meeting={meeting}
      minutes={minutes.data}
      held={held}
      // 역할(소속 목록)과 서버가 이 회의록에 준 권한을 함께 본다. 둘 중 하나라도 아니면 확인 필요를 부르지도 그리지도 않는다 (U5-6)
      canReview={isPm && minutes.data.canReview}
    />
  )
}

function MinutesContent({
  workspaceId,
  meeting,
  minutes,
  held,
  canReview,
}: {
  workspaceId: string
  meeting: Meeting
  minutes: Minutes
  /** 들고 있는 동안 고른 회의의 목록 요약 — 머리는 이것으로 그리고, 이 회의록 본문은 흐리게 묶는다 */
  held: MeetingSummary | null
  canReview: boolean
}) {
  const [tab, setTab] = useState<TabId>('summary')
  const extractionId = meeting.extractionId
  const extraction = useQuery({
    ...extractionQueryOptions(workspaceId, extractionId ?? ''),
    enabled: extractionId !== null,
  })
  // 일반 팀원은 승인 목록을 부르지 않는다 (D-104, D-163, U5-6)
  const approvals = useQuery({
    ...pendingApprovalListQueryOptions(workspaceId),
    enabled: canReview,
  })

  const review: ReviewState = !canReview
    ? { kind: 'hidden' }
    : approvals.data !== undefined
      ? { kind: 'ready' }
      : approvals.error !== null
        ? { kind: 'error', error: approvals.error, retry: () => void approvals.refetch() }
        : { kind: 'loading' }

  const tasks: TasksState =
    extractionId === null
      ? { kind: 'missing' }
      : extraction.data !== undefined
        ? // 다른 회의의 추출이면 이 회의의 결과로 쓰지 않는다
          extraction.data.meetingId === meeting.id
          ? {
              kind: 'ready',
              tasks: extractedTasks(extraction.data, canReview ? (approvals.data ?? null) : null),
            }
          : { kind: 'missing' }
        : extraction.error !== null
          ? isMissingExtraction(extraction.error)
            ? { kind: 'missing' }
            : { kind: 'error', error: extraction.error, retry: () => void extraction.refetch() }
          : { kind: 'loading' }

  const taskCount =
    tasks.kind === 'ready'
      ? tasks.tasks.applied.length +
        (review.kind === 'ready' ? (tasks.tasks.pending?.length ?? 0) : 0)
      : tasks.kind === 'missing'
        ? 0
        : null

  const title = held !== null ? held.title : minutes.title !== '' ? minutes.title : meeting.title

  return (
    <article aria-label={title === '' ? '회의록' : title} className="flex flex-col">
      {held !== null ? (
        <SummaryHead summary={held} />
      ) : (
        <Head
          title={title}
          meta={detailMeta(minutes.startedAt, minutes.durationMs)}
          source={minutes.source}
        >
          {minutes.attendees.length === 0 ? (
            <NoAttendees />
          ) : (
            <AttendeeRow attendees={minutes.attendees} />
          )}
        </Head>
      )}
      {/* 들고 있는 이전 본문을 묶는 칸. 늘 같은 자리에 둔다 — 감싸기를 넣고 빼면 탭이 다시 마운트되고 그것이 깜빡임이다 */}
      <div
        data-testid="minutes-body"
        aria-busy={held !== null || undefined}
        inert={held !== null}
        className={held !== null ? HELD_BODY : 'flex flex-col'}
        style={held !== null ? HELD_BODY_STYLE : undefined}
      >
        <MinutesTabs<TabId>
          label="회의록 내용"
          selected={tab}
          onSelect={setTab}
          tabs={[
            { id: 'summary', label: '요약', panel: <SummaryPanel summary={minutes.summary} /> },
            {
              id: 'transcript',
              label: '전사문',
              panel: <TranscriptPanel transcript={minutes.transcript} />,
            },
            {
              id: 'tasks',
              label: '추출된 일',
              count: taskCount,
              panel: <TasksPanel workspaceId={workspaceId} state={tasks} review={review} />,
            },
          ]}
        />
      </div>
    </article>
  )
}
