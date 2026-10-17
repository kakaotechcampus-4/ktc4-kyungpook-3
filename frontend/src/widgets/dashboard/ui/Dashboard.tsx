import { useMemo } from 'react'
import type { ReactNode } from 'react'
import type { Approval } from '@/entities/approval'
import type { Member } from '@/entities/member'
import type { Task } from '@/entities/task'
import { isOverdue } from '@/entities/task'
import { TASK_STATUS_LABEL } from '@/features/task-status'
import { paths } from '@/shared/config/routes'
import { seoulDateOf } from '@/shared/lib/date'
import { GuardedLink } from '@/shared/lib/unsaved-changes'
import { Icon } from '@/shared/ui/icon'
import { Skeleton } from '@/shared/ui/skeleton'
import {
  LIST_LIMIT,
  approvalReason,
  approvalTitle,
  clock,
  dateWithWeekday,
  dueSoonTasks,
  durationLabel,
  monthDayLabel,
  objectParticle,
  shortDate,
  taskCounts,
  waitingApprovals,
} from '../lib/dashboard'
import { useDashboardData } from '../model/useDashboardData'
import { dashboardRefreshFailure, useRefreshFailureToast } from '../model/useRefreshFailure'
import type { DashboardData, Loadable } from '../model/useDashboardData'
import {
  ACTION_LINK,
  BADGE,
  EMPTY_NOTE,
  HEAD_LINK,
  Initial,
  RefreshFailedNotice,
  SECTION_HEAD,
  SECTION_TITLE,
  SectionBody,
} from './parts'
import { RecentSection } from './RecentSection'

/* Main 시안 — main 패딩 48/48/72, 블록 사이 32px, 본문은 `1fr | 360px` 두 단(간격 68px) */
const MAIN = 'mx-auto flex w-full max-w-shell flex-1 flex-col gap-32 px-48 pt-48 pb-72'
const HEADER = 'flex items-end justify-between gap-24'
const TITLE = 'text-[32px] leading-[1.4] font-bold tracking-h1 text-ink'
const LEAD = 'text-body text-sub'
const TODAY = 'text-caption text-dim tabular-nums'
const SUMMARY = 'flex flex-wrap items-baseline gap-36 pb-8'
const SUMMARY_ITEM = 'flex items-center gap-5 text-control text-sub'
const SUMMARY_VALUE = 'text-[20px] leading-none font-semibold text-ink tabular-nums'
const COLUMNS = 'grid grid-cols-[minmax(0px,1fr)_360px] items-start gap-[68px]'
const SIDE = 'flex flex-col gap-40'
const REVIEW_ROW = 'flex items-start gap-16 border-b border-line py-18 last:border-b-0'
const REVIEW_TITLE = 'text-[15px] leading-[1.55] font-semibold text-ink'
const DUE_ROW =
  'flex items-center gap-12 px-18 py-12 text-ink hover:bg-surface-sunken focus-visible:-outline-offset-2'

export interface DashboardProps {
  workspaceId: string
  /** 소속 목록의 역할이 PM 이다. 확인 필요와 PM 전용 이동·되돌리기는 PM 에게만 있다 */
  isPm: boolean
  /** 서울 오늘 */
  today: string
  /** 태스크 목록 `확인 필요` 탭 주소 (D-051). 페이지가 목록의 URL 규칙으로 만든다 */
  needsReviewHref: string
  /** 태스크 목록 `진행 중` + `기한 지남·7일 이내` 주소 (D-046) */
  dueSoonHref: string
}

/**
 * 대시보드 (M7, Main 시안). 요약 → 확인 필요 → 마감 임박 → 최근 반영 (D-033, D-055).
 * 영역마다 자기 조회의 로딩·실패를 따로 그린다 — 한 영역이 실패해도 화면 전체를 막지 않고, 실패한 숫자를 0 으로 쓰지 않는다.
 * 일반 팀원에게는 확인 대기 수·확인 필요 영역·PM 전용 이동과 되돌리기가 없고 승인 목록도 부르지 않는다 (D-104, D-163)
 */
