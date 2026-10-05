import { setupWorker } from 'msw/browser'
import { handlers } from './handlers'
import { prepareBrowserDb } from './browserDb'
import { saveDb } from './persistence'

export const worker = setupWorker(...handlers)

/**
 * 개발 서버의 MSW 를 띄운다. Vitest 는 server.ts 를 쓰고 여기를 거치지 않는다 —
 * 비로그인 시작과 sessionStorage 영속은 브라우저에만 있다.
 */
export async function startMockWorker(): Promise<void> {
  const { cleanPath } = prepareBrowserDb(new URL(window.location.href), window.sessionStorage)
  // 라우터가 뜨기 전이라 주소만 조용히 바꾼다. 시나리오 파라미터가 새로고침 때 다시 초기화하지 않게 한다
  if (cleanPath !== null) window.history.replaceState(window.history.state, '', cleanPath)
  // 응답을 보낸 뒤마다 쓴다. handler 가 db 를 바꾼 직후라 새로고침해도 그 상태로 돌아온다
  worker.events.on('response:mocked', () => {
    saveDb(window.sessionStorage)
  })
  await worker.start({ onUnhandledRequest: 'warn' })
}
