import { onTestFinished } from 'vitest'
import { db } from '@/shared/mock/db'
import type { MockDb } from '@/shared/mock/db'
import { server } from '@/shared/mock/server'

export interface RecordedRequest {
  method: string
  /** `/api/v1` 을 뗀 경로 + 검색 문자열 */
  path: string
}

export interface RequestLog {
  /** 시작한 순서 */
  started: RecordedRequest[]
  /** 모의 응답을 받은 순서 */
  answered: RecordedRequest[]
  /** `start GET /auth/me` · `answer GET /auth/me` 꼴의 한 줄 기록. 앞뒤 순서를 볼 때 쓴다 */
  timeline: string[]
}

function toRecord(request: Request): RecordedRequest {
  const url = new URL(request.url)
  return { method: request.method, path: `${url.pathname.replace(/^\/api\/v1/, '')}${url.search}` }
}

/** 이 테스트 동안 MSW 가 받은 요청을 적는다. 테스트가 끝나면 스스로 멈춘다 */
export function recordRequests(): RequestLog {
  const log: RequestLog = { started: [], answered: [], timeline: [] }
  const onStart = ({ request }: { request: Request }) => {
    const record = toRecord(request)
    log.started.push(record)
    log.timeline.push(`start ${record.method} ${record.path}`)
  }
  const onAnswer = ({ request }: { request: Request }) => {
    const record = toRecord(request)
    log.answered.push(record)
    log.timeline.push(`answer ${record.method} ${record.path}`)
  }
  server.events.on('request:start', onStart)
  server.events.on('response:mocked', onAnswer)
  onTestFinished(() => {
    server.events.removeListener('request:start', onStart)
    server.events.removeListener('response:mocked', onAnswer)
  })
  return log
}

const BOOT_PATHS = new Set(['/auth/me', '/workspaces'])

/** 기존 화면 테스트가 보는 공간. 다른 공간 화면을 보는 테스트는 `trackerWorkspaceId` 를 넘긴다 */
const DEFAULT_TRACKER_WORKSPACE = 'ws_01'

const MEETING_DETAIL_PATH = /^\/meetings\/[^/?]+$/

/**
 * M5 U4 처리 추적기의 상시 요청인가. 두 모양뿐이다 (app/router/layouts, features/meeting-processing):
 * - 지금 URL 공간의 회의 목록 `GET /workspaces/{workspaceId}/meetings` — 정리 중 회의 발견
 * - 회의 상세 `GET /meetings/{meetingId}` — 정리 중 회의의 polling
 * 다른 공간의 목록, 회의록·추출·승인·태스크 같은 다른 업무 요청은 여기 들지 않는다.
 */
export function isTrackerRequest(
  { method, path }: RecordedRequest,
  workspaceId: string = DEFAULT_TRACKER_WORKSPACE,
): boolean {
  if (method !== 'GET') return false
  return (
    path === `/workspaces/${encodeURIComponent(workspaceId)}/meetings` ||
    MEETING_DETAIL_PATH.test(path)
  )
}

/** 추적기의 상시 요청만. 발견·polling 횟수를 단언할 때 쓴다 */
export function trackerRequests(
  requests: readonly RecordedRequest[],
  workspaceId: string = DEFAULT_TRACKER_WORKSPACE,
): RecordedRequest[] {
  return requests.filter((request) => isTrackerRequest(request, workspaceId))
}

export interface BusinessRequestOptions {
  /** 추적기 요청으로 볼 지금 URL 공간. 기본은 ws_01 */
  trackerWorkspaceId?: string
}

