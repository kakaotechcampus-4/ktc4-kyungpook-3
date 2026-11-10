import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import type { ReactNode } from 'react'
import {
  isMeetingUnavailable,
  meetingDetailQueryOptions,
  meetingFailure,
  meetingListQueryOptions,
  processingSteps,
  stageDetail,
  StageDetailText,
  trackMeeting,
  useMeetingSources,
  viewableMeeting,
} from '@/entities/meeting'
import type { Meeting, MeetingSource, ProcessingStep, StageDetail } from '@/entities/meeting'
import { useMemberWorkspace } from '@/entities/workspace'
import { ApiError, isInvalidResponse } from '@/shared/api/errors'
import { paths } from '@/shared/config/routes'
import { seoulDateOf } from '@/shared/lib/date'
import { useLoadingIndicator } from '@/shared/lib/loading-indicator'
import type { LoadingIndicator } from '@/shared/lib/loading-indicator'
import { GuardedLink } from '@/shared/lib/unsaved-changes'
import { useRouteId } from '@/shared/lib/url'
import { DeferredSkeleton } from '@/shared/ui/deferred-skeleton'
import { Icon } from '@/shared/ui/icon'
import { Mascot } from '@/shared/ui/mascot'
import { QueryErrorState } from '@/shared/ui/query-error-state'
import { Skeleton } from '@/shared/ui/skeleton'
import { COLUMN, PAGE } from './styles'

/* 정리 상태를 기다린 뒤 나타난 내용의 불투명도 전환 (#508). 감싸는 요소를 더하지 않는다 — 단의 자식(제목 · 단계 · 안내)에 바로
   건다. 상태 알림(role=status)은 늘 같은 자리에 남아 읽혀야 해 뺀다 */
const REVEAL_CONTENT = 'motion-safe:[&>:not([role=status])]:animate-[loading-reveal_150ms_ease-out]'
const TITLE = 'text-[30px] leading-[1.25] font-bold tracking-h1 text-ink'
const META = 'text-body text-sub'
const STATUS = 'text-caption text-dim tabular-nums'
const NOTE = 'text-caption text-dim'
const ROW = 'flex items-center gap-13 border-b border-line py-16 last:border-b-0'
/* 단계 표식 22px 원. 진행 중은 회전 대신 먹 점이다 — 공통 UI 는 스피너를 쓰지 않는다(Skeleton·Button) */
const MARK = 'inline-flex size-22 shrink-0 items-center justify-center rounded-999 border'
const LINK =
  'inline-flex h-36 items-center justify-center self-start rounded-9 bg-ink px-16 text-control font-semibold text-surface hover:bg-dim active:bg-sub'

/**
 * Notion 반영 안내. 확실한 태스크는 바로, 확인 필요 태스크는 PM 승인 뒤 올라간다 (D-101). BE 는 회의록 본문을 Notion 에 올리지 않는다.
 * 승인은 PM 만 하므로 팀원에게는 승인 문장을 빼고 보인다 (2026-11-07 사용자 결정)
 */
const NOTION_NOTE = {
  pm: 'Notion을 연결했다면 확실한 태스크는 바로, 확인이 필요한 태스크는 승인한 뒤 Notion에도 올라가요.',
  member: 'Notion을 연결했다면 확실한 태스크는 바로 Notion에도 올라가요.',
} as const

const LABEL: Record<ProcessingStep['state'], string> = {
  done: 'text-body text-sub',
  current: 'text-body font-semibold text-ink',
  waiting: 'text-body text-dim',
}

const STEP_TEXT: Record<ProcessingStep['state'], string> = {
  done: '완료',
  current: '진행 중',
  waiting: '대기',
}

