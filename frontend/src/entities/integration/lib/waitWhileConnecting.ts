import type { IntegrationProvider, Integrations } from '../model/types'

/** 준비 중 다시 묻는 간격. 서버는 2초마다 Notion 에 묻는다 (backend notion_connect.POLL_INTERVAL_SECONDS) */
export const CONNECTING_POLL_MS = 3000
/**
 * 준비 중을 기다리는 끝. 서버는 DB 찾기를 60초 뒤 포기하고, 그 뒤 60초가 지나도 정해지지 않으면 `revoked` 로
 * 내린다(backend integrations.NOTION_CONNECTING_TIMEOUT). 그보다 조금 더 기다린다
 */
export const CONNECTING_TIMEOUT_MS = 150_000

export interface WaitWhileConnectingOptions {
  intervalMs?: number
  timeoutMs?: number
  /** 화면을 떠났거나 세션이 끝났으면 true — 다음 조회를 하지 않는다 */
  shouldStop?: () => boolean
  /** 준비 중 응답을 받을 때마다 부른다. 화면이 `준비 중` 을 보이는 데 쓴다 */
  onConnecting?: () => void
  sleep?: (ms: number) => Promise<void>
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * OAuth 복귀 뒤 연동 상태를 확인한다. Notion 은 토큰을 받은 뒤 템플릿의 DB 를 찾아 붙이는 동안 `connecting` 이다(#204).
 * 그동안은 실패로 보지 않고 끝난 상태(`connected`·`revoked`·`not_connected`)가 올 때까지 다시 묻는다.
 * 기다릴 시간이 지나면 마지막 값(아직 `connecting`)을 돌려준다 — 호출한 쪽은 연결로 보지 않는다.
 * 그만두면 null 이다. 조회 오류는 그대로 던진다
 */
export async function waitWhileConnecting(
  load: () => Promise<Integrations>,
  provider: IntegrationProvider,
  {
    intervalMs = CONNECTING_POLL_MS,
    timeoutMs = CONNECTING_TIMEOUT_MS,
    shouldStop = () => false,
    onConnecting,
    sleep = wait,
  }: WaitWhileConnectingOptions = {},
): Promise<Integrations | null> {
  let waited = 0
  for (;;) {
    const latest = await load()
    if (shouldStop()) return null
    if (latest[provider].status !== 'connecting') return latest
    onConnecting?.()
    if (shouldStop()) return null
    if (waited >= timeoutMs) return latest
    await sleep(intervalMs)
    waited += intervalMs
    if (shouldStop()) return null
  }
}
