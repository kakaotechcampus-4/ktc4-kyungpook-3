import { useQuery } from '@tanstack/react-query'
import { useId, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  APPROVAL_RESOLUTION_REASONS,
  approvalDetailQueryOptions,
  dueFillSuggestion,
  isScopeChange,
  mergedCount,
  planApprovalResolution,
  taskCreateValues,
  taskUpdateChanges,
} from '@/entities/approval'
import type {
  Approval,
  ApprovalMissing,
  MergedApprovalItem,
  TaskCreateApproval,
  TaskCreateFields,
  TaskUpdateApproval,
  UnsupportedApproval,
} from '@/entities/approval'
import { evidenceMoment, meetingListQueryOptions } from '@/entities/meeting'
import type { MeetingSummary } from '@/entities/meeting'
import {
  memberListQueryOptions,
  recordMemberListQueryOptions,
  speakerName,
} from '@/entities/member'
import type { Member } from '@/entities/member'
import { taskDetailQueryOptions } from '@/entities/task'
import {
  ApprovalActions,
  TaskCreateOverrideFields,
  TaskUpdateOverrideFields,
  openGaps,
  useApprovalResolve,
  useTaskCreateOverrides,
  useTaskUpdateOverrides,
} from '@/features/approval-resolve'
import type {
  ApprovalResolve,
  ApprovalResolveProblem,
  TaskCreateOverrides,
} from '@/features/approval-resolve'
import { TaskNotionSyncStatus } from '@/features/task-notion-sync'
import { ApiError, ERROR_CODES } from '@/shared/api/errors'
import { paths } from '@/shared/config/routes'
import { formatMonthDayWeekday, formatSeoulDateTime, seoulDateOf } from '@/shared/lib/date'
import { GuardedLink, useUnsavedChanges } from '@/shared/lib/unsaved-changes'
import { useLoadingIndicator } from '@/shared/lib/loading-indicator'
import { EmptyState } from '@/shared/ui/empty-state'
import { FormErrorPanel } from '@/shared/ui/form-error-panel'
import { Icon } from '@/shared/ui/icon'
import { QueryErrorState } from '@/shared/ui/query-error-state'
import { DeferredSkeleton, Reveal } from '@/shared/ui/deferred-skeleton'
import {
  approvalHeading,
  approvalStatusLabel,
  currentFieldValue,
  fieldLabel,
  fieldValueLabel,
  fillLabel,
  gapReason,
  gapSummary,
  memberLabel,
} from '../lib/approvalView'
import { ApprovalSkeleton } from './ApprovalSkeleton'
import { BACK, CARD, CARD_BODY, CARD_FOOT, EVIDENCE, ROOT } from './frame'

const TITLE = 'text-[30px] leading-[1.3] font-bold tracking-h2 text-ink'
const LEAD = 'text-[15px] leading-[1.6] text-sub'
const META = 'text-meta text-dim tabular-nums'
const CARD_HEAD =
  'flex flex-wrap items-center justify-between gap-x-16 gap-y-6 border-b border-divider px-20 py-14'
const CARD_TITLE = 'flex items-center gap-10 text-[14px] font-normal text-ink'
const ATTENTION_BADGE =
  'inline-flex h-22 shrink-0 items-center gap-6 rounded-6 bg-ink px-9 text-[12px] leading-none font-semibold text-surface'
const RESOLVED_BADGE =
  'inline-flex h-22 shrink-0 items-center rounded-6 bg-control px-9 text-[12px] leading-none font-semibold text-dim'
const HEAD_LINK = 'inline-flex items-center gap-5 text-[13px] text-sub hover:text-ink tabular-nums'
const EVIDENCE_HEAD = 'flex flex-wrap items-center justify-between gap-x-12 gap-y-4'
const EVIDENCE_META = 'text-caption text-dim tabular-nums'
const QUOTE = 'text-[15px] leading-[1.6] font-bold text-ink'
const RAW = 'text-[13px] text-sub'
const NOTE = 'text-caption text-sub'
const BLOCK_TITLE = 'text-caption font-semibold text-dim'
const PANEL = 'flex flex-col gap-10 rounded-16 bg-surface-sunken px-20 py-18'
const FILL_BUTTON =
  'inline-flex min-h-44 shrink-0 items-center px-4 text-[14px] font-bold whitespace-nowrap text-ink hover:text-sub'
const FIELDS = 'grid grid-cols-[120px_1fr] gap-x-16 gap-y-12'
const TERM = 'text-caption font-semibold text-dim'
const VALUE = 'text-body text-ink tabular-nums'
const MISSING = 'text-body font-semibold text-accent'
const TABLE = 'w-full border-collapse text-left text-body text-ink'
const TH = 'border-b border-line py-8 pr-16 text-caption font-semibold text-dim'
const TD = 'border-b border-line py-10 pr-16 tabular-nums'
const LINK = 'text-body font-semibold text-ink underline underline-offset-4 hover:text-sub'
const ALERT = 'flex flex-col gap-12 rounded-16 border border-line-strong px-20 py-18'
const SECTION_TITLE = 'text-[17px] leading-[1.55] font-bold tracking-h2 text-ink'
const ASSIGNEE_MARK =
  'inline-flex h-20 shrink-0 items-center rounded-6 bg-control px-7 text-[11px] leading-none font-semibold text-sub'