/**
 * 회의 정리 중 (U4). 워크스페이스 팀원 모두 볼 수 있다.
 * 상태는 상세 Query 캐시를 읽는다. polling 은 앱 수준 추적기가 한다 — 이 화면이 없어도 추적은 이어지고,
 * 이 화면은 같은 캐시를 그린다. 이 화면에서 정리 중·화자 지정 대기 회의를 보면 추적기에 등록한다(다른 팀원이 올린 회의, 직접 링크).
 * 완료·실패 뒤 이동은 추적기가 한다 — 이 화면을 보고 있을 때만이다.
 *
 * 서버의 `progress` 세 값과 회의 상태로 단계를 정한다 — 녹음 회의는 세 단계, 채팅 회의는 두 단계다 (#483). 지금 단계 줄에는 서버
 * `processing` 이 알린 전사 진행 수와 그 단계의 경과를 붙인다(없으면 붙이지 않는다). 캔버스의 진행 막대·단계별 시간·남은 시간·말 겹침 안내·
 * `중단하기` 는 넣지 않는다 — 서버가 주지 않는 숫자이거나(U4-4) 범위 밖 기능이다(원본 재생, 중단 API 없음).
 */
export function MeetingProcessingPage() {
  const workspaceId = useRouteId('workspaceId')
  const meetingId = useRouteId('meetingId')
  if (workspaceId === null || meetingId === null) return null
  return <MeetingProcessing workspaceId={workspaceId} meetingId={meetingId} />
}

function Layout({
  status,
  reveal = false,
  children,
}: {
  status: string
  /** 정리 상태를 기다린 뒤 나타났다 — 내용에 불투명도 전환을 건다 (#508) */
  reveal?: boolean
  children: ReactNode
}) {
  return (
    <main className={PAGE}>
      <div className={reveal ? `${COLUMN} ${REVEAL_CONTENT}` : COLUMN}>
        {children}
        {/* 상태 변화를 스크린리더에 알린다. 화면의 상태가 바뀌어도 같은 자리에 남아 있어야 읽힌다 (U4-10) */}
        <p role="status" className="sr-only">
          {status}
        </p>
      </div>
    </main>
  )
}

