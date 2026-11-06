import { http } from 'msw'
import { db } from '../db'
import { ok, fail } from '../envelope'
import { requireMember, requirePmRole } from '../auth-guard'
import { MOCK_NOW } from '../fixtures/constants'
import { reply } from '../fixtures/message'
import { roleIn, sessionMemberId } from '../sessions'
import {
  approveBundle,
  bundleDto,
  cancelBundle,
  cancelReminder,
  createReminder,
  editBundle,
  editReminder,
  inboxOf,
  reminderWithBundleDto,
  threadDetailOf,
  utc,
} from '../message-state'
import type {
  BundleContext,
  BundleRefusal,
  ReminderContext,
  ReminderRefusal,
  ReminderResult,
  Viewer,
} from '../message-state'
import { nextId, readJson } from '../utils'

/*
 * 메시지 (계약 §5.7). 경로·응답·오류 코드는 백엔드 api/messages.py 와 같다.
 * 상태를 바꾸는 요청은 성공 응답을 낼 때만 db 를 바꾼다 (D-137). 시각은 MOCK_NOW, ID 는 nextId 다 (msw-guide 「지킬 규칙」).
 * 검사 순서도 백엔드와 같다 — PM 확인, 요청 본문(400), 대상 찾기(404), 상태 규칙(409)
 */

const serverError = () => fail('INTERNAL_ERROR', '메시지를 불러오지 못했습니다.', 500)
const actionError = () => fail('INTERNAL_ERROR', '메시지 요청을 처리하지 못했습니다.', 500)
const invalid = (message: string) => fail('INVALID_REQUEST', message, 400)
const threadNotFound = (threadId: unknown) =>
  fail('MESSAGE_THREAD_NOT_FOUND', '대화를 찾을 수 없습니다.', 404, { thread_id: threadId })
const forbidden = (threadId: string) =>
  fail('FORBIDDEN', '권한이 없습니다.', 403, { thread_id: threadId })
const bundleNotFound = (bundleId: unknown) =>
  fail('REMINDER_BUNDLE_NOT_FOUND', '해당 보낼 메시지를 찾을 수 없습니다.', 404, {
    bundle_id: bundleId,
  })

const reminderNotFound = (reminderId: unknown) =>
  fail('REMINDER_NOT_FOUND', '해당 리마인드를 찾을 수 없습니다.', 404, { reminder_id: reminderId })

const REFUSAL: Record<BundleRefusal | ReminderRefusal, () => ReturnType<typeof fail>> = {
  not_editable: () =>
    fail(
      'REMINDER_NOT_EDITABLE',
      '예정 상태의 리마인드만 고치거나 승인하거나 취소할 수 있습니다.',
      409,
    ),
  changed: () => fail('BUNDLE_CHANGED', '보낼 메시지가 바뀌었어요. 다시 확인해 주세요.', 409),
  time_passed: () =>
    fail('REMINDER_SCHEDULED_AT_PASSED', '예정 시각이 지났어요. 시각을 다시 골라 주세요.', 409),
  merge_with_body: () =>
    invalid(
      '다른 보낼 메시지와 합쳐지는 시각으로 옮길 때는 문구를 같이 고칠 수 없습니다. 시각부터 옮겨 주세요.',
    ),
  task_not_found: () => fail('TASK_NOT_FOUND', '해당 태스크를 찾을 수 없습니다.', 404),
  member_not_found: () => fail('MEMBER_NOT_FOUND', '해당 팀원을 찾을 수 없습니다.', 404),
}

function reminderResponse(result: ReminderResult, status = 200) {
  if ('refusal' in result) return REFUSAL[result.refusal]()
  return ok(reminderWithBundleDto(result), { status })
}

/** 시간대가 있는 ISO 시각만 받는다 (백엔드 AwareDatetime) */
const AWARE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/

function viewerOf(workspaceId: string): Viewer {
  return roleIn(workspaceId) === 'pm' ? 'pm' : 'member'
}

function findThread(workspaceId: string, threadId: unknown) {
  return db.messageThreads.find(
    ({ thread_id, workspace_id }) => thread_id === threadId && workspace_id === workspaceId,
  )
}