const TOGGLE =
  'self-start text-caption font-semibold text-sub underline-offset-2 hover:text-ink hover:underline'
const MERGED_QUOTE = 'text-body leading-[1.6] font-semibold text-ink'

const MEMBERS_LOADING_REASON = '팀원 목록을 불러온 뒤 승인할 수 있어요.'

export interface ApprovalReviewProps {
  workspaceId: string
  approvalId: string
  /**
   * 대시보드 `채워 넣기` 로 들어왔다 (D-176). 마운트할 때 한 번만 읽는다 — 페이지가 곧 기록에서 지워 false 가 된다.
   * key=approvalId 라 승인마다 새로 읽는다
   */
  fillInOnArrival?: boolean
}

function isUnavailable(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    (error.code === ERROR_CODES.APPROVAL_NOT_FOUND ||
      (error.kind === 'http' && error.status === 404))
  )
}

/**
 * 확인 필요 상세 (계획 §4, E-6). PM 가드를 통과해야 마운트된다 — 승인 조회는 여기서 처음 시작한다.
 * 대기 중인 승인은 값·근거·까닭을 한 카드에 두고 그 자리에서 고친다. 승인·반려는 서버 성공 뒤에 반영하고,
 * 처리된 승인은 결과와 태스크·Notion 상태를 같은 화면에 남긴다
 */
export function ApprovalReview({
  workspaceId,
  approvalId,
  fillInOnArrival = false,
}: ApprovalReviewProps) {
  const approval = useQuery(approvalDetailQueryOptions(workspaceId, approvalId))
  const [fillIn] = useState(fillInOnArrival)
  const indicator = useLoadingIndicator(approval.isPending)

  let body: ReactNode
  if (approval.data !== undefined)
    body = <ApprovalBody workspaceId={workspaceId} approval={approval.data} fillIn={fillIn} />
  else if (approval.error !== null && isUnavailable(approval.error))
    body = <UnavailableApproval workspaceId={workspaceId} />
  else if (approval.error !== null)
    body = (
      <QueryErrorState
        error={approval.error}
        title="확인 요청을 불러오지 못했어요"
        onRetry={() => void approval.refetch()}
      />
    )
  else body = null
  body = indicator.pending ? (
    <DeferredSkeleton indicator={indicator}>
      <ApprovalSkeleton />
    </DeferredSkeleton>
  ) : (
    <Reveal indicator={indicator}>{body}</Reveal>
  )

  return (
    <main className={ROOT}>
      <GuardedLink to={paths.tasks(workspaceId)} className={BACK}>
        <Icon name="chevron-left" size={14} />
        태스크 목록
      </GuardedLink>
      {approval.data === undefined || indicator.pending ? (
        <h1 className="sr-only">확인 필요</h1>
      ) : null}
      {body}
    </main>
  )
}

export function UnavailableApproval({ workspaceId }: { workspaceId: string }) {
  return (
    <div className="flex justify-center pt-32">
      <EmptyState
        titleAs="h2"
        title="확인 요청을 찾을 수 없어요"
        description="삭제됐거나 이 워크스페이스의 확인 요청이 아니에요."
        action={
          <GuardedLink to={paths.tasks(workspaceId)} className={LINK}>
            태스크 목록으로
          </GuardedLink>
        }
      />
    </div>
  )
}

function useMemberNames(members: readonly Member[] | undefined): ReadonlyMap<string, string> {
  return useMemo(
    () => new Map((members ?? []).map(({ id, displayName }) => [id, displayName])),
    [members],
  )
}

/** 리뷰가 함께 읽는 것. 회의 목록은 처리 추적이 이미 받는 목록이다 — 같은 key 라 따로 요청하지 않는다 */
interface ReviewContext {
  workspaceId: string
  members: readonly Member[] | undefined
  recordMembers: readonly Member[] | undefined
  names: ReadonlyMap<string, string>
  meeting: MeetingSummary | undefined
  /** 합쳐진 근거의 회의를 찾는다. 아직 모르면 undefined */
  meetings: readonly MeetingSummary[] | undefined
  resolver: ApprovalResolve
}

function ApprovalBody({
  workspaceId,
  approval,
  fillIn,
}: {
  workspaceId: string
  approval: Approval
  fillIn: boolean
}) {
  const members = useQuery(memberListQueryOptions(workspaceId))
  const recordMembers = useQuery(recordMemberListQueryOptions(workspaceId))
  const meetings = useQuery(meetingListQueryOptions(workspaceId))
  const memberIds = useMemo(() => (members.data ?? []).map(({ id }) => id), [members.data])
  const names = useMemberNames(recordMembers.data ?? members.data)
  const resolver = useApprovalResolve(workspaceId, approval.id, memberIds)
  const meetingId = approval.kind === 'unsupported' ? null : approval.meetingId
  const context: ReviewContext = {
    workspaceId,
    members: members.data,
    recordMembers: recordMembers.data ?? members.data,
    names,
    meeting: meetings.data?.find(({ id }) => id === meetingId),
    meetings: meetings.data,
    resolver,
  }

  return (
    <>
      {approval.kind === 'unsupported' ? (
        <UnsupportedReview approval={approval} />
      ) : approval.status !== 'pending' ? (
        <ResolvedReview approval={approval} context={context} />
      ) : approval.kind === 'task_create' ? (
        <TaskCreatePending approval={approval} context={context} fillIn={fillIn} />
      ) : (
        <TaskUpdatePending approval={approval} context={context} />
      )}
      {approval.status === 'pending' ? null : (
        <ResolutionResult
          workspaceId={workspaceId}
          approval={approval}
          problem={resolver.problem}
        />
      )}
    </>
  )
}