function MeetingProcessing({ workspaceId, meetingId }: { workspaceId: string; meetingId: string }) {
  const detail = useQuery(meetingDetailQueryOptions(workspaceId, meetingId))
  // 참석 인원은 목록에만 있다. 추적기의 발견과 같은 캐시라 보통 새 요청이 없다
  const summary = useQuery({
    ...meetingListQueryOptions(workspaceId),
    select: (meetings) => meetings.find(({ id }) => id === meetingId) ?? null,
  })
  const meeting = viewableMeeting(detail)
  const watched = meeting?.status === 'processing' || meeting?.status === 'awaiting_speakers'
  const isPm = useMemberWorkspace(workspaceId)?.role === 'pm'
  // 단계 목록이 출처마다 달라(#483) 출처를 목록에서 읽는다. 목록에 없으면 한 번 새로 받고, 모르는 동안 단계를 그리지 않는다
  const sourceOf = useMeetingSources(
    workspaceId,
    meeting?.status === 'processing' ? [meetingId] : [],
  )

  useEffect(() => {
    if (watched) trackMeeting({ workspaceId, meetingId })
  }, [watched, workspaceId, meetingId])
  // 정리 상태를 받는 자리의 지연·최소 표시 (#508)
  const indicator = useLoadingIndicator(meeting === null && detail.error === null)
  const reveal = indicator.reveal
  const loadError = (
    <Layout status="정리 상태를 불러오지 못했어요" reveal={reveal}>
      <QueryErrorState
        error={detail.error}
        onRetry={() => void detail.refetch()}
        title="정리 상태를 불러오지 못했어요"
      />
    </Layout>
  )

  if (meeting === null || indicator.pending) {
    if (indicator.pending) return <Loading indicator={indicator} />
    if (isMeetingUnavailable(detail.error))
      return <Unavailable workspaceId={workspaceId} reveal={reveal} />
    if (detail.error !== null) return loadError
    return <Loading indicator={indicator} />
  }
  // 상세를 읽지 못했다. 추적기도 다시 묻지 않으니 받아 둔 단계를 지금 상태처럼 두지 않고 안내와 다시 시도만 보인다 (#348)
  if (isInvalidResponse(detail.error)) return loadError

  const attendeeCount = summary.data?.attendeeCount ?? null
  const source = sourceOf(meetingId)
  // 받아 둔 상태가 있는데 다시 묻지 못했다 — 정리 실패가 아니다. 다시 물어볼 때까지 마지막 상태를 둔다 (U4-8).
  // 403·404·다른 공간은 다시 물어도 같은 답이라 viewableMeeting 이 먼저 걸러 볼 수 없는 회의로 그린다. 그 밖의 재조회 실패
  // (네트워크 오류·408·5xx 등)는 마지막 상태를 두고, 연결 불안정 안내는 네트워크 오류일 때만 보인다 (#405)
  const stale =
    detail.error instanceof ApiError &&
    detail.error.kind === 'network' &&
    meeting.status === 'processing'

  switch (meeting.status) {
    case 'done':
      return (
        <Layout status="정리가 끝났어요" reveal={reveal}>
          <Heading meeting={meeting} attendeeCount={attendeeCount} title="정리가 끝났어요" />
          <GuardedLink to={paths.meetings(workspaceId, meetingId)} className={LINK}>
            회의록 보기
          </GuardedLink>
        </Layout>
      )
    case 'failed': {
      const failure = meetingFailure(meeting.failedStage)
      return (
        <Layout status={failure.title} reveal={reveal}>
          <Heading meeting={meeting} attendeeCount={attendeeCount} title={failure.title} />
          <p className={META}>{failure.description}</p>
          <GuardedLink to={paths.meetings(workspaceId, meetingId)} className={LINK}>
            실패 사유 보기
          </GuardedLink>
        </Layout>
      )
    }
    case 'awaiting_speakers':
      return (
        <Layout status="화자 지정이 필요해요" reveal={reveal}>
          <Heading meeting={meeting} attendeeCount={attendeeCount} title="화자 지정이 필요해요" />
          {isPm ? (
            <>
              <p className={META}>
                녹음에서 화자를 나눴어요. 화자마다 누구인지 골라 주시면 정리를 이어 갈게요.
              </p>
              <GuardedLink to={paths.meetingSpeakers(workspaceId, meetingId)} className={LINK}>
                화자 지정하기
              </GuardedLink>
            </>
          ) : (
            <p className={META}>
              PM이 화자를 지정하고 있어요. 지정이 끝나면 정리를 이어 가고, 끝나면 알려드릴게요.
            </p>
          )}
        </Layout>
      )
    default:
      return (
        <Processing
          meeting={meeting}
          source={source}
          isPm={isPm}
          attendeeCount={attendeeCount}
          stale={stale}
          reveal={reveal}
          observedAt={detail.dataUpdatedAt}
        />
      )
  }
}

function Loading({ indicator }: { indicator: Pick<LoadingIndicator, 'skeletonVisible'> }) {
  return (
    <Layout status="정리 상태를 불러오는 중이에요">
      <DeferredSkeleton indicator={indicator}>
        <Skeleton lines={4} />
      </DeferredSkeleton>
    </Layout>
  )
}

function Heading({
  meeting,
  attendeeCount,
  title,
}: {
  meeting: Meeting
  attendeeCount: number | null
  title: string
}) {
  const date = seoulDateOf(meeting.startedAt)
  const meta = [meeting.title, date, attendeeCount === null ? null : `참석 ${attendeeCount}명`]
    .filter((part) => part !== null && part !== '')
    .join(' · ')
  return (
    <div className="flex items-center gap-20">
      <Mascot size={64} className="shrink-0" />
      <div className="flex flex-col gap-10">
        <h1 className={TITLE}>{title}</h1>
        {meta === '' ? null : <p className={META}>{meta}</p>}
      </div>
    </div>
  )
}