function findBundle(workspaceId: string, bundleId: unknown) {
  return db.messageBundles.find(
    ({ bundle_id, workspace_id }) => bundle_id === bundleId && workspace_id === workspaceId,
  )
}

function workspaceBundles(workspaceId: string) {
  return db.messageBundles.filter(({ workspace_id }) => workspace_id === workspaceId)
}

/** 문구 틀의 PM 은 가장 먼저 등록된 PM 이다 — 픽스처 리마인드에는 만든 사람(created_by)이 없다 */
function bundleContext(workspaceId: string): BundleContext {
  const pm = db.members
    .filter(({ workspace_id, role }) => workspace_id === workspaceId && role === 'pm')
    .sort(
      (left, right) =>
        left.created_at.localeCompare(right.created_at) ||
        left.member_id.localeCompare(right.member_id),
    )
    .at(0)
  return {
    bundles: workspaceBundles(workspaceId),
    tasks: db.tasks.filter(({ workspace_id }) => workspace_id === workspaceId),
    threads: db.messageThreads.filter(({ workspace_id }) => workspace_id === workspaceId),
    pmName: pm?.display_name ?? 'PM',
    workspaceName:
      db.workspaces.find(({ workspace_id }) => workspace_id === workspaceId)?.name ?? '',
  }
}

function reminderContext(workspaceId: string): ReminderContext {
  return {
    ...bundleContext(workspaceId),
    workspaceId,
    members: db.members.filter(({ workspace_id }) => workspace_id === workspaceId),
    allThreads: db.messageThreads,
    allBundles: db.messageBundles,
  }
}

/** 그 공간의 리마인드와 그것이 든 묶음 */
function findReminder(workspaceId: string, reminderId: unknown) {
  for (const bundle of workspaceBundles(workspaceId)) {
    const reminder = bundle.reminders.find(({ reminder_id }) => reminder_id === reminderId)
    if (reminder) return { bundle, reminder }
  }
  return null
}

function isAware(value: unknown): value is string {
  return typeof value === 'string' && AWARE.test(value) && !Number.isNaN(Date.parse(value))
}

/** 빈 메모는 메모가 없는 것으로 본다 (백엔드 _note) */
function readNote(value: unknown): string | null | undefined {
  if (value === null) return null
  if (typeof value !== 'string') return undefined
  return value.trim() === '' ? null : value.trim()
}

/** `ReminderCreateRequest`. 틀렸으면 사람이 읽을 이유를 돌려준다 */
function readReminderCreate(
  input: Record<string, unknown> | null,
): { member_id: string; task_id: string; scheduled_at: string; note: string | null } | string {
  if (input === null) return '요청 본문이 없습니다.'
  const { member_id, task_id, scheduled_at } = input
  if (typeof member_id !== 'string' || typeof task_id !== 'string')
    return 'member_id 와 task_id 가 필요합니다.'
  if (!isAware(scheduled_at)) return 'scheduled_at 은 시간대가 있는 ISO 시각이어야 합니다.'
  const note = input.note === undefined ? null : readNote(input.note)
  if (note === undefined) return 'note 는 글이어야 합니다.'
  return { member_id, task_id, scheduled_at, note }
}

/** `ReminderUpdateRequest`. note 를 보내지 않으면 그대로, null·빈 글이면 지운다 */
function readReminderPatch(
  input: Record<string, unknown> | null,
): { note?: string | null; scheduled_at?: string } | string {
  if (input === null) return '요청 본문이 없습니다.'
  const patch: { note?: string | null; scheduled_at?: string } = {}
  if ('note' in input) {
    const note = readNote(input.note)
    if (note === undefined) return 'note 는 글이어야 합니다.'
    patch.note = note
  }
  if (input.scheduled_at !== undefined && input.scheduled_at !== null) {
    if (!isAware(input.scheduled_at)) return 'scheduled_at 은 시간대가 있는 ISO 시각이어야 합니다.'
    patch.scheduled_at = input.scheduled_at
  }
  return Object.keys(patch).length === 0 ? 'note 나 scheduled_at 중 하나는 있어야 합니다.' : patch
}