export function Dashboard({
  workspaceId,
  isPm,
  today,
  needsReviewHref,
  dueSoonHref,
}: DashboardProps) {
  const data = useDashboardData(workspaceId, isPm)
  // 재조회가 실패해도 영역은 마지막 값을 그대로 그린다. 갱신 실패는 제목 근처 표시 하나와 토스트 한 번으로만 알린다 (E-02)
  const refresh = useRefreshFailureToast(dashboardRefreshFailure(data, isPm))
  const waiting = useMemo(
    () => (data.approvals?.status === 'ready' ? waitingApprovals(data.approvals.data) : null),
    [data.approvals],
  )

  const dueSection = (
    <DueSection
      workspaceId={workspaceId}
      tasks={data.tasks}
      members={data.members}
      today={today}
      dueSoonHref={dueSoonHref}
    />
  )

  return (
    <main className={MAIN}>
      <header className={HEADER}>
        <div className="flex flex-col gap-5">
          {/* 화면 이름은 M4 부터 숨은 h1 `대시보드` 다 — 진입 판정이 기대는 이름이라 그대로 두고, 상태 문장은 그 아래 큰 글자다 */}
          <h1 className="sr-only">대시보드</h1>
          <p className={TITLE}>{headline(isPm, waiting)}</p>
          <MeetingLead data={data} />
          {refresh === undefined ? null : <RefreshFailedNotice failure={refresh} />}
        </div>
        <time dateTime={today} className={TODAY}>
          {dateWithWeekday(today)}
        </time>
      </header>

      <Summary isPm={isPm} data={data} waiting={waiting} today={today} />

      <div className={COLUMNS}>
        {isPm ? (
          <ReviewSection
            workspaceId={workspaceId}
            approvals={data.approvals ?? { status: 'loading' }}
            needsReviewHref={needsReviewHref}
          />
        ) : (
          dueSection
        )}
        <div className={SIDE}>
          {isPm ? dueSection : null}
          <RecentSection workspaceId={workspaceId} isPm={isPm} data={data} />
        </div>
      </div>
    </main>
  )
}

/** 제목 (D-062, D-064). 개수는 쓰지 않는다. 승인 목록을 아직 모르면 중립 제목이다. 일반 팀원은 늘 중립 제목이다 */
function headline(isPm: boolean, waiting: readonly Approval[] | null): string {
  if (!isPm || waiting === null) return '워크스페이스 현황'
  return waiting.length > 0 ? '확인이 필요한 일이 있어요' : '확인이 필요한 일이 없어요'
}

/** 제목 아래 최근 처리 회의 안내 (D-063, D-065). 정보 문구라 링크가 아니다 */
function MeetingLead({ data }: { data: DashboardData }) {
  if (data.meetings.status === 'loading') return <Skeleton width={240} />
  if (data.meetings.status === 'error')
    return <p className={LEAD}>최근 회의 정보를 불러오지 못했어요</p>
  const meeting = data.recent
  if (meeting === null || meeting === undefined)
    return <p className={LEAD}>아직 정리한 회의가 없어요</p>
  const date = seoulDateOf(meeting.meeting.startedAt)
  const duration = durationLabel(meeting.meeting.durationMs)
  const { title } = meeting.meeting
  return (
    <p className={LEAD}>
      {date === null ? '' : `${monthDayLabel(date)} `}
      {title}
      {objectParticle(title)} 정리했어요
      {duration === null ? null : (
        <>
          {' · '}
          <span className="text-dim tabular-nums">{duration}</span> 분량
        </>
      )}
    </p>
  )
}

interface SummaryProps {
  isPm: boolean
  data: DashboardData
  waiting: readonly Approval[] | null
  today: string
}

