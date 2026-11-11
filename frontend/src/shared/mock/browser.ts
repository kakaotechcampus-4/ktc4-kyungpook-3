import { delay, http } from 'msw'
import { setupWorker } from 'msw/browser'
import { handlers } from './handlers'
import { messageSocketHandler } from './handlers/messageSocket'
import { prepareBrowserDb } from './browserDb'
import { saveDb } from './persistence'
import { fixClock } from '@/shared/lib/date'
import { MOCK_NOW } from './fixtures/constants'

export const worker = setupWorker(...handlers, messageSocketHandler)

/**
 * 로그인 확인(세션·공간 목록) 답을 늦추는 검색 파라미터(ms). 예: `/dashboard?msw-auth-delay=4000`.
 * 로딩 스플래시를 느린 확인으로 볼 때 쓴다 (#430). 그 문서가 열려 있는 동안 로그인 직후 확인에도 걸린다.
 */
const AUTH_DELAY_PARAM = 'msw-auth-delay'

/** 파라미터를 읽고 주소에서 뗀다. 늦출 값이 없으면 0 */
function takeAuthDelay(url: URL): number {
  const raw = url.searchParams.get(AUTH_DELAY_PARAM)
  if (raw === null) return 0
  url.searchParams.delete(AUTH_DELAY_PARAM)
  const ms = Number(raw)
  return Number.isFinite(ms) && ms > 0 ? ms : 0
}

/**
 * 개발 서버의 MSW 를 띄운다. Vitest 는 server.ts 를 쓰고 여기를 거치지 않는다 —
 * 비로그인 시작과 sessionStorage 영속은 브라우저에만 있다.
 */
export async function startMockWorker(): Promise<void> {
  fixClock(Date.parse(MOCK_NOW))
  const url = new URL(window.location.href)
  const authDelay = takeAuthDelay(url)
  const { cleanPath } = prepareBrowserDb(url, window.sessionStorage)
  const path = cleanPath ?? (authDelay > 0 ? `${url.pathname}${url.search}${url.hash}` : null)
  // 라우터가 뜨기 전이라 주소만 조용히 바꾼다. 시나리오 파라미터가 새로고침 때 다시 초기화하지 않게 한다
  if (path !== null) window.history.replaceState(window.history.state, '', path)
  if (authDelay > 0) {
    // 기다린 뒤 아무것도 돌려주지 않으면 원래 handler 가 답한다
    const lag = async () => {
      await delay(authDelay)
    }
    worker.use(http.get('/api/v1/auth/me', lag), http.get('/api/v1/workspaces', lag))
  }
  // handler 실행 뒤, 응답을 넘기기 전에 저장한다. 응답 직후 이동해도 변경을 잃지 않는다.
  worker.events.on('request:match', () => {
    saveDb(window.sessionStorage)
  })
  await worker.start({ onUnhandledRequest: 'warn' })
}
