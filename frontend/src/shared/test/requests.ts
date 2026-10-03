import { onTestFinished } from 'vitest'
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

/** 부팅 조회(세션·워크스페이스 목록)를 뺀 나머지. 이것이 「업무 API」다 */
export function businessRequests(requests: readonly RecordedRequest[]): RecordedRequest[] {
  return requests.filter(({ method, path }) => !(method === 'GET' && BOOT_PATHS.has(path)))
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
