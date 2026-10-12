import { File as NodeFile } from 'node:buffer'
import { HttpResponse, delay, http } from 'msw'
import { onTestFinished } from 'vitest'
import { fail, ok } from '@/shared/mock/envelope'
import { server } from '@/shared/mock/server'
import { deferred } from '@/shared/test/deferred'
import { onUnauthorized, request, toUploadProgress } from './client'
import type { UploadProgress } from './client'
import { ApiError } from './errors'
import { endSessionScope } from './sessionScope'

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

  it('끝난 세션에서 출발한 요청의 401 은 알리지 않는다 — 다시 로그인한 새 세션을 끝내지 않는다 (U4 r3 M04)', async () => {
    const listener = vi.fn()
    onTestFinished(onUnauthorized(listener))
    const received = deferred()
    const answer = deferred()
    server.use(
      http.get('/api/v1/late', async () => {
        received.resolve()
        await answer.promise
        return fail('UNAUTHENTICATED', '로그인이 필요합니다.', 401)
      }),
    )
    const late = request('/late').catch((error: unknown) => error)
    // 서버가 요청을 받은 뒤 세션이 끝나고(로그아웃) 새 세션이 시작됐다(로그인)
    await received.promise
    endSessionScope()
    endSessionScope()
    answer.resolve()
    // 호출자는 401 을 그대로 받는다. 세션 만료 알림만 없다
    await expect(late).resolves.toMatchObject({ status: 401 })
    expect(listener).not.toHaveBeenCalled()

    // 대조군 — 지금 세션에서 출발한 요청의 401 은 그대로 알린다
    server.use(http.get('/api/v1/now', () => fail('UNAUTHENTICATED', '로그인이 필요합니다.', 401)))
    await request('/now').catch(() => undefined)
    expect(listener).toHaveBeenCalledTimes(1)
  })
})

describe('업로드 진행', () => {
  it('전체 크기를 알면 보낸 양과 전체를 준다. 보낸 양은 전체를 넘지 않는다', () => {
    expect(toUploadProgress({ loaded: 50, total: 200, lengthComputable: true })).toEqual({
      loaded: 50,
      total: 200,
    })
    expect(toUploadProgress({ loaded: 250, total: 200, lengthComputable: true })).toEqual({
      loaded: 200,
      total: 200,
    })
  })

  it.each([
    ['lengthComputable 이 거짓', { loaded: 50, total: 200, lengthComputable: false }],
    ['total 이 없다', { loaded: 50, lengthComputable: true }],
    ['total 이 0', { loaded: 50, total: 0, lengthComputable: true }],
    ['total 이 숫자가 아니다', { loaded: 50, total: Number.NaN, lengthComputable: true }],
  ])('전체 크기를 모르면 total 이 null 이다 — %s', (_label, event) => {
    expect(toUploadProgress(event)).toEqual({ loaded: 50, total: null })
  })

  it('보낸 양이 음수나 숫자가 아니면 0 이다', () => {
    expect(toUploadProgress({ loaded: -1, total: 10, lengthComputable: true }).loaded).toBe(0)
    expect(toUploadProgress({ loaded: Number.NaN, lengthComputable: false }).loaded).toBe(0)
  })

  it('multipart 요청의 진행을 axios 이벤트가 아닌 UploadProgress 로 알린다', async () => {
    // meeting.integration.test.ts 와 같은 이유로 이 테스트 동안만 Node File 을 쓴다
    vi.stubGlobal('File', NodeFile)
    onTestFinished(() => {
      vi.unstubAllGlobals()
    })
    server.use(http.post(probe, () => ok({ accepted: true }, { status: 202 })))
    const form = new FormData()
    form.append('file', new Blob(['a'.repeat(1024)], { type: 'audio/mpeg' }), 'a.mp3')
    const seen: UploadProgress[] = []
    await expect(
      request('/probe', {
        method: 'POST',
        body: form,
        onUploadProgress: (progress) => seen.push(progress),
      }),
    ).resolves.toEqual({ accepted: true })
    expect(seen.length).toBeGreaterThan(0)
    for (const progress of seen) {
      expect(Object.keys(progress).sort()).toEqual(['loaded', 'total'])
    }
  })
})
