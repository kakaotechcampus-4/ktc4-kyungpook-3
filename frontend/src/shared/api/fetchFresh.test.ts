import { QueryClient, QueryObserver, focusManager } from '@tanstack/react-query'
import type { QueryFunctionContext } from '@tanstack/react-query'
import { onTestFinished } from 'vitest'
import { CLIENT_ERROR_CODES } from './errors'
import { FRESH_ATTEMPTS, fetchFresh } from './fetchFresh'
import { endSessionScope } from './sessionScope'

/*
 * 판정 조회는 같은 key 의 공유 Query 를 묻고 캐시에 따로 쓰지 않는다 (U4 r4 M06).
 * 조회 함수는 부를 때마다 새 요청을 하나 만들고, 테스트가 각 요청의 답과 시점을 정한다.
 */
const KEY = ['workspace', 'ws_01', 'integrations'] as const

interface Sent {
  signal: AbortSignal
  answer: (value: string) => void
  reject: (error: unknown) => void
}

/** 공유 Query 의 조회 함수. 받은 요청(`sent`)마다 답을 따로 정한다. signal 을 읽는다 — 실제 요청처럼 취소되면 끊긴다 */
function server() {
  const sent: Sent[] = []
  const queryFn = vi.fn(
    ({ signal }: QueryFunctionContext) =>
      new Promise<string>((resolve, reject) => {
        sent.push({ signal, answer: resolve, reject })
      }),
  )
  return { sent, queryFn, options: { queryKey: KEY, queryFn } }
}

function newClient() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  onTestFinished(() => queryClient.clear())
  return queryClient
}

/** 그 key 를 구독하는 화면(설정의 Notion 영역)과 같다. 돌려준 함수로 내려간다 */
function mountScreen(
  queryClient: QueryClient,
  options: ReturnType<typeof server>['options'],
  { stale = false } = {},
) {
  // 최신 시간이 지났으면(stale) 창 포커스가 다시 묻는다. 그려질 때는 묻지 않는다 — 이미 받아 둔 값을 그린 뒤다
  const observer = new QueryObserver(queryClient, {
    ...options,
    staleTime: stale ? 0 : 30_000,
    refetchOnMount: false,
  })
  return observer.subscribe(() => undefined)
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))
const cached = (queryClient: QueryClient) => queryClient.getQueryData<string>(KEY)

describe('fetchFresh — 캐시에 쓰는 길은 공유 Query 하나다 (U4 r4 M06)', () => {
  it('판정 조회를 기다리는 사이 무효화로 뒤에 출발한 조회가 먼저 답하면, 판정도 그 답을 받고 판정 조회의 이전 답은 캐시에 닿지 않는다', async () => {
    const queryClient = newClient()
    const { sent, queryFn, options } = server()
    queryClient.setQueryData(KEY, 'connected')
    mountScreen(queryClient, options)

    const judged = fetchFresh(queryClient, options)
    expect(sent).toHaveLength(1)
    // 뒤에 출발한 공유 조회가 앞 판정 조회를 거두고(cancelRefetch) 새로 묻는다
    void queryClient.invalidateQueries({ queryKey: KEY })
    expect(sent).toHaveLength(2)
    expect(sent[0].signal.aborted).toBe(true)
    sent[1].answer('revoked')
    await expect(judged).resolves.toBe('revoked')
    expect(cached(queryClient)).toBe('revoked')

    // 먼저 출발한 판정 조회의 이전 답이 늦게 온다
    sent[0].answer('connected')
    await flush()
    expect(cached(queryClient)).toBe('revoked')
    expect(queryFn).toHaveBeenCalledTimes(2)
  })

  it('판정 조회를 기다리는 사이 창 포커스의 재조회는 그 조회에 합쳐진다 — 요청이 하나라 덮어쓸 순서가 없고 판정과 캐시가 같다', async () => {
    const queryClient = newClient()
    queryClient.mount()
    onTestFinished(() => {
      queryClient.unmount()
      focusManager.setFocused(undefined)
    })
    const { sent, queryFn, options } = server()
    queryClient.setQueryData(KEY, 'connected')
    // 최신 시간이 지난 구독 — 포커스로 다시 묻는 대상이다
    mountScreen(queryClient, options, { stale: true })

    const judged = fetchFresh(queryClient, options)
    focusManager.setFocused(false)
    focusManager.setFocused(true)
    await flush()
    expect(queryFn).toHaveBeenCalledTimes(1)

    sent[0].answer('connected-at-request')
    await expect(judged).resolves.toBe('connected-at-request')
    expect(cached(queryClient)).toBe('connected-at-request')
    expect(queryFn).toHaveBeenCalledTimes(1)
  })

  it('같은 key 의 판정 둘이 겹쳐도 한 조회의 답을 함께 받는다 — 앞 판정의 이전 답이 뒤 판정의 답을 덮지 않고, 서로 거두며 되풀이하지 않는다', async () => {
    const queryClient = newClient()
    const { sent, queryFn, options } = server()

    const first = fetchFresh(queryClient, options)
    // 뒤 판정은 시작할 때 진행 중이던 앞 조회를 거두고 새로 묻는다. 앞 판정은 거둬진 것을 보고 그 새 조회에 합쳐진다
    const second = fetchFresh(queryClient, options)
    await flush()
    expect(queryFn).toHaveBeenCalledTimes(2)
    sent[1].answer('revoked')
    await expect(first).resolves.toBe('revoked')
    await expect(second).resolves.toBe('revoked')

    sent[0].answer('connected')
    await flush()
    expect(cached(queryClient)).toBe('revoked')
    expect(queryFn).toHaveBeenCalledTimes(2)
  })
})

