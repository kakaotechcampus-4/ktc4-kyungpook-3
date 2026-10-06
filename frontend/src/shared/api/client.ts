import axios from 'axios'
import type { AxiosProgressEvent, AxiosResponse } from 'axios'
import type { Envelope } from '@/shared/types/api/envelope'
import { config } from '@/shared/config/env'
import { parseEnvelope, unwrap } from './envelope'
import { ApiError, CLIENT_ERROR_CODES, createClientError } from './errors'
import { captureSessionScope } from './sessionScope'

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export type QueryParamValue = string | number | boolean | null | undefined

/**
 * 업로드 전송 진행. `total` 이 null 이면 전체 크기를 모른다 — 화면은 불확정 진행으로 그린다.
 * 전송률일 뿐이다. 100% 여도 서버가 응답하기 전이면 끝난 것이 아니다.
 */
export interface UploadProgress {
  /** 지금까지 보낸 바이트 */
  loaded: number
  /** 전체 바이트. 모르면 null */
  total: number | null
}

export type UploadProgressListener = (progress: UploadProgress) => void

export interface RequestOptions {
  method?: HttpMethod
  /** null·undefined 값은 보내지 않는다 */
  params?: Record<string, QueryParamValue>
  /** 객체는 JSON, FormData 는 multipart 로 나간다 */
  body?: unknown
  /** TanStack Query 의 signal 을 그대로 넘긴다 */
  signal?: AbortSignal
  /** 본문 전송 진행. axios 이벤트를 넘기지 않고 `UploadProgress` 로 바꿔 준다 */
  onUploadProgress?: UploadProgressListener
}

type UnauthorizedListener = (error: ApiError) => void

const unauthorizedListeners = new Set<UnauthorizedListener>()

/* 본문 해석을 axios 에 맡기지 않는다. axios 는 JSON 파싱에 실패하면 문자열을 조용히 돌려주고
   빈 본문을 '' 로 준다 — 잘못된 응답과 204 를 여기서 직접 갈라야 한다 (D-172).
   상태 코드도 전부 받아서 여기서 판정한다. axios 가 던지는 것은 전송 실패와 취소뿐이다.
   인터셉터는 쓰지 않는다 — 재요청도 비즈니스 규칙도 이 계층에 없다 (D-120, D-135). */
const client = axios.create({
  baseURL: new URL(config.apiBaseUrl, window.location.origin).href,
  withCredentials: true,
  responseType: 'text',
  transformResponse: [(data: unknown) => data],
  validateStatus: () => true,
  headers: { Accept: 'application/json' },
})

/**
 * 지금 세션에서 출발한 요청의 401 마다 알린다. 세션 만료인지는 구독자(app)가 판단한다. 해제 함수를 돌려준다.
 * 끝난 세션에서 출발한 요청의 401 은 알리지 않는다 — 그 401 은 이미 끝난 세션의 것이다 (sessionScope, U4 r3 M04)
 */
export function onUnauthorized(listener: UnauthorizedListener): () => void {
  unauthorizedListeners.add(listener)
  return () => {
    unauthorizedListeners.delete(listener)
  }
}

/**
 * 공통 요청. 봉투를 풀어 `data` 를 돌려주고 실패는 모두 `ApiError` 로 던진다.
 * 204 는 본문을 읽지 않고 `undefined` 다. 재시도하지 않는다 — 재시도는 Query 정책이 정한다.
 */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  // 출발한 세션. 로그아웃·재로그인 뒤에 늦게 온 401 이 새 세션을 끝내지 않게 알림 전에 본다
  const session = captureSessionScope()
  let response: AxiosResponse<unknown>
  try {
    response = await client.request<unknown>({
      url: path,
      method: options.method ?? 'GET',
      params: options.params,
      data: options.body,
      signal: options.signal,
      onUploadProgress: toAxiosProgressListener(options.onUploadProgress),
    })
  } catch (error) {
    throw toTransportError(error)
  }
  try {
    return readResponse<T>(response.status, response.data)
  } catch (error) {
    if (
      error instanceof ApiError &&
      error.kind === 'http' &&
      error.status === 401 &&
      session.isCurrent()
    ) {
      for (const listener of unauthorizedListeners) listener(error)
    }
    throw error
  }
}

/**
 * axios 진행 이벤트를 화면이 쓰는 값으로 바꾼다. 전체 크기를 모르거나(`lengthComputable` 거짓, `total` 없음·0)
 * 숫자가 아니면 `total: null` 이다. 보낸 양은 0 이상, 전체를 알면 전체 이하로 자른다.
 */
export function toUploadProgress(event: {
  loaded: number
  total?: number
  lengthComputable: boolean
}): UploadProgress {
  const loaded = Number.isFinite(event.loaded) ? Math.max(0, event.loaded) : 0
  const { total } = event
  if (!event.lengthComputable || total === undefined || !Number.isFinite(total) || total <= 0)
    return { loaded, total: null }
  return { loaded: Math.min(loaded, total), total }
}

function toAxiosProgressListener(
  listener: UploadProgressListener | undefined,
): ((event: AxiosProgressEvent) => void) | undefined {
  if (listener === undefined) return undefined
  return (event) => listener(toUploadProgress(event))
}

function toTransportError(error: unknown): unknown {
  if (axios.isCancel(error)) return createClientError(CLIENT_ERROR_CODES.REQUEST_CANCELED)
  if (axios.isAxiosError(error)) return createClientError(CLIENT_ERROR_CODES.NETWORK_ERROR)
  return error
}

function readResponse<T>(status: number, body: unknown): T {
  if (status === 204) return undefined as T
  const succeeded = status >= 200 && status < 300
  const envelope = parseEnvelope(body)
  if (envelope === null) {
    throw createClientError(
      succeeded ? CLIENT_ERROR_CODES.INVALID_RESPONSE : CLIENT_ERROR_CODES.UNKNOWN_ERROR,
      status,
    )
  }
  if (!succeeded && envelope.error === null) {
    throw createClientError(CLIENT_ERROR_CODES.UNKNOWN_ERROR, status)
  }
  return unwrap(envelope as Envelope<T>, status)
}
