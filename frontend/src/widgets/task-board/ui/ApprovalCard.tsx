import { useId, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  APPROVAL_RESOLUTION_REASONS,
  aliasToLearn,
  asrSuspectLine,
  isScopeChange,
  mergedCount,
  planApprovalResolution,
  validateTaskCreateFields,
  taskCreateValues,
} from '@/entities/approval'
import type {
  Approval,
  TaskCreateApproval,
  TaskCreateFields,
  TaskCreateIssue,
} from '@/entities/approval'
import { evidenceMoment } from '@/entities/meeting'
import type { MeetingSummary } from '@/entities/meeting'
import {
  ASSIGNEE_NONE_OPTION,
  assigneeOptions,
  recordMemberListQueryOptions,
  speakerName,
} from '@/entities/member'
import type { Member } from '@/entities/member'
import { AliasSaveField, useApprovalResolve } from '@/features/approval-resolve'
import type { ApprovalResolve } from '@/features/approval-resolve'
import { paths } from '@/shared/config/routes'
import { GuardedLink, useUnsavedChanges } from '@/shared/lib/unsaved-changes'
import { Button } from '@/shared/ui/button'
import { Card } from '@/shared/ui/card'
import { FormErrorPanel } from '@/shared/ui/form-error-panel'
import { Icon } from '@/shared/ui/icon'
import { Label } from '@/shared/ui/label'
import { Select } from '@/shared/ui/select'
import { TextField } from '@/shared/ui/text-field'

/* 시안의 `지금 봐야 하는 카드` 그림자 — 0 8px 24px rgba(23,23,23,.2). 토큰에 그림자가 없어 값을 그대로 쓴다 */
const ATTENTION_SHADOW = 'shadow-[0_8px_24px_#17171733]'
const HEAD = 'flex items-center justify-between gap-16'
const BADGE_ROW = 'flex min-w-[0px] items-center gap-11'
const ATTENTION_BADGE =
  'inline-flex h-22 shrink-0 items-center gap-5 rounded-6 bg-ink px-9 text-meta font-semibold leading-none text-surface'
const HOLD_BADGE =
  'inline-flex h-22 shrink-0 items-center rounded-6 bg-control px-9 text-meta font-semibold leading-none text-dim'
const TITLE = 'text-[19px] leading-[1.55] font-bold tracking-h2 text-ink'
const MEETING_LINK =
  'inline-flex shrink-0 items-center gap-6 text-[12px] text-dim hover:text-ink tabular-nums'
const REASON_BLOCK = 'flex flex-col gap-6'
const REASON = 'text-body text-sub'
/* 후보는 공백 없이 100자까지 온다. 전역 keep-all 이라 글자 칸이 끊어 주지 않으면 카드 밖으로 나간다 */
const SUSPECT = 'flex min-w-[0px] items-start gap-6 text-caption text-sub'
const SUSPECT_TEXT = 'min-w-[0px] wrap-anywhere'
const FIELDS = 'grid grid-cols-[minmax(0px,1.6fr)_minmax(0px,1fr)_minmax(0px,1fr)] gap-12'
const EVIDENCE = 'flex flex-col gap-7 rounded-12 bg-surface-sunken px-20 py-18'
const EVIDENCE_HEAD = 'flex items-center justify-between gap-12'
const EVIDENCE_META = 'text-[11px] text-dim tabular-nums'
const EVIDENCE_LINK = 'inline-flex items-center gap-5 text-meta text-dim hover:text-ink'
const QUOTE = 'text-body leading-[1.7] text-ink'
const SUB_NOTE = 'text-caption text-dim'
const FOOTER = 'flex items-center justify-between gap-16'
const HINT = 'inline-flex min-w-[0px] items-center gap-6 text-caption text-dim'

function sameFields(a: TaskCreateFields, b: TaskCreateFields): boolean {
  return (
    a.taskTitle === b.taskTitle &&
    a.assigneeMemberId === b.assigneeMemberId &&
    a.dueDate === b.dueDate
  )
}

/** 카드 머리 아래 한 줄 — 왜 확인해야 하는지 */
function reasonLine(approval: TaskCreateApproval): string {
  if (approval.gate === 'hold') return '정보가 부족해 태스크 초안을 만들지 않았어요'
  const { missing } = approval
  if (missing.includes('assignee') && missing.includes('due')) return '담당자와 마감이 미정이에요'
  if (missing.includes('assignee')) return '담당자가 미정이에요'
  if (missing.includes('due')) return '마감이 미정이에요'
  return '내용을 확인해야 해요'
}

