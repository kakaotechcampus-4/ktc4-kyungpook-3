import { queryOptions } from '@tanstack/react-query'
import type { z } from 'zod'
import { request } from '@/shared/api/client'
import { parseResponse } from '@/shared/api/parseResponse'
import { captureSessionScope } from '@/shared/api/sessionScope'
import { workspaceKey } from '@/shared/api/queryKeys'
import {
  bundleSchema,
  createdReminderSchema,
  inboxSchema,
  reminderWithBundleSchema,
  threadDetailSchema,
  threadSummarySchema,
} from '@/shared/types/api/message'
import type {
  BundleApproveRequestDto,
  BundleDto,
  BundleUpdateRequestDto,
  ReminderCreateRequestDto,
  ReminderUpdateRequestDto,
  ReminderWithBundleDto,
  ReplyCreateRequestDto,
  ThreadOpenRequestDto,
} from '@/shared/types/api/message'
import { replyAttributionListSchema } from '@/shared/types/api/reply'
import type { AttributionRequestDto } from '@/shared/types/api/reply'
import {
  toBundle,
  toCreatedReminder,
  toMessageInbox,
  toMessageThread,
  toReplyAttribution,
  toThreadSummary,
} from '../model/mapper'
import type {
  Bundle,
  CreatedReminder,
  MessageAction,
  MessageActionOutcome,
  MessageThreadSummary,
  ReminderCreateInput,
} from '../model/types'

/*
 * 메시지 조회와 쓰기 (계약 §5.7). 상시 polling 은 두지 않는다 (D-136)
 */

const AI_WORKER_DRAFT_POLL_MS = 30_000
const DRAFT_POLL_MS = AI_WORKER_DRAFT_POLL_MS / 3

/**
 * 조회를 옵션을 만든 세션에 묶는다. TanStack 의 간격은 cancelQueries·removeQueries 로 멈추지 않아,
 * 로그아웃 전환 중 아직 구독 중인 이전 화면이 다음 틱에 다음 세션으로 요청한다. 끝난 세션의 신호로 보내기 전에 취소하고 간격을 멈춘다
 */
function boundToSession() {
  const session = captureSessionScope()
  return {
    signal: (query: AbortSignal) => AbortSignal.any([query, session.signal]),
    pollWhileDrafting: (bundles: readonly Bundle[] | undefined): number | false =>
      session.isCurrent() && bundles?.some((bundle) => bundle.drafting) ? DRAFT_POLL_MS : false,
  }
}

function messagesPath(workspaceId: string): string {
  return `/workspaces/${encodeURIComponent(workspaceId)}/messages`
}

/** 그 공간의 메시지 캐시 전체(목록·대화). 행동이 성공하면 이 key 를 무효화한다 */
export function messageKeys(workspaceId: string) {
  return workspaceKey(workspaceId, 'messages')
}

/** 왼쪽 목록 — 보낼 메시지(PM 만)와 대화 요약 */
export function messageInboxQueryOptions(workspaceId: string) {
  const session = boundToSession()
  return queryOptions({
    queryKey: workspaceKey(workspaceId, 'messages', 'inbox'),
    queryFn: async ({ signal }) =>
      toMessageInbox(
        parseResponse(
          inboxSchema,
          await request<unknown>(messagesPath(workspaceId), { signal: session.signal(signal) }),
          'message',
        ),
      ),
    refetchInterval: ({ state: { data } }) =>
      session.pollWhileDrafting(data?.viewer === 'pm' ? data.bundles : undefined),
    refetchIntervalInBackground: false,
  })
}