/**
 * 부팅 조회(세션·워크스페이스 목록)와 처리 추적기의 상시 요청을 뺀 나머지. 이것이 「화면의 업무 API」다.
 *
 * M5 U4 부터 인증된 앱 영역의 추적기가 워크스페이스 화면마다 지금 공간의 회의 목록을 받고, 정리 중 회의의 상세를
 * polling 한다(계획 §2·§3, U4-1). 부팅 조회처럼 화면과 무관하게 앱이 내는 요청이라 함께 뺀다 —
 * M4 의 「이 화면은 업무 API 0회」 단언들은 화면 자신의 요청을 본다. 추적기 요청은 `trackerRequests` 로 따로 단언한다
 * (app/meetingProcessing.test.tsx). 결정: .orca-loop/u4-r1-impl.md, docs/impl-decision/2026-10-03-processing-tracker.md
 */
export function businessRequests(
  requests: readonly RecordedRequest[],
  { trackerWorkspaceId = DEFAULT_TRACKER_WORKSPACE }: BusinessRequestOptions = {},
): RecordedRequest[] {
  return requests.filter(
    (request) =>
      !(request.method === 'GET' && BOOT_PATHS.has(request.path)) &&
      !isTrackerRequest(request, trackerWorkspaceId),
  )
}

/**
 * 그 공간의 최신 완료 회의(시작 시각이 가장 늦은 `done`)의 추출 ID. 대시보드가 최근 반영으로 부르는 추출이다.
 * 모의 db 에서 읽는다 — 테스트가 회의를 바꾼 뒤에 부르면 바뀐 값이다. 없으면 null
 */
export function latestDoneExtractionId(
  workspaceId: string = DEFAULT_TRACKER_WORKSPACE,
  state: MockDb = db,
): string | null {
  const done = state.meetings
    .filter((meeting) => meeting.workspace_id === workspaceId && meeting.status === 'done')
    .sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at))
  return done[0]?.extraction_id ?? null
}

export interface DashboardRequestScope {
  /** 대시보드 공간. 기본은 ws_01 */
  workspaceId?: string
  /**
   * 대시보드가 부를 추출 ID(`latestDoneExtractionId`). 이 ID 의 `GET /extractions/{id}` 만 인정한다.
   * 넘기지 않거나 null 이면 어떤 추출 조회도 인정하지 않는다 — 다른 회의·공간의 추출 조회 회귀를 숨기지 않는다 (E-05)
   */
  extractionId?: string | null
}

/**
 * M7 대시보드 화면 자신의 조회인가 (widgets/dashboard useDashboardData). 태스크 목록·대기 승인·팀원·연동과 최신 완료 회의의 추출이다.
 * 회의 목록·회의 상세는 추적기 요청과 같은 모양이라 `businessRequests` 가 이미 뺀다.
 * 대시보드로 착지하는 가드·부팅 테스트가 「그 밖의 업무 요청은 없다」를 단언할 때 쓴다
 */
export function isDashboardRequest(
  { method, path }: RecordedRequest,
  { workspaceId = DEFAULT_TRACKER_WORKSPACE, extractionId = null }: DashboardRequestScope = {},
): boolean {
  if (method !== 'GET') return false
  const id = encodeURIComponent(workspaceId)
  return [
    `/tasks?workspace_id=${id}`,
    `/approvals?workspace_id=${id}&status=pending`,
    `/members?workspace_id=${id}`,
    `/workspaces/${id}/integrations`,
    ...(extractionId === null ? [] : [`/extractions/${encodeURIComponent(extractionId)}`]),
  ].includes(path)
}

/** 이 테스트 동안 `method path`(`/api/v1` 을 뗀 경로, 검색 문자열 제외)로 간 JSON 본문을 보낸 순서대로 적는다 */
export function recordRequestBodies(method: string, path: string): unknown[] {
  const bodies: unknown[] = []
  const onStart = ({ request }: { request: Request }) => {
    const url = new URL(request.url)
    if (request.method !== method || url.pathname !== `/api/v1${path}`) return
    void request
      .clone()
      .json()
      .then((body: unknown) => bodies.push(body))
  }
  server.events.on('request:start', onStart)
  onTestFinished(() => {
    server.events.removeListener('request:start', onStart)
  })
  return bodies
}
