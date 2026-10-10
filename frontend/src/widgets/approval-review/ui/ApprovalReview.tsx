import { useQuery } from '@tanstack/react-query'
import { useId, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  APPROVAL_RESOLUTION_REASONS,
  approvalDetailQueryOptions,
  planApprovalResolution,
} from '@/entities/approval'
import type {
  Approval,
  TaskCreateApproval,
  TaskCreateFields,
  TaskUpdateApproval,
  UnsupportedApproval,
} from '@/entities/approval'
import { meetingListQueryOptions } from '@/entities/meeting'
import { memberListQueryOptions } from '@/entities/member'
import type { Member } from '@/entities/member'
import { taskDetailQueryOptions } from '@/entities/task'
import {
  ApprovalActions,
  TaskCreateOverridesForm,
  currentApprovalTransport,
  useApprovalResolve,
} from '@/features/approval-resolve'
import type { ApprovalResolve, ApprovalResolveProblem } from '@/features/approval-resolve'
import { TaskNotionSyncStatus } from '@/features/task-notion-sync'
import { ApiError, ERROR_CODES } from '@/shared/api/errors'
import { paths } from '@/shared/config/routes'
import { formatSeoulDateTime } from '@/shared/lib/date'
import { GuardedLink, useUnsavedChanges } from '@/shared/lib/unsaved-changes'
import { Button } from '@/shared/ui/button'
import { EmptyState } from '@/shared/ui/empty-state'
import { FormErrorPanel } from '@/shared/ui/form-error-panel'
import { QueryErrorState } from '@/shared/ui/query-error-state'
import { Skeleton } from '@/shared/ui/skeleton'
import {
  approvalKindLabel,
  approvalStatusLabel,
  currentFieldValue,
  evidenceClock,
  fieldLabel,
  fieldValueLabel,
  memberLabel,
} from '../lib/approvalView'

const ROOT = 'mx-auto flex w-full max-w-[960px] flex-col gap-24 px-36 pt-32 pb-56'
const BACK = 'text-caption font-semibold text-dim hover:text-ink'
const EYEBROW = 'text-caption font-semibold text-dim'
const TITLE = 'text-[24px] leading-[1.4] font-bold tracking-h2 text-ink'
const META = 'text-meta text-dim tabular-nums'
const SECTION = 'flex flex-col gap-12'
const SECTION_TITLE = 'text-[17px] leading-[1.55] font-bold tracking-h2 text-ink'
const FIELDS =
  'grid grid-cols-[120px_1fr] gap-x-16 gap-y-12 rounded-16 border border-line px-24 py-20'
const TERM = 'text-caption font-semibold text-dim'
const VALUE = 'text-body text-ink tabular-nums'
const MISSING = 'text-body font-semibold text-accent'
const NOTE = 'text-caption text-sub'
const QUOTE = 'border-l-2 border-line-strong pl-14 text-body text-ink'
const TABLE = 'w-full border-collapse text-left text-body text-ink'
const TH = 'border-b border-line py-8 pr-16 text-caption font-semibold text-dim'
const TD = 'border-b border-line py-10 pr-16 tabular-nums'
const LINK = 'text-body font-semibold text-ink underline underline-offset-4 hover:text-sub'
const PANEL = 'flex flex-col gap-12 rounded-16 border border-line-strong px-24 py-20'

export interface ApprovalReviewProps {
  workspaceId: string
  approvalId: string
}

function isUnavailable(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    (error.code === ERROR_CODES.APPROVAL_NOT_FOUND ||
      (error.kind === 'http' && error.status === 404))
  )
}

/**
 * 확인 필요 상세 (계획 §4). PM 가드를 통과해야 마운트된다 — 승인 조회는 여기서 처음 시작한다.
 * 최초 진입은 읽기다. 생성 승인은 근거·원문·확정할 값을, 변경 승인은 현재값·제안값을 보인다.
 * 승인·반려는 서버 성공 뒤에 반영하고, 처리된 승인은 결과와 태스크·Notion 상태를 같은 화면에 남긴다
 */