/** 대화 하나. 목록과 따로 받는다 — 한쪽 오류가 다른 쪽을 막지 않는다 (계획 C-6 5단계) */
export function messageThreadQueryOptions(workspaceId: string, threadId: string) {
  const session = boundToSession()
  return queryOptions({
    queryKey: workspaceKey(workspaceId, 'messages', 'threads', threadId),
    queryFn: async ({ signal }) =>
      toMessageThread(
        parseResponse(
          threadDetailSchema,
          await request<unknown>(
            `${messagesPath(workspaceId)}/threads/${encodeURIComponent(threadId)}`,
            { signal: session.signal(signal) },
          ),
          'message',
        ),
      ),
    refetchInterval: ({ state: { data } }) => session.pollWhileDrafting(data?.upcoming),
    refetchIntervalInBackground: false,
  })
}

/**
 * 그 대화에서 PM 이 태스크를 고를 답장과 고른 답장. PM 만 받는다 — 팀원은 서버가 403 이다.
 * 메시지 key 아래에 두어 행동이 성공하면 같이 다시 받는다
 */
export function replyAttributionsQueryOptions(workspaceId: string, threadId: string) {
  const session = boundToSession()
  return queryOptions({
    queryKey: workspaceKey(workspaceId, 'messages', 'threads', threadId, 'attributions'),
    queryFn: async ({ signal }) => {
      const { items } = parseResponse(
        replyAttributionListSchema,
        await request<unknown>(
          `${messagesPath(workspaceId)}/threads/${encodeURIComponent(threadId)}/attributions`,
          { signal: session.signal(signal) },
        ),
        'message',
      )
      return items.map(toReplyAttribution)
    },
  })
}

function enc(id: string): string {
  return encodeURIComponent(id)
}

const DONE: MessageActionOutcome = { kind: 'done' }
const CLOSED: MessageActionOutcome = { kind: 'closed' }

interface Route {
  method: 'POST' | 'PATCH'
  path: string
  body?: unknown
  /** 응답 본문을 결과로 읽는다. 없으면 본문을 보지 않고 done 이다 */
  read?: (data: unknown) => MessageActionOutcome
}

/** 응답 본문을 그 경로의 스키마로 읽는다. 맞지 않으면 `INVALID_RESPONSE` 다 — 쓰기는 반영됐을 수 있다 */
function reads<S extends z.ZodType>(
  schema: S,
  toOutcome: (dto: z.output<S>) => MessageActionOutcome,
): (data: unknown) => MessageActionOutcome {
  return (data) => toOutcome(parseResponse(schema, data, 'message'))
}

/** 옮긴 시각에 같은 사람의 예정 묶음이 있으면 서버가 그쪽으로 합치고 합친 묶음을 돌려준다 — ID 가 달라진다 */
function scheduleOutcome(bundleId: string, dto: BundleDto): MessageActionOutcome {
  const into = toBundle(dto)
  return into !== null && into.id !== bundleId ? { kind: 'merged', into } : DONE
}

/**
 * 행동 종류마다 경로와 응답 읽기가 하나다. 종류를 더하면 이 표가 빠져 빌드가 깨진다.
 * 응답은 화면이 고른 묶음이 없어지는 행동만 읽는다 — 합쳐지거나(시각 옮기기) 닫히면(마지막 태스크 빼기) 화면이 떠나야 한다
 */
const ROUTE: {
  [K in MessageAction['kind']]: (action: Extract<MessageAction, { kind: K }>) => Route
} = {
  approve: (action) => ({
    method: 'POST',
    path: `bundles/${enc(action.bundleId)}/approve`,
    body: { draft_version: action.draftVersion } satisfies BundleApproveRequestDto,
  }),
  cancel: (action) => ({ method: 'POST', path: `bundles/${enc(action.bundleId)}/cancel` }),
  edit: (action) => ({
    method: 'PATCH',
    path: `bundles/${enc(action.bundleId)}`,
    body: { body: action.body } satisfies BundleUpdateRequestDto,
  }),
  schedule: (action) => ({
    method: 'PATCH',
    path: `bundles/${enc(action.bundleId)}`,
    body: { scheduled_at: action.scheduledAt } satisfies BundleUpdateRequestDto,
    read: reads(bundleSchema, (dto: BundleDto) => scheduleOutcome(action.bundleId, dto)),
  }),
  reply: (action) => ({
    method: 'POST',
    path: `threads/${enc(action.threadId)}/replies`,
    body: { body: action.body } satisfies ReplyCreateRequestDto,
  }),
  // 마지막 하나였으면 서버가 묶음을 취소하고 그 묶음을 돌려준다
  removeTask: (action) => ({
    method: 'POST',
    path: `reminders/${enc(action.reminderId)}/cancel`,
    read: reads(reminderWithBundleSchema, (dto: ReminderWithBundleDto) =>
      dto.bundle.status === 'cancelled' ? CLOSED : DONE,
    ),
  }),
  editNote: (action) => ({
    method: 'PATCH',
    path: `reminders/${enc(action.reminderId)}`,
    body: { note: action.note } satisfies ReminderUpdateRequestDto,
  }),
  attribute: (action) => ({
    method: 'POST',
    path: `replies/${enc(action.messageId)}/attribution`,
    body: { task_id: action.taskId } satisfies AttributionRequestDto,
  }),
}