/** 처리 실패 중 칸·충돌이 아닌 것. 이미 처리됨은 결과 영역이 알린다 */
function problemMessage(problem: ApprovalResolveProblem | null): string | null {
  return problem?.kind === 'error' || problem?.kind === 'changed' ? problem.message : null
}

type ReviewedApproval = TaskCreateApproval | TaskUpdateApproval

function meetingTitleOf(approval: ReviewedApproval, meeting: MeetingSummary | undefined) {
  return approval.meetingId === null ? null : (meeting?.title ?? '연결된 회의')
}

/** 제목과 그 아래 한 줄 — 어디서 나온 일인지와 빠진 값 안내 */
function ReviewHeader({
  approval,
  context,
  summary,
}: {
  approval: ReviewedApproval
  context: ReviewContext
  summary: string | null
}) {
  const meetingTitle = meetingTitleOf(approval, context.meeting)
  const what = approval.kind === 'task_create' ? '일' : '변경'
  const replied = approval.kind === 'task_update' && approval.replyMessageId !== null
  const sender = speakerName(context.recordMembers, approval.evidence)
  return (
    <div className="flex flex-col gap-10">
      <h1 className={TITLE}>{approvalHeading(approval)}</h1>
      {approval.requestedBy === null && approval.resolvedBy === null ? null : (
        <p className={META}>
          {approval.requestedBy === null
            ? null
            : `요청한 사람 ${context.names.get(approval.requestedBy) ?? '알 수 없는 팀원'}`}
          {approval.requestedBy !== null && approval.resolvedBy !== null ? ' · ' : null}
          {approval.resolvedBy === null
            ? null
            : `처리한 사람 ${context.names.get(approval.resolvedBy) ?? '알 수 없는 팀원'}`}
        </p>
      )}
      {approval.status === 'pending' ? (
        <p className={LEAD}>
          {replied ? (
            <>
              <b className="font-bold text-ink">{sender ?? '팀원'}</b>의 리마인드 답장에서 나온{' '}
              {what}이에요.{' '}
            </>
          ) : meetingTitle === null ? null : (
            <>
              <b className="font-bold text-ink">{meetingTitle}</b>에서 나온 {what}이에요.{' '}
            </>
          )}
          {summary}
        </p>
      ) : (
        <p className={META}>
          {approvalStatusLabel(approval)} · 요청 {formatSeoulDateTime(approval.createdAt)}
        </p>
      )}
    </div>
  )
}

/** 흰 카드. 머리 줄은 상태 배지 + 무엇이 Notion 에 올라가는지 + 출처 회의 */
function ReviewCard({
  approval,
  context,
  title,
  children,
  footer,
}: {
  approval: ReviewedApproval
  context: ReviewContext
  title: string
  children: ReactNode
  footer?: ReactNode
}) {
  const titleId = useId()
  const meetingTitle = meetingTitleOf(approval, context.meeting)
  const clock = evidenceMoment(context.meeting, approval.evidence.atMs)
  return (
    <section aria-labelledby={titleId} className={CARD}>
      <div className={CARD_HEAD}>
        <h2 className={CARD_TITLE}>
          {approval.status === 'pending' ? (
            <span className={ATTENTION_BADGE}>
              <span aria-hidden="true" className="h-5 w-5 rounded-999 bg-surface" />
              확인 필요
            </span>
          ) : (
            <span className={RESOLVED_BADGE}>{approvalStatusLabel(approval)}</span>
          )}
          <span id={titleId}>{title}</span>
        </h2>
        {approval.meetingId === null || meetingTitle === null ? null : (
          <GuardedLink
            to={paths.meetings(context.workspaceId, approval.meetingId)}
            className={HEAD_LINK}
          >
            {meetingTitle}
            {clock === null ? null : ` ${clock}`}
            <Icon name="external" size={12} />
          </GuardedLink>
        )}
      </div>
      <div className={CARD_BODY}>{children}</div>
      {footer === undefined ? null : <div className={CARD_FOOT}>{footer}</div>}
    </section>
  )
}

/** 근거 인용·출처. 회의면 전사문 시각·화자와 원문 듣기, 리마인드 답장이면 보낸 팀원만 밝힌다 (#344) */
function EvidenceFigure({
  approval,
  context,
  gaps,
}: {
  approval: ReviewedApproval
  context: ReviewContext
  gaps: readonly ApprovalMissing[]
}) {
  const { quote, atMs } = approval.evidence
  const speaker = speakerName(context.recordMembers, approval.evidence) ?? '알 수 없음'
  const replied = approval.kind === 'task_update' && approval.replyMessageId !== null
  return (
    <figure aria-label="근거" className="flex flex-col gap-8">
      <figcaption className={EVIDENCE_HEAD}>
        {replied ? (
          // 답장에는 회의도 회의 안 시각도 없다. 보낸 팀원만 밝힌다
          <span className={EVIDENCE_META}>리마인드 답장 · {speaker}</span>
        ) : (
          <span className={EVIDENCE_META}>
            전사문 {evidenceMoment(context.meeting, atMs) ?? '시각 알 수 없음'} · {speaker}
          </span>
        )}
        {replied || approval.meetingId === null ? null : (
          <GuardedLink
            to={paths.meetings(context.workspaceId, approval.meetingId)}
            className={HEAD_LINK}
          >
            원문 듣기
            <Icon name="external" size={12} />
          </GuardedLink>
        )}
      </figcaption>
      {quote === null ? (
        <p className={NOTE}>근거 문장이 없어요.</p>
      ) : (
        <blockquote className={QUOTE}>“{quote}”</blockquote>
      )}
      {approval.kind === 'task_create' && approval.mergedItems.length === 0 ? (
        <RawLine approval={approval} gaps={gaps} />
      ) : null}
    </figure>
  )
}

