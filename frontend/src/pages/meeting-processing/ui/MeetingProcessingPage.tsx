import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import type { ReactNode } from 'react'
import {
  meetingDetailQueryOptions,
  meetingListQueryOptions,
  PROCESSING_STEP_COUNT,
  processingSteps,
  trackMeeting,
} from '@/entities/meeting'
import type { Meeting, ProcessingStep } from '@/entities/meeting'
import { isAccessLost } from '@/features/meeting-processing'
import { ApiError } from '@/shared/api/errors'
import { paths } from '@/shared/config/routes'
import { seoulDateOf } from '@/shared/lib/date'
import { GuardedLink } from '@/shared/lib/unsaved-changes'
import { useRouteId } from '@/shared/lib/url'
import { Icon } from '@/shared/ui/icon'
import { Mascot } from '@/shared/ui/mascot'
import { QueryErrorState } from '@/shared/ui/query-error-state'
import { Skeleton } from '@/shared/ui/skeleton'

/* Processing 캔버스 실측 — 위 48 · 아래 72, 본문 560px 한 단, 제목 30px, 마스코트 64px, 단계 행 위아래 16 */
const PAGE = 'mx-auto flex w-full max-w-shell flex-1 justify-center px-48 pt-48 pb-72'
const COLUMN = 'flex w-full max-w-[560px] flex-col gap-30'
const TITLE = 'text-[30px] leading-[1.25] font-bold tracking-h1 text-ink'
const META = 'text-body text-sub'
const STATUS = 'text-caption text-dim tabular-nums'
const NOTE = 'text-caption text-dim'
const ROW = 'flex items-center gap-13 border-b border-line py-16 last:border-b-0'
/* 단계 표식 22px 원. 진행 중은 회전 대신 먹 점이다 — 공통 UI 는 스피너를 쓰지 않는다(Skeleton·Button) */
const MARK = 'inline-flex size-22 shrink-0 items-center justify-center rounded-999 border'
const LINK =
  'inline-flex h-36 items-center justify-center self-start rounded-9 bg-ink px-16 text-control font-semibold text-surface hover:bg-dim active:bg-sub'

/** 정리 방식 안내. 확실한 것은 바로, 확인 필요 항목은 승인 뒤 반영한다 (D-101) */
const NOTION_NOTE =
  '회의록과 확실한 태스크는 바로 Notion에 반영하고, 확인이 필요한 항목은 승인한 뒤 반영해요.'

const STEP_TEXT: Record<ProcessingStep['state'], string> = {
  done: '완료',
  current: '진행 중',
  waiting: '대기',
}

/**
 * 회의 정리 중 (U4). 워크스페이스 팀원 모두 볼 수 있다.
 * 상태는 상세 Query 캐시를 읽는다. polling 은 앱 수준 추적기가 한다 — 이 화면이 없어도 추적은 이어지고,
 * 이 화면은 같은 캐시를 그린다. 이 화면에서 정리 중 회의를 보면 추적기에 등록한다(다른 팀원이 올린 회의, 직접 링크).
 * 완료·실패 뒤 이동은 추적기가 한다 — 이 화면을 보고 있을 때만이다.
 *
 * 서버의 `progress` 세 값을 단계로만 보인다. 캔버스의 진행 막대·경과·단계별 시간·말 겹침 안내·`중단하기` 는 넣지 않는다 —
 * 서버가 주지 않는 숫자이거나(U4-4) 범위 밖 기능이다(원본 재생, 중단 API 없음).
 */
export function MeetingProcessingPage() {
  const workspaceId = useRouteId('workspaceId')
  const meetingId = useRouteId('meetingId')
  if (workspaceId === null || meetingId === null) return null
  return <MeetingProcessing workspaceId={workspaceId} meetingId={meetingId} />
}

