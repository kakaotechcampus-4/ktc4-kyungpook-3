import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { start } from './support'

/*
 * #536 — 셸 탭 다섯 개의 화면 코드와 첫 화면 데이터를 셸이 뜬 뒤 한가할 때 미리 받는다.
 * API 를 모두 350ms 늦춘 채 설정 화면에서 셸이 뜨고 미리 받기가 끝나기를 기다린 뒤, 각 탭으로 처음 옮긴다.
 * 누른 순간부터 내용이 뜰 때까지 프레임마다(그리고 DOM 이 바뀔 때마다) 화면 본문을 적는다 — 라우트 뼈대·화면 안 뼈대·뼈대 앞의
 * 빈 지연 구간(#527 의 `data-skeleton="blank"`)이 한 프레임도 없어야 한다. 이전 화면에서 바로 새 화면 내용으로 바뀐다.
 * 임의 waitForTimeout 은 쓰지 않는다 — 네트워크가 잠잠해지기와 화면 조건을 기다린다.
 */

/** 이슈의 측정 조건. 이만큼 늦으면 미리 받지 않은 화면은 뼈대(#527 지연 200ms 넘음)를 반드시 거친다 */
const API_LAG = 350
/** 이만큼 아무 요청도 진행 중이 아니면 미리 받기가 끝난 것으로 본다 */
const QUIET_MS = 800

const WS = '/workspaces/ws_01'

interface Sample {
  at: number
  path: string
  /** 화면 본문의 로딩 자리 — 라우트 뼈대·화면 안 뼈대(aria-busy 컨테이너). 버튼의 진행 표시는 뺀다 */
  busy: number
  /** #527 의 지연 자리(빈 자리 `blank` · 뼈대 `shown`) */
  deferred: number
  heading: string | null
  /** 로딩 자리가 있으면 그 자리를 알아볼 단서(가까운 이름표). 실패 메시지에 나온다 */
  where: string[]
}

declare global {
  interface Window {
    __shellSamples?: Sample[]
    __stopShellSampling?: boolean
  }
}

/** 앱의 API 요청(XHR)을 ms 만큼 늦게 보낸다 — 앱 코드·MSW 응답은 그대로다 (meeting-skeleton.e2e.ts 와 같은 방법) */
function lagApi(page: Page, ms: number) {
  return page.addInitScript((ms) => {
    class LaggedRequest extends XMLHttpRequest {
      private url = ''
      open(
        method: string,
        url: string | URL,
        async = true,
        username?: string | null,
        password?: string | null,
      ) {
        this.url = new URL(String(url), location.href).pathname
        super.open(method, url, async, username, password)
      }
      send(body?: Document | XMLHttpRequestBodyInit | null) {
        if (!this.url.startsWith('/api/')) return super.send(body)
        setTimeout(() => super.send(body), ms)
      }
    }
    window.XMLHttpRequest = LaggedRequest
  }, ms)
}

/** 진행 중인 요청(화면 코드·API)이 QUIET_MS 동안 없을 때까지 기다린다 */
async function waitForQuiet(page: Page) {
  let inFlight = 0
  let lastChange = Date.now()
  const begin = () => {
    inFlight += 1
    lastChange = Date.now()
  }
  const end = () => {
    inFlight = Math.max(0, inFlight - 1)
    lastChange = Date.now()
  }
  page.on('request', begin)
  page.on('requestfinished', end)
  page.on('requestfailed', end)
  // 늦춘 XHR 은 보내기 전 setTimeout 동안 요청으로 보이지 않는다 — 그 틈보다 길게 잠잠해야 한다
  await expect
    .poll(() => inFlight === 0 && Date.now() - lastChange > QUIET_MS + API_LAG, {
      timeout: 20_000,
      intervals: [100],
    })
    .toBe(true)
  page.off('request', begin)
  page.off('requestfinished', end)
  page.off('requestfailed', end)
}

/** 지금부터 프레임마다·DOM 이 바뀔 때마다 화면 본문을 적는다. 거르지 않는다 */
function recordFrames(page: Page) {
  return page.evaluate(() => {
    const samples: Sample[] = []
    window.__shellSamples = samples
    window.__stopShellSampling = false
    const sample = () => {
      const main = document.querySelector('#root main')
      samples.push({
        at: performance.now(),
        path: location.pathname,
        busy: document.querySelectorAll(
          '#root main[aria-busy="true"], #root main [aria-busy="true"]:not(button)',
        ).length,
        deferred: document.querySelectorAll('#root [data-skeleton]').length,
        heading: main?.querySelector('h1')?.textContent ?? null,
        where: [
          ...document.querySelectorAll(
            '#root [data-skeleton], #root main[aria-busy="true"], #root main [aria-busy="true"]:not(button)',
          ),
        ].map((element) => {
          const labelled = element.closest('[aria-label], [data-testid]')
          return `${element.getAttribute('data-skeleton') ?? 'busy'}@${
            labelled?.getAttribute('aria-label') ?? labelled?.getAttribute('data-testid') ?? '?'
          }`
        }),
      })
    }
    const observer = new MutationObserver(sample)
    observer.observe(document.body, { subtree: true, childList: true, attributes: true })
    const frame = () => {
      if (window.__stopShellSampling) {
        observer.disconnect()
        return
      }
      sample()
      requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
  })
}

async function stopFrames(page: Page): Promise<Sample[]> {
  // 내용이 뜬 뒤 몇 프레임 더 적는다 — 뒤늦은 뼈대가 붙지 않는지도 본다
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        let left = 10
        const tick = () => (--left <= 0 ? resolve() : requestAnimationFrame(tick))
        requestAnimationFrame(tick)
      }),
  )
  return page.evaluate(() => {
    window.__stopShellSampling = true
    return window.__shellSamples ?? []
  })
}

const TABS = [
  { label: '대시보드', path: new RegExp(`^${WS}/dashboard$`) },
  // 기본 진입은 가장 최근 회의록으로 주소를 바꾼다
  { label: '회의록', path: new RegExp(`^${WS}/meetings/[^/]+$`) },
  { label: '태스크', path: new RegExp(`^${WS}/tasks$`) },
  { label: '메시지', path: new RegExp(`^${WS}/messages$`) },
  { label: '팀', path: new RegExp(`^${WS}/members$`) },
] as const

for (const { label, path } of TABS) {
  test(`한가할 때 미리 받은 뒤 처음 옮긴 ${label} 탭은 뼈대·빈 자리 없이 바로 내용이 뜬다`, async ({
    page,
  }) => {
    await lagApi(page, API_LAG)
    await start(page, 'messages-default', `${WS}/settings`)
    await expect(page.getByRole('heading', { level: 1, name: '설정' })).toBeVisible()
    await waitForQuiet(page)

    await recordFrames(page)
    await page
      .getByRole('navigation', { name: '주요 화면' })
      .getByRole('link', { name: label, exact: true })
      .click()
    await expect.poll(() => new URL(page.url()).pathname, { timeout: 10_000 }).toMatch(path)
    await expect(page.locator('#root main h1')).toBeVisible()
    const samples = await stopFrames(page)

    // 새 화면이 그려진 샘플이 있어야 한다 — 기록이 이동을 놓치지 않았다
    expect(samples.some((sample) => path.test(sample.path) && sample.heading !== '설정')).toBe(true)
    const loading = samples.filter(({ busy, deferred }) => busy > 0 || deferred > 0)
    expect(loading, JSON.stringify(loading.slice(0, 5))).toEqual([])
  })
}
