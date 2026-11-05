import { http } from 'msw'
import { db } from '../db'
import { ok, list, fail } from '../envelope'
import { MOCK_NOW } from '../fixtures/constants'
import { readJson } from '../utils'
import { requireAuth, requireMember, requirePm } from '../auth-guard'
import {
  createTask,
  updateTask,
  taskUpdates,
  validTaskFields,
  approvalTaskUpdateFields,
  ownershipError,
  taskCreateFields,
  findConflicts,
  validDate,
  addHistory,
} from '../task-state'
import type { ApprovalDto } from '@/shared/types/api/approval'

type Failure = ReturnType<typeof fail>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function ownershipFailure(owned: NonNullable<ReturnType<typeof ownershipError>>): Failure {
  return fail(owned.code, owned.message, owned.code === 'WORKSPACE_MISMATCH' ? 400 : 404)
}

function historyText(value: unknown): string | null {
  if (value === null || value === undefined) return null
  return typeof value === 'string' ? value : (JSON.stringify(value) ?? null)
}

function normalizeOverrides(
  type: string,
  status: unknown,
  value: unknown,
): Record<string, unknown> | Failure {
  if (value === undefined || value === null) return {}
  if (!isRecord(value)) return fail('INVALID_REQUEST', '보완 값이 올바르지 않습니다.', 400)
  if (Object.keys(value).length === 0) return {}
  const allowed =
    type === 'task_create'
      ? ['task_title', 'assignee_member_id', 'due_date']
      : type === 'task_update'
        ? ['status', 'due_date']
        : []
  if (status !== 'approved' || Object.keys(value).some((field) => !allowed.includes(field)))
    return fail('INVALID_REQUEST', '이 요청에서 고칠 수 없는 필드입니다.', 400)
  const normalized: Record<string, unknown> = {}
  for (const [field, edit] of Object.entries(value)) {
    if (edit === null) {
      if (field !== 'due_date' && field !== 'assignee_member_id')
        return fail('INVALID_REQUEST', '미정으로 둘 수 없는 필드입니다.', 400)
      normalized[field] = null
    } else if (field === 'task_title') {
      if (typeof edit !== 'string' || [...edit.trim()].length < 1 || [...edit.trim()].length > 300)
        return fail('INVALID_REQUEST', '제목이 올바르지 않습니다.', 400)
      normalized[field] = edit.trim()
    } else if (field === 'due_date') {
      const date = normalizeDate(edit)
      if (date === null) return fail('INVALID_REQUEST', '마감이 올바르지 않습니다.', 400)
      normalized[field] = date
    } else if (field === 'status') {
      if (typeof edit !== 'string' || !['todo', 'in_progress', 'blocked', 'done'].includes(edit))
        return fail('INVALID_REQUEST', '상태가 올바르지 않습니다.', 400)
      normalized[field] = edit
    } else {
      if (typeof edit !== 'string')
        return fail('INVALID_REQUEST', '담당자가 올바르지 않습니다.', 400)
      normalized[field] = edit
    }
  }
  return normalized
}

