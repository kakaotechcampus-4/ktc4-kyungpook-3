import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { meetingFailure, meetingListQueryOptions, toMinutesList } from '@/entities/meeting'
import type { MeetingSummary, MinutesList } from '@/entities/meeting'
import { FirstMeetingHint, QuickGuideButton } from '@/features/quick-guide'
import { paths } from '@/shared/config/routes'
import { useLoadingIndicator } from '@/shared/lib/loading-indicator'
import { GuardedLink } from '@/shared/lib/unsaved-changes'
import { Reveal } from '@/shared/ui/deferred-skeleton'
import { EmptyState } from '@/shared/ui/empty-state'
import { Icon } from '@/shared/ui/icon'
import { QueryErrorState } from '@/shared/ui/query-error-state'
import { MinutesDetailSkeleton, MinutesListSkeleton } from '@/shared/ui/page-skeleton'
import { listMeta, sourceBadge } from '../lib/format'
import { prefetchMinutes } from '../lib/prefetchMinutes'
import { useShownMeeting } from '../model/useShownMeeting'
import { DeletedMeeting, MinutesDetail, UnavailableMeeting } from './MinutesDetail'

/* Meetings 캔버스 실측 — 왼쪽 목록 308 · 오른쪽 선, 목록 제목 17px, 행 위아래 13 · 좌우 14 · 라운드 10 · 간격 4 */
/* 폭 768 미만은 목록 위 · 본문 아래 한 열이다(D-180). 목록 아래 선이 본문과 가른다 */
const ASIDE =
  'flex w-aside shrink-0 flex-col border-r border-divider max-md:w-full max-md:border-r-0 max-md:border-b'
/* 머리 줄은 PM 의 `회의 올리기`(32px) 높이로 고정한다(위 18 + 32 + 아래 14). 팀원은 버튼이 없어 줄이 낮아지면 목록이 역할마다
   다른 자리에서 시작하고, 역할을 모르는 라우트 스켈레톤(shared/ui/page-skeleton 의 MinutesPageSkeleton)과 어긋난다 */
const ASIDE_HEAD = 'flex min-h-64 items-center justify-between gap-12 px-20 pt-18 pb-14'
const ASIDE_TITLE = 'text-[17px] leading-[1.55] font-bold tracking-h2 text-ink'
const LIST = 'flex flex-col gap-4 px-12'
const ROW =
  'group flex w-full flex-col items-start gap-6 rounded-10 px-14 py-13 text-left hover:bg-surface-sunken aria-[current=page]:bg-surface-selected'
const ROW_TITLE =
  'text-body text-sub group-hover:text-ink group-aria-[current=page]:font-semibold group-aria-[current=page]:text-ink'
const ROW_META = 'text-meta text-dim tabular-nums'
/* 행 글자와 같은 줄에 앉는다 — 목록 여백 12 + 행 여백 14 */
const GROUP_LABEL = 'px-26 pt-8 pb-2 text-meta font-semibold text-dim'
const STATUS_BADGE =
  'inline-flex h-18 shrink-0 items-center gap-5 rounded-6 bg-control px-6 text-[10.5px] leading-none font-semibold text-sub'
/* 업로드 진입. PM 만 본다 — 캔버스의 검색 자리다(검색은 범위 밖) */
const UPLOAD_LINK =
  'inline-flex h-32 items-center gap-6 rounded-9 bg-ink-solid px-12 text-control font-semibold text-surface hover:bg-dim active:bg-sub'
const EMPTY_PAGE = 'flex flex-1 items-center justify-center px-48 pt-48 pb-96 max-md:px-20'
const EMPTY_UPLOAD =
  'inline-flex h-40 items-center justify-center rounded-9 bg-ink-solid px-20 text-body leading-none font-semibold text-surface hover:bg-dim active:bg-sub'
/* 업로드 옆의 보조 액션. 같은 높이의 컨트롤 면이다 */
const EMPTY_GUIDE =
  'inline-flex h-40 items-center justify-center rounded-9 bg-control px-20 text-body leading-none font-semibold text-ink hover:bg-line-strong'

