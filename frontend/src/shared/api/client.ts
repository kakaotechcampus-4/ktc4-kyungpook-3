import axios from 'axios'
import type { AxiosResponse } from 'axios'
import type { Envelope } from '@/shared/types/api/envelope'
import { config } from '@/shared/config/env'
import { parseEnvelope, unwrap } from './envelope'
import { ApiError, CLIENT_ERROR_CODES, createClientError } from './errors'

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export type QueryParamValue = string | number | boolean | null | undefined

export interface RequestOptions {
  method?: HttpMethod
  /** null·undefined 값은 보내지 않는다 */
  params?: Record<string, QueryParamValue>
  /** 객체는 JSON, FormData 는 multipart 로 나간다 */
  body?: unknown
  /** TanStack Query 의 signal 을 그대로 넘긴다 */
  signal?: AbortSignal
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

/** 401 응답마다 알린다. 세션 만료인지는 구독자(app)가 판단한다. 해제 함수를 돌려준다 */
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
  let response: AxiosResponse<unknown>
  try {
    response = await client.request<unknown>({
      url: path,
      method: options.method ?? 'GET',
      params: options.params,
      data: options.body,
      signal: options.signal,
    })
  } catch (error) {
    throw toTransportError(error)
  }
  try {
    return readResponse<T>(response.status, response.data)
  } catch (error) {
    if (error instanceof ApiError && error.kind === 'http' && error.status === 401) {
      for (const listener of unauthorizedListeners) listener(error)
    }
    throw error
  }
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