/**
 * 카드의 원문 담당자·마감. 합친 카드는 이 값이 담당자·마감을 정한 다른 회의의 원문이라, 대표 근거 밖에서
 * 합친 제안의 원문이라고 밝힌다 (#512)
 */
function RawLine({
  approval,
  gaps,
}: {
  approval: TaskCreateApproval
  gaps: readonly ApprovalMissing[]
}) {
  return (
    <p className={RAW}>
      {approval.mergedItems.length === 0 ? null : '합친 제안의 '}
      원문 담당자 <RawValue value={approval.assigneeRaw} missing={gaps.includes('assignee')} /> ·
      원문 마감 <RawValue value={approval.dueRaw} missing={gaps.includes('due')} />
    </p>
  )
}

/** 빠진 값의 원문은 accent 글자다 */
function RawValue({ value, missing }: { value: string | null; missing: boolean }) {
  return <b className={missing ? 'font-bold text-accent' : 'font-normal'}>{value ?? '없음'}</b>
}

/** 근거 블록(연회색). 범위 변경·팀원 답장은 그 설명을 근거와 같은 블록에 둔다 (#205, #344) */
function EvidenceBlock({
  approval,
  context,
  gaps = [],
}: {
  approval: ReviewedApproval
  context: ReviewContext
  gaps?: readonly ApprovalMissing[]
}) {
  const titleId = useId()
  const figure = <EvidenceFigure approval={approval} context={context} gaps={gaps} />
  if (approval.kind === 'task_create')
    return <CreateEvidence approval={approval} context={context} figure={figure} gaps={gaps} />
  const scope = isScopeChange(approval)
  if (!scope && approval.replyMessageId === null) return <div className={EVIDENCE}>{figure}</div>
  return (
    <section aria-labelledby={titleId} className={EVIDENCE}>
      <h3 id={titleId} className={BLOCK_TITLE}>
        {scope ? '범위 변경' : '팀원 답장'}
      </h3>
      {approval.docText === null ? (
        scope ? (
          <p className={NOTE}>설명이 없어요.</p>
        ) : null
      ) : (
        <p className="text-body text-ink">{approval.docText}</p>
      )}
      {figure}
    </section>
  )
}

/**
 * 생성 승인의 근거 (#512). 합쳐진 카드면 카드를 만든 회의의 대표 근거와 합친 내용(합친 제안의 원문,
 * 뒤에 합쳐진 근거)을 나누고, 담당자를 정한 근거(`assigneeItemId`)에 표시한다. 합쳐진 근거는 펼쳐 본다
 */
function CreateEvidence({
  approval,
  context,
  figure,
  gaps,
}: {
  approval: TaskCreateApproval
  context: ReviewContext
  figure: ReactNode
  gaps: readonly ApprovalMissing[]
}) {
  const titleId = useId()
  const mergedId = useId()
  const listId = useId()
  const [open, setOpen] = useState(false)
  const count = mergedCount(approval)
  if (count === null) return <div className={EVIDENCE}>{figure}</div>
  return (
    <div className={EVIDENCE}>
      <section aria-labelledby={titleId} className="flex flex-col gap-10">
        <h3 id={titleId} className={`${BLOCK_TITLE} flex items-center gap-8`}>
          대표 근거 · 카드를 만든 회의
          {approval.assigneeItemId === approval.extractionItemId ? <AssigneeMark /> : null}
        </h3>
        {figure}
      </section>
      <section
        aria-labelledby={mergedId}
        className="flex flex-col gap-12 border-t border-divider pt-12"
      >
        <h3 id={mergedId} className="sr-only">
          합친 내용
        </h3>
        <p className={NOTE}>
          회의 {count.meetings}곳의 항목 {count.items}개를 합친 확인 요청이에요. 제목·담당자·마감은
          합친 뒤의 값이에요.
        </p>
        <RawLine approval={approval} gaps={gaps} />
        <button
          type="button"
          aria-expanded={open}
          aria-controls={listId}
          className={TOGGLE}
          onClick={() => setOpen((value) => !value)}
        >
          {`합쳐진 근거 ${approval.mergedItems.length}건 ${open ? '접기' : '보기'}`}
        </button>
        <ol id={listId} hidden={!open} aria-label="합쳐진 근거" className="flex flex-col gap-14">
          {open
            ? approval.mergedItems.map((item, index) => (
                <MergedEvidence
                  key={item.extractionItemId ?? index}
                  item={item}
                  context={context}
                  decidesAssignee={
                    item.extractionItemId !== null &&
                    item.extractionItemId === approval.assigneeItemId
                  }
                />
              ))
            : null}
        </ol>
      </section>
    </div>
  )
}