export interface MeetingMinutesProps {
  workspaceId: string
  /** URL 이 가리키는 회의. 없으면 null — 기본 선택은 페이지가 URL 을 바꿔서 한다 (U5-1) */
  meetingId: string | null
  /** URL 에 회의 조각이 있는데 ID 모양이 아니다 */
  invalidMeetingId?: boolean
  /** 소속 목록의 역할이 PM 이다. 업로드 CTA, 확인이 필요한 일(회의록 권한과 함께)에 쓴다 */
  isPm: boolean
}

/**
 * 회의록 화면 (M5 U5) — 왼쪽 목록, 오른쪽 고른 회의의 회의록. 회의·회의록·추출·승인 네 엔티티를 조합한다 (계획 §2).
 * 고른 회의는 URL 이 정한다. 그래서 목록을 다시 받아도 명시적으로 고른 회의는 그대로다.
 * 원본 재생·검색·Notion에서 보기·되돌리기는 넣지 않는다 (계획 §1, G6).
 */
export function MeetingMinutes({
  workspaceId,
  meetingId,
  invalidMeetingId = false,
  isPm,
}: MeetingMinutesProps) {
  const [deletedId, setDeletedId] = useState<string | null>(null)
  const list = useQuery({ ...meetingListQueryOptions(workspaceId), select: toMinutesList })
  // 고른 회의의 목록 요약 — 본문을 기다리는 동안 머리를 이것으로 먼저 바꾼다. 없으면 이전 회의를 들고 있지 않는다 (UX1-M02)
  const selectedSummary =
    meetingId === null || invalidMeetingId
      ? null
      : (list.data?.minutes.find(({ id }) => id === meetingId) ?? null)
  const shown = useShownMeeting(
    workspaceId,
    invalidMeetingId ? null : meetingId,
    selectedSummary !== null,
    deletedId,
  )
  const selected = meetingId !== null || invalidMeetingId
  // 로딩 자리의 지연·최소 표시 (#508). 본문은 첫 진입(목록 → 기본 회의 → 회의록)을 한 자리로 잰다 — 단계마다 다시 지연하면
  // 뼈대 → 빈 자리 → 뼈대로 깜빡인다. 회의를 바꾼 뒤는 들고 있기 · 최소 뼈대(useShownMeeting)가 정한다
  const listIndicator = useLoadingIndicator(list.data === undefined && list.error === null)
  const pickingDefault =
    !invalidMeetingId &&
    meetingId === null &&
    !(list.data !== undefined && list.data.minutes.length === 0) &&
    !(list.error !== null && list.data === undefined)
  const detailIndicator = useLoadingIndicator(
    !shown.switched &&
      !invalidMeetingId &&
      (pickingDefault || (meetingId !== null && !shown.holding && !shown.settled)),
  )

  // 회의가 하나도 없다 — EmptyMeetings 캔버스 한 장 (U5-2)
  if (
    !selected &&
    !listIndicator.pending &&
    list.data !== undefined &&
    list.data.minutes.length === 0 &&
    list.data.inProgress.length === 0 &&
    list.data.expired.length === 0
  )
    return (
      <main className={EMPTY_PAGE}>
        <MinutesEmpty workspaceId={workspaceId} isPm={isPm} />
      </main>
    )

  let detail
  if (invalidMeetingId) detail = <UnavailableMeeting />
  else if (meetingId !== null && meetingId === deletedId) detail = <DeletedMeeting />
  else if (meetingId !== null && shown.shownId !== null)
    detail = (
      // 새 회의록을 기다리는 잠깐 동안 이전 회의록 본문을 들고 있다 — 머리는 고른 회의, 본문은 흐리게 묶는다 (useShownMeeting).
      // 회의가 바뀌면 탭·상태를 새로 시작한다
      <MinutesDetail
        key={shown.shownId}
        workspaceId={workspaceId}
        meetingId={shown.shownId}
        isPm={isPm}
        onDeleted={setDeletedId}
        // 머리를 요약으로 먼저 바꾸는 것은 회의를 바꿀 때뿐이다 — 첫 진입은 머리 뼈대 그대로 (useShownMeeting)
        selected={shown.holding || shown.switched ? selectedSummary : null}
        holding={shown.holding}
        // 회의를 바꾸며 그린 본문 뼈대는 최소 시간 동안 둔다 — 답이 들고 있기 상한을 막 넘겨 와도 번쩍이지 않는다 (UX1-N03)
        keepSkeleton={shown.keepSkeleton}
        waiting={detailIndicator}
      />
    )
  else if (detailIndicator.pending) detail = <MinutesDetailSkeleton indicator={detailIndicator} />
  else if (list.data !== undefined && list.data.minutes.length === 0)
    detail = (
      <div className="flex justify-center px-36 pt-72 pb-56 max-md:px-20">
        <EmptyState
          titleAs="h2"
          title={
            list.data.expired.length > 0
              ? '기한이 지나 정리가 종료된 회의가 있어요'
              : '아직 정리가 끝난 회의가 없어요'
          }
          description={
            list.data.expired.length > 0
              ? '목록에서 회의를 선택해 만료 사유를 확인해 주세요.'
              : '정리가 끝나면 여기에서 회의록을 볼 수 있어요.'
          }
        />
      </div>
    )
  else if (list.error !== null && list.data === undefined) detail = null
  else
    // 목록을 받는 중이거나, 가장 최근 회의록으로 URL 을 바꾸는 중이다. 라우트 스켈레톤과 같은 본문 뼈대다
    detail = <MinutesDetailSkeleton indicator={detailIndicator} />
  // 첫 진입에서 로딩을 거쳐 나타난 본문만 전환한다. 회의를 바꾼 뒤의 본문은 바로 바뀐다(빠른 답은 깜빡임 없이)
  // 늘 감싼다 — 기다리는 동안에도 MinutesDetail 이 그려져 있어, 감싸기가 바뀌면 다시 마운트되고 상세를 다시 받는다
  detail = (
    <Reveal indicator={{ reveal: detailIndicator.reveal && !shown.switched }}>{detail}</Reveal>
  )

  return (
    <main className="flex flex-1 items-stretch max-md:flex-col">
      <aside aria-label="회의 목록" className={ASIDE}>
        <div className={ASIDE_HEAD}>
          <h1 className={ASIDE_TITLE}>회의록</h1>
          {isPm ? (
            <GuardedLink to={paths.meetingUpload(workspaceId)} className={UPLOAD_LINK}>
              <Icon name="upload" size={14} />
              회의 올리기
            </GuardedLink>
          ) : null}
        </div>
        {listIndicator.pending ? (
          <MinutesListSkeleton indicator={listIndicator} />
        ) : list.data !== undefined ? (
          <Reveal indicator={listIndicator}>
            <MeetingList workspaceId={workspaceId} list={list.data} isPm={isPm} />
          </Reveal>
        ) : (
          <Reveal indicator={listIndicator}>
            <div className="px-20">
              <QueryErrorState
                error={list.error}
                onRetry={() => void list.refetch()}
                title="회의 목록을 불러오지 못했어요"
              />
            </div>
          </Reveal>
        )}
      </aside>
      <section aria-label="회의록 본문" className="flex min-w-[0px] flex-1 flex-col">
        {detail}
      </section>
    </main>
  )
}

