import { useId, useMemo, useState } from 'react'
import {
  APPROVAL_RESOLUTION_REASONS,
  planApprovalResolution,
  validateTaskCreateFields,
} from '@/entities/approval'
import type {
  Approval,
  TaskCreateApproval,
  TaskCreateFields,
  TaskCreateIssue,
} from '@/entities/approval'
import { speakerName } from '@/entities/member'
import type { Member } from '@/entities/member'
import { currentApprovalTransport, useApprovalResolve } from '@/features/approval-resolve'
import type { ApprovalResolve } from '@/features/approval-resolve'
import { paths } from '@/shared/config/routes'
import { GuardedLink, useUnsavedChanges } from '@/shared/lib/unsaved-changes'
import { Button } from '@/shared/ui/button'
import { Card } from '@/shared/ui/card'
import { FormErrorPanel } from '@/shared/ui/form-error-panel'
import { Icon } from '@/shared/ui/icon'
import { Label } from '@/shared/ui/label'
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
const REASON = 'text-body text-sub'
const FIELDS = 'grid grid-cols-[minmax(0px,1.6fr)_minmax(0px,1fr)_minmax(0px,1fr)] gap-12'
const SELECT =
  'h-[42px] w-full appearance-none rounded-9 border bg-surface pr-36 pl-13 text-body disabled:border-line disabled:bg-surface-sunken disabled:text-faint'
const EVIDENCE = 'flex flex-col gap-7 rounded-12 bg-surface-sunken px-20 py-18'
const EVIDENCE_HEAD = 'flex items-center justify-between gap-12'
const EVIDENCE_META = 'text-[11px] text-dim tabular-nums'
const EVIDENCE_LINK = 'inline-flex items-center gap-5 text-meta text-dim hover:text-ink'
const QUOTE = 'text-body leading-[1.7] text-ink'
const SUB_NOTE = 'text-caption text-dim'
const FOOTER = 'flex items-center justify-between gap-16'
const HINT = 'inline-flex min-w-[0px] items-center gap-6 text-caption text-dim'

