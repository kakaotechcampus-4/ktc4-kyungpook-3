import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import {
  isAccessLost,
  isMeetingUnavailable,
  meetingDetailQueryOptions,
  meetingFailure,
  speakerViewQueryOptions,
  viewableMeeting,
} from '@/entities/meeting'
import type { Meeting, MeetingStatus, SpeakerView } from '@/entities/meeting'
import { memberListQueryOptions } from '@/entities/member'
import { useMemberWorkspace } from '@/entities/workspace'
import { SpeakerAssignmentForm, useSpeakerSubmit } from '@/features/speaker-assignment'
import type { SubmitRejection } from '@/features/speaker-assignment'
import { paths } from '@/shared/config/routes'
import { seoulDateOf } from '@/shared/lib/date'
import { useLoadingIndicator } from '@/shared/lib/loading-indicator'
import { GuardedLink } from '@/shared/lib/unsaved-changes'
import { useRouteId } from '@/shared/lib/url'
import { Button } from '@/shared/ui/button'
import { DeferredSkeleton } from '@/shared/ui/deferred-skeleton'
import { QueryErrorState } from '@/shared/ui/query-error-state'
import { Skeleton } from '@/shared/ui/skeleton'
import { ASSIGN_TITLE, COLUMN, PAGE, TITLE } from './styles'

/* 로딩을 거쳐 나타난 내용의 불투명도 전환 (#508). 로딩 중에도 보이던 제목(h1)은 빼고 그 아래만 */
const REVEAL_BELOW_TITLE =
  'motion-safe:[&>:not(:first-child)]:animate-[loading-reveal_150ms_ease-out]'
const LEAD = 'text-[14px] leading-[1.7] text-sub'
const META =
  'inline-flex h-22 items-center rounded-6 bg-control px-8 text-[11.5px] leading-none font-semibold whitespace-nowrap text-sub tabular-nums'
const LINK =
  'inline-flex h-36 items-center justify-center self-start rounded-9 bg-ink-solid px-16 text-control font-semibold text-surface hover:bg-dim active:bg-sub'

type SpeakerScreen =
  | { kind: 'loading' }
  | { kind: 'unavailable' }
  | { kind: 'error'; error: unknown; retry: () => void }
  | { kind: 'member' }
  | { kind: 'notAwaiting'; meeting: Meeting; status: MeetingStatus; movedElsewhere: boolean }
  | { kind: 'noLabels'; retry: () => void }
  | { kind: 'assigning'; meeting: Meeting; view: SpeakerView }

export function MeetingSpeakersPage() {
  const workspaceId = useRouteId('workspaceId')
  const meetingId = useRouteId('meetingId')
  if (workspaceId === null || meetingId === null) return null
  // 다른 회의의 지정 화면으로 옮겨도(토스트 동작) 같은 화면이 재사용된다. 앞 회의의 거절·고른 화자를 남기지 않는다
  return (
    <MeetingSpeakers
      key={`${workspaceId}/${meetingId}`}
      workspaceId={workspaceId}
      meetingId={meetingId}
    />
  )
}

function useSpeakerScreen(
  workspaceId: string,
  meetingId: string,
  rejection: SubmitRejection | null,
): SpeakerScreen {
  const role = useMemberWorkspace(workspaceId)?.role ?? null
  const detail = useQuery(meetingDetailQueryOptions(workspaceId, meetingId))
  const meeting = viewableMeeting(detail)
  const awaiting = meeting?.status === 'awaiting_speakers'
  const view = useQuery({
    ...speakerViewQueryOptions(workspaceId, meetingId),
    enabled: role === 'pm' && awaiting,
  })
  const moved =
    rejection?.kind === 'expired' || rejection?.kind === 'alreadyMoved' ? rejection : null

  if (role === null) return { kind: 'loading' }
  if (meeting === null) {
    if (isMeetingUnavailable(detail.error)) return { kind: 'unavailable' }
    if (detail.error !== null)
      return { kind: 'error', error: detail.error, retry: () => void detail.refetch() }
    return { kind: 'loading' }
  }
  if (moved !== null && awaiting) {
    const refetchingAfterConflict = detail.isFetching
    if (refetchingAfterConflict) return { kind: 'loading' }
    const status = moved.kind === 'expired' ? 'failed' : moved.status
    return { kind: 'notAwaiting', meeting, status, movedElsewhere: moved.kind === 'alreadyMoved' }
  }
  if (!awaiting)
    return {
      kind: 'notAwaiting',
      meeting,
      status: meeting.status,
      movedElsewhere: moved?.kind === 'alreadyMoved',
    }
  if (role !== 'pm') return { kind: 'member' }
  // 받아 둔 화자 목록도 403·404 뒤에는 쓰지 않는다 — 실패해도 이전 data 가 남는다 (#405)
  const speakers = isAccessLost(view.error) ? undefined : view.data
  if (speakers === undefined) {
    if (isAccessLost(view.error)) return { kind: 'unavailable' }
    if (view.error !== null)
      return { kind: 'error', error: view.error, retry: () => void view.refetch() }
    return { kind: 'loading' }
  }
  if (speakers.status !== 'awaiting_speakers')
    return { kind: 'notAwaiting', meeting, status: speakers.status, movedElsewhere: false }
  if (speakers.speakers.length === 0) return { kind: 'noLabels', retry: () => void view.refetch() }
  return { kind: 'assigning', meeting, view: speakers }
}