describe('fetchFresh — 시작 전에 출발한 조회의 답은 쓰지 않는다 (U4 r3 M05)', () => {
  it('시작할 때 진행 중이던 공유 조회를 거두고 새로 묻는다 — 그 조회의 늦은 이전 답은 캐시를 되돌리지 못한다', async () => {
    const queryClient = newClient()
    const { sent, queryFn, options } = server()
    queryClient.setQueryData(KEY, 'connected')
    mountScreen(queryClient, options)
    // 화면의 공유 조회가 먼저 출발한다
    void queryClient.invalidateQueries({ queryKey: KEY })
    expect(sent).toHaveLength(1)

    const judged = fetchFresh(queryClient, options)
    await flush()
    expect(sent[0].signal.aborted).toBe(true)
    expect(sent).toHaveLength(2)
    sent[1].answer('revoked')
    await expect(judged).resolves.toBe('revoked')

    sent[0].answer('connected')
    await flush()
    expect(cached(queryClient)).toBe('revoked')
    expect(queryFn).toHaveBeenCalledTimes(2)
  })
})

describe('fetchFresh — 취소돼 돌아온 이전 값은 답이 아니다 (U4 r2 M03)', () => {
  it('구독하던 마지막 화면이 내려가 이전 값(connected)이 돌아오면, 같은 세션 안에서 다시 물어 그 답으로 판정한다', async () => {
    const queryClient = newClient()
    const { sent, queryFn, options } = server()
    queryClient.setQueryData(KEY, 'connected')
    const leave = mountScreen(queryClient, options)

    const judged = fetchFresh(queryClient, options)
    expect(sent).toHaveLength(1)
    leave()
    expect(sent[0].signal.aborted).toBe(true)
    await vi.waitFor(() => expect(sent).toHaveLength(2))
    sent[1].answer('revoked')
    await expect(judged).resolves.toBe('revoked')
    expect(cached(queryClient)).toBe('revoked')
    expect(queryFn).toHaveBeenCalledTimes(2)
  })

  it('다시 물을 때는 시작 뒤에 출발한 조회를 거두지 않고 합친다 — 그 답이 판정의 답이다', async () => {
    const queryClient = newClient()
    const { sent, queryFn, options } = server()
    queryClient.setQueryData(KEY, 'connected')
    const leave = mountScreen(queryClient, options)

    const judged = fetchFresh(queryClient, options)
    // 판정 조회가 취소된 바로 그때 다른 화면이 같은 key 를 새로 묻는다 — 판정을 시작한 뒤에 출발한 조회다
    leave()
    void queryClient.fetchQuery({ ...options, staleTime: 0 }).catch(() => undefined)
    expect(sent).toHaveLength(2)
    await flush()
    // 다시 묻는 판정은 그 조회에 합쳐진다. 거두고 또 물으면 요청이 셋이 된다
    expect(queryFn).toHaveBeenCalledTimes(2)
    expect(sent[1].signal.aborted).toBe(false)
    sent[1].answer('revoked')
    await expect(judged).resolves.toBe('revoked')
    expect(queryFn).toHaveBeenCalledTimes(2)
  })

  it('처음 받는 조회가 취소되면(되돌릴 값이 없다 — StrictMode 시험 재마운트) 다시 물어 끝까지 확인한다', async () => {
    const queryClient = newClient()
    const { sent, queryFn, options } = server()
    // 판정이 처음 묻는 조회에 막 그려진 화면의 구독이 붙었다가 곧 내려간다
    const judged = fetchFresh(queryClient, options)
    const leave = mountScreen(queryClient, options)
    expect(sent).toHaveLength(1)
    leave()
    expect(sent[0].signal.aborted).toBe(true)
    await vi.waitFor(() => expect(sent).toHaveLength(2))
    sent[1].answer('connected')
    await expect(judged).resolves.toBe('connected')
    expect(queryFn).toHaveBeenCalledTimes(2)
  })

  it('손으로 쓴 값(setQueryData)은 답으로 치지 않는다 — 그 값으로 되돌아와도 다시 묻는다', async () => {
    const queryClient = newClient()
    const { sent, options } = server()
    queryClient.setQueryData(KEY, 'connected')
    const leave = mountScreen(queryClient, options)

    const judged = fetchFresh(queryClient, options)
    queryClient.setQueryData(KEY, 'written-by-hand')
    leave()
    await vi.waitFor(() => expect(sent).toHaveLength(2))
    sent[1].answer('revoked')
    await expect(judged).resolves.toBe('revoked')
  })

  it(`매번 취소되면 ${FRESH_ATTEMPTS}번까지만 묻고 확인하지 못한 것으로 끝낸다`, async () => {
    const queryClient = newClient()
    const { sent, queryFn, options } = server()
    queryClient.setQueryData(KEY, 'connected')
    const judged = fetchFresh(queryClient, options)
    const outcome = judged.catch((error: unknown) => error)
    for (let attempt = 1; attempt <= FRESH_ATTEMPTS; attempt += 1) {
      await vi.waitFor(() => expect(sent).toHaveLength(attempt))
      // 같은 세션 안에서 다른 곳이 그 조회를 거둔다
      void queryClient.cancelQueries({ queryKey: KEY })
    }
    expect(await outcome).toMatchObject({ code: CLIENT_ERROR_CODES.REQUEST_CANCELED })
    await flush()
    expect(queryFn).toHaveBeenCalledTimes(FRESH_ATTEMPTS)
    expect(cached(queryClient)).toBe('connected')
  })

  it('조회 실패는 다시 묻지 않고 그대로 던진다', async () => {
    const queryClient = newClient()
    const { sent, queryFn, options } = server()
    const judged = fetchFresh(queryClient, options)
    const failure = new Error('network')
    sent[0].reject(failure)
    await expect(judged).rejects.toBe(failure)
    expect(queryFn).toHaveBeenCalledTimes(1)
  })
})

