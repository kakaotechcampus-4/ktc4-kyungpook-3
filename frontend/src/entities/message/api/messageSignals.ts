import { config } from '@/shared/config/env'

/*
 * 대화 신호 웹소켓 (계약 §5.7 「대화 신호 웹소켓」). 서버는 대화에 새 줄이 생겼다는 신호만 보내고 본문은 보내지 않는다.
 * 화면은 신호를 받으면 기존 조회를 다시 부른다. 이 소켓으로는 아무것도 보내지 않는다
 */

/** 화면이 메시지 조회를 다시 불러야 하는 까닭 */
export type MessageSyncCause =
  /** 소켓이 열렸다. 서버는 끊긴 동안의 신호를 다시 보내지 않는다 */
  | 'opened'
  /** 누군가 대화에 새 줄을 썼다 */
  | 'thread_updated'

export interface MessageSignalOptions {
  onSync: (cause: MessageSyncCause) => void
  /** 연결을 연 세션의 취소 신호. abort 되면 닫고 다시 붙지 않는다 */
  signal: AbortSignal
}

type CloseVerdict = 'stop' | 'retry'

/** 서버가 닫은 코드마다 다시 붙을지. 표에 없는 코드(1011·1012·1013, 네트워크 끊김 1006 등)는 다시 붙는다 */
const CLOSE_VERDICT: Readonly<Partial<Record<number, CloseVerdict>>> = {
  // 세션 없음·만료·로그아웃
  4401: 'stop',
  // 이 공간 소속이 아님·탈퇴
  4403: 'stop',
}

/** 다시 붙기 전 기다림. 열리면 처음으로 돌아가고, 끝까지 가면 마지막 값을 되풀이한다 */
export const RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000] as const

/**
 * 소켓 주소. REST 요청과 같은 곳에 붙는다 — API 기준 주소가 절대 주소면 그 출처를, 경로면 지금 페이지 출처를 쓴다.
 * 출처는 브라우저 `window.location` 에서 읽는다. 라우터의 `useLocation()` 결과에는 출처가 없다
 */
export function messageSignalsUrl(workspaceId: string, origin = window.location.origin): string {
  const url = new URL(
    `${config.apiBaseUrl}/workspaces/${encodeURIComponent(workspaceId)}/messages/ws`,
    origin,
  )
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url.href
}

function isThreadUpdated(data: unknown): boolean {
  if (typeof data !== 'string') return false
  let frame: unknown
  try {
    frame = JSON.parse(data)
  } catch {
    return false
  }
  return (
    typeof frame === 'object' &&
    frame !== null &&
    'type' in frame &&
    frame.type === 'thread_updated' &&
    'thread_id' in frame &&
    typeof frame.thread_id === 'string'
  )
}

/**
 * 그 공간의 대화 신호를 받는다. 열릴 때와 신호가 올 때 `onSync` 를 부르고, 서버가 닫으면 닫힘 코드 표대로 다시 붙는다.
 * 돌려준 함수나 `signal` 의 abort 로 멈춘다 — 멈춘 뒤에는 그 소켓의 어떤 이벤트도 `onSync` 에 닿지 않고 다시 붙지 않는다
 */
export function connectMessageSignals(
  workspaceId: string,
  { onSync, signal }: MessageSignalOptions,
): () => void {
  const url = messageSignalsUrl(workspaceId)
  let socket: WebSocket | null = null
  let retry: ReturnType<typeof setTimeout> | undefined
  let failures = 0

  function connect(): void {
    const current = new WebSocket(url)
    socket = current
    current.onopen = () => {
      failures = 0
      onSync('opened')
    }
    current.onmessage = ({ data }: MessageEvent) => {
      if (isThreadUpdated(data)) onSync('thread_updated')
    }
    current.onclose = ({ code }: CloseEvent) => {
      socket = null
      if (CLOSE_VERDICT[code] === 'stop') return
      retry = setTimeout(connect, RETRY_DELAYS_MS[Math.min(failures, RETRY_DELAYS_MS.length - 1)])
      failures += 1
    }
  }

  function stop(): void {
    signal.removeEventListener('abort', stop)
    clearTimeout(retry)
    const current = socket
    socket = null
    if (current === null) return
    current.onmessage = null
    current.onclose = null
    // 여는 중에 닫으면 브라우저가 경고를 남긴다(StrictMode 의 첫 마운트가 늘 그렇다). 열리는 즉시 닫는다
    if (current.readyState === current.CONNECTING) {
      current.onopen = () => current.close()
    } else {
      current.onopen = null
      current.close()
    }
  }

  if (signal.aborted) return () => {}
  signal.addEventListener('abort', stop)
  connect()
  return stop
}