function AssigneeMark() {
  return <span className={ASSIGNEE_MARK}>담당자 근거</span>
}

function MergedEvidence({
  item,
  context,
  decidesAssignee,
}: {
  item: MergedApprovalItem
  context: ReviewContext
  decidesAssignee: boolean
}) {
  const meeting = context.meetings?.find(({ id }) => id === item.meetingId)
  const speaker = speakerName(context.members, item.evidence) ?? '알 수 없음'
  return (
    <li className="flex flex-col gap-6">
      <div className={EVIDENCE_HEAD}>
        <span className={`${EVIDENCE_META} flex flex-wrap items-center gap-x-8 gap-y-4`}>
          <span>
            {item.meetingId === null ? '회의 알 수 없음' : (meeting?.title ?? '연결된 회의')} ·
            전사문 {evidenceMoment(meeting, item.evidence.atMs) ?? '시각 알 수 없음'} · {speaker}
          </span>
          {decidesAssignee ? <AssigneeMark /> : null}
        </span>
        {item.meetingId === null ? null : (
          <GuardedLink
            to={paths.meetings(context.workspaceId, item.meetingId)}
            className={HEAD_LINK}
          >
            원문 듣기
            <Icon name="external" size={12} />
          </GuardedLink>
        )}
      </div>
      {item.evidence.quote === null ? (
        <p className={NOTE}>근거 문장이 없어요.</p>
      ) : (
        <blockquote className={MERGED_QUOTE}>“{item.evidence.quote}”</blockquote>
      )}
      {item.docText === null ? null : <p className={RAW}>{item.docText}</p>}
      {item.mergedAt === null ? null : (
        <p className={EVIDENCE_META}>합친 시각 {formatSeoulDateTime(item.mergedAt)}</p>
      )}
    </li>
  )
}

const CREATE_FIELD_LABEL: Record<keyof TaskCreateFields, string> = {
  taskTitle: '제목',
  assigneeMemberId: '담당자',
  dueDate: '마감',
}

function createFieldValue(
  field: keyof TaskCreateFields,
  fields: TaskCreateFields,
  names: ReadonlyMap<string, string>,
): string {
  const value = fields[field]
  if (value === null || value.trim() === '') return '미정'
  return field === 'assigneeMemberId' ? memberLabel(value, names) : value
}

/**
 * 본 뒤 바뀐 카드 (#547 APPROVAL_CHANGED). 처음 본 값·새 제안·승인할 값을 나란히 보인다. 고치지 않은 칸은
 * 새 제안을 따르고 PM 이 고친 칸은 그대로라, 승인할 값 열에 무엇이 남았는지 드러난다
 */