describe('fetchFresh — 끝난 세션의 조회는 부작용이 없다 (U4 r3 M04)', () => {
  it.each([
    ['이전 값이 있으면(되돌림)', true],
    ['이전 값이 없으면(취소)', false],
  ])(
    '기다리는 사이 세션이 끝나면 %s — 그 요청은 세션 정리의 취소로 끊기고, 다시 묻지 않고 취소로 끝나며 늦은 답을 캐시에 쓰지 않는다',
    async (_label, hasCache) => {
      const queryClient = newClient()
      const { sent, queryFn, options } = server()
      if (hasCache) queryClient.setQueryData(KEY, 'connected')
      const judged = fetchFresh(queryClient, options)
      const outcome = judged.catch((error: unknown) => error)

      // 세션을 끝내는 코드(clearUserScope·expireSession)와 같은 순서 — 세대를 올리고 진행 중 조회를 거둔다
      endSessionScope()
      void queryClient.cancelQueries()
      expect(sent[0].signal.aborted).toBe(true)
      expect(await outcome).toMatchObject({ code: CLIENT_ERROR_CODES.REQUEST_CANCELED })

      sent[0].answer('revoked')
      await flush()
      expect(cached(queryClient)).toBe(hasCache ? 'connected' : undefined)
      expect(queryFn).toHaveBeenCalledTimes(1)
    },
  )

  it('세션이 이미 끝난 뒤 답이 와도 판정에 넘기지 않는다', async () => {
    const queryClient = newClient()
    const { sent, options } = server()
    const judged = fetchFresh(queryClient, options)
    const outcome = judged.catch((error: unknown) => error)
    // 세대만 바뀐 채 답이 먼저 온다(취소가 닿기 전)
    endSessionScope()
    sent[0].answer('revoked')
    expect(await outcome).toMatchObject({ code: CLIENT_ERROR_CODES.REQUEST_CANCELED })
  })
})