export function ApprovalReview({ workspaceId, approvalId }: ApprovalReviewProps) {
  const approval = useQuery(approvalDetailQueryOptions(workspaceId, approvalId))

  let body: ReactNode
  if (approval.data !== undefined)
    body = <ApprovalBody workspaceId={workspaceId} approval={approval.data} />
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
  else
    body = (
      <div aria-busy="true">
        <Skeleton lines={5} />
      </div>
    )

  return (
    <main className={ROOT}>
      <div className="flex flex-col gap-6">
        <GuardedLink to={paths.tasks(workspaceId)} className={BACK}>
          ← 태스크 목록
        </GuardedLink>
        <h1 className={EYEBROW}>확인 필요</h1>
      </div>
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

function ApprovalBody({ workspaceId, approval }: { workspaceId: string; approval: Approval }) {
  const members = useQuery(memberListQueryOptions(workspaceId))
  const memberIds = useMemo(() => (members.data ?? []).map(({ id }) => id), [members.data])
  const names = useMemberNames(members.data)
  const resolver = useApprovalResolve(workspaceId, approval.id, memberIds)

  return (
    <>
      <div className="flex flex-col gap-4">
        <h2 className={TITLE}>{approvalKindLabel(approval)}</h2>
        <p className={META}>
          {approvalStatusLabel(approval)} · 요청 {formatSeoulDateTime(approval.createdAt)}
        </p>
      </div>
      {approval.kind === 'task_create' ? (
        <TaskCreateReview
          workspaceId={workspaceId}
          approval={approval}
          members={members.data}
          names={names}
          resolver={resolver}
        />
      ) : approval.kind === 'task_update' ? (
        <TaskUpdateReview
          workspaceId={workspaceId}
          approval={approval}
          names={names}
          resolver={resolver}
        />
      ) : (
        <UnsupportedReview approval={approval} />
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
  return problem?.kind === 'error' ? problem.message : null
}

const EDITING_REASON = '보완을 끝내거나 취소하면 승인할 수 있어요.'
const MEMBERS_LOADING_REASON = '팀원 목록을 불러온 뒤 승인할 수 있어요.'

interface TaskCreateReviewProps {
  workspaceId: string
  approval: TaskCreateApproval
  members: readonly Member[] | undefined
  names: ReadonlyMap<string, string>
  resolver: ApprovalResolve
}

/**
 * 생성 승인 (계획 §4-1, §4-2). 원문 담당자·마감과 근거(인용·화자·시각)는 확정할 값과 나눠 보인다.
 * - 개발 MSW 에서만 `보완하기` 가 있다. 보완 완료한 값은 승인 한 번에 함께 실린다 — 그 전까지는 저장되지 않은 변경이다
 * - 실 API 는 기존 값이 필수조건을 채울 때만 승인할 수 있다. 아니면 `승인` 을 끄고 이유를 보인다. `반려` 는 늘 누를 수 있다
 */
function TaskCreateReview({
  workspaceId,
  approval,
  members,
  names,
  resolver,
}: TaskCreateReviewProps) {
  const transport = currentApprovalTransport()
  const pending = approval.status === 'pending'
  const [editing, setEditing] = useState(false)
  const [overrides, setOverrides] = useState<TaskCreateFields | null>(null)
  useUnsavedChanges(pending && overrides !== null)

  const original: TaskCreateFields = {
    taskTitle: approval.title,
    assigneeMemberId: approval.assigneeMemberId,
    dueDate: approval.dueDate,
  }
  const confirmed = (pending ? overrides : null) ?? original
  const memberIds = (members ?? []).map(({ id }) => id)
  const plan = planApprovalResolution(approval, 'approved', {
    transport,
    memberIds,
    overrides: pending ? overrides : null,
  })
  const blockedReason = editing
    ? EDITING_REASON
    : members === undefined
      ? MEMBERS_LOADING_REASON
      : plan.ok
        ? null
        : plan.reason

  return (
    <>
      <section className={SECTION}>
        <div className="flex items-center justify-between gap-12">
          <h3 className={SECTION_TITLE}>{pending ? '확정할 값' : '요청한 값'}</h3>
          {pending && transport === 'msw' && !editing ? (
            <Button
              variant="default"
              onClick={() => setEditing(true)}
              disabled={resolver.pending || members === undefined}
            >
              보완하기
            </Button>
          ) : null}
        </div>
        {pending && overrides !== null && !editing ? (
          <p className={NOTE}>보완한 값이에요. 승인해야 저장돼요.</p>
        ) : null}
        <dl aria-label={pending ? '확정할 값' : '요청한 값'} className={FIELDS}>
          <dt className={TERM}>제목</dt>
          <FieldValue value={confirmed.taskTitle.trim() === '' ? null : confirmed.taskTitle} />
          <dt className={TERM}>담당자</dt>
          <FieldValue
            value={
              confirmed.assigneeMemberId === null
                ? null
                : memberLabel(confirmed.assigneeMemberId, names)
            }
          />
          <dt className={TERM}>마감</dt>
          <FieldValue value={confirmed.dueDate} />
        </dl>
      </section>

      {pending && editing && members !== undefined ? (
        <TaskCreateOverridesForm
          initial={confirmed}
          members={members}
          disabled={resolver.pending}
          onCancel={() => setEditing(false)}
          onConfirm={(fields) => {
            setOverrides(fields)
            setEditing(false)
          }}
        />
      ) : null}

      <section className={SECTION}>
        <h3 className={SECTION_TITLE}>회의 원문</h3>
        <dl aria-label="회의 원문" className={FIELDS}>
          <dt className={TERM}>원문 담당자</dt>
          <dd className={VALUE}>{approval.assigneeRaw ?? '없음'}</dd>
          <dt className={TERM}>원문 마감</dt>
          <dd className={VALUE}>{approval.dueRaw ?? '없음'}</dd>
        </dl>
        <Evidence workspaceId={workspaceId} approval={approval} />
      </section>

      {pending ? (
        <div className="flex flex-col gap-12">
          <FormErrorPanel message={problemMessage(resolver.problem)} />
          <ApprovalActions
            approveBlockedReason={blockedReason}
            pending={resolver.pending}
            pendingDecision={resolver.pendingDecision}
            onApprove={() =>
              resolver.resolve(approval, {
                decision: 'approved',
                overrides: transport === 'msw' ? overrides : null,
              })
            }
            onReject={() => resolver.resolve(approval, { decision: 'rejected' })}
          />
        </div>
      ) : null}
    </>
  )
}

function FieldValue({ value }: { value: string | null }) {
  return value === null ? (
    <dd className={MISSING}>비어 있어요</dd>
  ) : (
    <dd className={VALUE}>{value}</dd>
  )
}

/** 근거 인용·화자·녹음 위치와 연결 회의 */
function Evidence({
  workspaceId,
  approval,
}: {
  workspaceId: string
  approval: TaskCreateApproval
}) {
  // 처리 추적이 이미 받는 목록이다 — 같은 key 라 따로 요청하지 않는다
  const meetings = useQuery(meetingListQueryOptions(workspaceId))
  const { quote, speaker, atMs } = approval.evidence
  const meetingTitle =
    approval.meetingId === null
      ? null
      : (meetings.data?.find(({ id }) => id === approval.meetingId)?.title ?? '연결된 회의')
  return (
    <figure aria-label="근거" className="flex flex-col gap-8">
      {quote === null ? (
        <p className={NOTE}>근거 문장이 없어요.</p>
      ) : (
        <blockquote className={QUOTE}>{quote}</blockquote>
      )}
      <figcaption className={META}>
        화자 {speaker ?? '알 수 없음'} · 시각 {atMs === null ? '알 수 없음' : evidenceClock(atMs)}
        {approval.meetingId === null || meetingTitle === null ? null : (
          <>
            {' · '}
            <GuardedLink to={paths.meetings(workspaceId, approval.meetingId)} className={LINK}>
              {meetingTitle}
            </GuardedLink>
          </>
        )}
      </figcaption>
    </figure>
  )
}

interface TaskUpdateReviewProps {
  workspaceId: string
  approval: TaskUpdateApproval
  names: ReadonlyMap<string, string>
  resolver: ApprovalResolve
}

/**
 * 변경 승인 (계획 §4-3). 지금 태스크 값과 제안값을 비교한다.
 * 충돌이면 기준값·현재값·제안값과 충돌 필드를 보인다. PM 이 다시 누를 때만 서버 버전을 실어 재승인한다 —
 * 다시 충돌하면 새 충돌로 바꿔 보이고 자동으로 보내지 않는다
 */
function TaskUpdateReview({ workspaceId, approval, names, resolver }: TaskUpdateReviewProps) {
  const titleId = useId()
  const pending = approval.status === 'pending'
  const taskId = approval.relatedTaskId
  const task = useQuery({
    ...taskDetailQueryOptions(workspaceId, taskId ?? ''),
    enabled: taskId !== null && pending,
  })
  const conflict = resolver.problem?.kind === 'conflict' ? resolver.problem : null

  return (
    <>
      <section aria-labelledby={titleId} className={SECTION}>
        <h3 id={titleId} className={SECTION_TITLE}>
          바꿀 내용
        </h3>
        {taskId === null ? (
          <p className={NOTE}>바꿀 태스크가 없는 요청이에요.</p>
        ) : pending && task.data !== undefined ? (
          <p className={NOTE}>
            대상 태스크:{' '}
            <GuardedLink to={paths.tasks(workspaceId, taskId)} className={LINK}>
              {task.data.title}
            </GuardedLink>
          </p>
        ) : null}
        <table aria-label="현재값과 제안값" className={TABLE}>
          <thead>
            <tr>
              <th className={TH}>항목</th>
              {pending ? <th className={TH}>현재값</th> : null}
              <th className={TH}>제안값</th>
            </tr>
          </thead>
          <tbody>
            {approval.changes.map(({ field, value }) => (
              <tr key={field}>
                <th scope="row" className={`${TD} font-semibold`}>
                  {fieldLabel(field)}
                </th>
                {pending ? (
                  <td className={TD}>
                    {task.data === undefined
                      ? task.isError
                        ? '불러오지 못했어요'
                        : '불러오는 중'
                      : fieldValueLabel(field, currentFieldValue(task.data, field), names)}
                  </td>
                ) : null}
                <td className={TD}>{fieldValueLabel(field, value, names)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {pending && conflict !== null ? (
        <section role="alert" aria-label="변경 충돌" className={PANEL}>
          <h3 className={SECTION_TITLE}>제안한 뒤에 태스크가 바뀌었어요</h3>
          <p className={NOTE}>
            아래 항목의 지금 값이 제안할 때와 달라요. 지금 값을 확인하고 다시 승인하면 제안값으로
            바꿔요.
          </p>
          <table aria-label="충돌한 항목" className={TABLE}>
            <thead>
              <tr>
                <th className={TH}>항목</th>
                <th className={TH}>기준값</th>
                <th className={TH}>현재값</th>
                <th className={TH}>제안값</th>
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
      ) : null}

      {pending ? (
        <div className="flex flex-col gap-12">
          <FormErrorPanel message={problemMessage(resolver.problem)} />
          <ApprovalActions
            approveBlockedReason={taskId === null ? '바꿀 태스크가 없어 승인할 수 없어요.' : null}
            approveLabel={conflict === null ? '승인' : '지금 값을 확인했어요, 다시 승인'}
            pending={resolver.pending}
            pendingDecision={resolver.pendingDecision}
            onApprove={() =>
              resolver.resolve(approval, {
                decision: 'approved',
                confirmTaskVersion: conflict === null ? null : conflict.taskVersion,
              })
            }
            onReject={() => resolver.resolve(approval, { decision: 'rejected' })}
          />
        </div>
      ) : null}
    </>
  )
}

/** 지원하지 않는 종류 (계획 §4-4). 읽기 전용이고 승인 액션이 없다 */
function UnsupportedReview({ approval }: { approval: UnsupportedApproval }) {
  return (
    <section aria-label="지원하지 않는 확인 요청" className={SECTION}>
      <dl className={FIELDS}>
        <dt className={TERM}>종류</dt>
        <dd className={VALUE}>{approval.type}</dd>
      </dl>
      {approval.status === 'pending' ? (
        <p className={NOTE}>{APPROVAL_RESOLUTION_REASONS.unsupported}</p>
      ) : null}
    </section>
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
      <h3 id={titleId} className={SECTION_TITLE}>
        처리 결과
      </h3>
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