function MeetingSpeakers({ workspaceId, meetingId }: { workspaceId: string; meetingId: string }) {
  const submission = useSpeakerSubmit(workspaceId, meetingId)
  const screen = useSpeakerScreen(workspaceId, meetingId, submission.rejection)
  const members = useQuery({
    ...memberListQueryOptions(workspaceId),
    enabled: screen.kind === 'assigning',
  })
  const isPm = useMemberWorkspace(workspaceId)?.role === 'pm'
  const indicator = useLoadingIndicator(screen.kind === 'loading')
  const reveal = indicator.reveal

  if (screen.kind === 'loading' || indicator.pending)
    return (
      <Layout title={ASSIGN_TITLE}>
        <DeferredSkeleton indicator={indicator}>
          <Skeleton lines={4} />
        </DeferredSkeleton>
      </Layout>
    )
  switch (screen.kind) {
    case 'unavailable':
      return (
        <Layout reveal={reveal} title="이 회의를 볼 수 없어요">
          <p className={LEAD}>회의가 없거나 볼 수 있는 권한이 없어요.</p>
          <GuardedLink to={paths.meetings(workspaceId)} className={LINK}>
            회의록으로 가기
          </GuardedLink>
        </Layout>
      )
    case 'error':
      return (
        <Layout reveal={reveal} title={ASSIGN_TITLE}>
          <QueryErrorState
            error={screen.error}
            onRetry={screen.retry}
            title="화자 지정 정보를 불러오지 못했어요"
          />
        </Layout>
      )
    case 'member':
      return (
        <Layout reveal={reveal} title="PM이 화자를 지정하고 있어요">
          <p className={LEAD}>
            PM이 녹음의 화자를 모두 지정하면 회의 정리가 이어져요. 끝나면 회의록에서 볼 수 있어요.
          </p>
          <GuardedLink to={paths.meetings(workspaceId)} className={LINK}>
            회의록으로 가기
          </GuardedLink>
        </Layout>
      )
    case 'notAwaiting':
      return <NotAwaiting workspaceId={workspaceId} isPm={isPm} reveal={reveal} {...screen} />
    case 'noLabels':
      return (
        <Layout reveal={reveal} title="아직 화자를 나누는 중이에요">
          <p className={LEAD}>녹음에서 화자를 나누면 이 화면에서 지정할 수 있어요.</p>
          <Button className="self-start" onClick={screen.retry}>
            다시 확인
          </Button>
        </Layout>
      )
    case 'assigning': {
      const { meeting, view } = screen
      const meta = [
        meeting.title,
        seoulDateOf(meeting.startedAt),
        `화자 ${view.speakers.length}명`,
      ].filter((part) => part !== null && part !== '')
      return (
        <Layout
          reveal={reveal}
          title={ASSIGN_TITLE}
          titleDetails={
            <div className="flex flex-col gap-12">
              <div className="flex flex-wrap items-center gap-8">
                {meta.map((part, index) => (
                  <span key={index} className={META}>
                    {part}
                  </span>
                ))}
              </div>
              <p className={LEAD}>
                샘플을 들어 보고 화자마다 팀원이나 외부 참석자를 골라 주세요. 모두 고르면 회의
                정리를 이어 가요.
              </p>
            </div>
          }
        >
          <SpeakerAssignmentForm
            meetingId={meetingId}
            view={view}
            members={members.data}
            submission={submission}
          />
        </Layout>
      )
    }
  }
}

function Layout({
  title,
  reveal = false,
  titleDetails,
  children,
}: {
  title: string
  /** 로딩을 거쳐 나타났다 — 제목 아래 내용에 불투명도 전환을 건다 */
  reveal?: boolean
  titleDetails?: ReactNode
  children: ReactNode
}) {
  return (
    <main className={PAGE}>
      <div className={reveal ? `${COLUMN} ${REVEAL_BELOW_TITLE}` : COLUMN}>
        <div className="flex flex-col gap-12">
          <h1 className={TITLE}>{title}</h1>
          {titleDetails}
        </div>
        {children}
      </div>
    </main>
  )
}

function NotAwaiting({
  workspaceId,
  isPm,
  meeting,
  status,
  movedElsewhere,
  reveal,
}: {
  workspaceId: string
  isPm: boolean
  meeting: Meeting
  status: MeetingStatus
  movedElsewhere: boolean
  reveal: boolean
}) {
  const moved = movedElsewhere ? <p className={LEAD}>다른 곳에서 이미 화자를 지정했어요.</p> : null
  switch (status) {
    case 'processing':
      return (
        <Layout reveal={reveal} title="회의를 정리하고 있어요">
          {moved}
          <p className={LEAD}>화자 지정이 끝나 회의 정리를 이어 가고 있어요.</p>
          <GuardedLink to={paths.meetingProcessing(workspaceId, meeting.id)} className={LINK}>
            정리 상태 보기
          </GuardedLink>
        </Layout>
      )
    case 'done':
      return (
        <Layout reveal={reveal} title="정리가 끝났어요">
          {moved}
          <GuardedLink to={paths.meetings(workspaceId, meeting.id)} className={LINK}>
            회의록 보기
          </GuardedLink>
        </Layout>
      )
    case 'failed': {
      const failure = meetingFailure(meeting.failedStage)
      return (
        <Layout reveal={reveal} title={failure.title}>
          <p className={LEAD}>{failure.description}</p>
          {!failure.reupload ? null : isPm ? (
            <GuardedLink to={paths.meetingUpload(workspaceId)} className={LINK}>
              다시 업로드
            </GuardedLink>
          ) : (
            <p className={LEAD}>PM에게 파일 재업로드를 요청해 주세요.</p>
          )}
        </Layout>
      )
    }
    default:
      return (
        <Layout reveal={reveal} title="화자를 지정할 회의가 아니에요">
          <p className={LEAD}>업로드한 회의만 화자를 지정해요.</p>
          <GuardedLink to={paths.meetings(workspaceId)} className={LINK}>
            회의록으로 가기
          </GuardedLink>
        </Layout>
      )
  }
}