/** 상단 요약 넷 (D-052~D-056, D-061). 전체 데이터로 센다. 모두 정보라 누를 수 없다 */
function Summary({ isPm, data, waiting, today }: SummaryProps) {
  const counts = useMemo(
    () => (data.tasks.status === 'ready' ? taskCounts(data.tasks.data, today) : null),
    [data.tasks, today],
  )
  const taskState = data.tasks.status
  const approvalState = data.approvals?.status ?? 'ready'
  return (
    <div className="flex flex-col gap-8">
      <dl aria-label="현황 요약" className={SUMMARY}>
        {isPm ? (
          <SummaryItem label="확인 대기" state={approvalState} value={waiting?.length} />
        ) : null}
        <SummaryItem label="기한 지남" state={taskState} value={counts?.overdue} />
        <SummaryItem label="7일 이내 마감" state={taskState} value={counts?.dueSoon} />
        <SummaryItem label="막힌 일" state={taskState} value={counts?.blocked} />
      </dl>
    </div>
  )
}

function SummaryItem({
  label,
  state,
  value,
}: {
  label: string
  state: Loadable<unknown>['status']
  value: number | undefined
}) {
  let shown: ReactNode
  if (state === 'error' || (state === 'ready' && value === undefined))
    shown = (
      <>
        <span aria-hidden="true">–</span>
        <span className="sr-only">불러오지 못했어요</span>
      </>
    )
  else if (state === 'loading' || value === undefined)
    shown = (
      <>
        <Skeleton variant="block" width={18} height={18} aria-hidden="true" />
        <span className="sr-only">불러오는 중</span>
      </>
    )
  else shown = value
  return (
    <div className={SUMMARY_ITEM}>
      <dt>{label}</dt>
      <dd className={SUMMARY_VALUE}>{shown}</dd>
    </div>
  )
}

interface ReviewSectionProps {
  workspaceId: string
  approvals: Loadable<Approval[]>
  needsReviewHref: string
}

/** 확인이 필요한 일 (PM). 대기 시작 오래된 순으로 5개, 나머지는 태스크의 확인 필요 탭에서 (D-049~D-051, D-162) */
function ReviewSection({ workspaceId, approvals, needsReviewHref }: ReviewSectionProps) {
  return (
    <section aria-labelledby="dashboard-review">
      <div className={SECTION_HEAD}>
        <h2 id="dashboard-review" className={`${SECTION_TITLE} text-[15px]`}>
          확인이 필요한 일
        </h2>
        <GuardedLink to={needsReviewHref} className={HEAD_LINK}>
          태스크에서 전부 보기
          <Icon name="chevron-right" size={13} />
        </GuardedLink>
      </div>
      <SectionBody state={approvals} errorTitle="확인이 필요한 일을 불러오지 못했어요">
        {(list) => {
          const shown = waitingApprovals(list).slice(0, LIST_LIMIT)
          if (shown.length === 0) return <p className={EMPTY_NOTE}>지금 확인할 일이 없어요.</p>
          return (
            <ul aria-label="확인이 필요한 일 목록">
              {shown.map((approval) => (
                <ReviewRow key={approval.id} workspaceId={workspaceId} approval={approval} />
              ))}
            </ul>
          )
        }}
      </SectionBody>
    </section>
  )
}

function ReviewRow({ workspaceId, approval }: { workspaceId: string; approval: Approval }) {
  const hold = approval.kind === 'task_create' && approval.gate === 'hold'
  const title = approvalTitle(approval)
  const at =
    approval.kind === 'task_create' && approval.evidence.atMs !== null
      ? clock(approval.evidence.atMs)
      : null
  return (
    <li className={REVIEW_ROW}>
      <div className="flex min-w-[0px] flex-1 flex-col gap-9">
        <div className="flex flex-wrap items-center gap-10">
          {hold ? (
            <span className={`${BADGE} bg-control text-sub`}>보류</span>
          ) : (
            <span className={`${BADGE} bg-ink text-surface`}>
              <span aria-hidden="true" className="mr-3 h-5 w-5 rounded-999 bg-current" />
              확인 필요
            </span>
          )}
          <span className={`${REVIEW_TITLE} ${hold ? 'text-sub' : ''}`}>{title}</span>
          {at === null ? null : <span className="text-meta text-dim tabular-nums">{at}</span>}
        </div>
        <p className="text-control font-normal text-sub">{approvalReason(approval)}</p>
      </div>
      {/* D-034·D-162: 처리는 확인 필요 상세에서 한다. 보류는 `채워 넣기` 다 */}
      {/* 행마다 같은 글자라 읽는 이름에 제목을 붙인다. 보이는 글자로 시작한다 */}
      <GuardedLink
        to={paths.approval(workspaceId, approval.id)}
        className={ACTION_LINK}
        aria-label={`${hold ? '채워 넣기' : '확인하기'} — ${title}`}
      >
        {hold ? '채워 넣기' : '확인하기'}
        <Icon name="chevron-right" size={13} />
      </GuardedLink>
    </li>
  )
}