export interface ApprovalCardProps {
  workspaceId: string
  approval: Approval
  /** 현재 공간의 팀원. 아직 모르면 undefined */
  members: readonly Member[] | undefined
  /** 회의 id 로 찾는 회의 목록. 연결 회의 이름과 근거 시각을 읽는다. 목록을 아직 모르면 비어 있다 */
  meetings: ReadonlyMap<string, MeetingSummary>
}

export function ApprovalCard(props: ApprovalCardProps) {
  const { approval } = props
  if (approval.kind === 'task_create') return <TaskCreateCard {...props} approval={approval} />
  return <SummaryCard workspaceId={props.workspaceId} approval={approval} />
}

function SummaryCard({ workspaceId, approval }: { workspaceId: string; approval: Approval }) {
  const title =
    approval.kind === 'unsupported' ? approval.type : (approval.title ?? '제목 없는 확인 요청')
  const reason =
    approval.kind === 'task_update' && approval.assigneePick !== null
      ? '담당자를 골라야 하는 답장이에요'
      : isScopeChange(approval)
        ? '범위 변경을 확인해야 해요'
        : approval.kind === 'task_update'
          ? '변경 제안을 확인해야 해요'
          : '지원하지 않는 종류라 여기서 처리할 수 없어요'
  return (
    <Card
      as="article"
      variant="attention"
      className={`flex flex-col gap-16 ${ATTENTION_SHADOW}`}
      data-kind="approval"
    >
      <div className={HEAD}>
        <div className={BADGE_ROW}>
          <span className={ATTENTION_BADGE}>
            <Dot />
            확인 필요
          </span>
          <h2 className={TITLE}>{title}</h2>
        </div>
        <GuardedLink to={paths.approval(workspaceId, approval.id)} className={MEETING_LINK}>
          자세히 보기
          <Icon name="external" size={12} />
        </GuardedLink>
      </div>
      <p className={REASON}>{reason}</p>
    </Card>
  )
}

function Dot() {
  return <span aria-hidden="true" className="mr-3 h-5 w-5 shrink-0 rounded-999 bg-current" />
}