function routeOf(action: MessageAction): Route {
  switch (action.kind) {
    case 'approve':
      return ROUTE.approve(action)
    case 'cancel':
      return ROUTE.cancel(action)
    case 'edit':
      return ROUTE.edit(action)
    case 'schedule':
      return ROUTE.schedule(action)
    case 'reply':
      return ROUTE.reply(action)
    case 'removeTask':
      return ROUTE.removeTask(action)
    case 'editNote':
      return ROUTE.editNote(action)
    case 'attribute':
      return ROUTE.attribute(action)
  }
}

/**
 * 메시지 쓰기 하나를 요청한다. 부른 쪽이 캐시를 무효화해 서버 상태로 다시 그린다.
 * `signal` 은 그 쓰기를 만든 세션의 취소 신호다 — 세션이 끝나면 요청도 끊긴다
 */
export async function requestMessageAction(
  workspaceId: string,
  action: MessageAction,
  signal?: AbortSignal,
): Promise<MessageActionOutcome> {
  const { method, path, body, read } = routeOf(action)
  const data = await request<unknown>(`${messagesPath(workspaceId)}/${path}`, {
    method,
    body,
    signal,
  })
  return read === undefined ? DONE : read(data)
}

/**
 * 재촉 하나를 만든다. 대상 묶음이 아직 없어 묶음 행동(MessageAction)이 아니다.
 * 서버가 그 팀원·시각의 예정 묶음에 넣는다 — 있으면 합쳐 승인이 풀리고, 같은 태스크가 이미 있으면 그 재촉을 그대로 돌려준다
 */
export async function createReminder(
  workspaceId: string,
  input: ReminderCreateInput,
  signal?: AbortSignal,
): Promise<CreatedReminder> {
  const body: ReminderCreateRequestDto = {
    member_id: input.memberId,
    task_id: input.taskId,
    scheduled_at: input.scheduledAt,
    note: input.note,
  }
  return toCreatedReminder(
    parseResponse(
      createdReminderSchema,
      await request<unknown>(`${messagesPath(workspaceId)}/reminders`, {
        method: 'POST',
        body,
        signal,
      }),
      'message',
    ),
  )
}

/**
 * 그 팀원과의 대화를 연다. 대상 대화가 아직 없을 수 있어 메시지 행동(MessageAction)이 아니다.
 * 서버는 있으면 그 대화를, 없으면 빈 대화를 만들어 돌려준다 — 몇 번 불러도 대화는 하나다.
 * PM 은 공간의 누구든, 팀원은 자기 대화만 연다
 */
export async function openThread(
  workspaceId: string,
  memberId: string,
  signal?: AbortSignal,
): Promise<MessageThreadSummary> {
  const body: ThreadOpenRequestDto = { member_id: memberId }
  return toThreadSummary(
    parseResponse(
      threadSummarySchema,
      await request<unknown>(`${messagesPath(workspaceId)}/threads`, {
        method: 'POST',
        body,
        signal,
      }),
      'message',
    ),
  )
}
