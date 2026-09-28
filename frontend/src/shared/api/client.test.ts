import { HttpResponse, delay, http } from 'msw'
import { fail, ok } from '@/shared/mock/envelope'
import { server } from '@/shared/mock/server'
import { onUnauthorized, request } from './client'
import { ApiError } from './errors'

const probe = '/api/v1/probe'

describe('request', () => {
  it('정상 봉투를 풀어 data 만 돌려준다', async () => {
    server.use(http.get(probe, () => ok({ items: [], total: 0 })))
    await expect(request('/probe')).resolves.toEqual({ items: [], total: 0 })
  })

  it('null·undefined 파라미터는 빼고 보낸다', async () => {
    let search = ''
    server.use(
      http.get(probe, ({ request: incoming }) => {
        search = new URL(incoming.url).search
        return ok(null)
      }),
    )
    await request('/probe', { params: { workspace_id: 'ws_01', status: undefined, tab: null } })
    expect(search).toBe('?workspace_id=ws_01')
  })

  it('객체 본문을 JSON 으로 보낸다', async () => {
    let received: unknown
    server.use(
      http.patch(probe, async ({ request: incoming }) => {
        received = await incoming.json()
        return ok({})
      }),
    )
    await request('/probe', { method: 'PATCH', body: { status: 'approved' } })
    expect(received).toEqual({ status: 'approved' })
  })

  it('HTTP 오류를 code·status·details 를 가진 ApiError 로 던진다', async () => {
    server.use(
      http.get(probe, () => fail('TASK_NOT_FOUND', '태스크가 없습니다.', 404, { task_id: 'tk_x' })),
    )
    const error = await request('/probe').catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({
      kind: 'http',
      code: 'TASK_NOT_FOUND',
      status: 404,
      details: { task_id: 'tk_x' },
    })
  })

  it('봉투가 없는 5xx 도 상태 코드를 가진 HTTP 오류다', async () => {
    server.use(
      http.get(
        probe,
        () =>
          new HttpResponse('<html>Bad Gateway</html>', {
            status: 502,
            headers: { 'Content-Type': 'text/html' },
          }),
      ),
    )
    await expect(request('/probe')).rejects.toMatchObject({
      kind: 'http',
      code: 'UNKNOWN_ERROR',
      status: 502,
    })
  })

  it('204 는 본문을 파싱하지 않고 undefined 다', async () => {
    server.use(http.delete(probe, () => new HttpResponse(null, { status: 204 })))
    await expect(request<void>('/probe', { method: 'DELETE' })).resolves.toBeUndefined()
  })

  it('네트워크 실패는 network 다', async () => {
    server.use(http.get(probe, () => HttpResponse.error()))
    await expect(request('/probe')).rejects.toMatchObject({
      kind: 'network',
      code: 'NETWORK_ERROR',
      status: 0,
    })
  })

  it('취소는 canceled 다', async () => {
    server.use(
      http.get(probe, async () => {
        await delay(200)
        return ok(null)
      }),
    )
    const controller = new AbortController()
    const pending = request('/probe', { signal: controller.signal })
    controller.abort()
    await expect(pending).rejects.toMatchObject({ kind: 'canceled', code: 'REQUEST_CANCELED' })
  })

  it.each([
    ['JSON 이 아닌 본문', () => new HttpResponse('not json', { status: 200 })],
    ['봉투가 아닌 JSON', () => HttpResponse.json({ items: [] })],
    ['error 모양이 틀린 봉투', () => HttpResponse.json({ data: null, error: { code: 1 } })],
    ['빈 본문의 200', () => new HttpResponse(null, { status: 200 })],
  ])('2xx 인데 봉투를 읽을 수 없으면 invalid_response 다 — %s', async (_label, resolver) => {
    server.use(http.get(probe, resolver))
    await expect(request('/probe')).rejects.toMatchObject({
      kind: 'invalid_response',
      code: 'INVALID_RESPONSE',
      status: 200,
    })
  })

  it('401 이면 구독자에게 알리고 403 에는 알리지 않는다. 해제하면 더 알리지 않는다', async () => {
    const listener = vi.fn()
    const stop = onUnauthorized(listener)
    server.use(
      http.get('/api/v1/a', () => fail('UNAUTHENTICATED', '로그인이 필요합니다.', 401)),
      http.get('/api/v1/b', () => fail('FORBIDDEN', '이 작업을 수행할 권한이 없습니다.', 403)),
    )
    await request('/a').catch(() => undefined)
    await request('/b').catch(() => undefined)
    stop()
    await request('/a').catch(() => undefined)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ status: 401 }))
  })
})