interface DueSectionProps {
  workspaceId: string
  tasks: Loadable<Task[]>
  members: Loadable<Member[]>
  today: string
  dueSoonHref: string
}

/** 마감 임박. 기한 지남을 먼저, 그다음 가까운 마감 순으로 5개. 넘치면 목록의 같은 조건으로 (D-043~D-048) */
function DueSection({ workspaceId, tasks, members, today, dueSoonHref }: DueSectionProps) {
  const names = useMemo(
    () =>
      members.status === 'ready'
        ? new Map(members.data.map(({ id, displayName }) => [id, displayName]))
        : null,
    [members],
  )
  const due = useMemo(
    () => (tasks.status === 'ready' ? dueSoonTasks(tasks.data, today) : []),
    [tasks, today],
  )
  return (
    <section aria-labelledby="dashboard-due">
      <div className={SECTION_HEAD}>
        <h2 id="dashboard-due" className={SECTION_TITLE}>
          마감 임박
        </h2>
        {due.length > LIST_LIMIT ? (
          <GuardedLink to={dueSoonHref} className={HEAD_LINK}>
            전체 보기
            <Icon name="chevron-right" size={13} />
          </GuardedLink>
        ) : null}
      </div>
      <SectionBody state={tasks} errorTitle="태스크를 불러오지 못했어요">
        {() =>
          due.length === 0 ? (
            <p className={EMPTY_NOTE}>마감이 임박한 태스크가 없습니다</p>
          ) : (
            <ul aria-label="마감 임박 목록">
              {due.slice(0, LIST_LIMIT).map((task) => (
                <li key={task.id} className="border-b border-line last:border-b-0">
                  <DueRow
                    workspaceId={workspaceId}
                    task={task}
                    assignee={
                      task.assigneeMemberId === null
                        ? null
                        : (names?.get(task.assigneeMemberId) ?? null)
                    }
                    overdue={isOverdue(task, today)}
                  />
                </li>
              ))}
            </ul>
          )
        }
      </SectionBody>
    </section>
  )
}

interface DueRowProps {
  workspaceId: string
  task: Task
  assignee: string | null
  overdue: boolean
}

/** 행 전체가 태스크 상세 링크다 (D-047). 지난 마감은 경고색 `기한 지남` 으로 구분한다 (D-044) */
function DueRow({ workspaceId, task, assignee, overdue }: DueRowProps) {
  const dueDate = task.dueDate ?? ''
  return (
    <GuardedLink
      to={paths.tasks(workspaceId, task.id)}
      className={DUE_ROW}
      data-overdue={overdue || undefined}
    >
      <time
        dateTime={dueDate}
        className={`w-[42px] shrink-0 text-[12px] tabular-nums ${overdue ? 'font-semibold text-accent' : 'text-dim'}`}
      >
        {shortDate(dueDate)}
      </time>
      <span className="min-w-[0px] flex-1 truncate text-control font-normal text-ink">
        {task.title}
      </span>
      {overdue ? (
        <span className={`${BADGE} border border-accent bg-surface text-accent`}>기한 지남</span>
      ) : null}
      {/* 상태 문구 길이(막힘·진행 중)가 달라도 앞의 `기한 지남` 위치가 행마다 같도록 폭을 고정한다 */}
      <span className="w-[44px] shrink-0 text-meta whitespace-nowrap text-dim">
        {TASK_STATUS_LABEL[task.status]}
      </span>
      <Initial name={assignee} />
      <span className="sr-only">{assignee === null ? '담당자 없음' : `담당 ${assignee}`}</span>
    </GuardedLink>
  )
}