/** 근거 시각. 한 시간 미만은 `mm:ss`, 넘으면 `h:mm:ss` */
function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(total / 3600)
  const mmss = `${String(Math.floor((total % 3600) / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
  return hours > 0 ? `${hours}:${mmss}` : mmss
}

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
  if (missing.includes('assignee') && missing.includes('due')) return '담당자와 마감을 정해야 해요'
  if (missing.includes('assignee')) return '담당자를 정해야 해요'
  if (missing.includes('due')) return '마감을 정해야 해요'
  return '내용을 확인해야 해요'
}

export interface ApprovalCardProps {
  workspaceId: string
  approval: Approval
  /** 현재 공간의 팀원. 아직 모르면 undefined */
  members: readonly Member[] | undefined
  /** 연결 회의 제목. 회의 목록을 아직 모르면 undefined */
  meetingTitles: ReadonlyMap<string, string>
}

/**
 * 확인 필요 카드 (Tasks 시안). 목록 안에서 바로 보완하고 승인·반려한다.
 * - 생성 승인: 제목은 상세로 가는 링크. 보완 입력은 개발 MSW 에서만 열린다. 실 API 에서 필수값이 없으면 `승인` 을 끄고 미지원 사유를 보이며 `반려` 는 남긴다
 * - 변경·지원하지 않는 종류: 요약과 상세 링크만. 현재값 비교·충돌 재확인은 상세에서 한다
 */
export function ApprovalCard(props: ApprovalCardProps) {
  const { approval } = props
  if (approval.kind === 'task_create') return <TaskCreateCard {...props} approval={approval} />
  return <SummaryCard workspaceId={props.workspaceId} approval={approval} />
}

function SummaryCard({ workspaceId, approval }: { workspaceId: string; approval: Approval }) {
  const title =
    approval.kind === 'unsupported' ? approval.type : (approval.title ?? '제목 없는 확인 요청')
  const reason =
    approval.kind === 'task_update'
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
  meetingTitles,
}: ApprovalCardProps & { approval: TaskCreateApproval }) {
  const transport = currentApprovalTransport()
  const editable = transport === 'msw'
  const hold = approval.gate === 'hold'
  const memberList = useMemo(() => members ?? [], [members])
  const memberIds = useMemo(() => memberList.map(({ id }) => id), [memberList])
  const resolver = useApprovalResolve(workspaceId, approval.id, memberIds)

  const original: TaskCreateFields = {
    taskTitle: approval.title,
    assigneeMemberId: approval.assigneeMemberId,
    dueDate: approval.dueDate,
  }
  const [values, setValues] = useState<TaskCreateFields>(original)
  // 보류 카드는 `직접 채우기` 를 눌러야 입력이 열린다
  const [filling, setFilling] = useState(!hold)
  const dirty = editable && !sameFields(values, original)
  useUnsavedChanges(dirty)

  const issues = validateTaskCreateFields(values, memberIds)
  const plan = planApprovalResolution(approval, 'approved', {
    transport,
    memberIds,
    overrides: dirty ? values : null,
  })
  const blockedReason =
    members === undefined ? '팀원 목록을 불러온 뒤 승인할 수 있어요.' : plan.ok ? null : plan.reason

  const meetingTitle =
    approval.meetingId === null ? null : (meetingTitles.get(approval.meetingId) ?? '연결된 회의')
  const atClock = approval.evidence.atMs === null ? null : clock(approval.evidence.atMs)
  const dueHint =
    approval.dueRaw !== null && issues.includes('due') && values.dueDate === null
      ? `"${approval.dueRaw}"은 날짜로 바꿔야 Notion에 올라갑니다`
      : null
  // 개발 MSW 의 접힌 보류 카드만 채우기 안내를 쓴다. 실 API 는 판정 사유(보완 미지원 문장 포함)를 그대로 보인다
  const hint =
    hold && !filling && editable
      ? '담당자와 마감을 채우면 승인할 수 있어요'
      : (blockedReason ?? dueHint)
  const problem = resolver.problem

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

      <p className={REASON}>{reasonLine(approval)}</p>

      {filling ? (
        <ApprovalFields
          values={values}
          issues={issues}
          members={memberList}
          editable={editable && !resolver.pending}
          onChange={setValues}
        />
      ) : null}

      <div className={EVIDENCE}>
        <div className={EVIDENCE_HEAD}>
          <span className={EVIDENCE_META}>
            전사문{atClock === null ? '' : ` ${atClock}`} ·{' '}
            {speakerName(members, approval.evidence.speaker) ?? '알 수 없음'}
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
        <p className={SUB_NOTE}>
          원문 담당자 {approval.assigneeRaw ?? '없음'} · 원문 마감 {approval.dueRaw ?? '없음'}
        </p>
      </div>

      <CardFooter
        approval={approval}
        resolver={resolver}
        hint={hint}
        hold={hold && !filling}
        canFill={editable}
        approveBlocked={blockedReason !== null}
        onFill={() => setFilling(true)}
        onApprove={() =>
          resolver.resolve(approval, {
            decision: 'approved',
            overrides: editable && dirty ? values : null,
          })
        }
      />
      {problem?.kind === 'error' ? (
        <FormErrorPanel message={problem.message} />
      ) : problem?.kind === 'already_resolved' ? (
        <p role="status" className={SUB_NOTE}>
          {APPROVAL_RESOLUTION_REASONS.resolved}
        </p>
      ) : null}
    </Card>
  )
}

interface ApprovalFieldsProps {
  values: TaskCreateFields
  issues: readonly TaskCreateIssue[]
  members: readonly Member[]
  editable: boolean
  onChange: (next: TaskCreateFields) => void
}

/**
 * 제목·담당자·마감. 비우면 승인이 막히는 칸은 라벨에 안내를 붙이고 강조색으로 보인다.
 * 제목은 비었을 때만이 아니라 길이가 넘을 때도 오류다 — 그 오류만 문구가 붙는다
 */
function ApprovalFields({ values, issues, members, editable, onChange }: ApprovalFieldsProps) {
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
        <div className="relative">
          <select
            id={assigneeId}
            className={`${SELECT} ${assigneeMissing ? 'border-accent text-accent-soft' : 'border-input-border text-ink'}`}
            aria-invalid={assigneeMissing ? true : undefined}
            disabled={!editable}
            value={values.assigneeMemberId ?? ''}
            onChange={(event) =>
              onChange({ ...values, assigneeMemberId: event.target.value || null })
            }
          >
            <option value="">미지정</option>
            {members.map(({ id, displayName }) => (
              <option key={id} value={id}>
                {displayName}
              </option>
            ))}
          </select>
          <Icon
            name="chevron-down"
            size={14}
            className="pointer-events-none absolute top-1/2 right-12 -translate-y-1/2 text-dim"
          />
        </div>
      </div>
      <TextField
        label={dueMissing && !dueInvalid ? '마감 — 날짜를 정해 주세요' : '마감'}
        type="date"
        min="0001-01-01"
        max="9999-12-31"
        value={values.dueDate ?? ''}
        // 비우면 승인이 막히는 칸의 안내 글자는 연한 강조색이다 (시안 `YYYY-MM-DD`)
        style={dueMissing && !dueInvalid ? { color: 'var(--color-accent-soft)' } : undefined}
        readOnly={!editable}
        labelTone={dueMissing && !dueInvalid ? 'required-blocking' : 'normal'}
        error={dueInvalid ? '마감은 있는 날짜여야 해요.' : undefined}
        onChange={(event) => onChange({ ...values, dueDate: event.target.value || null })}
      />
    </div>
  )
}

interface CardFooterProps {
  approval: TaskCreateApproval
  resolver: ApprovalResolve
  hint: string | null
  /** 보류 카드가 아직 접힌 상태다. 개발 MSW 는 `직접 채우기`, 실 API 는 비활성 `승인` 이다. 반려 이름은 그대로다 */
  hold: boolean
  /** 직접 채울 수 있다 (개발 MSW) */
  canFill: boolean
  approveBlocked: boolean
  onFill: () => void
  onApprove: () => void
}

function CardFooter({
  approval,
  resolver,
  hint,
  hold,
  canFill,
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
          onClick={() => resolver.resolve(approval, { decision: 'rejected' })}
        >
          반려
        </Button>
        {hold && canFill ? (
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