/** `BundleUpdateRequest`. 틀렸으면 사람이 읽을 이유를 돌려준다 */
function readBundlePatch(
  input: Record<string, unknown> | null,
): { body?: string; scheduled_at?: string } | string {
  if (input === null) return '요청 본문이 없습니다.'
  const patch: { body?: string; scheduled_at?: string } = {}
  if (input.body !== undefined && input.body !== null) {
    if (typeof input.body !== 'string' || input.body.trim() === '') return '내용이 비어 있습니다.'
    patch.body = input.body.trim()
  }
  if (input.scheduled_at !== undefined && input.scheduled_at !== null) {
    if (!isAware(input.scheduled_at)) return 'scheduled_at 은 시간대가 있는 ISO 시각이어야 합니다.'
    patch.scheduled_at = input.scheduled_at
  }
  return Object.keys(patch).length === 0 ? 'body 나 scheduled_at 중 하나는 있어야 합니다.' : patch
}

export const messageHandlers = [
  http.get('/api/v1/workspaces/:workspaceId/messages', ({ params }) => {
    const workspaceId = String(params.workspaceId)
    const denied = requireMember(workspaceId)
    if (denied) return denied
    if (db.messageFailures.inbox) return serverError()
    const threads = db.messageThreads.filter(({ workspace_id }) => workspace_id === workspaceId)
    return ok(
      inboxOf(
        threads,
        workspaceBundles(workspaceId),
        viewerOf(workspaceId),
        sessionMemberId(workspaceId),
      ),
    )
  }),

  /** PM 과 대화 주인만 본다. 남의 대화는 403 */
  http.get('/api/v1/workspaces/:workspaceId/messages/threads/:threadId', ({ params }) => {
    const workspaceId = String(params.workspaceId)
    const denied = requireMember(workspaceId)
    if (denied) return denied
    const thread = findThread(workspaceId, params.threadId)
    if (!thread) return threadNotFound(params.threadId)
    const viewer = viewerOf(workspaceId)
    if (viewer !== 'pm' && thread.member_id !== sessionMemberId(workspaceId))
      return forbidden(thread.thread_id)
    if (db.messageFailures.threadIds.includes(thread.thread_id)) return serverError()
    return ok(threadDetailOf(thread, workspaceBundles(workspaceId), viewer))
  }),

  /** 대화 주인만 웹에서 답한다. PM 도 남의 대화에는 쓸 수 없다. Discord 로는 나가지 않는다 */
  http.post(
    '/api/v1/workspaces/:workspaceId/messages/threads/:threadId/replies',
    async ({ params, request }) => {
      const workspaceId = String(params.workspaceId)
      const denied = requireMember(workspaceId)
      if (denied) return denied
      const thread = findThread(workspaceId, params.threadId)
      if (!thread) return threadNotFound(params.threadId)
      if (thread.member_id !== sessionMemberId(workspaceId)) return forbidden(thread.thread_id)
      const input = await readJson(request)
      const body = typeof input?.body === 'string' ? input.body.trim() : ''
      if (body === '') return invalid('내용이 비어 있습니다.')
      if (db.messageFailures.actions) return actionError()
      const messageId = nextId(
        'mg',
        db.messageThreads.flatMap((item) => item.messages.map(({ message_id }) => message_id)),
      )
      const message = reply(messageId, body, MOCK_NOW, 'web')
      thread.messages.push(message)
      return ok(
        { ...message, thread_id: thread.thread_id, created_at: utc(message.created_at) },
        { status: 201 },
      )
    },
  ),

  /** 문구나 시각을 고친다. 승인은 유지한다. 같은 시각의 예정 묶음과 합쳐지면 합친 묶음을 돌려준다 */
  http.patch(
    '/api/v1/workspaces/:workspaceId/messages/bundles/:bundleId',
    async ({ params, request }) => {
      const workspaceId = String(params.workspaceId)
      const denied = requirePmRole(workspaceId)
      if (denied) return denied
      const bundle = findBundle(workspaceId, params.bundleId)
      if (!bundle) return bundleNotFound(params.bundleId)
      const patch = readBundlePatch(await readJson(request))
      if (typeof patch === 'string') return invalid(patch)
      if (db.messageFailures.actions) return actionError()
      const result = editBundle(bundle, patch, MOCK_NOW, bundleContext(workspaceId))
      if ('refusal' in result) return REFUSAL[result.refusal]()
      return ok(bundleDto(result.bundle))
    },
  ),

  /** PM 이 본 판(draft_version)이 지금 판과 다르면 409 BUNDLE_CHANGED. 이미 승인했으면 판과 상관없이 그대로 200 */
  http.post(
    '/api/v1/workspaces/:workspaceId/messages/bundles/:bundleId/approve',
    async ({ params, request }) => {
      const workspaceId = String(params.workspaceId)
      const denied = requirePmRole(workspaceId)
      if (denied) return denied
      const bundle = findBundle(workspaceId, params.bundleId)
      if (!bundle) return bundleNotFound(params.bundleId)
      const input = await readJson(request)
      const version = input?.draft_version
      if (typeof version !== 'number' || !Number.isInteger(version))
        return invalid('draft_version 이 필요합니다.')
      if (db.messageFailures.actions) return actionError()
      const refusal = approveBundle(bundle, version, MOCK_NOW)
      if (refusal !== null) return REFUSAL[refusal]()
      return ok(bundleDto(bundle))
    },
  ),

  /** 보내지 않음. 안의 리마인드도 모두 취소한다 */
  http.post('/api/v1/workspaces/:workspaceId/messages/bundles/:bundleId/cancel', ({ params }) => {
    const workspaceId = String(params.workspaceId)
    const denied = requirePmRole(workspaceId)
    if (denied) return denied
    const bundle = findBundle(workspaceId, params.bundleId)
    if (!bundle) return bundleNotFound(params.bundleId)
    if (db.messageFailures.actions) return actionError()
    const refusal = cancelBundle(bundle, MOCK_NOW)
    if (refusal !== null) return REFUSAL[refusal]()
    return ok(bundleDto(bundle))
  }),

  /** 재촉을 만들어 그 팀원·시각의 보낼 메시지에 넣는다. 같은 시각의 메시지가 있으면 합쳐지고 승인이 풀린다 */
  http.post('/api/v1/workspaces/:workspaceId/messages/reminders', async ({ params, request }) => {
    const workspaceId = String(params.workspaceId)
    const denied = requirePmRole(workspaceId)
    if (denied) return denied
    const input = readReminderCreate(await readJson(request))
    if (typeof input === 'string') return invalid(input)
    if (db.messageFailures.actions) return actionError()
    return reminderResponse(createReminder(input, MOCK_NOW, reminderContext(workspaceId)), 201)
  }),

  /** 메모를 고치거나 다른 시각으로 옮긴다. 메모가 바뀌거나 옮기면 묶음 문구를 다시 만들고 승인이 풀린다 */
  http.patch(
    '/api/v1/workspaces/:workspaceId/messages/reminders/:reminderId',
    async ({ params, request }) => {
      const workspaceId = String(params.workspaceId)
      const denied = requirePmRole(workspaceId)
      if (denied) return denied
      const patch = readReminderPatch(await readJson(request))
      if (typeof patch === 'string') return invalid(patch)
      const found = findReminder(workspaceId, params.reminderId)
      if (!found) return reminderNotFound(params.reminderId)
      if (db.messageFailures.actions) return actionError()
      return reminderResponse(
        editReminder(found.bundle, found.reminder, patch, MOCK_NOW, reminderContext(workspaceId)),
      )
    },
  ),

  /** 리마인드 하나를 뺀다. 마지막 하나였으면 보낼 메시지도 취소된다 */
  http.post(
    '/api/v1/workspaces/:workspaceId/messages/reminders/:reminderId/cancel',
    ({ params }) => {
      const workspaceId = String(params.workspaceId)
      const denied = requirePmRole(workspaceId)
      if (denied) return denied
      const found = findReminder(workspaceId, params.reminderId)
      if (!found) return reminderNotFound(params.reminderId)
      if (db.messageFailures.actions) return actionError()
      return reminderResponse(
        cancelReminder(found.bundle, found.reminder, MOCK_NOW, bundleContext(workspaceId)),
      )
    },
  ),
]
