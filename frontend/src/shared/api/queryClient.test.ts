import { CancelledError, MutationObserver } from '@tanstack/react-query'
import { HttpResponse, delay, http } from 'msw'
import { fail, ok } from '@/shared/mock/envelope'
import { server } from '@/shared/mock/server'
import { request } from './client'
import { ApiError, CLIENT_ERROR_CODES, createClientError, isCanceledError } from './errors'
import {
  GC_TIME,
  RETRY_DELAY_MS,
  STALE_TIME,
  createQueryClient,
  isRetryableError,
  shouldRetryQuery,
} from './queryClient'

function httpError(status: number): ApiError {
  return new ApiError({ code: 'ANY', message: '', details: null }, status)
}

function probeQuery() {
  return {
    queryKey: ['probe'],
    queryFn: ({ signal }: { signal: AbortSignal }) => request('/probe', { signal }),
  }
}

describe('재시도 판정', () => {
  it.each([408, 500, 502, 503, 504])('%s 는 첫 실패 뒤 한 번만 다시 요청한다', (status) => {
    expect(shouldRetryQuery(0, httpError(status))).toBe(true)
    expect(shouldRetryQuery(1, httpError(status))).toBe(false)
  })

  it('네트워크 오류는 첫 실패 뒤 한 번만 다시 요청한다', () => {
    const error = createClientError(CLIENT_ERROR_CODES.NETWORK_ERROR)
    expect(shouldRetryQuery(0, error)).toBe(true)
    expect(shouldRetryQuery(1, error)).toBe(false)
  })

  it.each([400, 401, 403, 404, 409, 422, 429])('%s 는 다시 요청하지 않는다', (status) => {
    expect(shouldRetryQuery(0, httpError(status))).toBe(false)
  })

  it('취소·잘못된 응답·ApiError 가 아닌 오류는 다시 요청하지 않는다', () => {
    expect(isRetryableError(createClientError(CLIENT_ERROR_CODES.REQUEST_CANCELED))).toBe(false)
    expect(isRetryableError(createClientError(CLIENT_ERROR_CODES.INVALID_RESPONSE, 200))).toBe(
      false,
    )
    expect(isRetryableError(new CancelledError())).toBe(false)
    expect(isRetryableError(new TypeError('mapper broke'))).toBe(false)
  })

  it('봉투 없는 5xx 는 상태 코드로 판정한다', () => {
    expect(isRetryableError(createClientError(CLIENT_ERROR_CODES.UNKNOWN_ERROR, 502))).toBe(true)
  })
})

describe('createQueryClient', () => {
  it('기본 최신 30초, 미사용 캐시 제거 5분, 재시도 대기 1초, mutation 재시도 없음', () => {
    const defaults = createQueryClient().getDefaultOptions()
    expect(defaults.queries?.staleTime).toBe(30_000)
    expect(STALE_TIME.long).toBe(5 * 60_000)
    expect(defaults.queries?.gcTime).toBe(GC_TIME)
    expect(GC_TIME).toBe(5 * 60_000)
    expect(defaults.queries?.retryDelay).toBe(RETRY_DELAY_MS)
    expect(RETRY_DELAY_MS).toBe(1_000)
    expect(defaults.mutations?.retry).toBe(false)
  })

  it('5xx 조회는 1초 뒤 한 번만 다시 요청한다', async () => {
    const calls: number[] = []
    server.use(
      http.get('/api/v1/probe', () => {
        calls.push(Date.now())
        return fail('INTERNAL_ERROR', 'boom', 503)
      }),
    )
    await expect(createQueryClient().fetchQuery(probeQuery())).rejects.toMatchObject({
      status: 503,
    })
    expect(calls).toHaveLength(2)
    expect(calls[1] - calls[0]).toBeGreaterThanOrEqual(RETRY_DELAY_MS - 50)
  })

  it('네트워크 오류 조회도 한 번만 다시 요청한다', async () => {
    let calls = 0
    server.use(
      http.get('/api/v1/probe', () => {
        calls += 1
        return HttpResponse.error()
      }),
    )
    await expect(createQueryClient().fetchQuery(probeQuery())).rejects.toMatchObject({
      kind: 'network',
    })
    expect(calls).toBe(2)
  })

  it('404 조회는 다시 요청하지 않는다', async () => {
    let calls = 0
    server.use(
      http.get('/api/v1/probe', () => {
        calls += 1
        return fail('TASK_NOT_FOUND', 'missing', 404)
      }),
    )
    await expect(createQueryClient().fetchQuery(probeQuery())).rejects.toMatchObject({
      status: 404,
    })
    expect(calls).toBe(1)
  })

  it('mutation 은 5xx 여도 다시 요청하지 않는다', async () => {
    let calls = 0
    server.use(
      http.post('/api/v1/probe', () => {
        calls += 1
        return fail('INTERNAL_ERROR', 'boom', 500)
      }),
    )
    const observer = new MutationObserver(createQueryClient(), {
      mutationFn: () => request('/probe', { method: 'POST' }),
    })
    await expect(observer.mutate()).rejects.toMatchObject({ status: 500 })
    expect(calls).toBe(1)
  })

  it('취소한 조회는 다시 요청하지 않는다', async () => {
    let calls = 0
    server.use(
      http.get('/api/v1/probe', async () => {
        calls += 1
        await delay(100)
        return ok(null)
      }),
    )
    const client = createQueryClient()
    const pending = client.fetchQuery(probeQuery())
    await vi.waitFor(() => expect(calls).toBe(1))
    await client.cancelQueries({ queryKey: ['probe'] })
    await expect(pending).rejects.toSatisfy(isCanceledError)
    await delay(RETRY_DELAY_MS + 100)
    expect(calls).toBe(1)
  })
})