function TaskCreateCard({
  workspaceId,
  approval,
  members,
  meetings,
}: ApprovalCardProps & { approval: TaskCreateApproval }) {
  const recordMembers = useQuery(recordMemberListQueryOptions(workspaceId))
  const retainedNames = useMemo(
    () =>
      new Map(
        (recordMembers.data ?? members ?? []).map(({ id, displayName }) => [id, displayName]),
      ),
    [recordMembers.data, members],
  )
  const hold = approval.gate === 'hold'
  const memberList = useMemo(() => members ?? [], [members])
  const memberIds = useMemo(() => memberList.map(({ id }) => id), [memberList])
  const resolver = useApprovalResolve(workspaceId, approval.id, memberIds)

  const original = taskCreateValues(approval)
  const edits = resolver.draft?.kind === 'task_create' ? resolver.draft.values : {}
  const values = taskCreateValues(approval, edits)
  const [filling, setFilling] = useState(!hold)
  const [saveAlias, setSaveAlias] = useState(true)
  const dirty = !sameFields(values, original)
  useUnsavedChanges(dirty)

  const issues = validateTaskCreateFields(values, memberIds)
  const plan = planApprovalResolution(approval, 'approved', {
    memberIds,
    edits: resolver.draft,
  })
  const blockedReason =
    members === undefined ? '팀원 목록을 불러온 뒤 승인할 수 있어요.' : plan.ok ? null : plan.reason

  const meeting = approval.meetingId === null ? undefined : meetings.get(approval.meetingId)
  const meetingTitle = approval.meetingId === null ? null : (meeting?.title ?? '연결된 회의')
  const atClock = evidenceMoment(meeting, approval.evidence.atMs)
  const hint = hold && !filling ? '내용을 확인하고 미정인 채로도 승인할 수 있어요' : blockedReason
  const problem = resolver.problem
  const merged = mergedCount(approval)

  return (
    <Card
      as="article"
      variant={hold ? 'pending' : 'attention'}
      className={`flex flex-col gap-20 ${hold ? '' : ATTENTION_SHADOW}`}
      data-kind="approval"
      aria-busy={resolver.pending ? true : undefined}
    >
      <div className={HEAD}>
        <div className={BADGE_ROW}>
          {hold ? (
            <span className={HOLD_BADGE}>보류</span>
          ) : (
            <span className={ATTENTION_BADGE}>
              <Dot />
              확인 필요
            </span>
          )}
          <h2>
            <GuardedLink
              to={paths.approval(workspaceId, approval.id)}
              className={`${TITLE} hover:underline ${hold ? 'text-sub' : ''}`}
            >
              {approval.title}
            </GuardedLink>
          </h2>
        </div>
        {approval.meetingId === null || meetingTitle === null ? null : (
          <GuardedLink
            to={paths.meetings(workspaceId, approval.meetingId)}
            className={MEETING_LINK}
          >
            {meetingTitle}
            {atClock === null ? null : <span>{atClock}</span>}
            <Icon name="external" size={12} />
          </GuardedLink>
        )}
      </div>

      <div className={REASON_BLOCK}>
        <p className={REASON}>
          {reasonLine(approval)}
          {merged === null ? null : (
            <span className={`${SUB_NOTE} ml-8 tabular-nums`}>
              회의 {merged.meetings}곳 · 항목 {merged.items}개 합침
            </span>
          )}
        </p>
        {approval.asrSuspects.length === 0 ? null : (
          <ul aria-label="전사 확인" className="flex flex-col gap-4">
            {approval.asrSuspects.map((suspect) => {
              const line = asrSuspectLine(suspect)
              return (
                <li key={line} className={SUSPECT}>
                  <Icon name="mic" size={13} className="mt-[5px] shrink-0" />
                  <span className={SUSPECT_TEXT}>{line}</span>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {filling ? (
        <ApprovalFields
          values={values}
          issues={issues}
          members={memberList}
          retainedNames={retainedNames}
          editable={!resolver.pending}
          aliasText={aliasToLearn(approval, values)}
          saveAlias={saveAlias}
          onSaveAliasChange={(checked) => {
            resolver.invalidateConfirmation()
            setSaveAlias(checked)
          }}
          onChange={(next) => {
            resolver.editCreate({
              ...(next.taskTitle !== values.taskTitle ? { taskTitle: next.taskTitle } : {}),
              ...(next.assigneeMemberId !== values.assigneeMemberId
                ? { assigneeMemberId: next.assigneeMemberId }
                : {}),
              ...(next.dueDate !== values.dueDate ? { dueDate: next.dueDate } : {}),
            })
          }}
        />
      ) : null}

      <div className={EVIDENCE}>
        <div className={EVIDENCE_HEAD}>
          <span className={EVIDENCE_META}>
            전사문{atClock === null ? '' : ` ${atClock}`} ·{' '}
            {speakerName(recordMembers.data ?? members, approval.evidence) ?? '알 수 없음'}
          </span>
          {approval.meetingId === null ? null : (
            <GuardedLink
              to={paths.meetings(workspaceId, approval.meetingId)}
              className={EVIDENCE_LINK}
            >
              원문 듣기
              <Icon name="external" size={12} />
            </GuardedLink>
          )}
        </div>
        {approval.evidence.quote === null ? (
          <p className={SUB_NOTE}>근거 문장이 없어요.</p>
        ) : (
          <p className={QUOTE}>“{approval.evidence.quote}”</p>
        )}
        {merged === null ? <RawLine approval={approval} /> : null}
      </div>
      {/* 합친 카드의 원문은 담당자·마감을 정한 다른 회의의 것이라 대표 인용 칸 밖에 둔다 (#512) */}
      {merged === null ? null : <RawLine approval={approval} />}

      <CardFooter
        approval={approval}
        resolver={resolver}
        hint={hint}
        hold={hold && !filling}
        approveBlocked={blockedReason !== null}
        onFill={() => setFilling(true)}
        onApprove={() =>
          resolver.approve(approval, { kind: 'task_create', values: edits, saveAlias })
        }
      />
      {problem?.kind === 'error' || problem?.kind === 'changed' ? (
        <FormErrorPanel message={problem.message} />
      ) : problem?.kind === 'already_resolved' ? (
        <p role="status" className={SUB_NOTE}>
          {APPROVAL_RESOLUTION_REASONS.resolved}
        </p>
      ) : null}
    </Card>
  )
}

function RawLine({ approval }: { approval: TaskCreateApproval }) {
  return (
    <p className={SUB_NOTE}>
      {approval.mergedItems.length === 0 ? null : '합친 제안의 '}
      원문 담당자 {approval.assigneeRaw ?? '없음'} · 원문 마감 {approval.dueRaw ?? '없음'}
    </p>
  )
}

interface ApprovalFieldsProps {
  values: TaskCreateFields
  issues: readonly TaskCreateIssue[]
  members: readonly Member[]
  retainedNames: ReadonlyMap<string, string>
  editable: boolean
  /** 담당자에게 별칭으로 등록할 글자 (#523). null 이면 묻지 않는다 */
  aliasText: string | null
  saveAlias: boolean
  onSaveAliasChange: (checked: boolean) => void
  onChange: (next: TaskCreateFields) => void
}

/**
 * 제목·담당자·마감. 비우면 승인이 막히는 칸은 라벨에 안내를 붙이고 강조색으로 보인다.
 * 제목은 비었을 때만이 아니라 길이가 넘을 때도 오류다 — 그 오류만 문구가 붙는다
 */
function ApprovalFields({
  values,
  issues,
  members,
  retainedNames,
  editable,
  aliasText,
  saveAlias,
  onSaveAliasChange,
  onChange,
}: ApprovalFieldsProps) {
  const assigneeId = useId()
  const assigneeMissing = issues.includes('assignee')
  const dueMissing = issues.includes('due')
  const titleBlank = values.taskTitle.trim() === ''
  const titleError = issues.includes('title') && !titleBlank
  const dueInvalid = dueMissing && values.dueDate !== null && values.dueDate !== ''
  return (
    <div className={FIELDS}>
      <TextField
        label="태스크명"
        value={values.taskTitle}
        readOnly={!editable}
        labelTone={titleBlank ? 'required-blocking' : 'normal'}
        error={titleError ? '제목은 300자 이하로 입력해 주세요.' : undefined}
        onChange={(event) => onChange({ ...values, taskTitle: event.target.value })}
      />
      <div className="flex flex-col">
        <Label htmlFor={assigneeId} blocking={assigneeMissing} className="mb-6">
          {assigneeMissing ? '담당자 — 골라 주세요' : '담당자'}
        </Label>
        <Select
          id={assigneeId}
          label="담당자"
          value={values.assigneeMemberId}
          onValueChange={(assigneeMemberId) => onChange({ ...values, assigneeMemberId })}
          options={assigneeOptions(members, values.assigneeMemberId, retainedNames)}
          noneOption={ASSIGNEE_NONE_OPTION}
          placeholder={assigneeMissing ? '담당자 고르기' : undefined}
          tone={assigneeMissing ? 'blocking' : 'normal'}
          disabled={!editable}
          aria-invalid={assigneeMissing}
        />
        <AliasSaveField
          aliasText={aliasText}
          members={members}
          assigneeMemberId={values.assigneeMemberId}
          checked={saveAlias}
          onCheckedChange={onSaveAliasChange}
          disabled={!editable}
        />
      </div>
      <TextField
        label={dueMissing && !dueInvalid ? '마감 — 날짜를 정해 주세요' : '마감'}
        type="text"
        placeholder="YYYY-MM-DD 또는 미정"
        value={values.dueDate ?? ''}
        style={dueMissing && !dueInvalid ? { color: 'var(--color-accent)' } : undefined}
        readOnly={!editable}
        labelTone={dueMissing && !dueInvalid ? 'required-blocking' : 'normal'}
        error={dueInvalid ? '마감은 있는 날짜여야 해요.' : undefined}
        onChange={(event) => onChange({ ...values, dueDate: event.target.value || null })}
      />
      <Button
        type="button"
        variant="ghost"
        disabled={!editable}
        onClick={() => onChange({ ...values, dueDate: null })}
      >
        마감 미정
      </Button>
    </div>
  )
}

interface CardFooterProps {
  approval: TaskCreateApproval
  resolver: ApprovalResolve
  hint: string | null

  hold: boolean

  approveBlocked: boolean
  onFill: () => void
  onApprove: () => void
}

function CardFooter({
  approval,
  resolver,
  hint,
  hold,
  approveBlocked,
  onFill,
  onApprove,
}: CardFooterProps) {
  const hintId = useId()
  return (
    <div className={FOOTER}>
      {hint === null ? (
        <span />
      ) : (
        <span id={hintId} className={HINT}>
          <Icon name="info" size={13} />
          {hint}
        </span>
      )}
      <div className="flex shrink-0 items-center gap-9">
        <Button
          variant="ghost"
          loading={resolver.pendingDecision === 'rejected'}
          disabled={resolver.pending}
          onClick={() => resolver.reject(approval)}
        >
          반려
        </Button>
        {hold ? (
          <Button variant="default" onClick={onFill}>
            직접 채우기
          </Button>
        ) : (
          <Button
            variant="primary"
            loading={resolver.pendingDecision === 'approved'}
            disabled={resolver.pending || approveBlocked}
            aria-describedby={hint === null ? undefined : hintId}
            onClick={onApprove}
          >
            승인
          </Button>
        )}
      </div>
    </div>
  )
}
