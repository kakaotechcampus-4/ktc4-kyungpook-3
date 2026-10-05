import { restoreDb, saveDb } from './persistence'
import { BROWSER_DEFAULT_SCENARIO, applyScenario, isMockScenario } from './scenarios'
import type { MockScenario } from './scenarios'

/** E2E 가 시작 상태를 고르는 검색 파라미터. 예: `/?msw-scenario=no-workspace` */
export const MOCK_SCENARIO_PARAM = 'msw-scenario'

export interface PreparedBrowserDb {
  /** 이번에 적용한 시나리오. 저장값을 복원했으면 null */
  scenario: MockScenario | null
  /** 시나리오 파라미터를 뗀 주소. 파라미터가 없었으면 null — 주소를 바꿀 필요가 없다 */
  cleanPath: string | null
}

/**
 * 브라우저 MSW 의 db 를 준비한다. worker 를 띄우기 전에 한 번 부른다.
 *
 * 1. 주소에 시나리오가 있으면 저장값을 버리고 그 시나리오로 시작한다(E2E 초기화). 모르는 이름은 경고만 한다.
 * 2. 없으면 sessionStorage 의 저장값을 복원한다(새로고침·OAuth 왕복).
 * 3. 저장값이 없거나 버전이 다르거나 손상됐으면 비로그인 시작 상태다.
 */
export function prepareBrowserDb(url: URL, storage: Storage): PreparedBrowserDb {
  const requested = url.searchParams.get(MOCK_SCENARIO_PARAM)
  let cleanPath: string | null = null
  if (requested !== null) {
    const clean = new URL(url)
    clean.searchParams.delete(MOCK_SCENARIO_PARAM)
    cleanPath = `${clean.pathname}${clean.search}${clean.hash}`
  }
  if (isMockScenario(requested)) {
    applyScenario(requested)
    saveDb(storage)
    return { scenario: requested, cleanPath }
  }
  if (requested !== null) console.warn(`Unknown ${MOCK_SCENARIO_PARAM}: ${requested}`)
  if (restoreDb(storage)) return { scenario: null, cleanPath }
  applyScenario(BROWSER_DEFAULT_SCENARIO)
  return { scenario: BROWSER_DEFAULT_SCENARIO, cleanPath }
}