function normalizeDate(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const date = /^\d{8}$/.test(value)
    ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6)}`
    : value
  return validDate(date) ? date : null
}

function changedOverrides(
  overrides: Record<string, unknown>,
  proposal: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(overrides).filter(([field, value]) => {
      const original =
        field === 'due_date' ? (normalizeDate(proposal[field]) ?? proposal[field]) : proposal[field]
      return !Object.hasOwn(proposal, field) || value !== original
    }),
  )
}

/*
 * 승인 반영은 두 단계다. prepare* 는 db 를 읽기만 하고 검증이 모두 통과했을 때만 적용 함수를 돌려준다.
 * MSW 에는 트랜잭션 롤백이 없으므로, 실패하면 승인·태스크·이력·추출 어느 것도 바뀌지 않아야 한다
 * (백엔드 resolve_approval 은 _apply_approval 이 실패하면 db.rollback() 으로 pending 에 남긴다).
 */
type Prepared = Failure | ((actor: string) => void)

function prepareTaskCreate(
  approval: ApprovalDto,
  overridesInput: Record<string, unknown>,
): Prepared {
  const payload = approval.payload
  // 백엔드 _get_linkable_extraction_item 처럼 Task 를 만들기 전에 연결 대상부터 검증한다.
  // 항목이 없으면 연결 없이 진행한다
  const extractionItemId =
    typeof payload.extraction_item_id === 'string' ? payload.extraction_item_id : ''
  const extraction = extractionItemId
    ? db.extractions.find(({ items }) => items.some(({ item_id }) => item_id === extractionItemId))
    : undefined
  const linkedItem = extraction?.items.find(({ item_id }) => item_id === extractionItemId)
  if (extraction && linkedItem) {
    const itemWorkspaceId = db.meetings.find(
      ({ meeting_id }) => meeting_id === extraction.meeting_id,
    )?.workspace_id
    if (itemWorkspaceId !== approval.workspace_id)
      return fail(
        'WORKSPACE_MISMATCH',
        '승인 요청의 워크스페이스와 추출 항목의 워크스페이스가 다릅니다.',
        400,
        {
          extraction_item_id: extractionItemId,
          approval_workspace_id: approval.workspace_id,
          extraction_item_workspace_id: itemWorkspaceId ?? null,
        },
      )
    if (linkedItem.approval_id !== approval.approval_id)
      return fail('INVALID_REQUEST', '추출 항목이 이 승인 요청에 연결되어 있지 않습니다.', 400, {
        extraction_item_id: extractionItemId,
        approval_id: approval.approval_id,
        extraction_item_approval_id: linkedItem.approval_id,
      })
  }

  const proposal = {
    task_title: payload.task_title || payload.title || '',
    assignee_member_id: payload.assignee_member_id ?? null,
    due_date: payload.due_date ?? null,
  }
  const changed = changedOverrides(overridesInput, proposal)
  const final = { ...proposal, ...changed }
  const fields = taskCreateFields({
    title: final.task_title,
    assignee_member_id: final.assignee_member_id,
    due_date: final.due_date === null ? null : (normalizeDate(final.due_date) ?? final.due_date),
  })
  if (!fields.ok)
    return fail('INVALID_REQUEST', '승인 내용이 올바르지 않습니다.', 400, { field: fields.field })

  // 회의·담당자 소속은 백엔드 validate_workspace_ownership 과 같다 (없음 404, 다른 공간 400)
  const meetingId = typeof payload.meeting_id === 'string' ? payload.meeting_id : null
  const owned = ownershipError(approval.workspace_id, {
    assignee_member_id: fields.assignee_member_id,
    meeting_id: meetingId,
  })
  if (owned) return ownershipFailure(owned)

  return (actor) => {
    const task = createTask(
      {
        workspace_id: approval.workspace_id,
        title: fields.title,
        status: 'todo',
        history_title: historyText(proposal.task_title) ?? '',
        meeting_id: meetingId,
        assignee_member_id: fields.assignee_member_id,
        due_date: fields.due_date,
      },
      actor,
      typeof payload.change_source === 'string'
        ? payload.change_source
        : meetingId
          ? 'meeting'
          : 'manual',
    )
    for (const [field, value] of Object.entries(changed)) {
      const original = proposal[field as keyof typeof proposal]
      addHistory(
        task.task_id,
        field === 'task_title' ? 'title' : field === 'assignee_member_id' ? 'assignee' : field,
        field === 'task_title' && typeof original !== 'string' ? null : historyText(original),
        historyText(value),
        actor,
        'manual',
      )
    }
    if (Object.keys(changed).length) approval.payload = { ...payload, task_overrides: changed }
    approval.related_task_id = task.task_id
    // 실 백엔드와 같게 — 위에서 검증한 그 항목의 task_id 만 채우되 approval_id 는 비우지 않는다
    // (계약 §3.1, §4.0-②-12). 화면은 task_id 를 우선으로 읽어 이 상태를 반영됨으로 다룬다.
    if (linkedItem) linkedItem.task_id = task.task_id
  }
}

/**
 * 변경 승인. 백엔드 _apply_approval 의 task_update 와 같다. 제안 뒤에 같은 필드가 바뀌었으면(_find_conflicts)
 * confirm_task_version 이 지금 task.version 과 같을 때만 덮어쓴다. 아니면 409 APPROVAL_CONFLICT 다
 */
function prepareTaskUpdate(
  approval: ApprovalDto,
  confirmTaskVersion: number | null,
  overrides: Record<string, unknown>,
): Prepared {
  const payload = approval.payload
  if (approval.related_task_id === null)
    return fail('INVALID_REQUEST', '변경할 태스크가 필요합니다.', 400, {
      approval_id: approval.approval_id,
    })
  const task = db.tasks.find(({ task_id }) => task_id === approval.related_task_id)
  if (!task)
    return fail('TASK_NOT_FOUND', '태스크가 없습니다.', 404, { task_id: approval.related_task_id })
  // 백엔드는 승인과 대상 태스크의 워크스페이스가 다르면 400 WORKSPACE_MISMATCH 다
  if (task.workspace_id !== approval.workspace_id)
    return fail(
      'WORKSPACE_MISMATCH',
      '승인 요청의 워크스페이스와 대상 태스크의 워크스페이스가 다릅니다.',
      400,
    )
  const changes: Record<string, unknown> = {}
  // start_date 는 승인 경로가 받지 않는다 (백엔드 _TASK_UPDATE_FIELDS 와 같다)
  for (const field of approvalTaskUpdateFields)
    if (field in payload) changes[field] = payload[field]
  // 백엔드는 충돌을 값 검증보다 먼저 본다
  const changed = changedOverrides(overrides, changes)
  const final = { ...changes, ...changed }
  if (final.due_date !== undefined && final.due_date !== null)
    final.due_date = normalizeDate(final.due_date) ?? final.due_date
  const conflicts = findConflicts(task, final, payload.base_values)
  if (
    typeof payload.base_title === 'string' &&
    task.title !== payload.base_title &&
    !conflicts.some(({ field }) => field === 'title')
  )
    conflicts.push({
      field: 'title',
      base: payload.base_title,
      current: task.title,
      proposed: task.title,
    })
  if (conflicts.length > 0 && confirmTaskVersion !== task.version)
    return fail(
      'APPROVAL_CONFLICT',
      '제안 이후 task가 바뀌었습니다. 지금 값을 확인한 뒤 다시 승인해 주세요.',
      409,
      {
        approval_id: approval.approval_id,
        task_id: task.task_id,
        task_version: task.version,
        conflicts,
      },
    )
  if (!validTaskFields(final))
    return fail('INVALID_REQUEST', '태스크 변경 값이 올바르지 않습니다.', 400)
  // 백엔드 apply_task_updates 는 값 검증 뒤 담당자 소속을 본다. 기준은 task.workspace_id 다
  const assigned = ownershipError(task.workspace_id, {
    assignee_member_id: final.assignee_member_id,
  })
  if (assigned) return ownershipFailure(assigned)
  return (actor) => {
    const source = typeof payload.change_source === 'string' ? payload.change_source : 'meeting'
    const proposed = Object.fromEntries(
      Object.entries(final).filter(([field]) => !Object.hasOwn(changed, field)),
    )
    updateTask(task, taskUpdates(proposed), actor, source)
    updateTask(task, taskUpdates(changed), actor, 'manual')
    // BE 미구현, #205 합의대로. 태스크 값이 아니라 version·Notion 반영을 건드리지 않는다
    if (payload.category === 'scope')
      addHistory(
        task.task_id,
        'scope',
        null,
        typeof payload.doc_text === 'string' ? payload.doc_text : null,
        actor,
        source,
      )
    if (Object.keys(changed).length) approval.payload = { ...payload, task_overrides: changed }
  }
}

export const approvalHandlers = [
  // 소속 팀원이면 조회할 수 있다 (백엔드 get_current_member). PM 전용 조회는 백엔드에 없다
  http.get('/api/v1/approvals', ({ request }) => {
    const unauthenticated = requireAuth()
    if (unauthenticated) return unauthenticated
    const query = new URL(request.url).searchParams
    const workspaceId = query.get('workspace_id')
    const status = query.get('status')
    if (!workspaceId || (status !== null && !['pending', 'approved', 'rejected'].includes(status)))
      return fail('INVALID_REQUEST', '승인 조회 조건이 올바르지 않습니다.', 400)
    const denied = requireMember(workspaceId)
    if (denied) return denied
    return list(
      db.approvals
        .filter(
          (approval) =>
            approval.workspace_id === workspaceId &&
            (status === null || approval.status === status),
        )
        .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)),
    )
  }),
  http.get('/api/v1/approvals/:approvalId', ({ params }) => {
    const unauthenticated = requireAuth()
    if (unauthenticated) return unauthenticated
    const approval = db.approvals.find(({ approval_id }) => approval_id === params.approvalId)
    if (!approval) return fail('APPROVAL_NOT_FOUND', '승인 요청이 없습니다.', 404)
    return requireMember(approval.workspace_id) ?? ok(approval)
  }),
  /*
   * 백엔드 resolve_approval 과 같은 순서다. 인증 → 본문 → 승인 존재 → PM(403) → 대기 중인지(409) → 반영.
   */
  http.patch('/api/v1/approvals/:approvalId', async ({ params, request }) => {
    const unauthenticated = requireAuth()
    if (unauthenticated) return unauthenticated
    const body = await readJson(request)
    const confirm = body?.confirm_task_version
    if (
      !body ||
      (body.status !== 'approved' && body.status !== 'rejected') ||
      !(
        confirm === undefined ||
        confirm === null ||
        (typeof confirm === 'number' && Number.isInteger(confirm) && confirm >= 1)
      )
    )
      return fail('INVALID_REQUEST', '처리 상태가 올바르지 않습니다.', 400)
    const approval = db.approvals.find(({ approval_id }) => approval_id === params.approvalId)
    if (!approval) return fail('APPROVAL_NOT_FOUND', '승인 요청이 없습니다.', 404)
    const pm = requirePm(approval.workspace_id)
    if (pm instanceof Response) return pm
    const overrides = normalizeOverrides(approval.type, body.status, body.task_overrides)
    if (overrides instanceof Response) return overrides
    if (approval.status !== 'pending')
      return fail('APPROVAL_ALREADY_RESOLVED', '이미 처리된 승인 요청입니다.', 409, {
        approval_id: approval.approval_id,
        current_status: approval.status,
      })
    if (body.status === 'approved') {
      const prepared =
        approval.type === 'task_create'
          ? prepareTaskCreate(approval, overrides)
          : approval.type === 'task_update'
            ? prepareTaskUpdate(approval, typeof confirm === 'number' ? confirm : null, overrides)
            : // 그 밖의 종류(reminder_dm 등)는 태스크에 반영할 내용이 없다 — 백엔드와 같다
              () => {}
      if (prepared instanceof Response) return prepared
      prepared(pm.memberId)
    }
    approval.status = body.status
    approval.resolved_by = pm.memberId
    approval.resolved_at = MOCK_NOW
    return ok(approval)
  }),
]