function MinutesEmpty({ workspaceId, isPm }: { workspaceId: string; isPm: boolean }) {
  // 캔버스의 `텍스트로 붙여넣기` 는 범위 밖이라 없다 (계획 §1). 업로드 CTA 는 PM 만 (U5-2)
  const guide = <QuickGuideButton className={EMPTY_GUIDE}>방법 보기</QuickGuideButton>
  return isPm ? (
    <EmptyState
      title="아직 올린 회의가 없어요"
      description={
        <>
          <FirstMeetingHint /> 만나서 회의했다면 녹음 파일을 올려도 돼요.
        </>
      }
      action={
        <GuardedLink to={paths.meetingUpload(workspaceId)} className={EMPTY_UPLOAD}>
          회의 올리기
        </GuardedLink>
      }
      secondaryAction={guide}
    />
  ) : (
    <EmptyState title="아직 올린 회의가 없어요" description={<FirstMeetingHint />} action={guide} />
  )
}

function MeetingList({
  workspaceId,
  list,
  isPm,
}: {
  workspaceId: string
  list: MinutesList
  isPm: boolean
}) {
  const queryClient = useQueryClient()
  // 고르기 직전(가리키기·포커스)에 그 회의록을 미리 받는다 — 고른 뒤 스켈레톤 없이 바로 그린다 (prefetchMinutes)
  const prefetch = (meetingId: string) =>
    void prefetchMinutes(queryClient, { workspaceId, meetingId, isPm })
  return (
    <div className="flex flex-col gap-12 pb-24">
      {list.inProgress.length === 0 ? null : (
        <div className="flex flex-col gap-4">
          <p id="meetings-in-progress" className={GROUP_LABEL}>
            진행 중
          </p>
          <ul aria-labelledby="meetings-in-progress" className={LIST}>
            {list.inProgress.map((meeting) => (
              <li key={meeting.id}>
                <InProgressRow workspaceId={workspaceId} meeting={meeting} />
              </li>
            ))}
          </ul>
        </div>
      )}
      {list.minutes.length === 0 ? null : (
        <ul aria-label="정리된 회의" className={LIST}>
          {list.minutes.map((meeting) => (
            <li key={meeting.id}>
              <GuardedLink
                to={paths.meetings(workspaceId, meeting.id)}
                className={ROW}
                onPointerEnter={() => prefetch(meeting.id)}
                onFocus={() => prefetch(meeting.id)}
              >
                <RowTitle meeting={meeting} />
                <span className={ROW_META}>{listMeta(meeting)}</span>
              </GuardedLink>
            </li>
          ))}
        </ul>
      )}
      {list.expired.length === 0 ? null : (
        <div className="flex flex-col gap-4">
          <p id="meetings-expired" className={GROUP_LABEL}>
            기한 만료
          </p>
          <ul aria-labelledby="meetings-expired" className={LIST}>
            {list.expired.map((meeting) => (
              <li key={meeting.id}>
                <GuardedLink to={paths.meetings(workspaceId, meeting.id)} className={ROW}>
                  <RowTitle meeting={meeting} />
                  <span className={STATUS_BADGE}>
                    {meetingFailure(meeting.failedStage).expiredLabel}
                  </span>
                  <span className={ROW_META}>{listMeta(meeting)}</span>
                </GuardedLink>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function SourceBadge({ meeting }: { meeting: MeetingSummary }) {
  const badge = sourceBadge(meeting.source)
  return badge === null ? null : <span className={STATUS_BADGE}>{badge}</span>
}

function RowTitle({ meeting }: { meeting: MeetingSummary }) {
  return (
    <span className="flex w-full items-center gap-8">
      <span className={ROW_TITLE}>{meeting.title === '' ? '제목 없는 회의' : meeting.title}</span>
      <SourceBadge meeting={meeting} />
    </span>
  )
}

function inProgressStatus(
  workspaceId: string,
  meeting: MeetingSummary,
): { label: string; to: string | null } {
  switch (meeting.status) {
    case 'processing':
      return { label: '정리 중', to: paths.meetingProcessing(workspaceId, meeting.id) }
    case 'awaiting_speakers':
      return { label: '화자 지정 필요', to: paths.meetingSpeakers(workspaceId, meeting.id) }
    default:
      return { label: '회의 중', to: null }
  }
}

/**
 * 회의록이 아직 없는 회의의 상태 항목 (U5-2). 정리 중이면 처리 화면, 화자 지정 대기면 지정 화면으로 잇는다.
 * Discord 봇이 기록 중인 회의(`created`·`recording`)는 갈 곳이 없어 상태만 보인다 (U5-9).
 * 채팅 회의도 처리 화면으로 잇는다 — 처리 화면에 채팅 두 단계가 생겼다 (#483, #379 의 「잇지 않는다」를 바꿨다).
 */
function InProgressRow({ workspaceId, meeting }: { workspaceId: string; meeting: MeetingSummary }) {
  const title = meeting.title === '' ? '제목 없는 회의' : meeting.title
  const status = inProgressStatus(workspaceId, meeting)
  const content = (
    <>
      <span className="flex w-full items-center gap-8">
        <span className="flex-1 text-body text-sub group-hover:text-ink">{title}</span>
        <SourceBadge meeting={meeting} />
        <span className={STATUS_BADGE}>
          <span aria-hidden="true" className="size-5 shrink-0 rounded-999 bg-ink-solid" />
          {status.label}
        </span>
      </span>
      <span className={ROW_META}>{listMeta(meeting)}</span>
    </>
  )
  if (status.to === null) return <div className={ROW}>{content}</div>
  return (
    <GuardedLink to={status.to} className={ROW}>
      {content}
    </GuardedLink>
  )
}