function Processing({
  meeting,
  source,
  isPm,
  attendeeCount,
  stale,
  reveal,
  observedAt,
}: {
  meeting: Meeting
  source: MeetingSource | null
  isPm: boolean
  attendeeCount: number | null
  stale: boolean
  reveal: boolean
  /** 상세 응답을 마지막으로 받은 시각. 경과는 이 시각까지다 — polling 마다 다시 그려 따로 타이머가 없다 */
  observedAt: number
}) {
  return (
    <Layout
      status={source === null ? '정리하고 있어요' : stepStatus(meeting, source)}
      reveal={reveal}
    >
      <Heading meeting={meeting} attendeeCount={attendeeCount} title="정리하고 있어요" />
      {/* 출처를 모르는 동안은 단계를 그리지 않는다 — 단계 수가 출처마다 다르다 (#483) */}
      {source === null ? null : <Steps meeting={meeting} source={source} observedAt={observedAt} />}
      {stale ? (
        <p className={META}>연결이 불안정해요. 다시 연결되면 정리 상태를 바로 확인할게요.</p>
      ) : null}
      <p className={NOTE}>
        정리하는 동안 다른 화면을 써도 괜찮아요. 끝나면 알려드릴게요.{' '}
        {NOTION_NOTE[isPm ? 'pm' : 'member']}
      </p>
    </Layout>
  )
}

function stepStatus(meeting: Meeting, source: MeetingSource): string {
  const steps = processingSteps(meeting.progress, meeting.status, source)
  const position = stepPosition(steps)
  const current = steps.find(({ state }) => state === 'current')
  return current === undefined ? position : `${position} · ${current.label} 진행 중`
}

function stepPosition(steps: ProcessingStep[]): string {
  return `${steps.filter(({ state }) => state === 'done').length} / ${steps.length} 단계 완료`
}

function Steps({
  meeting,
  source,
  observedAt,
}: {
  meeting: Meeting
  source: MeetingSource
  observedAt: number
}) {
  const steps = processingSteps(meeting.progress, meeting.status, source)
  const current = steps.find(({ state }) => state === 'current')
  const detail = stageDetail(meeting.processing, current?.key, observedAt)
  return (
    <div className="flex flex-col gap-10">
      <p className={STATUS} aria-hidden="true">
        {stepPosition(steps)}
      </p>
      <ol aria-label="정리 단계" className="flex flex-col">
        {steps.map((step) => (
          <StepRow key={step.key} step={step} detail={step.state === 'current' ? detail : null} />
        ))}
      </ol>
    </div>
  )
}

function StepRow({ step, detail }: { step: ProcessingStep; detail: StageDetail | null }) {
  const labelClass = LABEL[step.state]
  return (
    <li className={ROW} aria-current={step.state === 'current' ? 'step' : undefined}>
      {step.state === 'done' ? (
        <span className={`${MARK} border-line-strong bg-surface text-ink`}>
          <Icon name="check" size={12} strokeWidth={3} />
        </span>
      ) : step.state === 'current' ? (
        <span className={`${MARK} border-ink bg-surface`}>
          <span className="size-8 rounded-999 bg-ink" />
        </span>
      ) : (
        <span className={`${MARK} border-line-strong`} />
      )}
      {detail === null ? (
        <span className={`flex-1 ${labelClass}`}>{step.label}</span>
      ) : (
        <span className="flex flex-1 flex-col gap-2">
          <span className={labelClass}>{step.label}</span>
          <StageDetailText detail={detail} className={STATUS} />
        </span>
      )}
      <span
        className={step.state === 'current' ? 'text-caption text-ink' : 'text-caption text-dim'}
      >
        {STEP_TEXT[step.state]}
      </span>
    </li>
  )
}

function Unavailable({ workspaceId, reveal }: { workspaceId: string; reveal: boolean }) {
  return (
    <Layout status="이 회의를 볼 수 없어요" reveal={reveal}>
      <h1 className={TITLE}>이 회의를 볼 수 없어요</h1>
      <p className={META}>회의가 없거나 볼 수 있는 권한이 없어요.</p>
      <GuardedLink to={paths.meetings(workspaceId)} className={LINK}>
        회의록으로 가기
      </GuardedLink>
    </Layout>
  )
}
