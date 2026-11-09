import { connectMessageSignals, messageSignalsUrl } from './messageSignals'
import type { MessageSyncCause } from './messageSignals'

/*
 * 브라우저 WebSocket 을 손으로 움직이는 가짜로 바꿔 끼운다. 서버가 여는 때·보내는 글·닫는 코드를 테스트가 정한다.
 * 브라우저처럼 화면이 close() 를 부르면 다음 틈에 close 이벤트(1005)가 온다
 */
class FakeSocket extends EventTarget {
  static readonly all: FakeSocket[] = []
  readonly CONNECTING = 0
  readonly OPEN = 1
  readonly CLOSING = 2
  readonly CLOSED = 3
  readyState = 0
  closedByClient = false
  sent: unknown[] = []
  onopen: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null

  constructor(readonly url: string) {
    super()
    FakeSocket.all.push(this)
  }

  send(data: unknown) {
    this.sent.push(data)
  }

  close() {
    if (this.readyState >= this.CLOSING) return
    this.closedByClient = true
    this.readyState = this.CLOSING
    queueMicrotask(() => this.serverClose(1005))
  }

  serverOpen() {
    this.readyState = this.OPEN
    this.fire(new Event('open'), this.onopen)
  }

  serverSend(data: unknown) {
    this.fire(new MessageEvent('message', { data }), this.onmessage)
  }

  serverClose(code: number) {
    this.readyState = this.CLOSED
    this.fire(new CloseEvent('close', { code }), this.onclose)
  }

  private fire<E extends Event>(event: E, handler: ((event: E) => void) | null) {
    handler?.(event)
    this.dispatchEvent(event)
  }
}

const SIGNAL = JSON.stringify({ type: 'thread_updated', thread_id: 'th_01' })

let causes: MessageSyncCause[]
let session: AbortController
let stops: (() => void)[]

function connect(workspaceId = 'ws_01') {
  const stop = connectMessageSignals(workspaceId, {
    onSync: (cause) => causes.push(cause),
    signal: session.signal,
  })
  stops.push(stop)
  return stop
}

