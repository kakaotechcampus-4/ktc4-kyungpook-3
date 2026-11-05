import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import {
  meetingDetailQueryOptions,
  meetingFailure,
  speakerViewQueryOptions,
} from '@/entities/meeting'
import type { Meeting, MeetingStatus, SpeakerView } from '@/entities/meeting'
import { memberListQueryOptions } from '@/entities/member'
import { useMemberWorkspace } from '@/entities/workspace'
import { isAccessLost } from '@/features/meeting-processing'
import { SpeakerAssignmentForm, useSpeakerSubmit } from '@/features/speaker-assignment'
import type { SubmitRejection } from '@/features/speaker-assignment'
import { paths } from '@/shared/config/routes'
import { seoulDateOf } from '@/shared/lib/date'
import { GuardedLink } from '@/shared/lib/unsaved-changes'
import { useRouteId } from '@/shared/lib/url'
import { Button } from '@/shared/ui/button'
import { QueryErrorState } from '@/shared/ui/query-error-state'
import { Skeleton } from '@/shared/ui/skeleton'

const PAGE = 'mx-auto flex w-full max-w-shell flex-1 justify-center px-48 pt-48 pb-72'
const COLUMN = 'flex w-full max-w-[700px] flex-col gap-26'
const TITLE = 'text-[30px] leading-[1.25] font-bold tracking-h1 text-ink'
const LEAD = 'text-body text-sub'
const META = 'text-caption text-dim tabular-nums'
const LINK =
  'inline-flex h-36 items-center justify-center self-start rounded-9 bg-ink px-16 text-control font-semibold text-surface hover:bg-dim active:bg-sub'

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
  const meeting =
    detail.data !== undefined && detail.data.workspaceId === workspaceId ? detail.data : null
  const awaiting = meeting?.status === 'awaiting_speakers'
  const view = useQuery({
    ...speakerViewQueryOptions(workspaceId, meetingId),
    enabled: role === 'pm' && awaiting,
  })
  const moved =
    rejection?.kind === 'expired' || rejection?.kind === 'alreadyMoved' ? rejection : null

  if (role === null) return { kind: 'loading' }
  if (detail.data !== undefined && meeting === null) return { kind: 'unavailable' }
  if (meeting === null) {
    if (detail.error !== null && isAccessLost(detail.error)) return { kind: 'unavailable' }
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
  if (view.data === undefined) {
    if (view.error !== null && isAccessLost(view.error)) return { kind: 'unavailable' }
    if (view.error !== null)
      return { kind: 'error', error: view.error, retry: () => void view.refetch() }
    return { kind: 'loading' }
  }
  if (view.data.status !== 'awaiting_speakers')
    return { kind: 'notAwaiting', meeting, status: view.data.status, movedElsewhere: false }
  if (view.data.speakers.length === 0) return { kind: 'noLabels', retry: () => void view.refetch() }
  return { kind: 'assigning', meeting, view: view.data }
}

function MeetingSpeakers({ workspaceId, meetingId }: { workspaceId: string; meetingId: string }) {
  const submission = useSpeakerSubmit(workspaceId, meetingId)
  const screen = useSpeakerScreen(workspaceId, meetingId, submission.rejection)
  const members = useQuery({
    ...memberListQueryOptions(workspaceId),
    enabled: screen.kind === 'assigning',
  })
  const isPm = useMemberWorkspace(workspaceId)?.role === 'pm'

  switch (screen.kind) {
    case 'loading':
      return (
        <Layout title="누가 말했는지 골라 주세요">
          <div aria-busy="true">
            <Skeleton lines={4} />
          </div>
        </Layout>
      )
    case 'unavailable':
      return (
        <Layout title="이 회의를 볼 수 없어요">
          <p className={LEAD}>회의가 없거나 볼 수 있는 권한이 없어요.</p>
          <GuardedLink to={paths.meetings(workspaceId)} className={LINK}>
            회의록으로 가기
          </GuardedLink>
        </Layout>
      )
    case 'error':
      return (
        <Layout title="누가 말했는지 골라 주세요">
          <QueryErrorState
            error={screen.error}
            onRetry={screen.retry}
            title="화자 지정 정보를 불러오지 못했어요"
          />
        </Layout>
      )
    case 'member':
      return (
        <Layout title="PM이 화자를 지정하고 있어요">
          <p className={LEAD}>
            PM이 녹음의 화자를 모두 지정하면 회의 정리가 이어져요. 끝나면 회의록에서 볼 수 있어요.
          </p>
          <GuardedLink to={paths.meetings(workspaceId)} className={LINK}>
            회의록으로 가기
          </GuardedLink>
        </Layout>
      )
    case 'notAwaiting':
      return <NotAwaiting workspaceId={workspaceId} isPm={isPm} {...screen} />
    case 'noLabels':
      return (
        <Layout title="아직 화자를 나누는 중이에요">
          <p className={LEAD}>녹음에서 화자를 나누면 이 화면에서 지정할 수 있어요.</p>
          <Button className="self-start" onClick={screen.retry}>
            다시 확인
          </Button>
        </Layout>
      )
    case 'assigning': {
      const { meeting, view } = screen
      const meta = [meeting.title, seoulDateOf(meeting.startedAt), `화자 ${view.speakers.length}명`]
        .filter((part) => part !== null && part !== '')
        .join(' · ')
      return (
        <Layout title="누가 말했는지 골라 주세요">
          <div className="flex flex-col gap-8">
            <p className={META}>{meta}</p>
            <p className={LEAD}>
              샘플을 들어 보고 화자마다 팀원이나 외부 참석자를 골라 주세요. 모두 고르면 회의 정리를
              이어 가요.
            </p>
          </div>
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

function Layout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className={PAGE}>
      <div className={COLUMN}>
        <h1 className={TITLE}>{title}</h1>
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
}: {
  workspaceId: string
  isPm: boolean
  meeting: Meeting
  status: MeetingStatus
  movedElsewhere: boolean
}) {
  const moved = movedElsewhere ? <p className={LEAD}>다른 곳에서 이미 화자를 지정했어요.</p> : null
  switch (status) {
    case 'processing':
      return (
        <Layout title="회의를 정리하고 있어요">
          {moved}
          <p className={LEAD}>화자 지정이 끝나 회의 정리를 이어 가고 있어요.</p>
          <GuardedLink to={paths.meetingProcessing(workspaceId, meeting.id)} className={LINK}>
            정리 상태 보기
          </GuardedLink>
        </Layout>
      )
    case 'done':
      return (
        <Layout title="정리가 끝났어요">
          {moved}
          <GuardedLink to={paths.meetings(workspaceId, meeting.id)} className={LINK}>
            회의록 보기
          </GuardedLink>
        </Layout>
      )
    case 'failed': {
      const failure = meetingFailure(meeting.failedStage)
      return (
        <Layout title={failure.title}>
          <p className={LEAD}>{failure.description}</p>
          {isPm ? (
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
        <Layout title="화자를 지정할 회의가 아니에요">
          <p className={LEAD}>업로드한 회의만 화자를 지정해요.</p>
          <GuardedLink to={paths.meetings(workspaceId)} className={LINK}>
            회의록으로 가기
          </GuardedLink>
        </Layout>
      )
  }
}