function Layout({ status, children }: { status: string; children: ReactNode }) {
  return (
    <main className={PAGE}>
      <div className={COLUMN}>
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
  const meeting =
    detail.data !== undefined && detail.data.workspaceId === workspaceId ? detail.data : null
  const processing = meeting?.status === 'processing'

  useEffect(() => {
    if (processing) trackMeeting({ workspaceId, meetingId })
  }, [processing, workspaceId, meetingId])

  if (detail.data !== undefined && meeting === null)
    return <Unavailable workspaceId={workspaceId} />
  if (meeting === null) {
    if (detail.error !== null && isAccessLost(detail.error))
      return <Unavailable workspaceId={workspaceId} />
    if (detail.error !== null)
      return (
        <Layout status="정리 상태를 불러오지 못했어요">
          <QueryErrorState
            error={detail.error}
            onRetry={() => void detail.refetch()}
            title="정리 상태를 불러오지 못했어요"
          />
        </Layout>
      )
    return (
      <Layout status="정리 상태를 불러오는 중이에요">
        <div aria-busy="true">
          <Skeleton lines={4} />
        </div>
      </Layout>
    )
  }

  const attendeeCount = summary.data?.attendeeCount ?? null
  // 받아 둔 상태가 있는데 다시 묻지 못했다 — 정리 실패가 아니다. 다시 물어볼 때까지 마지막 상태를 둔다 (U4-8)
  const stale =
    detail.error instanceof ApiError &&
    detail.error.kind === 'network' &&
    meeting.status === 'processing'

  switch (meeting.status) {
    case 'done':
      return (
        <Layout status="정리가 끝났어요">
          <Heading meeting={meeting} attendeeCount={attendeeCount} title="정리가 끝났어요" />
          <GuardedLink to={paths.meetings(workspaceId, meetingId)} className={LINK}>
            회의록 보기
          </GuardedLink>
        </Layout>
      )
    case 'failed':
      return (
        <Layout status="회의를 정리하지 못했어요">
          <Heading
            meeting={meeting}
            attendeeCount={attendeeCount}
            title="회의를 정리하지 못했어요"
          />
          <p className={META}>정리한 결과는 남기지 않아요. 파일을 다시 올려 주세요.</p>
          <GuardedLink to={paths.meetings(workspaceId)} className={LINK}>
            회의록으로 가기
          </GuardedLink>
        </Layout>
      )
    default:
      return <Processing meeting={meeting} attendeeCount={attendeeCount} stale={stale} />
  }
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
  attendeeCount,
  stale,
}: {
  meeting: Meeting
  attendeeCount: number | null
  stale: boolean
}) {
  const steps = processingSteps(meeting.progress, meeting.status)
  const doneCount = steps.filter(({ state }) => state === 'done').length
  const current = steps.find(({ state }) => state === 'current')
  const position = `${doneCount} / ${PROCESSING_STEP_COUNT} 단계 완료`
  return (
    <Layout status={current === undefined ? position : `${position} · ${current.label} 진행 중`}>
      <Heading meeting={meeting} attendeeCount={attendeeCount} title="정리하고 있어요" />
      <div className="flex flex-col gap-10">
        <p className={STATUS} aria-hidden="true">
          {position}
        </p>
        <ol aria-label="정리 단계" className="flex flex-col">
          {steps.map((step) => (
            <StepRow key={step.key} step={step} />
          ))}
        </ol>
      </div>
      {stale ? (
        <p className={META}>연결이 불안정해요. 다시 연결되면 정리 상태를 바로 확인할게요.</p>
      ) : null}
      <p className={NOTE}>
        정리하는 동안 다른 화면을 써도 괜찮아요. 끝나면 알려드릴게요. {NOTION_NOTE}
      </p>
    </Layout>
  )
}

function StepRow({ step }: { step: ProcessingStep }) {
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
      <span
        className={
          step.state === 'current'
            ? 'flex-1 text-body font-semibold text-ink'
            : step.state === 'done'
              ? 'flex-1 text-body text-sub'
              : 'flex-1 text-body text-dim'
        }
      >
        {step.label}
      </span>
      <span
        className={step.state === 'current' ? 'text-caption text-ink' : 'text-caption text-dim'}
      >
        {STEP_TEXT[step.state]}
      </span>
    </li>
  )
}

function Unavailable({ workspaceId }: { workspaceId: string }) {
  return (
    <Layout status="이 회의를 볼 수 없어요">
      <h1 className={TITLE}>이 회의를 볼 수 없어요</h1>
      <p className={META}>회의가 없거나 볼 수 있는 권한이 없어요.</p>
      <GuardedLink to={paths.meetings(workspaceId)} className={LINK}>
        회의록으로 가기
      </GuardedLink>
    </Layout>
  )
}