const sockets = () => FakeSocket.all
const latest = () => {
  const socket = FakeSocket.all.at(-1)
  if (!socket) throw new Error('no socket was opened')
  return socket
}
const flush = () => vi.advanceTimersByTimeAsync(0)

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('WebSocket', FakeSocket)
  FakeSocket.all.length = 0
  causes = []
  session = new AbortController()
  stops = []
})
afterEach(() => {
  for (const stop of stops) stop()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('주소', () => {
  it('지금 페이지 출처의 API 경로로 붙는다', () => {
    connect('ws 01')
    expect(latest().url).toBe('ws://localhost:3000/api/v1/workspaces/ws%2001/messages/ws')
  })

  it('https 페이지에서는 wss 로 붙는다', () => {
    expect(messageSignalsUrl('ws_01', 'https://mm.example')).toBe(
      'wss://mm.example/api/v1/workspaces/ws_01/messages/ws',
    )
  })
})

describe('열림과 신호', () => {
  it('열리면 한 번, 신호마다 한 번 다시 받게 하고, 아무것도 보내지 않는다', () => {
    connect()
    expect(causes).toEqual([])
    latest().serverOpen()
    expect(causes).toEqual(['opened'])

    latest().serverSend(SIGNAL)
    latest().serverSend(JSON.stringify({ type: 'thread_updated', thread_id: 'th_02' }))
    expect(causes).toEqual(['opened', 'thread_updated', 'thread_updated'])
    expect(latest().sent).toEqual([])
  })

  it.each([
    ['JSON 이 아닌 글', 'thread_updated'],
    ['다른 종류', JSON.stringify({ type: 'hello', thread_id: 'th_01' })],
    ['대화 ID 없음', JSON.stringify({ type: 'thread_updated' })],
    ['대화 ID 가 글이 아님', JSON.stringify({ type: 'thread_updated', thread_id: 1 })],
    ['JSON null', 'null'],
    ['이진 데이터', new ArrayBuffer(4)],
  ])('모양이 틀린 프레임(%s)은 무시한다', (_name, data) => {
    connect()
    latest().serverOpen()
    latest().serverSend(data)
    expect(causes).toEqual(['opened'])
  })
})

describe('서버가 닫으면', () => {
  it.each([4401, 4403])('%i 이면 다시 붙지 않는다', async (code) => {
    connect()
    latest().serverOpen()
    latest().serverClose(code)
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(sockets()).toHaveLength(1)
  })

  it.each([1011, 1012, 1013, 1000])(
    '%i 이면 1초 뒤 다시 붙고, 열리면 다시 받게 한다',
    async (code) => {
      connect()
      latest().serverOpen()
      latest().serverClose(code)

      await vi.advanceTimersByTimeAsync(999)
      expect(sockets()).toHaveLength(1)
      await vi.advanceTimersByTimeAsync(1)
      expect(sockets()).toHaveLength(2)
      expect(latest().url).toBe(sockets()[0].url)

      latest().serverOpen()
      expect(causes).toEqual(['opened', 'opened'])
    },
  )

  it('붙지 못하고 끊기기를 되풀이하면 1·2·4·8·16·30초, 그 뒤로는 30초씩 기다린다', async () => {
    connect()
    const waits: number[] = []
    for (let round = 0; round < 8; round += 1) {
      latest().serverClose(1006)
      const before = sockets().length
      let waited = 0
      while (sockets().length === before) {
        await vi.advanceTimersByTimeAsync(500)
        waited += 500
      }
      waits.push(waited)
    }
    expect(waits).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000])
    expect(causes).toEqual([])
  })

  it('다시 붙어 열리면 기다림이 1초로 돌아간다', async () => {
    connect()
    latest().serverClose(1006)
    await vi.advanceTimersByTimeAsync(1_000)
    latest().serverClose(1006)
    await vi.advanceTimersByTimeAsync(2_000)
    latest().serverOpen()
    latest().serverClose(1012)

    await vi.advanceTimersByTimeAsync(999)
    expect(sockets()).toHaveLength(3)
    await vi.advanceTimersByTimeAsync(1)
    expect(sockets()).toHaveLength(4)
  })
})

describe('화면이 멈추면', () => {
  it('열린 소켓을 닫고, 브라우저의 닫힘 이벤트로 다시 붙지 않는다', async () => {
    const stop = connect()
    latest().serverOpen()
    stop()
    expect(latest().closedByClient).toBe(true)
    await flush()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(sockets()).toHaveLength(1)
  })

  it('다시 붙기를 기다리는 중이면 기다림을 거둔다', async () => {
    const stop = connect()
    latest().serverClose(1012)
    stop()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(sockets()).toHaveLength(1)
  })

  it('여는 중이면 열리는 즉시 닫고 다시 받게 하지 않는다', async () => {
    const stop = connect()
    stop()
    expect(latest().closedByClient).toBe(false)
    latest().serverOpen()
    expect(latest().closedByClient).toBe(true)
    expect(causes).toEqual([])
    await flush()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(sockets()).toHaveLength(1)
  })
})

describe('세션이 끝나면', () => {
  it('소켓을 닫고, 그 소켓에 늦게 온 신호·닫힘은 아무것도 하지 않는다', async () => {
    connect()
    const old = latest()
    old.serverOpen()
    session.abort()
    expect(old.closedByClient).toBe(true)

    old.serverSend(SIGNAL)
    old.serverClose(1012)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(causes).toEqual(['opened'])
    expect(sockets()).toHaveLength(1)
  })

  it('여는 중에 끝나면 늦게 열려도 다시 받게 하지 않고 닫는다', async () => {
    connect()
    session.abort()
    latest().serverOpen()
    expect(causes).toEqual([])
    expect(latest().closedByClient).toBe(true)
    await flush()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(sockets()).toHaveLength(1)
  })

  it('다시 붙기를 기다리는 중에 끝나면 붙지 않는다', async () => {
    connect()
    latest().serverClose(1006)
    session.abort()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(sockets()).toHaveLength(1)
  })

  it('이미 끝난 세션으로는 열지 않는다', () => {
    session.abort()
    connect()
    expect(sockets()).toHaveLength(0)
  })
})