function ChangedNotice({
  change,
  overrides,
  names,
}: {
  change: NonNullable<TaskCreateOverrides['change']>
  overrides: TaskCreateOverrides
  names: ReadonlyMap<string, string>
}) {
  const was = taskCreateValues(change.before)
  const proposed = taskCreateValues(overrides.seen)
  const added = change.diff.addedItems.length
  return (
    <section role="alert" aria-label="바뀐 내용" className={ALERT}>
      <h3 className={SECTION_TITLE}>보신 뒤에 내용이 바뀌었어요</h3>
      <p className={NOTE}>
        {added > 0 ? `다른 회의의 항목 ${added}개가 합쳐졌어요. ` : null}
        고치지 않은 칸은 새 값으로 바꾸고 직접 고친 칸은 그대로 뒀어요. 확인한 뒤 다시 처리해
        주세요.
      </p>
      {change.diff.fields.length === 0 ? null : (
        <table aria-label="바뀐 칸" className={TABLE}>
          <thead>
            <tr>
              <th className={TH}>항목</th>
              <th className={TH}>보던 값</th>
              <th className={TH}>새 제안</th>
              <th className={TH}>승인할 값</th>
            </tr>
          </thead>
          <tbody>
            {change.diff.fields.map((field) => (
              <tr key={field}>
                <th scope="row" className={`${TD} font-semibold`}>
                  {CREATE_FIELD_LABEL[field]}
                </th>
                <td className={TD}>{createFieldValue(field, was, names)}</td>
                <td className={TD}>{createFieldValue(field, proposed, names)}</td>
                <td className={TD}>{createFieldValue(field, overrides.fields, names)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

const DUE_NOTE = '마감을 비워 두면 미정으로 올라가요'

function TaskCreatePending({
  approval,
  context,
  fillIn,
}: {
  approval: TaskCreateApproval
  context: ReviewContext
  fillIn: boolean
}) {
  const { members, resolver, meeting } = context
  const memberIds = useMemo(() => (members ?? []).map(({ id }) => id), [members])
  const overrides = useTaskCreateOverrides(approval, memberIds)
  useUnsavedChanges(overrides.dirty)
  // 처리는 폼이 맞춰진 카드로 한다. 그 카드의 지문이어야 PM 이 본 뒤 바뀐 카드를 서버가 막는다 (#547)
  const { seen, change } = overrides
  const gaps = openGaps(overrides.attention)
  const edits = {
    kind: 'task_create',
    values: overrides.edits,
    saveAlias: overrides.saveAlias,
  } as const
  const plan = planApprovalResolution(seen, 'approved', { memberIds, edits })
  const blockedReason =
    members === undefined ? MEMBERS_LOADING_REASON : plan.ok ? null : plan.reason
  const meetingDate = meeting === undefined ? null : seoulDateOf(meeting.startedAt)
  const count = mergedCount(seen)

  return (
    <>
      <ReviewHeader approval={seen} context={context} summary={gapSummary(gaps)} />
      <ReviewCard
        approval={seen}
        context={context}
        title="Notion 에 올라갈 태스크"
        footer={
          <>
            <FormErrorPanel
              message={
                change !== null && resolver.problem?.kind === 'changed'
                  ? null
                  : problemMessage(resolver.problem)
              }
            />
            {count === null ? null : (
              <p className={NOTE}>반려하면 합쳐진 항목 {count.items}개가 모두 반려돼요.</p>
            )}
            <ApprovalActions
              approveBlockedReason={blockedReason}
              note={DUE_NOTE}
              approveLabel={change === null ? '승인' : '새 내용을 확인했어요, 승인'}
              pending={resolver.pending}
              pendingDecision={resolver.pendingDecision}
              onApprove={() => resolver.approve(seen, edits)}
              onReject={() => resolver.reject(seen)}
            />
          </>
        }
      >
        {change === null ? null : (
          <ChangedNotice change={change} overrides={overrides} names={context.names} />
        )}
        <TaskCreateOverrideFields
          overrides={overrides}
          members={members}
          retainedNames={context.names}
          disabled={resolver.pending}
          autoFocusFirstEmpty={fillIn}
          onInputChange={resolver.invalidateConfirmation}
        />
        <EvidenceBlock approval={seen} context={context} gaps={gaps} />
      </ReviewCard>
      {gaps.length === 0 ? null : (
        <GapReasons
          approval={seen}
          gaps={gaps}
          dueFill={dueFillSuggestion(seen, meetingDate)}
          disabled={resolver.pending}
          onFillDue={(date) => {
            resolver.invalidateConfirmation()
            overrides.form.setValue('dueDate', date, { shouldDirty: true, shouldValidate: true })
            overrides.form.setFocus('dueDate')
          }}
        />
      )}
    </>
  )
}

/**
 * 「확인이 필요한 이유」. 빠진 값마다 회의에서 한 말을 보이고, 원문 마감이 회의 날짜 기준으로 확실한 날이면
 * 「M/D(요일)로 채우기」를 둔다 — 누르면 마감 칸만 채운다. 서버에는 승인할 때 보낸다
 */
function GapReasons({
  approval,
  gaps,
  dueFill,
  disabled,
  onFillDue,
}: {
  approval: TaskCreateApproval
  gaps: readonly ApprovalMissing[]
  dueFill: string | null
  disabled: boolean
  onFillDue: (date: string) => void
}) {
  const titleId = useId()
  return (
    <section aria-labelledby={titleId} className={PANEL}>
      <h2 id={titleId} className="text-caption font-normal text-dim">
        확인이 필요한 이유
      </h2>
      <ul className="flex flex-col">
        {gaps.map((gap) => (
          <li key={gap} className="flex flex-wrap items-center justify-between gap-x-16">
            <span className="py-10 text-[15px] leading-[1.6] text-ink">
              <b className="mr-6 font-bold">{gap === 'due' ? '마감' : '담당자'}</b>
              {gapReason(gap, gap === 'due' ? approval.dueRaw : approval.assigneeRaw)}
            </span>
            {gap === 'due' && dueFill !== null ? (
              <button
                type="button"
                className={FILL_BUTTON}
                disabled={disabled}
                onClick={() => onFillDue(dueFill)}
              >
                {fillLabel(formatMonthDayWeekday(dueFill))}
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * 변경 승인 (계획 §4-3). 지금 태스크 값과 제안값을 비교하고 상태·마감을 그 자리에서 고친다.
 * 충돌이면 기준값·현재값·제안값과 충돌 필드를 보인다. PM 이 다시 누를 때만 서버 버전을 실어 재승인한다 —
 * 다시 충돌하면 새 충돌로 바꿔 보이고 자동으로 보내지 않는다
 */
function TaskUpdatePending({
  approval,
  context,
}: {
  approval: TaskUpdateApproval
  context: ReviewContext
}) {
  const { workspaceId, members, names, resolver } = context
  const memberIds = useMemo(() => (members ?? []).map(({ id }) => id), [members])
  const taskId = approval.relatedTaskId
  const task = useQuery({
    ...taskDetailQueryOptions(workspaceId, taskId ?? ''),
    enabled: taskId !== null,
  })
  const conflict = resolver.problem?.kind === 'conflict' ? resolver.problem : null
  const overrides = useTaskUpdateOverrides(approval)
  useUnsavedChanges(overrides.dirty)
  const edits = { kind: 'task_update', values: overrides.edits } as const
  const plan = planApprovalResolution(approval, 'approved', { memberIds, edits })
  const blockedReason =
    taskId === null
      ? '바꿀 태스크가 없어 승인할 수 없어요.'
      : approval.assigneePick !== null && members === undefined
        ? MEMBERS_LOADING_REASON
        : plan.ok
          ? null
          : plan.reason
  const current = (field: string) =>
    task.data === undefined
      ? task.isError
        ? '불러오지 못했어요'
        : '불러오는 중'
      : fieldValueLabel(field, currentFieldValue(task.data, field), names)

  return (
    <>
      <ReviewHeader approval={approval} context={context} summary={null} />
      <ReviewCard
        approval={approval}
        context={context}
        title="Notion 에 올라갈 변경"
        footer={
          <>
            <FormErrorPanel message={problemMessage(resolver.problem)} />
            <ApprovalActions
              approveBlockedReason={blockedReason}
              note="바꾸지 않은 칸은 원래 제안을 유지해요"
              approveLabel={conflict === null ? '승인' : '지금 값을 확인했어요, 다시 승인'}
              pending={resolver.pending}
              pendingDecision={resolver.pendingDecision}
              onApprove={() =>
                conflict === null ? resolver.approve(approval, edits) : resolver.reapprove(approval)
              }
              onReject={() => resolver.reject(approval)}
            />
          </>
        }
      >
        {taskId === null ? (
          <p className={NOTE}>바꿀 태스크가 없는 요청이에요.</p>
        ) : task.data === undefined ? null : (
          <p className={NOTE}>
            대상 태스크:{' '}
            <GuardedLink to={paths.tasks(workspaceId, taskId)} className={LINK}>
              {task.data.title}
            </GuardedLink>
          </p>
        )}
        <ChangesTable
          approval={approval}
          changes={taskUpdateChanges(approval, overrides.edits)}
          names={names}
          valueHeader="확정할 값"
          current={current}
        />
        <TaskUpdateOverrideFields
          overrides={overrides}
          members={members}
          retainedNames={context.names}
          disabled={resolver.pending}
          onInputChange={resolver.invalidateConfirmation}
        />
        {conflict === null ? null : (
          <section role="alert" aria-label="변경 충돌" className={ALERT}>
            <h3 className={SECTION_TITLE}>제안한 뒤에 태스크가 바뀌었어요</h3>
            <p className={NOTE}>
              아래 항목의 지금 값이 제안할 때와 달라요. 지금 값을 확인하고 다시 승인하면 확정할
              값으로 바꿔요.
            </p>
            <table aria-label="충돌한 항목" className={TABLE}>
              <thead>
                <tr>
                  <th className={TH}>항목</th>
                  <th className={TH}>기준값</th>
                  <th className={TH}>현재값</th>
                  <th className={TH}>확정할 값</th>
                </tr>
              </thead>
              <tbody>
                {conflict.conflicts.map((item) => (
                  <tr key={item.field}>
                    <th scope="row" className={`${TD} font-semibold`}>
                      {fieldLabel(item.field)}
                    </th>
                    <td className={TD}>{fieldValueLabel(item.field, item.base, names)}</td>
                    <td className={TD}>{fieldValueLabel(item.field, item.current, names)}</td>
                    <td className={TD}>{fieldValueLabel(item.field, item.proposed, names)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
        <EvidenceBlock approval={approval} context={context} />
      </ReviewCard>
    </>
  )
}

/** 변경 승인의 비교표. 대기 중이면 지금 태스크 값 열이 있다 */
function ChangesTable({
  approval,
  changes,
  names,
  valueHeader,
  current,
}: {
  approval: TaskUpdateApproval
  changes: { field: string; value: unknown }[]
  names: ReadonlyMap<string, string>
  valueHeader: string
  current?: (field: string) => string
}) {
  // 담당자를 찾지 못한 답장 카드는 고르기 전까지 바꿀 값이 없다. 머리만 있는 표 대신 아무것도 그리지 않는다
  if (changes.length === 0)
    return isScopeChange(approval) ? <p className={NOTE}>바꿀 항목 값은 없어요.</p> : null
  return (
    <table aria-label="현재값과 제안값" className={TABLE}>
      <thead>
        <tr>
          <th className={TH}>항목</th>
          {current === undefined ? null : <th className={TH}>현재값</th>}
          <th className={TH}>{valueHeader}</th>
        </tr>
      </thead>
      <tbody>
        {changes.map(({ field, value }) => (
          <tr key={field}>
            <th scope="row" className={`${TD} font-semibold`}>
              {fieldLabel(field)}
            </th>
            {current === undefined ? null : <td className={TD}>{current(field)}</td>}
            <td className={TD}>{fieldValueLabel(field, value, names)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** 처리된 승인. 고칠 수 없고, 반영한 값과 처음 요청한 값을 나란히 남긴다 */
function ResolvedReview({
  approval,
  context,
}: {
  approval: ReviewedApproval
  context: ReviewContext
}) {
  const approved = approval.status === 'approved'
  return (
    <>
      <ReviewHeader approval={approval} context={context} summary={null} />
      <ReviewCard
        approval={approval}
        context={context}
        title={
          approval.kind === 'task_create' ? 'Notion 에 올라갈 태스크' : 'Notion 에 올라갈 변경'
        }
      >
        {approval.kind === 'task_create' ? (
          <ResolvedCreateValues approval={approval} names={context.names} />
        ) : (
          <>
            <ChangesTable
              approval={approval}
              changes={taskUpdateChanges(approval, approved ? approval.storedOverrides : {})}
              names={context.names}
              valueHeader={approved ? '반영한 값' : '제안값'}
            />
            {approved && approval.changes.length > 0 ? (
              <FieldList
                label="원래 제안"
                rows={approval.changes.map(({ field, value }) => ({
                  term: fieldLabel(field),
                  value: fieldValueLabel(field, value, context.names),
                }))}
              />
            ) : null}
          </>
        )}
        <EvidenceBlock approval={approval} context={context} />
      </ReviewCard>
    </>
  )
}

function ResolvedCreateValues({
  approval,
  names,
}: {
  approval: TaskCreateApproval
  names: ReadonlyMap<string, string>
}) {
  const approved = approval.status === 'approved'
  const rows = (fields: {
    taskTitle: string
    assigneeMemberId: string | null
    dueDate: string | null
  }) => [
    { term: '제목', value: fields.taskTitle.trim() === '' ? null : fields.taskTitle },
    {
      term: '담당자',
      value: fields.assigneeMemberId === null ? null : memberLabel(fields.assigneeMemberId, names),
    },
    { term: '마감', value: fields.dueDate },
  ]
  const requested = rows(taskCreateValues(approval))
  if (!approved) return <FieldList label="요청한 값" rows={requested} />
  return (
    <>
      <FieldList
        label="반영한 값"
        rows={rows(taskCreateValues(approval, approval.storedOverrides))}
      />
      <FieldList label="요청한 값" rows={requested} />
    </>
  )
}

/** 이름·값 목록. 값이 없으면 `미정` 이다 */
function FieldList({
  label,
  rows,
}: {
  label: string
  rows: { term: string; value: string | null }[]
}) {
  return (
    <div className="flex flex-col gap-8">
      <h3 className={BLOCK_TITLE}>{label}</h3>
      <dl aria-label={label} className={FIELDS}>
        {rows.map(({ term, value }) => (
          <div key={term} className="contents">
            <dt className={TERM}>{term}</dt>
            {value === null ? (
              <dd className={MISSING}>미정</dd>
            ) : (
              <dd className={VALUE}>{value}</dd>
            )}
          </div>
        ))}
      </dl>
    </div>
  )
}

/** 지원하지 않는 종류 (계획 §4-4). 읽기 전용이고 승인 액션이 없다 */
function UnsupportedReview({ approval }: { approval: UnsupportedApproval }) {
  return (
    <>
      <h1 className={TITLE}>{approvalHeading(approval)}</h1>
      <section aria-label="지원하지 않는 확인 요청" className={`${CARD} ${CARD_BODY}`}>
        <dl className={FIELDS}>
          <dt className={TERM}>종류</dt>
          <dd className={VALUE}>{approval.type}</dd>
        </dl>
        {approval.status === 'pending' ? (
          <p className={NOTE}>{APPROVAL_RESOLUTION_REASONS.unsupported}</p>
        ) : null}
      </section>
    </>
  )
}

interface ResolutionResultProps {
  workspaceId: string
  approval: Approval
  problem: ApprovalResolveProblem | null
}

/**
 * 처리된 승인의 결과 (계획 §4-4, §4-5). 다시 처리하지 않는다.
 * 승인으로 생성·변경된 태스크 링크와 그 태스크의 Notion 반영 상태를 남긴다 — 반영 중이면 이 화면에서 polling 한다
 */
function ResolutionResult({ workspaceId, approval, problem }: ResolutionResultProps) {
  const titleId = useId()
  const approved = approval.status === 'approved'
  const taskId = approval.kind === 'unsupported' ? null : approval.relatedTaskId
  return (
    <section aria-labelledby={titleId} className={PANEL}>
      <h2 id={titleId} className={SECTION_TITLE}>
        처리 결과
      </h2>
      {problem?.kind === 'already_resolved' ? (
        <p className={NOTE}>{APPROVAL_RESOLUTION_REASONS.resolved} 지금 결과를 보여 드려요.</p>
      ) : null}
      <p className="text-body font-semibold text-ink" data-testid="approval-result">
        {approved ? '승인했어요' : '반려했어요'}
        {approval.resolvedAt === null ? null : (
          <span className={`${META} ml-8 font-normal`}>
            {formatSeoulDateTime(approval.resolvedAt)}
          </span>
        )}
      </p>
      {approved && taskId !== null ? (
        <ResolvedTask
          workspaceId={workspaceId}
          taskId={taskId}
          created={approval.kind === 'task_create'}
        />
      ) : approval.kind === 'task_create' && !approved ? (
        <p className={NOTE}>태스크를 만들지 않았어요.</p>
      ) : null}
    </section>
  )
}

function ResolvedTask({
  workspaceId,
  taskId,
  created,
}: {
  workspaceId: string
  taskId: string
  created: boolean
}) {
  const task = useQuery(taskDetailQueryOptions(workspaceId, taskId)).data
  return (
    <dl aria-label="처리된 태스크" className="grid grid-cols-[120px_1fr] gap-x-16 gap-y-10">
      <dt className={TERM}>{created ? '생성된 태스크' : '변경된 태스크'}</dt>
      <dd className={VALUE}>
        <GuardedLink to={paths.tasks(workspaceId, taskId)} className={LINK}>
          {task?.title ?? '태스크 보기'}
        </GuardedLink>
      </dd>
      <dt className={TERM}>Notion</dt>
      <dd className={VALUE}>
        <TaskNotionSyncStatus workspaceId={workspaceId} taskId={taskId} canRetry />
      </dd>
    </dl>
  )
}
